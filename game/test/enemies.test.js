import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnemy, updateEnemies, solid, immune, onKilled, spawnDeadlockPair, colX } from '../src/enemies.js';
import { DANGER_Y, REVEAL_BASE } from '../src/world.js';
import { fixtureState } from './helpers.js';

test('makeEnemy scales hp and hides silent defects and skipped checks', () => {
  const s = fixtureState();
  const e = makeEnemy(s, 'request', 0, 0, { hpScale: 2 });
  assert.equal(e.hp, 40);
  assert.equal(e.maxHp, 40);
  assert.equal(makeEnemy(s, 'silent', 0, 0).revealed, false);
  assert.equal(makeEnemy(s, 'skipped', 0, 0).revealed, false);
  assert.equal(makeEnemy(s, 'idle', 0, 0).w, 112);
});

test('silent defects are not solid until revealed; skipped checks are solid but immune', () => {
  const s = fixtureState();
  const silent = makeEnemy(s, 'silent', 0, 0);
  const skipped = makeEnemy(s, 'skipped', 0, 0);
  assert.equal(solid(silent), false);
  assert.equal(solid(skipped), true);
  assert.equal(immune(skipped), true);
  skipped.revealed = true;
  assert.equal(immune(skipped), false);
});

test('enemies fall at stage speed; one crossing the SLO line burns budget and is removed', () => {
  const s = fixtureState();
  const e = makeEnemy(s, 'silent', 0, DANGER_Y - 24 - 1);
  s.enemies.push(e);
  assert.equal(updateEnemies(s, 1), 3);
  assert.equal(s.enemies.length, 0);
});

test('monitoring reveals enemies near the line, farther with the reveal mod', () => {
  const s = fixtureState();
  const e = makeEnemy(s, 'silent', 0, DANGER_Y - REVEAL_BASE - 24 - 50);
  s.enemies.push(e);
  s.stageDef = { ...s.stageDef, speed: 0 };
  updateEnemies(s, 0.1);
  assert.equal(e.revealed, false);
  s.mods.reveal = 60;
  updateEnemies(s, 0.1);
  assert.equal(e.revealed, true);
});

test('flaky tests phase on a cycle unless pinned', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  const e = makeEnemy(s, 'flaky', 0, 100);
  e.phaseOffset = 0;
  s.enemies.push(e);
  s.t = 0.5; updateEnemies(s, 0);
  assert.equal(e.phased, false);
  s.t = 1.2; updateEnemies(s, 0);
  assert.equal(e.phased, true);
  e.pinnedUntil = 5; updateEnemies(s, 0);
  assert.equal(e.phased, false);
});

test('unpinned dependencies copy themselves every 3.5 s', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  s.enemies.push(makeEnemy(s, 'dependency', colX(3, 52), 200));
  updateEnemies(s, 3.6);
  assert.equal(s.enemies.filter((e) => e.kind === 'dependency').length, 2);
});

test('a deadlock half respawns if its partner survives 2 s', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  spawnDeadlockPair(s, 2, 3, 100, 1);
  const [a] = s.enemies;
  a.dead = true; onKilled(s, a);
  s.t = 1; updateEnemies(s, 0);
  assert.equal(s.enemies.length, 1);
  s.t = 2.1; updateEnemies(s, 0);
  assert.equal(s.enemies.length, 2);
  assert.equal(s.enemies[0].link, s.enemies[1].id);
});

test('killing both halves inside the window resolves the deadlock', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  spawnDeadlockPair(s, 2, 3, 100, 1);
  const [a, b] = s.enemies;
  a.dead = true; onKilled(s, a);
  s.t = 1; b.dead = true; onKilled(s, b);
  s.t = 3; updateEnemies(s, 0);
  assert.equal(s.enemies.length, 0);
});

test('the first appearance of a kind emits one intro event', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  s.enemies.push(makeEnemy(s, 'flaky', 0, 100), makeEnemy(s, 'flaky', 60, 100));
  updateEnemies(s, 0);
  updateEnemies(s, 0);
  assert.deepEqual(s.events.filter((e) => e.type === 'intro'), [{ type: 'intro', kind: 'flaky' }]);
});

test('first appearances are logged for the detailed postmortem', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  s.enemies.push(makeEnemy(s, 'flaky', 0, 100));
  updateEnemies(s, 0);
  assert.deepEqual(s.stats.timeline.map((e) => [e.kind, e.text]), [['intro', 'First Flaky Test appeared']]);
});
