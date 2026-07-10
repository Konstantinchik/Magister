import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const autotestsRoot = resolve(__dirname, '..');
const defaultSiteRoot = resolve(autotestsRoot, '..');
const isWindows = process.platform === 'win32';

function log(message = '') {
  console.log(message);
}

function assertFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
}

// Проверяет, что кандидат — рабочий PHP (запускается и печатает версию).
// Отсекает и отсутствующий файл, и битую сборку (например, без VC++ Redistributable).
function phpWorks(candidate) {
  try {
    const r = spawnSync(candidate, ['-v'], { stdio: 'ignore', windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

// Ищет PHP по порядку: MAGISTER_PHP -> portable в MagisterTest\vendor\php ->
// системный php в PATH -> типичные локальные сборки (XAMPP/Laragon/WAMP/OSPanel).
// Возвращает путь к php(.exe) или строку 'php', если он доступен через PATH.
// Так путь к PHP больше не «зашит» в код — это было главное ограничение
// переносимости, описанное в problems.md (раздел 2).
function resolvePhp(siteRoot) {
  const exe = isWindows ? 'php.exe' : 'php';
  const candidates = [];

  if (process.env.MAGISTER_PHP) candidates.push(process.env.MAGISTER_PHP);

  // Portable PHP рядом с репозиторием: <repo>\..\MagisterTest\vendor\php\php(.exe)
  candidates.push(resolve(siteRoot, '..', 'MagisterTest', 'vendor', 'php', exe));
  // ...и на случай иной раскладки — vendor\php внутри самого репозитория
  candidates.push(resolve(siteRoot, 'vendor', 'php', exe));

  for (const c of candidates) {
    if (existsSync(c) && phpWorks(c)) return c;
  }

  // Системный PHP из PATH
  if (phpWorks('php')) return 'php';

  // Типичные локальные веб-стеки (Windows)
  if (isWindows) {
    const stacks = [
      'C:/xampp/php/php.exe',
      'C:/laragon/bin/php/php.exe',
      'C:/wamp64/bin/php/php.exe',
      'C:/OSPanel/modules/php/php.exe',
      'C:/Program Files/php/php.exe'
    ];
    for (const c of stacks) {
      if (existsSync(c) && phpWorks(c)) return c;
    }
  }

  throw new Error(
    'PHP не найден. Задайте переменную окружения MAGISTER_PHP на php.exe, ' +
    'установите portable PHP в D:\\MAGISTER\\MagisterTest\\vendor\\php\\, ' +
    'или добавьте php в PATH (XAMPP/Laragon и т.п.).'
  );
}

async function getFreePort() {
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolvePort(port));
    });
    server.on('error', reject);
  });
}

async function waitForHttp(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise(resolveOk => {
      const req = http.get(url, res => {
        res.resume();
        resolveOk(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('error', () => resolveOk(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolveOk(false);
      });
    });
    if (ok) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

function startPhpServer({ phpPath, siteRoot, port }) {
  const child = spawn(phpPath, ['-S', `127.0.0.1:${port}`, '-t', siteRoot], {
    cwd: siteRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  child.stdout.on('data', b => logs.push(String(b).trim()));
  child.stderr.on('data', b => logs.push(String(b).trim()));
  child.on('exit', code => logs.push(`php-server-exit:${code}`));
  return { child, logs };
}

async function safeClick(locator, label, stats, options = {}) {
  const count = await locator.count();
  if (count === 0) {
    stats.skipped.push(`${label}: not found`);
    return false;
  }
  const target = locator.first();
  try {
    if (!(await target.isVisible())) {
      stats.skipped.push(`${label}: hidden`);
      return false;
    }
    await target.scrollIntoViewIfNeeded();
    await target.click({ timeout: 5000, ...options });
    stats.clicked += 1;
    return true;
  } catch (e) {
    stats.errors.push(`${label}: ${e.message}`);
    return false;
  }
}

async function fillInputs(page, stats) {
  const inputs = page.locator('#lesson-content input:not([type="radio"]):not([type="checkbox"]):not(.pas-blank)');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    try {
      if (!(await input.isVisible())) {
        stats.skipped.push(`input#${i + 1}: hidden`);
        continue;
      }
      const correct = await input.getAttribute('data-correct');
      const answer = await input.getAttribute('data-answer');
      const alt = await input.getAttribute('data-alt');
      const value = correct || answer || alt || 'тест';
      await input.scrollIntoViewIfNeeded();
      await input.fill(value);
      await input.dispatchEvent('input');
      await input.dispatchEvent('change');
      stats.filled += 1;
    } catch (e) {
      stats.errors.push(`input#${i + 1}: ${e.message}`);
    }
  }
}

async function selectOptions(page, stats) {
  const selects = page.locator('#lesson-content select');
  const count = await selects.count();
  for (let i = 0; i < count; i += 1) {
    const select = selects.nth(i);
    try {
      const data = await select.evaluate(el => ({
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        correct: el.dataset.correct || '',
        options: Array.from(el.options).map(o => ({ value: o.value, text: o.textContent.trim() }))
      }));
      if (!data.visible) {
        stats.skipped.push(`select#${i + 1}: hidden`);
        continue;
      }
      if (data.options.length === 0) {
        stats.warnings.push(`select#${i + 1}: no options`);
        continue;
      }
      const preferred = data.options.find(o => o.value === data.correct || o.text === data.correct)
        || data.options.find(o => o.value && o.value !== '')
        || data.options[0];
      await select.scrollIntoViewIfNeeded();
      await select.selectOption(preferred.value);
      await select.dispatchEvent('change');
      stats.selected += 1;
    } catch (e) {
      stats.errors.push(`select#${i + 1}: ${e.message}`);
    }
  }
}

async function clickRadiosAndChecks(page, stats) {
  const groups = await page.evaluate(() => {
    const result = [];
    const seen = new Set();
    document.querySelectorAll('#lesson-content input[type="radio"], #lesson-content input[type="checkbox"]').forEach((input, index) => {
      const key = input.name || input.id || `idx-${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      const block = input.closest('.yesno-question, .question-block, .card, #lesson-content');
      const correct = block?.dataset?.answer || block?.dataset?.correct || input.dataset.correct || '';
      const candidates = Array.from(document.querySelectorAll(`#lesson-content input[name="${CSS.escape(input.name || '')}"]`));
      let chosen = candidates.find(i => i.value === correct) || candidates.find(i => !i.disabled) || input;
      result.push({ selector: chosen.id ? `#${CSS.escape(chosen.id)}` : null, name: input.name, value: chosen.value, index });
    });
    return result;
  });

  for (const group of groups) {
    try {
      let locator;
      if (group.selector) locator = page.locator(group.selector);
      else locator = page.locator(`#lesson-content input[name="${group.name.replaceAll('"', '\\"')}"][value="${group.value.replaceAll('"', '\\"')}"]`);
      await safeClick(locator, `choice:${group.name || group.index}`, stats, { force: true });
    } catch (e) {
      stats.errors.push(`choice:${group.name || group.index}: ${e.message}`);
    }
  }
}

async function clickSpeakButtons(page, stats) {
  const buttons = page.locator('#lesson-content .speak-btn');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    await safeClick(buttons.nth(i), `speak#${i + 1}`, stats);
  }
}

async function clickActionButtons(page, stats) {
  const buttons = page.locator('#lesson-content button:not(.speak-btn):not([data-complete-lesson])');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const text = ((await button.textContent()) || '').trim().replace(/\s+/g, ' ');
    await safeClick(button, `button#${i + 1}:${text}`, stats);
    await page.waitForTimeout(100);
  }
}

async function clickCompletion(page, stats) {
  const button = page.locator('[data-complete-lesson="1"]');
  await safeClick(button, 'lesson completion', stats);
}

async function collectState(page) {
  return await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    h2: document.querySelector('#lesson-content h2')?.textContent.trim() || '',
    progressText: document.querySelector('#globalProgress')?.textContent.trim() || '',
    completedButtonText: document.querySelector('[data-complete-lesson]')?.textContent.trim() || '',
    completedButtonDisabled: !!document.querySelector('[data-complete-lesson]')?.disabled,
    completionMessage: document.querySelector('[data-completion-message]')?.textContent.trim() || '',
    spokenCount: window.__spoken?.length || 0,
    validInputs: document.querySelectorAll('#lesson-content .is-valid').length,
    invalidInputs: document.querySelectorAll('#lesson-content .is-invalid').length,
    visibleFeedback: Array.from(document.querySelectorAll('#lesson-content .feedback, #lesson-content .alert, #lesson-content [id$="result"]'))
      .filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
      .map(el => el.textContent.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 20),
    phpWarnings: /Fatal error|Parse error|Warning:|Notice:/i.test(document.body.textContent),
    elementCounts: {
      speakButtons: document.querySelectorAll('#lesson-content .speak-btn').length,
      buttons: document.querySelectorAll('#lesson-content button:not(.speak-btn)').length,
      inputs: document.querySelectorAll('#lesson-content input').length,
      selects: document.querySelectorAll('#lesson-content select').length,
      links: document.querySelectorAll('#lesson-content a[href]').length
    }
  }));
}

export async function runLesson1FirefoxAutotest({ headed = false } = {}) {
  const siteRoot = resolve(process.env.MAGISTER_SITE || defaultSiteRoot);
  assertFile(`${siteRoot}/index.php`, 'Magister site');
  const phpPath = resolvePhp(siteRoot);
  log(`[lesson1] PHP: ${phpPath}`);

  const port = Number(process.env.MAGISTER_AUTOTEST_PORT || await getFreePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startPhpServer({ phpPath, siteRoot, port });
  let browser;
  const stats = { clicked: 0, filled: 0, selected: 0, warnings: [], skipped: [], errors: [] };
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];

  try {
    await waitForHttp(`${baseUrl}/index.php`);
    browser = await firefox.launch({ headless: !headed, slowMo: headed ? 120 : 0 });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addInitScript(() => {
      window.__spoken = [];
      const fakeSpeech = {
        onvoiceschanged: null,
        cancel() {},
        getVoices() { return []; },
        speak(utterance) { window.__spoken.push(utterance?.text || ''); }
      };
      try {
        Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: fakeSpeech });
      } catch (_) {
        window.speechSynthesis = fakeSpeech;
      }
    });
    const page = await context.newPage();
    page.on('console', msg => {
      if (['error', 'warning'].includes(msg.type())) consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('requestfailed', req => failedRequests.push(`${req.method()} ${req.url()} ${req.failure()?.errorText || ''}`));

    log(`[lesson1] Firefox ${headed ? 'headed' : 'headless'}: ${baseUrl}/lessons.php?n=1`);
    await page.goto(`${baseUrl}/lessons.php?n=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lesson-content', { timeout: 10000 });

    await clickSpeakButtons(page, stats);
    await fillInputs(page, stats);
    await selectOptions(page, stats);
    await clickRadiosAndChecks(page, stats);
    await clickActionButtons(page, stats);
    await clickCompletion(page, stats);
    await page.waitForTimeout(headed ? 1200 : 300);

    const state = await collectState(page);
    const severeConsole = consoleMessages.filter(m => !/favicon/i.test(m));
    const severeRequests = failedRequests.filter(m => !/favicon/i.test(m));
    const assertions = [];
    if (!state.title.includes('Занятие 1')) assertions.push(`unexpected title: ${state.title}`);
    if (!state.h2.includes('Занятие 1')) assertions.push(`lesson heading not found: ${state.h2}`);
    if (state.phpWarnings) assertions.push('PHP warning/fatal text is visible on page');
    if (state.spokenCount === 0) assertions.push('speech buttons did not call speechSynthesis.speak');
    if (state.completedButtonText !== 'Пройдено') assertions.push(`completion button state: ${state.completedButtonText}`);
    if (state.progressText !== '4%') assertions.push(`progress after completion should be 4%, got ${state.progressText}`);
    if (pageErrors.length) assertions.push(`page errors: ${pageErrors.join(' | ')}`);
    if (severeConsole.length) assertions.push(`console errors: ${severeConsole.join(' | ')}`);
    if (severeRequests.length) assertions.push(`failed requests: ${severeRequests.join(' | ')}`);
    if (stats.errors.length) assertions.push(`interaction errors: ${stats.errors.join(' | ')}`);

    const report = {
      mode: headed ? 'headed' : 'headless',
      browser: 'firefox',
      baseUrl,
      siteRoot,
      phpPath,
      stats,
      state,
      consoleMessages,
      pageErrors,
      failedRequests,
      passed: assertions.length === 0,
      assertions
    };

    const outDir = resolve(autotestsRoot, headed ? 'headed' : 'headless', 'reports');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'lesson1-firefox-report.json'), JSON.stringify(report, null, 2), 'utf8');

    log('');
    log('=== Lesson 1 Firefox autotest summary ===');
    log(`Mode:              ${report.mode}`);
    log(`Clicked controls:  ${stats.clicked}`);
    log(`Filled inputs:     ${stats.filled}`);
    log(`Selected dropdowns:${stats.selected}`);
    log(`Speech calls:      ${state.spokenCount}`);
    log(`Progress:          ${state.progressText}`);
    log(`Completion:        ${state.completedButtonText}`);
    log(`Warnings:          ${stats.warnings.length}`);
    if (stats.warnings.length) stats.warnings.forEach(w => log(`  WARN ${w}`));
    log(`Skipped:           ${stats.skipped.length}`);
    log(`Report:            ${resolve(outDir, 'lesson1-firefox-report.json')}`);

    if (assertions.length) {
      log('');
      log('FAILED:');
      assertions.forEach(a => log(`  - ${a}`));
      throw new Error('Lesson 1 Firefox autotest failed');
    }

    log('');
    log('PASSED: Lesson 1 controls were clicked in Firefox.');
    return report;
  } finally {
    if (browser) await browser.close();
    if (server.child && !server.child.killed) server.child.kill();
  }
}
