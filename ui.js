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
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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

// ---------- Sounds (generated, no files needed) ----------
let audio;
function ctx() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}
// Browsers only allow sound after the first tap on the page.
document.addEventListener('pointerdown', () => ctx(), { once: true });

function tone(freq, start, dur, type = 'sine', vol = 0.18) {
  const a = ctx(); if (!a) return;
  const o = a.createOscillator(); const g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, a.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start); o.stop(a.currentTime + start + dur + 0.05);
}
export const sound = {
  newTask() { tone(660, 0, 0.18); tone(880, 0.2, 0.18); tone(660, 0.4, 0.18); tone(880, 0.6, 0.3); },
  urgent() { for (let i = 0; i < 4; i++) { tone(988, i * 0.28, 0.16, 'square', 0.12); } },
  done() { tone(784, 0, 0.14); tone(1047, 0.13, 0.3); },
  overdue() { tone(440, 0, 0.3, 'triangle', 0.25); tone(330, 0.32, 0.45, 'triangle', 0.25); },
  soft() { tone(880, 0, 0.12, 'sine', 0.1); },
};
export function buzz(pattern) { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) { /* ignore */ } }

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
