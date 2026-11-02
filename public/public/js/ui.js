// Small UI toolkit: safe element builder, toasts, sounds, dialogs, time formatting.

/** h('div.card#id', {attrs}, ...children) — text children are inserted as text (never HTML). */
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) kids.unshift(attrs);
    attrs = {};
  }
  const [, tag = 'div', rest = ''] = sel.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(tag || 'div');
  rest.replace(/([.#])([\w-]+)/g, (_, k, v) => { if (k === '.') el.classList.add(v); else el.id = v; });
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'style' && typeof v === 'object') Object.entries(v).forEach(([p, val]) => (p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val)));
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export const $ = (s, root = document) => root.querySelector(s);

/** Replace an element's children, skipping null/false (so `cond ? el : null` is safe). */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

export function mount(el) {
  const root = document.getElementById('app');
  fill(root, el);
  return el;
}

// ---------- Toasts ----------
export function toast(message, kind = 'info', ms = 4200) {
  let wrap = document.getElementById('toasts');
  if (!wrap) { wrap = h('div#toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(wrap); }
  const t = h(`div.toast.toast-${kind}`, message);
  wrap.prepend(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- Sounds (generated in the browser, no sound files needed) ----------
let audio;
function ctx() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}
// Browsers only allow sound after the first tap on the page.
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => ctx(), { once: true }));
export const soundReady = () => !!audio && audio.state === 'running';

function tone(freq, start, dur, type = 'sine', vol = 0.18, slideTo) {
  const a = ctx(); if (!a) return;
  const v = Math.max(0.0002, vol * soundPrefs().volume * 2.2);
  const o = a.createOscillator(); const g = a.createGain();
  const t0 = a.currentTime + start;
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// Each tone plays starting at `s` seconds and returns how long it lasts.
export const TONES = {
  chime:   { label: 'Chime',      play: (s) => { tone(660, s, 0.18); tone(880, s + 0.2, 0.18); tone(660, s + 0.4, 0.18); tone(880, s + 0.6, 0.3); return 0.95; } },
  dingdong:{ label: 'Ding-dong',  play: (s) => { tone(988, s, 0.5, 'sine', 0.22); tone(784, s + 0.45, 0.7, 'sine', 0.22); return 1.2; } },
  bell:    { label: 'Bell',       play: (s) => { [1568, 2093, 3136].forEach((f, i) => tone(f, s, 1.1 - i * 0.25, 'sine', 0.12 / (i + 1))); return 1.1; } },
  marimba: { label: 'Marimba',    play: (s) => { [523, 659, 784, 1047].forEach((f, i) => tone(f, s + i * 0.11, 0.22, 'triangle', 0.25)); return 0.6; } },
  rise:    { label: 'Rising',     play: (s) => { tone(440, s, 0.5, 'sine', 0.2, 1320); return 0.55; } },
  pop:     { label: 'Soft pop',   play: (s) => { tone(880, s, 0.12, 'sine', 0.12); return 0.2; } },
  success: { label: 'Success',    play: (s) => { tone(784, s, 0.14); tone(1047, s + 0.13, 0.3); return 0.45; } },
  beep:    { label: 'Beep-beep',  play: (s) => { for (let i = 0; i < 3; i++) tone(1200, s + i * 0.2, 0.12, 'square', 0.1); return 0.6; } },
  digital: { label: 'Digital',    play: (s) => { for (let i = 0; i < 4; i++) tone(988, s + i * 0.28, 0.16, 'square', 0.12); return 1.1; } },
  low:     { label: 'Low warning',play: (s) => { tone(440, s, 0.3, 'triangle', 0.25); tone(330, s + 0.32, 0.45, 'triangle', 0.25); return 0.8; } },
  alarm:   { label: 'Alarm',      play: (s) => { for (let i = 0; i < 6; i++) tone(i % 2 ? 660 : 880, s + i * 0.18, 0.17, 'sawtooth', 0.12); return 1.1; } },
  siren:   { label: 'Siren',      play: (s) => { tone(600, s, 0.6, 'sawtooth', 0.12, 1200); tone(1200, s + 0.6, 0.6, 'sawtooth', 0.12, 600); return 1.25; } },
  none:    { label: 'No sound',   play: () => 0 },
};

// Every moment that makes a sound, who hears it, and the default tone.
export const SOUND_EVENTS = [
  { id: 'newTask',      role: 'staff',   label: 'New task',                     tone: 'chime',    repeat: 2, vibrate: [250, 100, 250] },
  { id: 'urgentTask',   role: 'staff',   label: 'New urgent task',              tone: 'alarm',    repeat: 3, vibrate: [400, 120, 400, 120, 600] },
  { id: 'reminder',     role: 'staff',   label: 'Reminder: not started',        tone: 'dingdong', repeat: 1, vibrate: [200, 100, 200] },
  { id: 'almostDue',    role: 'staff',   label: 'Time almost up',               tone: 'digital',  repeat: 2, vibrate: [300, 100, 300] },
  { id: 'timesUp',      role: 'staff',   label: "Time's up",                    tone: 'siren',    repeat: 2, vibrate: [500, 200, 500] },
  { id: 'taskDone',     role: 'staff',   label: 'Task done (on time)',          tone: 'success',  repeat: 1, vibrate: [80, 60, 160] },
  { id: 'lateDone',     role: 'staff',   label: 'Task done late',               tone: 'low',      repeat: 1, vibrate: [300] },
  { id: 'sent',         role: 'manager', label: 'Task sent',                    tone: 'rise',     repeat: 1, vibrate: [60] },
  { id: 'accepted',     role: 'manager', label: 'Staff tapped "On my way"',     tone: 'pop',      repeat: 1, vibrate: null },
  { id: 'finished',     role: 'manager', label: 'Task finished on time',        tone: 'success',  repeat: 1, vibrate: null },
  { id: 'finishedLate', role: 'manager', label: 'Task finished late',           tone: 'low',      repeat: 1, vibrate: [200] },
  { id: 'overdue',      role: 'manager', label: 'Task overdue',                 tone: 'alarm',    repeat: 3, vibrate: [500, 200, 500, 200, 500] },
];
const REPEATS = [1, 2, 3, 5];
const PREFS_KEY = 'tc_sound_v1';

let prefsCache = null;
export function soundPrefs() {
  if (prefsCache) return prefsCache;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { /* ignore */ }
  const events = {};
  SOUND_EVENTS.forEach((e) => {
    const s = (saved.events || {})[e.id] || {};
    events[e.id] = { tone: TONES[s.tone] ? s.tone : e.tone, repeat: REPEATS.includes(s.repeat) ? s.repeat : e.repeat };
  });
  prefsCache = {
    muted: !!saved.muted,
    vibrate: saved.vibrate !== false,
    volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0.05, saved.volume)) : 0.7,
    events,
  };
  return prefsCache;
}
function savePrefs(p) {
  prefsCache = p;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
}

let playing = null;
/** Play the sound (and vibration) chosen for an event, e.g. play('newTask'). */
export function play(eventId, { test = false } = {}) {
  const ev = SOUND_EVENTS.find((e) => e.id === eventId); if (!ev) return;
  const p = soundPrefs();
  if (ev.vibrate && p.vibrate && !test) buzz(ev.vibrate);
  if (p.muted && !test) return;
  const cfg = p.events[eventId];
  const t = TONES[cfg.tone] || TONES.chime;
  if (playing) clearTimeout(playing);
  let start = 0;
  for (let i = 0; i < cfg.repeat; i++) start += t.play(start) + 0.35;
  playing = setTimeout(() => { playing = null; }, start * 1000);
}

// Old names kept so older code keeps working.
export const sound = {
  newTask: () => play('newTask'), urgent: () => play('urgentTask'), done: () => play('finished'),
  overdue: () => play('overdue'), soft: () => play('accepted'),
};
export function buzz(pattern) {
  if (!soundPrefs().vibrate) return;
  try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}

/** Sound settings panel for this device. role = 'staff' | 'manager'. */
export function soundSettings(role) {
  const p = soundPrefs();
  const update = (fn) => { const next = JSON.parse(JSON.stringify(soundPrefs())); fn(next); savePrefs(next); };
  const events = SOUND_EVENTS.filter((e) => e.role === role);

  const vol = h('input', {
    type: 'range', min: 5, max: 100, step: 5, value: Math.round(p.volume * 100), 'aria-label': 'Volume',
    oninput: (e) => update((n) => { n.volume = e.target.value / 100; }),
    onchange: () => play(events[0].id, { test: true }),
  });

  return h('div.sound-settings',
    h('p.hint', 'Sounds play while the app is open on screen. Keep the phone volume up. When the phone is locked, it uses its normal notification sound.'),
    h('div.sound-master',
      h('label.switch', h('input', { type: 'checkbox', checked: !p.muted, onchange: (e) => update((n) => { n.muted = !e.target.checked; }) }), h('span', 'Sound on')),
      h('label.switch', h('input', { type: 'checkbox', checked: p.vibrate, onchange: (e) => update((n) => { n.vibrate = e.target.checked; }) }), h('span', 'Vibrate'))),
    h('label.volume', h('span', 'Volume'), vol),
    h('div.sound-list', ...events.map((ev) => {
      const cfg = p.events[ev.id];
      return h('div.sound-row',
        h('span.sound-label', ev.label),
        h('select', { 'aria-label': `${ev.label} sound`, onchange: (e) => { update((n) => { n.events[ev.id].tone = e.target.value; }); play(ev.id, { test: true }); } },
          ...Object.entries(TONES).map(([id, t]) => h('option', { value: id, selected: id === cfg.tone }, t.label))),
        h('select.repeat', { 'aria-label': `${ev.label} repeat`, onchange: (e) => update((n) => { n.events[ev.id].repeat = +e.target.value; }) },
          ...REPEATS.map((r) => h('option', { value: r, selected: r === cfg.repeat }, `${r}×`))),
        h('button.btn.ghost.small', { type: 'button', 'aria-label': `Test ${ev.label}`, onclick: () => play(ev.id, { test: true }) }, '▶ Test'));
    })),
    h('div.row-start', h('button.btn.ghost.small', { type: 'button', onclick: () => {
      const next = JSON.parse(JSON.stringify(soundPrefs()));
      events.forEach((e) => { next.events[e.id] = { tone: e.tone, repeat: e.repeat }; });
      savePrefs(next); toast('Sounds reset to default. Reopen this panel to see them.', 'info');
    } }, 'Reset to default')));
}

// ---------- Time ----------
export const ms = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : ts ? +ts : 0);

export function clock(sec) {
  const neg = sec < 0; sec = Math.abs(Math.round(sec));
  const m = Math.floor(sec / 60); const s = sec % 60;
  return `${neg ? '+' : ''}${m}:${String(s).padStart(2, '0')}`;
}
export function duration(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60); const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function timeOfDay(ts) {
  const t = ms(ts); if (!t) return '';
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

// ---------- Dialog ----------
/** Opens a modal. `build(close)` returns the content element. Resolves with the value passed to close(). */
export function dialog(title, build) {
  return new Promise((resolve) => {
    const dlg = h('dialog.sheet');
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(h('div.sheet-head', h('h2', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, '✕')), build(close));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return dialog(title, (close) => h('div.sheet-body',
    h('p', text),
    h('div.row-end',
      h('button.btn.ghost', { type: 'button', onclick: () => close(false) }, 'Keep it'),
      h(`button.btn${danger ? '.danger' : ''}`, { type: 'button', onclick: () => close(true) }, okLabel))
  ));
}

/** Run an async action on a button: disables it and shows a busy state. */
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true; btn.classList.add('busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('busy'); }
}

/** Firestore listener errors: show a useful message (index links included). */
export function listenError(e) {
  console.error(e);
  const link = String(e.message || '').match(/https:\/\/console\.firebase\.google\.com\S+/);
  if (link) {
    toast(h('span', 'Firestore needs an index. ', h('a', { href: link[0], target: '_blank', rel: 'noopener' }, 'Create it'), ', wait a minute, then reload.'), 'error', 20000);
  } else if (e.code === 'permission-denied') {
    toast('Access denied by Firestore rules. Publish firestore.rules in the Firebase console.', 'error', 12000);
  } else {
    toast(`Live updates paused: ${e.message}`, 'error', 8000);
  }
}
