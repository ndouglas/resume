const THRESHOLDS = [0.75, 0.5, 0.25];
const HEADLINE = new Set(['stage', 'boss', 'fusion', 'outcome']);
const BEST_KEY = 'error-budget.best';

export function newStats() {
  return { shots: 0, balls: 0, misses: 0, kills: 0, firstBossAt: null, degradedSince: null, restores: [], crossed: [], timeline: [] };
}

export function log(state, kind, text) {
  state.stats.timeline.push({ t: state.t, kind, text });
}

export function noteBudget(state) {
  const s = state.stats;
  const f = state.budget / state.maxBudget;
  const full = f >= 1 - 1e-9;
  if (!full && s.degradedSince === null) s.degradedSince = state.t;
  if (full && s.degradedSince !== null) {
    s.restores.push(state.t - s.degradedSince);
    s.degradedSince = null;
  }
  for (const th of THRESHOLDS) {
    const key = String(th);
    if (f < th && !s.crossed.includes(key)) {
      s.crossed.push(key);
      log(state, 'budget', `Error budget below ${th * 100}%`);
    } else if (f >= th + 0.05 && s.crossed.includes(key)) {
      s.crossed = s.crossed.filter((k) => k !== key);
    }
  }
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function summarize(state) {
  const s = state.stats;
  const detailed = state.mods.docs > 0;
  const events = detailed ? s.timeline : s.timeline.filter((e) => HEADLINE.has(e.kind));
  const picks = [];
  for (const role of state.data.roles) {
    const bullets = role.bullets.filter((b) => state.picks.includes(b.id)).map((b) => b.text);
    if (bullets.length) picks.push({ role: role.title, employer: role.employer, bullets });
  }
  return {
    outcome: state.outcome,
    stageReached: state.stageIndex + 1,
    stages: state.design.stages.length,
    duration: fmtClock(state.t),
    deploys: s.shots,
    changeFailureRate: s.balls ? s.misses / s.balls : 0,
    timeToRestore: s.restores.length ? s.restores.reduce((a, b) => a + b, 0) / s.restores.length : null,
    leadTime: s.firstBossAt,
    kills: s.kills,
    level: state.level,
    timeline: events.map((e) => ({ clock: fmtClock(e.t), kind: e.kind, text: e.text })),
    detailed,
    picks,
  };
}

export function loadBest(storage) {
  try {
    const raw = storage?.getItem(BEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBest(storage, summary) {
  const score = (x) => x.stageReached + (x.outcome === 'met' ? 10 : 0);
  const best = loadBest(storage);
  if (best && score(best) >= score(summary)) return best;
  const next = { outcome: summary.outcome, stageReached: summary.stageReached };
  try {
    storage?.setItem(BEST_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or blocked storage: the run still counts, it just isn't remembered.
  }
  return next;
}
