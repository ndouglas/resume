import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtClock, noteBudget, log, summarize, loadBest, saveBest } from '../src/postmortem.js';
import { fixtureState } from './helpers.js';

test('fmtClock', () => {
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(61.9), '1:01');
  assert.equal(fmtClock(-3), '0:00');
});

test('time to restore is measured from first loss to full budget', () => {
  const s = fixtureState();
  s.t = 10; s.budget = 19; noteBudget(s);
  s.t = 14; s.budget = 20; noteBudget(s);
  assert.deepEqual(s.stats.restores, [4]);
});

test('budget thresholds log once until recovered', () => {
  const s = fixtureState();
  s.budget = 14; noteBudget(s);
  s.budget = 13; noteBudget(s);
  assert.equal(s.stats.timeline.filter((e) => e.kind === 'budget').length, 1);
  s.budget = 17; noteBudget(s);
  s.budget = 14; noteBudget(s);
  assert.equal(s.stats.timeline.filter((e) => e.kind === 'budget').length, 2);
});

test('summary: change failure rate, filtered timeline, grouped picks', () => {
  const s = fixtureState();
  s.outcome = 'met';
  s.stats.shots = 8; s.stats.balls = 10; s.stats.misses = 3;
  log(s, 'stage', 'Stage 1');
  log(s, 'card', 'Merged');
  log(s, 'budget', 'Error budget below 75%');
  log(s, 'intro', 'First Flaky Test');
  s.picks = ['b1'];
  const sum = summarize(s);
  assert.equal(sum.deploys, 8);
  assert.equal(sum.changeFailureRate, 0.3);
  assert.deepEqual(sum.timeline.map((e) => e.text), ['Stage 1', 'Merged', 'Error budget below 75%']);
  assert.deepEqual(sum.picks, [{ role: 'Engineer', employer: 'Acme (contract)', bullets: ['Did a thing'] }]);
  s.mods.docs = 1;
  assert.equal(summarize(s).timeline.length, 4);
});

test('best-run storage keeps the better run', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveBest(storage, { outcome: 'breached', stageReached: 2 });
  saveBest(storage, { outcome: 'breached', stageReached: 1 });
  assert.deepEqual(loadBest(storage), { outcome: 'breached', stageReached: 2 });
  saveBest(storage, { outcome: 'met', stageReached: 4 });
  assert.equal(loadBest(storage).outcome, 'met');
});

test('best-run storage survives a throwing storage', () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadBest(storage), null);
  assert.deepEqual(saveBest(storage, { outcome: 'met', stageReached: 4 }), { outcome: 'met', stageReached: 4 });
  assert.equal(loadBest(null), null);
});
