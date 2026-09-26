import { COL_W, DANGER_Y, REVEAL_BASE, W } from './world.js';
import { log } from './postmortem.js';

const DEFAULT_W = 52;
const DEFAULT_H = 24;
const DEPENDENCY_CAP = 24;

export function makeEnemy(state, kind, x, y, opts = {}) {
  const def = state.design.enemies[kind];
  const id = state.nextId++;
  const hp = def.hp * (opts.hpScale ?? 1);
  return {
    id, kind, x, y, w: def.w ?? DEFAULT_W, h: def.h ?? DEFAULT_H,
    hp, maxHp: hp, budget: def.budget, xp: def.xp,
    armored: Boolean(def.armored),
    revealed: kind !== 'silent' && kind !== 'skipped',
    traced: false, phased: false, pinnedUntil: 0,
    phaseOffset: (id * 0.37) % 1.6,
    spawnTimer: 3.5, link: null,
    static: Boolean(opts.static), shieldOf: opts.shieldOf ?? null,
    dead: false, boss: null,
  };
}

export const colX = (col, w) => col * COL_W + (COL_W - w) / 2;

// Solid: balls collide with it. Immune: balls bounce off but deal no damage.
export const solid = (e) => !e.dead && !e.phased && !(e.kind === 'silent' && !e.revealed);
export const immune = (e) => (e.kind === 'skipped' && !e.revealed) || Boolean(e.boss && e.shielded);

export function isTargetable(e) {
  return !e.dead && e.revealed && !e.phased;
}

// The targetable enemy closest to breaching; with preferTraced, traced ones first.
export function lowestTarget(state, preferTraced = false) {
  let best = null;
  let bestScore = -Infinity;
  for (const e of state.enemies) {
    if (!isTargetable(e)) continue;
    const score = e.y + e.h + (preferTraced && e.traced ? 1000 : 0);
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best;
}

export function spawnDeadlockPair(state, colA, colB, y, hpScale = 1) {
  const a = makeEnemy(state, 'deadlock', colX(colA, DEFAULT_W), y, { hpScale });
  const b = makeEnemy(state, 'deadlock', colX(colB, DEFAULT_W), y, { hpScale });
  a.link = b.id;
  b.link = a.id;
  state.enemies.push(a, b);
}

// Deadlock bookkeeping when an enemy is killed (not when it breaches).
export function onKilled(state, e) {
  if (e.kind !== 'deadlock' || e.link == null) return;
  const partner = state.enemies.find((x) => x.id === e.link && !x.dead);
  if (partner) {
    state.pendingRespawns.push({ at: state.t + 2, partnerId: partner.id, x: e.x, dy: e.y - partner.y, maxHp: e.maxHp });
  }
}

function resolveDeadlocks(state) {
  const keep = [];
  for (const p of state.pendingRespawns) {
    const partner = state.enemies.find((x) => x.id === p.partnerId && !x.dead);
    if (!partner) continue; // both halves died inside the window
    if (state.t < p.at) { keep.push(p); continue; }
    const r = makeEnemy(state, 'deadlock', p.x, partner.y + p.dy);
    r.hp = r.maxHp = p.maxHp;
    r.link = partner.id;
    partner.link = r.id;
    state.enemies.push(r);
  }
  state.pendingRespawns = keep;
}

function spawnDependencyCopy(state, e) {
  if (state.enemies.filter((x) => x.kind === 'dependency' && !x.dead).length >= DEPENDENCY_CAP) return;
  const side = e.id % 2 ? 1 : -1;
  let x = e.x + side * COL_W;
  if (x < 0 || x + e.w > W) x = e.x - side * COL_W;
  const copy = makeEnemy(state, 'dependency', x, e.y - e.h - 6);
  copy.hp = copy.maxHp = e.maxHp;
  state.enemies.push(copy);
}

// Moves, phases, reveals and breaches non-boss enemies. Returns error budget burned.
export function updateEnemies(state, dt) {
  const revealLine = DANGER_Y - REVEAL_BASE - state.mods.reveal;
  const fall = state.stageDef.speed * dt;
  let burned = 0;
  // A snapshot, so copies spawned this step don't tick (and copy themselves) until the next.
  for (const e of state.enemies.slice()) {
    if (e.dead || e.boss) continue;
    if (!state.seen.includes(e.kind)) {
      state.seen.push(e.kind);
      state.events.push({ type: 'intro', kind: e.kind });
      log(state, 'intro', `First ${state.design.enemies[e.kind].name} appeared`);
    }
    if (!e.static) e.y += fall;
    if (e.kind === 'flaky') e.phased = state.t >= e.pinnedUntil && (state.t + e.phaseOffset) % 1.6 > 1.0;
    if (!e.revealed && e.y + e.h >= revealLine) e.revealed = true;
    if (e.kind === 'dependency') {
      e.spawnTimer -= dt;
      if (e.spawnTimer <= 0) { e.spawnTimer = 3.5; spawnDependencyCopy(state, e); }
    }
    if (e.y + e.h >= DANGER_Y) {
      e.dead = true;
      burned += e.budget;
    }
  }
  resolveDeadlocks(state);
  state.enemies = state.enemies.filter((e) => !e.dead);
  return burned;
}
