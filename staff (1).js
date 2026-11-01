// Staff screen: live list of my tasks, Accept / Done, countdown, badges.
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, api } from './firebase.js';
import { h, fill, mount, toast, sound, buzz, ms, clock, duration, busy, listenError, dialog } from './ui.js';
import { pushBanner, refreshPushIfGranted, onForegroundPush } from './push.js';

const B = self.BADGES;

export function start({ user, logout, brand }) {
  const uid = user.uid;
  let tasks = new Map();
  let profile = null;
  let firstLoad = true;
  const finishedByMe = new Set();
  const overdueAsked = new Set();
  const focusId = new URLSearchParams(location.search).get('task');

  const list = h('section.task-list', { 'aria-live': 'polite' });
  const badgesEl = h('section.my-badges');
  const statsEl = h('div.stat-line');
  const banner = pushBanner('staff', 'So you hear about new tasks even when this app is closed.');

  const screen = h('div.shell.staff',
    h('header.topbar',
      brand(),
      h('div.topbar-right',
        h('span.who', user.displayName || ''),
        h('button.btn.ghost.small', { type: 'button', onclick: logout }, 'Sign out'))),
    h('main.staff-main',
      banner,
      statsEl,
      list,
      h('h2.section-title', 'My badges'),
      badgesEl));
  mount(screen);

  refreshPushIfGranted('staff').then((ok) => { if (ok && banner) banner.remove(); });
  // Push that arrives while the app is open: the live list already shows it, so just play the sound if it is new.
  onForegroundPush(() => {});

  // ---- Live data ----
  const qTasks = query(collection(db, 'tasks'), where('staffId', '==', uid), where('open', '==', true));
  const unsubTasks = onSnapshot(qTasks, (snap) => {
    snap.docChanges().forEach((c) => {
      const t = { id: c.doc.id, ...c.doc.data() };
      if (c.type === 'removed') {
        tasks.delete(t.id);
        if (!firstLoad && !finishedByMe.has(t.id)) toast(`Cancelled by manager: ${t.typeLabel} · ${t.location}`, 'info', 6000);
      } else {
        tasks.set(t.id, t);
        if (c.type === 'added' && !firstLoad) newTaskAlert(t);
      }
    });
    firstLoad = false;
    renderTasks();
  }, listenError);

  const unsubMe = onSnapshot(doc(db, 'users', uid), (d) => { profile = d.data() || {}; renderBadges(); }, listenError);

  function newTaskAlert(t) {
    if (t.priority === 'urgent') { sound.urgent(); buzz([400, 120, 400, 120, 600]); }
    else { sound.newTask(); buzz([250, 100, 250]); }
    toast(`New task: ${t.typeLabel} · ${t.location}`, t.priority === 'urgent' ? 'error' : 'ok', 6000);
    setTimeout(() => {
      const card = document.querySelector(`[data-task="${t.id}"]`);
      if (card) { card.classList.add('arrive'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 50);
  }

  // ---- Rendering ----
  function sorted() {
    return [...tasks.values()].sort((a, b) =>
      (b.priority === 'urgent') - (a.priority === 'urgent') || ms(a.dueAt) - ms(b.dueAt));
  }

  function renderTasks() {
    const items = sorted();
    if (!items.length) {
      fill(list, h('div.all-clear',
        h('div.all-clear-mark', { 'aria-hidden': 'true' }, '✨'),
        h('h2', 'All clear'),
        h('p', 'New tasks appear here the moment your manager sends them.')));
      return;
    }
    fill(list, ...items.map(taskCard));
    tick();
    if (focusId) { const el = document.querySelector(`[data-task="${focusId}"]`); if (el) el.classList.add('arrive'); }
  }

  function taskCard(t) {
    const urgent = t.priority === 'urgent';
    const doneBtn = h('button.btn.done-btn', { type: 'button', onclick: (e) => finish(t, e.currentTarget) }, 'Done');
    const acceptBtn = t.status === 'assigned'
      ? h('button.btn.ghost.accept-btn', { type: 'button', onclick: (e) => accept(t, e.currentTarget) }, 'On my way')
      : h('span.accepted-note', 'You accepted this');
    return h(`article.task${urgent ? '.urgent' : ''}`, { dataset: { task: t.id, due: ms(t.dueAt), start: ms(t.createdAt) } },
      h('div.tank', { 'aria-hidden': 'true' }, h('div.tank-water')),
      h('div.task-body',
        h('div.task-top',
          h('span.task-type', `${t.typeEmoji || ''} ${t.typeLabel}`.trim()),
          urgent ? h('span.pill.pill-urgent', 'Urgent') : null),
        h('h3.task-where', t.location),
        t.note ? h('p.task-note', t.note) : null,
        h('div.task-clock',
          h('span.clock-num', { role: 'timer' }, '–:––'),
          h('span.clock-label', 'left')),
        h('div.task-actions', acceptBtn, doneBtn)));
  }

  function tick() {
    const now = Date.now();
    document.querySelectorAll('article.task[data-due]').forEach((card) => {
      const due = +card.dataset.due; const start = +card.dataset.start;
      const left = (due - now) / 1000;
      const frac = Math.max(0, Math.min(1, (due - now) / Math.max(1, due - start)));
      card.querySelector('.tank-water').style.transform = `scaleY(${frac})`;
      card.querySelector('.clock-num').textContent = clock(left);
      card.querySelector('.clock-label').textContent = left >= 0 ? 'left' : 'over time';
      card.classList.toggle('late', left < 0);
      card.classList.toggle('low', left >= 0 && frac < 0.25);
      const id = card.dataset.task;
      const t = tasks.get(id);
      if (left < 0 && t && !t.escalatedAt && !overdueAsked.has(id)) {
        overdueAsked.add(id);
        sound.overdue(); buzz([500, 200, 500]);
        api('check-overdue').catch(() => {});
      }
    });
  }
  const timer = setInterval(tick, 1000);

  // ---- Actions ----
  async function accept(t, btn) {
    await busy(btn, async () => {
      try { await updateDoc(doc(db, 'tasks', t.id), { status: 'accepted', acceptedAt: serverTimestamp() }); }
      catch (e) { toast('Could not accept. Check your connection.', 'error'); }
    });
  }

  async function finish(t, btn) {
    await busy(btn, async () => {
      try {
        finishedByMe.add(t.id);
        const r = await api('complete', { taskId: t.id });
        sound.done(); buzz([80, 60, 160]);
        celebrate(t, r);
      } catch (e) {
        finishedByMe.delete(t.id);
        toast(e.message, 'error', 7000);
      }
    });
  }

  function celebrate(t, r) {
    dialog('Task done', (close) => {
      const body = h('div.sheet-body.celebrate',
        h('div.badge-burst', { 'aria-hidden': 'true' }, r.badge.emoji),
        h('h3', r.badge.label),
        h('p', `${t.location} · finished in ${duration(r.durationSec)}${r.onTime ? '' : ' (after the deadline)'}`),
        r.newMilestones.length ? h('div.new-milestones',
          h('p.strong', r.newMilestones.length > 1 ? 'New badges unlocked' : 'New badge unlocked'),
          ...r.newMilestones.map((m) => h('div.milestone.got', h('span.m-emoji', m.emoji), h('div', h('strong', m.label), h('small', m.desc))))) : null,
        h('button.btn.big.wide', { type: 'button', onclick: () => close(true) }, 'Nice'));
      setTimeout(() => close(true), 9000);
      return body;
    });
  }

  function renderBadges() {
    const s = profile.stats || {};
    const today = new Intl.DateTimeFormat('en-CA').format(new Date());
    const todayDone = s.todayDate === today ? s.todayDone || 0 : 0;
    const pct = s.done ? Math.round((100 * (s.onTime || 0)) / s.done) : null;
    fill(statsEl, 
      h('span', h('b', String(todayDone)), ' done today'),
      h('span', h('b', String(s.streak || 0)), ' on-time streak'),
      pct == null ? null : h('span', h('b', `${pct}%`), ' on time'));

    const counts = profile.badgeCounts || {};
    const owned = profile.milestones || {};
    fill(badgesEl, 
      h('div.badge-counts', ...Object.values(B.TASK_BADGES).map((b) =>
        h('div.badge-count', { title: b.desc }, h('span.b-emoji', b.emoji), h('b', String(counts[b.id] || 0)), h('small', b.label)))),
      h('div.milestones', ...B.MILESTONES.map((m) =>
        h(`div.milestone${owned[m.id] ? '.got' : '.locked'}`,
          h('span.m-emoji', owned[m.id] ? m.emoji : '🔒'),
          h('div', h('strong', m.label), h('small', m.desc))))));
  }

  return () => { unsubTasks(); unsubMe(); clearInterval(timer); };
}
