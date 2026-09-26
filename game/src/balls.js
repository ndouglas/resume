import { setSpeed } from './physics.js';
import { lowestTarget } from './enemies.js';

export const MAX_LEVEL = 3;
export const MAX_KINDS = 5;
export const BASE_SPEED = 560;
export const BASE_R = 6;
export const BASE_DAMAGE = 10;
export const MAX_CHILDREN = 80;

const FUSION = 'fusion:';

export const isFusion = (kind) => kind.startsWith(FUSION);
export const fusionKind = (id) => FUSION + id;
const fusionDef = (kind, design) => design.fusions.find((f) => f.id === kind.slice(FUSION.length));

export function kindInfo(kind, design) {
  const d = isFusion(kind) ? fusionDef(kind, design) : design.balls.find((b) => b.id === kind);
  return { id: kind, name: d.name, color: d.color, blurb: d.blurb };
}

export function traitsFor(kind, design) {
  if (isFusion(kind)) {
    const f = fusionDef(kind, design);
    const t = new Set([f.bonus]);
    for (const p of f.parts) for (const x of traitsFor(p, design)) t.add(x);
    return t;
  }
  const b = design.balls.find((x) => x.id === kind);
  return new Set(b ? b.traits : []);
}

export function makeBall(state, kind, x, y, dir, opts = {}) {
  const traits = opts.traits ?? traitsFor(kind, state.design);
  const heavy = traits.has('heavy');
  const speed = BASE_SPEED * (heavy ? 0.7 : 1);
  return {
    id: state.nextId++, kind, traits,
    level: opts.level ?? state.inventory[kind] ?? 1,
    x, y, vx: dir.x * speed, vy: dir.y * speed, speed,
    r: heavy ? 10 : (opts.r ?? BASE_R),
    dmgScale: opts.dmgScale ?? 1,
    slot: opts.slot ?? null,
    ttl: opts.ttl ?? 20,
    child: Boolean(opts.child),
    lastEnemy: -1,
    cooldowns: new Map(), // enemy id -> time before a piercing ball may hit it again
    hits: 0,
  };
}

export function hitDamage(state, ball, enemy, rng) {
  const m = state.mods;
  const t = ball.traits;
  let dmg = BASE_DAMAGE * ball.dmgScale * (1 + 0.5 * (ball.level - 1)) * (1 + m.damage);
  if (t.has('heavy')) {
    dmg *= 2.5; // deterministic: none of the situational multipliers below
  } else {
    if (!t.has('noFalloff') && ball.lastEnemy === enemy.id) dmg *= 0.5;
    if (enemy.traced) dmg *= 1.5 + m.tracedBonus;
    if (enemy.kind === 'flaky' || enemy.kind === 'skipped') dmg *= 1 + m.testDmg;
  }
  if (enemy.boss) dmg *= (1 + m.bossDmg) * (enemy.migrationWeak ? 1 + m.bossDmg : 1);
  if (enemy.armored && !t.has('security')) dmg *= Math.min(1, 0.1 + m.armorPierce);
  let cached = false;
  if (t.has('cache') && (t.has('cacheAlways') || rng.next() < 0.15 * ball.level)) {
    dmg *= 2;
    cached = true;
  }
  return { damage: dmg, cached };
}

export function applyHitEffects(state, ball, enemy, rng) {
  const t = ball.traits;
  if (t.has('trace')) {
    enemy.traced = true;
    enemy.revealed = true;
    if (t.has('traceArea')) {
      for (const e of state.enemies) {
        if (Math.hypot(e.x + e.w / 2 - ball.x, e.y + e.h / 2 - ball.y) < 70) {
          e.traced = true;
          e.revealed = true;
        }
      }
    }
  }
  if (t.has('pin') && enemy.kind === 'flaky') enemy.pinnedUntil = state.t + 2 + ball.level;
  if (t.has('shatter')) enemy.armored = false;
  if (t.has('split') && !ball.child) spawnCopies(state, ball, rng);
}

function spawnCopies(state, ball, rng) {
  const children = state.balls.filter((b) => b.child).length;
  const n = Math.min(1 + ball.level, MAX_CHILDREN - children);
  const inherit = ball.traits.has('copiesInherit') ? [...ball.traits].filter((x) => x !== 'split') : [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    state.balls.push(makeBall(state, ball.kind, ball.x, ball.y, { x: Math.cos(a), y: Math.sin(a) },
      { traits: new Set(inherit), level: ball.level, child: true, ttl: 1.2, dmgScale: 0.4, r: 4 }));
  }
}

export function steer(state, ball, dt) {
  if (!ball.traits.has('homing')) return;
  const e = lowestTarget(state, ball.traits.has('autoTarget'));
  if (!e) return;
  const dx = e.x + e.w / 2 - ball.x;
  const dy = e.y + e.h / 2 - ball.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, 5 * dt);
  ball.vx += ((dx / d) * ball.speed - ball.vx) * k;
  ball.vy += ((dy / d) * ball.speed - ball.vy) * k;
  setSpeed(ball, ball.speed);
}

// One slot per owned kind per copy. Existing slot objects are kept so balls in
// flight still return to the slot they left from.
export function rebuildSlots(state) {
  const copies = 1 + Math.floor(state.mods.ballCount);
  const slots = [];
  for (const kind of Object.keys(state.inventory)) {
    for (let i = 0; i < copies; i++) {
      const old = state.slots.find((s) => s.kind === kind && !slots.includes(s));
      slots.push(old ?? { kind, out: 0 });
    }
  }
  state.slots = slots;
}
