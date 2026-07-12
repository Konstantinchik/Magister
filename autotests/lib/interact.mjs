// Помощники: бот проходит занятие сверху вниз одним проходом, как студент —
// читает и отвечает. Без «пинг-понга»: элементы обрабатываются в порядке
// расположения на странице, курсор движется вниз, назад не скачет.
//
// Философия проверки: ПРОВАЛ засчитывается только на явных признаках поломки
// (сайт пометил ВЕРНЫЙ ответ как неверный, JS-исключение, ошибка PHP и т.п.),
// а не на отсутствии ожидаемой подсветки. Так тест не «фолзит» на страницах,
// которые на самом деле работают.

export function makeReport() {
  return {
    actions: 0, answered: 0, spoke: 0,
    passed: [], failed: [], notes: [],
    ok(l) { this.passed.push(l); },
    bad(l, d) { this.failed.push(d ? `${l}: ${d}` : l); },
    note(l) { this.notes.push(l); }
  };
}

// Красная точка-курсор, чтобы в headed было видно, куда «ведёт мышь» бот.
export async function installCursor(context) {
  await context.addInitScript(() => {
    function mount() {
      if (document.getElementById('__bot_cursor')) return;
      const d = document.createElement('div');
      d.id = '__bot_cursor';
      d.style.cssText = 'position:fixed;z-index:2147483647;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;pointer-events:none;background:rgba(220,38,38,.35);border:2px solid #dc2626;box-shadow:0 0 8px rgba(220,38,38,.6);left:0;top:0';
      document.documentElement.appendChild(d);
      addEventListener('mousemove', e => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
    }
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount); else mount();
  });
}

// Заглушка озвучки: не шумит, но фиксирует обращения.
export async function installSpeechStub(context) {
  await context.addInitScript(() => {
    window.__spoken = [];
    const f = { onvoiceschanged: null, cancel() {}, getVoices() { return []; }, speak(u) { window.__spoken.push((u && u.text) || ''); } };
    try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: f }); } catch { window.speechSynthesis = f; }
  });
}

const seen = h => h.isVisible().catch(() => false);

// Плавно ведёт курсор к элементу (по центру), только вниз/по месту — без рывков.
async function glide(page, handle, mouseDelay) {
  await handle.scrollIntoViewIfNeeded().catch(() => {});
  const box = await handle.boundingBox().catch(() => null);
  if (!box) return null;
  const cx = box.x + Math.min(box.width / 2, 120);
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy, { steps: 6 });
  if (mouseDelay) await page.waitForTimeout(mouseDelay);
  return { cx, cy };
}

// ── Собираем задания в порядке расположения на странице ───────────────────────
// В браузере помечаем «якоря» атрибутом data-bot-idx по возрастанию Y и
// возвращаем их типы. Дальше в Node идём строго по этому порядку.
async function orderAnchors(scope) {
  return await scope.evaluate(root => {
    const pick = [];
    const add = (el, kind) => { if (el && !el.__botTagged) { el.__botTagged = 1; pick.push({ el, kind }); } };
    root.querySelectorAll('.yesno-question').forEach(e => add(e, 'yesno'));
    root.querySelectorAll('.mcq-set').forEach(e => add(e, 'mcq'));
    root.querySelectorAll('.pas-listing').forEach(e => { if (e.querySelector('[data-run]')) add(e, 'pas-run'); });
    root.querySelectorAll('.pas-predict').forEach(e => add(e, 'pas-predict'));
    root.querySelectorAll('.pas-blanks').forEach(e => add(e, 'pas-blanks'));
    root.querySelectorAll('input[data-answer]').forEach(e => add(e, 'input'));
    root.querySelectorAll('select[data-correct]:not([data-no-instant])').forEach(e => {
      if (!e.closest('[data-no-instant]')) add(e, 'select');
    });
    // Кнопки «Проверить» бесхозных задач (task2/3/4 и т.п.) — best-effort
    root.querySelectorAll('button').forEach(e => {
      const t = (e.textContent || '').trim();
      if (/^Провер/i.test(t) && !e.closest('.mcq-set, .pas-predict, .pas-blanks')) add(e, 'task-check');
    });
    root.querySelectorAll('.speak-btn').forEach(e => add(e, 'speak'));

    pick.sort((a, b) => {
      const ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
      return (ra.top + scrollY) - (rb.top + scrollY);
    });
    pick.forEach((p, i) => p.el.setAttribute('data-bot-idx', i));
    return pick.map(p => p.kind);
  });
}

// ── Единый проход: отвечаем в порядке чтения ──────────────────────────────────
export async function walkLesson(page, scope, rep, opts) {
  const kinds = await orderAnchors(scope);
  const { mouseDelay } = opts;
  const speakBudget = opts.speakLimit ?? Infinity;

  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const el = scope.locator(`[data-bot-idx="${i}"]`).first();
    if (!(await seen(el))) continue;

    try {
      if (kind === 'speak') {
        if (rep.spoke >= speakBudget) continue;
        const before = await page.evaluate(() => (window.__spoken || []).length);
        await glide(page, el, mouseDelay);
        await el.click({ timeout: 3000 }).catch(() => {});
        rep.actions++;
        await page.waitForTimeout(mouseDelay ? 60 : 0);
        const after = await page.evaluate(() => (window.__spoken || []).length);
        if (after > before) rep.spoke++;
      }

      else if (kind === 'yesno') {
        const answer = ((await el.getAttribute('data-answer')) || '').trim().toLowerCase();
        // btn-check: кликаем ЛЕЙБЛ верного варианта, а не скрытый input
        const radio = el.locator(`input[type="radio"][value="${answer}"]`).first();
        const id = await radio.getAttribute('id').catch(() => null);
        const target = id ? el.locator(`label[for="${id}"]`).first() : radio;
        await glide(page, target, mouseDelay);
        await target.click({ timeout: 3000 }).catch(() => {});
        rep.actions++; rep.answered++;
        await page.waitForTimeout(120);
        if (await el.locator('.feedback.text-danger').count() > 0)
          rep.bad(`да/нет`, 'верный ответ помечен как неверный');
        else rep.ok('да/нет');
      }

      else if (kind === 'input') {
        const answer = (await el.getAttribute('data-answer')) || '';
        await glide(page, el, mouseDelay);
        await el.fill(answer).catch(() => {});
        await el.dispatchEvent('input').catch(() => {});
        rep.actions++; rep.answered++;
        await page.waitForTimeout(80);
        const cls = (await el.getAttribute('class')) || '';
        if (cls.includes('is-invalid')) rep.bad('ввод', 'верный ответ помечен is-invalid');
        else rep.ok('ввод');
      }

      else if (kind === 'select') {
        const info = await el.evaluate(s => ({
          correct: s.dataset.correct || '',
          options: Array.from(s.options).map(o => o.value || o.textContent.trim()).filter(Boolean)
        }));
        if (!info.options.includes(info.correct)) { rep.note('select без нужной опции'); continue; }
        await glide(page, el, mouseDelay);
        await el.selectOption(info.correct).catch(() => {});
        await el.dispatchEvent('change').catch(() => {});
        rep.actions++; rep.answered++;
        await page.waitForTimeout(80);
        const fb = el.locator('xpath=following-sibling::*[contains(@class,"feedback")][1]');
        const txt = (await fb.count()) ? (await fb.first().innerText().catch(() => '')) : '';
        if (/Неправильно/i.test(txt)) rep.bad('список', 'верный вариант помечен «Неправильно»');
        else rep.ok('список');
      }

      else if (kind === 'mcq') {
        const blocks = el.locator('.question-block');
        for (let b = 0; b < await blocks.count(); b++) {
          const block = blocks.nth(b);
          const correct = (await block.getAttribute('data-correct')) || '';
          const radio = block.locator(`input[type="radio"][value="${correct}"]`).first();
          const id = await radio.getAttribute('id').catch(() => null);
          const target = id ? block.locator(`label[for="${id}"]`).first() : radio;
          if (await seen(target)) { await glide(page, target, mouseDelay); await target.click({ timeout: 2000 }).catch(() => {}); rep.actions++; }
          else if (await seen(radio)) { await radio.check({ force: true }).catch(() => {}); }
        }
        const btn = el.locator('button', { hasText: /Провер/i }).first();
        if (await seen(btn)) { await glide(page, btn, mouseDelay); await btn.click({ timeout: 2000 }).catch(() => {}); rep.actions++; }
        await page.waitForTimeout(120);
        if (await el.locator('.feedback.text-danger').count() > 0) rep.bad('MCQ', 'верные ответы помечены неверно');
        else rep.ok('MCQ');
        rep.answered++;
      }

      else if (kind === 'task-check') {
        // Бесхозная задача с кнопкой «Проверить»: заполняем корректные значения рядом и жмём.
        const card = el.locator('xpath=ancestor-or-self::*[contains(@class,"card") or self::section or self::form][1]');
        const scopeEl = (await card.count()) ? card.first() : scope;
        await scopeEl.evaluate(root => {
          root.querySelectorAll('input[data-correct]').forEach(i => {
            i.value = i.dataset.correct || ''; i.dispatchEvent(new Event('input', { bubbles: true }));
          });
          root.querySelectorAll('select[data-correct]').forEach(s => {
            const v = s.dataset.correct || '';
            if (![...s.options].some(o => o.value === v || o.textContent.trim() === v)) {
              const opt = document.createElement('option'); opt.value = v; opt.textContent = v; s.appendChild(opt);
            }
            s.value = v; s.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }).catch(() => {});
        await glide(page, el, mouseDelay);
        await el.click({ timeout: 2000 }).catch(() => {});
        rep.actions++; rep.note('task-check заполнен и проверен (best-effort)');
        await page.waitForTimeout(100);
      }

      else if (kind === 'pas-run') {
        const run = el.locator('[data-run]').first();
        await glide(page, run, mouseDelay);
        await run.click({ timeout: 2000 }).catch(() => {});
        rep.actions++;
        await page.waitForTimeout(150);
        const out = el.locator('.pas-run-output').first();
        const txt = (await out.count()) ? (await out.innerText().catch(() => '')) : '';
        if (txt && txt.trim().startsWith('⚠')) rep.bad('Pascal «Запустить»', txt.trim().slice(0, 80));
        else if (txt && txt.trim()) rep.ok('Pascal «Запустить»');
      }

      else if (kind === 'pas-predict') {
        const expected = ((await el.getAttribute('data-expected')) || '').replace(/\\n/g, '\n');
        const input = el.locator('.pas-predict-input').first();
        const check = el.locator('[data-check]').first();
        await input.fill(expected).catch(() => {});
        await glide(page, check, mouseDelay);
        await check.click({ timeout: 2000 }).catch(() => {});
        rep.actions++; rep.answered++;
        await page.waitForTimeout(120);
        const fb = await el.locator('.pas-predict-feedback').innerText().catch(() => '');
        if (/Неверно/i.test(fb)) rep.bad('Pascal «Что выведет?»', 'эталон не принят');
        else rep.ok('Pascal «Что выведет?»');
      }

      else if (kind === 'pas-blanks') {
        await el.evaluate(b => b.querySelectorAll('.pas-blank').forEach(i => { i.value = i.dataset.correct || ''; })).catch(() => {});
        const check = el.locator('[data-check]').first();
        await glide(page, check, mouseDelay);
        await check.click({ timeout: 2000 }).catch(() => {});
        rep.actions++; rep.answered++;
        await page.waitForTimeout(120);
        const fb = await el.locator('.pas-blanks-feedback').innerText().catch(() => '');
        if (fb.includes('✗')) rep.bad('Pascal «Заполни пропуск»', 'верные пропуски не приняты');
        else rep.ok('Pascal «Заполни пропуск»');
      }
    } catch (e) {
      rep.bad(kind, e.message.split('\n')[0].slice(0, 80));
    }
  }
}

// ── Необязательная тихая проверка реакции на НЕВЕРНЫЙ ответ (без мыши) ────────
// Меняет значение программно, читает подсветку, возвращает верное. Курсор не двигается.
export async function checkNegativeQuietly(scope, rep) {
  // input[data-answer]: неверный -> is-invalid
  const inp = scope.locator('input[data-answer]').first();
  if (await inp.count()) {
    const right = (await inp.getAttribute('data-answer')) || '';
    await inp.fill('заведомо неверно'); await inp.dispatchEvent('input');
    const bad = ((await inp.getAttribute('class')) || '').includes('is-invalid');
    rep[bad ? 'ok' : 'bad']('реакция: неверный ввод' + (bad ? '' : ' — нет is-invalid'));
    await inp.fill(right); await inp.dispatchEvent('input');
  }
  // yesno: неверный -> text-danger
  const yn = scope.locator('.yesno-question').first();
  if (await yn.count()) {
    const answer = ((await yn.getAttribute('data-answer')) || '').trim().toLowerCase();
    const wrong = answer === 'да' ? 'нет' : 'да';
    const r = yn.locator(`input[type="radio"][value="${wrong}"]`).first();
    const id = await r.getAttribute('id').catch(() => null);
    const t = id ? yn.locator(`label[for="${id}"]`).first() : r;
    if (await t.count()) {
      await t.click({ force: true }).catch(() => {});
      const bad = await yn.locator('.feedback.text-danger').count() > 0;
      rep[bad ? 'ok' : 'bad']('реакция: неверный «да/нет»' + (bad ? '' : ' — нет «Неправильно»'));
    }
  }
}

// ── Тест Word/Excel (отдельная страница) ─────────────────────────────────────
export async function doOfficeTest(page, rep, { mouseDelay, checkNegative }) {
  await page.evaluate(() => document.querySelectorAll('.office-q').forEach(r => { if (r.value === r.dataset.correct) r.checked = true; }));
  const btn = page.locator('#officeTestCheck');
  await glide(page, btn, mouseDelay);
  await btn.click({ timeout: 3000 }).catch(() => {});
  rep.actions++; rep.answered++;
  await page.waitForTimeout(150);
  const res = (await page.locator('#officeTestResult').innerText().catch(() => '')).trim();
  if (/20\s+из\s+20/.test(res) && /100%/.test(res)) rep.ok('office-test: 100% на верных');
  else rep.bad('office-test', `ожидалось 100% (${res.replace(/\s+/g, ' ').slice(0, 60)})`);
  if (checkNegative) {
    await page.evaluate(() => {
      const s = new Set();
      document.querySelectorAll('.office-q').forEach(r => { if (r.value !== r.dataset.correct && !s.has(r.name)) { r.checked = true; s.add(r.name); } });
    });
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(150);
    const r2 = (await page.locator('#officeTestResult').innerText().catch(() => '')).trim();
    if (/0\s+из\s+20/.test(r2) && /0%/.test(r2)) rep.ok('office-test: 0% на неверных');
    else rep.bad('office-test', `ожидалось 0% (${r2.replace(/\s+/g, ' ').slice(0, 60)})`);
  }
}
