// Автотесты сайта Magister: браузерный бот (Playwright) проходит занятия как
// студент — читает и отвечает сверху вниз, курсор движется вниз без «пинг-понга».
// Провал — только на реальной поломке (сайт пометил верный ответ неверным,
// JS-исключение, ошибка PHP, битые картинки, ошибка интерпретатора Pascal).
//
//   graphical.bat  — видно окно и курсор бота (headed)
//   console.bat    — без окна, отчёт в консоль (headless)
//
// node run.mjs [--lessons 1-24|1,5,7|all] [--office|--no-office]
//              [--browser firefox|chromium|webkit] [--headed]
//              [--mouse-delay 120] [--slowmo 0] [--check-negative] [--speak-limit N]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolvePhp, freePort, startServer } from './lib/server.mjs';
import { openSession, runLesson, runOffice } from './lib/runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultSite = resolve(__dirname, '..');

function parseArgs(argv) {
  const a = { lessons: 'all', office: true, browser: 'firefox', headed: false,
    mouseDelay: null, slowmo: null, checkNegative: false, speakLimit: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--lessons') a.lessons = argv[++i];
    else if (k === '--office') a.office = true;
    else if (k === '--no-office') a.office = false;
    else if (k === '--browser') a.browser = argv[++i];
    else if (k === '--headed') a.headed = true;
    else if (k === '--mouse-delay') a.mouseDelay = Number(argv[++i]);
    else if (k === '--slowmo') a.slowmo = Number(argv[++i]);
    else if (k === '--check-negative') a.checkNegative = true;
    else if (k === '--speak-limit') a.speakLimit = Number(argv[++i]);
  }
  return a;
}

function parseLessons(spec) {
  if (!spec || spec === 'all') return Array.from({ length: 24 }, (_, i) => i + 1);
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) for (let n = +m[1]; n <= +m[2]; n++) out.add(n);
    else if (/^\d+$/.test(part.trim())) out.add(+part.trim());
  }
  return [...out].filter(n => n >= 1 && n <= 24).sort((x, y) => x - y);
}

function color(s, c) {
  if (!process.stdout.isTTY) return String(s);
  const codes = { green: 32, red: 31, yellow: 33, cyan: 36, gray: 90, bold: 1 };
  return `\x1b[${codes[c] || 0}m${s}\x1b[0m`;
}

function printLine(r) {
  const mark = r.passedTest ? color('✓', 'green') : color('✗', 'red');
  const stat = `${color(r.passed.length + '✓', 'green')}${r.failed.length ? ' ' + color(r.failed.length + '✗', 'red') : ''}`;
  const extra = `  отвечено:${r.answered} озвучено:${r.spoke}`;
  console.log(`  ${mark} ${r.target.padEnd(16)} ${stat}${color(extra, 'gray')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const siteRoot = resolve(process.env.MAGISTER_SITE || defaultSite);
  if (!existsSync(`${siteRoot}/index.php`)) throw new Error(`Сайт Magister не найден: ${siteRoot}`);
  const php = resolvePhp(siteRoot);

  const mouseDelay = args.mouseDelay != null ? args.mouseDelay : (args.headed ? 120 : 0);
  const slowmo = args.slowmo != null ? args.slowmo : (args.headed ? 30 : 0);
  const opts = { mouseDelay, checkNegative: args.checkNegative, speakLimit: args.speakLimit ?? undefined };

  let playwright;
  try { playwright = await import('playwright'); }
  catch { throw new Error('playwright не установлен. Выполните: npm install  (в папке autotests)'); }
  const engine = playwright[args.browser];
  if (!engine) throw new Error(`Неизвестный браузер: ${args.browser}`);

  console.log(color('\n=== Автотесты Magister ===', 'bold'));
  console.log(`Сайт:    ${siteRoot}`);
  console.log(`PHP:     ${php}`);
  console.log(`Браузер: ${args.browser}  (${args.headed ? 'graphical/headed' : 'console/headless'})`);

  const port = Number(process.env.MAGISTER_AUTOTEST_PORT || await freePort());
  const server = await startServer({ php, siteRoot, port });
  console.log(`Сервер:  ${server.baseUrl}\n`);

  let browser;
  try {
    const launchOpts = { headless: !args.headed, slowMo: slowmo };
    if (args.browser === 'chromium') launchOpts.args = ['--no-sandbox', '--disable-dev-shm-usage'];
    browser = await engine.launch(launchOpts);
  } catch (e) {
    server.stop();
    throw new Error(`Браузер не запустился: ${e.message}\nВыполните: npx playwright install ${args.browser}`);
  }

  const targets = parseLessons(args.lessons);
  const reports = [];
  const session = await openSession(browser, server.baseUrl);
  try {
    for (const n of targets) { const r = await runLesson(session, server.baseUrl, n, opts); reports.push(r); printLine(r); }
    if (args.office) { const r = await runOffice(session, server.baseUrl, opts); reports.push(r); printLine(r); }
  } finally {
    await session.context.close().catch(() => {});
    await browser.close().catch(() => {});
    server.stop();
  }

  const outDir = resolve(__dirname, 'reports');
  mkdirSync(outDir, { recursive: true });
  const mode = args.headed ? 'graphical' : 'console';
  const totals = {
    targets: reports.length,
    passed: reports.filter(r => r.passedTest).length,
    failed: reports.filter(r => !r.passedTest).length,
    answered: reports.reduce((s, r) => s + r.answered, 0),
    spoke: reports.reduce((s, r) => s + r.spoke, 0),
    checksFailed: reports.reduce((s, r) => s + r.failed.length, 0)
  };
  const outFile = resolve(outDir, `report-${mode}-${args.browser}.json`);
  writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), mode, browser: args.browser, site: siteRoot, totals, reports }, null, 2), 'utf8');

  console.log(color('\n=== Итог ===', 'bold'));
  console.log(`Целей: ${totals.targets}   ${color('OK: ' + totals.passed, 'green')}   ${color('Провал: ' + totals.failed, totals.failed ? 'red' : 'gray')}`);
  console.log(`Отвечено заданий: ${totals.answered}, озвучено слов: ${totals.spoke}`);
  console.log(`Отчёт: ${outFile}`);
  if (totals.failed > 0) {
    console.log(color('\nПровалы:', 'red'));
    for (const r of reports.filter(r => !r.passedTest)) {
      console.log(color(`  • ${r.target}`, 'yellow'));
      for (const f of r.failed) console.log(`      - ${f}`);
    }
    process.exitCode = 1;
  } else {
    console.log(color('\nВсе проверки пройдены.', 'green'));
  }
}

main().catch(e => { console.error(color('\nОшибка: ' + e.message, 'red')); process.exit(1); });
