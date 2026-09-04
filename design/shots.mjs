/**
 * Capture full-resolution screenshots of the running app.
 *
 * Drives headless Chrome over the DevTools protocol using Node's built-in
 * WebSocket — no dependencies, nothing added to the project. The Browser pane
 * can screenshot too, but it scales to the pane's size, which came back
 * illegible at desktop widths.
 *
 * The answer state is BUILT IN THE PAGE rather than asked for: a real question
 * costs a paid model call, and these shots are of the design, not of retrieval.
 * The text is real output from an earlier answer.
 *
 * Usage: node shots.mjs [outDir]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = 'http://localhost:5173/';
const OUT = process.argv[2] ?? '.';
const PORT = 9222;

mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + OUT + '/.chrome-profile',
  'about:blank',
], { stdio: 'ignore' });

process.on('exit', () => chrome.kill());

/** Wait for the DevTools endpoint to come up. */
async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

const ws = new WebSocket(await target());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');

async function shot(name, { width, height, script, wait = 1400 }) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 2, mobile: width < 700,
  });
  await send('Page.navigate', { url: APP });
  await sleep(wait);
  if (script) {
    await send('Runtime.evaluate', { expression: script, awaitPromise: true });
    await sleep(600);
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`${name}.png  ${width}x${height} @2x`);
}

/** Builds the answering state in the page, with real text from a live answer. */
const ANSWER = `(() => {
  const thread = document.querySelector('.thread');
  const wb = document.querySelector('.workbench');
  thread.classList.remove('thread-blank');
  document.querySelector('.intro')?.remove();
  wb.classList.remove('no-apparatus');

  const q = document.createElement('div');
  q.className = 'turn user measure';
  q.innerHTML = '<div class="turn-role">Հարց</div><div class="turn-text">Ինչպե՞ս է հաշվարկվում արձակուրդային փոխհատուցումը աշխատանքից ազատվելիս։</div>';
  thread.insertBefore(q, thread.firstChild);

  const a = document.createElement('div');
  a.className = 'turn assistant measure';
  a.innerHTML = '<div class="turn-role">MatyanAI</div><div class="turn-text"><div class="md">' +
    '<p>Չօգտագործված ամենամյա արձակուրդի դրամական հատուցումը հաշվարկվում է հետևյալ կերպ.</p>' +
    '<ol><li>Աշխատանքային պայմանագիրը լուծելիս չօգտագործված արձակուրդի փոխարեն վճարվում է դրամական հատուցում՝ «Եթե աշխատանքային պայմանագրի լուծման հետևանքով ամենամյա արձակուրդի իրավունք ձեռք բերած աշխատողին չի կարող տրամադրվել ամենամյա արձակուրդ, ապա նրան վճարվում է դրամական հատուցում» (Հոդված 170, մաս 1)։</li>' +
    '<li>Հատուցման չափը որոշվում է չօգտագործված օրերի քանակով (Հոդված 170, մաս 2)։</li>' +
    '<li>Օրվա արժեքը հաշվարկվում է միջին օրական աշխատավարձի հիման վրա (Հոդված 169, մաս 1)։</li></ol>' +
    '<p>Սա տեղեկատվական գործիք է, ոչ իրավաբանական խորհրդատվություն։</p>' +
    '</div></div>' +
    '<div class="turn-meta"><div class="cites"><span class="cites-label">Կարդացված հոդվածներ</span>' +
    [170, 169, 165, 130].map((n, i) => '<button class="cite" aria-current="' + (i === 0) + '"><span class="cite-n">' + (i + 1) + '</span><span lang="hy">Հոդված ' + n + '</span></button>').join('') +
    '</div></div>';
  thread.insertBefore(a, thread.querySelector('.composer'));

  const aside = document.createElement('aside');
  aside.className = 'norm';
  const entry = (n, ref, quote, open) =>
    '<div class="entry' + (open ? ' focused' : '') + '"><button class="entry-head"><span class="entry-n">' + n + '</span>' +
    '<span class="entry-main"><span class="entry-line"><span class="norm-ref" lang="hy">Հոդված ' + ref + '</span>' +
    '<span class="rev recent">Խմբ. 03.07.2026</span></span>' +
    '<span class="norm-act" lang="hy">ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ</span></span></button>' +
    (quote ? '<div class="entry-quote" lang="hy">«' + quote + '»</div>' : '') +
    (open ? '<div class="entry-body"><dl class="norm-dates"><div><dt>Ընդունված</dt><dd>09.11.2004</dd></div><div><dt>Խմբ. թիվ</dt><dd>03.07.2026</dd></div><div><dt>Ստուգված</dt><dd>27.08.2026</dd></div></dl>' +
      '<div class="norm-body" lang="hy">1. Եթե աշխատանքային պայմանագրի լուծման հետևանքով ամենամյա արձակուրդի իրավունք ձեռք բերած աշխատողին չի կարող տրամադրվել ամենամյա արձակուրդ, կամ աշխատողը չի ցանկանում դրա տրամադրումը, ապա նրան վճարվում է <mark>դրամական հատուցում</mark>:\\n\\n2. Հատուցման չափը որոշվում է տվյալ ժամանակահատվածի համար տրամադրման ենթակա ամենամյա արձակուրդի չօգտագործված օրերի քանակով:</div>' +
      '<div class="norm-actions"><button class="btn">Պատճենել մեջբերումը</button><a class="btn" href="#">Բացել ARLIS-ում</a></div></div>' : '') +
    '</div>';
  aside.innerHTML = '<div class="norm-inner"><div class="app-head"><span class="app-title">Աղբյուրներ</span>' +
    '<span class="app-count">4</span></div><div class="app-rule"></div>' +
    entry(1, 170, 'Եթե աշխատանքային պայմանագրի լուծման հետևանքով ամենամյա արձակուրդի իրավունք ձեռք բերած աշխատողին չի կարող տրամադրվել ամենամյա արձակուրդ, ապա նրան վճարվում է դրամական հատուցում', true) +
    entry(2, 169, 'Ամենամյա արձակուրդի համար գործատուն աշխատողին վճարում է միջին աշխատավարձ', false) +
    entry(3, 165, '', false) +
    entry(4, 130, '', false) +
    '</div>';
  wb.appendChild(aside);
})()`;

const LOADING = `(() => {
  const thread = document.querySelector('.thread');
  thread.classList.remove('thread-blank');
  document.querySelector('.intro')?.remove();
  const q = document.createElement('div');
  q.className = 'turn user measure';
  q.innerHTML = '<div class="turn-role">Հարց</div><div class="turn-text">Ինչպե՞ս է հաշվարկվում արձակուրդային փոխհատուցումը աշխատանքից ազատվելիս։</div>';
  thread.insertBefore(q, thread.firstChild);
  const a = document.createElement('div');
  a.className = 'turn assistant measure';
  a.innerHTML = '<div class="turn-role">MatyanAI</div><div class="stage">' +
    '<span class="stage-figure"></span><span class="stage-line"><span class="stage-pulse"></span>Կարդում եմ գտնված հոդվածները…</span></div>';
  thread.insertBefore(a, thread.querySelector('.composer'));
})()`;

await shot('01-empty', { width: 1440, height: 900 });
await shot('02-loading', { width: 1440, height: 900, script: LOADING });
await shot('03-answer', { width: 1440, height: 900, script: ANSWER });
await shot('04-mobile-empty', { width: 390, height: 844 });
await shot('05-mobile-answer', { width: 390, height: 844, script: ANSWER });

ws.close();
chrome.kill();
console.log('done ->', OUT);
