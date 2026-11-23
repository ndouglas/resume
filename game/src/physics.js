import { W, BOTTOM } from './world.js';

// Circle vs axis-aligned rect. Returns the push-out normal and depth, or null.
export function circleRect(c, r) {
  const cx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(c.y, r.y + r.h));
  const dx = c.x - cx;
  const dy = c.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > c.r * c.r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: c.r - d };
  }
  const left = c.x - r.x;
  const right = r.x + r.w - c.x;
  const top = c.y - r.y;
  const bottom = r.y + r.h - c.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: -1, ny: 0, depth: left + c.r };
  if (m === right) return { nx: 1, ny: 0, depth: right + c.r };
  if (m === top) return { nx: 0, ny: -1, depth: top + c.r };
  return { nx: 0, ny: 1, depth: bottom + c.r };
}

export function reflect(b, hit) {
  const dot = b.vx * hit.nx + b.vy * hit.ny;
  if (dot < 0) {
    b.vx -= 2 * dot * hit.nx;
    b.vy -= 2 * dot * hit.ny;
  }
  b.x += hit.nx * hit.depth;
  b.y += hit.ny * hit.depth;
}

// Bounce off the side and top walls. Returns true once the ball is below BOTTOM.
export function bounceWalls(b) {
  if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
  if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
  if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); }
  return b.y - b.r > BOTTOM;
}

export function clampUp(d, minUp = 0.15) {
  if (d.y <= -minUp) return d;
  return { x: Math.sign(d.x || 1) * Math.sqrt(1 - minUp * minUp), y: -minUp };
}

export function aimVector(fx, fy, tx, ty, minUp = 0.15) {
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy) || 1;
  return clampUp({ x: dx / len, y: dy / len }, minUp);
}

// Stop a ball settling into a near-horizontal loop between the side walls.
export function keepSteep(b, minUp = 0.2) {
  const s = Math.hypot(b.vx, b.vy) || 1;
  if (Math.abs(b.vy) / s >= minUp) return;
  const sign = b.vy < 0 ? -1 : 1;
  b.vy = sign * minUp * s;
  b.vx = Math.sign(b.vx || 1) * Math.sqrt(1 - minUp * minUp) * s;
}

export function setSpeed(b, speed) {
  const s = Math.hypot(b.vx, b.vy) || 1;
  b.vx *= speed / s;
  b.vy *= speed / s;
}
