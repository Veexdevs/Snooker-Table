/*
 * Teste de fumaça da interface: carrega index.html + app.js num DOM headless
 * e joga uma partida inteira usando cliques reais no canvas.
 */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import { PLAY_W, PLAY_H, CUSHION, OUTER, BALL_R } from '../js/table.js';

const VIEW_W = 1400;
const VIEW_H = 760;

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

/* ---- canvas de verdade por trás do DOM ---- */
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

const bgEl = window.document.querySelector('#table-bg');
bgEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: VIEW_W, height: VIEW_H, right: VIEW_W, bottom: VIEW_H, x: 0, y: 0 });

const errors = [];
window.onerror = (msg, src, line, col, err) => { errors.push(err || msg); console.log('[erro]', msg, line, col, err && err.stack); };
process.on('uncaughtException', (e) => { errors.push(e); console.log('[uncaught]', e.stack); });
process.on('unhandledRejection', (e) => { errors.push(e); console.log('[rejection]', (e && e.stack) || e); });

await import('../js/app.js');
const { G, store, startGame } = window.__bp8;
const { planAIShot } = await import('../js/ai.js');

/* o canvas headless acumula memória a cada drawImage (peculiaridade da lib);
   desenhamos apenas os primeiros quadros e depois só exercitamos a lógica */
const realDraw = G.renderer.draw.bind(G.renderer);
let frames = 0;
G.renderer.draw = (view) => {
  if (frames++ < 150) realDraw(view);
};

/* ---- geometria para converter mundo -> cliente ---- */
const PAD = CUSHION + OUTER;
const TABLE_W = PLAY_W + PAD * 2;
const TABLE_H = PLAY_H + PAD * 2;

const canvas = window.document.querySelector('#table');
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: VIEW_W, height: VIEW_H, right: VIEW_W, bottom: VIEW_H, x: 0, y: 0 });

function view() {
  const scale = Math.min((VIEW_W - 20) / TABLE_W, (VIEW_H - 20) / TABLE_H);
  const ox = (VIEW_W - TABLE_W * scale) / 2;
  const oy = (VIEW_H - TABLE_H * scale) / 2;
  return { scale, ox, oy };
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
}

console.log('menu ativo:', window.document.querySelector('#screen-menu').classList.contains('active'));
document.querySelector('.mode-card[data-mode="ai"]').click();
document.querySelector('#diffList .diff-item[data-diff="pro"]').click();
document.querySelector('#btn-start-ai').click();
await sleep(150);
window.dispatchEvent(new window.Event('resize'));
await sleep(120);
console.log('tela de jogo ativa:', window.document.querySelector('#screen-game').classList.contains('active'));
console.log('dificuldade:', G.difficulty, '| nome do oponente:', G.state.players[1].name);

G.renderer.draw = ((orig) => (view) => { if (!window.__frames) window.__frames = 0; if (window.__frames++ < 150) orig(view); })(realDraw);

let humanShots = 0;
let aiShots = 0;
let guard = 0;

while (G.state.phase !== 'gameover' && guard++ < 90) {
  const state = G.state;
  const player = state.players[state.turn];
  const plan = planAIShot(state, { difficulty: 'pro', player: state.turn });
  const pt = toClient(
    plan.placement ? plan.placement.x : state.balls.find((b) => b.id === 'cue').x,
    plan.placement ? plan.placement.y : state.balls.find((b) => b.id === 'cue').y,
  );

  if (player.isAI) {
    aiShots++;
    // espera a IA concluir (planejamento + animação + simulação)
    const before = state.shots;
    for (let i = 0; i < 120 && G.state.shots === before && G.state.phase !== 'gameover'; i++) await sleep(100);
    for (let i = 0; i < 120 && G.state.phase === 'shooting'; i++) await sleep(100);
    await sleep(450);
    continue;
  }

  if (state.ballInHand) {
    fire(canvas, 'pointermove', pt);
    fire(canvas, 'pointerdown', pt);
    fire(canvas, 'pointerup', pt);
    if (G.state.phase === 'ballinhand') {
      // tenta um ponto livre garantido
      const spot = toClient(PLAY_W * 0.25, PLAY_H * 0.5);
      fire(canvas, 'pointermove', spot);
      fire(canvas, 'pointerdown', spot);
      fire(canvas, 'pointerup', spot);
    }
    if (G.state.phase === 'ballinhand') {
      console.log('!! não conseguiu posicionar a branca');
      break;
    }
  }

  const cue = state.balls.find((b) => b.id === 'cue');
  const aimPoint = toClient(cue.x + Math.cos(plan.angle) * 120, cue.y + Math.sin(plan.angle) * 120);
  fire(canvas, 'pointermove', aimPoint);
  fire(canvas, 'pointerdown', aimPoint);
  const hold = Math.max(60, ((plan.power - 0.05) / 1.25) * 1000);
  await sleep(hold);
  fire(canvas, 'pointerup', aimPoint);
  humanShots++;
  if (process.env.VERBOSE) {
    console.log(`   [humano] alvo=${plan.target ?? '-'} caçapa=${plan.pocket ?? '-'} força=${G.power.toFixed(2)} (plano ${plan.power.toFixed(2)}) fase=${G.state.phase}`);
  }

  for (let i = 0; i < 150 && G.state.phase === 'shooting'; i++) await sleep(100);
  await sleep(420);
  if (process.env.VERBOSE) console.log('     →', G.state.message);
}

const s = G.state;
console.log('fim:', {
  fase: s.phase,
  vencedor: s.winner,
  motivo: s.winnerReason || s.message,
  tacadas: s.shots,
  humanas: humanShots,
  ia: aiShots,
  bolas: s.stats.potted,
  faltas: s.stats.fouls,
  moedas: store.data.coins,
  vitorias: store.data.wins,
  derrotas: store.data.losses,
});
await sleep(900);
console.log('tela final aberta:', window.document.querySelector('#overlay-end').classList.contains('open'),
  '| título:', window.document.querySelector('#endTitle').textContent);
const endCanvas = window.document.querySelector('#confetti');
console.log('confete on:', endCanvas.classList.contains('on'));
window.document.querySelector('#btn-rematch').click();
await sleep(200);
console.log('revanche → fase:', G.state.phase, 'tacadas:', G.state.shots, '| overlay fechado:', !window.document.querySelector('#overlay-end').classList.contains('open'));

/* ---------- treino livre ---------- */
window.document.querySelector('#btn-exit').click();
await sleep(120);
window.document.querySelector('.mode-card[data-mode="practice"]').click();
await sleep(250);
window.dispatchEvent(new window.Event('resize'));
await sleep(120);
console.log('treino:', { modo: G.state.mode, fase: G.state.phase, jogador: G.state.players[1].isAI });

/* move a branca com Shift e taca */
const cueBall = G.state.balls.find((b) => b.id === 'cue');
const destino = toClient(PLAY_W * 0.3, PLAY_H * 0.6);
cueBall.x = PLAY_W * 0.3; cueBall.y = PLAY_H * 0.6;
const alvo = toClient(PLAY_W * 0.62, PLAY_H * 0.42);
fire(canvas, 'pointermove', alvo);
fire(canvas, 'pointerdown', alvo);
await sleep(300);
fire(canvas, 'pointerup', alvo);
for (let i = 0; i < 100 && G.state.phase === 'shooting'; i++) await sleep(100);
await sleep(400);
console.log('treino após tacada:', { fase: G.state.phase, mensagem: G.state.message, restam: G.state.balls.filter((b) => !b.pocketed && b.number > 0).length });

/* ---------- dois jogadores ---------- */
window.document.querySelector('#btn-exit') || null;
window.__bp8.startGame({ mode: 'local' });
await sleep(250);
window.dispatchEvent(new window.Event('resize'));
await sleep(120);
const st = G.state;
const c2 = st.balls.find((b) => b.id === 'cue');
const pt2 = toClient(c2.x + 120, c2.y);
fire(canvas, 'pointermove', pt2);
fire(canvas, 'pointerdown', pt2);
await sleep(700);
fire(canvas, 'pointerup', pt2);
for (let i = 0; i < 120 && G.state.phase === 'shooting'; i++) await sleep(100);
await sleep(400);
console.log('local após quebra:', { modo: G.state.mode, turno: G.state.turn, fase: G.state.phase, msg: G.state.message, ia: G.state.players.map((p) => p.isAI) });
console.log('erros capturados:', errors.length);
await sleep(200);
process.exit(errors.length ? 1 : 0);
