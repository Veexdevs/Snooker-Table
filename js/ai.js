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
import { MAX_SHOT_SPEED, createShotLog, simulate } from './physics.js';
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
const DRAG = 0.9;
const DECEL = 35;
function distanceForSpeed(v) {
  if (v <= 0) return 0;
  return (1 / DRAG) * (v - (DECEL / DRAG) * Math.log((DRAG * v + DECEL) / DECEL));
}
function speedForDistance(d) {
  if (d <= 0) return 0;
  let lo = 0;
  let hi = MAX_SHOT_SPEED * 1.4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (distanceForSpeed(mid) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
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
      const needAtContact = (speedForDistance(dTP + 40) / Math.max(0.28, cosCut)) * 1.14;
      const v0 = speedForDistance(distanceForSpeed(needAtContact) + dCG);
      const power = clamp(v0 / MAX_SHOT_SPEED, 0.12, 0.98);
      if (power > 0.95) continue;
      score *= 1 - Math.max(0, power - 0.6) * 0.5;

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
  const v = clamp(shot.power, 0.05, 1) * MAX_SHOT_SPEED;
  cue.vx = Math.cos(shot.angle) * v;
  cue.vy = Math.sin(shot.angle) * v;
  return clone;
}

function simulatePreview(state, shot) {
  const clone = cloneForSim(state, shot);
  const log = createShotLog();
  let t = 0;
  while (simulate(clone, 1 / 60, log) && t < 14) t += 1 / 60;
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

function shotIsGood(state, shot, player) {
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
  return potted.length > 0;
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
          power: clamp(speedForDistance(o.d) / MAX_SHOT_SPEED + 0.14 + extra, 0.16, 0.95),
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
      power: randRange(0.88, 1),
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
    if (!shotIsGood(state, shot, player)) continue;
    let candidate = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const err = cfg.angleErr * (1 + Math.random() * 1.6) * (attempt ? 0.55 : 1);
      candidate = {
        angle: shot.angle + randRange(-err, err),
        power: clamp(shot.power + randRange(-cfg.powerErr, cfg.powerErr), 0.1, 1),
        spin: { x: randRange(-0.15, 0.15), y: randRange(-0.25, 0.3) },
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

/* dica de mira para o jogador (linha guia até a primeira bola) */
export function aimGuide(state, angle) {
  const cue = cueBall(state);
  if (!cue) return null;
  const step = 3;
  const maxDist = 1400;
  let x = cue.x;
  let y = cue.y;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let hit = null;
  for (let d = 0; d < maxDist; d += step) {
    const px = cue.x + dx * d;
    const py = cue.y + dy * d;
    // caçapa
    for (const p of TABLE.pockets) {
      const rx = px - p.center.x;
      const ry = py - p.center.y;
      if (Math.hypot(rx, ry) < p.reach + 8) {
        return { x: px, y: py, hit: 'pocket', distance: d, pocket: p };
      }
    }
    for (const b of state.balls) {
      if (b.pocketed || b.id === 'cue') continue;
      if (Math.hypot(b.x - px, b.y - py) < BALL_D) {
        hit = b;
        return { x: px, y: py, hit: b, distance: d, ghost: { x: b.x - dx * BALL_D, y: b.y - dy * BALL_D } };
      }
    }
    x = px;
    y = py;
    if (px < -60 || px > PLAY_W + 60 || py < -60 || py > PLAY_H + 60) break;
  }
  return { x, y, hit: null, distance: maxDist };
}

export { randInt };
