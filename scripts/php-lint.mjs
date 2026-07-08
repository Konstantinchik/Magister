import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

const phpVersion = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (phpVersion.error || phpVersion.status !== 0) {
  console.error('PHP CLI не найден. Установите PHP и добавьте php.exe в PATH, затем повторите npm run lint:php.');
  process.exit(1);
}

function collectPhpFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPhpFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.php')) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = collectPhpFiles(root);
let failed = 0;

for (const file of files) {
  const result = spawnSync('php', ['-l', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    console.error(result.stdout.trim() || result.stderr.trim());
  }
}

if (failed > 0) {
  console.error(`PHP lint failed: ${failed} file(s).`);
  process.exit(1);
}

const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`PHP lint passed: ${files.length} file(s), ${totalBytes} bytes.`);
