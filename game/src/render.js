import { W, H, PLAYER_Y, DANGER_Y, REVEAL_BASE, MOVE_BAND_Y } from './world.js';
import { kindInfo } from './balls.js';

const BG = '#0d1117';
const GRID = 'rgba(240, 246, 252, 0.035)';
const BOSS = '#f0883e';
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace';

// Label size in playfield pixels so text is never smaller than 10 CSS pixels on a narrow screen.
export const labelPx = (cssWidth) => 10 * Math.max(1, W / cssWidth);

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function createRenderer(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  const particles = [];
  const colors = new Map();
  let shake = 0;
  let font = `10px ${FONT_FAMILY}`;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    font = `${labelPx(r.width || W).toFixed(1)}px ${FONT_FAMILY}`;
  }

  const ballColor = (state, kind) => {
    if (!colors.has(kind)) colors.set(kind, kindInfo(kind, state.design).color);
    return colors.get(kind);
  };

  function onEvent(ev, state) {
    if (!state || reducedMotion) return;
    if (ev.type === 'breach') shake = Math.min(14, shake + 4 * ev.amount);
    if (ev.type === 'hit') burst(ev.x, ev.y, ballColor(state, ev.kind), ev.cached ? 10 : 3, ev.cached ? 160 : 90);
    if (ev.type === 'kill') burst(ev.x, ev.y, state.design.enemies[ev.kind]?.color ?? BOSS, 14, 140);
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.45, max: 0.45, color });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  function label(text, x, y, color, align = 'left', maxWidth = 0) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    if (maxWidth) ctx.fillText(text, x, y, maxWidth);
    else ctx.fillText(text, x, y);
  }

  function grid() {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 30) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 30) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  function zones(state) {
    const top = DANGER_Y - REVEAL_BASE - state.mods.reveal;
    const g = ctx.createLinearGradient(0, top, 0, DANGER_Y);
    g.addColorStop(0, 'rgba(88, 166, 255, 0)');
    g.addColorStop(1, 'rgba(88, 166, 255, 0.08)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, DANGER_Y - top);
    ctx.strokeStyle = 'rgba(248, 81, 73, 0.7)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(0, DANGER_Y); ctx.lineTo(W, DANGER_Y); ctx.stroke();
    ctx.setLineDash([]);
    label('SLO', 6, DANGER_Y - 4, 'rgba(248, 81, 73, 0.85)');
    ctx.fillStyle = 'rgba(240, 246, 252, 0.03)';
    ctx.fillRect(0, MOVE_BAND_Y, W, H - MOVE_BAND_Y);
  }

  function boss(e) {
    ctx.fillStyle = hexA(BOSS, 0.18);
    ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.strokeStyle = BOSS;
    ctx.lineWidth = 2;
    if (e.shielded) ctx.setLineDash([6, 4]);
    ctx.strokeRect(e.x + 1, e.y + 1, e.w - 2, e.h - 2);
    ctx.setLineDash([]);
    label(e.name, e.x + e.w / 2, e.y + e.h / 2 + 4, BOSS, 'center', e.w - 8);
    ctx.fillStyle = BOSS;
    ctx.fillRect(e.x, e.y + e.h - 3, e.w * Math.max(0, e.hp / e.maxHp), 3);
  }

  function enemies(state) {
    for (const e of state.enemies) {
      if (e.dead || (e.kind === 'silent' && !e.revealed)) continue;
      if (e.boss) { boss(e); continue; }
      const def = state.design.enemies[e.kind];
      const unrevealed = e.kind === 'skipped' && !e.revealed;
      const color = unrevealed ? '#6e7681' : def.color;
      ctx.globalAlpha = e.phased ? 0.25 : 1;
      ctx.fillStyle = hexA(color, 0.16);
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.strokeStyle = e.traced ? '#e05cc1' : color;
      ctx.lineWidth = e.armored ? 3 : 1.5;
      if (e.phased) ctx.setLineDash([4, 3]);
      ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
      ctx.setLineDash([]);
      label(unrevealed ? '✓ PASS' : def.label, e.x + e.w / 2, e.y + e.h / 2 + 4, color, 'center', e.w - 4);
      if (e.hp < e.maxHp) {
        ctx.fillStyle = color;
        ctx.fillRect(e.x, e.y + e.h - 2, e.w * Math.max(0, e.hp / e.maxHp), 2);
      }
      ctx.globalAlpha = 1;
      const p = e.link != null && state.enemies.find((x) => x.id === e.link && !x.dead);
      if (p && p.id > e.id) {
        ctx.strokeStyle = hexA(def.color, 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.x + e.w / 2, e.y + e.h / 2);
        ctx.lineTo(p.x + p.w / 2, p.y + p.h / 2);
        ctx.stroke();
      }
    }
  }

  function balls(state) {
    for (const b of state.balls) {
      ctx.globalAlpha = b.child ? 0.7 : 1;
      ctx.fillStyle = ballColor(state, b.kind);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function player(state) {
    const p = state.player;
    ctx.strokeStyle = 'rgba(240, 246, 252, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(p.x, PLAYER_Y);
    ctx.lineTo(p.x + p.aim.x * 90, PLAYER_Y + p.aim.y * 90);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e6edf3';
    ctx.fillRect(p.x - 18, PLAYER_Y - 5, 36, 10);
    const ready = state.slots.filter((s) => s.out === 0).length;
    label(`${ready}/${state.slots.length}`, p.x, PLAYER_Y + 20, '#8b949e', 'center');
  }

  function fx(dt, paused) {
    for (const p of particles) {
      if (!paused) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  }

  function hud(state) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0); // the HUD never shakes
    ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
    ctx.fillRect(0, 0, W, 36);
    const s = state.stageDef;
    label(`${state.stageIndex + 1}/${state.design.stages.length} ${s.employer}`, 8, 14, '#e6edf3');
    label(`LV ${state.level}`, W - 8, 14, '#e6edf3', 'right');
    const f = Math.max(0, state.budget / state.maxBudget);
    label('ERROR BUDGET', 8, 30, '#8b949e');
    ctx.fillStyle = 'rgba(240, 246, 252, 0.08)';
    ctx.fillRect(100, 22, W - 108, 8);
    ctx.fillStyle = f > 0.5 ? '#3fb950' : f > 0.25 ? '#d29922' : '#f85149';
    ctx.fillRect(100, 22, (W - 108) * f, 8);
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(0, 35, W * Math.min(1, state.xp / state.xpToNext), 1.5);
    const b = state.enemies.find((e) => e.boss && !e.dead);
    if (b) label(`${b.name} ${Math.ceil((100 * b.hp) / b.maxHp)}%`, W / 2, 52, BOSS, 'center');
    else if (state.phase === 'play') label(`boss in ${Math.ceil(Math.max(0, s.duration - state.stageTime))}s`, W - 8, 52, '#8b949e', 'right');
  }

  function draw(state, dt, paused) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (shake > 0 && !paused) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake = Math.max(0, shake - 40 * dt);
    }
    grid();
    if (!state) return;
    zones(state);
    enemies(state);
    balls(state);
    player(state);
    fx(dt, paused);
    hud(state);
  }

  return { resize, onEvent, draw };
}
