import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnBoss, updateBosses, afterBossHit, onBossKilled } from '../src/bosses.js';
import { W } from '../src/world.js';
import { fixtureState } from './helpers.js';

function withBoss(id) {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, boss: id };
  const e = spawnBoss(s);
  return { s, e };
}
const alive = (s) => s.enemies.filter((x) => x.boss && !x.dead);

test('the sync conflict splits at half health into two replicas', () => {
  const { s, e } = withBoss('sync-conflict');
  e.hp = 50;
  afterBossHit(s, e);
  assert.equal(alive(s).length, 2);
  assert.ok(alive(s).every((x) => x.replica && x.hp === 25));
});

test('a lone replica re-merges after 6 s; killing both in time ends the fight', () => {
  const { s, e } = withBoss('sync-conflict');
  e.hp = 50;
  afterBossHit(s, e);
  const [a, b] = alive(s);
  a.dead = true;
  assert.equal(onBossKilled(s, a), false);
  s.t = 6.1;
  updateBosses(s, 0);
  assert.equal(alive(s).length, 2);
  assert.ok(alive(s).every((x) => x.hp === x.maxHp));
  const [c, d] = alive(s);
  c.dead = true;
  assert.equal(onBossKilled(s, c), false);
  d.dead = true;
  assert.equal(onBossKilled(s, d), true);
  assert.equal(s.boss.pendingMerge, null);
});

test('the invoice grows over time up to three times its base', () => {
  const { s, e } = withBoss('managed-host-invoice');
  updateBosses(s, 10);
  assert.ok(Math.abs(e.hp - 115) < 1e-9);
  updateBosses(s, 1000);
  assert.equal(e.hp, 300);
  assert.equal(e.migrationWeak, true);
});

test('drupal is shielded by modules and upgrades through three phases', () => {
  const { s, e } = withBoss('drupal-upgrade');
  const modules = () => s.enemies.filter((x) => x.shieldOf === e.id && !x.dead);
  assert.equal(modules().length, 8);
  updateBosses(s, 0);
  assert.equal(e.shielded, true);
  for (const m of modules()) m.dead = true;
  updateBosses(s, 0);
  assert.equal(e.shielded, false);
  e.dead = true;
  assert.equal(onBossKilled(s, e), false);
  assert.equal(e.dead, false);
  assert.equal(e.name, 'Drupal 9');
  assert.equal(modules().length, 8);
  e.dead = true;
  assert.equal(onBossKilled(s, e), false);
  e.dead = true;
  assert.equal(onBossKilled(s, e), true);
});

test('the cutover moves between halves every 8 s', () => {
  const { s, e } = withBoss('hard-cutover');
  s.t = 8.01;
  updateBosses(s, 0);
  assert.equal(e.x, W * 0.75 - e.w / 2);
  assert.ok(s.events.some((x) => x.type === 'banner' && x.text === 'Cutover'));
});

test('a fresh drupal shield blocks damage before the next boss update', () => {
  const { s, e } = withBoss('drupal-upgrade');
  assert.equal(e.shielded, true);
  for (const m of s.enemies.filter((x) => x.shieldOf === e.id)) m.dead = true;
  updateBosses(s, 0);
  e.dead = true;
  onBossKilled(s, e);
  assert.equal(e.shielded, true);
});
