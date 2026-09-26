import { years } from './cards.js';

const $ = (id) => document.getElementById(id);
let bannerTimer = 0;
let toastTimer = 0;

// Builds DOM from text only; résumé content never goes through innerHTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export function links(person) {
  return [
    ['Résumé (PDF)', person.pdf],
    [person.website, `https://${person.website}`],
    ['GitHub', `https://github.com/${person.github}`],
    ['LinkedIn', `https://www.linkedin.com/in/${person.linkedin}/`],
    [person.email, `mailto:${person.email}`],
  ];
}

// replaceChildren renders null as the text "null"; optional children are dropped here instead.
const fill = (node, ...children) => node.replaceChildren(...children.filter((c) => c !== null && c !== undefined));

const kbd = (k) => el('span', { class: 'kbd' }, k);

export function showTitle(data, best, onStart, onResume) {
  fill($('title'),
    el('h1', {}, 'Error Budget'),
    el('p', {}, `A roguelike built from ${data.person.name}'s résumé. Production is the pit. Failure modes fall toward your SLO line, and every one that lands burns error budget.`),
    el('p', {}, 'Level up by merging PRs. Every card is a real line from the résumé, and its tags decide what it does.'),
    el('p', {}, 'Aim with the mouse or by touching the pit. Move with ', kbd('A'), ' ', kbd('D'), ', the arrow keys, or by dragging along the bottom. ', kbd('P'), ' pauses.'),
    best ? el('p', {}, `Your best run: ${best.outcome === 'met' ? 'SLO met' : `reached stage ${best.stageReached}`}.`) : null,
    el('div', { class: 'actions' },
      el('button', { class: 'primary', type: 'button', onclick: onStart }, 'Start run'),
      el('button', { type: 'button', onclick: onResume }, 'Read the résumé instead')),
  );
  $('title').hidden = false;
  $('title').querySelector('button.primary').focus({ preventScroll: true });
}

export const hideTitle = () => { $('title').hidden = true; };

export function showError(message, href) {
  fill($('title'),
    el('h1', {}, 'Error Budget'),
    el('p', {}, message),
    el('div', { class: 'actions' }, el('a', { class: 'btn', href }, 'Open the résumé (PDF)')),
  );
  $('title').hidden = false;
}

// Touch players are usually mid-tap when a level-up appears; ignore taps until the cards have been visible briefly.
const CARD_TAP_GRACE_MS = 300;

export function showCards(views, onPick) {
  const c = $('cards');
  const shownAt = performance.now();
  c.replaceChildren(
    el('div', { class: 'cards-head' }, 'Level up. Pick one.'),
    ...views.map((v, i) => el('button', { class: 'card', type: 'button', onclick: () => { if (performance.now() - shownAt >= CARD_TAP_GRACE_MS) onPick(i); } },
      el('span', { class: 'kicker' }, `${i + 1} · ${v.kicker}`),
      el('strong', {}, v.title),
      v.sub ? el('span', { class: 'kicker' }, v.sub) : null,
      el('span', { class: 'text' }, v.text),
      v.quote ? el('q', {}, v.quote) : null,
      v.chips.length ? el('span', { class: 'chips' }, v.chips.map((ch) => el('span', { class: 'chip' }, ch))) : null)),
  );
  c.hidden = false;
  c.scrollTop = 0;
  c.querySelector('button')?.focus({ preventScroll: true });
}

export const hideCards = () => { $('cards').hidden = true; };

export function showBanner(title, sub, ms = 2200) {
  const b = $('banner');
  fill(b, el('strong', {}, title), sub ? el('span', {}, sub) : null);
  b.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}

export function showToast(title, body, quote, ms = 6000) {
  const t = $('toast');
  fill(t, el('strong', {}, title), el('div', {}, body), quote ? el('q', {}, quote) : null);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export const showPause = (on) => { $('pause').hidden = !on; };

const stat = (value, labelText) => el('div', { class: 'stat' }, el('b', {}, String(value)), el('span', {}, labelText));

export function showPostmortem(data, summary, { onRestart, onClose }) {
  const person = data.person;
  const parts = [];
  if (summary) {
    parts.push(
      el('h2', { class: summary.outcome }, summary.outcome === 'met' ? 'Postmortem: SLO met' : 'Postmortem: SLO breached'),
      el('p', { class: 'dim' }, `Reached stage ${summary.stageReached} of ${summary.stages} · ${summary.duration} · level ${summary.level} · ${summary.kills} failure modes resolved`),
      el('h3', {}, 'Delivery metrics'),
      el('div', { class: 'dora' },
        stat(summary.deploys, 'Deploys (shots fired)'),
        stat(`${Math.round(summary.changeFailureRate * 100)}%`, 'Change failure rate (balls that hit nothing)'),
        stat(summary.timeToRestore == null ? '—' : `${summary.timeToRestore.toFixed(1)}s`, 'Mean time to restore full budget'),
        stat(summary.leadTime == null ? '—' : `${Math.round(summary.leadTime)}s`, 'Lead time to first boss')),
      el('h3', {}, summary.detailed ? 'Timeline (full, because you picked documentation)' : 'Timeline'),
      el('ol', { class: 'timeline' }, summary.timeline.map((e) => el('li', {}, el('time', {}, e.clock), e.text))),
    );
    if (summary.picks.length) {
      parts.push(el('h3', {}, 'What you shipped'), ...summary.picks.map((g) => el('div', { class: 'role' },
        el('div', { class: 'who' }, g.role, el('span', { class: 'when' }, ` · ${g.employer}`)),
        el('ul', {}, g.bullets.map((b) => el('li', {}, b))))));
    }
  }
  parts.push(
    el('h3', {}, `About ${person.name}`),
    el('p', {}, person.summary),
    el('div', { class: 'links' }, links(person).map(([text, href]) => el('a', { class: 'btn', href }, text))),
    el('h3', {}, 'Experience'),
    ...data.roles.map((r) => el('div', { class: 'role' },
      el('div', { class: 'who' }, r.title),
      el('div', { class: 'when' }, `${r.employer} · ${years(r.start, r.end)}`))),
    el('h3', {}, 'Projects'),
    ...data.projects.map((p) => el('div', { class: 'role' },
      el('div', { class: 'who' }, el('a', { href: p.url }, `${p.emoji ? `${p.emoji} ` : ''}${p.name}`)),
      el('div', { class: 'when' }, p.text))),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', type: 'button', onclick: onRestart }, summary ? 'Run it back' : 'Start a run'),
      el('button', { type: 'button', onclick: onClose }, 'Close')),
  );
  const pm = $('postmortem');
  pm.replaceChildren(el('div', { class: 'pm' }, parts));
  pm.hidden = false;
  pm.scrollTop = 0;
}

export const hidePostmortem = () => { $('postmortem').hidden = true; };
