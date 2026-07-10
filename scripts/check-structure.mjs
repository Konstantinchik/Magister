// Проверяет, что structure.txt соответствует действительности.
//
// Правило проекта: structure.txt держим актуальным после каждого изменения
// файловой структуры. Скрипт сверяет карту с реальными файлами и падает
// (exit 1), если появились недокументированные записи или в карте остались
// давно удалённые. Запуск: `npm run structure:check` (или через `npm test`).
//
// Чтобы не ломаться на однотипных рядах (155 картинок, 24 урока), глубокие
// списки не сверяются поштучно: контролируются записи верхнего уровня и
// ключевые подкаталоги — именно там обычно и возникает расхождение.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const structurePath = join(repoRoot, 'structure.txt');

// Каталоги, которые не документируем (служебные/генерируемые/внешние).
const IGNORED = new Set(['.git', '.dev-notes', 'node_modules', '.venv', 'reports']);

function isIgnored(name) {
  return IGNORED.has(name) || (name.startsWith('.') && name !== '.gitignore');
}

function entries(dir) {
  return readdirSync(dir)
    .filter(n => !isIgnored(n))
    .map(n => ({ name: n, dir: statSync(join(dir, n)).isDirectory() }));
}

// Собираем то, что ОБЯЗАНО быть упомянуто в structure.txt:
//  - все записи в корне репозитория;
//  - подкаталоги первого уровня внутри assets/ и data/ (и их вложенные каталоги).
function requiredNames() {
  const required = new Set();

  for (const e of entries(repoRoot)) required.add(e.name);

  const deepDirs = ['assets', 'data'];
  for (const top of deepDirs) {
    const topPath = join(repoRoot, top);
    let subs;
    try { subs = entries(topPath); } catch { continue; }
    for (const sub of subs) {
      if (!sub.dir) continue;
      required.add(sub.name);
      // ещё один уровень вложенных каталогов (assets/images/autocad и т.п.)
      for (const inner of entries(join(topPath, sub.name))) {
        if (inner.dir) required.add(inner.name);
      }
    }
  }
  return required;
}

const structure = readFileSync(structurePath, 'utf8');

// Имя считается задокументированным, если встречается в тексте карты
// как отдельный токен (учитываем и запись каталога с завершающим «/»).
function documented(name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s│├└─/])${safe}/?([\\s\\n]|$)`, 'm').test(structure);
}

const missing = [...requiredNames()].filter(n => !documented(n)).sort();

// Обратная проверка: явно перечисленные в карте записи верхнего уровня,
// которых уже нет в репозитории (грубо — по корневым именам).
const rootNames = new Set(entries(repoRoot).map(e => e.name));
const declaredRoot = [...structure.matchAll(/^[│]?[├└]──\s+([^\s/←]+)\/?\s*(?:←.*)?$/gm)]
  .map(m => m[1])
  .filter(n => !n.includes('.') || /\.\w+$/.test(n)); // отсечь артефакты разметки
const stale = declaredRoot.filter(n => !rootNames.has(n) && !isIgnored(n)).sort();

let ok = true;
if (missing.length) {
  ok = false;
  console.error('structure.txt УСТАРЕЛ — не описаны существующие записи:');
  for (const n of missing) console.error(`  + ${n}`);
}
if (stale.length) {
  ok = false;
  console.error('structure.txt содержит записи, которых больше нет в проекте:');
  for (const n of stale) console.error(`  - ${n}`);
}

if (!ok) {
  console.error('');
  console.error('Обновите structure.txt (правило проекта — см. CONTRIBUTING.md).');
  process.exit(1);
}

console.log('structure.txt актуален.');
