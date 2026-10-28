/*
 * render.js — desenho da mesa no estilo 8 Ball Pool:
 *   pano azul, tabelas de veludo vermelho, moldura escura, caçapas apertadas.
 *
 * As bolas são desenhadas como esferas de verdade: cada uma tem uma matriz
 * de rotação e as listras/numero são projetados na superfície, então giram,
 * somem no fundo da bola e voltam — como numa bola real.
 */

import {
  BALL_R, PLAY_W, PLAY_H, CUSHION, OUTER, POCKET_CAP, POCKET_RIM,
  TABLE, DIAMONDS, ballColor, isStripe, CORNER_REACH, SIDE_REACH,
} from './table.js';
import { clamp, lerp, TAU } from './util.js';

const PAD = CUSHION + OUTER;
const TABLE_W = PLAY_W + PAD * 2;
const TABLE_H = PLAY_H + PAD * 2;
const FRAME_MARGIN = 40;

/* --- paleta --- */
const FELT = '#1c74c0';
const FELT_LIGHT = '#2f8edb';
const FELT_DARK = '#0e5192';
const RAIL_RED = '#8d1f30';
const RAIL_RED_LIGHT = '#b42c3d';
const RAIL_RED_DARK = '#51101c';
const FRAME = '#101a2c';
const FRAME_LIGHT = '#1c2b45';
const METAL = '#c9d2de';

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

function makeClothTexture(size = 200) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (Math.random() - 0.5) * 80;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 22;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ======================= mesa ======================= */
export function paintTable(ctx) {
  const cloth = makeClothTexture();

  /* --- moldura externa --- */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  const frameGrad = ctx.createLinearGradient(-PAD, -PAD, PLAY_W + PAD, PLAY_H + PAD);
  frameGrad.addColorStop(0, '#243352');
  frameGrad.addColorStop(0.3, FRAME);
  frameGrad.addColorStop(0.62, '#0b1220');
  frameGrad.addColorStop(1, '#1a2740');
  ctx.fillStyle = frameGrad;
  roundRect(ctx, -PAD, -PAD, TABLE_W, TABLE_H, 36);
  ctx.fill();
  ctx.restore();

  // brilho superior da moldura
  const sheen = ctx.createLinearGradient(0, -PAD, 0, -PAD + 46);
  sheen.addColorStop(0, 'rgba(140,175,230,0.20)');
  sheen.addColorStop(1, 'rgba(140,175,230,0)');
  ctx.fillStyle = sheen;
  roundRect(ctx, -PAD + 2, -PAD + 2, TABLE_W - 4, 52, 34);
  ctx.fill();

  // linha metálica interna
  ctx.strokeStyle = 'rgba(200,215,240,0.20)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, -PAD + 8, -PAD + 8, TABLE_W - 16, TABLE_H - 16, 30);
  ctx.stroke();

  /* --- tabelas (veludo vermelho) --- */
  const cornerChamfer = 10;
  const sideChamfer = 7;
  const railSegments = [
    // topo esquerdo
    [[CORNER_REACH, 0], [PLAY_W / 2 - SIDE_REACH, 0],
      [PLAY_W / 2 - SIDE_REACH - sideChamfer, -CUSHION], [CORNER_REACH + cornerChamfer, -CUSHION]],
    // topo direito
    [[PLAY_W / 2 + SIDE_REACH, 0], [PLAY_W - CORNER_REACH, 0],
      [PLAY_W - CORNER_REACH - cornerChamfer, -CUSHION], [PLAY_W / 2 + SIDE_REACH + sideChamfer, -CUSHION]],
    // base esquerda
    [[PLAY_W / 2 - SIDE_REACH, PLAY_H], [CORNER_REACH, PLAY_H],
      [CORNER_REACH + cornerChamfer, PLAY_H + CUSHION], [PLAY_W / 2 - SIDE_REACH - sideChamfer, PLAY_H + CUSHION]],
    // base direita
    [[PLAY_W - CORNER_REACH, PLAY_H], [PLAY_W / 2 + SIDE_REACH, PLAY_H],
      [PLAY_W / 2 + SIDE_REACH + sideChamfer, PLAY_H + CUSHION], [PLAY_W - CORNER_REACH - cornerChamfer, PLAY_H + CUSHION]],
    // esquerda
    [[0, CORNER_REACH], [0, PLAY_H - CORNER_REACH],
      [-CUSHION, PLAY_H - CORNER_REACH - cornerChamfer], [-CUSHION, CORNER_REACH + cornerChamfer]],
    // direita
    [[PLAY_W, PLAY_H - CORNER_REACH], [PLAY_W, CORNER_REACH],
      [PLAY_W + CUSHION, CORNER_REACH + cornerChamfer], [PLAY_W + CUSHION, PLAY_H - CORNER_REACH - cornerChamfer]],
  ];

  const polyPath = (pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  // sombra da tabela no pano
  ctx.save();
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (const seg of railSegments) { polyPath(seg); ctx.fill(); }
  ctx.restore();

  for (const seg of railSegments) {
    const cx = seg.reduce((a, p) => a + p[0], 0) / seg.length;
    const cy = seg.reduce((a, p) => a + p[1], 0) / seg.length;
    const nose = seg[0];
    const g = ctx.createLinearGradient(nose[0], nose[1], cx, cy);
    g.addColorStop(0, '#c33449');
    g.addColorStop(0.18, RAIL_RED_LIGHT);
    g.addColorStop(0.55, RAIL_RED);
    g.addColorStop(1, RAIL_RED_DARK);
    polyPath(seg);
    ctx.fillStyle = g;
    ctx.fill();

    // textura do veludo
    ctx.save();
    polyPath(seg);
    ctx.clip();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = ctx.createPattern(cloth, 'repeat');
    ctx.fillRect(-PAD, -PAD, TABLE_W, TABLE_H);
    ctx.globalAlpha = 1;
    ctx.restore();

    // nariz iluminado
    polyPath(seg);
    ctx.strokeStyle = 'rgba(255,150,160,0.28)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  /* --- pano azul --- */
  const feltGrad = ctx.createRadialGradient(PLAY_W * 0.42, PLAY_H * 0.3, 30, PLAY_W * 0.5, PLAY_H * 0.55, PLAY_W * 0.8);
  feltGrad.addColorStop(0, FELT_LIGHT);
  feltGrad.addColorStop(0.45, FELT);
  feltGrad.addColorStop(1, FELT_DARK);
  ctx.fillStyle = feltGrad;
  ctx.fillRect(0, 0, PLAY_W, PLAY_H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, PLAY_W, PLAY_H);
  ctx.clip();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = ctx.createPattern(cloth, 'repeat');
  ctx.fillRect(0, 0, PLAY_W, PLAY_H);
  ctx.globalAlpha = 1;
  ctx.restore();

  // marcações
  ctx.strokeStyle = 'rgba(190,230,255,0.14)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(PLAY_W * 0.25, 0);
  ctx.lineTo(PLAY_W * 0.25, PLAY_H);
  ctx.stroke();
  const spot = (x, y) => {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(200,235,255,0.28)';
    ctx.arc(x, y, 2.3, 0, TAU);
    ctx.fill();
  };
  spot(PLAY_W * 0.25, PLAY_H / 2);
  spot(PLAY_W * 0.75, PLAY_H / 2);

  // sombra das tabelas no pano
  const edge = (x, y, w, h, gx0, gy0, gx1, gy1) => {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(0,0,0,0.38)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  const sh = 22;
  edge(0, 0, PLAY_W, sh, 0, 0, 0, sh);
  edge(0, PLAY_H - sh, PLAY_W, sh, 0, PLAY_H, 0, PLAY_H - sh);
  edge(0, 0, sh, PLAY_H, 0, 0, sh, 0);
  edge(PLAY_W - sh, 0, sh, PLAY_H, PLAY_W, 0, PLAY_W - sh, 0);

  /* --- caçapas --- */
  for (const p of TABLE.pockets) {
    const { x, y } = p.center;
    const isCorner = p.type === 'corner';
    const cap = isCorner ? POCKET_CAP : POCKET_CAP - 1.5;

    // guarnição de couro
    const halo = ctx.createRadialGradient(x, y, cap * 0.7, x, y, cap + 12);
    halo.addColorStop(0, 'rgba(14,10,18,0.98)');
    halo.addColorStop(0.6, 'rgba(30,16,26,0.86)');
    halo.addColorStop(1, 'rgba(60,20,34,0)');
    ctx.beginPath();
    ctx.arc(x, y, cap + 12, 0, TAU);
    ctx.fillStyle = halo;
    ctx.fill();

    // buraco
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, cap, 0, TAU);
    ctx.clip();
    const hole = ctx.createRadialGradient(x, y, 1, x, y, cap);
    hole.addColorStop(0, '#000000');
    hole.addColorStop(0.6, '#05070c');
    hole.addColorStop(1, '#141a26');
    ctx.fillStyle = hole;
    ctx.fillRect(x - cap, y - cap, cap * 2, cap * 2);
    // rede
    ctx.strokeStyle = 'rgba(150,175,200,0.14)';
    ctx.lineWidth = 0.7;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x - cap, y + i * 6.5);
      ctx.lineTo(x + cap, y - i * 6.5);
      ctx.stroke();
    }
    ctx.restore();

    // aro metálico aberto na boca
    const rim = ctx.createLinearGradient(x - cap, y - cap, x + cap, y + cap);
    rim.addColorStop(0, '#e8eef5');
    rim.addColorStop(0.3, '#96a3b5');
    rim.addColorStop(0.55, '#f4f8fd');
    rim.addColorStop(0.8, '#77828f');
    rim.addColorStop(1, '#c5cede');
    ctx.save();
    ctx.strokeStyle = rim;
    ctx.lineWidth = POCKET_RIM;
    const mouthAng = Math.atan2(p.interior.y, p.interior.x);
    const gapAngle = isCorner ? 0.72 : 0.95;
    ctx.beginPath();
    ctx.arc(x, y, cap - POCKET_RIM * 0.5, mouthAng + gapAngle, mouthAng - gapAngle + TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* --- diamantes --- */
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
    ctx.fillStyle = 'rgba(226,236,250,0.9)';
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

  // vinheta
  const vig = ctx.createRadialGradient(PLAY_W / 2, PLAY_H / 2, PLAY_H * 0.42, PLAY_W / 2, PLAY_H / 2, PLAY_W * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = vig;
  ctx.fillRect(-PAD, -PAD, TABLE_W, TABLE_H);
}

/* ======================= bolas em 3D ======================= */
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}
function lighten(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.round(lerp(r, 255, amt))},${Math.round(lerp(g, 255, amt))},${Math.round(lerp(b, 255, amt))})`;
}
function darken(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.round(lerp(r, 0, amt))},${Math.round(lerp(g, 0, amt))},${Math.round(lerp(b, 0, amt))})`;
}

function perpendicular(v) {
  // vetor unitário perpendicular a v
  if (Math.abs(v.x) < 0.9) {
    const l = Math.hypot(v.y, v.x);
    return { x: -v.y / (l || 1), y: v.x / (l || 1), z: 0 };
  }
  const l = Math.hypot(v.y, v.z);
  return { x: 0, y: -v.z / (l || 1), z: v.y / (l || 1) };
}
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export function createRenderer(canvas, bgCanvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const bgCtx = bgCanvas ? bgCanvas.getContext('2d', { alpha: true }) : null;

  let dpr = Math.min(2.5, window.devicePixelRatio || 1);
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let cssW = 0;
  let cssH = 0;
  let bgKey = '';
  const insets = { top: 0, right: 10, bottom: 10, left: 10 };

  /* ---- sprites auxiliares ---- */
  let shadowSprite = null;
  function getShadowSprite() {
    if (shadowSprite) return shadowSprite;
    const S = 96;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(0,0,0,0.6)');
    rg.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    shadowSprite = c;
    return c;
  }

  let glossSprite = null;
  function getGlossSprite() {
    if (glossSprite) return glossSprite;
    const S = 128;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(S * 0.34, S * 0.3, 1, S * 0.34, S * 0.3, S * 0.62);
    rg.addColorStop(0, 'rgba(255,255,255,0.85)');
    rg.addColorStop(0.35, 'rgba(255,255,255,0.22)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    glossSprite = c;
    return c;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(220, rect.width);
    cssH = Math.max(160, rect.height);
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const availW = Math.max(160, cssW - insets.left - insets.right);
    const availH = Math.max(120, cssH - insets.top - insets.bottom);
    scale = Math.min(availW / TABLE_W, availH / TABLE_H);
    ox = insets.left + (availW - TABLE_W * scale) / 2;
    oy = insets.top + (availH - TABLE_H * scale) / 2;

    if (bgCanvas && bgCtx) {
      if (bgCanvas.width !== pw || bgCanvas.height !== ph) {
        bgCanvas.width = pw;
        bgCanvas.height = ph;
      }
      const key = `${pw}x${ph}`;
      if (key !== bgKey) {
        bgKey = key;
        paintBackground();
      }
    }
  }

  function paintBackground() {
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.translate(ox, oy);
    bgCtx.scale(scale, scale);
    bgCtx.translate(PAD, PAD);
    paintTable(bgCtx);
  }

  function setInsets(next) {
    const changed = ['top', 'right', 'bottom', 'left'].some((k) => next[k] !== undefined && next[k] !== insets[k]);
    Object.assign(insets, next);
    if (changed) resize();
    return changed;
  }

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - ox) / scale - PAD,
      y: (clientY - rect.top - oy) / scale - PAD,
    };
  }

  /* ---- projeção de círculos na esfera ---- */
  function sphereCirclePath(axis, alpha, cx, cy, r) {
    const t1 = perpendicular(axis);
    const t2 = cross(axis, t1);
    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const N = 26;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const c = Math.cos(th);
      const s = Math.sin(th);
      let px = axis.x * cosA + (t1.x * c + t2.x * s) * sinA;
      let py = axis.y * cosA + (t1.y * c + t2.y * s) * sinA;
      const pz = axis.z * cosA + (t1.z * c + t2.z * s) * sinA;
      if (pz < 0.001) {
        const l = Math.hypot(px, py) || 1;
        px /= l;
        py /= l;
      }
      if (i === 0) ctx.moveTo(cx + px * r, cy + py * r);
      else ctx.lineTo(cx + px * r, cy + py * r);
    }
    ctx.closePath();
  }

  function sphereGradient(cx, cy, r, base) {
    const g = ctx.createRadialGradient(cx - r * 0.36, cy - r * 0.42, r * 0.12, cx + r * 0.12, cy + r * 0.16, r * 1.15);
    g.addColorStop(0, lighten(base, 0.55));
    g.addColorStop(0.45, base);
    g.addColorStop(1, darken(base, 0.5));
    return g;
  }

  /* desenha a bola com rotação real */
  function drawBall3D(ball, r = BALL_R, alpha = 1) {
    const x = ball.x;
    const y = ball.y;
    const num = ball.number;
    const m = ball.q || IDENT;
    const u = { x: m[1], y: m[4], z: m[7] };   // eixo das listras
    const n = { x: m[2], y: m[5], z: m[8] };   // eixo do número
    const stripeBall = isStripe(num);
    const base = num === 0 ? '#f7f4e9' : ballColor(num);

    ctx.save();
    ctx.globalAlpha = alpha;

    // sombra
    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.drawImage(getShadowSprite(), x - r * 1.45 + r * 0.28, y - r * 1.0 + r * 0.5, r * 2.9, r * 2.0);
    ctx.restore();

    // base da esfera
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    if (num === 8) {
      ctx.fillStyle = sphereGradient(x, y, r, '#141414');
    } else if (stripeBall) {
      // bola listrada: esfera branca + faixa colorida (dois "polos" brancos)
      ctx.fillStyle = sphereGradient(x, y, r, '#f4f1e6');
    } else {
      ctx.fillStyle = stripeBall ? '#f4f1e6' : sphereGradient(x, y, r, base);
    }
    if (num !== 8) ctx.fillStyle = stripeBall ? sphereGradient(x, y, r, '#f4f1e6') : sphereGradient(x, y, r, base);
    else ctx.fillStyle = sphereGradient(x, y, r, '#161616');
    ctx.fill();

    if (stripeBall) {
      // faixa: tudo menos os dois polos brancos
      const capAngle = 1.02; // ~58°: largura da faixa
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.clip();
      // pinta a bola inteira com a cor
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = sphereGradient(x, y, r, base);
      ctx.fill();
      // devolve os polos brancos
      const whiteGrad = sphereGradient(x, y, r, '#f6f3e8');
      sphereCirclePath(u, capAngle, x, y, r);
      ctx.fillStyle = whiteGrad;
      ctx.fill();
      sphereCirclePath({ x: -u.x, y: -u.y, z: -u.z }, capAngle, x, y, r);
      ctx.fillStyle = whiteGrad;
      ctx.fill();
      ctx.restore();
    }

    // círculo branco do número (nas duas faces, como nas bolas reais)
    if (num > 0) {
      const patch = 0.55;
      for (const axis of [n, { x: -n.x, y: -n.y, z: -n.z }]) {
        if (axis.z < -Math.cos(patch) + 0.02) continue; // do outro lado do globo
        sphereCirclePath(axis, patch, x, y, r);
        ctx.fillStyle = sphereGradient(x, y, r, '#f8f5ea');
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.10)';
        ctx.lineWidth = r * 0.03;
        ctx.stroke();

        // o número só é legível quando a face está virada para a câmera;
        // perto da borda ele some (como numa bola de verdade)
        if (axis.z > 0.34) {
          const t1 = perpendicular(axis);
          const t2 = cross(axis, t1);
          const fade = Math.min(1, (axis.z - 0.34) / 0.3);
          ctx.save();
          // recorta no próprio adesivo: o número nunca escapa da bola
          sphereCirclePath(axis, patch * 0.98, x, y, r);
          ctx.clip();
          ctx.globalAlpha = alpha * fade;
          ctx.translate(x + axis.x * r, y + axis.y * r);
          ctx.transform(t1.x, t1.y, t2.x, t2.y, 0, 0);
          const px = r * 0.66;
          ctx.font = `700 ${px}px "Segoe UI", Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = num === 8 ? '#f4f4f4' : '#101010';
          ctx.fillText(String(num), 0, px * 0.06);
          ctx.restore();
        }
      }
    } else {
      // bolinha de branca: pequeno ponto de referência que gira
      const spotAxis = { x: m[0], y: m[3], z: m[6] };
      if (spotAxis.z > 0) {
        ctx.beginPath();
        ctx.arc(x + spotAxis.x * r * 0.55, y + spotAxis.y * r * 0.55, r * 0.09 * Math.max(0.35, spotAxis.z), 0, TAU);
        ctx.fillStyle = 'rgba(190,80,72,0.55)';
        ctx.fill();
      }
    }

    // brilho especular
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    ctx.globalAlpha = alpha * 0.9;
    ctx.drawImage(getGlossSprite(), x - r, y - r, r * 2, r * 2);
    ctx.restore();

    // sombra na base (volume)
    const vg = ctx.createLinearGradient(0, y, 0, y + r);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = vg;
    ctx.fill();

    // contorno
    ctx.beginPath();
    ctx.arc(x, y, r - 0.4, 0, TAU);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.restore();
  }

  /* ---- animação de cair na caçapa ---- */
  function drawSinkingBalls(state) {
    for (const b of state.balls) {
      if (!b.pocketed || b.sinkT === undefined || b.sinkT >= 0.62) continue;
      const p = TABLE.pockets.find((pk) => pk.id === b.pocketId);
      if (!p) continue;
      const t = clamp(b.sinkT / 0.62, 0, 1);
      const ease = t * t * (3 - 2 * t);
      const cap = p.type === 'corner' ? POCKET_CAP : POCKET_CAP - 1.5;
      // a bola entra pela boca e desce para o fundo do saco:
      // anda no eixo da caçapa, encolhe e escurece
      const mouthX = p.center.x + p.interior.x * (p.reach - BALL_R * 0.4);
      const mouthY = p.center.y + p.interior.y * (p.reach - BALL_R * 0.4);
      const backX = p.center.x + p.interior.x * 3;
      const backY = p.center.y + p.interior.y * 3;
      const cx = lerp(mouthX, backX, ease);
      const cy = lerp(mouthY, backY, ease);
      const r = BALL_R * (1 - 0.6 * ease);
      // pequeno quique na quina da boca
      const wobble = Math.sin(ease * Math.PI * 2.2) * 3 * (1 - ease);

      ctx.save();
      ctx.beginPath();
      ctx.arc(p.center.x, p.center.y, cap + 3, 0, TAU);
      ctx.clip();
      drawBall3D({ ...b, x: cx + p.tangent.x * wobble, y: cy + p.tangent.y * wobble }, r, 1 - 0.15 * ease);
      // sombra do buraco cobrindo a bola conforme ela afunda
      const sh = ctx.createRadialGradient(p.center.x, p.center.y, cap * 0.35, p.center.x, p.center.y, cap);
      sh.addColorStop(0, `rgba(0,0,0,${0.15 + 0.6 * ease})`);
      sh.addColorStop(1, `rgba(0,0,0,${0.9 * ease})`);
      ctx.fillStyle = sh;
      ctx.fillRect(p.center.x - cap, p.center.y - cap, cap * 2, cap * 2);
      ctx.restore();
    }
  }

  /* ---- taco ---- */
  function drawCue(view) {
    const { state, aim, power } = view;
    if (!aim || state.ballInHand) return;
    if (state.phase !== 'aim' && state.phase !== 'ballinhand') return;
    const cue = state.balls.find((b) => b.id === 'cue');
    if (!cue || cue.pocketed) return;

    const strike = view.strike;
    const pull = 10 + power * 86;
    const forward = strike ? strike.offset : 0;
    const gap = BALL_R + 6 + pull - forward;
    if (gap < BALL_R + 2) return;

    ctx.save();
    ctx.translate(cue.x, cue.y);
    ctx.rotate(aim.angle);
    const len = 430;
    const buttR = 5.4;
    const tipR = 2.4;
    const x0 = -gap;
    const x1 = -gap - len;

    // sombra
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.moveTo(x0, -tipR + 4);
    ctx.lineTo(x1, -buttR + 5);
    ctx.lineTo(x1, buttR + 5);
    ctx.lineTo(x0, tipR + 4);
    ctx.closePath();
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    // madeira clara
    const grad = ctx.createLinearGradient(0, -buttR, 0, buttR);
    grad.addColorStop(0, '#f0d3a4');
    grad.addColorStop(0.22, '#fdf0d2');
    grad.addColorStop(0.5, '#d9ae74');
    grad.addColorStop(0.78, '#8f5f2f');
    grad.addColorStop(1, '#5d3a1c');
    ctx.beginPath();
    ctx.moveTo(x0, -tipR);
    ctx.lineTo(x1, -buttR);
    ctx.lineTo(x1, buttR);
    ctx.lineTo(x0, tipR);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // cabo escuro
    const buttStart = x1 + 130;
    const bg2 = ctx.createLinearGradient(0, -buttR, 0, buttR);
    bg2.addColorStop(0, '#4b3524');
    bg2.addColorStop(0.4, '#241a12');
    bg2.addColorStop(1, '#0d0a07');
    ctx.beginPath();
    ctx.moveTo(buttStart, -buttR * 0.97);
    ctx.lineTo(x1, -buttR);
    ctx.lineTo(x1, buttR);
    ctx.lineTo(buttStart, buttR * 0.97);
    ctx.closePath();
    ctx.fillStyle = bg2;
    ctx.fill();

    ctx.strokeStyle = 'rgba(245,210,150,0.6)';
    ctx.lineWidth = 1.2;
    for (const off of [28, 37]) {
      ctx.beginPath();
      ctx.moveTo(buttStart + off, -buttR);
      ctx.lineTo(buttStart + off, buttR);
      ctx.stroke();
    }

    // virola + sola
    ctx.fillStyle = '#f6f3ea';
    ctx.beginPath();
    ctx.moveTo(x0, -tipR);
    ctx.lineTo(x0 + 14, -tipR * 1.14);
    ctx.lineTo(x0 + 14, tipR * 1.14);
    ctx.lineTo(x0, tipR);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2f6fb5';
    ctx.beginPath();
    ctx.moveTo(x0, -tipR);
    ctx.lineTo(x0 + 3.6, -tipR * 1.04);
    ctx.lineTo(x0 + 3.6, tipR * 1.04);
    ctx.lineTo(x0, tipR);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /* ---- mira ---- */
  function drawAim(view) {
    const { state, guide, aim } = view;
    if (!view.showGuide || !guide || !aim) return;
    const cue = state.balls.find((b) => b.id === 'cue');
    if (!cue || cue.pocketed) return;
    const dx = Math.cos(aim.angle);
    const dy = Math.sin(aim.angle);

    // linha mestre até o ponto de contato
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.moveTo(cue.x + dx * BALL_R, cue.y + dy * BALL_R);
    ctx.lineTo(guide.x, guide.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // "bola fantasma" no ponto de contato
    if (guide.hitBall) {
      const gx = guide.x;
      const gy = guide.y;
      ctx.beginPath();
      ctx.arc(gx, gy, BALL_R, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // direção da bola alvo (sólida) — é a linha que realmente importa
      const odx = guide.hitBall.x - gx;
      const ody = guide.hitBall.y - gy;
      const ol = Math.hypot(odx, ody) || 1;
      const ux = odx / ol;
      const uy = ody / ol;
      const toPocket = guide.pocketLine;
      ctx.beginPath();
      ctx.moveTo(guide.hitBall.x + ux * BALL_R, guide.hitBall.y + uy * BALL_R);
      ctx.lineTo(guide.hitBall.x + ux * (BALL_R + (toPocket ? 260 : 110)),
        guide.hitBall.y + uy * (BALL_R + (toPocket ? 260 : 110)));
      ctx.strokeStyle = toPocket ? 'rgba(90,255,170,0.85)' : 'rgba(255,225,120,0.7)';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // desvio da branca (tangente à colisão)
      const tx = -uy;
      const ty = ux;
      const sign = (dx * tx + dy * ty) >= 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(gx + tx * sign * BALL_R, gy + ty * sign * BALL_R);
      ctx.lineTo(gx + tx * sign * (BALL_R + 80), gy + ty * sign * (BALL_R + 80));
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = 'rgba(140,215,255,0.75)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);

      // marca do ponto de contato
      ctx.beginPath();
      ctx.arc(guide.x, guide.y, 3, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
    } else if (guide.hitPocket) {
      ctx.beginPath();
      ctx.arc(guide.x, guide.y, BALL_R, 0, TAU);
      ctx.strokeStyle = 'rgba(120,255,180,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // rebate na tabela
      ctx.beginPath();
      ctx.arc(guide.x, guide.y, 4, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
      if (guide.bounce) {
        ctx.beginPath();
        ctx.setLineDash([7, 9]);
        ctx.moveTo(guide.x, guide.y);
        ctx.lineTo(guide.bounce.x, guide.bounce.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  /* ---- bola na mão ---- */
  function drawBallInHand(view) {
    const { state, pointer } = view;
    if (!state.ballInHand || !pointer) return;
    const valid = view.pointerValid;
    const pulse = 0.5 + 0.5 * Math.sin(view.time * 5);
    if (valid) drawBall3D({ x: pointer.x, y: pointer.y, number: 0, q: IDENT }, BALL_R, 0.94);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, BALL_R, 0, TAU);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = valid
      ? `rgba(120,255,180,${0.55 + pulse * 0.35})`
      : 'rgba(255,90,95,0.95)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  }

  function draw(view) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.translate(PAD, PAD);

    const state = view.state;
    drawSinkingBalls(state);

    const inHand = state.ballInHand && view.pointer && state.phase !== 'shooting';
    const balls = state.balls.filter((b) => !b.pocketed && !(inHand && b.id === 'cue'));
    balls.sort((a, b) => a.y - b.y);
    for (const b of balls) drawBall3D(b);

    drawBallInHand(view);
    drawAim(view);

    if (view.particles) view.particles.draw(ctx);
    drawCue(view);

    ctx.restore();
  }

  return {
    resize,
    draw,
    toWorld,
    setInsets,
    paintTable,
    drawBall3D,
    get scale() { return scale; },
  };
}

export { PAD, TABLE_W, TABLE_H, CORNER_REACH, SIDE_REACH };
