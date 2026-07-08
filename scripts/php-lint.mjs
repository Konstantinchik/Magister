import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const portablePhp = 'D:\\MAGISTER\\MagisterTest\\vendor\\php\\php.exe';

function resolvePhpBinary() {
  if (existsSync(portablePhp)) return portablePhp;
  return 'php';
}

const phpBin = resolvePhpBinary();
const phpVersion = spawnSync(phpBin, ['-v'], { encoding: 'utf8' });
if (phpVersion.error || phpVersion.status !== 0) {
  console.error(`PHP CLI не найден. Проверьте portable PHP: ${portablePhp}, либо добавьте php.exe в PATH.`);
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
  const result = spawnSync(phpBin, ['-l', file], { encoding: 'utf8' });
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
console.log(`PHP binary: ${phpBin}`);
