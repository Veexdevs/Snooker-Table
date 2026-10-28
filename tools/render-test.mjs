/* Renderiza um quadro do jogo em PNG (sem navegador) para conferir o visual. */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

globalThis.window = { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {}, innerWidth: 1400, innerHeight: 800 };
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return createCanvas(10, 10);
    return {};
  },
};
globalThis.devicePixelRatio = 2;

const { createRenderer } = await import('../js/render.js');
const { createGame, startShot } = await import('../js/rules.js');
const { aimGuide } = await import('../js/ai.js');
const { simulate, createShotLog } = await import('../js/physics.js');

const W = Number(process.env.W || 1400);
const H = Number(process.env.H || 820);
const shot = process.argv[2] || 'aim';

const state = createGame({ mode: 'ai', difficulty: 'pro' });

const backing = createCanvas(W * 2, H * 2);
const el = {
  getContext: (t, o) => backing.getContext(t, o),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
};
Object.defineProperty(el, 'width', { get: () => backing.width, set: (v) => { backing.width = v; } });
Object.defineProperty(el, 'height', { get: () => backing.height, set: (v) => { backing.height = v; } });
const ctx2d = backing.getContext('2d');
const bgBacking = createCanvas(W * 2, H * 2);
const bgEl = {
  getContext: (t, o) => bgBacking.getContext(t, o),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
};
Object.defineProperty(bgEl, 'width', { get: () => bgBacking.width, set: (v) => { bgBacking.width = v; } });
Object.defineProperty(bgEl, 'height', { get: () => bgBacking.height, set: (v) => { bgBacking.height = v; } });
const renderer = createRenderer(el, bgEl);
renderer.resize();

let aim = { angle: -0.15 };
let power = 0.55;
let guide = aimGuide(state, aim.angle);

if (shot === 'midgame') {
  // joga algumas tacadas de IA para chegar num meio de jogo
  const { planAIShot } = await import('../js/ai.js');
  const { resolveShot, placeCueBall } = await import('../js/rules.js');
  for (let i = 0; i < 12; i++) {
    if (state.phase === 'gameover') break;
    const plan = planAIShot(state, { difficulty: 'pro', player: state.turn });
    if (state.ballInHand && plan.placement) placeCueBall(state, plan.placement.x, plan.placement.y);
    aim = { angle: plan.angle }; power = plan.power;
    startShot(state, plan);
    const log = createShotLog();
    let t = 0; while (simulate(state, 1/60, log) && t < 14) t += 1/60;
    resolveShot(state, log);
  }
  aim = { angle: 2.2 };
  guide = aimGuide(state, aim.angle);
}

if (shot === 'pockets') {
  state.balls.forEach((b, i) => {
    if (b.number === 0) { b.x = 300; b.y = 240; return; }
    b.x = 60 + (i % 8) * 120; b.y = 120 + Math.floor(i / 8) * 240;
  });
}

renderer.draw({
  state, aim, guide, power, showGuide: true, time: performance.now() / 1000,
  pointer: { x: 320, y: 260 }, pointerValid: true, effects: [],
});

const composed = createCanvas(W * 2, H * 2);
const compCtx = composed.getContext('2d');
compCtx.drawImage(bgBacking, 0, 0);
compCtx.drawImage(backing, 0, 0);
let out2 = composed;
if (process.env.CROP) {
  const [cx, cy, cw, ch] = process.env.CROP.split(',').map(Number);
  const { createCanvas: cc } = await import('@napi-rs/canvas');
  const z = Number(process.env.ZOOM || 2);
  out2 = cc(cw * z, ch * z);
  const zc = out2.getContext('2d');
  zc.imageSmoothingQuality = 'high';
  zc.drawImage(composed, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
}
const png = out2.toBuffer('image/png');
const out = `/tmp/shots/${shot}${process.env.SUFFIX||''}.png`;
fs.writeFileSync(out, png);
console.log('escrito', out, png.length, 'bytes');
