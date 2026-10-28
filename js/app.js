/*
 * app.js — controla a partida: menu, entrada do jogador, turnos da IA,
 * HUD, sons e telas de fim de jogo.
 */

import {
  createGame, startShot, resolveShot, placeCueBall, cueBall, groupBalls, legalTargets,
} from './rules.js';
import { simulate, createShotLog } from './physics.js';
import { createRenderer } from './render.js';
import { planAIShot, aimGuide, DIFFICULTIES } from './ai.js';
import { Sound } from './audio.js';
import {
  PLAY_W, PLAY_H, BALL_R, ballColor, isStripe, isFreeSpot, randomFreeSpot,
} from './table.js';
import { clamp, formatNumber } from './util.js';

/* ---------------------------------------------------------------- */
/* persistência                                                     */
/* ---------------------------------------------------------------- */

const STORE_KEY = 'bp8p.pro.v1';

const store = {
  data: {
    coins: 2500,
    wins: 0,
    losses: 0,
    pots: 0,
    bestStreak: 0,
    sound: true,
    guide: true,
    difficulty: 'medium',
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

/* ---------------------------------------------------------------- */
/* elementos                                                       */
/* ---------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
const canvas = $('#table');
const bgCanvas = $('#table-bg');
const renderer = createRenderer(canvas, bgCanvas);

const el = {
  screens: { menu: $('#screen-menu'), game: $('#screen-game') },
  panels: [$('#panel0'), $('#panel1')],
  names: [$('#name0'), $('#name1')],
  groups: [$('#group0'), $('#group1')],
  potted: [$('#potted0'), $('#potted1')],
  toast: $('#toast'),
  think: $('#think'),
  thinkText: $('#thinkText'),
  powerFill: $('#powerFill'),
  powerPct: $('#powerPct'),
  shotHelp: $('#shotHelp'),
  spinPad: $('#spinPad'),
  spinDot: $('#spinDot'),
  coins: $('#coinValue'),
  btnSound: $('#btn-sound'),
  btnGuide: $('#btn-guide'),
  overlayMenu: $('#overlay-menu'),
  overlayHelp: $('#overlay-help'),
  overlayEnd: $('#overlay-end'),
  overlayDiff: $('#overlay-diff'),
  endBadge: $('#endBadge'),
  endTitle: $('#endTitle'),
  endReason: $('#endReason'),
  endStats: $('#endStats'),
  confetti: $('#confetti'),
  menuStats: {
    wins: $('#statWins'), losses: $('#statLosses'), pots: $('#statPots'), streak: $('#statStreak'),
  },
};

/* ---------------------------------------------------------------- */
/* estado do app                                                    */
/* ---------------------------------------------------------------- */

const G = {
  state: null,
  log: null,
  renderer,
  mode: 'ai',
  difficulty: store.data.difficulty || 'medium',
  aim: { angle: 0 },
  power: 0,
  charging: false,
  chargeStart: 0,
  pointer: null,
  pointerValid: false,
  showGuide: store.data.guide !== false,
  effects: [],
  draggingCue: false,
  token: 0,
  timers: [],
  last: 0,
  frameId: null,
  potSoundCount: 0,
  toastTimer: null,
  aiPlaying: false,
};

/* ---------------------------------------------------------------- */
/* utilidades de UI                                                 */
/* ---------------------------------------------------------------- */

function showScreen(name) {
  Object.entries(el.screens).forEach(([key, node]) => node.classList.toggle('active', key === name));
  syncInsets();
  renderer.resize();
}

function openOverlay(node) { node.classList.add('open'); }
function closeOverlay(node) { node.classList.remove('open'); }

function hideToast() {
  el.toast.className = 'toast';
  clearTimeout(G.toastTimer);
}

function toast(message, kind = '') {
  if (!message) { hideToast(); return; }
  el.toast.textContent = message;
  el.toast.className = `toast show ${kind}`;
  clearTimeout(G.toastTimer);
  G.toastTimer = setTimeout(() => {
    el.toast.className = `toast ${kind}`;
  }, 2800);
}

function updateCoins(animate = false) {
  el.coins.textContent = formatNumber(store.data.coins);
  if (animate) {
    el.coins.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
      { duration: 380, easing: 'ease-out' },
    );
  }
}

function updateMenuStats() {
  el.menuStats.wins.textContent = formatNumber(store.data.wins);
  el.menuStats.losses.textContent = formatNumber(store.data.losses);
  el.menuStats.pots.textContent = formatNumber(store.data.pots);
  el.menuStats.streak.textContent = formatNumber(store.data.bestStreak);
}

function updatePowerUI() {
  const pct = Math.round(G.power * 100);
  el.powerFill.style.width = `${G.power * 100}%`;
  el.powerPct.textContent = `${pct}%`;
  canvas.classList.toggle('charging', G.charging);
}

function setSpinUI(x, y) {
  el.spinDot.style.transform = `translate(calc(-50% + ${x * 17}px), calc(-50% + ${y * 17}px))`;
}

/* ---------------------------------------------------------------- */
/* HUD dos jogadores                                                */
/* ---------------------------------------------------------------- */

function miniBall(number, pocketed, extraClass = '') {
  const stripe = isStripe(number);
  const color = ballColor(number);
  const cls = ['mini-ball', stripe ? 'stripe' : 'solid', pocketed ? 'is-potted' : 'is-left', extraClass]
    .filter(Boolean).join(' ');
  const style = pocketed ? `--c:${color};opacity:.32;filter:grayscale(.55)` : `--c:${color}`;
  return `<div class="${cls}" style="${style}" title="${number}"><span>${number}</span></div>`;
}

function renderPottedStrip(index) {
  const state = G.state;
  const player = state.players[index];
  const strip = el.potted[index];
  if (!strip) return;
  if (state.mode === 'practice') {
    const potted = state.balls.filter((b) => b.pocketed && b.number > 0);
    strip.innerHTML = potted.length
      ? potted.map((b) => miniBall(b.number, false)).join('')
      : '<span class="strip-hint">treino livre · Shift+clique move a branca</span>';
    return;
  }
  const group = player.group;
  if (!group) {
    strip.innerHTML = Array.from({ length: 7 }, () => '<div class="mini-ball empty"></div>').join('');
    return;
  }
  const numbers = group === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
  const eightPotted = state.balls.find((b) => b.number === 8)?.pocketed;
  strip.innerHTML = numbers.map((n) => {
    const ball = state.balls.find((b) => b.number === n);
    return miniBall(n, !!ball?.pocketed);
  }).join('') + miniBall(8, !!eightPotted, 'eight');
}

function updateHUD() {
  const state = G.state;
  if (!state) return;

  for (const i of [0, 1]) {
    const player = state.players[i];
    const panel = el.panels[i];
    const isTurn = state.mode === 'practice' ? i === 0 : state.turn === i;
    const active = isTurn && state.phase !== 'gameover';
    panel.classList.toggle('active', active);
    panel.classList.toggle('ai', player.isAI);

    const group = player.group;
    let groupText = 'grupo aberto';
    let groupClass = '';
    if (state.mode === 'practice') {
      groupText = 'mesa livre';
    } else if (group) {
      const left = groupBalls(state, group).length;
      groupText = group === 'solid' ? 'lisas 1–7' : 'listradas 9–15';
      groupClass = group;
      if (left === 0) groupText = 'bola 8!';
    }
    el.groups[i].textContent = groupText;
    el.groups[i].className = `group-pill ${groupClass}`;
    renderPottedStrip(i);
  }

  const humanTurn = !state.players[state.turn]?.isAI && state.phase !== 'gameover';
  el.shotHelp.textContent = state.ballInHand
    ? 'Bola na mão: clique numa posição livre para reposicionar a branca'
    : humanTurn
      ? 'Mova para mirar · segure para carregar · solte para tacar'
      : 'Aguarde a jogada do adversário…';
  canvas.classList.toggle('ballinhand', state.ballInHand && humanTurn);
}

/* ---------------------------------------------------------------- */
/* partida                                                          */
/* ---------------------------------------------------------------- */

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

function startGame({ mode = 'ai', difficulty = G.difficulty, playerName, opponentName }) {
  clearTimers();
  G.mode = mode;
  G.difficulty = difficulty;
  const names = mode === 'ai'
    ? [playerName || 'Você', opponentName || `Computador · ${DIFFICULTIES[difficulty]?.name || 'Pro'}`]
    : mode === 'local'
      ? ['Jogador 1', 'Jogador 2']
      : ['Treino livre', 'Mesa profissional'];

  const state = createGame({ mode, difficulty, names });
  state.players[1].isAI = mode === 'ai';
  state.players[0].isAI = false;
  if (mode === 'practice') {
    state.turn = 0;
    state.message = 'Treino livre: derrube as 15 bolas. Shift+clique move a branca.';
  }
  G.state = state;
  G.aiPlaying = false;
  G.log = createShotLog();
  G.power = 0;
  G.charging = false;
  G.effects = [];
  G.pointer = null;
  G.potSoundCount = 0;
  G.aim.angle = 0;
  updatePowerUI();
  setSpinUI(0, 0);
  state.shot.spin = { x: 0, y: 0 };

  el.names[0].textContent = names[0];
  el.names[1].textContent = names[1];
  el.panels[0].querySelector('.avatar').textContent = names[0].slice(0, 1).toUpperCase();
  el.panels[1].querySelector('.avatar').textContent = names[1].slice(0, 1).toUpperCase();

  closeOverlay(el.overlayEnd);
  closeOverlay(el.overlayDiff);
  closeOverlay(el.overlayMenu);
  stopConfetti();
  showScreen('game');
  updateHUD();
  updateCoins();
  toast(state.message || 'Boa sorte!', 'good');
  requestAnimationFrame(() => {
    syncInsets();
    renderer.resize();
    if (G.state.players[G.state.turn]?.isAI) scheduleAI();
  });
  if (!G.frameId) loop(performance.now());
  pointAtNearestTarget();
}

function doShoot(angle, power, spin) {
  const state = G.state;
  if (!state || (state.phase !== 'aim' && state.phase !== 'ballinhand')) return;
  if (state.ballInHand) return;
  G.aim.angle = angle;
  G.power = clamp(power, 0.05, 1);
  state.shot.spin = spin || { x: 0, y: 0 };
  G.log = createShotLog();
  G.potSoundCount = 0;
  state.phase = 'shooting';
  startShot(state, { angle, power: G.power, spin: state.shot.spin });
  Sound.strike(G.power);
  G.charging = false;
  updatePowerUI();
  updateHUD();
  hideToast();
}

/* aponta a mira para a bola legal mais próxima (evita mirar no vazio) */
function pointAtNearestTarget() {
  const state = G.state;
  if (!state) return;
  const cue = cueBall(state);
  if (!cue || cue.pocketed) return;
  const targets = legalTargets(state, state.turn).filter((b) => b.number !== 0);
  if (!targets.length) return;
  let best = targets[0];
  let bd = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - cue.x, t.y - cue.y);
    if (d < bd) { bd = d; best = t; }
  }
  G.aim.angle = Math.atan2(best.y - cue.y, best.x - cue.x);
}

function humanShoot() {
  const state = G.state;
  if (!state || state.phase !== 'aim') return;
  const power = Math.max(0.055, G.power);
  doShoot(G.aim.angle, power, { ...state.shot.spin });
  G.power = 0;
  updatePowerUI();
  setSpinUI(0, 0);
  state.shot.spin = { x: 0, y: 0 };
}

/* ---------------------------------------------------------------- */
/* IA                                                               */
/* ---------------------------------------------------------------- */

function scheduleAI() {
  const state = G.state;
  if (!state || state.phase === 'gameover') return;
  const player = state.players[state.turn];
  if (!player?.isAI) return;
  if (G.aiPlaying) return;
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
      if (!placed) {
        // último recurso: força a branca no ponto livre mais próximo
        const cue = cueBall(state);
        for (let r = 0; r < 60 && !placed; r++) {
          for (let a = 0; a < 12 && !placed; a++) {
            const ang = (a / 12) * Math.PI * 2;
            placed = placeCueBall(state, cue.x + Math.cos(ang) * r * 6, cue.y + Math.sin(ang) * r * 6);
          }
        }
      }
    }

    G.aim.angle = plan.angle;
    G.power = plan.power;
    updatePowerUI();
    updateHUD();

    later(() => {
      el.think.hidden = true;
      G.aiPlaying = false;
      if (!G.state || G.state.phase === 'gameover' || G.state.phase === 'shooting') return;
      doShoot(plan.angle, plan.power, plan.spin || { x: 0, y: 0 });
    }, 420 + Math.random() * 320);
  }, 560 + Math.random() * 520);
}

/* ---------------------------------------------------------------- */
/* fim da tacada                                                    */
/* ---------------------------------------------------------------- */

function drainSounds() {
  const log = G.log;
  if (!log) return;
  const contacts = log.contacts.splice(0, log.contacts.length);
  contacts.sort((a, b) => b.speed - a.speed);
  contacts.slice(0, 3).forEach((c) => Sound.click(c.speed));
  const cushions = log.cushionHits.splice(0, log.cushionHits.length);
  cushions.sort((a, b) => b.speed - a.speed);
  cushions.slice(0, 2).forEach((c) => Sound.cushion(c.speed));
  if (log.pocketed.length > G.potSoundCount) {
    G.potSoundCount = log.pocketed.length;
    Sound.pocket();
  }
}

function addPocketEffects() {
  const state = G.state;
  for (const b of state.balls) {
    if (b.pocketed && b.fx !== true) {
      b.fx = true;
      G.effects.push({
        type: 'pocket',
        x: b.x,
        y: b.y,
        t: performance.now() / 1000,
        life: 0.55,
      });
    }
    if (!b.pocketed) b.fx = false;
  }
}

function finishShot() {
  const state = G.state;
  if (!state) return;

  if (state.mode === 'practice') {
    finishPracticeShot();
    return;
  }

  const res = resolveShot(state, G.log);
  updateHUD();

  if (res.gameOver) {
    const humanWon = res.winner === 0;
    if (state.mode === 'ai') {
      store.data[humanWon ? 'wins' : 'losses'] += 1;
      store.data.pots += state.stats.potted;
      store.data.bestStreak = Math.max(store.data.bestStreak, state.stats.bestStreak);
      store.data.coins += humanWon ? 180 : 45;
      store.save();
      updateCoins(true);
    }
    Sound[humanWon || state.mode === 'local' ? 'win' : 'lose']();
    later(() => showEnd(res), 700);
    return;
  }

  const kind = res.foul ? 'foul' : res.continueTurn ? 'good' : '';
  toast(res.message, kind);

  if (state.ballInHand) {
    canvas.classList.add('ballinhand');
  }
  updateHUD();

  if (state.players[state.turn]?.isAI) {
    later(scheduleAI, 650);
  } else if (state.phase === 'aim') {
    pointAtNearestTarget();
  }
}

function finishPracticeShot() {
  const state = G.state;
  const log = G.log;
  const potted = log.pocketed
    .map((id) => state.balls.find((b) => b.id === id))
    .filter((b) => b && b.number > 0)
    .map((b) => b.number);

  if (potted.length) store.data.pots += potted.length;

  if (log.cuePocketed) {
    const cue = cueBall(state);
    cue.pocketed = false;
    cue.pocketId = null;
    cue.sinkT = 0;
    const spot = randomFreeSpot(state, PLAY_W * 0.1, PLAY_W * 0.6);
    cue.x = spot.x;
    cue.y = spot.y;
    cue.vx = 0;
    cue.vy = 0;
    toast('Branca na caixa. Shift+clique para reposicionar.', 'foul');
  } else if (potted.length) {
    const rest = state.balls.filter((b) => !b.pocketed && b.number > 0).length;
    store.save();
    toast(rest === 0 ? 'Mesa limpa! Você encaçapou todas.' : `${potted.length} bola(s) na caçapa · faltam ${rest}`, 'good');
  } else {
    toast('Shift+clique move a branca', '');
  }

  state.phase = 'aim';
  state.turn = 0;
  state.ballInHand = false;
  updateHUD();
  updateCoins();
}

function showEnd(res) {
  const state = G.state;
  const humanWon = state.mode === 'local' ? true : res.winner === 0;
  const winnerName = state.players[res.winner]?.name || '—';
  el.endBadge.textContent = humanWon ? '🏆' : '💥';
  el.endTitle.textContent = state.mode === 'local'
    ? `${winnerName} venceu!`
    : humanWon ? 'Vitória!' : 'Derrota';
  el.endReason.textContent = res.message || state.winnerReason || '';
  el.endStats.innerHTML = `
    <div><b>${state.stats.potted}</b><small>bolas suas</small></div>
    <div><b>${state.stats.fouls}</b><small>faltas</small></div>
    <div><b>${state.shots}</b><small>tacadas</small></div>`;
  openOverlay(el.overlayEnd);
  if (humanWon) startConfetti();
}

/* ---------------------------------------------------------------- */
/* confete                                                          */
/* ---------------------------------------------------------------- */

const confetti = {
  ctx: null, parts: [], raf: null, until: 0,
};

function startConfetti() {
  const c = el.confetti;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = window.innerWidth * dpr;
  c.height = window.innerHeight * dpr;
  c.style.width = '100%';
  c.style.height = '100%';
  confetti.ctx = c.getContext('2d');
  confetti.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#f3c85c', '#3ddc84', '#ff5a5f', '#63a6ff', '#ffffff', '#c084fc'];
  confetti.parts = Array.from({ length: 140 }, () => ({
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
    ctx.fillStyle = p.color;
    ctx.globalAlpha = now > confetti.until ? Math.max(0, 1 - (now - confetti.until) / 600) : 1;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  if (now < confetti.until + 700) {
    confetti.raf = requestAnimationFrame(confettiTick);
  } else {
    stopConfetti();
  }
}

function stopConfetti() {
  if (confetti.raf) cancelAnimationFrame(confetti.raf);
  confetti.raf = null;
  el.confetti.classList.remove('on');
  if (confetti.ctx) confetti.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

/* ---------------------------------------------------------------- */
/* loop principal                                                   */
/* ---------------------------------------------------------------- */

function loop(now) {
  G.frameId = requestAnimationFrame(loop);
  const state = G.state;
  const dt = Math.min(0.045, (now - (G.last || now)) / 1000);
  G.last = now;
  // relógio único para animações e carga de força (performance.now),
  // independente da base de tempo do requestAnimationFrame
  const clock = performance.now();
  const time = clock / 1000;

  if (state) {
    if (state.phase === 'shooting') {
      const moving = simulate(state, dt, G.log);
      drainSounds();
      addPocketEffects();
      if (!moving) {
        state.phase = 'resolving';
        G.charging = false;
        updatePowerUI();
        later(finishShot, 260);
      }
    }

    if (G.charging && state.phase === 'aim') {
      const held = (clock - G.chargeStart) / 1000;
      G.power = clamp(0.05 + held * 1.25, 0.05, 1);
      updatePowerUI();
    }

    const humanCanAim = !state.players[state.turn]?.isAI && state.phase === 'aim';
    const guide = G.showGuide && humanCanAim ? aimGuide(state, G.aim.angle) : null;

    renderer.draw({
      state,
      aim: G.aim,
      guide,
      power: G.power,
      showGuide: G.showGuide,
      time,
      pointer: G.pointer,
      pointerValid: G.pointerValid,
      effects: G.effects,
      charging: G.charging,
    });
  }
}

/* ---------------------------------------------------------------- */
/* entrada                                                          */
/* ---------------------------------------------------------------- */

function pointerWorld(ev) {
  return renderer.toWorld(ev.clientX, ev.clientY);
}

function humanCanAct() {
  const state = G.state;
  if (!state) return false;
  if (state.phase === 'gameover' || state.phase === 'shooting' || state.phase === 'resolving') return false;
  return !state.players[state.turn]?.isAI || state.mode === 'practice';
}

canvas.addEventListener('pointermove', (ev) => {
  const state = G.state;
  if (!state) return;
  const p = pointerWorld(ev);
  G.pointer = p;

  if (state.mode === 'practice' && G.draggingCue) {
    const cue = cueBall(state);
    if (cue) {
      cue.x = clamp(p.x, BALL_R, PLAY_W - BALL_R);
      cue.y = clamp(p.y, BALL_R, PLAY_H - BALL_R);
      G.pointerValid = isFreeSpot(state, cue.x, cue.y);
    }
    return;
  }

  if (state.ballInHand && humanCanAct()) {
    const cx = clamp(p.x, BALL_R, PLAY_W - BALL_R);
    const cy = clamp(p.y, BALL_R, PLAY_H - BALL_R);
    G.pointerValid = isFreeSpot(state, cx, cy);
    G.pointer = { x: cx, y: cy };
    canvas.classList.toggle('invalid', !G.pointerValid);
    return;
  }

  if (humanCanAct()) {
    const cue = cueBall(state);
    if (cue && !cue.pocketed) {
      // mirar também enquanto carrega a força (arrastar = ajuste fino)
      G.aim.angle = Math.atan2(p.y - cue.y, p.x - cue.x);
    }
  }
});

canvas.addEventListener('pointerdown', (ev) => {
  Sound.unlock();
  const state = G.state;
  if (!state) return;
  canvas.setPointerCapture?.(ev.pointerId);
  const p = pointerWorld(ev);

  if (state.mode === 'practice' && (ev.shiftKey || G.draggingCue)) {
    const cue = cueBall(state);
    if (cue) {
      G.draggingCue = true;
      if (ev.shiftKey) {
        cue.x = clamp(p.x, BALL_R, PLAY_W - BALL_R);
        cue.y = clamp(p.y, BALL_R, PLAY_H - BALL_R);
      }
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
      G.charging = false;
      pointAtNearestTarget();
      updateHUD();
      toast('Branca posicionada. Mire e tace.', '');
    }
    return;
  }

  if (state.phase !== 'aim') return;

  // mira no ponto tocado e começa a carregar
  const cue = cueBall(state);
  if (cue) G.aim.angle = Math.atan2(p.y - cue.y, p.x - cue.x);
  G.charging = true;
  G.chargeStart = performance.now();
  G.power = 0.05;
});

function releaseShot() {
  if (!G.charging) return;
  const state = G.state;
  G.charging = false;
  if (!state || state.phase !== 'aim' || !humanCanAct()) {
    G.power = 0;
    updatePowerUI();
    return;
  }
  humanShoot();
}

canvas.addEventListener('pointerup', () => {
  G.draggingCue = false;
  releaseShot();
});
canvas.addEventListener('pointercancel', () => { G.charging = false; G.draggingCue = false; });
canvas.addEventListener('pointerleave', () => {
  if (G.charging) releaseShot();
});

canvas.addEventListener('wheel', (ev) => {
  const state = G.state;
  if (!state || !humanCanAct() || state.ballInHand) return;
  ev.preventDefault();
  const dir = Math.sign(ev.deltaY);
  G.aim.angle += dir * 0.006;
}, { passive: false });

window.addEventListener('keydown', (ev) => {
  const state = G.state;
  if (ev.code === 'Escape') {
    if (el.overlayEnd.classList.contains('open')) return;
    if (document.querySelector('.overlay.open')) {
      document.querySelectorAll('.overlay.open').forEach(closeOverlay);
      return;
    }
    if (state && el.screens.game.classList.contains('active')) openOverlay(el.overlayMenu);
    return;
  }
  if (!state || !humanCanAct() || state.ballInHand) return;
  if (ev.code === 'ArrowLeft') { G.aim.angle -= ev.shiftKey ? 0.0015 : 0.009; ev.preventDefault(); }
  if (ev.code === 'ArrowRight') { G.aim.angle += ev.shiftKey ? 0.0015 : 0.009; ev.preventDefault(); }
  if (ev.code === 'Space' || ev.code === 'Enter') {
    ev.preventDefault();
    if (!G.charging) {
      G.charging = true;
      G.chargeStart = performance.now();
      G.power = 0.05;
      updatePowerUI();
    }
  }
});

window.addEventListener('keyup', (ev) => {
  if (ev.code === 'Space' || ev.code === 'Enter') {
    releaseShot();
  }
});

/* efeito (spin) */
function setSpinFromEvent(ev) {
  const rect = el.spinPad.getBoundingClientRect();
  const r = rect.width / 2;
  if (!r) return;
  let dx = (ev.clientX - rect.left - r) / (r * 0.82);
  let dy = (ev.clientY - rect.top - r) / (r * 0.82);
  const d = Math.hypot(dx, dy);
  if (d > 1) { dx /= d; dy /= d; }
  const state = G.state;
  if (state) state.shot.spin = { x: dx, y: -dy };
  setSpinUI(dx, dy);
  el.spinPad.classList.toggle('active', d > 0.05);
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
el.spinPad.addEventListener('dblclick', () => {
  if (G.state) G.state.shot.spin = { x: 0, y: 0 };
  setSpinUI(0, 0);
  el.spinPad.classList.remove('active');
});

/* ---------------------------------------------------------------- */
/* menu e botões                                                    */
/* ---------------------------------------------------------------- */

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

$('#btn-start-ai').addEventListener('click', () => {
  Sound.ui();
  startGame({ mode: 'ai', difficulty: G.difficulty });
});

$('#btn-help').addEventListener('click', () => { openOverlay(el.overlayHelp); Sound.ui(); });
$('#btn-guide').addEventListener('click', () => {
  G.showGuide = !G.showGuide;
  el.btnGuide.classList.toggle('on', G.showGuide);
  $('#optGuide').checked = G.showGuide;
  store.data.guide = G.showGuide;
  store.save();
  Sound.ui();
});
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
  if (on) Sound.ui();
});

$('#btn-menu').addEventListener('click', () => {
  if (el.screens.game.classList.contains('active')) openOverlay(el.overlayMenu);
  else { openOverlay(el.overlayHelp); }
  Sound.ui();
});

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const node = document.getElementById(btn.dataset.close);
    if (node) closeOverlay(node);
    Sound.ui();
  });
});

$('#btn-again').addEventListener('click', () => {
  if (!G.state) return;
  startGame({ mode: G.mode, difficulty: G.difficulty });
});
$('#btn-restart-menu').addEventListener('click', () => {
  closeOverlay(el.overlayMenu);
  startGame({ mode: G.mode, difficulty: G.difficulty });
});
$('#btn-home-menu').addEventListener('click', goHome);
$('#btn-exit').addEventListener('click', goHome);
$('#btn-back-menu').addEventListener('click', goHome);
$('#btn-rematch').addEventListener('click', () => {
  closeOverlay(el.overlayEnd);
  startGame({ mode: G.mode, difficulty: G.difficulty });
});

function goHome() {
  clearTimers();
  G.aiPlaying = false;
  closeOverlay(el.overlayEnd);
  closeOverlay(el.overlayMenu);
  stopConfetti();
  updateMenuStats();
  updateCoins();
  showScreen('menu');
}

/* ---------------------------------------------------------------- */
/* inicialização                                                    */
/* ---------------------------------------------------------------- */

/* reserva o espaço do HUD para a mesa não ficar escondida atrás dele */
function syncInsets() {
  const gameActive = el.screens.game.classList.contains('active');
  const panel = el.panels[0];
  let top = 10;
  if (gameActive && panel) {
    const h = panel.getBoundingClientRect().height || 0;
    top = Math.round(h) + 22;
  }
  renderer.setInsets({ top, left: 10, right: 10, bottom: 10 });
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

syncInsets();
renderer.resize();
updateCoins();
updateMenuStats();
updateHUD();
el.btnGuide.classList.toggle('on', G.showGuide);
$('#optGuide').checked = G.showGuide;
el.btnSound.classList.toggle('off', !store.data.sound);
Sound.setEnabled(store.data.sound !== false);
document.querySelectorAll('.diff-chip').forEach((c) => c.classList.toggle('active', c.dataset.diff === G.difficulty));
document.querySelectorAll('#diffList .diff-item').forEach((b) => b.classList.toggle('active', b.dataset.diff === G.difficulty));

// primeiro clique libera o áudio
window.addEventListener('pointerdown', () => Sound.unlock(), { once: true });

// gancho de depuração/uso manual
window.__bp8 = { G, store, startGame };
