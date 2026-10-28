import { createGame, startShot, resolveShot, placeCueBall } from '../js/rules.js';
import { simulate, createShotLog } from '../js/physics.js';
import { planAIShot } from '../js/ai.js';
const diff = process.argv[2]||'pro';
const reasons={}; let shots=0, fouls=0, potted=0, kinds={};
for (let g=0; g<6; g++) {
  const state = createGame({ mode:'ai' });
  state.players.forEach(p=>p.isAI=true);
  while (state.phase!=='gameover' && shots<400) {
    const plan = planAIShot(state, { difficulty: diff, player: state.turn });
    if (state.ballInHand && plan.placement) placeCueBall(state, plan.placement.x, plan.placement.y);
    kinds[plan.kind||'break']=(kinds[plan.kind||'break']||0)+1;
    startShot(state, plan);
    const log = createShotLog(); let t=0;
    while (simulate(state,1/60,log) && t<16) t+=1/60;
    const res = resolveShot(state, log);
    shots++; potted += res.pottedObjects.length;
    if (res.foul){ fouls++; reasons[res.foulReason]=(reasons[res.foulReason]||0)+1; }
  }
}
console.log(diff, {shots, fouls, potted, potRate:(potted/shots).toFixed(2)});
console.log('motivos', reasons);
console.log('tipos', kinds);
