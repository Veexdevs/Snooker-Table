/* Valida: curva de força, distâncias, efeito (draw/follow) e rolagem. */
import { createGame, startShot, cueBall } from '../js/rules.js';
import { simulate, createShotLog, powerToSpeed, isMoving } from '../js/physics.js';
import { PLAY_H, TABLE } from '../js/table.js';

function run(state, opts) {
  startShot(state, opts);
  const log = createShotLog();
  let t = 0;
  while (simulate(state, 1 / 120, log) && t < 30) t += 1 / 120;
  return { log, t, cue: { ...cueBall(state) } };
}

const table = [];
const savedWalls = TABLE.walls.splice(0, TABLE.walls.length);
const savedPockets = TABLE.pockets.splice(0, TABLE.pockets.length);
for (const p of [0.1, 0.2, 0.3, 0.5, 0.7, 1]) {
  const state = createGame({ mode: 'ai' });
  // só a branca na mesa para medir a distância
  state.balls = state.balls.filter((b) => b.id === 'cue');
  const cue = cueBall(state);
  cue.x = 60; cue.y = PLAY_H / 2;
  const start = performance.now();
  const r = run(state, { angle: 0, power: p, spin: { x: 0, y: 0 } });
  table.push({ power: p, speed: Math.round(powerToSpeed(p)), dist: Math.round(cue.x - 60), teto: (((cue.x - 60) / 960)).toFixed(2), tempo: r.t.toFixed(2), ms: Math.round(performance.now() - start) });
}
TABLE.walls.push(...savedWalls);
TABLE.pockets.push(...savedPockets);
console.log('força → distância (mesa tem 960 de comprimento)');
for (const row of table) console.log(' ', JSON.stringify(row));

/* efeito: bate de frente numa bola e vê se a branca volta (draw) ou segue (follow) */
function spinTest(spinY) {
  const state = createGame({ mode: 'ai' });
  state.balls = state.balls.filter((b) => b.id === 'cue' || b.number === 1);
  const cue = cueBall(state);
  const obj = state.balls.find((b) => b.number === 1);
  cue.x = 300; cue.y = 240;
  obj.x = 500; obj.y = 240;
  startShot(state, { angle: 0, power: 0.33, spin: { x: 0, y: spinY } });
  const log = createShotLog();
  let t = 0;
  while (simulate(state, 1 / 120, log) && t < 20) t += 1 / 120;
  return { brancaX: Math.round(cue.x), alvoX: Math.round(obj.x), brancaAndou: Math.round(cue.x - 300) };
}
console.log('efeito (branca começa em x=300, alvo em x=500):');
console.log('  fundo (draw −1):', JSON.stringify(spinTest(-1)));
console.log('  centro (0):     ', JSON.stringify(spinTest(0)));
console.log('  topo (follow +1):', JSON.stringify(spinTest(1)));

/* rolagem: orientação muda e continua unitária */
const state = createGame({ mode: 'ai' });
state.balls = state.balls.filter((b) => b.id === 'cue');
const cue = cueBall(state);
cue.x = 100; cue.y = 240;
startShot(state, { angle: 0, power: 0.45, spin: { x: 0.4, y: 0.2 } });
const log = createShotLog();
let t = 0;
const q0 = cue.q.slice();
while (simulate(state, 1 / 120, log) && t < 20) t += 1 / 120;
const q1 = cue.q;
const det = q1[0] * (q1[4] * q1[8] - q1[5] * q1[7]) - q1[1] * (q1[3] * q1[8] - q1[5] * q1[6]) + q1[2] * (q1[3] * q1[7] - q1[4] * q1[6]);
console.log('rolagem: orientação mudou?', q0.some((v, i) => Math.abs(v - q1[i]) > 0.01), '| determinante (deve ser 1):', det.toFixed(3));
console.log('parou?', !isMoving(state));
