/*
 * ai.js — adversário controlado pelo computador.
 *
 * Estratégia:
 *  1. calcula todos os encaixes possíveis (posição "fantasma" da branca,
 *     ângulo de corte, linha livre, dificuldade da caçapa);
 *  2. simula os melhores candidatos para confirmar que a bola entra;
 *  3. se não houver encaixe, joga uma "segurança" válida;
 *  4. aplica um erro de mira conforme a dificuldade escolhida — assim o
 *     jogador humano tem chance (as caçapas são muito justas).
 */

import { TABLE, BALL_R, BALL_D, PLAY_W, PLAY_H, isFreeSpot, groupOf } from './table.js';
import { powerToSpeed, powerForDistance, travelDistance, createShotLog, simulate } from './physics.js';
import { legalTargets, targetGroup, cueBall } from './rules.js';
import { pointSegmentDistance, clamp, randRange, randInt } from './util.js';

export const DIFFICULTIES = {
  easy: {
    name: 'Amador', angleErr: 0.019, powerErr: 0.14, candidates: 3,
    maxCutCos: 0.42, safetyBias: 0.5, mistakeChance: 0.22,
  },
  medium: {
    name: 'Intermediário', angleErr: 0.0105, powerErr: 0.09, candidates: 5,
    maxCutCos: 0.32, safetyBias: 0.3, mistakeChance: 0.12,
  },
  pro: {
    name: 'Profissional', angleErr: 0.0046, powerErr: 0.05, candidates: 7,
    maxCutCos: 0.26, safetyBias: 0.2, mistakeChance: 0.05,
  },
  legend: {
    name: 'Lenda', angleErr: 0.0022, powerErr: 0.03, candidates: 9,
    maxCutCos: 0.14, safetyBias: 0.1, mistakeChance: 0.0,
  },
};

/* ---------- modelo de atrito: distância percorrida por uma bola ---------- */
/* distância real aproximada a partir da velocidade (tabela invertida) */
function distanceForSpeed(v) {
  const d = travelDistance(v, 20);
  return d;
}

function pathClear(state, ax, ay, bx, by, ignoreIds, clearance = BALL_D + 0.35) {
  for (const b of state.balls) {
    if (b.pocketed || ignoreIds.includes(b.id)) continue;
    if (pointSegmentDistance(b.x, b.y, ax, ay, bx, by) < clearance) return false;
  }
  return true;
}

function insideTable(x, y, margin = BALL_R + 0.5) {
  return x > margin && x < PLAY_W - margin && y > margin && y < PLAY_H - margin;
}

/* ---------- catálogo de encaixes ---------- */
export function candidatePots(state, player = state.turn, opts = {}) {
  const cfg = opts.cfg || DIFFICULTIES.pro;
  const cue = cueBall(state);
  if (!cue || cue.pocketed) return [];
  const targets = legalTargets(state, player).filter((b) => b.number !== 0);
  const out = [];

  for (const t of targets) {
    for (const p of TABLE.pockets) {
      const aim = p.aim;
      const dx = aim.x - t.x;
      const dy = aim.y - t.y;
      const dTP = Math.hypot(dx, dy);
      if (dTP < BALL_R) continue;
      const ux = dx / dTP;
      const uy = dy / dTP;
      // posição fantasma: onde a branca precisa estar no momento do toque
      const gx = t.x - ux * BALL_D;
      const gy = t.y - uy * BALL_D;
      if (!insideTable(gx, gy, BALL_R * 0.75)) continue;

      const cdx = gx - cue.x;
      const cdy = gy - cue.y;
      const dCG = Math.hypot(cdx, cdy);
      if (dCG < BALL_D * 0.35) continue;
      const sx = cdx / dCG;
      const sy = cdy / dCG;
      const cosCut = sx * ux + sy * uy;
      if (cosCut < cfg.maxCutCos) continue;

      if (!pathClear(state, cue.x, cue.y, gx, gy, [cue.id, t.id])) continue;
      if (!pathClear(state, t.x, t.y, aim.x, aim.y, [t.id])) continue;

      // dificuldade: caçapa distante + corte fino + branca longe = ruim
      const pocketDist = dTP;
      const cutPenalty = Math.pow(cosCut, 2.1);
      const distPenalty = 1 / (1 + dCG / 520 + pocketDist / 900);
      const pocketBonus = p.type === 'corner' ? 1 : 0.96;
      let score = cutPenalty * distPenalty * pocketBonus;
      if (t.number === 8) score *= 1.35; // prioriza fechar o jogo

      // velocidade necessária
      // potência para chegar ao contato e ainda empurrar a bola até a caçapa
      const need = (dTP + 40) / Math.max(0.3, cosCut);
      const power = clamp(powerForDistance(dCG * 0.55 + need) * 1.06, 0.1, 1);
      if (power > 0.99) continue;
      score *= 1 - Math.max(0, power - 0.6) * 0.4;

      out.push({
        target: t.number,
        targetId: t.id,
        pocket: p.id,
        angle: Math.atan2(sy, sx),
        power,
        cutCos: cosCut,
        score,
        ghost: { x: gx, y: gy },
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ---------- validação por simulação ---------- */
function cloneForSim(state, shot) {
  const clone = {
    balls: state.balls.map((b) => ({ ...b, vx: 0, vy: 0 })),
    shot: { angle: shot.angle, power: shot.power, spin: shot.spin || { x: 0, y: 0 } },
    cueSpent: false,
  };
  const cue = clone.balls.find((b) => b.id === 'cue');
  const v = powerToSpeed(clamp(shot.power, 0.05, 1));
  cue.vx = Math.cos(shot.angle) * v;
  cue.vy = Math.sin(shot.angle) * v;
  const r = BALL_R;
  cue.om = { x: 0, y: 0, z: 0 };
  void r;
  return clone;
}

function simulatePreview(state, shot, maxT = 8) {
  const clone = cloneForSim(state, shot);
  const log = createShotLog();
  let t = 0;
  while (simulate(clone, 1 / 60, log) && t < maxT) t += 1 / 60;
  return { clone, log };
}

function firstHitLegal(state, shot, player) {
  const { log } = simulatePreview(state, shot);
  if (log.cuePocketed || log.firstHit === null) return false;
  const first = state.balls.find((b) => b.id === log.firstHit);
  if (!first) return false;
  const tg = targetGroup(state, player);
  if (tg === 'eight') return first.number === 8;
  if (tg === 'open') return first.number !== 8;
  return groupOf(first.number) === tg;
}

function shotIsGood(state, shot, player, wantedNumber) {
  const { log } = simulatePreview(state, shot);
  if (log.cuePocketed) return false;
  if (log.firstHit === null) return false;
  const first = state.balls.find((b) => b.id === log.firstHit);
  if (!first) return false;
  const tg = targetGroup(state, player);
  if (tg === 'eight' && first.number !== 8) return false;
  if (tg === 'open' && first.number === 8) return false;
  if (tg !== 'eight' && tg !== 'open' && groupOf(first.number) !== tg) return false;
  const potted = log.pocketed.map((id) => state.balls.find((b) => b.id === id)).filter(Boolean);
  const eight = potted.find((b) => b.number === 8);
  if (eight) return tg === 'eight';
  if (!potted.length) return false;
  // prefere encaixapar exatamente a bola que estava sendo mirada
  if (wantedNumber !== undefined && !potted.some((b) => b.number === wantedNumber)) {
    return potted.length > 0 ? false : false;
  }
  return true;
}

/* ---------- segurança ---------- */
function checkSafety(state, shot, player) {
  const { log } = simulatePreview(state, shot);
  if (log.cuePocketed) return { ok: false, score: -100, log };
  if (log.firstHit === null) return { ok: false, score: -50, log };
  const first = state.balls.find((b) => b.id === log.firstHit);
  if (!first) return { ok: false, score: -50, log };
  const tg = targetGroup(state, player);
  const legalFirst = tg === 'eight'
    ? first.number === 8
    : tg === 'open'
      ? first.number !== 8
      : groupOf(first.number) === tg;
  const potted = log.pocketed.map((id) => state.balls.find((b) => b.id === id)).filter(Boolean);
  const eight = potted.some((b) => b.number === 8);
  let score = legalFirst ? 10 : 0;
  if (log.cushionsAfterContact) score += 4;
  if (potted.length) score += 3;
  if (eight && tg !== 'eight') score -= 100;
  const ok = legalFirst && log.cushionsAfterContact && !eight;
  return { ok, score, log, potted };
}

function safetyShot(state, player) {
  const cue = cueBall(state);
  const targets = legalTargets(state, player).filter((b) => b.number !== 0);
  if (!cue || !targets.length) return null;
  const tg = targetGroup(state, player);

  const options = [];
  for (const t of targets) {
    const d = Math.hypot(t.x - cue.x, t.y - cue.y);
    const ang = Math.atan2(t.y - cue.y, t.x - cue.x);
    const clear = pathClear(state, cue.x, cue.y, t.x, t.y, [cue.id, t.id], BALL_D - 2);
    options.push({ angle: ang, d, target: t, clear });
  }
  options.sort((a, b) => (Number(b.clear) - Number(a.clear)) || a.d - b.d);

  let best = null;
  let sims = 0;
  const jitters = [0, 0.015, -0.015, 0.04, -0.04, 0.09, -0.09, 0.16, -0.16];
  for (const o of options.slice(0, 5)) {
    for (const jitter of jitters) {
      for (const extra of [0, 0.12, 0.26]) {
        if (sims++ > 42) break;
        const shot = {
          angle: o.angle + jitter,
          power: clamp(powerForDistance(o.d) + 0.2 + extra, 0.16, 0.95),
          spin: { x: 0, y: 0 },
          kind: 'safety',
        };
        const chk = checkSafety(state, shot, player);
        if (!best || chk.score > best.score) best = { score: chk.score, shot };
        if (chk.ok) return shot;
      }
    }
  }
  if (best && best.score > -50) return best.shot;
  if (tg === 'eight' && options.length) return { angle: options[0].angle, power: 0.45, spin: { x: 0, y: 0 }, kind: 'safety' };
  return {
    angle: options.length ? options[0].angle : randRange(0, Math.PI * 2),
    power: 0.4,
    spin: { x: 0, y: 0 },
    kind: 'safety',
  };
}

/* ---------- posicionamento da branca na mão ---------- */
function findPlacement(state, player, cfg) {
  const cue = cueBall(state);
  let best = null;
  const probe = {
    ...state,
    balls: state.balls.map((b) => (b.id === 'cue' ? { ...b, pocketed: false, x: cue.x, y: cue.y } : b)),
  };
  for (let gx = 0; gx < 22; gx++) {
    for (let gy = 0; gy < 12; gy++) {
      const x = BALL_R * 2 + (gx / 21) * (PLAY_W - BALL_R * 4);
      const y = BALL_R * 2 + (gy / 11) * (PLAY_H - BALL_R * 4);
      if (!isFreeSpot(state, x, y)) continue;
      const c = probe.balls.find((b) => b.id === 'cue');
      c.x = x;
      c.y = y;
      const pots = candidatePots(probe, player, { cfg });
      if (!pots.length) continue;
      const top = pots.slice(0, 3).reduce((s, p) => Math.max(s, p.score), 0);
      if (!best || top > best.score) best = { x, y, score: top, shot: pots[0] };
    }
  }
  return best;
}

/**
 * Planeja a jogada do computador.
 * Retorna { angle, power, spin, placement? }
 */
export function planAIShot(state, { difficulty = 'pro', player = state.turn } = {}) {
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.pro;
  const cue = cueBall(state);
  if (!cue) return { angle: 0, power: 0.5, spin: { x: 0, y: 0 } };

  let placement = null;
  if (state.ballInHand) {
    const spot = findPlacement(state, player, cfg);
    if (spot) {
      placement = { x: spot.x, y: spot.y };
      cue.x = spot.x;
      cue.y = spot.y;
      cue.pocketed = false;
    }
  }

  /* quebra */
  if (state.breakShot) {
    const apexTarget = state.balls.filter((b) => b.number !== 0 && !b.pocketed)
      .reduce((a, b) => (a.x < b.x ? a : b));
    const ang = Math.atan2(apexTarget.y - cue.y + randRange(-3, 3), apexTarget.x - cue.x);
    return {
      angle: ang + randRange(-0.006, 0.006),
      power: randRange(0.62, 0.8),
      spin: { x: 0, y: randRange(-0.15, 0.25) },
      placement,
    };
  }

  const pots = candidatePots(state, player, { cfg });
  const tested = pots.slice(0, cfg.candidates);

  // chance de "errar a leitura" (jogador humano também erra)
  if (tested.length && Math.random() < cfg.mistakeChance) {
    tested.splice(0, 1);
  }

  for (const shot of tested) {
    // ajusta a força até a bola entrar de verdade (a simulação confirma)
    let valid = null;
    for (const mult of [1.14, 1.3, 1.02, 1.5, 0.95]) {
      const trial = { ...shot, power: clamp(shot.power * mult, 0.08, 1) };
      if (shotIsGood(state, trial, player, shot.target)) { valid = trial; break; }
    }
    if (!valid) continue;
    const chosen = valid;
    let candidate = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const err = cfg.angleErr * (1 + Math.random() * 1.6) * (attempt ? 0.55 : 1);
      candidate = {
        angle: chosen.angle + randRange(-err, err),
        power: clamp(chosen.power + randRange(-cfg.powerErr, cfg.powerErr), 0.1, 1),
        spin: { x: randRange(-0.12, 0.12), y: randRange(-0.2, 0.25) },
        placement,
        kind: 'pot',
        target: shot.target,
        pocket: shot.pocket,
      };
      if (firstHitLegal(state, candidate, player)) break;
    }
    return candidate;
  }

  const safe = safetyShot(state, player);
  if (safe) return { ...safe, placement };
  return { angle: randRange(0, Math.PI * 2), power: 0.3, spin: { x: 0, y: 0 }, placement, kind: 'desperate' };
}

/* ============================================================
 * MIRA — traçado de raio com colisão real
 * Devolve o primeiro obstáculo no caminho da bola branca (bola,
 * caçapa ou tabela), a posição da "bola fantasma" no contato e a
 * direção que a bola alvo vai tomar.
 * ============================================================ */
export function aimGuide(state, angle) {
  const cue = cueBall(state);
  if (!cue) return null;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const startX = cue.x;
  const startY = cue.y;
  const R2 = BALL_D * BALL_D;

  let bestT = Infinity;
  let hitBall = null;

  for (const b of state.balls) {
    if (b.pocketed || b.id === 'cue') continue;
    const ox2 = b.x - startX;
    const oy2 = b.y - startY;
    const proj = ox2 * dx + oy2 * dy;
    if (proj < -BALL_D) continue;
    const perp2 = ox2 * ox2 + oy2 * oy2 - proj * proj;
    if (perp2 > R2) continue;
    const t = proj - Math.sqrt(Math.max(0, R2 - perp2));
    if (t > 0 && t < bestT) {
      bestT = t;
      hitBall = b;
    }
  }

  // caçapas: a bola branca pode cair direto
  let pocketHit = null;
  let pocketT = Infinity;
  for (const p of TABLE.pockets) {
    const ox2 = p.center.x - startX;
    const oy2 = p.center.y - startY;
    const proj = ox2 * dx + oy2 * dy;
    if (proj < 0) continue;
    const perp2 = ox2 * ox2 + oy2 * oy2 - proj * proj;
    const rad = p.reach * 0.65;
    if (perp2 > rad * rad) continue;
    const t = proj - Math.sqrt(Math.max(0, rad * rad - perp2));
    if (t > 0 && t < pocketT) {
      pocketT = t;
      pocketHit = p;
    }
  }

  // tabelas (retângulo interno deslocado pelo raio da bola)
  const minX = BALL_R;
  const maxX = PLAY_W - BALL_R;
  const minY = BALL_R;
  const maxY = PLAY_H - BALL_R;
  let wallT = Infinity;
  let wallNormal = { x: 0, y: 0 };
  if (dx > 1e-6) {
    const t = (maxX - startX) / dx;
    if (t > 0 && t < wallT) { wallT = t; wallNormal = { x: -1, y: 0 }; }
  } else if (dx < -1e-6) {
    const t = (minX - startX) / dx;
    if (t > 0 && t < wallT) { wallT = t; wallNormal = { x: 1, y: 0 }; }
  }
  if (dy > 1e-6) {
    const t = (maxY - startY) / dy;
    if (t > 0 && t < wallT) { wallT = t; wallNormal = { x: 0, y: -1 }; }
  } else if (dy < -1e-6) {
    const t = (minY - startY) / dy;
    if (t > 0 && t < wallT) { wallT = t; wallNormal = { x: 0, y: 1 }; }
  }

  const t = Math.min(bestT, pocketT, wallT);
  const x = startX + dx * t;
  const y = startY + dy * t;

  if (hitBall && bestT <= pocketT && bestT <= wallT) {
    // (x, y) já é o centro da bola fantasma no instante do toque
    const ghostX = x;
    const ghostY = y;
    const odx = hitBall.x - ghostX;
    const ody = hitBall.y - ghostY;
    const ol = Math.hypot(odx, ody) || 1;
    const ux = odx / ol;
    const uy = ody / ol;
    // a trajetória da bola alvo leva a uma caçapa?
    let pocketLine = false;
    for (const p of TABLE.pockets) {
      const vx = p.aim.x - hitBall.x;
      const vy = p.aim.y - hitBall.y;
      const vl = Math.hypot(vx, vy) || 1;
      const dot = (vx / vl) * ux + (vy / vl) * uy;
      if (dot > 0.93) { pocketLine = true; break; }
    }
    return {
      x, y, hitBall, hitPocket: null, pocketLine,
      ghost: { x: ghostX, y: ghostY },
      objectDir: { x: ux, y: uy },
    };
  }

  if (pocketHit && pocketT <= bestT && pocketT <= wallT) {
    return { x, y, hitBall: null, hitPocket: pocketHit, pocketLine: false };
  }

  // rebate na tabela
  const bx = x + dx * 220;
  const by = y + dy * 220;
  const rdx = wallNormal.x !== 0 ? -dx : dx;
  const rdy = wallNormal.y !== 0 ? -dy : dy;
  return {
    x, y, hitBall: null, hitPocket: null, pocketLine: false,
    bounce: { x: x + rdx * 220, y: y + rdy * 220 },
    wallNormal,
    _bx: bx, _by: by,
  };
}

export { randInt };
