import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

function loadPascalRunner() {
  const source = readFileSync(join(process.cwd(), 'assets/js/pascal-trainer.js'), 'utf8');
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() {
      return [];
    }
  };
  const window = { document };

  vm.runInNewContext(source, { window, document, console }, { filename: 'pascal-trainer.js' });

  assert.ok(window.PascalTrainer, 'PascalTrainer export is missing');
  assert.equal(typeof window.PascalTrainer.run, 'function');
  return window.PascalTrainer.run;
}

function assertPascalTrainerExportsBeforeDomInitFailure() {
  const source = readFileSync(join(process.cwd(), 'assets/js/pascal-trainer.js'), 'utf8');
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector.includes('pas-listing')) throw new Error('synthetic DOM failure');
      return [];
    }
  };
  const errors = [];
  const window = { document };
  const testConsole = {
    ...console,
    error(...args) {
      errors.push(args.join(' '));
    }
  };

  vm.runInNewContext(source, { window, document, console: testConsole }, { filename: 'pascal-trainer.js' });

  assert.equal(typeof window.PascalTrainer?.run, 'function');
  assert.ok(errors.some(line => line.includes('PascalTrainer initialization failed')));
}

const run = loadPascalRunner();
assertPascalTrainerExportsBeforeDomInitFailure();

const cases = [
  {
    name: 'arithmetic precedence',
    code: `
program Arithmetic;
begin
  writeln(2 + 3 * 4);
end.
`,
    output: '14'
  },
  {
    name: 'for loop accumulation',
    code: `
program Sum;
var i, s: integer;
begin
  s := 0;
  for i := 1 to 5 do
    s := s + i;
  writeln(s);
end.
`,
    output: '15'
  },
  {
    name: 'downto loop and write concatenation',
    code: `
program Countdown;
var i: integer;
begin
  for i := 3 downto 1 do
    write(i);
  writeln;
end.
`,
    output: '321'
  },
  {
    name: 'arrays and integer operations',
    code: `
program Arrays;
var a: array[1..3] of integer;
begin
  a[1] := 10;
  a[2] := 3;
  a[3] := a[1] div a[2] + a[1] mod a[2];
  writeln(a[3]);
end.
`,
    output: '4'
  },
  {
    name: 'while, repeat and boolean if',
    code: `
program Flow;
var i, s: integer;
begin
  i := 0;
  s := 0;
  while i < 3 do
  begin
    i := i + 1;
    s := s + i;
  end;
  repeat
    s := s + 2;
  until s >= 10;
  if s = 10 then writeln('ok') else writeln('fail');
end.
`,
    output: 'ok'
  },
  {
    name: 'built-in functions and number formatting',
    code: `
program Builtins;
begin
  writeln(abs(-3));
  writeln(sqr(4));
  writeln(round(sqrt(9)));
end.
`,
    output: '3\n16\n3'
  }
];

for (const testCase of cases) {
  assert.equal(run(testCase.code), testCase.output, testCase.name);
}

assert.throws(
  () => run(`
program Infinite;
begin
  while true do
  begin
  end;
end.
`),
  /Превышен лимит итераций/,
  'infinite loop guard'
);

console.log(`PascalRunner tests passed: ${cases.length + 1}`);
