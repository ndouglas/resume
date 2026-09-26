import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, step, chooseCard, INTRO_TIME, CLEAR_TIME } from '../src/engine.js';
import { STEP, W } from '../src/world.js';
import { fixtureData, rect } from './helpers.js';

const run = (seconds, s, input = {}) => {
  for (let t = 0; t < seconds; t += STEP) {
    step(s, STEP, input);
    if (s.phase === 'over' || s.phase === 'levelup') break;
  }
};
const playing = (seed = 1) => {
  const s = newRun(fixtureData(), seed);
  run(INTRO_TIME + 0.01, s, { fire: false });
  return s;
};

test('a run starts in the stage intro with the start ball and full budget', () => {
  const s = newRun(fixtureData(), 1);
  assert.equal(s.phase, 'intro');
  assert.deepEqual(s.slots.map((x) => x.kind), ['bash']);
  assert.equal(s.budget, 20);
  assert.deepEqual(s.events[0], { type: 'stage', index: 0 });
  run(INTRO_TIME + 0.01, s, { fire: false });
  assert.equal(s.phase, 'play');
});

test('design start_mods apply at the start of a run', () => {
  const data = fixtureData();
  data.design.start_mods = { ballCount: 1 };
  const s = newRun(data, 1);
  assert.equal(s.mods.ballCount, 1);
  assert.deepEqual(s.slots.map((x) => x.kind), ['bash', 'bash']);
});

test('a fired ball comes back and refills its slot; a clean miss counts as a failure', () => {
  const s = playing();
  s.stageDef = { ...s.stageDef, spawnEvery: 999 };
  s.spawnTimer = 999;
  step(s, STEP, { aim: { x: s.player.x, y: 0 } });
  assert.equal(s.balls.length, 1);
  assert.equal(s.slots[0].out, 1);
  run(3, s, { fire: false });
  assert.equal(s.balls.length, 0);
  assert.equal(s.slots[0].out, 0);
  assert.equal(s.stats.misses, 1);
});

test('an expired slotted ball frees its slot', () => {
  const s = playing();
  s.spawnTimer = 999;
  step(s, STEP, {});
  s.balls[0].ttl = STEP / 2;
  step(s, STEP, { fire: false });
  assert.equal(s.balls.length, 0);
  assert.equal(s.slots[0].out, 0);
});

test('hitting an enemy damages it, and a kill grants XP', () => {
  const s = playing();
  s.spawnTimer = 999;
  s.enemies.push(rect(s, { x: s.player.x - 26, y: 300, hp: 5, maxHp: 5 }));
  step(s, STEP, { aim: { x: s.player.x, y: 0 } });
  run(1, s, { fire: false });
  assert.equal(s.stats.kills, 1);
  assert.ok(s.xp > 0);
});

test('the player moves toward moveX at a bounded speed and stays on screen', () => {
  const s = playing();
  step(s, 0.1, { moveX: W, fire: false });
  assert.ok(s.player.x > W / 2 && s.player.x < W / 2 + 40);
  run(3, s, { moveDir: 1, fire: false });
  assert.equal(s.player.x, W - 16);
});

test('a player who never fires breaches the SLO', () => {
  const s = playing();
  run(600, s, { fire: false });
  assert.equal(s.phase, 'over');
  assert.equal(s.outcome, 'breached');
  assert.equal(s.budget, 0);
  assert.equal(s.events.at(-1).type, 'over');
});

test('a level-up pauses play for three cards; picking resumes', () => {
  const s = playing();
  s.pendingLevels = 1;
  step(s, STEP, { fire: false });
  assert.equal(s.phase, 'levelup');
  assert.equal(s.cards.length, 3);
  const t = s.t;
  step(s, STEP, {});
  assert.equal(s.t, t);
  chooseCard(s, 0);
  assert.equal(s.phase, 'play');
  assert.equal(s.cardsPicked, 1);
});

test('a level-up with nothing to offer does not pause', () => {
  const s = playing();
  s.inventory = { bash: 3, lambda: 3, datadog: 3, oidc: 3, cypress: 3 };
  s.picks = ['b1', 'b2', 'b3'];
  s.cardsPicked = 3;
  s.pendingLevels = 1;
  step(s, STEP, { fire: false });
  assert.equal(s.phase, 'play');
  assert.equal(s.pendingLevels, 0);
});

test('the boss arrives after the stage duration; killing it clears the stage', () => {
  const s = playing();
  s.stageTime = s.stageDef.duration;
  step(s, STEP, { fire: false });
  const boss = s.enemies.find((e) => e.boss);
  assert.ok(boss);
  assert.equal(s.stats.firstBossAt, s.t);
  boss.hp = 1;
  boss.canSplit = false;
  s.enemies = [boss];
  step(s, STEP, { aim: { x: s.player.x, y: 0 } });
  run(2, s, { fire: false });
  assert.equal(s.phase, 'clear');
  run(CLEAR_TIME + INTRO_TIME + 0.1, s, { fire: false });
  assert.equal(s.stageIndex, 1);
});

test('clearing the last stage meets the SLO', () => {
  const s = playing();
  s.stageIndex = s.design.stages.length - 1;
  s.stageDef = s.design.stages[s.stageIndex];
  s.stageTime = s.stageDef.duration;
  step(s, STEP, { fire: false });
  const boss = s.enemies.find((e) => e.boss);
  boss.hp = 1;
  s.enemies = [boss];
  step(s, STEP, { aim: { x: s.player.x, y: 0 } });
  run(CLEAR_TIME + 3, s, { fire: false });
  assert.equal(s.phase, 'over');
  assert.equal(s.outcome, 'met');
});
