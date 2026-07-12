// Прогон целей в ОДНОМ окне браузера (навигация между уроками) — без пересоздания
// контекста на каждый урок (это раньше роняло Playwright в конце прогона).
import { makeReport, installCursor, installSpeechStub, walkLesson, checkNegativeQuietly, doOfficeTest } from './interact.mjs';

const PHP_ERROR = /(Fatal error|Parse error|Warning:|Notice:|Deprecated:|Uncaught \w*Error|Undefined (variable|index|array key))/i;
const noise = s => /favicon/i.test(s);

// Создаёт один инструментированный контекст+страницу на весь прогон.
export async function openSession(browser, baseUrl) {
  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1366, height: 900 } });
  await installCursor(context);
  await installSpeechStub(context);
  const page = await context.newPage();
  const buf = { console: [], page: [], req: [] };
  page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) buf.console.push(m.text()); });
  page.on('pageerror', e => buf.page.push(String(e)));
  page.on('response', r => { try { if (r.status() >= 400 && !noise(r.url())) buf.req.push(`${r.status()} ${r.url()}`); } catch {} });
  page.on('requestfailed', r => { const u = r.url(); if (!noise(u)) buf.req.push(`FAILED ${u}`); });
  return { context, page, buf, reset() { buf.console.length = 0; buf.page.length = 0; buf.req.length = 0; } };
}

function finalize(session, rep) {
  const { buf } = session;
  if (buf.page.length) rep.bad('JS-исключения', buf.page.join(' | '));
  if (buf.console.length) rep.bad('console.error', buf.console.join(' | '));
  if (buf.req.length) rep.bad('запросы ≥400', [...new Set(buf.req)].join(' | '));
  rep.consoleErrors = [...buf.console];
  rep.pageErrors = [...buf.page];
  rep.failedRequests = [...new Set(buf.req)];
  rep.passedTest = rep.failed.length === 0;
}

export async function runLesson(session, baseUrl, lesson, opts) {
  const { page } = session;
  const rep = makeReport();
  rep.target = `урок ${lesson}`;
  rep.url = `${baseUrl}/lessons.php?n=${lesson}`;
  session.reset();
  try {
    await page.goto(rep.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lesson-content', { timeout: 10000 });
    const scope = page.locator('#lesson-content');

    await walkLesson(page, scope, rep, opts);
    if (opts.checkNegative) await checkNegativeQuietly(scope, rep);

    // Картинки должны реально отрисоваться
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll('#lesson-content img')].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.getAttribute('src')));
    if (broken.length) rep.bad('изображения', `не отрисованы: ${broken.slice(0, 5).join(', ')}`);

    // Явный текст PHP-ошибки на странице
    const body = await page.evaluate(() => document.body.innerText);
    if (PHP_ERROR.test(body)) rep.bad('PHP', 'на странице виден текст ошибки PHP');

    finalize(session, rep);
  } catch (e) {
    rep.bad('исключение', e.message.split('\n')[0]);
    finalize(session, rep);
  }
  return rep;
}

export async function runOffice(session, baseUrl, opts) {
  const { page } = session;
  const rep = makeReport();
  rep.target = 'тест Word/Excel';
  rep.url = `${baseUrl}/extra-lessons.php?id=office-test`;
  session.reset();
  try {
    await page.goto(rep.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#officeTestForm', { timeout: 10000 });
    await doOfficeTest(page, rep, opts);
    finalize(session, rep);
  } catch (e) {
    rep.bad('исключение', e.message.split('\n')[0]);
    finalize(session, rep);
  }
  return rep;
}

export { PHP_ERROR };
