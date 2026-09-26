import test from 'node:test';
import assert from 'node:assert/strict';
import { labelPx } from '../src/render.js';

test('canvas labels never render below 10 CSS pixels', () => {
  assert.equal(labelPx(480), 10);
  assert.equal(labelPx(960), 10);
  assert.ok(Math.abs((labelPx(357) * 357) / 480 - 10) < 1e-9);
});
