/*
 * rules.js — regras do 8-ball (bola 8 americana), no espírito das regras
 * WPA usadas nos jogos de pool profissionais.
 *
 * Resumo:
 *  • quebra válida: uma bola na caçapa ou 4 bolas tocando tabela;
 *  • mesa aberta depois da quebra; grupos definidos na primeira bola
 *    legal embolsada (lisas 1–7 / listradas 9–15);
 *  • falta: branca na caçapa, não tocar em bola, primeira bola errada,
 *    não haver tabela depois do contato, quebra inválida;
 *  • falta = bola na mão para o adversário;
 *  • bola 8 só pode ser embolsada depois de limpar o próprio grupo;
 *    caso contrário, derrota.
 */

import { TABLE, SPOT_FOOT, BALL_R, PLAY_W, PLAY_H, groupOf, isFreeSpot, randomFreeSpot } from './table.js';
import { createRack, powerToSpeed, identityQ } from './physics.js';

export const GROUPS = { solid: 'lisas', stripe: 'listradas', eight: 'bola 8' };

export function makeBall(id, number, x, y) {
  return {
    id, number, x, y, vx: 0, vy: 0, pocketed: false, pocketId: null,
    om: { x: 0, y: 0, z: 0 },          // velocidade angular (rad/s)
    q: identityQ(),                    // orientação (matriz 3x3)
    sinkT: 1, sinkSpeed: 0, sinkFromX: x, sinkFromY: y,
    group: groupOf(number),
  };
}

export function createGame({ mode = 'ai', difficulty = 'pro', names = ['Você', 'Adversário'] } = {}) {
  const state = {
    mode,
    difficulty,
    balls: [],
    players: [
      { id: 0, name: names[0], group: null, isAI: false, wins: 0 },
      { id: 1, name: names[1], group: null, isAI: mode === 'ai', wins: 0 },
    ],
    turn: 0,
    open: true,
    breakShot: true,
    phase: 'aim',          // aim | shooting | ballinhand | gameover
    ballInHand: false,
    winner: null,
    winnerReason: '',
    message: 'Você quebra. Mira com o mouse e solta para tacar.',
    log: null,
    shot: { angle: 0, power: 0, spin: { x: 0, y: 0 } },
    cueSpent: false,
    shots: 0,
    stats: { potted: 0, fouls: 0, bestStreak: 0, streak: 0, powers: [] },
    rackCount: 0,
    lastShotResult: null,
  };
  rack(state);
  return state;
}

export function rack(state) {
  state.balls = [];
  state.players.forEach((p) => { p.group = null; });
  state.open = true;
  state.breakShot = true;
  state.cueSpent = false;

  const order = createRack();
  const cue = makeBall('cue', 0, PLAY_W * 0.25, PLAY_H / 2);
  state.balls.push(cue);

  // triângulo
  for (let i = 0; i < 15; i++) {
    const { x, y } = rackSlot(i);
    state.balls.push(makeBall(`b${order[i]}`, order[i], x, y));
  }
  state.rackCount++;
  state.phase = 'aim';
  state.turn = 0;
  state.ballInHand = false;
  state.winner = null;
}

/* posições do triângulo com um pequeno afastamento para não nascerem
   sobrepostas (a física resolve o resto) */
function rackSlot(i) {
  const BALL_D = BALL_R * 2;
  const apex = SPOT_FOOT;
  const ROW_GAP = BALL_D * 0.868;
  const COL_GAP = BALL_D * 0.999;
  let idx = i;
  let row = 0;
  while (row < 5 && idx > row) {
    idx -= row + 1;
    row++;
  }
  const iInRow = idx;
  return {
    x: apex.x + row * ROW_GAP,
    y: apex.y + (iInRow - row / 2) * COL_GAP,
  };
}

export function cueBall(state) {
  return state.balls.find((b) => b.id === 'cue');
}

export function activeBalls(state) {
  return state.balls.filter((b) => !b.pocketed);
}

export function groupBalls(state, group) {
  return state.balls.filter((b) => !b.pocketed && b.group === group);
}

export function opponentOf(state, player = state.turn) {
  return 1 - player;
}

/* qual grupo o jogador precisa acertar agora */
export function targetGroup(state, player = state.turn) {
  const p = state.players[player];
  if (p.group) {
    return groupBalls(state, p.group).length ? p.group : 'eight';
  }
  return state.open ? 'open' : 'eight';
}

export function legalTargets(state, player = state.turn) {
  const tg = targetGroup(state, player);
  if (tg === 'open') return state.balls.filter((b) => !b.pocketed && b.number !== 8 && b.number !== 0);
  if (tg === 'eight') return state.balls.filter((b) => b.number === 8 && !b.pocketed);
  return groupBalls(state, tg);
}

export function startShot(state, {
  angle, power, spin = { x: 0, y: 0 }, powerMult = 1, spinMult = 1,
}) {
  const cue = cueBall(state);
  if (!cue || cue.pocketed) return false;
  // foto do estado ANTES da tacada: as regras dependem dela
  const g = state.players[state.turn].group;
  state.preShot = {
    groups: state.players.map((p) => p.group),
    open: state.open,
    breakShot: state.breakShot,
    cleared: g ? groupBalls(state, g).length === 0 : false,
  };
  const effPower = Math.max(0.02, Math.min(1, power * powerMult));
  state.shot = { angle, power, effPower, spin };
  state.cueSpent = false;
  state.phase = 'shooting';
  state.ballInHand = false;

  const v = powerToSpeed(effPower);
  cue.vx = Math.cos(angle) * v;
  cue.vy = Math.sin(angle) * v;

  // efeito: topo/fundo + lateral viram velocidade angular real
  const r = BALL_R;
  const sy = Math.max(-1, Math.min(1, spin.y * spinMult));
  const sx = Math.max(-1, Math.min(1, spin.x * spinMult));
  const roll = v / r;
  // centro (0) → a bola desliza e "pega" rolagem sozinha;
  // topo (+1) → gira além da rolagem (follow); fundo (−1) → gira ao contrário (draw)
  const spinFactor = sy >= 0 ? sy * 2.1 : sy * 0.85;
  cue.om.x = (-cue.vy / (v || 1)) * roll * spinFactor;
  cue.om.y = (cue.vx / (v || 1)) * roll * spinFactor;
  cue.om.z = sx * roll * 0.7;

  state.shots++;
  state.stats.powers.push(effPower);
  return true;
}

/* reposiciona a bola 8 no pé da mesa (quando embolsada na quebra) */
export function respotEight(state) {
  const eight = state.balls.find((b) => b.number === 8);
  if (!eight || !eight.pocketed) return;
  let spot = { x: SPOT_FOOT.x, y: SPOT_FOOT.y };
  if (!isFreeSpot(state, spot.x, spot.y)) {
    outer:
    for (let r = 1; r < 40; r++) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const x = SPOT_FOOT.x + Math.cos(ang) * r * 4;
        const y = SPOT_FOOT.y + Math.sin(ang) * r * 4;
        if (x > BALL_R && x < PLAY_W - BALL_R && y > BALL_R && y < PLAY_H - BALL_R &&
            isFreeSpot(state, x, y, eight.id)) {
          spot = { x, y };
          break outer;
        }
      }
    }
  }
  eight.pocketed = false;
  eight.pocketId = null;
  eight.x = spot.x;
  eight.y = spot.y;
  eight.vx = 0;
  eight.vy = 0;
  eight.om = { x: 0, y: 0, z: 0 };
  eight.sinkT = 1;
}

/**
 * Avalia a tacada já simulada.
 * Retorna um resumo que o jogo usa para decidir de quem é a vez.
 */
export function resolveShot(state, log) {
  const shooter = state.turn;
  const player = state.players[shooter];
  const pre = state.preShot || {
    groups: state.players.map((p) => p.group),
    open: state.open,
    breakShot: state.breakShot,
    cleared: false,
  };
  const group = pre.groups[shooter];
  const pottedNumbers = log.pocketed
    .map((id) => state.balls.find((b) => b.id === id))
    .filter(Boolean)
    .map((b) => b.number);

  const pottedObjects = pottedNumbers.filter((n) => n > 0);
  const eightPotted = pottedNumbers.includes(8);
  const cuePotted = log.cuePocketed;

  const res = {
    shooter,
    pottedNumbers,
    pottedObjects,
    foul: false,
    foulReason: '',
    continueTurn: false,
    gameOver: false,
    winner: null,
    message: '',
    groupAssigned: null,
    eightRespot: false,
  };

  const wasBreak = pre.breakShot;

  /* ---------- faltas ---------- */
  if (cuePotted) {
    res.foul = true;
    res.foulReason = 'bola branca na caçapa';
  } else if (log.firstHit === null) {
    res.foul = true;
    res.foulReason = 'não encostou em nenhuma bola';
  } else {
    // primeira bola precisa ser do grupo correto
    const firstBall = state.balls.find((b) => b.id === log.firstHit) || null;
    const firstGroup = firstBall ? firstBall.group : null;
    const tg = group ? (pre.cleared ? 'eight' : group) : 'open';
    const needEight = tg === 'eight';
    const openTable = tg === 'open';
    if (!firstBall) {
      res.foul = true;
      res.foulReason = 'primeira bola inválida';
    } else if (needEight && firstGroup !== 'eight') {
      res.foul = true;
      res.foulReason = 'primeira bola deveria ser a 8';
    } else if (openTable && firstGroup === 'eight') {
      res.foul = true;
      res.foulReason = 'não pode começar pela bola 8';
    } else if (!openTable && !needEight && firstGroup !== tg) {
      res.foul = true;
      res.foulReason = `primeira bola deveria ser ${GROUPS[tg]}`;
    }
  }

  if (!res.foul) {
    if (wasBreak) {
      const pottedSomething = pottedObjects.length > 0;
      const cushionBalls = log.cushionBalls || 0;
      if (!pottedSomething && cushionBalls < 4) {
        res.foul = true;
        res.foulReason = 'quebra inválida (menos de 4 bolas na tabela)';
      }
    } else if (pottedObjects.length === 0 && !log.cushionsAfterContact) {
      res.foul = true;
      res.foulReason = 'nenhuma bola tocou a tabela';
    }
  }

  /* ---------- bola 8 ---------- */
  const clearedOwn = group ? pre.cleared : false;

  if (eightPotted) {
    if (wasBreak) {
      res.eightRespot = true;
    } else if (!clearedOwn || res.foul) {
      res.gameOver = true;
      res.winner = opponentOf(state, shooter);
      res.message = res.foul
        ? `Falta ao embolsar a 8 (${res.foulReason}).`
        : 'Embolsou a 8 antes de limpar o grupo.';
    } else {
      res.gameOver = true;
      res.winner = shooter;
      res.message = 'Bola 8! Vitória.';
    }
  }

  /* ---------- atribuição de grupo (mesa aberta) ---------- */
  if (!res.foul && pre.open && !wasBreak && !eightPotted) {
    const firstPotted = pottedNumbers.find((n) => n > 0 && n !== 8);
    if (firstPotted !== undefined) {
      const g = groupOf(firstPotted);
      player.group = g;
      state.players[opponentOf(state, shooter)].group = g === 'solid' ? 'stripe' : 'solid';
      state.open = false;
      res.groupAssigned = g;
    }
  }

  /* ---------- continuar ou trocar ---------- */
  if (!res.gameOver) {
    const gotOwn = group
      ? pottedNumbers.some((n) => groupOf(n) === group)
      : pottedObjects.some((n) => n !== 8);
    const gotEightBallCase = clearedOwn && eightPotted;
    res.continueTurn = !res.foul && (gotOwn || gotEightBallCase);
    if (res.foul) {
      res.message = `Falta: ${res.foulReason}.`;
    } else if (res.continueTurn) {
      res.message = pottedObjects.length
        ? `Boa! ${pottedObjects.length} bola${pottedObjects.length > 1 ? 's' : ''} na caçapa — continua.`
        : 'Continua na mesa.';
    } else {
      res.message = 'Vez do adversário.';
    }
  }

  /* ---------- efeitos de estado ---------- */
  state.breakShot = false;
  if (res.eightRespot) respotEight(state);
  if (cuePotted) {
    const cue = cueBall(state);
    const spot = randomFreeSpot(state, PLAY_W * 0.08, PLAY_W * 0.42);
    cue.x = spot.x;
    cue.y = spot.y;
    cue.vx = 0;
    cue.vy = 0;
    cue.pocketed = false;
    cue.pocketId = null;
    cue.sinkT = 1;
    cue.om = { x: 0, y: 0, z: 0 };
    state.ballInHand = true;
  } else if (res.foul) {
    state.ballInHand = true;
  }

  if (res.gameOver) {
    state.phase = 'gameover';
    state.winner = res.winner;
    state.winnerReason = res.message;
    state.ballInHand = false;
    state.players[res.winner].wins++;
  } else {
    if (!res.continueTurn) state.turn = opponentOf(state, shooter);
    state.ballInHand = res.foul;
    state.phase = state.ballInHand ? 'ballinhand' : 'aim';
  }

  // estatísticas
  if (res.foul) state.stats.fouls++;
  state.stats.potted += pottedObjects.length;
  if (res.continueTurn) {
    state.stats.streak++;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
  } else {
    state.stats.streak = 0;
  }

  state.message = res.message;
  state.lastShotResult = res;
  return res;
}

/* coloca a bola branca na mão — só em posição livre, dentro da mesa */
export function placeCueBall(state, x, y) {
  if (!state.ballInHand) return false;
  const cx = Math.max(BALL_R, Math.min(PLAY_W - BALL_R, x));
  const cy = Math.max(BALL_R, Math.min(PLAY_H - BALL_R, y));
  if (!isFreeSpot(state, cx, cy)) return false;
  const cue = cueBall(state);
  cue.x = cx;
  cue.y = cy;
  cue.vx = 0;
  cue.vy = 0;
  cue.om = { x: 0, y: 0, z: 0 };
  cue.pocketed = false;
  cue.pocketId = null;
  cue.sinkT = 1;
  state.ballInHand = false;
  state.phase = 'aim';
  return true;
}

export function pocketedList(state, player = state.turn) {
  const p = state.players[player];
  const g = p.group;
  const mine = [];
  const theirs = [];
  for (const b of state.balls) {
    if (!b.pocketed || b.number === 0) continue;
    if (b.number === 8) continue;
    if (!g || groupOf(b.number) === g) mine.push(b.number);
    else theirs.push(b.number);
  }
  return { mine, theirs };
}

export { TABLE };
