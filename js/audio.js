/*
 * audio.js — sons sintetizados (sem arquivos externos).
 * Tudo gerado com WebAudio: tacada, choque entre bolas, tabela, caçapa
 * e o som de vitória.
 */

let ctx = null;
let master = null;
let enabled = true;
let unlocked = false;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  unlocked = true;
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

export const Sound = {
  get enabled() { return enabled; },
  setEnabled(v) {
    enabled = !!v;
    if (master) master.gain.value = enabled ? 0.6 : 0;
  },
  unlock() {
    if (enabled) ensure();
  },

  /* taco batendo na bola */
  strike(power = 0.6) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + power * 900;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    env(g, t, 0.003, 0.07, 0.14 + power * 0.3);
    src.connect(bp).connect(g).connect(master);
    src.start(t);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160 + power * 90, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.09);
    const og = ctx.createGain();
    env(og, t, 0.004, 0.1, 0.1 + power * 0.18);
    osc.connect(og).connect(master);
    osc.start(t);
    osc.stop(t + 0.16);
  },

  /* bolas se chocando */
  click(speed = 400) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const v = Math.min(1, speed / 1400);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200 + v * 1800;
    const g = ctx.createGain();
    env(g, t, 0.001, 0.028, 0.05 + v * 0.22);
    src.connect(hp).connect(g).connect(master);
    src.start(t);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500 + v * 1600, t);
    const og = ctx.createGain();
    env(og, t, 0.001, 0.03, 0.03 + v * 0.14);
    osc.connect(og).connect(master);
    osc.start(t);
    osc.stop(t + 0.05);
  },

  /* bola na tabela */
  cushion(speed = 400) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const v = Math.min(1, speed / 1400);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.09);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700 + v * 700;
    const g = ctx.createGain();
    env(g, t, 0.002, 0.08, 0.05 + v * 0.2);
    src.connect(lp).connect(g).connect(master);
    src.start(t);
  },

  /* bola caindo na caçapa */
  pocket() {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.3);
    const g = ctx.createGain();
    env(g, t, 0.005, 0.32, 0.22);
    src.connect(lp).connect(g).connect(master);
    src.start(t);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(180, t);
    thud.frequency.exponentialRampToValueAtTime(90, t + 0.2);
    const tg = ctx.createGain();
    env(tg, t, 0.006, 0.22, 0.18);
    thud.connect(tg).connect(master);
    thud.start(t);
    thud.stop(t + 0.3);
  },

  /* interface */
  ui() {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 660;
    const g = ctx.createGain();
    env(g, t, 0.004, 0.06, 0.05);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.09);
  },

  win() {
    if (!enabled || !ensure()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      env(g, t, 0.01, 0.32, 0.12);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  },

  lose() {
    if (!enabled || !ensure()) return;
    const notes = [392, 349.23, 293.66];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.14;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      env(g, t, 0.01, 0.3, 0.1);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  },
};
