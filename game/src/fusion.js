import { MAX_LEVEL, fusionKind } from './balls.js';

export function requiredLevel(state) {
  return Math.max(2, MAX_LEVEL - Math.floor(state.mods.fusionEarly));
}

export function eligibleFusions(state) {
  const need = requiredLevel(state);
  return state.design.fusions.filter((f) =>
    !state.fused.includes(f.id) && f.parts.every((p) => (state.inventory[p] ?? 0) >= need));
}

export function applyFusion(state, fusion) {
  for (const p of fusion.parts) delete state.inventory[p];
  state.inventory[fusionKind(fusion.id)] = MAX_LEVEL;
  state.fused.push(fusion.id);
}
