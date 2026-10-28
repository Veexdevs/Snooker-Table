/*
 * app.js — controla a partida: HUD, barra de força, giz, efeito, turnos da
 * IA, sons, partículas e telas de fim de jogo.
 */

import {
  createGame, startShot, resolveShot, placeCueBall, cueBall, groupBalls, legalTargets,
} from './rules.js';
import { simulate, createShotLog, powerToSpeed, isMoving } from './physics.js';
import { createRenderer } from './render.js';
import { planAIShot, aimGuide, DIFFICULTIES } from './ai.js';
import { Sound } from './audio.js';
import { Particles } from './fx.js';
import {
  PLAY_W, PLAY_H, BALL_R, ballColor, isStripe, isFreeSpot, randomFreeSpot,
} from './table.js';
import { clamp, formatNumber } from './util.js';

/* ================= persistência ================= */
const STORE_KEY = 'bp8p.pro.v2';
const store = {
  data: {
    coins: 2500, wins: 0, losses: 0, pots: 0, bestStreak: 0,
    sound: true, guide: true, difficulty: 'medium',
    chalkWhite: 3, chalkBlue: 3,
  },
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* ignora */ }
  },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignora */ }
  },
};
store.load();

/* ================= elementos ================= */
const $ = (sel) => document.querySelector(sel);
const canvas = $('#table');
const bgCanvas = $('#table-bg');
const renderer = createRenderer(canvas, bgCanvas);
const particles = new Particles();

const el = {
  topbar: $('#topbar'),
  screens: { menu: $('#screen-menu'), game: $('#screen-game') },
  cards: [$('#card0'), $('#card1')],
  avatars: [$('#avatar0'), $('#avatar1')],
  names: [$('#name0'), $('#name1')],
  lvls: [$('#lvl0'), $('#lvl1')],
  coins: [$('#coins0'), $('#coins1')],
  ballsRows: [$('#balls0'), $('#balls1')],
  turnText: $('#turnText'),
  turnBar: $('#turnBar'),
  toast: $('#toast'),
  think: $('#think'),
  thinkText: $('#thinkText'),
  powerColumn: $('#powerColumn'),
  powerBar: $('#powerBar'),
  powerFill: $('#powerFill'),
  powerHandle: $('#powerHandle'),
  powerPct: $('#powerPct'),
  spinPad: $('#spinPad'),
  spinDot: $('#spinDot'),
  spinNow: $('#spinNow'),
  chalkWhite: $('#chalkWhite'),
  chalkBlue: $('#chalkBlue'),
  countWhite: $('#countWhite'),
  countBlue: $('#countBlue'),
  buffStrip: $('#buffStrip'),
  btnGuide: $('#btn-guide'),
  btnSound: $('#btn-sound'),
  overlayMenu: $('#overlay-menu'),
  overlayHelp: $('#overlay-help'),
  overlayEnd: $('#overlay-end'),
  overlayDiff: $('#overlay-diff'),
  endBadge: $('#endBadge'),
  endTitle: $('#endTitle'),
  endReason: $('#endReason'),
  endStats: $('#endStats'),
  confetti: $('#confetti'),
  menuStats: { wins: $('#statWins'), losses: $('#statLosses'), pots: $('#statPots'), streak: $('#statStreak') },
};

/* ================= estado do app ================= */
const CHALK_TIME = 45;       // segundos de duração de cada giz
const POWER_BONUS = 0.45;    // giz branco: +45% de força
const SPIN_BONUS = 1.0;      // giz azul: +100% de efeito
const TURN_TIME = 30;        // segundos por turno
const TIME_SCALE = 1.7;      // acelera a simulação (o jogo fica ágil sem perder a física)

const G = {
  state: null,
  mode: 'ai',
  difficulty: store.data.difficulty || 'medium',
  log: null,
  aim: { angle: 0 },
  power: 0,
  charging: false,
  powerPointer: null,
  pointer: null,
  pointerValid: false,
  showGuide: store.data.guide !== false,
  particles,
  strike: null,
  buffs: { power: 0, spin: 0 },
  turnLeft: TURN_TIME,
  token: 0,
  timers: [],
  aiPlaying: false,
  frameId: null,
  last: 0,
  toastTimer: null,
};

/* ================= utilidades de UI ================= */
function showScreen(name) {
  Object.entries(el.screens).forEach(([key, node]) => node.classList.toggle('active', key === name));
  el.topbar.classList.toggle('hidden', name === 'menu');
  syncInsets();
  renderer.resize();
}

function openOverlay(node) { node.classList.add('open'); }
function closeOverlay(node) { node.classList.remove('open'); }

function toast(message, kind = '') {
  clearTimeout(G.toastTimer);
  if (!message) { el.toast.className = 'toast'; return; }
  el.toast.textContent = message;
  el.toast.className = `toast show ${kind}`;
  G.toastTimer = setTimeout(() => { el.toast.className = `toast ${kind}`; }, 3000);
}

function formatClock(s) {
  const v = Math.max(0, Math.ceil(s));
  return `${v}`;
}

/* ================= barra de força ================= */
function setPower(p, { silent = false } = {}) {
  G.power = clamp(p, 0, 1);
  el.powerFill.style.height = `${G.power * 100}%`;
  el.powerHandle.style.top = `${G.power * 100}%`;
  el.powerPct.textContent = `${Math.round(G.power * 100)}%`;
  el.powerColumn.classList.toggle('charging', G.charging && G.power > 0.02);
  if (!silent && G.power > 0.02 && !G.charging) el.powerPct.classList.add('flash');
}

function powerFromEvent(ev) {
  const rect = el.powerBar.getBoundingClientRect();
  return clamp((ev.clientY - rect.top) / rect.height, 0, 1);
}

/* ================= efeito ================= */
const SPIN_LABELS = [
  { key: 'centro', label: 'centro' },
];
function setSpin(x, y) {
  G.state && (G.state.shot.spin = { x, y });
  el.spinDot.style.transform = `translate(calc(-50% + ${x * 19}px), calc(-50% + ${y * 19}px))`;
  const parts = [];
  if (y < -0.12) parts.push('fundo');
  else if (y > 0.12) parts.push('topo');
  if (x < -0.12) parts.push('esq.');
  else if (x > 0.12) parts.push('dir.');
  el.spinNow.textContent = parts.length ? parts.join(' + ') : 'centro';
  el.spinNow.classList.toggle('power', parts.length > 0);
}

/* ================= HUD ================= */
function miniBall(number, potted) {
  const stripe = isStripe(number);
  const color = ballColor(number);
  const cls = ['mini-ball', stripe ? 'stripe' : 'solid', number === 8 ? 'eight' : '', potted ? 'potted' : '']
    .filter(Boolean).join(' ');
  return `<div class="${cls}" style="--c:${color}"><span>${number}</span></div>`;
}

function renderBallRows() {
  const state = G.state;
  if (!state) return;
  for (const i of [0, 1]) {
    const player = state.players[i];
    const row = el.ballsRows[i];
    if (state.mode === 'practice') {
      const left = state.balls.filter((b) => !b.pocketed && b.number > 0).length;
      row.innerHTML = `<span class="practice-left">${left} bolas</span>`;
      continue;
    }
    const group = player.group;
    if (!group) {
      row.innerHTML = Array.from({ length: 7 }, () => '<div class="mini-ball empty"></div>').join('');
      continue;
    }
    const numbers = group === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    const eight = state.balls.find((b) => b.number === 8);
    row.innerHTML = numbers
      .map((n) => {
        const ball = state.balls.find((b) => b.number === n);
        return miniBall(n, !!ball?.pocketed);
      })
      .join('') + miniBall(8, !!eight?.pocketed);
  }
}

function updateHUD() {
  const state = G.state;
  if (!state) return;
  for (const i of [0, 1]) {
    const active = state.mode === 'practice' ? i === 0 : state.turn === i;
    el.cards[i].classList.toggle('active', active && state.phase !== 'gameover');
    const player = state.players[i];
    let group = 'aberto';
    if (state.mode === 'practice') group = 'treino';
    else if (player.group) {
      group = player.group === 'solid' ? 'lisas' : 'listradas';
      if (groupBalls(state, player.group).length === 0) group = 'bola 8';
    }
    const groupEl = el.cards[i].querySelector('.p-group');
    if (groupEl) {
      groupEl.textContent = state.mode === 'practice' ? 'livre' : (group === 'aberto' ? 'grupo aberto' : group);
      groupEl.className = `p-group ${player.group || ''}`;
    }
  }
  const isHuman = !state.players[state.turn]?.isAI && state.phase !== 'gameover';
  el.turnText.textContent = state.phase === 'gameover'
    ? 'fim de jogo'
    : state.ballInHand && isHuman
      ? 'bola na mão'
      : isHuman
        ? 'sua vez'
        : `${state.players[state.turn]?.name?.split('·')[0].trim() || 'adversário'}`;
  renderBallRows();
  canvas.classList.toggle('ballinhand', state.ballInHand && isHuman);
  updateBuffs();
}

function updateBuffs() {
  const parts = [];
  if (G.buffs.power > 0) parts.push(`<div class="buff-pill white">GIZ BRANCO +45% força<b>${Math.ceil(G.buffs.power)}s</b></div>`);
  if (G.buffs.spin > 0) parts.push(`<div class="buff-pill blue">GIZ AZUL 2× efeito<b>${Math.ceil(G.buffs.spin)}s</b></div>`);
  el.buffStrip.innerHTML = parts.join('');
  el.chalkWhite.classList.toggle('on', G.buffs.power > 0);
  el.chalkBlue.classList.toggle('on', G.buffs.spin > 0);
  el.countWhite.textContent = store.data.chalkWhite;
  el.countBlue.textContent = store.data.chalkBlue;
  el.countWhite.classList.toggle('hidden', G.buffs.power > 0);
  el.countBlue.classList.toggle('hidden', G.buffs.spin > 0);
}

/* ================= timers ================= */
function clearTimers() {
  G.token++;
  for (const t of G.timers) clearTimeout(t);
  G.timers = [];
  el.think.hidden = true;
}

function later(fn, delay) {
  const tok = G.token;
  const id = setTimeout(() => {
    G.timers = G.timers.filter((x) => x !== id);
    if (tok === G.token) fn();
  }, delay);
  G.timers.push(id);
  return id;
}

/* ================= partida ================= */
function startGame({ mode = 'ai', difficulty = G.difficulty } = {}) {
  clearTimers();
  G.mode = mode;
  G.difficulty = difficulty;
  const names = mode === 'ai'
    ? ['Você', `CPU · ${DIFFICULTIES[difficulty]?.name || 'Pro'}`]
    : mode === 'local'
      ? ['Jogador 1', 'Jogador 2']
      : ['Treino livre', 'Mesa'];
  const state = createGame({ mode, difficulty, names });
  state.players[1].isAI = mode === 'ai';
  state.players[0].isAI = false;
  if (mode === 'practice') state.message = 'Treino livre: Shift + clique move a branca.';

  G.state = state;
  G.log = createShotLog();
  G.aim.angle = 0;
  G.power = 0;
  G.charging = false;
  G.strike = null;
  G.aiPlaying = false;
  G.buffs = { power: 0, spin: 0 };
  G.turnLeft = TURN_TIME;
  particles.clear();
  setPower(0, { silent: true });
  setSpin(0, 0);
  el.spinNow.textContent = 'centro';

  el.names[0].textContent = names[0];
  el.names[1].textContent = names[1];
  el.avatars[0].textContent = names[0].slice(0, 1).toUpperCase();
  el.avatars[1].textContent = names[1].slice(0, 1).toUpperCase();
  el.lvls[0].textContent = `★ ${21 + (store.data.wins % 12)}`;
  el.lvls[1].textContent = `★ ${50 + ({ easy: 8, medium: 21, pro: 47, legend: 78 }[difficulty] || 30)}`;
  el.coins[0].textContent = formatNumber(store.data.coins);
  el.coins[1].textContent = mode === 'ai'
    ? formatNumber(1200 + ({ easy: 200, medium: 900, pro: 2400, legend: 5000 }[difficulty] || 600))
    : '150';

  closeOverlay(el.overlayEnd);
  closeOverlay(el.overlayDiff);
  closeOverlay(el.overlayMenu);
  stopConfetti();
  showScreen('game');
  updateHUD();
  toast(state.message || 'Boa sorte!', 'good');
  requestAnimationFrame(() => {
    syncInsets();
    renderer.resize();
    pointAtNearestTarget();
    if (G.state.players[G.state.turn]?.isAI) scheduleAI();
  });
  if (!G.frameId) loop(performance.now());
}

function pointAtNearestTarget() {
  const state = G.state;
  if (!state) return;
  const cue = cueBall(state);
  if (!cue || cue.pocketed) return;
  const targets = legalTargets(state, state.turn).filter((b) => b.number !== 0).filter((b) => !b.pocketed);
  if (!targets.length) return;
  let best = null;
  let bd = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - cue.x, t.y - cue.y);
    if (d < bd) { bd = d; best = t; }
  }
  if (best) G.aim.angle = Math.atan2(best.y - cue.y, best.x - cue.x);
}

/* ================= tacada ================= */
function currentMultipliers() {
  return {
    powerMult: 1 + (G.buffs.power > 0 ? POWER_BONUS : 0),
    spinMult: 1 + (G.buffs.spin > 0 ? SPIN_BONUS : 0),
  };
}

function doShoot(angle, power, spin) {
  const state = G.state;
  if (!state || (state.phase !== 'aim' && state.phase !== 'ballinhand')) return;
  if (state.ballInHand) return;
  const { powerMult, spinMult } = currentMultipliers();
  G.aim.angle = angle;
  G.log = createShotLog();
  state.phase = 'shooting';
  startShot(state, { angle, power, spin, powerMult, spinMult });
  Sound.strike(clamp(power * powerMult, 0, 1));
  updateHUD();
  toast('');
}

function releaseShot() {
  const state = G.state;
  const power = G.power;
  G.charging = false;
  el.powerColumn.classList.remove('charging');
  G.powerPointer = null;
  if (!state || state.phase !== 'aim' || !humanCanAct()) {
    setPower(0, { silent: true });
    return;
  }
  if (power <= 0.03) {
    setPower(0, { silent: true });
    toast('Tacada cancelada — puxe a barra para baixo para carregar.', '');
    return;
  }
  if (state.ballInHand) return;
  // animação: o taco avança e só no contato a bola sai
  G.strike = { t0: performance.now(), dur: 110, power };
  const angle = G.aim.angle;
  const spin = { ...state.shot.spin };
  later(() => {
    G.strike = null;
    doShoot(angle, power, spin);
    setPower(0, { silent: true });
  }, 110);
}
function humanCanAct() {
  const state = G.state;
  if (!state) return false;
  if (state.phase !== 'aim' && state.phase !== 'ballinhand') return false;
  return !state.players[state.turn]?.isAI || state.mode === 'practice';
}

/* ================= IA ================= */
function scheduleAI() {
  const state = G.state;
  if (!state || state.phase === 'gameover') return;
  const player = state.players[state.turn];
  if (!player?.isAI || G.aiPlaying) return;
  G.aiPlaying = true;
  el.thinkText.textContent = `${player.name.split('·')[0].trim()} pensando…`;
  el.think.hidden = false;

  later(() => {
    if (!G.state || G.state.phase === 'gameover') { G.aiPlaying = false; el.think.hidden = true; return; }
    const plan = planAIShot(state, { difficulty: G.difficulty, player: state.turn });

    if (state.ballInHand) {
      let placed = false;
      if (plan.placement) placed = placeCueBall(state, plan.placement.x, plan.placement.y);
      for (let i = 0; i < 400 && !placed; i++) {
        const spot = randomFreeSpot(state, PLAY_W * 0.05, PLAY_W * 0.95);
        placed = placeCueBall(state, spot.x, spot.y);
      }
      updateHUD();
    }

    G.aim.angle = plan.angle;
    setPower(plan.power, { silent: true });
    updateHUD();

    later(() => {
      el.think.hidden = true;
      G.aiPlaying = false;
      if (!G.state || G.state.phase === 'gameover' || G.state.phase === 'shooting') return;
      G.strike = { t0: performance.now(), dur: 110, power: plan.power };
      later(() => {
        G.strike = null;
        doShoot(plan.angle, plan.power, plan.spin || { x: 0, y: 0 });
        setPower(0, { silent: true });
      }, 120);
    }, 380 + Math.random() * 260);
  }, 520 + Math.random() * 480);
}

/* ================= fim da tacada ================= */
function consumeImpacts() {
  const log = G.log;
  if (!log) return;
  for (const im of log.impacts) {
    const s = im.speed;
    if (im.type === 'ball') {
      Sound.click(s);
      if (s > 2600) particles.spark(im.x, im.y, Math.min(1.2, s / 5000));
    } else if (im.type === 'cushion') {
      Sound.cushion(s);
      if (s > 1500) particles.dust(im.x, im.y, Math.min(1.1, s / 5000), { spread: 16 });
    } else if (im.type === 'pocket') {
      Sound.pocket(s, im.pocketId);
      const strength = Math.min(1.4, s / 3500);
      const p = G.state && G.state.balls.length ? null : null;
      void p;
      particles.pocketDust(im.x, im.y, strength);
      if (s > 1400) particles.dust(im.x, im.y, strength, { spread: 34 });
    }
  }
  log.impacts.length = 0;
}

function finishShot() {
  const state = G.state;
  if (!state) return;

  if (state.mode === 'practice') {
    finishPractice();
    return;
  }

  const res = resolveShot(state, G.log);

  if (res.gameOver) {
    const humanWon = res.winner === 0;
    if (state.mode === 'ai') {
      store.data[humanWon ? 'wins' : 'losses'] += 1;
      store.data.pots += state.stats.potted;
      store.data.bestStreak = Math.max(store.data.bestStreak, state.stats.bestStreak);
      store.data.coins += humanWon ? 180 : 45;
      // giz de recompensa
      if (humanWon && Math.random() < 0.5) store.data.chalkWhite = Math.min(9, store.data.chalkWhite + 1);
      store.save();
    }
    Sound[humanWon || state.mode === 'local' ? 'win' : 'lose']();
    updateHUD();
    later(() => showEnd(res), 750);
    return;
  }

  if (res.foul) { Sound.foul(); toast(res.message, 'foul'); }
  else if (res.pottedObjects.length) { Sound.potGood(); toast(res.message, 'good'); }
  else toast(res.message, res.continueTurn ? 'good' : '');
  if (!res.continueTurn) later(() => Sound.turn(), 260);

  G.turnLeft = TURN_TIME;
  updateHUD();

  if (state.players[state.turn]?.isAI) later(scheduleAI, 700);
  else if (state.phase === 'aim') pointAtNearestTarget();
}

function finishPractice() {
  const state = G.state;
  const log = G.log;
  const potted = log.pocketed
    .map((id) => state.balls.find((b) => b.id === id))
    .filter((b) => b && b.number > 0);

  if (potted.length) store.data.pots += potted.length;
  if (log.cuePocketed) {
    const cue = cueBall(state);
    const spot = randomFreeSpot(state, PLAY_W * 0.08, PLAY_W * 0.6);
    cue.pocketed = false;
    cue.pocketId = null;
    cue.sinkT = 1;
    cue.x = spot.x;
    cue.y = spot.y;
    cue.vx = 0;
    cue.vy = 0;
    cue.om = { x: 0, y: 0, z: 0 };
    toast('Branca na caixa. Shift + clique para reposicionar.', 'foul');
  } else if (potted.length) {
    const rest = state.balls.filter((b) => !b.pocketed && b.number > 0).length;
    toast(rest === 0 ? 'Mesa limpa! Você encaçapou todas.' : `${potted.length} bola(s) na caçapa · faltam ${rest}`, 'good');
  }
  state.phase = 'aim';
  state.turn = 0;
  state.ballInHand = false;
  updateHUD();
}

function showEnd(res) {
  const state = G.state;
  const humanWon = state.mode === 'local' ? true : res.winner === 0;
  const winnerName = state.players[res.winner]?.name || '—';
  el.endBadge.textContent = humanWon ? '🏆' : '💥';
  el.endTitle.textContent = state.mode === 'local' ? `${winnerName} venceu!` : humanWon ? 'Vitória!' : 'Derrota';
  el.endReason.textContent = res.message || state.winnerReason || '';
  el.endStats.innerHTML = `
    <div><b>${state.stats.potted}</b><small>bolas suas</small></div>
    <div><b>${state.stats.fouls}</b><small>faltas</small></div>
    <div><b>${state.shots}</b><small>tacadas</small></div>`;
  openOverlay(el.overlayEnd);
  if (humanWon) startConfetti();
}

/* ================= confete ================= */
const confetti = { ctx: null, parts: [], raf: null, until: 0 };
function startConfetti() {
  const c = el.confetti;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = window.innerWidth * dpr;
  c.height = window.innerHeight * dpr;
  confetti.ctx = c.getContext('2d');
  confetti.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#f3c85c', '#35d07f', '#ff5a5f', '#4ea3ff', '#ffffff', '#c084fc'];
  confetti.parts = Array.from({ length: 130 }, () => ({
    x: Math.random() * window.innerWidth,
    y: -20 - Math.random() * window.innerHeight * 0.6,
    vx: (Math.random() - 0.5) * 60,
    vy: 90 + Math.random() * 190,
    w: 5 + Math.random() * 7,
    h: 8 + Math.random() * 10,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 8,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  c.classList.add('on');
  confetti.until = performance.now() + 4200;
  if (!confetti.raf) confettiTick(performance.now());
}
function confettiTick(now) {
  const c = el.confetti;
  const ctx = confetti.ctx;
  if (!ctx) return;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const dt = 1 / 60;
  for (const p of confetti.parts) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 60 * dt;
    p.rot += p.vr * dt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = now > confetti.until ? Math.max(0, 1 - (now - confetti.until) / 600) : 1;
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  if (now < confetti.until + 700) confetti.raf = requestAnimationFrame(confettiTick);
  else stopConfetti();
}
function stopConfetti() {
  if (confetti.raf) cancelAnimationFrame(confetti.raf);
  confetti.raf = null;
  el.confetti.classList.remove('on');
  if (confetti.ctx) confetti.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

/* ================= loop ================= */
function loop(now) {
  G.frameId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - (G.last || now)) / 1000);
  G.last = now;
  const clock = performance.now();
  const state = G.state;

  if (state) {
    if (state.phase === 'shooting') {
      const moving = simulate(state, dt * TIME_SCALE, G.log);
      consumeImpacts();
      particles.update(dt);
      if (!moving) {
        state.phase = 'resolving';
        later(finishShot, 320);
      }
    } else {
      particles.update(dt);
    }

    // buffs com tempo
    let buffChanged = false;
    if (G.buffs.power > 0) { G.buffs.power = Math.max(0, G.buffs.power - dt); if (G.buffs.power === 0) buffChanged = true; }
    if (G.buffs.spin > 0) { G.buffs.spin = Math.max(0, G.buffs.spin - dt); if (G.buffs.spin === 0) buffChanged = true; }
    if (buffChanged) updateBuffs();

    // relógio do turno
    const humanTurn = !state.players[state.turn]?.isAI;
    if (humanTurn && state.phase === 'aim' && !state.ballInHand) {
      G.turnLeft -= dt;
      if (G.turnLeft <= 0) {
        G.turnLeft = TURN_TIME;
        toast('Tempo esgotado — vez do adversário.', 'foul');
        Sound.foul();
        state.turn = 1 - state.turn;
        state.phase = 'aim';
        updateHUD();
        if (state.players[state.turn]?.isAI) later(scheduleAI, 500);
      }
    }
    const frac = clamp(G.turnLeft / TURN_TIME, 0, 1);
    el.turnBar.style.width = `${frac * 100}%`;
    el.turnBar.className = frac < 0.2 ? 'low' : frac < 0.45 ? 'warn' : '';

    const humanCanAim = humanCanAct() && state.phase === 'aim';
    const guide = G.showGuide && humanCanAim ? aimGuide(state, G.aim.angle) : null;
    const strikeOffset = G.strike
      ? clamp((clock - G.strike.t0) / G.strike.dur, 0, 1) * (14 + G.strike.power * 118)
      : 0;

    renderer.draw({
      state,
      aim: G.aim,
      guide,
      power: G.power,
      showGuide: G.showGuide,
      time: clock / 1000,
      pointer: G.pointer,
      pointerValid: G.pointerValid,
      particles,
      strike: G.strike ? { offset: strikeOffset } : null,
    });
  }
}

/* ================= entrada ================= */
function pointerWorld(ev) {
  return renderer.toWorld(ev.clientX, ev.clientY);
}

canvas.addEventListener('pointermove', (ev) => {
  const state = G.state;
  if (!state) return;
  const p = pointerWorld(ev);
  G.pointer = p;

  if (state.ballInHand && humanCanAct()) {
    const cx = clamp(p.x, BALL_R, PLAY_W - BALL_R);
    const cy = clamp(p.y, BALL_R, PLAY_H - BALL_R);
    G.pointer = { x: cx, y: cy };
    G.pointerValid = isFreeSpot(state, cx, cy);
    canvas.classList.toggle('invalid', !G.pointerValid);
    return;
  }

  if (humanCanAct() && state.phase === 'aim') {
    const cue = cueBall(state);
    if (cue && !cue.pocketed) {
      G.aim.angle = Math.atan2(p.y - cue.y, p.x - cue.x);
    }
  }
});

canvas.addEventListener('pointerdown', (ev) => {
  Sound.unlock();
  const state = G.state;
  if (!state) return;
  const p = pointerWorld(ev);

  // treino: shift + clique move a branca
  if (state.mode === 'practice' && (ev.shiftKey || ev.altKey)) {
    const cue = cueBall(state);
    if (cue) {
      cue.x = clamp(p.x, BALL_R, PLAY_W - BALL_R);
      cue.y = clamp(p.y, BALL_R, PLAY_H - BALL_R);
      cue.vx = 0;
      cue.vy = 0;
      Sound.ui();
    }
    return;
  }

  if (!humanCanAct()) return;

  if (state.ballInHand) {
    const cx = clamp(p.x, BALL_R, PLAY_W - BALL_R);
    const cy = clamp(p.y, BALL_R, PLAY_H - BALL_R);
    if (placeCueBall(state, cx, cy)) {
      Sound.ui();
      G.pointerValid = true;
      canvas.classList.remove('invalid', 'ballinhand');
      updateHUD();
      toast('Branca posicionada.', '');
      pointAtNearestTarget();
    }
    return;
  }

  if (state.phase === 'aim') {
    const cue = cueBall(state);
    if (cue) G.aim.angle = Math.atan2(p.y - cue.y, p.x - cue.x);
  }
});

canvas.addEventListener('pointerup', () => { G.pointer = null; });

/* barra de força: puxa para baixo */
el.powerBar.addEventListener('pointerdown', (ev) => {
  Sound.unlock();
  if (!humanCanAct()) return;
  if (G.state.phase !== 'aim') return;
  ev.preventDefault();
  G.charging = true;
  G.powerPointer = ev.pointerId;
  el.powerBar.setPointerCapture?.(ev.pointerId);
  setPower(powerFromEvent(ev));
  Sound.pull(G.power);
});

el.powerBar.addEventListener('pointermove', (ev) => {
  if (!G.charging) return;
  ev.preventDefault();
  const p = powerFromEvent(ev);
  if (p - G.power > 0.08) Sound.pull(p);
  setPower(p);
});

function endPowerDrag(ev) {
  if (!G.charging) return;
  if (ev && ev.pointerId !== undefined && G.powerPointer !== null && ev.pointerId !== G.powerPointer) return;
  releaseShot();
}
el.powerBar.addEventListener('pointerup', endPowerDrag);
el.powerBar.addEventListener('pointercancel', () => { G.charging = false; setPower(0, { silent: true }); });
window.addEventListener('pointerup', endPowerDrag);

/* roda do mouse: ajuste fino da mira */
canvas.addEventListener('wheel', (ev) => {
  const state = G.state;
  if (!state || !humanCanAct() || state.ballInHand) return;
  ev.preventDefault();
  G.aim.angle += Math.sign(ev.deltaY) * 0.005;
}, { passive: false });

/* teclado */
window.addEventListener('keydown', (ev) => {
  const state = G.state;
  if (ev.code === 'Escape') {
    if (el.overlayEnd.classList.contains('open')) return;
    const open = document.querySelector('.overlay.open');
    if (open) { closeOverlay(open); return; }
    if (state && el.screens.game.classList.contains('active')) openOverlay(el.overlayMenu);
    return;
  }
  if (ev.code === 'KeyG') { toggleGuide(); return; }
  if (ev.code === 'KeyR') { if (state) startGame({ mode: G.mode, difficulty: G.difficulty }); return; }
  if (!state || !humanCanAct() || state.ballInHand) return;
  if (ev.code === 'ArrowLeft') { G.aim.angle -= ev.shiftKey ? 0.0012 : 0.008; ev.preventDefault(); }
  if (ev.code === 'ArrowRight') { G.aim.angle += ev.shiftKey ? 0.0012 : 0.008; ev.preventDefault(); }
});

/* efeito (spin pad) */
function setSpinFromEvent(ev) {
  const rect = el.spinPad.getBoundingClientRect();
  const r = rect.width / 2 || 1;
  let dx = (ev.clientX - rect.left - r) / (r * 0.86);
  let dy = (ev.clientY - rect.top - r) / (r * 0.86);
  const d = Math.hypot(dx, dy);
  if (d > 1) { dx /= d; dy /= d; }
  setSpin(dx, -dy);
}
let spinDrag = false;
el.spinPad.addEventListener('pointerdown', (ev) => {
  Sound.unlock();
  spinDrag = true;
  el.spinPad.setPointerCapture?.(ev.pointerId);
  setSpinFromEvent(ev);
});
el.spinPad.addEventListener('pointermove', (ev) => { if (spinDrag) setSpinFromEvent(ev); });
window.addEventListener('pointerup', () => { spinDrag = false; });
el.spinPad.addEventListener('dblclick', () => setSpin(0, 0));

/* ================= giz ================= */
function useChalk(kind) {
  Sound.unlock();
  const key = kind === 'white' ? 'chalkWhite' : 'chalkBlue';
  if (store.data[key] <= 0) { toast('Sem giz desse tipo. Ganhe partidas para conseguir mais.', 'foul'); return; }
  if (kind === 'white' && G.buffs.power > 0) return;
  if (kind === 'blue' && G.buffs.spin > 0) return;
  store.data[key] -= 1;
  G.buffs[kind === 'white' ? 'power' : 'spin'] = CHALK_TIME;
  store.save();
  Sound.chalk();
  updateBuffs();
  toast(kind === 'white'
    ? 'Giz branco: +45% de força na próxima tacada enquanto durar.'
    : 'Giz azul: efeito dobrado enquanto durar.', 'good');
}
el.chalkWhite.addEventListener('click', () => useChalk('white'));
el.chalkBlue.addEventListener('click', () => useChalk('blue'));

/* ================= menus e botões ================= */
function toggleGuide() {
  G.showGuide = !G.showGuide;
  el.btnGuide.classList.toggle('on', G.showGuide);
  $('#optGuide').checked = G.showGuide;
  store.data.guide = G.showGuide;
  store.save();
  Sound.ui();
}

document.querySelectorAll('.mode-card').forEach((card) => {
  card.addEventListener('click', () => {
    Sound.unlock();
    Sound.ui();
    const mode = card.dataset.mode;
    if (mode === 'ai') {
      document.querySelectorAll('#diffList .diff-item').forEach((b) => {
        b.classList.toggle('active', b.dataset.diff === G.difficulty);
      });
      openOverlay(el.overlayDiff);
    } else {
      startGame({ mode, difficulty: 'medium' });
    }
  });
});

document.querySelectorAll('#diffList .diff-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    G.difficulty = btn.dataset.diff;
    document.querySelectorAll('#diffList .diff-item').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.diff-chip').forEach((c) => c.classList.toggle('active', c.dataset.diff === G.difficulty));
    store.data.difficulty = G.difficulty;
    store.save();
    Sound.ui();
  });
});

document.querySelectorAll('.diff-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    G.difficulty = chip.dataset.diff;
    document.querySelectorAll('.diff-chip').forEach((c) => c.classList.toggle('active', c === chip));
    store.data.difficulty = G.difficulty;
    store.save();
    Sound.ui();
  });
});

$('#btn-start-ai').addEventListener('click', () => startGame({ mode: 'ai', difficulty: G.difficulty }));
$('#btn-help').addEventListener('click', () => { openOverlay(el.overlayHelp); Sound.ui(); });
$('#btn-guide').addEventListener('click', toggleGuide);
$('#optGuide').addEventListener('change', (ev) => {
  G.showGuide = ev.target.checked;
  el.btnGuide.classList.toggle('on', G.showGuide);
  store.data.guide = G.showGuide;
  store.save();
});
$('#btn-sound').addEventListener('click', () => {
  const on = !Sound.enabled;
  Sound.setEnabled(on);
  store.data.sound = on;
  store.save();
  el.btnSound.classList.toggle('off', !on);
  Sound.toggle(on);
});
$('#btn-menu').addEventListener('click', () => {
  if (el.screens.game.classList.contains('active')) openOverlay(el.overlayMenu);
  else openOverlay(el.overlayHelp);
  Sound.ui();
});
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const node = document.getElementById(btn.dataset.close);
    if (node) closeOverlay(node);
    Sound.ui();
  });
});
$('#btn-again').addEventListener('click', () => startGame({ mode: G.mode, difficulty: G.difficulty }));
$('#btn-restart-menu').addEventListener('click', () => { closeOverlay(el.overlayMenu); startGame({ mode: G.mode, difficulty: G.difficulty }); });
$('#btn-home-menu').addEventListener('click', goHome);
$('#btn-exit').addEventListener('click', goHome);
$('#btn-back-menu').addEventListener('click', goHome);
$('#btn-rematch').addEventListener('click', () => { closeOverlay(el.overlayEnd); startGame({ mode: G.mode, difficulty: G.difficulty }); });

function goHome() {
  clearTimers();
  G.aiPlaying = false;
  closeOverlay(el.overlayEnd);
  closeOverlay(el.overlayMenu);
  stopConfetti();
  updateMenuStats();
  updateHUD();
  showScreen('menu');
}

function updateMenuStats() {
  el.menuStats.wins.textContent = formatNumber(store.data.wins);
  el.menuStats.losses.textContent = formatNumber(store.data.losses);
  el.menuStats.pots.textContent = formatNumber(store.data.pots);
  el.menuStats.streak.textContent = formatNumber(store.data.bestStreak);
}

/* ================= layout ================= */
function syncInsets() {
  const gameActive = el.screens.game.classList.contains('active');
  const topbarH = el.topbar.getBoundingClientRect().height || 0;
  let top = 8;
  if (gameActive) top = Math.max(8, Math.round(topbarH * 0.0) + 8);
  renderer.setInsets({ top, left: 56, right: 62, bottom: 12 });
}

function resizeAll() {
  syncInsets();
  renderer.resize();
  if (el.confetti.classList.contains('on')) startConfetti();
}
window.addEventListener('resize', resizeAll);
window.addEventListener('orientationchange', resizeAll);
if ('ResizeObserver' in window) {
  const ro = new ResizeObserver(() => resizeAll());
  ro.observe(canvas.parentElement);
}

/* ================= inicialização ================= */
syncInsets();
renderer.resize();
showScreen('menu');
updateMenuStats();
updateHUD();
el.btnGuide.classList.toggle('on', G.showGuide);
$('#optGuide').checked = G.showGuide;
el.btnSound.classList.toggle('off', !store.data.sound);
Sound.setEnabled(store.data.sound !== false);
document.querySelectorAll('.diff-chip').forEach((c) => c.classList.toggle('active', c.dataset.diff === G.difficulty));
document.querySelectorAll('#diffList .diff-item').forEach((b) => b.classList.toggle('active', b.dataset.diff === G.difficulty));
window.addEventListener('pointerdown', () => Sound.unlock(), { once: true });

window.__bp8 = { G, store, startGame, Sound, particles, renderer, powerToSpeed, isMoving };
