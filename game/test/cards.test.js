import test from 'node:test';
import assert from 'node:assert/strict';
import { tagEffects, describeEffects, applyCard, drawCards, ballOffers, bulletPool, cardView, citedText, years } from '../src/cards.js';
import { makeRng } from '../src/rng.js';
import { fixtureState } from './helpers.js';

test('tag effects scale with weight and ignore tags without effects', () => {
  const s = fixtureState();
  assert.deepEqual(tagEffects(['ci-cd', 'nope'], 5, s.design), { fireRate: 0.25 });
});

test('describeEffects formats each mod', () => {
  const s = fixtureState();
  s.design.mods.regen.format = 'rate';
  s.design.mods.reveal.format = 'px';
  assert.deepEqual(describeEffects({ fireRate: 0.25, regen: 0.05, reveal: 36, docs: 3 }, s.design),
    ['+25% fireRate', '+0.05/s regen', '+36px reveal', 'docs']);
});

test('a bullet card applies effects, raises the budget, and retires its alt group', () => {
  const s = fixtureState();
  const b3 = s.data.roles[0].bullets[2];
  applyCard(s, { type: 'bullet', bullet: b3, role: s.data.roles[0], effects: tagEffects(b3.tags, b3.weight, s.design) });
  assert.ok(Math.abs(s.maxBudget - 21.8) < 1e-9);
  assert.ok(Math.abs(s.budget - 21.8) < 1e-9);
  assert.ok(s.mods.docs > 0);
  assert.deepEqual(s.picks, ['b3']);
  assert.deepEqual(bulletPool(s).map((c) => c.bullet.id), ['b1']);
});

test('the first level-up always offers a tool; cards are distinct', () => {
  for (let seed = 1; seed < 20; seed++) {
    const s = fixtureState(seed);
    const cards = drawCards(s, makeRng(seed));
    assert.equal(cards.length, 3);
    assert.ok(cards.some((c) => c.type === 'ball'));
    const alts = cards.filter((c) => c.type === 'bullet' && c.bullet.alt).map((c) => c.bullet.alt);
    assert.equal(new Set(alts).size, alts.length);
  }
});

test('an eligible fusion is usually offered', () => {
  const s = fixtureState();
  s.inventory = { lambda: 3, terraform: 3 };
  s.cardsPicked = 1;
  let offered = 0;
  for (let seed = 1; seed < 50; seed++) if (drawCards(s, makeRng(seed)).some((c) => c.type === 'fusion')) offered++;
  assert.ok(offered > 30);
});

test('ball offers respect max level and the five-kind cap', () => {
  const s = fixtureState();
  s.inventory = { bash: 3, lambda: 3, datadog: 3, terraform: 3, oidc: 2 };
  assert.deepEqual(ballOffers(s), [{ type: 'ball', kind: 'oidc', level: 3 }]);
});

test('exhausted pools yield no cards', () => {
  const s = fixtureState();
  s.inventory = { bash: 3, lambda: 3, datadog: 3, oidc: 3, cypress: 3 };
  s.picks = ['b1', 'b2', 'b3'];
  s.cardsPicked = 3;
  assert.deepEqual(drawCards(s, makeRng(1)), []);
});

test('card views quote the bullet and name the role', () => {
  const s = fixtureState();
  const [c] = bulletPool(s);
  const v = cardView(c, s);
  assert.equal(v.text, c.bullet.text);
  assert.equal(v.title, 'Engineer, Acme');
  assert.equal(v.sub, '2020–present');
  const f = cardView({ type: 'fusion', fusion: s.design.fusions[1] }, s);
  assert.equal(f.quote, 'Proj: A project');
});

test('citedText and years', () => {
  const s = fixtureState();
  assert.equal(citedText(s.data, 'b1'), 'Did a thing');
  assert.equal(citedText(s.data, 'missing'), '');
  assert.equal(years('2012-01', '2015-12'), '2012–2015');
  assert.equal(years('2024-02', '2024-09'), '2024');
});
