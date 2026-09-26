import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnRow, updateSpawner, rowY, stageRate } from '../src/stages.js';
import { makeRng } from '../src/rng.js';
import { COL_W } from '../src/world.js';
import { fixtureState } from './helpers.js';

const cols = (s) => s.enemies.map((e) => Math.floor((e.x + 1) / COL_W));

test('a row places rowMin..rowMax enemies in distinct columns', () => {
  for (let seed = 1; seed < 30; seed++) {
    const s = fixtureState(seed);
    spawnRow(s, makeRng(seed));
    assert.ok(s.enemies.length >= 2 && s.enemies.length <= 3);
    assert.equal(new Set(cols(s)).size, s.enemies.length);
  }
});

test('idle capacity takes two columns and deadlocks come in pairs', () => {
  for (let seed = 1; seed < 40; seed++) {
    const s = fixtureState(seed);
    s.stageDef = { ...s.stageDef, rowMin: 3, rowMax: 3, mix: { idle: 1, deadlock: 1 } };
    spawnRow(s, makeRng(seed));
    const deadlocks = s.enemies.filter((e) => e.kind === 'deadlock');
    assert.equal(deadlocks.length % 2, 0);
    for (const e of s.enemies.filter((x) => x.kind === 'idle')) assert.equal(Math.round(e.x + e.w / 2) % (2 * COL_W), COL_W);
  }
});

test('a spike replaces the next row with a full row of requests', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, spikeEvery: 5 };
  s.spikeTimer = 0.01;
  s.spawnTimer = 0.02;
  updateSpawner(s, 0.05, s.rng);
  assert.equal(s.enemies.length, 8);
  assert.ok(s.enemies.every((e) => e.kind === 'request'));
});

test('rows spawn below the boss during a fight, and rate ramps with stage time', () => {
  const s = fixtureState();
  assert.equal(rowY(s), -30);
  s.boss = { id: 'x' };
  assert.equal(rowY(s), 150);
  s.boss = null;
  s.stageDef = { ...s.stageDef, ramp: 1, duration: 10 };
  s.stageTime = 10;
  assert.equal(stageRate(s), 2);
});

test('traffic keeps rising through a boss fight on a ramping stage', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, ramp: 0.8, duration: 10, bossRate: 1 };
  s.boss = { id: 'hard-cutover' };
  s.stageTime = 10;
  const atStart = stageRate(s);
  s.stageTime = 15;
  assert.ok(stageRate(s) > atStart);
  s.stageTime = 1000;
  assert.equal(stageRate(s), 1 + 0.8 * 2);
});
