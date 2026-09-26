import { W, PLAYER_Y } from './world.js';
import { makeRng } from './rng.js';
import { bounceWalls, circleRect, reflect, keepSteep, clampUp, aimVector, setSpeed } from './physics.js';
import { BASE_SPEED, makeBall, traitsFor, hitDamage, applyHitEffects, steer, rebuildSlots } from './balls.js';
import { updateEnemies, solid, immune, onKilled, lowestTarget } from './enemies.js';
import { updateSpawner } from './stages.js';
import { spawnBoss, updateBosses, afterBossHit, onBossKilled } from './bosses.js';
import { newMods, drawCards, applyCard, cardTitle } from './cards.js';
import { newStats, log, noteBudget } from './postmortem.js';

export const BASE_BUDGET = 20;
export const FIRE_INTERVAL = 0.14;
export const INTRO_TIME = 2.5;
export const CLEAR_TIME = 2.5;
const PLAYER_SPEED = 380;
const MAX_EVENTS = 400;

export function newRun(data, seed = 1) {
  const design = data.design;
  const start = design.balls.find((b) => b.start).id;
  const state = {
    data, design, seed, rng: makeRng(seed),
    t: 0, nextId: 1, phase: 'intro', phaseTimer: INTRO_TIME,
    stageIndex: 0, stageDef: design.stages[0], stageTime: 0, spawnTimer: 0, spikeTimer: 0, spikeDue: false, boss: null,
    player: { x: W / 2, aim: { x: 0, y: -1 } },
    budget: BASE_BUDGET, maxBudget: BASE_BUDGET, mods: { ...newMods(design), ...design.start_mods },
    inventory: { [start]: 1 }, slots: [], slotCursor: 0, fireTimer: 0, teamTimer: 0,
    balls: [], enemies: [], pendingRespawns: [],
    xp: 0, level: 1, xpToNext: 8, pendingLevels: 0, cards: null, cardsPicked: 0,
    picks: [], pickedAlts: [], fused: [], seen: [],
    outcome: null, events: [], stats: newStats(),
  };
  rebuildSlots(state);
  enterStage(state, 0);
  return state;
}

function enterStage(state, index) {
  state.stageIndex = index;
  state.stageDef = state.design.stages[index];
  state.stageTime = 0;
  state.spawnTimer = 0.5;
  state.spikeTimer = state.stageDef.spikeEvery || 0;
  state.spikeDue = false;
  state.boss = null;
  state.phase = 'intro';
  state.phaseTimer = INTRO_TIME;
  state.events.push({ type: 'stage', index });
  log(state, 'stage', `Stage ${index + 1}: ${state.stageDef.employer}`);
}

export function step(state, dt, input = {}) {
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  if (state.phase === 'levelup' || state.phase === 'over') return;
  state.t += dt;
  movePlayer(state, dt, input);
  updateBalls(state, dt);
  if (state.phase === 'intro' || state.phase === 'clear') {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      if (state.phase === 'intro') state.phase = 'play';
      else if (state.stageIndex + 1 < state.design.stages.length) enterStage(state, state.stageIndex + 1);
      else finish(state, 'met');
    }
    return;
  }

  state.stageTime += dt;
  updateSpawner(state, dt, state.rng);
  if (state.boss) updateBosses(state, dt);
  else if (state.stageTime >= state.stageDef.duration) startBoss(state);
  if (input.fire !== false) {
    fire(state, dt);
    teammates(state, dt);
  }
  const burned = updateEnemies(state, dt);
  if (burned) {
    state.budget -= burned;
    state.events.push({ type: 'breach', amount: burned });
  }
  state.budget = Math.min(state.maxBudget, state.budget + state.mods.regen * dt);
  noteBudget(state);
  if (state.budget <= 0) {
    state.budget = 0;
    finish(state, 'breached');
    return;
  }
  if (state.pendingLevels > 0 && state.phase === 'play') openLevelUp(state);
}

export function chooseCard(state, index) {
  if (state.phase !== 'levelup') return;
  const card = state.cards[index];
  if (!card) return;
  applyCard(state, card);
  log(state, card.type === 'fusion' ? 'fusion' : 'card', cardTitle(card, state));
  state.pendingLevels -= 1;
  state.cards = null;
  state.phase = 'play';
  if (state.pendingLevels > 0) openLevelUp(state);
}

function openLevelUp(state) {
  const cards = drawCards(state, state.rng);
  if (!cards.length) {
    state.pendingLevels = 0;
    return;
  }
  state.cards = cards;
  state.phase = 'levelup';
  state.events.push({ type: 'levelup' });
}

function movePlayer(state, dt, input) {
  const p = state.player;
  if (input.moveX != null) {
    const d = input.moveX - p.x;
    p.x += Math.sign(d) * Math.min(Math.abs(d), PLAYER_SPEED * dt);
  }
  if (input.moveDir) p.x += input.moveDir * PLAYER_SPEED * dt;
  p.x = Math.max(16, Math.min(W - 16, p.x));
  if (input.aim) p.aim = aimVector(p.x, PLAYER_Y, input.aim.x, input.aim.y);
}

function fire(state, dt) {
  state.fireTimer -= dt;
  if (state.fireTimer > 0) return;
  const n = state.slots.length;
  for (let i = 0; i < n; i++) {
    const slot = state.slots[(state.slotCursor + i) % n];
    if (slot.out > 0) continue;
    state.slotCursor = (state.slotCursor + i + 1) % n;
    launch(state, slot);
    state.fireTimer = FIRE_INTERVAL / (1 + state.mods.fireRate);
    return;
  }
}

function launch(state, slot) {
  const traits = traitsFor(slot.kind, state.design);
  const level = state.inventory[slot.kind] ?? 1;
  const dir = state.player.aim;
  const x = state.player.x;
  const y = PLAYER_Y - 12;
  let n = 1;
  if (traits.has('matrix')) {
    const even = traits.has('evenSplit');
    n = (2 + level) * (even ? 2 : 1);
    const spread = even ? 1.4 : 0.14 * (n - 1);
    const base = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < n; i++) {
      const a = base - spread / 2 + (spread * i) / (n - 1);
      state.balls.push(makeBall(state, slot.kind, x, y, clampUp({ x: Math.cos(a), y: Math.sin(a) }),
        { traits, level, slot, dmgScale: 0.6, r: 4 }));
    }
  } else {
    state.balls.push(makeBall(state, slot.kind, x, y, dir, { traits, level, slot }));
  }
  slot.out += n;
  state.stats.shots += 1;
  state.stats.balls += n;
  state.events.push({ type: 'fire' });
}

function teammates(state, dt) {
  const n = Math.floor(state.mods.teammates);
  if (n <= 0) return;
  state.teamTimer -= dt;
  if (state.teamTimer > 0) return;
  state.teamTimer = 1.2 / n;
  const target = lowestTarget(state);
  const x = state.player.x + (state.rng.next() < 0.5 ? -28 : 28);
  const dir = target ? aimVector(x, PLAYER_Y, target.x + target.w / 2, target.y + target.h / 2) : { x: 0, y: -1 };
  state.balls.push(makeBall(state, 'mentee', x, PLAYER_Y - 8, dir, { level: 1, child: true, ttl: 4, dmgScale: 0.6, r: 4 }));
}

function release(state, b) {
  if (b.slot) b.slot.out = Math.max(0, b.slot.out - 1);
  if (!b.child && b.hits === 0) state.stats.misses += 1;
}

function updateBalls(state, dt) {
  const keep = [];
  // Iterating the live array on purpose: children spawned mid-loop move this step too.
  for (const b of state.balls) {
    b.ttl -= dt;
    if (b.ttl <= 0) { release(state, b); continue; }
    steer(state, b, dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (bounceWalls(b)) { release(state, b); continue; }
    collide(state, b);
    keep.push(b);
  }
  state.balls = keep;
}

function collide(state, b) {
  for (const [id, until] of b.cooldowns) if (until <= state.t) b.cooldowns.delete(id);
  const pierce = b.traits.has('pierce');
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (!solid(e)) {
      if (b.traits.has('trace') && !e.revealed && circleRect(b, e)) e.revealed = true;
      continue;
    }
    if (b.cooldowns.has(e.id)) continue;
    const hit = circleRect(b, e);
    if (!hit) continue;
    if (pierce) b.cooldowns.set(e.id, state.t + 0.25);
    else { reflect(b, hit); keepSteep(b); }
    if (state.mods.crossTeam) {
      b.speed = Math.min(BASE_SPEED * 1.6, b.speed * (1 + state.mods.crossTeam));
      setSpeed(b, b.speed);
    }
    b.hits += 1;
    // Tracing reveals what it touches, including a skipped check that would otherwise block the hit.
    if (b.traits.has('trace') && !e.revealed) {
      e.revealed = true;
      e.traced = true;
    }
    if (immune(e)) {
      state.events.push({ type: 'block', x: b.x, y: b.y });
    } else {
      const { damage, cached } = hitDamage(state, b, e, state.rng);
      e.hp -= damage;
      state.events.push({ type: 'hit', x: b.x, y: b.y, kind: b.kind, cached });
      applyHitEffects(state, b, e, state.rng);
      if (e.hp <= 0) kill(state, e);
      else if (e.boss) afterBossHit(state, e);
    }
    b.lastEnemy = e.id;
    if (!pierce) break;
  }
}

function kill(state, e) {
  e.dead = true;
  if (e.boss) {
    if (onBossKilled(state, e)) clearStage(state);
    return;
  }
  onKilled(state, e);
  state.stats.kills += 1;
  state.xp += e.xp * state.stageDef.hpScale * (1 + state.mods.xpGain);
  state.events.push({ type: 'kill', x: e.x + e.w / 2, y: e.y + e.h / 2, kind: e.kind });
  while (state.xp >= state.xpToNext) {
    state.xp -= state.xpToNext;
    state.level += 1;
    state.xpToNext = Math.round(8 + 5 * state.level ** 1.25);
    state.pendingLevels += 1;
  }
}

function startBoss(state) {
  const e = spawnBoss(state);
  state.stats.firstBossAt ??= state.t;
  log(state, 'boss', `Boss: ${state.boss.def.name}`);
  state.events.push({ type: 'intro', boss: e.boss });
}

function clearStage(state) {
  log(state, 'boss', `Resolved: ${state.boss.def.name}`);
  for (const e of state.enemies) e.dead = true;
  state.enemies = [];
  state.pendingRespawns = [];
  state.phase = 'clear';
  state.phaseTimer = CLEAR_TIME;
  state.events.push({ type: 'clear', index: state.stageIndex });
  if (state.stageIndex + 1 < state.design.stages.length) state.pendingLevels += 1;
}

function finish(state, outcome) {
  state.outcome = outcome;
  state.phase = 'over';
  log(state, 'outcome', outcome === 'met' ? 'SLO met' : 'SLO breached');
  state.events.push({ type: 'over', outcome });
}
