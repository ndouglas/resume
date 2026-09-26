import { newRun, step, chooseCard } from './engine.js';
import { STEP, W, H, MOVE_BAND_Y } from './world.js';
import { createRenderer } from './render.js';
import { summarize, loadBest, saveBest } from './postmortem.js';
import { cardView, citedText, years } from './cards.js';
import * as ui from './ui.js';

const canvas = document.getElementById('pit');
const frameEl = document.querySelector('.frame');
const wrapEl = document.querySelector('.stage-wrap');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const storage = (() => { try { return window.localStorage; } catch { return null; } })();

let data;
try {
  const res = await fetch('game-data.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  data = await res.json();
} catch (err) {
  ui.showError('The game data did not load. The résumé is still one click away.', '../resume.pdf');
  throw err;
}
document.getElementById('pdf').href = data.person.pdf;

const renderer = createRenderer(canvas, { reducedMotion });
const input = { aim: null, moveX: null };
const keys = new Set();
let movePointer = null;
let state = null;
let paused = false;
let last = performance.now();
let acc = 0;

function fit() {
  const cs = getComputedStyle(wrapEl);
  const availW = wrapEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = wrapEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const width = Math.floor(Math.min(availW, (availH * W) / H));
  frameEl.style.width = `${width}px`;
  frameEl.style.height = `${Math.floor((width * H) / W)}px`;
  renderer.resize();
}
window.addEventListener('resize', fit);
fit();

function toWorld(ev) {
  const r = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) * W) / r.width, y: ((ev.clientY - r.top) * H) / r.height };
}
function route(ev) {
  const p = toWorld(ev);
  if (p.y > MOVE_BAND_Y) {
    movePointer = ev.pointerId;
    input.moveX = p.x;
  } else {
    input.aim = p;
    if (movePointer === ev.pointerId) { movePointer = null; input.moveX = null; }
  }
}
canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); route(ev); });
canvas.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) route(ev); });
const release = (ev) => { if (ev.pointerId === movePointer) { movePointer = null; input.moveX = null; } };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const running = () => state && state.phase !== 'over';
window.addEventListener('keydown', (ev) => {
  if (KEYS[ev.code]) { keys.add(KEYS[ev.code]); ev.preventDefault(); return; }
  if (ev.code === 'KeyP' || ev.code === 'Escape') { if (running()) setPaused(!paused); return; }
  if (/^Digit[1-3]$/.test(ev.code) && !paused) pick(Number(ev.code.slice(5)) - 1);
});
window.addEventListener('keyup', (ev) => { if (KEYS[ev.code]) keys.delete(KEYS[ev.code]); });
window.addEventListener('blur', () => { keys.clear(); if (running()) setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && running()) setPaused(true); });

function setPaused(on) {
  paused = on;
  ui.showPause(on);
}
document.getElementById('resume').addEventListener('click', () => setPaused(false));
document.getElementById('skip').addEventListener('click', openResume);

function openResume() {
  if (running()) setPaused(true);
  ui.showPostmortem(data, null, { onRestart: start, onClose: ui.hidePostmortem });
}

function start() {
  ui.hidePostmortem();
  ui.hideTitle();
  ui.hideCards();
  state = newRun(data, (Math.random() * 2 ** 32) >>> 0);
  acc = 0;
  setPaused(false);
}

function pick(i) {
  if (!state || state.phase !== 'levelup' || !state.cards[i]) return;
  ui.hideCards();
  chooseCard(state, i);
}

function showTitleScreen() {
  ui.showTitle(data, loadBest(storage), start, openResume);
}

function handle(ev) {
  switch (ev.type) {
    case 'stage': {
      const s = data.design.stages[ev.index];
      const roles = data.roles.filter((r) => s.roles.includes(r.id));
      ui.showBanner(`Stage ${ev.index + 1} · ${s.employer}`, roles.map((r) => `${r.title} (${years(r.start, r.end)})`).join(' · '), 3000);
      break;
    }
    case 'intro':
      if (ev.boss) {
        const b = data.design.bosses.find((x) => x.id === ev.boss);
        ui.showToast(`Boss: ${b.name}`, b.blurb, citedText(data, b.cites[0]));
      } else {
        const e = data.design.enemies[ev.kind];
        ui.showToast(`New failure mode: ${e.name}`, e.blurb, citedText(data, e.cites[0]));
      }
      break;
    case 'levelup':
      ui.showCards(state.cards.map((c) => cardView(c, state)), pick);
      break;
    case 'clear':
      ui.showBanner('Resolved', ev.index + 1 < data.design.stages.length ? 'Next stage incoming' : 'Every stage cleared');
      break;
    case 'banner':
      ui.showBanner(ev.text, ev.sub);
      break;
    case 'over': {
      const summary = summarize(state);
      saveBest(storage, summary);
      setTimeout(() => ui.showPostmortem(data, summary, {
        onRestart: start,
        onClose: () => { ui.hidePostmortem(); showTitleScreen(); },
      }), 900);
      break;
    }
    default:
      renderer.onEvent(ev, state);
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state && !paused) {
    acc += dt;
    const moveDir = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const inp = { aim: input.aim, moveX: input.moveX, moveDir };
    let n = 0;
    while (acc >= STEP && n < 12) { step(state, STEP, inp); acc -= STEP; n++; }
    if (n === 12) acc = 0;
  }
  if (state) for (const ev of state.events.splice(0)) handle(ev);
  renderer.draw(state, dt, paused);
  requestAnimationFrame(frame);
}

showTitleScreen();
requestAnimationFrame(frame);
