// Headless run for tests/test_game.py: node sim.mjs <game-data.json> <bot|idle> <seed>
// "bot" aims at and moves under whatever is closest to breaching, and takes
// fusions, then tools, then bullets. "idle" never fires.
import { readFileSync } from 'node:fs';
import { newRun, step, chooseCard } from '../src/engine.js';
import { lowestTarget } from '../src/enemies.js';
import { STEP } from '../src/world.js';

const [file, mode = 'bot', seedArg = '1'] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, 'utf8'));
const state = newRun(data, Number(seedArg));
const LIMIT = 20 * 60;
const PREFERENCE = ['fusion', 'ball', 'bullet'];

while (state.phase !== 'over' && state.t < LIMIT) {
  if (state.phase === 'levelup') {
    const ranked = state.cards.map((c, i) => [PREFERENCE.indexOf(c.type), i]).sort((a, b) => a[0] - b[0]);
    chooseCard(state, ranked[0][1]);
    continue;
  }
  let input = { fire: false };
  if (mode === 'bot') {
    const target = lowestTarget(state);
    input = target
      ? { moveX: target.x + target.w / 2, aim: { x: target.x + target.w / 2, y: target.y + target.h / 2 } }
      : { aim: { x: state.player.x, y: 0 } };
  }
  step(state, STEP, input);
  state.events.length = 0;
}

console.log(JSON.stringify({ outcome: state.outcome, stage: state.stageIndex + 1, t: Math.round(state.t), level: state.level, picks: state.picks.length }));
