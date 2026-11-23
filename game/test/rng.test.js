import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng.js';

test('same seed, same sequence', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
});

test('different seeds diverge', () => {
  assert.notEqual(makeRng(1).next(), makeRng(2).next());
});

test('next stays in [0, 1) and int is inclusive', () => {
  const r = makeRng(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
    seen.add(r.int(2, 4));
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
});

test('weighted never picks a zero-weight item', () => {
  const r = makeRng(3);
  for (let i = 0; i < 500; i++) assert.notEqual(r.weighted(['a', 'b'], (x) => (x === 'a' ? 0 : 1)), 'a');
});
