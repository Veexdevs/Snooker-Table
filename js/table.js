/*
 * table.js — geometria da mesa, caçapas e utilidades de posicionamento.
 *
 * Todas as medidas são "unidades de mesa". A área de jogo (superfície de
 * pano) tem 960 x 480 — 2:1, como uma mesa de sinuca profissional.
 *
 * ⚠️ A DIFERENÇA DESTA MESA:
 *   As caçapas têm boca do tamanho aproximado da bola (1,27 × o diâmetro
 *   nos cantos e 1,32 × nas laterais). Numa mesa normal a boca é ~2,4 × o
 *   diâmetro. Ou seja: encaixar a bola exige precisão de milímetros.
 *   É o que deixa o jogo difícil e "profissional".
 */

import { TAU } from './util.js';

export const BALL_R = 12;
export const BALL_D = BALL_R * 2;
export const PLAY_W = 960;
export const PLAY_H = 480;
export const CUSHION = 46;      // largura da borracha da tabela
export const OUTER = 54;        // madeira externa
export const POCKET_CAP = 17.5;   // "boca" decorativa esculpida na madeira
export const POCKET_RIM = 3.2;  // aro de metal
export const POCKET_DEPTH = 30; // profundidade visual do saco

/* alcance da boca a partir do centro da caçapa, medido no eixo da mesa.
 * É a metade da abertura física da caçapa. */
export const CORNER_REACH = BALL_R + 3.2;  // abertura ≈ 1,27 × diâmetro
export const SIDE_REACH = BALL_R + 3.8;    // abertura ≈ 1,32 × diâmetro

export const RACK_APEX = { x: PLAY_W * 0.75, y: PLAY_H / 2 };
export const RACK_ROW_GAP = BALL_D * 0.868;
export const RACK_COL_GAP = BALL_D * 0.995;
export const SPOT_HEAD = { x: PLAY_W * 0.25, y: PLAY_H / 2 };
export const SPOT_FOOT = { x: RACK_APEX.x, y: RACK_APEX.y };

const POCKET_DEFS = [
  { id: 0, center: { x: 0, y: 0 }, interior: { x: 1, y: 1 }, tangent: { x: 1, y: 0 }, type: 'corner' },
  { id: 2, center: { x: PLAY_W, y: 0 }, interior: { x: -1, y: 1 }, tangent: { x: -1, y: 0 }, type: 'corner' },
  { id: 3, center: { x: 0, y: PLAY_H }, interior: { x: 1, y: -1 }, tangent: { x: 1, y: 0 }, type: 'corner' },
  { id: 5, center: { x: PLAY_W, y: PLAY_H }, interior: { x: -1, y: -1 }, tangent: { x: -1, y: 0 }, type: 'corner' },
  { id: 1, center: { x: PLAY_W / 2, y: 0 }, interior: { x: 0, y: 1 }, tangent: { x: 1, y: 0 }, type: 'side' },
  { id: 4, center: { x: PLAY_W / 2, y: PLAY_H }, interior: { x: 0, y: -1 }, tangent: { x: 1, y: 0 }, type: 'side' },
];

function buildTable() {
  const walls = [];

  const addLine = (x1, y1, x2, y2, nx, ny) => {
    if (Math.hypot(x2 - x1, y2 - y1) < 1) return;
    walls.push({
      x: (x1 + x2) / 2, y: (y1 + y2) / 2,
      nx, ny,
      len: Math.hypot(x2 - x1, y2 - y1),
      angle: Math.atan2(y2 - y1, x2 - x1),
      pocket: false,
    });
  };

  // tabelas superior / inferior (dois segmentos cada, por causa da caçapa do meio)
  addLine(CORNER_REACH, 0, PLAY_W / 2 - SIDE_REACH, 0, 0, 1);
  addLine(PLAY_W / 2 + SIDE_REACH, 0, PLAY_W - CORNER_REACH, 0, 0, 1);
  addLine(CORNER_REACH, PLAY_H, PLAY_W / 2 - SIDE_REACH, PLAY_H, 0, -1);
  addLine(PLAY_W / 2 + SIDE_REACH, PLAY_H, PLAY_W - CORNER_REACH, PLAY_H, 0, -1);
  // tabelas esquerda / direita
  addLine(0, CORNER_REACH, 0, PLAY_H - CORNER_REACH, 1, 0);
  addLine(PLAY_W, CORNER_REACH, PLAY_W, PLAY_H - CORNER_REACH, -1, 0);

  const pockets = POCKET_DEFS.map((def) => {
    const l = Math.hypot(def.interior.x, def.interior.y);
    const interior = { x: def.interior.x / l, y: def.interior.y / l };
    const reach = def.type === 'side' ? SIDE_REACH : CORNER_REACH;
    return {
      id: def.id,
      type: def.type,
      center: def.center,
      interior,
      tangent: def.tangent,
      reach,
      // quina "reta" da boca (onde a tabela termina)
      mouth: {
        x: def.center.x + interior.x * reach,
        y: def.center.y + interior.y * reach,
      },
      // ponto para onde a mira deve apontar (dentro do saco)
      aim: {
        x: def.center.x + interior.x * (reach - BALL_R * 0.35),
        y: def.center.y + interior.y * (reach - BALL_R * 0.35),
      },
      // limites de captura: projeção no eixo da caçapa / desvio lateral
      captureDepth: reach - 1.2,
      captureHalf: reach + 2.5,
    };
  });

  return { walls, pockets };
}

export const TABLE = buildTable();
export const POCKET_MAP = new Map(TABLE.pockets.map((p) => [p.id, p]));

/* marcadores (diamantes) nas tabelas */
export const DIAMONDS = {
  top: [1, 2, 3, 5, 6, 7].map((i) => (PLAY_W * i) / 8),
  left: [1, 2, 3].map((i) => (PLAY_H * i) / 4),
};

/* posições iniciais do triângulo (8-ball) — 15 bolas */
export const RACK_SLOTS = (() => {
  const slots = [];
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      slots.push({
        row,
        x: RACK_APEX.x + row * RACK_ROW_GAP,
        y: RACK_APEX.y + (i - row / 2) * RACK_COL_GAP,
      });
    }
  }
  return slots;
})();

export const BALL_COLORS = {
  1: '#f5c400', 2: '#2450d8', 3: '#e23026', 4: '#6c2ea6',
  5: '#f07a10', 6: '#0f8a48', 7: '#7c2a26', 8: '#151515',
  9: '#f5c400', 10: '#2450d8', 11: '#e23026', 12: '#6c2ea6',
  13: '#f07a10', 14: '#0f8a48', 15: '#7c2a26',
};

export const isStripe = (n) => n >= 9 && n <= 15;

export function ballColor(n) {
  if (n === 0) return '#f8f5ec';
  return BALL_COLORS[n] || '#888';
}

export function groupOf(n) {
  if (n === 0) return 'cue';
  if (n === 8) return 'eight';
  return n >= 9 ? 'stripe' : 'solid';
}

/* verifica se uma posição é válida para a bola branca */
export function isFreeSpot(state, x, y, ignoreId = 'cue') {
  if (x < BALL_R + 1 || x > PLAY_W - BALL_R - 1 || y < BALL_R + 1 || y > PLAY_H - BALL_R - 1) return false;
  for (const b of state.balls) {
    if (b.id === ignoreId || b.pocketed) continue;
    if (Math.hypot(b.x - x, b.y - y) < BALL_D + 0.5) return false;
  }
  return true;
}

export function randomFreeSpot(state, minX = PLAY_W * 0.15, maxX = PLAY_W * 0.45) {
  for (let i = 0; i < 500; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = BALL_R * 2 + Math.random() * (PLAY_H - BALL_R * 4);
    if (isFreeSpot(state, x, y)) return { x, y };
  }
  return { x: SPOT_HEAD.x, y: SPOT_HEAD.y };
}

export { TAU };
