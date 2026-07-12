// Поиск PHP и запуск локального сервера `php -S` для тестов.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const isWindows = process.platform === 'win32';

// Рабочий ли это PHP (запускается и печатает версию).
function phpWorks(candidate) {
  try {
    return spawnSync(candidate, ['-v'], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

// Ищет PHP: MAGISTER_PHP -> portable в MagisterTest\vendor\php -> PATH -> типичные стеки.
// Путь к PHP не зашит в код (см. problems.md).
export function resolvePhp(siteRoot) {
  const exe = isWindows ? 'php.exe' : 'php';
  const candidates = [];
  if (process.env.MAGISTER_PHP) candidates.push(process.env.MAGISTER_PHP);
  candidates.push(resolve(siteRoot, '..', 'MagisterTest', 'vendor', 'php', exe));
  candidates.push(resolve(siteRoot, 'vendor', 'php', exe));
  for (const c of candidates) if (existsSync(c) && phpWorks(c)) return c;
  if (phpWorks('php')) return 'php';
  if (isWindows) {
    for (const c of [
      'C:/xampp/php/php.exe', 'C:/laragon/bin/php/php.exe', 'C:/wamp64/bin/php/php.exe',
      'C:/OSPanel/modules/php/php.exe', 'C:/Program Files/php/php.exe'
    ]) if (existsSync(c) && phpWorks(c)) return c;
  }
  throw new Error(
    'PHP не найден. Задайте MAGISTER_PHP на php.exe, установите portable PHP в ' +
    'D:\\MAGISTER\\MagisterTest\\vendor\\php\\, или добавьте php в PATH (XAMPP/Laragon).'
  );
}

export async function freePort() {
  return await new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

async function waitForHttp(url, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await new Promise(r => {
      const req = http.get(url, res => { res.resume(); r(res.statusCode >= 200 && res.statusCode < 500); });
      req.on('error', () => r(false));
      req.setTimeout(1000, () => { req.destroy(); r(false); });
    });
    if (ok) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Локальный сервер не поднялся: ' + url);
}

// Поднимает `php -S` на siteRoot, ждёт готовности, возвращает { baseUrl, stop() }.
export async function startServer({ php, siteRoot, port }) {
  const child = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', siteRoot], {
    cwd: siteRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  child.stdout.on('data', b => logs.push(String(b).trim()));
  child.stderr.on('data', b => logs.push(String(b).trim()));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttp(`${baseUrl}/index.php`);
  return {
    baseUrl,
    logs,
    stop() { if (child && !child.killed) child.kill(); }
  };
}
