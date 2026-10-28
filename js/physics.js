/*
 * physics.js — simulação realista das bolas.
 *
 * Modelo usado (o mesmo conceito de uma mesa real):
 *  • cada bola tem velocidade linear (vx, vy) e velocidade angular 3D (om.x/y/z);
 *  • quando o ponto de contato com o pano escorrega, o atrito cinético age até
 *    a bola "pegar" rolagem — é isso que faz o efeito (draw/follow) funcionar
 *    de verdade, sem truques;
 *  • depois de rolar, só a resistência à rolagem desacelera;
 *  • as tabelas e as bolas trocam impulso com restituição + atrito, então o
 *    efeito lateral (english) muda o ângulo de saída da tabela;
 *  • a orientação da bola é uma matriz de rotação de verdade: os números giram,
 *    somem no fundo e voltam, como numa bola real.
 */

import { BALL_R, BALL_D, PLAY_W, PLAY_H, TABLE } from './table.js';
import { clamp } from './util.js';

/* ---------------- força da tacada ---------------- */
/* A barra vai de 0 a 100%, mas entrega até 5x a força antiga no topo
   (curva de potência: no meio da barra já se tem a força máxima antiga). */
export const MAX_SHOT_SPEED = 15250;
export const POWER_GAMMA = 2.15;
export const POWER_SCALE = 5;

export function powerToSpeed(power) {
  const p = clamp(power, 0, 1);
  return MAX_SHOT_SPEED * Math.pow(p, POWER_GAMMA);
}

export function speedToPower(speed) {
  const s = Math.max(0, speed);
  return Math.pow(Math.min(1, s / MAX_SHOT_SPEED), 1 / POWER_GAMMA);
}

/* ---------------- constantes da simulação ---------------- */
const BALL_RESTITUTION = 0.95;
const BALL_FRICTION = 0.055;
const WALL_RESTITUTION = 0.82;
const WALL_FRICTION = 0.16;
const SLIDE_TAU = 0.1;        // quanto tempo o escorregamento dura (s)
const ROLL_A = 11;            // resistência à rolagem (termo constante)
const ROLL_C = 0.34;          // resistência proporcional à velocidade
const ROLL_Q = 0.0009;        // resistência quadrática (tiros muito fortes)
const SPIN_DECAY = 0.55;      // efeito lateral perdido por segundo
const STOP_EPS = 3.4;
const SUBSTEP_TRAVEL = 5;     // unidades por subpasso (anti-tunneling)

/* Distância que uma bola percorre a partir de uma velocidade inicial
   (integra o mesmo modelo de atrito da simulação — usado pela IA). */
export function travelDistance(v0, maxT = 40) {
  const r = BALL_R;
  let v = Math.max(0, v0);
  let om = 0;
  let x = 0;
  let t = 0;
  const h = 1 / 240;
  while (t < maxT && v > STOP_EPS) {
    const cv = v - r * om;
    if (Math.abs(cv) > 4) {
      const sgn = Math.sign(cv);
      const frac = 1 - Math.exp(-h / (SLIDE_TAU * Math.min(1, Math.max(0.13, 2000 / Math.max(1, v)))));
      const j = (Math.abs(cv) * frac) / 3.5;
      v -= sgn * j;
      om += (2.5 * sgn * j) / r;
    } else {
      om = v / r;
      v = Math.max(0, v - (ROLL_A + ROLL_C * v + ROLL_Q * v * v) * h);
    }
    x += v * h;
    t += h;
  }
  return x;
}

/* tabela potência → distância (calculada uma vez; a IA consulta muito) */
let DIST_TABLE = null;
function distTable() {
  if (DIST_TABLE) return DIST_TABLE;
  DIST_TABLE = [];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    DIST_TABLE.push({ p, d: travelDistance(powerToSpeed(p), 25) });
  }
  return DIST_TABLE;
}

/* potência (0..1) necessária para percorrer `d` */
export function powerForDistance(d) {
  if (d <= 0) return 0;
  const table = distTable();
  const max = table[table.length - 1].d;
  if (d >= max) return 1;
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid].d < d) lo = mid;
    else hi = mid;
  }
  const a = table[lo];
  const b = table[hi];
  const t = (d - a.d) / Math.max(1e-6, b.d - a.d);
  return a.p + (b.p - a.p) * t;
}

/* ---------------- matrizes de rotação ---------------- */
export function identityQ() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function mul3(a, b) {
  // retorna a*b (matrizes 3x3, linha por linha)
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

function rotAxis(ax, ay, az, th) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const t = 1 - c;
  return [
    t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
  ];
}

/* avança a orientação da bola por ω*dt */
function spinOrientation(ball, h) {
  const { om } = ball;
  const w = Math.hypot(om.x, om.y, om.z);
  if (w < 1e-4) return;
  const ang = w * h;
  if (ang < 1e-6) return;
  ball.q = mul3(rotAxis(om.x / w, om.y / w, om.z / w, ang), ball.q);
}

/* ---------------- estados / logs ---------------- */
export function ballSpeed(b) {
  return Math.hypot(b.vx, b.vy);
}

export function isMoving(state) {
  for (const b of state.balls) {
    if (!b.pocketed) {
      if (Math.abs(b.vx) > 0.01 || Math.abs(b.vy) > 0.01) return true;
    } else if (b.sinkT !== undefined && b.sinkT < 0.5) {
      return true;
    }
  }
  return false;
}

export function createShotLog() {
  return {
    firstHit: null,
    pocketed: [],
    cushions: 0,
    contacts: [],
    cushionHits: [],
    impacts: [],           // { type, x, y, speed, pocketId? } — som + pó
    cushionBalls: 0,
    cushionsAfterContact: false,
    cushionIds: {},
    cuePocketed: false,
    anyBallPocketed: false,
    maxSpeed: 0,
  };
}

/* ---------------- caçapas ---------------- */
function pocketCapture(ball) {
  for (const p of TABLE.pockets) {
    const rx = ball.x - p.center.x;
    const ry = ball.y - p.center.y;
    const proj = rx * p.interior.x + ry * p.interior.y;
    if (proj < p.captureDepth) continue;
    if (rx * rx + ry * ry > (p.reach + 26) * (p.reach + 26)) continue;
    const lateral = rx * p.tangent.x + ry * p.tangent.y;
    if (Math.abs(lateral) > p.captureHalf) continue;
    return p;
  }
  if (!TABLE.pockets.length) return null;
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

/* ---------------- tabelas ---------------- */
function resolveWalls(ball, log) {
  for (const w of TABLE.walls) {
    const c = Math.cos(w.angle);
    const s = Math.sin(w.angle);
    const half = w.len / 2;
    const tProj = (ball.x - w.x) * c + (ball.y - w.y) * s;
    const clamped = tProj < -half ? -half : tProj > half ? half : tProj;
    const px = w.x + c * clamped;
    const py = w.y + s * clamped;
    let dx = ball.x - px;
    let dy = ball.y - py;
    let d = Math.hypot(dx, dy);
    const side = dx * w.nx + dy * w.ny;

    if (d >= BALL_R && side > 0) continue;
    if (side > 0 && d < 1e-6) { dx = w.nx; dy = w.ny; d = 1; }

    let nx;
    let ny;
    const passedThrough = side <= 0;
    if (side > 0) {
      nx = dx / d;
      ny = dy / d;
    } else {
      nx = w.nx;
      ny = w.ny;
      ball.x = px + nx * (BALL_R + 0.01);
      ball.y = py + ny * (BALL_R + 0.01);
    }

    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      const impact = -vn;
      const tx = -ny;
      const ty = nx;
      const vt = ball.vx * tx + ball.vy * ty;

      // english: a componente vertical de giro empurra a bola na saída
      const english = ball.om.z * BALL_R * 0.16;
      const nvn = impact * WALL_RESTITUTION;
      const nvt = vt * (1 - WALL_FRICTION) + english;

      ball.vx = nx * nvn + tx * nvt;
      ball.vy = ny * nvn + ty * nvt;

      // giro: a tabela "agarra" parte do efeito
      ball.om.z *= 0.72;
      ball.om.x *= 0.9;
      ball.om.y *= 0.9;

      if (impact > 4) {
        log.cushions++;
        if (log.firstHit !== null) log.cushionsAfterContact = true;
        if (!log.cushionIds[ball.id]) {
          log.cushionIds[ball.id] = true;
          log.cushionBalls++;
        }
        if (impact > 30) {
          log.impacts.push({ type: 'cushion', x: px, y: py, speed: impact });
        }
      }
      if (impact > 40) log.cushionHits.push({ x: px, y: py, speed: impact });
    }

    if (!passedThrough) {
      const pen = BALL_R - (dx * nx + dy * ny);
      if (pen > 0) {
        ball.x += nx * pen;
        ball.y += ny * pen;
      }
    }
  }
}

/* ---------------- bola x bola ---------------- */
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
    const jn = (-(1 + BALL_RESTITUTION) * vn) / 2;
    a.vx -= jn * nx;
    a.vy -= jn * ny;
    b.vx += jn * nx;
    b.vy += jn * ny;

    // atrito tangencial (throw): a rotação da branca empurra a bola alvo
    const tx = -ny;
    const ty = nx;
    const dvx = b.vx - a.vx;
    const dvy = b.vy - a.vy;
    const relativeSurface = (dvx * tx + dvy * ty) + (a.om.z + b.om.z) * BALL_R * 0.5;
    const jt = clamp(-relativeSurface * BALL_FRICTION, -Math.abs(jn) * 0.35, Math.abs(jn) * 0.35);
    a.vx -= jt * tx;
    a.vy -= jt * ty;
    b.vx += jt * tx;
    b.vy += jt * ty;
    a.om.z -= jt * 0.02;
    b.om.z += jt * 0.02;

    const speed = Math.abs(vn);
    if (speed > 20) {
      log.contacts.push({ a: a.id, b: b.id, speed });
      log.impacts.push({ type: 'ball', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed });
    }
    if (log.firstHit === null && (a.id === 'cue' || b.id === 'cue')) {
      log.firstHit = a.id === 'cue' ? b.id : a.id;
    }
  }
}

/* ---------------- atrito do pano ---------------- */
function floorFriction(ball, h) {
  const r = BALL_R;
  // velocidade do ponto de contato com o pano
  const cvx = ball.vx - r * ball.om.y;
  const cvy = ball.vy + r * ball.om.x;
  const slip = Math.hypot(cvx, cvy);

  if (slip > 4) {
    // escorregando: o atrito cinético freia a translação e gira a bola até ela
    // "pegar" rolagem. O impulso removido é uma fração do escorregamento
    // (decaimento exponencial) — assim nunca há oscilação em torno da rolagem.
    const ux = -cvx / slip;
    const uy = -cvy / slip;
    // quanto mais forte a tacada, mais rápido o escorregamento se resolve
    const speedNow = Math.hypot(ball.vx, ball.vy);
    const tau = SLIDE_TAU * Math.min(1, Math.max(0.13, 2000 / Math.max(1, speedNow)));
    const frac = 1 - Math.exp(-h / tau);
    const j = (slip * frac) / 3.5;
    ball.vx += ux * j;
    ball.vy += uy * j;
    // torque = r × F  →  dω = (2.5/R)·(Fy, −Fx, 0)
    ball.om.x += (2.5 / r) * uy * j;
    ball.om.y -= (2.5 / r) * ux * j;
    // se zerou o escorregamento, entra em rolagem pura
    if (slip - 3.5 * j < 1) {
      ball.om.x = -ball.vy / r;
      ball.om.y = ball.vx / r;
    }
  } else {
    // rolando: só a resistência à rolagem
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 0.0001) {
      const decel = ROLL_A + ROLL_C * sp + ROLL_Q * sp * sp;
      const ns = Math.max(0, sp - decel * h);
      if (ns < STOP_EPS) {
        ball.vx = 0;
        ball.vy = 0;
      } else {
        const k = ns / sp;
        ball.vx *= k;
        ball.vy *= k;
      }
      // mantém a rolagem coerente com a velocidade
      ball.om.x = -ball.vy / r;
      ball.om.y = ball.vx / r;
    } else {
      ball.vx = 0;
      ball.vy = 0;
    }
  }

  // efeito lateral se perde devagar
  ball.om.z *= Math.exp(-SPIN_DECAY * h);
  if (Math.abs(ball.om.z) < 0.02) ball.om.z = 0;
}

/* ---------------- simulação ---------------- */
export function simulate(state, dt, log) {
  let guard = 0;
  let remaining = dt;
  while (remaining > 1e-6 && guard++ < 400) {
    let maxV = 0;
    for (const b of state.balls) {
      if (b.pocketed) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v > maxV) maxV = v;
    }
    const h = Math.min(remaining, maxV > 1 ? SUBSTEP_TRAVEL / maxV : 1 / 120, 1 / 120);
    remaining -= h;

    const balls = state.balls;
    for (const b of balls) {
      if (b.pocketed) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      spinOrientation(b, h);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > log.maxSpeed) log.maxSpeed = sp;
    }

    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.pocketed) continue;
        if (Math.abs(a.x - b.x) > BALL_D || Math.abs(a.y - b.y) > BALL_D) continue;
        resolvePair(a, b, log);
      }
    }

    for (const b of balls) {
      if (b.pocketed) continue;
      resolveWalls(b, log);
    }

    for (const b of balls) {
      if (b.pocketed) continue;
      floorFriction(b, h);
    }

    for (const b of balls) {
      if (b.pocketed) continue;
      const p = pocketCapture(b);
      if (!p) continue;
      const speed = Math.hypot(b.vx, b.vy);
      b.pocketed = true;
      b.pocketId = p.id;
      b.sinkT = 0;
      b.sinkSpeed = speed;
      b.sinkFromX = b.x;
      b.sinkFromY = b.y;
      b.vx = 0;
      b.vy = 0;
      b.om.x = 0;
      b.om.y = 0;
      b.om.z = 0;
      log.pocketed.push(b.id);
      log.anyBallPocketed = true;
      log.impacts.push({
        type: 'pocket', x: p.center.x + p.interior.x * 6, y: p.center.y + p.interior.y * 6,
        speed, pocketId: p.id, ballId: b.id,
      });
      if (b.id === 'cue') log.cuePocketed = true;
    }
  }

  for (const b of state.balls) {
    if (b.pocketed && b.sinkT !== undefined && b.sinkT < 1) b.sinkT += dt;
  }
  return isMoving(state);
}

/* posiciona as 15 bolas no triângulo: 8 no centro, uma lisa e uma listrada
   nos cantos de trás (regra do 8-ball) */
export function createRack() {
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const rest = [];
  for (let i = 0; i < 7; i++) rest.push(solids[i], stripes[i]);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const backIdx = [10, 14];
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
  return order;
}
