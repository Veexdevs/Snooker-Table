/*
 * audio.js — todo o som do jogo é sintetizado (WebAudio), sem arquivos.
 *
 * Há som para absolutamente tudo o que acontece na mesa:
 *  tacada (com intensidade), choque bola-bola, tabela, cada força de
 *  encaçapamento, bola afundando na caçapa, giz, botões, virada de turno,
 *  falta, vitória e derrota.
 */

let ctx = null;
let master = null;
let enabled = true;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.7 : 0;
    master.connect(ctx.destination);
    // compressor leve para não estourar em batidas fortes
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    master.disconnect();
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(duration = 0.2) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * duration));
  const buf = ctx.createBuffer(1, len, rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function env(gain, t0, attack, decay, peak) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function tone({ freq = 440, type = 'sine', dur = 0.12, vol = 0.08, slideTo = null, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  const g = ctx.createGain();
  env(g, t, 0.004, dur, vol);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.08);
}

function noise({ dur = 0.1, vol = 0.15, type = 'bandpass', freq = 1200, q = 1, sweepTo = null, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur + 0.02);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.002, dur, vol);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const Sound = {
  get enabled() { return enabled; },
  setEnabled(v) {
    enabled = !!v;
    if (master) master.gain.value = enabled ? 0.7 : 0;
  },
  unlock() { if (enabled) ensure(); },

  /* taco batendo na bola — muda com a força (0..1) */
  strike(power = 0.5) {
    if (!enabled || !ensure()) return;
    const p = Math.max(0.02, Math.min(1, power));
    noise({ dur: 0.05 + p * 0.05, vol: 0.1 + p * 0.34, freq: 700 + p * 1900, q: 1.1 });
    tone({ freq: 150 + p * 130, slideTo: 70, type: 'triangle', dur: 0.07 + p * 0.06, vol: 0.08 + p * 0.22 });
    if (p > 0.7) noise({ dur: 0.16, vol: 0.1 * p, type: 'lowpass', freq: 900, sweepTo: 200 });
  },

  /* choque entre bolas — o som depende da velocidade do impacto */
  click(speed = 400) {
    if (!enabled || !ensure()) return;
    const v = Math.min(1, speed / 6000);
    noise({ dur: 0.022, vol: 0.05 + v * 0.3, type: 'highpass', freq: 1400 + v * 2600 });
    tone({ freq: 1500 + v * 2200, type: 'sine', dur: 0.028, vol: 0.03 + v * 0.16 });
    if (v > 0.65) tone({ freq: 640 + v * 200, type: 'triangle', dur: 0.06, vol: 0.05 + v * 0.1 });
  },

  /* bola na tabela */
  cushion(speed = 400) {
    if (!enabled || !ensure()) return;
    const v = Math.min(1, speed / 6000);
    noise({ dur: 0.07 + v * 0.05, vol: 0.05 + v * 0.24, type: 'lowpass', freq: 620 + v * 700 });
    tone({ freq: 130 + v * 60, slideTo: 80, type: 'sine', dur: 0.07, vol: 0.03 + v * 0.12 });
  },

  /* encaçapamento: cada força soa diferente */
  pocket(speed = 300, pocketId = 0) {
    if (!enabled || !ensure()) return;
    const v = Math.min(1, speed / 6000);
    // "toc" da bola entrando na boca
    noise({ dur: 0.03, vol: 0.06 + v * 0.22, type: 'bandpass', freq: 900 + v * 800, q: 1.4 });
    // queda no saco (tom depende da caçapa, como numa mesa real)
    const base = 90 + ((pocketId * 37) % 40);
    tone({ freq: base + 40, slideTo: base * 0.6, type: 'sine', dur: 0.24 + v * 0.1, vol: 0.12 + v * 0.2 });
    tone({ freq: (base + 40) * 1.5, type: 'triangle', dur: 0.16, vol: 0.03 + v * 0.07, delay: 0.02 });
    // bola rolando no fundo, só quando entra forte
    if (v > 0.35) {
      noise({ dur: 0.24, vol: 0.05 + v * 0.14, type: 'lowpass', freq: 1200, sweepTo: 220, delay: 0.03 });
      tone({ freq: 220, slideTo: 120, type: 'sine', dur: 0.22, vol: 0.04 + v * 0.1, delay: 0.05 });
    }
    if (v > 0.7) noise({ dur: 0.5, vol: 0.06, type: 'lowpass', freq: 700, sweepTo: 120, delay: 0.08 });
  },

  /* giz na sola do taco */
  chalk() {
    if (!enabled || !ensure()) return;
    noise({ dur: 0.22, vol: 0.12, type: 'bandpass', freq: 2400, q: 0.9 });
    noise({ dur: 0.16, vol: 0.07, type: 'bandpass', freq: 3200, q: 1.2, delay: 0.1 });
    tone({ freq: 900, slideTo: 1500, type: 'sine', dur: 0.1, vol: 0.02 });
  },

  /* taco voltando / puxando */
  pull(power = 0.3) {
    if (!enabled || !ensure()) return;
    noise({ dur: 0.12, vol: 0.02 + power * 0.05, type: 'lowpass', freq: 500 + power * 500 });
  },

  /* interface */
  ui() {
    if (!enabled || !ensure()) return;
    tone({ freq: 660, type: 'sine', dur: 0.05, vol: 0.05 });
  },
  toggle(on) {
    if (!enabled) return;
    if (!ensure()) return;
    tone({ freq: on ? 520 : 380, slideTo: on ? 780 : 260, type: 'sine', dur: 0.09, vol: 0.05 });
  },
  turn() {
    if (!enabled || !ensure()) return;
    tone({ freq: 523, type: 'sine', dur: 0.1, vol: 0.05 });
    tone({ freq: 784, type: 'sine', dur: 0.12, vol: 0.04, delay: 0.09 });
  },
  foul() {
    if (!enabled || !ensure()) return;
    tone({ freq: 220, type: 'square', dur: 0.12, vol: 0.05 });
    tone({ freq: 165, type: 'square', dur: 0.18, vol: 0.05, delay: 0.12 });
  },
  potGood() {
    if (!enabled || !ensure()) return;
    tone({ freq: 880, type: 'triangle', dur: 0.1, vol: 0.06 });
    tone({ freq: 1174, type: 'triangle', dur: 0.14, vol: 0.05, delay: 0.08 });
  },
  win() {
    if (!enabled || !ensure()) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.1, delay: i * 0.1 });
    });
  },
  lose() {
    if (!enabled || !ensure()) return;
    [392, 349.23, 293.66].forEach((f, i) => {
      tone({ freq: f, type: 'sine', dur: 0.3, vol: 0.09, delay: i * 0.13 });
    });
  },
};
