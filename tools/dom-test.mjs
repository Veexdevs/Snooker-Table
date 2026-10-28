/*
 * Teste de fumaça da interface: carrega index.html + app.js num DOM headless
 * e joga uma partida inteira usando eventos reais (mira, barra de força, giz).
 */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import { PLAY_W, PLAY_H, CUSHION, OUTER } from '../js/table.js';

const VIEW_W = 1440;
const VIEW_H = 800;

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => {
  if (!String(e.message).includes('Not implemented')) console.log('[jsdom]', e.message);
});
virtualConsole.on('error', (...a) => console.log('[console.error]', ...a));

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
  virtualConsole,
});
const { window } = dom;

const backings = new WeakMap();
const unwrap = (v) => (v && backings.get(v)) || v;
window.HTMLCanvasElement.prototype.getContext = function getContext(type, opts) {
  let backing = backings.get(this);
  if (!backing) {
    const el = this;
    backing = createCanvas(Number(el.getAttribute('width')) || 800, Number(el.getAttribute('height')) || 600);
    backings.set(el, backing);
    Object.defineProperty(el, 'width', { configurable: true, get: () => backing.width, set: (v) => { backing.width = Math.max(1, v | 0); } });
    Object.defineProperty(el, 'height', { configurable: true, get: () => backing.height, set: (v) => { backing.height = Math.max(1, v | 0); } });
  }
  const raw = backing.getContext(type, opts);
  if (!raw) return raw;
  return new Proxy(raw, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v !== 'function') return v;
      return (...args) => {
        if (prop === 'createPattern') return target.createPattern(unwrap(args[0]), args[1]);
        if (prop === 'drawImage') return target.drawImage(unwrap(args[0]), ...args.slice(1));
        return v.apply(target, args);
      };
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
};
window.Element.prototype.animate = function animate() { return { cancel() {}, finished: Promise.resolve() }; };

globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.PointerEvent = window.PointerEvent;

const errors = [];
window.onerror = (msg, src, line, col, err) => { errors.push(err || msg); console.log('[erro]', msg, line, col, err && err.stack); };
process.on('uncaughtException', (e) => { errors.push(e); console.log('[uncaught]', e.stack); });
process.on('unhandledRejection', (e) => { errors.push(e); console.log('[rejection]', (e && e.stack) || e); });

await import('../js/app.js');
const { G, store, renderer } = window.__bp8;
const { planAIShot } = await import('../js/ai.js');

/* o canvas headless acumula memória a cada drawImage (peculiaridade da lib);
   desenhamos só os primeiros quadros e depois exercitamos só a lógica */
const realDraw = renderer.draw.bind(renderer);
let frames = 0;
renderer.draw = (v) => { if (frames++ < 120) realDraw(v); };

const canvas = window.document.querySelector('#table');
const bgEl = window.document.querySelector('#table-bg');
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: VIEW_W, height: VIEW_H, right: VIEW_W, bottom: VIEW_H, x: 0, y: 0 });
bgEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: VIEW_W, height: VIEW_H, right: VIEW_W, bottom: VIEW_H, x: 0, y: 0 });

const PAD = CUSHION + OUTER;
const TABLE_W = PLAY_W + PAD * 2;
const TABLE_H = PLAY_H + PAD * 2;
const INSET = { top: 10, left: 56, right: 62, bottom: 12 };
function view() {
  const availW = VIEW_W - INSET.left - INSET.right;
  const availH = VIEW_H - INSET.top - INSET.bottom;
  const scale = Math.min(availW / TABLE_W, availH / TABLE_H);
  return { scale, ox: INSET.left + (availW - TABLE_W * scale) / 2, oy: INSET.top + (availH - TABLE_H * scale) / 2 };
}
function toClient(x, y) {
  const { scale, ox, oy } = view();
  return { clientX: (x + PAD) * scale + ox, clientY: (y + PAD) * scale + oy };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fire(el, type, opts) {
  const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...opts });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  el.dispatchEvent(ev);
  return ev;
}

/* barra de força: geometria falsa para poder "puxar" */
const powerBar = window.document.querySelector('#powerBar');
const barRect = { top: 200, height: 300, left: 12, width: 26 };
powerBar.getBoundingClientRect = () => ({ ...barRect, right: 38, bottom: 500, x: 12, y: 200 });
const spinPad = window.document.querySelector('#spinPad');
const spinRect = { left: 20, top: 620, width: 62, height: 62 };
spinPad.getBoundingClientRect = () => ({ ...spinRect, right: 82, bottom: 682, x: 20, y: 620 });

function pullPower(power) {
  const y = barRect.top + barRect.height * power;
  fire(powerBar, 'pointerdown', { clientX: 25, clientY: barRect.top + 2 });
  fire(powerBar, 'pointermove', { clientX: 25, clientY: y });
  return y;
}

console.log('menu ativo:', window.document.querySelector('#screen-menu').classList.contains('active'));
window.document.querySelector('.mode-card[data-mode="ai"]').click();
window.document.querySelector('#diffList .diff-item[data-diff="pro"]').click();
window.document.querySelector('#btn-start-ai').click();
await sleep(200);
window.dispatchEvent(new window.Event('resize'));
await sleep(150);
console.log('tela de jogo ativa:', window.document.querySelector('#screen-game').classList.contains('active'));
console.log('nomes:', G.state.players.map((p) => `${p.name}${p.isAI ? ' (IA)' : ''}`));

/* ---- efeito + giz ---- */
spinPad.dispatchEvent(Object.assign(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 45, clientY: 640 }), {}));
console.log('efeito aplicado:', JSON.stringify(G.state.shot.spin), '| rótulo:', window.document.querySelector('#spinNow').textContent);
window.document.querySelector('#chalkWhite').click();
window.document.querySelector('#chalkBlue').click();
console.log('buffs:', JSON.stringify({ forca: Math.round(G.buffs.power), efeito: Math.round(G.buffs.spin) }), '| mochila:', store.data.chalkWhite, store.data.chalkBlue);

/* ---- tacada com a barra (puxando para baixo) ---- */
let humanShots = 0;
let aiShots = 0;
let guard = 0;
while (G.state.phase !== 'gameover' && guard++ < 14) {
  const state = G.state;
  const player = state.players[state.turn];
  const plan = planAIShot(state, { difficulty: 'pro', player: state.turn });
  const cue = state.balls.find((b) => b.id === 'cue');

  if (player.isAI) {
    aiShots++;
    const before = state.shots;
    for (let i = 0; i < 60 && (G.state.shots === before && G.state.phase !== 'gameover'); i++) await sleep(100);
    for (let i = 0; i < 120 && G.state.phase === 'shooting'; i++) await sleep(100);
    await sleep(450);
    continue;
  }

  if (state.ballInHand) {
    const spot = toClient(plan.placement ? plan.placement.x : PLAY_W * 0.25, plan.placement ? plan.placement.y : PLAY_H * 0.5);
    fire(canvas, 'pointermove', spot);
    fire(canvas, 'pointerdown', spot);
    fire(canvas, 'pointerup', spot);
    await sleep(60);
    if (G.state.phase === 'ballinHand') {
      // tenta pontos até conseguir
      let ok = false;
      for (let gx = 0.15; gx < 0.9 && !ok; gx += 0.1) {
        for (let gy = 0.15; gy < 0.9 && !ok; gy += 0.1) {
          const p = toClient(PLAY_W * gx, PLAY_H * gy);
          fire(canvas, 'pointermove', p);
          fire(canvas, 'pointerdown', p);
          fire(canvas, 'pointerup', p);
          ok = G.state.phase !== 'ballinHand';
        }
      }
      if (!ok) { console.log('!! não conseguiu posicionar a branca'); break; }
    }
  }

  const aimPoint = toClient(cue.x + Math.cos(plan.angle) * 140, cue.y + Math.sin(plan.angle) * 140);
  fire(canvas, 'pointermove', aimPoint);
  fire(canvas, 'pointerdown', aimPoint);
  fire(canvas, 'pointerup', aimPoint);
  const barY = pullPower(Math.max(0.05, Math.min(1, plan.power)));
  await sleep(70);
  if (process.env.VERBOSE) {
    console.log(`   [humano] força na barra=${G.power.toFixed(2)} (plano ${plan.power.toFixed(2)}) alvo=${plan.target ?? '-'}`);
  }
  fire(powerBar, 'pointerup', { clientX: 25, clientY: barY });
  humanShots++;
  await sleep(200);
  if (G.state.phase !== 'shooting') console.log('   !! a tacada não começou', G.state.phase);
  for (let i = 0; i < 120 && G.state.phase === 'shooting'; i++) await sleep(100);
  await sleep(450);
  if (process.env.VERBOSE) console.log('     →', G.state.message);
}

const s = G.state;
console.log('fim:', {
  fase: s.phase, vencedor: s.winner, motivo: s.winnerReason || s.message,
  tacadas: s.shots, humanas: humanShots, ia: aiShots,
  bolas: s.stats.potted, faltas: s.stats.fouls,
  moedas: store.data.coins, vitorias: store.data.wins, derrotas: store.data.losses,
});
await sleep(900);
console.log('fim de jogo na tela:', window.document.querySelector('#overlay-end').classList.contains('open'),
  '| título:', window.document.querySelector('#endTitle').textContent);

window.document.querySelector('#btn-rematch').click();
await sleep(200);
console.log('revanche → fase:', G.state.phase, '| tacadas:', G.state.shots);

/* ---- treino livre ---- */
window.document.querySelector('#btn-exit').click();
await sleep(120);
window.document.querySelector('.mode-card[data-mode="practice"]').click();
await sleep(250);
window.dispatchEvent(new window.Event('resize'));
await sleep(120);
console.log('treino:', { modo: G.state.mode, fase: G.state.phase, ia: G.state.players[1].isAI });
const cue = G.state.balls.find((b) => b.id === 'cue');
cue.x = PLAY_W * 0.3; cue.y = PLAY_H * 0.6;
const target = toClient(PLAY_W * 0.62, PLAY_H * 0.42);
fire(canvas, 'pointermove', target);
fire(canvas, 'pointerdown', target);
fire(canvas, 'pointerup', target);
const y2 = pullPower(0.5);
await sleep(80);
fire(powerBar, 'pointerup', { clientX: 25, clientY: y2 });
for (let i = 0; i < 140 && G.state.phase === 'shooting'; i++) await sleep(100);
await sleep(400);
console.log('treino após tacada:', { fase: G.state.phase, restam: G.state.balls.filter((b) => !b.pocketed && b.number > 0).length });

/* ---- dois jogadores ---- */
window.__bp8.startGame({ mode: 'local' });
await sleep(250);
window.dispatchEvent(new window.Event('resize'));
await sleep(120);
console.log('local:', { modo: G.state.mode, turno: G.state.turn, ia: G.state.players.map((p) => p.isAI) });

/* ---- efeito no simulador (draw) ---- */
console.log('erros capturados:', errors.length);
await sleep(200);
process.exit(errors.length ? 1 : 0);
