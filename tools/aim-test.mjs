/*
 * Valida a mira de verdade: para cada encaixe possível, aponta a branca na
 * bola fantasma, compara a direção que a MIRA prevê para a bola alvo com a
 * direção que a FÍSICA produz, e confere se a bola entra na caçapa.
 */
import { createGame, startShot, makeBall } from '../js/rules.js';
import { aimGuide } from '../js/ai.js';
import { simulate, createShotLog, powerForDistance } from '../js/physics.js';
import { TABLE } from '../js/table.js';

const cases = [
  [200, 240, 520, 240],
  [250, 130, 610, 300],
  [180, 360, 700, 170],
  [400, 300, 700, 300],
  [300, 400, 620, 250],
  [360, 240, 760, 300],
];

let ok = 0;
let attempted = 0;
for (const [cx, cy, ox, oy] of cases) {
  const st = createGame({ mode: 'ai' });
  st.balls = [makeBall('cue', 0, cx, cy), makeBall('b2', 2, ox, oy)];
  const ob = st.balls[1];

  // escolhe a caçapa com o corte mais confortável (a bola tem que ser vista de frente)
  let best = null;
  for (const p of TABLE.pockets) {
    const ux = p.aim.x - ox;
    const uy = p.aim.y - oy;
    const ul = Math.hypot(ux, uy);
    const vx = cx - ox;
    const vy = cy - oy;
    const vl = Math.hypot(vx, vy);
    const dot = (ux / ul) * (vx / vl) + (uy / ul) * (vy / vl);
    const cut = dot; // > 0 significa corte impossível
    if (cut > -0.15) continue;
    const score = -cut * ul;
    if (!best || score > best.score) best = { p, ux: ux / ul, uy: uy / ul, ul, score };
  }
  if (!best) { console.log('caso sem corte possível'); continue; }

  const ghost = { x: ox - best.ux * 24, y: oy - best.uy * 24 };
  const angle = Math.atan2(ghost.y - cy, ghost.x - cx);
  const g = aimGuide(st, angle);
  const predicted = g && g.objectDir;

  const power = Math.min(1, powerForDistance(best.ul + Math.hypot(ghost.x - cx, ghost.y - cy)) * 1.3);
  startShot(st, { angle, power });
  const log = createShotLog();
  let t = 0;
  let after = null;
  const before = { x: ob.x, y: ob.y };
  while (simulate(st, 1 / 120, log) && t < 10) {
    t += 1 / 120;
    if (!after && log.firstHit) after = { x: ob.x, y: ob.y };
  }
  // direção real que a bola alvo tomou depois do toque
  const moved = { x: ob.x - (after ? after.x : before.x), y: ob.y - (after ? after.y : before.y) };
  const ml = Math.hypot(moved.x, moved.y) || 1;
  const realDir = { x: moved.x / ml, y: moved.y / ml };
  const dot = predicted ? predicted.x * realDir.x + predicted.y * realDir.y : -1;
  const potted = log.pocketed.includes('b2');
  attempted++;
  const sameDir = dot > 0.97;
  if (potted && sameDir) ok++;
  console.log(
    `caso ${attempted}: mira→bola ${g?.hitBall?.number ?? '-'} | direção prevista ` +
    `(${predicted ? predicted.x.toFixed(2) : '?'},${predicted ? predicted.y.toFixed(2) : '?'}) ` +
    `× real (${realDir.x.toFixed(2)},${realDir.y.toFixed(2)}) = ${dot.toFixed(3)} | encaçapou=${potted}`,
  );
}
console.log(`\nmira correta (direção + encaixe) em ${ok}/${attempted} casos`);
