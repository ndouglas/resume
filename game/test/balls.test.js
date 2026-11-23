import test from 'node:test';
import assert from 'node:assert/strict';
import { traitsFor, kindInfo, makeBall, hitDamage, applyHitEffects, rebuildSlots, steer, fusionKind, BASE_DAMAGE } from '../src/balls.js';
import { fixtureState, rect } from './helpers.js';

const up = { x: 0, y: -1 };
const noCache = { next: () => 0.99 };

test('a fusion has both parts\' traits plus its bonus', () => {
  const s = fixtureState();
  const t = traitsFor(fusionKind('self-describing-lambda'), s.design);
  assert.deepEqual([...t].sort(), ['copiesInherit', 'noFalloff', 'pierce', 'split']);
  assert.equal(kindInfo(fusionKind('self-describing-lambda'), s.design).name, 'Self-describing Lambda');
});

test('base damage at level 1 with no mods', () => {
  const s = fixtureState();
  const b = makeBall(s, 'bash', 0, 0, up);
  assert.equal(hitDamage(s, b, rect(s), noCache).damage, BASE_DAMAGE);
});

test('level scales damage by half per level', () => {
  const s = fixtureState();
  const b = makeBall(s, 'bash', 0, 0, up, { level: 3 });
  assert.equal(hitDamage(s, b, rect(s), noCache).damage, BASE_DAMAGE * 2);
});

test('repeat hits on the same enemy fall off, except for noFalloff', () => {
  const s = fixtureState();
  const e = rect(s);
  const bash = makeBall(s, 'bash', 0, 0, up);
  bash.lastEnemy = e.id;
  assert.equal(hitDamage(s, bash, e, noCache).damage, BASE_DAMAGE / 2);
  const tf = makeBall(s, 'terraform', 0, 0, up);
  tf.lastEnemy = e.id;
  assert.equal(hitDamage(s, tf, e, noCache).damage, BASE_DAMAGE);
});

test('traced enemies take 50% more, plus tracedBonus', () => {
  const s = fixtureState();
  s.mods.tracedBonus = 0.5;
  const b = makeBall(s, 'bash', 0, 0, up);
  assert.equal(hitDamage(s, b, rect(s, { traced: true }), noCache).damage, BASE_DAMAGE * 2);
});

test('armor lets 10% through unless the ball does security damage', () => {
  const s = fixtureState();
  const e = rect(s, { armored: true });
  assert.ok(Math.abs(hitDamage(s, makeBall(s, 'bash', 0, 0, up), e, noCache).damage - 1) < 1e-9);
  assert.equal(hitDamage(s, makeBall(s, 'oidc', 0, 0, up), e, noCache).damage, BASE_DAMAGE);
  s.mods.armorPierce = 0.4;
  assert.ok(Math.abs(hitDamage(s, makeBall(s, 'bash', 0, 0, up), e, noCache).damage - 5) < 1e-9);
});

test('heavy damage ignores tracing and falloff', () => {
  const s = fixtureState();
  const e = rect(s, { traced: true });
  const b = makeBall(s, 'rust', 0, 0, up);
  b.lastEnemy = e.id;
  assert.equal(hitDamage(s, b, e, noCache).damage, BASE_DAMAGE * 2.5);
});

test('migration-weak bosses apply bossDmg twice', () => {
  const s = fixtureState();
  s.mods.bossDmg = 0.5;
  const b = makeBall(s, 'bash', 0, 0, up);
  assert.equal(hitDamage(s, b, rect(s, { boss: 'x' }), noCache).damage, 15);
  assert.equal(hitDamage(s, b, rect(s, { boss: 'x', migrationWeak: true }), noCache).damage, 22.5);
});

test('cacheAlways doubles every hit', () => {
  const s = fixtureState();
  const b = makeBall(s, fusionKind('deterministic-replay'), 0, 0, up, { level: 1 });
  const r = hitDamage(s, b, rect(s), noCache);
  assert.equal(r.cached, true);
  assert.equal(r.damage, BASE_DAMAGE * 2.5 * 2);
});

test('trace marks and reveals; pin holds a flaky test solid', () => {
  const s = fixtureState();
  const e = rect(s, { kind: 'flaky', revealed: false });
  applyHitEffects(s, makeBall(s, 'datadog', 0, 0, up), e, s.rng);
  assert.equal(e.traced, true);
  assert.equal(e.revealed, true);
  s.t = 10;
  applyHitEffects(s, makeBall(s, 'cypress', 0, 0, up, { level: 2 }), e, s.rng);
  assert.equal(e.pinnedUntil, 14);
});

test('split spawns 1 + level short-lived children that do not split again', () => {
  const s = fixtureState();
  const parent = makeBall(s, 'lambda', 100, 100, up, { level: 2 });
  applyHitEffects(s, parent, rect(s), s.rng);
  assert.equal(s.balls.length, 3);
  assert.ok(s.balls.every((b) => b.child && b.ttl === 1.2 && !b.traits.has('split')));
  applyHitEffects(s, s.balls[0], rect(s), s.rng);
  assert.equal(s.balls.length, 3);
});

test('copiesInherit gives children the parent traits except split', () => {
  const s = fixtureState();
  const parent = makeBall(s, fusionKind('self-describing-lambda'), 100, 100, up, { level: 3 });
  applyHitEffects(s, parent, rect(s), s.rng);
  assert.ok(s.balls.every((b) => b.traits.has('pierce') && !b.traits.has('split')));
});

test('rebuildSlots makes copies per ballCount and keeps existing slot objects', () => {
  const s = fixtureState();
  rebuildSlots(s);
  const first = s.slots[0];
  first.out = 1;
  s.inventory.lambda = 1;
  s.mods.ballCount = 1.2;
  rebuildSlots(s);
  assert.deepEqual(s.slots.map((x) => x.kind), ['bash', 'bash', 'lambda', 'lambda']);
  assert.equal(s.slots[0], first);
});

test('homing steers toward the enemy nearest the bottom', () => {
  const s = fixtureState();
  s.enemies.push(rect(s, { x: 400, y: 500 }), rect(s, { x: 0, y: 100 }));
  const b = makeBall(s, 'pagerduty', 240, 600, up);
  for (let i = 0; i < 30; i++) steer(s, b, 1 / 60);
  assert.ok(b.vx > 0);
});
