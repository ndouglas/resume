import test from 'node:test';
import assert from 'node:assert/strict';
import { circleRect, reflect, bounceWalls, aimVector, clampUp, keepSteep, setSpeed } from '../src/physics.js';
import { W, BOTTOM } from '../src/world.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('circleRect misses a distant circle', () => {
  assert.equal(circleRect({ x: 0, y: 0, r: 5 }, { x: 20, y: 20, w: 10, h: 10 }), null);
});

test('circleRect reports a downward normal for a hit from below', () => {
  const hit = circleRect({ x: 25, y: 33, r: 5 }, { x: 20, y: 20, w: 10, h: 10 });
  assert.equal(hit.nx, 0);
  assert.equal(hit.ny, 1);
  assert.ok(close(hit.depth, 2));
});

test('a centre inside the rect is pushed out of the nearest side', () => {
  const hit = circleRect({ x: 21, y: 25, r: 3 }, { x: 20, y: 20, w: 10, h: 10 });
  assert.equal(hit.nx, -1);
  assert.equal(hit.ny, 0);
});

test('reflect flips the normal component and pushes the ball out', () => {
  const b = { x: 25, y: 33, r: 5, vx: 10, vy: -100 };
  reflect(b, { nx: 0, ny: 1, depth: 2 });
  assert.equal(b.vy, 100);
  assert.equal(b.vx, 10);
  assert.equal(b.y, 35);
});

test('reflect leaves a ball already moving away alone', () => {
  const b = { x: 0, y: 0, vx: 0, vy: 50 };
  reflect(b, { nx: 0, ny: 1, depth: 1 });
  assert.equal(b.vy, 50);
});

test('bounceWalls reflects off left, right and top and reports the bottom', () => {
  const l = { x: 2, y: 100, r: 6, vx: -50, vy: -50 };
  assert.equal(bounceWalls(l), false);
  assert.equal(l.vx, 50);
  assert.equal(l.x, 6);
  const r = { x: W, y: 100, r: 6, vx: 50, vy: -50 };
  bounceWalls(r);
  assert.equal(r.vx, -50);
  const t = { x: 100, y: 1, r: 6, vx: 0, vy: -50 };
  bounceWalls(t);
  assert.equal(t.vy, 50);
  assert.equal(bounceWalls({ x: 100, y: BOTTOM + 7, r: 6, vx: 0, vy: 50 }), true);
});

test('aimVector is a unit vector clamped above the minimum upward angle', () => {
  const v = aimVector(100, 600, 400, 610);
  assert.ok(close(Math.hypot(v.x, v.y), 1));
  assert.ok(v.y <= -0.15 + 1e-9);
  assert.ok(v.x > 0);
  const up = aimVector(100, 600, 100, 0);
  assert.ok(close(up.y, -1));
  assert.deepEqual(clampUp({ x: 0, y: -1 }), { x: 0, y: -1 });
});

test('keepSteep keeps speed and enforces a vertical component', () => {
  const b = { vx: 100, vy: -1 };
  const speed = Math.hypot(b.vx, b.vy);
  keepSteep(b);
  assert.ok(close(Math.hypot(b.vx, b.vy), speed));
  assert.ok(b.vy < 0 && Math.abs(b.vy) / speed >= 0.2 - 1e-9);
});

test('setSpeed rescales without changing direction', () => {
  const b = { vx: 3, vy: 4 };
  setSpeed(b, 10);
  assert.ok(close(b.vx, 6) && close(b.vy, 8));
});
