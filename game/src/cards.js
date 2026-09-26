import { MAX_LEVEL, MAX_KINDS, kindInfo, rebuildSlots } from './balls.js';
import { eligibleFusions, applyFusion } from './fusion.js';

export const newMods = (design) => Object.fromEntries(Object.keys(design.mods).map((k) => [k, 0]));

export function tagEffects(tags, weight, design) {
  const out = {};
  for (const tag of tags) {
    for (const [mod, per] of Object.entries(design.tag_effects[tag] ?? {})) out[mod] = (out[mod] ?? 0) + per * weight;
  }
  return out;
}

const FORMATS = {
  pct: (v) => `+${Math.round(v * 100)}%`,
  rate: (v) => `+${v.toFixed(2)}/s`,
  px: (v) => `+${Math.round(v)}px`,
  num: (v) => `+${Math.round(v * 10) / 10}`,
  frac: (v) => `+${v.toFixed(1)}`,
};

export function describeEffects(effects, design) {
  return Object.entries(effects).map(([mod, v]) => {
    const { label, format } = design.mods[mod];
    return format === 'flag' ? label : `${FORMATS[format](v)} ${label}`;
  });
}

export function applyEffects(state, effects) {
  for (const [mod, v] of Object.entries(effects)) state.mods[mod] += v;
  if (effects.maxBudget) {
    state.maxBudget += effects.maxBudget;
    state.budget += effects.maxBudget;
  }
}

export function ballOffers(state) {
  const full = Object.keys(state.inventory).length >= MAX_KINDS;
  return state.design.balls
    .filter((b) => b.offer !== false)
    .map((b) => ({ b, lvl: state.inventory[b.id] ?? 0 }))
    .filter(({ lvl }) => lvl < MAX_LEVEL && (lvl > 0 || !full))
    .map(({ b, lvl }) => ({ type: 'ball', kind: b.id, level: lvl + 1 }));
}

export function bulletPool(state) {
  const make = (roles) => roles.flatMap((role) => role.bullets
    .filter((b) => !state.picks.includes(b.id) && !(b.alt && state.pickedAlts.includes(b.alt)))
    .map((bullet) => ({ type: 'bullet', bullet, role, effects: tagEffects(bullet.tags, bullet.weight, state.design) })));
  const pool = make(state.data.roles.filter((r) => state.stageDef.roles.includes(r.id)));
  return pool.length >= 2 ? pool : make(state.data.roles);
}

const take = (arr, rng) => arr.splice(Math.floor(rng.next() * arr.length), 1)[0];

export function drawCards(state, rng) {
  const cards = [];
  const fusions = eligibleFusions(state);
  if (fusions.length && rng.next() < 0.8) cards.push({ type: 'fusion', fusion: rng.pick(fusions) });
  const balls = ballOffers(state);
  if (balls.length && (state.cardsPicked === 0 || rng.next() < 0.45)) cards.push(take(balls, rng));
  const pool = bulletPool(state);
  while (cards.length < 3 && pool.length) {
    const c = rng.weighted(pool, (x) => x.bullet.weight);
    pool.splice(pool.indexOf(c), 1);
    if (c.bullet.alt && cards.some((x) => x.type === 'bullet' && x.bullet.alt === c.bullet.alt)) continue;
    cards.push(c);
  }
  while (cards.length < 3 && balls.length) cards.push(take(balls, rng));
  return cards;
}

export function applyCard(state, card) {
  if (card.type === 'bullet') {
    applyEffects(state, card.effects);
    state.picks.push(card.bullet.id);
    if (card.bullet.alt) state.pickedAlts.push(card.bullet.alt);
  } else if (card.type === 'ball') {
    state.inventory[card.kind] = card.level;
  } else if (card.type === 'fusion') {
    applyFusion(state, card.fusion);
  }
  state.cardsPicked += 1;
  rebuildSlots(state);
}

export function cardTitle(card, state) {
  if (card.type === 'bullet') return `Merged a PR: ${card.role.title}`;
  if (card.type === 'fusion') return `Designed ${card.fusion.name}`;
  const { name } = kindInfo(card.kind, state.design);
  return card.level > 1 ? `Upgraded ${name} to level ${card.level}` : `Adopted ${name}`;
}

export function years(start, end) {
  const y = (s) => (s === 'present' ? 'present' : s.slice(0, 4));
  return y(start) === y(end) ? y(start) : `${y(start)}–${y(end)}`;
}

export function citedText(data, id) {
  for (const r of data.roles) for (const b of r.bullets) if (b.id === id) return b.text;
  const p = data.projects.find((x) => x.id === id);
  return p ? `${p.name}: ${p.text}` : '';
}

export function cardView(card, state) {
  if (card.type === 'bullet') {
    return {
      kicker: 'Merge a PR',
      title: `${card.role.title}, ${card.role.employer.split(' (')[0]}`,
      sub: years(card.role.start, card.role.end),
      text: card.bullet.text,
      quote: null,
      chips: describeEffects(card.effects, state.design),
    };
  }
  if (card.type === 'fusion') {
    const f = card.fusion;
    const parts = f.parts.map((p) => kindInfo(p, state.design).name).join(' + ');
    return { kicker: 'System design', title: f.name, sub: parts, text: f.blurb, quote: citedText(state.data, f.cites[0]), chips: [] };
  }
  const info = kindInfo(card.kind, state.design);
  return {
    kicker: card.level > 1 ? 'Upgrade a tool' : 'Adopt a tool',
    title: `${info.name} · level ${card.level}`,
    sub: null, text: info.blurb, quote: null, chips: [],
  };
}
