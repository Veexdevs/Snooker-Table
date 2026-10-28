/* Renderiza um quadro do jogo em PNG (sem navegador) para conferir o visual. */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

globalThis.window = { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} };
globalThis.document = { createElement: (tag) => (tag === 'canvas' ? createCanvas(8, 8) : {}) };
globalThis.devicePixelRatio = 2;

const { createRenderer } = await import('../js/render.js');
const { createGame, startShot, resolveShot, placeCueBall } = await import('../js/rules.js');
const { aimGuide, planAIShot } = await import('../js/ai.js');
const { simulate, createShotLog } = await import('../js/physics.js');
const { Particles } = await import('../js/fx.js');

const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 800);
const shot = process.argv[2] || 'aim';

function makeEl() {
  const backing = createCanvas(W * 2, H * 2);
  const el = {
    getContext: () => backing.getContext('2d'),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
  };
  Object.defineProperty(el, 'width', { get: () => backing.width, set: (v) => { backing.width = v; } });
  Object.defineProperty(el, 'height', { get: () => backing.height, set: (v) => { backing.height = v; } });
  return { el, backing };
}
const fg = makeEl();
const bg = makeEl();
const renderer = createRenderer(fg.el, bg.el);
renderer.setInsets({ top: 10, left: 56, right: 62, bottom: 12 });
renderer.resize();

const state = createGame({ mode: 'ai', difficulty: 'pro', names: ['Você', 'CPU · Profissional'] });
const particles = new Particles();
let aim = { angle: 0 };

if (shot === 'midgame') {
  for (let i = 0; i < 11 && state.phase !== 'gameover'; i++) {
    const plan = planAIShot(state, { difficulty: 'pro', player: state.turn });
    if (state.ballInHand && plan.placement) placeCueBall(state, plan.placement.x, plan.placement.y);
    startShot(state, plan);
    const log = createShotLog();
    let t = 0; while (simulate(state, 1 / 60, log) && t < 14) t += 1 / 60;
    resolveShot(state, log);
  }
  aim = { angle: -2.45 };
}

if (shot === 'pockets') {
  state.balls.forEach((b, i) => {
    if (b.number === 0) { b.x = 300; b.y = 240; return; }
    b.x = 90 + (i % 8) * 110; b.y = 110 + Math.floor(i / 8) * 260;
  });
  aim = { angle: 0.4 };
}

if (shot === 'roll') {
  // rola cada bola por um tempo diferente para mostrar a esfera girando
  const { simulate: sim } = await import('../js/physics.js');
  state.balls.forEach((b, i) => {
    if (b.number === 0) return;
    const col = (i - 1) % 8;
    const row = Math.floor((i - 1) / 8);
    b.x = 70 + col * 112;
    b.y = 150 + row * 190;
    b.vx = 0;
    b.vy = 0;
    b.om = { x: 0, y: 0, z: 0 };
  });
  state.balls.filter((b) => b.number > 0).forEach((b, i) => {
    b.vx = 60 + i * 8; // rola um pouco
    sim({ balls: [b], shot: null, cueSpent: true }, 0.25 + i * 0.06, createShotLog());
    b.vx = 0; b.vy = 0;
  });
  const cue = state.balls.find((b) => b.id === 'cue');
  cue.x = 620; cue.y = 470; cue.om = { x: 0, y: 0, z: 0 }; cue.q = [1,0,0,0,1,0,0,0,1];
  aim = { angle: 0.2 };
  for (let i = 0; i < 3; i++) particles.dust(220 + i * 150, 300, 1.2);
}

if (shot === 'sink') {
  const { simulate: sim } = await import('../js/physics.js');
  state.balls = state.balls.filter((b) => b.number === 0 || [9, 4, 12].includes(b.number));
  const cue = state.balls.find((b) => b.id === 'cue');
  cue.x = 520; cue.y = 300;
  const targets = state.balls.filter((b) => b.number !== 0);
  targets[0].x = 700; targets[0].y = 170;
  targets[1].x = 760; targets[1].y = 300;
  targets[2].x = 800; targets[2].y = 420;
  // manda uma bola para a caçapa e deixa a animação de afundar no meio
  targets[1].vx = 2400; targets[1].vy = 260;
  const log = createShotLog();
  sim(state, 0.42, log);
  for (const b of state.balls) { b.vx = 0; b.vy = 0; }
  for (let i = 0; i < 6; i++) particles.dust(700 + i * 20, 170, 0.9);
  particles.pocketDust(480, 468, 1.3);
  aim = { angle: 0.9 };
}

aim = { angle: aim.angle };
const guide = aimGuide(state, aim.angle);
renderer.draw({
  state, aim, guide, power: 0.66, showGuide: true, time: 1.4,
  pointer: shot === 'hand' ? { x: 330, y: 260 } : null, pointerValid: true,
  particles, strike: null,
});

const composed = createCanvas(W * 2, H * 2);
const cc = composed.getContext('2d');
cc.drawImage(bg.backing, 0, 0);
cc.drawImage(fg.backing, 0, 0);
let out = composed;
if (process.env.CROP) {
  const [cx, cy, cw, ch] = process.env.CROP.split(',').map(Number);
  const z = Number(process.env.ZOOM || 2);
  out = createCanvas(cw * z, ch * z);
  const zc = out.getContext('2d');
  zc.imageSmoothingQuality = 'high';
  zc.drawImage(composed, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
}
fs.mkdirSync('/tmp/shots', { recursive: true });
const file = `/tmp/shots/${shot}${process.env.SUFFIX || ''}.png`;
fs.writeFileSync(file, out.toBuffer('image/png'));
console.log('escrito', file, fs.statSync(file).size, 'bytes');
