import { createGame, startShot, resolveShot, placeCueBall, targetGroup, cueBall } from '../js/rules.js';
import { simulate, createShotLog } from '../js/physics.js';
import { planAIShot, DIFFICULTIES } from '../js/ai.js';

const diff = process.argv[2] || 'pro';
const games = Number(process.argv[3] || 3);
let totalShots=0, finished=0, fouls=0, pots=0, tPlan=0;
for (let g=0; g<games; g++) {
  const state = createGame({ mode:'ai', difficulty: diff });
  state.players[1].isAI = true; state.players[0].isAI = true;
  let shots=0;
  while (state.phase !== 'gameover' && shots < 200) {
    const t0 = performance.now();
    const plan = planAIShot(state, { difficulty: diff, player: state.turn });
    tPlan += performance.now()-t0;
    if (state.ballInHand && plan.placement) {
      const ok = placeCueBall(state, plan.placement.x, plan.placement.y);
      if (!ok) { // fallback: procura
        let placed=false;
        for (let i=0;i<300 && !placed;i++) placed = placeCueBall(state, 100+Math.random()*700, 40+Math.random()*400);
        if (!placed) { console.log('NAO ACHOU LUGAR'); break; }
      }
    }
    startShot(state, plan);
    const log = createShotLog();
    let t=0;
    while (simulate(state, 1/60, log) && t < 16) t += 1/60;
    const res = resolveShot(state, log);
    shots++; totalShots++;
    if (res.foul) fouls++;
    pots += res.pottedObjects.length;
    if (state.phase !== 'gameover' && (state.phase === 'ballinhand')) {
      // ok, handled next iteration
    }
  }
  finished += state.phase === 'gameover' ? 1 : 0;
  console.log(`jogo ${g+1}: ${state.phase} winner=${state.winner} shots=${shots} reason="${state.winnerReason}" jogadores=${JSON.stringify(state.players.map(p=>p.group))}`);
}
console.log(`diff=${diff} jogos=${games} finalizados=${finished} tacadas=${totalShots} faltas=${fouls} bolas=${pots} tempoIA=${(tPlan/games/totalShots*games).toFixed(1)}ms/tacada`);
