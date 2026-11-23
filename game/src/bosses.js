import { COLS, W } from './world.js';
import { makeEnemy, colX } from './enemies.js';

export const BOSS_TOP = 64;
const MERGE_WINDOW = 6;
const CUTOVER_EVERY = 8;
const DRUPAL_PHASES = ['Drupal 8', 'Drupal 9', 'Drupal 10'];

function entity(state, def, w, hp) {
  return {
    id: state.nextId++, kind: 'boss', boss: def.id, name: def.name,
    x: (W - w) / 2, y: BOSS_TOP, w, h: 44, hp, maxHp: hp,
    budget: 0, xp: 0, armored: false, revealed: true, traced: false, phased: false, pinnedUntil: 0,
    static: true, shieldOf: null, link: null, dead: false, dir: 1, shielded: false, migrationWeak: false,
  };
}

export function spawnBoss(state) {
  const def = state.design.bosses.find((b) => b.id === state.stageDef.boss);
  let e;
  switch (def.id) {
    case 'sync-conflict':
      e = entity(state, def, 150, def.hp);
      e.canSplit = true;
      break;
    case 'managed-host-invoice':
      e = entity(state, def, 120, def.hp);
      e.baseHp = def.hp;
      e.migrationWeak = true;
      break;
    case 'drupal-upgrade':
      e = entity(state, def, 170, def.hp / 3);
      e.phase = 0;
      e.name = DRUPAL_PHASES[0];
      break;
    case 'hard-cutover':
      e = entity(state, def, 140, def.hp);
      e.side = 0;
      e.switchAt = state.t + CUTOVER_EVERY;
      break;
    default:
      throw new Error(`unknown boss ${def.id}`);
  }
  state.enemies.push(e);
  state.boss = { id: def.id, def, pendingMerge: null };
  if (def.id === 'drupal-upgrade') spawnShield(state, e);
  return e;
}

function spawnShield(state, boss) {
  boss.shielded = true; // immediately, not at the next updateBosses
  const w = state.design.enemies.module.w ?? 52;
  for (let c = 0; c < COLS; c++) {
    state.enemies.push(makeEnemy(state, 'module', colX(c, w), boss.y + boss.h + 14,
      { static: true, shieldOf: boss.id, hpScale: state.stageDef.hpScale }));
  }
}

function sway(e, speed, dt) {
  if (!speed) return;
  e.x += e.dir * speed * dt;
  if (e.x < 8) { e.x = 8; e.dir = 1; }
  if (e.x + e.w > W - 8) { e.x = W - 8 - e.w; e.dir = -1; }
}

export function updateBosses(state, dt) {
  for (const e of state.enemies) {
    if (!e.boss || e.dead) continue;
    switch (e.boss) {
      case 'sync-conflict':
        sway(e, e.replica ? 70 : 45, dt);
        break;
      case 'managed-host-invoice': {
        e.hp = Math.min(e.baseHp * 3, e.hp + e.baseHp * 0.015 * dt);
        e.maxHp = Math.max(e.maxHp, e.hp);
        const cx = e.x + e.w / 2;
        e.w = Math.min(260, 120 * Math.sqrt(e.maxHp / e.baseHp));
        e.x = Math.max(8, Math.min(W - 8 - e.w, cx - e.w / 2));
        sway(e, 30, dt);
        break;
      }
      case 'drupal-upgrade':
        e.shielded = state.enemies.some((x) => x.shieldOf === e.id && !x.dead);
        sway(e, [0, 50, 110][e.phase], dt);
        break;
      case 'hard-cutover':
        if (state.t >= e.switchAt) {
          e.side ^= 1;
          e.switchAt = state.t + CUTOVER_EVERY;
          e.x = (e.side ? W * 0.75 : W * 0.25) - e.w / 2;
          state.events.push({ type: 'banner', text: 'Cutover', sub: e.side ? 'Traffic on the new account' : 'Traffic on the legacy account' });
        }
        break;
    }
  }
  const m = state.boss?.pendingMerge;
  if (m && state.t >= m.at) {
    const survivor = state.enemies.find((x) => x.id === m.survivorId && !x.dead);
    if (survivor) {
      survivor.hp = survivor.maxHp;
      state.enemies.push({ ...survivor, id: state.nextId++, x: m.x, dir: -survivor.dir });
      state.events.push({ type: 'banner', text: 'Re-merged', sub: 'Kill both replicas inside the window' });
    }
    state.boss.pendingMerge = null;
  }
}

export function afterBossHit(state, e) {
  if (e.boss === 'sync-conflict' && e.canSplit && e.hp <= e.maxHp / 2) {
    const half = e.hp / 2;
    e.canSplit = false;
    e.replica = true;
    e.w = 100;
    e.hp = e.maxHp = half;
    e.dir = -1;
    state.enemies.push({ ...e, id: state.nextId++, x: Math.min(W - 108, e.x + 110), dir: 1 });
    state.events.push({ type: 'banner', text: 'Split brain', sub: 'Kill both replicas before they re-merge' });
  }
}

// Called after e.dead is set. Returns true when the whole fight is over.
export function onBossKilled(state, e) {
  switch (e.boss) {
    case 'sync-conflict': {
      const other = state.enemies.find((x) => x.boss === e.boss && !x.dead && x.id !== e.id);
      if (other) {
        state.boss.pendingMerge = { at: state.t + MERGE_WINDOW, survivorId: other.id, x: e.x };
        return false;
      }
      state.boss.pendingMerge = null;
      return true;
    }
    case 'drupal-upgrade':
      if (e.phase < DRUPAL_PHASES.length - 1) {
        e.dead = false;
        e.phase += 1;
        e.hp = e.maxHp;
        e.name = DRUPAL_PHASES[e.phase];
        spawnShield(state, e);
        state.events.push({ type: 'banner', text: `Upgraded to ${e.name}`, sub: 'New modules, new shield' });
        return false;
      }
      return true;
    default:
      return true;
  }
}
