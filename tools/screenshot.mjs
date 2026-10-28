/* gera imagens de divulgação (JPEG) para o README */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

globalThis.window = { devicePixelRatio: 1.5, addEventListener() {}, removeEventListener() {} };
globalThis.document = { createElement: (t) => (t === 'canvas' ? createCanvas(4, 4) : {}) };
globalThis.devicePixelRatio = 1.5;

const { createRenderer } = await import('../js/render.js');
const { createGame, startShot, resolveShot, placeCueBall } = await import('../js/rules.js');
const { aimGuide, planAIShot } = await import('../js/ai.js');
const { simulate, createShotLog } = await import('../js/physics.js');

const W = 1440;
const H = 800;
const dpr = 1.5;

function makeCanvasEl() {
  const backing = createCanvas(W * dpr, H * dpr);
  const el = {
    getContext: (t, o) => backing.getContext(t, o),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
  };
  Object.defineProperty(el, 'width', { get: () => backing.width, set: (v) => { backing.width = v; } });
  Object.defineProperty(el, 'height', { get: () => backing.height, set: (v) => { backing.height = v; } });
  return { el, backing };
}

const fg = makeCanvasEl();
const bg = makeCanvasEl();
const renderer = createRenderer(fg.el, bg.el);
renderer.setInsets({ top: 86, left: 18, right: 18, bottom: 14 });
renderer.resize();

const state = createGame({ mode: 'ai', difficulty: 'pro', names: ['Você', 'Computador · Profissional'] });

/* joga até um meio de jogo interessante */
let aim = { angle: 0 };
for (let i = 0; i < 9 && state.phase !== 'gameover'; i++) {
  const plan = planAIShot(state, { difficulty: 'pro', player: state.turn });
  if (state.ballInHand && plan.placement) placeCueBall(state, plan.placement.x, plan.placement.y);
  startShot(state, plan);
  const log = createShotLog();
  let t = 0;
  while (simulate(state, 1 / 60, log) && t < 14) t += 1 / 60;
  resolveShot(state, log);
}
aim = { angle: -2.62 };
renderer.draw({
  state, aim, guide: aimGuide(state, aim.angle), power: 0.62, showGuide: true,
  time: 1.2, pointer: null, pointerValid: false, effects: [],
});

const composed = createCanvas(W * dpr, H * dpr);
const cc = composed.getContext('2d');
cc.drawImage(bg.backing, 0, 0);
cc.drawImage(fg.backing, 0, 0);
fs.mkdirSync(new URL('../docs', import.meta.url), { recursive: true });
const out = new URL('../docs/mesa.jpg', import.meta.url);
fs.writeFileSync(out, composed.toBuffer('image/jpeg', 88));
console.log('escrito docs/mesa.jpg', fs.statSync(out).size, 'bytes');
