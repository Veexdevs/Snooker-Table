/*
 * render.js — desenho da mesa, bolas, taco, mira e efeitos.
 *
 * A mesa "estática" (madeira, pano, borrachas, caçapas) é desenhada uma vez
 * num canvas fora de tela em alta resolução e reaproveitada nos quadros.
 */

import {
  BALL_R, PLAY_W, PLAY_H, CUSHION, OUTER, POCKET_CAP, POCKET_RIM,
  TABLE, DIAMONDS, ballColor, isStripe, CORNER_REACH, SIDE_REACH,
} from './table.js';
import { clamp, lerp, TAU } from './util.js';

const PAD = CUSHION + OUTER;
const FRAME_MARGIN = 46; // espaço extra para a sombra da moldura
const TABLE_W = PLAY_W + PAD * 2;
const TABLE_H = PLAY_H + PAD * 2;

const FELT_DARK = '#0d4534';
const FELT = '#16664a';
const FELT_LIGHT = '#1f7d5b';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* textura de tecido do pano (gerada uma vez) */
function makeClothTexture(size = 220) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (Math.random() - 0.5) * 90;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 26;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* desenha a mesa inteira (madeira, pano, borrachas, caçapas) no contexto
   informado. Chamado só quando o tamanho muda. */
function paintTable(ctx) {
  const cloth = makeClothTexture();

  /* ================= madeira ================= */
  // sombra da mesa (desenhada uma única vez, aqui na camada estática)
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#1b0d07';
  roundRect(ctx, -PAD, -PAD, TABLE_W, TABLE_H, 34);
  ctx.fill();
  ctx.restore();

  const woodGrad = ctx.createLinearGradient(-PAD, -PAD, PLAY_W + PAD, PLAY_H + PAD);
  woodGrad.addColorStop(0, '#3d1f11');
  woodGrad.addColorStop(0.16, '#6b3a1f');
  woodGrad.addColorStop(0.34, '#82492a');
  woodGrad.addColorStop(0.52, '#6a371d');
  woodGrad.addColorStop(0.74, '#4e2513');
  woodGrad.addColorStop(1, '#2b1409');
  ctx.fillStyle = woodGrad;
  roundRect(ctx, -PAD, -PAD, TABLE_W, TABLE_H, 34);
  ctx.fill();

  // veios
  ctx.save();
  roundRect(ctx, -PAD, -PAD, TABLE_W, TABLE_H, 34);
  ctx.clip();
  for (let i = 0; i < 120; i++) {
    const y = -PAD + Math.random() * TABLE_H;
    ctx.strokeStyle = `rgba(255,196,148,${0.012 + Math.random() * 0.03})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.6;
    ctx.beginPath();
    const bend = (Math.random() - 0.5) * 30;
    ctx.moveTo(-PAD, y);
    ctx.bezierCurveTo(PLAY_W * 0.3, y + bend, PLAY_W * 0.7, y - bend, PLAY_W + PAD, y + bend * 0.4);
    ctx.stroke();
  }
  // brilho superior da madeira
  const sheen = ctx.createLinearGradient(0, -PAD, 0, -PAD + 34);
  sheen.addColorStop(0, 'rgba(255,220,170,0.16)');
  sheen.addColorStop(1, 'rgba(255,220,170,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(-PAD, -PAD, TABLE_W, 40);
  ctx.restore();

  // bisel
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 5;
  roundRect(ctx, -PAD + 2.5, -PAD + 2.5, TABLE_W - 5, TABLE_H - 5, 32);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,225,190,0.14)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, -PAD + 7, -PAD + 7, TABLE_W - 14, TABLE_H - 14, 29);
  ctx.stroke();
  ctx.restore();

  /* ================= pano ================= */
  const feltGrad = ctx.createRadialGradient(PLAY_W * 0.4, PLAY_H * 0.32, 30, PLAY_W * 0.5, PLAY_H * 0.52, PLAY_W * 0.78);
  feltGrad.addColorStop(0, FELT_LIGHT);
  feltGrad.addColorStop(0.45, FELT);
  feltGrad.addColorStop(1, FELT_DARK);
  ctx.fillStyle = feltGrad;
  ctx.fillRect(0, 0, PLAY_W, PLAY_H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, PLAY_W, PLAY_H);
  ctx.clip();
  const pat = ctx.createPattern(cloth, 'repeat');
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, PLAY_W, PLAY_H);
  ctx.globalAlpha = 1;
  ctx.restore();

  // marcações do pano
  ctx.strokeStyle = 'rgba(235,255,245,0.10)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(PLAY_W * 0.25, 0);
  ctx.lineTo(PLAY_W * 0.25, PLAY_H);
  ctx.stroke();
  const spot = (x, y) => {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(235,255,245,0.22)';
    ctx.arc(x, y, 2.3, 0, TAU);
    ctx.fill();
  };
  spot(PLAY_W * 0.25, PLAY_H / 2);
  spot(PLAY_W * 0.75, PLAY_H / 2);

  // sombra das tabelas sobre o pano
  const edge = (x, y, w, h, gx0, gy0, gx1, gy1) => {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  const sh = 26;
  edge(0, 0, PLAY_W, sh, 0, 0, 0, sh);
  edge(0, PLAY_H - sh, PLAY_W, sh, 0, PLAY_H, 0, PLAY_H - sh);
  edge(0, 0, sh, PLAY_H, 0, 0, sh, 0);
  edge(PLAY_W - sh, 0, sh, PLAY_H, PLAY_W, 0, PLAY_W - sh, 0);

  /* ================= borrachas com mandíbulas ================= */
  const cornerChamfer = 9;
  const sideChamfer = 6;

  const cushionSegments = [
    // superior esquerda
    [
      [CORNER_REACH, 0],
      [PLAY_W / 2 - SIDE_REACH, 0],
      [PLAY_W / 2 - SIDE_REACH - sideChamfer, -CUSHION],
      [CORNER_REACH + cornerChamfer, -CUSHION],
    ],
    // superior direita
    [
      [PLAY_W / 2 + SIDE_REACH, 0],
      [PLAY_W - CORNER_REACH, 0],
      [PLAY_W - CORNER_REACH - cornerChamfer, -CUSHION],
      [PLAY_W / 2 + SIDE_REACH + sideChamfer, -CUSHION],
    ],
    // inferior esquerda
    [
      [PLAY_W / 2 - SIDE_REACH, PLAY_H],
      [CORNER_REACH, PLAY_H],
      [CORNER_REACH + cornerChamfer, PLAY_H + CUSHION],
      [PLAY_W / 2 - SIDE_REACH - sideChamfer, PLAY_H + CUSHION],
    ],
    // inferior direita
    [
      [PLAY_W - CORNER_REACH, PLAY_H],
      [PLAY_W / 2 + SIDE_REACH, PLAY_H],
      [PLAY_W / 2 + SIDE_REACH + sideChamfer, PLAY_H + CUSHION],
      [PLAY_W - CORNER_REACH - cornerChamfer, PLAY_H + CUSHION],
    ],
    // esquerda
    [
      [0, CORNER_REACH],
      [0, PLAY_H - CORNER_REACH],
      [-CUSHION, PLAY_H - CORNER_REACH - cornerChamfer],
      [-CUSHION, CORNER_REACH + cornerChamfer],
    ],
    // direita
    [
      [PLAY_W, PLAY_H - CORNER_REACH],
      [PLAY_W, CORNER_REACH],
      [PLAY_W + CUSHION, CORNER_REACH + cornerChamfer],
      [PLAY_W + CUSHION, PLAY_H - CORNER_REACH - cornerChamfer],
    ],
  ];

  const polyPath = (pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  // sombra que a borracha projeta no pano
  ctx.save();
  ctx.filter = 'blur(6px)';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (const seg of cushionSegments) {
    polyPath(seg);
    ctx.fill();
  }
  ctx.restore();

  for (const seg of cushionSegments) {
    const cx = seg.reduce((a, p) => a + p[0], 0) / seg.length;
    const cy = seg.reduce((a, p) => a + p[1], 0) / seg.length;
    // gradiente do "nariz" para a madeira
    const nose = seg[0];
    const g = ctx.createLinearGradient(nose[0], nose[1], cx, cy);
    g.addColorStop(0, '#2f9a6e');
    g.addColorStop(0.22, '#1d7a56');
    g.addColorStop(0.7, '#115c40');
    g.addColorStop(1, '#0b4630');
    polyPath(seg);
    ctx.fillStyle = g;
    ctx.fill();

    // textura da borracha
    ctx.save();
    polyPath(seg);
    ctx.clip();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = pat;
    ctx.fillRect(-PAD, -PAD, TABLE_W, TABLE_H);
    ctx.globalAlpha = 1;
    ctx.restore();

    // brilho no nariz
    polyPath(seg);
    ctx.strokeStyle = 'rgba(150,255,208,0.22)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // sombra na base (onde encosta na madeira)
    ctx.save();
    polyPath(seg);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();
  }

  /* ================= caçapas ================= */
  const drawPocket = (p) => {
    const { x, y } = p.center;
    const isCorner = p.type === 'corner';
    ctx.save();
    const cap = isCorner ? POCKET_CAP : POCKET_CAP - 1.5;
    // guarnição de couro em volta da boca (esconde a emenda com a madeira)
    const halo = ctx.createRadialGradient(x, y, cap * 0.72, x, y, cap + 11);
    halo.addColorStop(0, 'rgba(26,18,13,0.98)');
    halo.addColorStop(0.55, 'rgba(35,24,17,0.82)');
    halo.addColorStop(1, 'rgba(48,30,20,0)');
    ctx.beginPath();
    ctx.arc(x, y, cap + 11, 0, TAU);
    ctx.fillStyle = halo;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, cap, 0, TAU);
    ctx.clip();
    const g = ctx.createRadialGradient(x, y, 1, x, y, cap);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.62, '#050807');
    g.addColorStop(1, '#131c17');
    ctx.fillStyle = g;
    ctx.fillRect(x - cap, y - cap, cap * 2, cap * 2);
    // rede
    ctx.strokeStyle = 'rgba(130,160,145,0.13)';
    ctx.lineWidth = 0.7;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x - POCKET_CAP, y + i * 6.5);
      ctx.lineTo(x + POCKET_CAP, y - i * 6.5);
      ctx.stroke();
    }
    // profundidade
    const sh2 = ctx.createRadialGradient(x, y, cap * 0.25, x, y, cap);
    sh2.addColorStop(0, 'rgba(0,0,0,0.75)');
    sh2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh2;
    ctx.fillRect(x - cap, y - cap, cap * 2, cap * 2);
    ctx.restore();

    // aro metálico, aberto na boca
    const rim = ctx.createLinearGradient(x - cap, y - cap, x + cap, y + cap);
    rim.addColorStop(0, '#e6eaec');
    rim.addColorStop(0.3, '#98a1a6');
    rim.addColorStop(0.55, '#f2f5f6');
    rim.addColorStop(0.8, '#7d858a');
    rim.addColorStop(1, '#cdd3d6');
    ctx.save();
    ctx.strokeStyle = rim;
    ctx.lineWidth = POCKET_RIM;
    const mouthAng = Math.atan2(p.interior.y, p.interior.x);
    const gapAngle = isCorner ? 0.72 : 0.95;
    ctx.beginPath();
    ctx.arc(x, y, cap - POCKET_RIM * 0.5, mouthAng + gapAngle, mouthAng - gapAngle + TAU);
    ctx.stroke();
    ctx.restore();
  };
  for (const p of TABLE.pockets) drawPocket(p);

  /* ================= diamantes ================= */
  const diamondAt = (x, y) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(3, 0);
    ctx.lineTo(0, 4);
    ctx.lineTo(-3, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(244,238,214,0.82)';
    ctx.fill();
    ctx.restore();
  };
  const dOff = CUSHION + OUTER / 2 + 1;
  for (const x of DIAMONDS.top) {
    diamondAt(x, -dOff);
    diamondAt(x, PLAY_H + dOff);
  }
  for (const y of DIAMONDS.left) {
    diamondAt(-dOff, y);
    diamondAt(PLAY_W + dOff, y);
  }

  // vinheta geral
  const vig = ctx.createRadialGradient(PLAY_W / 2, PLAY_H / 2, PLAY_H * 0.4, PLAY_W / 2, PLAY_H / 2, PLAY_W * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vig;
  ctx.fillRect(-PAD, -PAD, TABLE_W, TABLE_H);
}

/* ---------------------------------------------------------------- */

export function createRenderer(canvas, bgCanvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const bgCtx = bgCanvas ? bgCanvas.getContext('2d', { alpha: true }) : null;
  let dpr = Math.min(2.5, window.devicePixelRatio || 1);
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let cssW = 0;
  let cssH = 0;
  let tableDrawn = false;
  // área reservada para o HUD (a mesa é centralizada no espaço que sobra)
  const insets = { top: 0, right: 10, bottom: 10, left: 10 };

  const baseView = { showGuide: true, aim: null, charging: false, power: 0, time: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(200, rect.width);
    cssH = Math.max(140, rect.height);
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const availW = Math.max(120, cssW - insets.left - insets.right);
    const availH = Math.max(90, cssH - insets.top - insets.bottom);
    scale = Math.min(availW / TABLE_W, availH / TABLE_H);
    ox = insets.left + (availW - TABLE_W * scale) / 2;
    oy = insets.top + (availH - TABLE_H * scale) / 2;

    if (bgCanvas && bgCtx) {
      if (bgCanvas.width !== pw || bgCanvas.height !== ph) {
        bgCanvas.width = pw;
        bgCanvas.height = ph;
      }
      // a mesa é pintada uma única vez por tamanho de tela
      const key = `${pw}x${ph}`;
      if (key !== bgKey) {
        bgKey = key;
        paintBackground();
      }
    }
  }

  let bgKey = '';

  function paintBackground() {
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.translate(ox, oy);
    bgCtx.scale(scale, scale);
    bgCtx.translate(PAD, PAD);
    paintTable(bgCtx);
    tableDrawn = true;
  }

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return {
      x: (px - ox) / scale - PAD,
      y: (py - oy) / scale - PAD,
    };
  }

  let shadowSprite = null;
  function getShadowSprite() {
    if (shadowSprite) return shadowSprite;
    const S = 96;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(0,0,0,0.55)');
    rg.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    shadowSprite = c;
    return c;
  }

  /* sombra no pano: usada apenas em massa (uma vez por bola por quadro) */
  function drawShadowEllipse(x, y, r, alpha = 0.32) {
    const s = getShadowSprite();
    ctx.save();
    ctx.globalAlpha = alpha / 0.55;
    ctx.drawImage(s, x - r * 1.5 + r * 0.3, y - r * 1.05 + r * 0.5, r * 3, r * 2.1);
    ctx.restore();
  }

  /* ------- sprites das bolas (desenhados uma vez por número) ------- */
  const SPRITE = 132;
  const spriteCache = new Map();

  function paintBall(g, num) {
    const r = SPRITE / 2 - 1;
    const cx = SPRITE / 2;
    const cy = SPRITE / 2;

    g.clearRect(0, 0, SPRITE, SPRITE);

    // esfera
    const grad = g.createRadialGradient(cx - r * 0.34, cy - r * 0.4, r * 0.14, cx + r * 0.1, cy + r * 0.12, r * 1.12);
    if (num === 0) {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.55, '#f4f0e4');
      grad.addColorStop(1, '#c6c0b0');
    } else if (num === 8) {
      grad.addColorStop(0, '#5d5d5d');
      grad.addColorStop(0.5, '#1c1c1c');
      grad.addColorStop(1, '#050505');
    } else {
      const base = ballColor(num);
      grad.addColorStop(0, lighten(base, 0.5));
      grad.addColorStop(0.5, base);
      grad.addColorStop(1, darken(base, 0.45));
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fillStyle = grad;
    g.fill();

    // listrada: faixa de cor no meio de uma esfera branca
    if (isStripe(num)) {
      g.save();
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.clip();
      g.fillStyle = '#f7f3e7';
      g.fillRect(0, 0, SPRITE, SPRITE);
      const bandH = r * 1.04;
      g.fillStyle = ballColor(num);
      g.fillRect(0, cy - bandH / 2, SPRITE, bandH);
      const sg = g.createRadialGradient(cx - r * 0.34, cy - r * 0.4, r * 0.1, cx + r * 0.1, cy + r * 0.12, r * 1.1);
      sg.addColorStop(0, 'rgba(255,255,255,0.4)');
      sg.addColorStop(0.45, 'rgba(255,255,255,0.02)');
      sg.addColorStop(1, 'rgba(0,0,0,0.4)');
      g.fillStyle = sg;
      g.fillRect(0, 0, SPRITE, SPRITE);
      g.restore();
    }

    // círculo do número
    if (num > 0) {
      g.beginPath();
      g.arc(cx, cy, r * 0.55, 0, TAU);
      g.fillStyle = '#f9f6ec';
      g.fill();
      g.beginPath();
      g.arc(cx, cy, r * 0.55, 0, TAU);
      g.strokeStyle = 'rgba(0,0,0,0.08)';
      g.lineWidth = r * 0.03;
      g.stroke();
      g.fillStyle = '#0f0f0f';
      g.font = `700 ${r * 0.78}px "Segoe UI", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(num), cx, cy + r * 0.05);
    } else {
      g.beginPath();
      g.arc(cx + r * 0.34, cy - r * 0.32, r * 0.1, 0, TAU);
      g.fillStyle = 'rgba(200,80,70,0.6)';
      g.fill();
    }

    // brilho especular
    const hg = g.createRadialGradient(cx - r * 0.36, cy - r * 0.44, 0, cx - r * 0.36, cy - r * 0.44, r * 0.75);
    hg.addColorStop(0, 'rgba(255,255,255,0.9)');
    hg.addColorStop(0.34, 'rgba(255,255,255,0.26)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fillStyle = hg;
    g.fill();

    // contorno
    g.beginPath();
    g.arc(cx, cy, r - 0.5, 0, TAU);
    g.strokeStyle = 'rgba(0,0,0,0.24)';
    g.lineWidth = 1.1;
    g.stroke();

    // leve sombreamento na base (volume)
    const vg = g.createLinearGradient(0, cy, 0, cy + r);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fillStyle = vg;
    g.fill();
  }

  function ballSprite(num) {
    if (spriteCache.has(num)) return spriteCache.get(num);
    const c = document.createElement('canvas');
    c.width = SPRITE;
    c.height = SPRITE;
    paintBall(c.getContext('2d'), num);
    spriteCache.set(num, c);
    return c;
  }

  function drawBall(ball, opts = {}) {
    const r = opts.r || BALL_R;
    const { x, y } = ball;
    const alpha = opts.alpha ?? 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (opts.shadow !== false) drawShadowEllipse(x, y, r, 0.32);
    ctx.drawImage(ballSprite(ball.number), x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawCue(view) {
    const { state, aim, power } = view;
    if (!aim || state.phase === 'gameover' || state.phase === 'shooting' || state.phase === 'resolving') return;
    if (state.ballInHand) return;
    const cue = state.balls.find((b) => b.id === 'cue');
    if (!cue || cue.pocketed) return;
    const angle = aim.angle;
    const pull = 10 + power * 62;
    const gap = BALL_R + 5 + pull;

    ctx.save();
    ctx.translate(cue.x, cue.y);
    ctx.rotate(angle);
    // desenha no eixo -x (atrás da branca)
    const len = 560;
    const buttR = 5.4;
    const tipR = 2.5;
    const x0 = -gap;
    const x1 = -gap - len;

    // sombra do taco (sem filtro: só uma cópia deslocada e translúcida)
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(x0, -tipR + 4);
    ctx.lineTo(x1, -buttR + 5);
    ctx.lineTo(x1, buttR + 5);
    ctx.lineTo(x0, tipR + 4);
    ctx.closePath();
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    // corpo (madeira)
    const grad = ctx.createLinearGradient(0, -buttR, 0, buttR);
    grad.addColorStop(0, '#e2b477');
    grad.addColorStop(0.25, '#f7dcae');
    grad.addColorStop(0.5, '#c99a5c');
    grad.addColorStop(0.78, '#8a5a2c');
    grad.addColorStop(1, '#5c3a1c');
    ctx.beginPath();
    ctx.moveTo(x0, -tipR);
    ctx.lineTo(x1, -buttR);
    ctx.lineTo(x1, buttR);
    ctx.lineTo(x0, tipR);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // parte escura do cabo
    const buttStart = x1 + 150;
    const bg = ctx.createLinearGradient(0, -buttR, 0, buttR);
    bg.addColorStop(0, '#4a3626');
    bg.addColorStop(0.4, '#241a12');
    bg.addColorStop(1, '#0e0a07');
    ctx.beginPath();
    ctx.moveTo(buttStart, -buttR * 0.96);
    ctx.lineTo(x1, -buttR);
    ctx.lineTo(x1, buttR);
    ctx.lineTo(buttStart, buttR * 0.96);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();

    // anéis decorativos
    ctx.strokeStyle = 'rgba(240, 205, 140, 0.55)';
    ctx.lineWidth = 1.1;
    for (const off of [26, 34]) {
      ctx.beginPath();
      ctx.moveTo(buttStart + off, -buttR);
      ctx.lineTo(buttStart + off, buttR);
      ctx.stroke();
    }

    // virola branca e sola
    const ferruleW = 13;
    ctx.fillStyle = '#f4f1e8';
    ctx.beginPath();
    ctx.moveTo(x0, -tipR);
    ctx.lineTo(x0 + ferruleW, -tipR * 1.12);
    ctx.lineTo(x0 + ferruleW, tipR * 1.12);
    ctx.lineTo(x0, tipR);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2f6fb5';
    ctx.beginPath();
    ctx.moveTo(x0, -tipR);
    ctx.lineTo(x0 + 3.4, -tipR * 1.02);
    ctx.lineTo(x0 + 3.4, tipR * 1.02);
    ctx.lineTo(x0, tipR);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawGuide(view) {
    const { state, aim, guide } = view;
    if (!aim || !guide || !view.showGuide) return;
    const cue = state.balls.find((b) => b.id === 'cue');
    if (!cue || cue.pocketed) return;

    const dx = Math.cos(aim.angle);
    const dy = Math.sin(aim.angle);
    const gx = guide.x;
    const gy = guide.y;

    // linha até o ponto de impacto
    ctx.save();
    ctx.setLineDash([9, 9]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(cue.x + dx * BALL_R, cue.y + dy * BALL_R);
    ctx.lineTo(gx, gy);
    ctx.stroke();
    ctx.restore();

    // "bola fantasma" no ponto de contato
    if (guide.hit && guide.hit !== 'pocket') {
      const b = guide.hit;
      const ghostX = b.x - dx * BALL_R * 2;
      const ghostY = b.y - dy * BALL_R * 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ghostX, ghostY, BALL_R, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      // direção que a bola alvo vai tomar
      const ox2 = b.x - ghostX;
      const oy2 = b.y - ghostY;
      const ol = Math.hypot(ox2, oy2) || 1;
      const px = ox2 / ol;
      const py = oy2 / ol;
      const nearPocket = nearestPocketInfo(b, px, py);
      ctx.save();
      ctx.setLineDash([6, 7]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = nearPocket ? 'rgba(120,255,170,0.65)' : 'rgba(255,225,120,0.5)';
      ctx.beginPath();
      ctx.moveTo(b.x + px * BALL_R, b.y + py * BALL_R);
      ctx.lineTo(b.x + px * (BALL_R + 95), b.y + py * (BALL_R + 95));
      ctx.stroke();
      ctx.restore();
    } else if (guide.hit === 'pocket') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(gx, gy, BALL_R * 0.8, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.restore();
    }
  }

  function nearestPocketInfo(ball, dx, dy) {
    let best = null;
    let bestDot = 0.55;
    for (const p of TABLE.pockets) {
      const vx = p.aim.x - ball.x;
      const vy = p.aim.y - ball.y;
      const l = Math.hypot(vx, vy) || 1;
      const d = (vx / l) * dx + (vy / l) * dy;
      if (d > bestDot) {
        bestDot = d;
        best = p;
      }
    }
    return best;
  }

  function drawBallInHandPreview(view) {
    const { state, pointer } = view;
    if (!state.ballInHand || !pointer) return;
    const valid = view.pointerValid;
    const pulse = 0.5 + 0.5 * Math.sin(view.time * 5);
    if (valid) {
      drawBall({ x: pointer.x, y: pointer.y, number: 0 }, { alpha: 0.92 });
    }
    ctx.save();
    ctx.globalAlpha = 0.35 + pulse * 0.35;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, BALL_R, 0, TAU);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = valid ? 'rgba(120,255,180,0.95)' : 'rgba(255,90,95,0.95)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  function drawEffects(view) {
    const { effects, time } = view;
    if (!effects) return;
    for (const e of effects) {
      const t = (time - e.t) / e.life;
      if (t < 0 || t > 1) continue;
      if (e.type === 'pocket') {
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 6 + t * 26, 0, TAU);
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 2.4 * (1 - t);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawSinkingBalls(view) {
    for (const b of view.state.balls) {
      if (!b.pocketed || b.sinkT === undefined || b.sinkT > 0.42) continue;
      const t = clamp(b.sinkT / 0.42, 0, 1);
      drawBall(b, { r: BALL_R * (1 - t * 0.85), alpha: 1 - t * 0.85 });
    }
  }

  function draw(view) {
    view.showGuide = view.showGuide !== false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.translate(PAD, PAD);

    drawSinkingBalls(view);

    // bolas (a branca desaparece enquanto está na mão)
    const inHand = view.state.ballInHand && !!view.pointer && view.state.phase !== 'shooting';
    const balls = view.state.balls.filter((b) => !b.pocketed && !(inHand && b.id === 'cue'));
    // sombras primeiro
    for (const b of balls) drawShadowEllipse(b.x, b.y, BALL_R, 0.3);
    // ordena por y para dar profundidade
    balls.sort((a, b) => a.y - b.y);
    for (const b of balls) drawBall(b);

    drawBallInHandPreview(view);
    drawCue(view);
    drawGuide(view);
    drawEffects(view);

    // dica de mira perto da branca
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function lighten(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    return `rgb(${Math.round(lerp(r, 255, amt))}, ${Math.round(lerp(g, 255, amt))}, ${Math.round(lerp(b, 255, amt))})`;
  }
  function darken(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    return `rgb(${Math.round(lerp(r, 0, amt))}, ${Math.round(lerp(g, 0, amt))}, ${Math.round(lerp(b, 0, amt))})`;
  }

  function setInsets(next) {
    const changed = ['top', 'right', 'bottom', 'left'].some((k) => next[k] !== undefined && next[k] !== insets[k]);
    Object.assign(insets, next);
    if (changed) resize();
    return changed;
  }

  return {
    resize,
    draw,
    toWorld,
    setInsets,
    get scale() { return scale; },
    get offsets() { return { ox, oy, scale }; },
    get tableDrawn() { return tableDrawn; },
  };
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

export { PAD, TABLE_W, TABLE_H, CORNER_REACH, SIDE_REACH };
