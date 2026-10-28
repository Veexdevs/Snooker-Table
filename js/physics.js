/*
 * physics.js — simulação das bolas.
 *
 * • colisão elástica bola-bola (massa igual) com restituição e correção
 *   de sobreposição;
 * • colisão contra os segmentos de tabela (com atrito tangencial);
 * • subpassos adaptativos para nada atravessar as tabelas em alta velocidade;
 * • captura nas caçapas justas;
 * • efeito (follow / draw / side) aplicado só na bola branca.
 */

import { BALL_R, BALL_D, PLAY_W, PLAY_H, TABLE } from './table.js';

export const MAX_SHOT_SPEED = 3050;

const BALL_RESTITUTION = 0.94;
const WALL_RESTITUTION = 0.82;
const WALL_FRICTION = 0.90;
const SURFACE_DRAG = 0.9;       // amortecimento exponencial (1/s)
const SURFACE_DECEL = 35;       // desaceleração constante (un/s²)
const STOP_EPS = 3.2;           // abaixo disso a bola "para"

export function ballSpeed(b) {
  return Math.hypot(b.vx, b.vy);
}

export function isMoving(state) {
  return state.balls.some((b) => !b.pocketed && (Math.abs(b.vx) > 0.01 || Math.abs(b.vy) > 0.01));
}

/**
 * Cria o "diário" de uma tacada — preenchido durante a simulação e
 * consumido pelas regras.
 */
export function createShotLog() {
  return {
    firstHit: null,
    pocketed: [],
    cushions: 0,
    contacts: [],   // { a, b, speed } para efeitos sonoros
    cushionHits: [], // { x, y, speed }
    cushionBalls: 0,
    cushionsAfterContact: false,
    cushionIds: {},
    cuePocketed: false,
    anyBallPocketed: false,
    maxSpeed: 0,
  };
}

function pocketCapture(state, ball, log) {
  for (const p of TABLE.pockets) {
    const rx = ball.x - p.center.x;
    const ry = ball.y - p.center.y;
    const proj = rx * p.interior.x + ry * p.interior.y;
    if (proj < p.captureDepth) continue;
    // a captura só vale na vizinhança imediata da boca (não no meio da mesa)
    if (rx * rx + ry * ry > (p.reach + 26) * (p.reach + 26)) continue;
    const lateral = rx * p.tangent.x + ry * p.tangent.y;
    if (Math.abs(lateral) > p.captureHalf) continue;
    return p;
  }
  // fallback: bola que escapou muito para fora da mesa
  if (ball.x < -BALL_R * 2.2 || ball.x > PLAY_W + BALL_R * 2.2 ||
      ball.y < -BALL_R * 2.2 || ball.y > PLAY_H + BALL_R * 2.2) {
    let best = TABLE.pockets[0];
    let bd = Infinity;
    for (const p of TABLE.pockets) {
      const d = Math.hypot(ball.x - p.center.x, ball.y - p.center.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  return null;
}

function resolveWalls(ball, log) {
  for (const w of TABLE.walls) {
    const c = Math.cos(w.angle);
    const s = Math.sin(w.angle);
    const half = w.len / 2;
    // projeção no eixo do segmento, relativa ao centro do segmento
    let t = (ball.x - w.x) * c + (ball.y - w.y) * s;
    const clamped = t < -half ? -half : t > half ? half : t;
    const px = w.x + c * clamped;
    const py = w.y + s * clamped;
    let dx = ball.x - px;
    let dy = ball.y - py;
    let d = Math.hypot(dx, dy);
    const side = dx * w.nx + dy * w.ny;

    if (d >= BALL_R && side > 0) continue;
    if (side > 0 && d < 1e-6) { dx = w.nx; dy = w.ny; d = 1; }

    let nx, ny;
    if (side > 0) {
      nx = dx / d;
      ny = dy / d;
    } else {
      // atravessou a tabela — usa a normal da parede
      nx = w.nx;
      ny = w.ny;
      // reposiciona dentro da mesa
      ball.x = px + nx * (BALL_R + 0.01);
      ball.y = py + ny * (BALL_R + 0.01);
    }
    const passedThrough = side <= 0;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      const impact = -vn;
      const tx = -ny;
      const ty = nx;
      const vt = ball.vx * tx + ball.vy * ty;
      const nvn = -vn * WALL_RESTITUTION;
      const nvt = vt * WALL_FRICTION;
      ball.vx = nx * nvn + tx * nvt;
      ball.vy = ny * nvn + ty * nvt;
      if (impact > 4) {
        log.cushions++;
        if (log.firstHit !== null) log.cushionsAfterContact = true;
        if (!log.cushionIds[ball.id]) {
          log.cushionIds[ball.id] = true;
          log.cushionBalls++;
        }
      }
      if (impact > 40) log.cushionHits.push({ x: px, y: py, speed: impact });
    }
    // corrige penetração
    if (!passedThrough) {
      const pen = BALL_R - (dx * nx + dy * ny);
      if (pen > 0) {
        ball.x += nx * pen;
        ball.y += ny * pen;
      }
    }
  }
}

function resolvePair(a, b, log) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  if (d >= BALL_D) return;
  if (d < 1e-6) {
    dx = Math.random() - 0.5;
    dy = Math.random() - 0.5;
    d = Math.hypot(dx, dy) || 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const overlap = BALL_D - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const j = (-(1 + BALL_RESTITUTION) * vn) / 2;
    a.vx -= j * nx;
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
    const speed = Math.abs(vn);
    if (speed > 20) log.contacts.push({ a: a.id, b: b.id, speed });
    if (log.firstHit === null && (a.id === 'cue' || b.id === 'cue')) {
      log.firstHit = a.id === 'cue' ? b.id : a.id;
    }
  }
}

/* efeito aplicado à bola branca na primeira colisão da tacada */
function applySpinAfterContact(state, log) {
  const spin = state.shot?.spin;
  if (!spin || state.cueSpent) return;
  const cue = state.balls.find((b) => b.id === 'cue');
  if (!cue || cue.pocketed) return;
  const dir = state.shot.angle;
  const power = state.shot.power || 0;
  const v = Math.min(1, Math.hypot(cue.vx, cue.vy) / 400 + 0.35);
  // top/back spin: empurra a branca para frente ou para trás
  cue.vx += Math.cos(dir) * spin.y * 260 * v * (0.4 + power);
  cue.vy += Math.sin(dir) * spin.y * 260 * v * (0.4 + power);
  // efeito lateral: desvia um pouco a trajetória (throw)
  cue.vx += -Math.sin(dir) * spin.x * 120 * v;
  cue.vy += Math.cos(dir) * spin.x * 120 * v;
  state.cueSpent = true;
}

/**
 * Avança a simulação por `dt` segundos.
 * Retorna true se ainda há movimento.
 */
export function simulate(state, dt, log) {
  let guard = 0;
  let remaining = dt;
  while (remaining > 1e-6 && guard++ < 60) {
    let maxV = 0;
    for (const b of state.balls) {
      if (b.pocketed) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v > maxV) maxV = v;
    }
    // no máximo ~4 unidades de deslocamento por substep
    const h = Math.min(remaining, maxV > 1 ? 4 / maxV : 1 / 120, 1 / 120);
    remaining -= h;

    const balls = state.balls;
    for (const b of balls) {
      if (b.pocketed) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      // rolagem visual
      b.rollX = (b.rollX || 0) + (b.vx * h) / BALL_R * 0.55;
      b.rollY = (b.rollY || 0) + (b.vy * h) / BALL_R * 0.55;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > log.maxSpeed) log.maxSpeed = sp;
    }

    // colisões bola-bola
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.pocketed) continue;
        if (Math.abs(a.x - b.x) > BALL_D || Math.abs(a.y - b.y) > BALL_D) continue;
        const hadFirst = log.firstHit;
        resolvePair(a, b, log);
        if (hadFirst === null && log.firstHit !== null) applySpinAfterContact(state, log);
      }
    }

    // tabelas
    for (const b of balls) {
      if (b.pocketed) continue;
      resolveWalls(b, log);
    }

    // atrito
    for (const b of balls) {
      if (b.pocketed) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp <= 0.0001) { b.vx = 0; b.vy = 0; continue; }
      const ns = Math.max(0, sp * Math.exp(-SURFACE_DRAG * h) - SURFACE_DECEL * h);
      if (ns < STOP_EPS) {
        b.vx = 0;
        b.vy = 0;
      } else {
        const k = ns / sp;
        b.vx *= k;
        b.vy *= k;
      }
    }

    // caçapas
    for (const b of balls) {
      if (b.pocketed) continue;
      const p = pocketCapture(state, b, log);
      if (p) {
        b.pocketed = true;
        b.pocketId = p.id;
        b.vx = 0;
        b.vy = 0;
        b.x = p.center.x + p.interior.x * (p.reach + 4);
        b.y = p.center.y + p.interior.y * (p.reach + 4);
        log.pocketed.push(b.id);
        log.anyBallPocketed = true;
        if (b.id === 'cue') log.cuePocketed = true;
        b.sinkT = 0;
      }
    }
  }

  for (const b of state.balls) {
    if (b.pocketed && b.sinkT !== undefined) b.sinkT += dt;
  }
  return isMoving(state);
}

/* posiciona as 15 bolas no triângulo, com 8 no centro e uma listrada
   e uma lisa nos cantos de trás (regra do 8-ball) */
export function createRack() {
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const rest = [];
  for (let i = 0; i < 7; i++) {
    rest.push(solids[i], stripes[i]);
  }
  // embaralha garantindo alternância visual
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  // canto de trás: uma lisa e uma listrada
  const backIdx = [10, 14]; // slots das pontas da última fileira
  const backBalls = [rest.pop(), rest.pop()];
  const stripeIdx = Math.random() < 0.5 ? 0 : 1;
  const order = new Array(15).fill(null);
  order[7] = 8;
  order[backIdx[0]] = backBalls[stripeIdx];
  order[backIdx[1]] = backBalls[1 - stripeIdx];
  let k = 0;
  for (let i = 0; i < 15; i++) {
    if (order[i] !== null) continue;
    order[i] = rest[k++];
  }
  return order; // por número de slot (0..14)
}
