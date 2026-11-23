// Minimal but complete game data for unit tests. Real data is exercised by the
// pytest-driven simulation (tests/test_game.py).
import { makeRng } from '../src/rng.js';

const MODS = ['fireRate', 'regen', 'reveal', 'armorPierce', 'testDmg', 'bossDmg', 'xpGain', 'maxBudget',
  'teammates', 'fusionEarly', 'ballCount', 'damage', 'crossTeam', 'tracedBonus', 'docs'];

const enemy = (name, label, extra = {}) => ({ name, label, color: '#58a6ff', hp: 20, budget: 1, xp: 1, cites: ['b1'], blurb: name, ...extra });

export function fixtureData() {
  const design = {
    mods: Object.fromEntries(MODS.map((m) => [m, { label: m, format: m === 'docs' ? 'flag' : 'pct' }])),
    tag_effects: {
      'ci-cd': { fireRate: 0.05 },
      testing: { testDmg: 0.1 },
      ownership: { maxBudget: 0.6 },
      documentation: { docs: 1, regen: 0.004 },
    },
    balls: [
      { id: 'bash', name: 'Bash', color: '#ffffff', traits: [], start: true, blurb: 'b' },
      { id: 'lambda', name: 'Lambda', color: '#ff9900', traits: ['split'], blurb: 'l' },
      { id: 'datadog', name: 'Datadog', color: '#e05cc1', traits: ['trace'], blurb: 'd' },
      { id: 'terraform', name: 'Terraform', color: '#844fba', traits: ['pierce', 'noFalloff'], blurb: 't' },
      { id: 'oidc', name: 'OIDC', color: '#3fb950', traits: ['security'], blurb: 'o' },
      { id: 'cypress', name: 'Cypress', color: '#69d3a7', traits: ['pin'], blurb: 'c' },
      { id: 'redis', name: 'Redis', color: '#ff4438', traits: ['cache'], blurb: 'r' },
      { id: 'rust', name: 'Rust', color: '#dea584', traits: ['heavy', 'pierce'], blurb: 'r' },
      { id: 'pagerduty', name: 'PagerDuty', color: '#57c7ff', traits: ['homing'], blurb: 'p' },
      { id: 'gha', name: 'GitHub Actions', color: '#2f81f7', traits: ['matrix'], blurb: 'g' },
      { id: 'mentee', name: 'Teammate', color: '#8b949e', traits: [], offer: false, blurb: 'm' },
    ],
    fusions: [
      { id: 'self-describing-lambda', name: 'Self-describing Lambda', parts: ['lambda', 'terraform'], bonus: 'copiesInherit', color: '#ffb454', cites: ['b1'], blurb: 'sdl' },
      { id: 'deterministic-replay', name: 'Deterministic Replay', parts: ['rust', 'redis'], bonus: 'cacheAlways', color: '#ffa198', cites: ['p1'], blurb: 'dr' },
    ],
    enemies: {
      request: enemy('Request', 'REQ'),
      flaky: enemy('Flaky Test', 'FLAKY', { hp: 30 }),
      silent: enemy('Silent Defect', 'DEFECT', { hp: 40, budget: 3 }),
      credential: enemy('Long-lived Credential', 'CRED', { hp: 60, armored: true, budget: 2 }),
      idle: enemy('Idle Capacity', 'IDLE', { hp: 140, w: 112, budget: 0, xp: 12 }),
      deadlock: enemy('Deadlock', 'LOCK', { hp: 35 }),
      dependency: enemy('Unpinned Dependency', 'DEP', { hp: 18 }),
      skipped: enemy('Skipped Check', 'SKIP', { hp: 30, budget: 2 }),
      module: enemy('Drupal Module', 'MOD', { hp: 45, budget: 0 }),
    },
    stages: [
      { id: 's1', employer: 'Acme', roles: ['r1'], duration: 10, speed: 20, hpScale: 1, spawnEvery: 2, rowMin: 2, rowMax: 3, spikeEvery: 0, ramp: 0, bossRate: 0.5, mix: { request: 1 }, boss: 'sync-conflict' },
      { id: 's2', employer: 'Beta', roles: ['r1'], duration: 10, speed: 20, hpScale: 1, spawnEvery: 2, rowMin: 2, rowMax: 3, spikeEvery: 0, ramp: 0, bossRate: 0.5, mix: { request: 1 }, boss: 'managed-host-invoice' },
    ],
    bosses: [
      { id: 'sync-conflict', name: 'The Sync Conflict', hp: 100, cites: ['b1'], blurb: 'sc' },
      { id: 'managed-host-invoice', name: 'The Managed Host Invoice', hp: 100, cites: ['b1'], blurb: 'inv' },
      { id: 'drupal-upgrade', name: 'Drupal 8 → 9 → 10', hp: 300, cites: ['b1'], blurb: 'du' },
      { id: 'hard-cutover', name: 'The Hard Cutover', hp: 100, cites: ['b1'], blurb: 'hc' },
    ],
  };
  return {
    person: { name: 'Test Person', email: 'a@b.c', website: 'x.net', github: 'x', linkedin: 'x', summary: 'Engineer.', pdf: 'https://x/resume.pdf' },
    roles: [{
      id: 'r1', title: 'Engineer', employer: 'Acme (contract)', start: '2020-01', end: 'present',
      bullets: [
        { id: 'b1', text: 'Did a thing', tags: ['ci-cd'], weight: 5, alt: '' },
        { id: 'b2', text: 'Tested a thing', tags: ['testing'], weight: 3, alt: 'x' },
        { id: 'b3', text: 'Wrote down a thing', tags: ['documentation', 'ownership'], weight: 3, alt: 'x' },
      ],
    }],
    projects: [{ id: 'p1', name: 'Proj', emoji: '', text: 'A project', url: 'https://x' }],
    design,
  };
}

// A bare state for testing modules below the engine.
export function fixtureState(seed = 1) {
  const data = fixtureData();
  const mods = Object.fromEntries(Object.keys(data.design.mods).map((k) => [k, 0]));
  return {
    data, design: data.design, rng: makeRng(seed), t: 0, nextId: 1,
    stageIndex: 0, stageDef: data.design.stages[0], stageTime: 0, spawnTimer: 0, spikeTimer: 0, spikeDue: false,
    boss: null, player: { x: 240, aim: { x: 0, y: -1 } },
    budget: 20, maxBudget: 20, mods,
    inventory: { bash: 1 }, slots: [], slotCursor: 0,
    balls: [], enemies: [], pendingRespawns: [],
    xp: 0, level: 1, xpToNext: 8, pendingLevels: 0, cards: null, cardsPicked: 0,
    picks: [], pickedAlts: [], fused: [], seen: [], events: [],
    stats: { shots: 0, balls: 0, misses: 0, kills: 0, firstBossAt: null, degradedSince: null, restores: [], crossed: [], timeline: [] },
  };
}

export function rect(state, props) {
  return { id: state.nextId++, kind: 'request', x: 200, y: 200, w: 52, h: 24, hp: 20, maxHp: 20, budget: 1, xp: 1,
    armored: false, revealed: true, traced: false, phased: false, pinnedUntil: 0, phaseOffset: 0, spawnTimer: 3.5,
    link: null, static: false, shieldOf: null, dead: false, boss: null, ...props };
}
