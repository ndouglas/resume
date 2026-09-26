import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredLevel, eligibleFusions, applyFusion } from '../src/fusion.js';
import { fusionKind } from '../src/balls.js';
import { fixtureState } from './helpers.js';

test('fusion needs both parts at level 3, or 2 with fusionEarly', () => {
  const s = fixtureState();
  s.inventory = { lambda: 3, terraform: 2 };
  assert.equal(eligibleFusions(s).length, 0);
  s.mods.fusionEarly = 1;
  assert.equal(requiredLevel(s), 2);
  assert.deepEqual(eligibleFusions(s).map((f) => f.id), ['self-describing-lambda']);
  s.mods.fusionEarly = 5;
  assert.equal(requiredLevel(s), 2);
});

test('applying a fusion consumes the parts and cannot be offered twice', () => {
  const s = fixtureState();
  s.inventory = { bash: 1, lambda: 3, terraform: 3 };
  applyFusion(s, s.design.fusions[0]);
  assert.deepEqual(Object.keys(s.inventory), ['bash', fusionKind('self-describing-lambda')]);
  s.inventory.lambda = 3;
  s.inventory.terraform = 3;
  assert.equal(eligibleFusions(s).length, 0);
});
