import { COLS, COL_W } from './world.js';
import { makeEnemy, colX, spawnDeadlockPair } from './enemies.js';

export function stageRate(state) {
  const s = state.stageDef;
  const ramp = 1 + (s.ramp ?? 0) * Math.min(1, state.stageTime / s.duration);
  return state.boss ? ramp * (s.bossRate ?? 0.5) : ramp;
}

// During a boss fight rows appear below the boss (and Drupal's shield row).
export const rowY = (state) => (state.boss ? 150 : -30);

export function updateSpawner(state, dt, rng) {
  const s = state.stageDef;
  if (s.spikeEvery) {
    state.spikeTimer -= dt;
    if (state.spikeTimer <= 0) { state.spikeTimer += s.spikeEvery; state.spikeDue = true; }
  }
  state.spawnTimer -= dt * stageRate(state);
  if (state.spawnTimer <= 0) {
    state.spawnTimer += s.spawnEvery;
    if (state.spikeDue) { state.spikeDue = false; spawnSpike(state); } else spawnRow(state, rng);
  }
}

function spawnSpike(state) {
  const w = state.design.enemies.request.w ?? 52;
  for (let c = 0; c < COLS; c++) {
    state.enemies.push(makeEnemy(state, 'request', colX(c, w), rowY(state), { hpScale: state.stageDef.hpScale }));
  }
}

export function spawnRow(state, rng) {
  const s = state.stageDef;
  const free = new Set([...Array(COLS).keys()]);
  const kinds = Object.keys(s.mix);
  const count = rng.int(s.rowMin, s.rowMax);
  const y = rowY(state);
  for (let placed = 0; placed < count && free.size; placed++) {
    const col = rng.pick([...free]);
    let kind = rng.weighted(kinds, (k) => s.mix[k]);
    if (kind === 'idle' && !(col % 2 === 0 && free.has(col + 1))) kind = 'request';
    if (kind === 'deadlock' && !free.has(col + 1) && !free.has(col - 1)) kind = 'request';
    free.delete(col);
    if (kind === 'idle') {
      free.delete(col + 1);
      const w = state.design.enemies.idle.w;
      state.enemies.push(makeEnemy(state, 'idle', col * COL_W + (2 * COL_W - w) / 2, y, { hpScale: s.hpScale }));
    } else if (kind === 'deadlock') {
      const other = free.has(col + 1) ? col + 1 : col - 1;
      free.delete(other);
      spawnDeadlockPair(state, col, other, y, s.hpScale);
    } else {
      const w = state.design.enemies[kind].w ?? 52;
      state.enemies.push(makeEnemy(state, kind, colX(col, w), y, { hpScale: s.hpScale }));
    }
  }
}
