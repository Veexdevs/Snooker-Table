/*
 * fx.js — partículas: pó do pano, poeira da caçapa e faíscas de impacto.
 *
 * Vista de cima, então o "pó" se espalha em 2D, perde velocidade e some.
 * Quanto mais forte a pancada, mais pó sobe.
 */

const rand = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor() {
    this.list = [];
    this.rings = [];
  }

  clear() {
    this.list.length = 0;
    this.rings.length = 0;
  }

  /* pó levantado do pano / da boca da caçapa */
  dust(x, y, strength = 1, options = {}) {
    const n = Math.round(Math.min(26, 5 + strength * 9));
    const spread = options.spread ?? 26;
    const color = options.color || 'r,g,b';
    const base = options.color || '214,224,236';
    void color;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(20, 70) * (0.5 + strength);
      this.list.push({
        x: x + Math.cos(ang) * rand(0, spread * 0.5),
        y: y + Math.sin(ang) * rand(0, spread * 0.5),
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        r: rand(1.1, 2.9) * (0.7 + strength * 0.5),
        life: rand(0.45, 1.15),
        t: 0,
        color: base,
        alpha: rand(0.25, 0.62) * Math.min(1, 0.5 + strength * 0.4),
      });
    }
    this.rings.push({ x, y, r: 4, max: 16 + strength * 22, life: 0.42, t: 0, color: base });
  }

  /* faísca/estalo de bola batendo forte */
  spark(x, y, strength = 1) {
    const n = Math.round(Math.min(14, 3 + strength * 6));
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(90, 260) * strength;
      this.list.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        r: rand(0.7, 1.6),
        life: rand(0.12, 0.28),
        t: 0,
        color: '255,236,180',
        alpha: rand(0.5, 0.95),
      });
    }
  }

  /* poeira caindo dentro da caçapa */
  pocketDust(x, y, strength = 1) {
    const n = Math.round(Math.min(22, 6 + strength * 10));
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(8, 46) * (0.4 + strength);
      this.list.push({
        x: x + rand(-3, 3),
        y: y + rand(-3, 3),
        vx: Math.cos(ang) * sp * 0.5,
        vy: Math.sin(ang) * sp * 0.5,
        r: rand(1.2, 3.2),
        life: rand(0.5, 1.3),
        t: 0,
        color: '190,200,216',
        alpha: rand(0.2, 0.5),
      });
    }
    this.rings.push({ x, y, r: 6, max: 22 + strength * 16, life: 0.5, t: 0, color: '200,214,232' });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.t >= p.life) { this.list.splice(i, 1); continue; }
      const damp = Math.exp(-3.4 * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.life) this.rings.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const r of this.rings) {
      const k = r.t / r.life;
      const rad = 4 + (r.max - 4) * k;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r.color},${0.45 * (1 - k)})`;
      ctx.lineWidth = 1.6 * (1 - k) + 0.4;
      ctx.stroke();
    }
    for (const p of this.list) {
      const k = p.t / p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha * (1 - k)})`;
      ctx.fill();
    }
  }
}
