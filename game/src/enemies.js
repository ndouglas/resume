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
