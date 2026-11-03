// Staff screen: live list of my tasks, Accept / Done, countdown, badges.
import { collection, query, where, onSnapshot, doc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, api } from './firebase.js';
import { getMap, mapThumb } from './maps.js';
import { pickPhoto, photoPreview, photoButton } from './photos.js';
import { h, fill, mount, toast, play, ms, clock, duration, timeOfDay, busy, listenError, dialog, confirmBox, soundSettings } from './ui.js';
import { pushBanner, refreshPushIfGranted, onForegroundPush } from './push.js';

const B = self.BADGES;

export function start({ user, logout, brand }) {
  const uid = user.uid;
  let tasks = new Map();
  let profile = null;
  let firstLoad = true;
  const finishedByMe = new Set();
  const alertedSteps = new Set(); // "taskId:step" already announced on this screen
  let lastCheck = 0;
  const focusId = new URLSearchParams(location.search).get('task');

  const list = h('section.task-list', { 'aria-live': 'polite' });
  const takenEl = h('section.taken-list');
  // Whose task is it?  mine = I own it · offered = sent to several, nobody has taken it · taken = a teammate took it
  // declined = I said "Can't go" and it's waiting for the manager (or for a teammate in a group)
  const iDeclined = (t) => (t.declines || []).some((d) => d.uid === uid);
  const owner = (t) => (t.staffId && t.staffId !== uid ? 'taken'
    : iDeclined(t) || (t.status === 'declined' && t.staffId === uid) ? 'declined'
      : t.staffId === uid ? 'mine' : 'offered');
  const badgesEl = h('section.my-badges');
  const statsEl = h('div.stat-line');
  const dutyEl = h('section.duty-bar');
  const banner = pushBanner('staff', 'So you hear about new tasks even when this app is closed.');

  const screen = h('div.shell.staff',
    h('header.topbar',
      brand(),
      h('div.topbar-right',
        h('span.who', user.displayName || ''),
        h('button.icon-btn.sound-btn', { type: 'button', 'aria-label': 'Sound settings', title: 'Sound settings', onclick: () => dialog('Sounds', () => h('div.sheet-body', soundSettings('staff'))) }, '🔊'),
        h('button.btn.ghost.small', { type: 'button', onclick: logout }, 'Sign out'))),
    h('main.staff-main',
      banner,
      dutyEl,
      statsEl,
      list,
      takenEl,
      h('h2.section-title', 'My badges'),
      badgesEl));
  mount(screen);

  refreshPushIfGranted('staff').then((ok) => { if (ok && banner) banner.remove(); });
  // Push that arrives while the app is open: new tasks and most reminders already sound from the live list and timer.
  onForegroundPush((p) => {
    const d = (p && p.data) || {};
    // Repeat "still not done" reminders aren't covered by the on-screen timer, so play them here.
    if (d.type === 'reminder' && d.step === 'overdueReminder') {
      play('timesUp');
      if (p.notification) toast(`${p.notification.title}: ${p.notification.body}`, 'error', 9000);
    }
  });

  // ---- Live data ----
  const qTasks = query(collection(db, 'tasks'), where('staffIds', 'array-contains', uid), where('open', '==', true));
  const unsubTasks = onSnapshot(qTasks, (snap) => {
    snap.docChanges().forEach((c) => {
      const t = { id: c.doc.id, ...c.doc.data() };
      const before = tasks.get(t.id);
      if (c.type === 'removed') {
        tasks.delete(t.id);
        if (firstLoad || finishedByMe.has(t.id) || !before) return;
        if (owner(before) === 'mine') toast(`Cancelled by manager: ${t.typeLabel} · ${t.location}`, 'info', 6000);
        else if (owner(before) === 'offered') toast(`Closed: ${t.typeLabel} · ${t.location}. No need to go.`, 'info', 6000);
      } else {
        tasks.set(t.id, t);
        if (c.type === 'added' && !firstLoad && owner(t) !== 'taken') newTaskAlert(t);
        // A teammate took a task that was offered to me too.
        if (before && owner(before) === 'offered' && owner(t) === 'taken') {
          toast(`${t.staffName} is on it: ${t.typeLabel} · ${t.location}. No need to go.`, 'info', 6000);
        }
      }
    });
    firstLoad = false;
    renderTasks();
  }, listenError);

  const unsubMe = onSnapshot(doc(db, 'users', uid), (d) => { profile = d.data() || {}; renderBadges(); renderDuty(); }, listenError);

  function newTaskAlert(t) {
    play(t.priority === 'urgent' ? 'urgentTask' : 'newTask');
    toast(`New task: ${t.typeLabel} · ${t.location}`, t.priority === 'urgent' ? 'error' : 'ok', 6000);
    setTimeout(() => {
      const card = document.querySelector(`[data-task="${t.id}"]`);
      if (card) { card.classList.add('arrive'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 50);
  }

  // ---- Rendering ----
  function sorted() {
    return [...tasks.values()].filter((t) => owner(t) === 'mine' || owner(t) === 'offered').sort((a, b) =>
      (b.priority === 'urgent') - (a.priority === 'urgent') || ms(a.dueAt) - ms(b.dueAt));
  }

  function renderTasks() {
    const items = sorted();
    const taken = [...tasks.values()].filter((t) => owner(t) === 'taken');
    const declined = [...tasks.values()].filter((t) => owner(t) === 'declined');
    fill(takenEl, declined.length ? [
      h('h2.section-title', "You said you can't go"),
      ...declined.map((t) => h('div.taken-row.declined-row',
        h('span.taken-check', { 'aria-hidden': 'true' }, '🙅'),
        h('div', h('strong', `${t.typeEmoji || ''} ${t.typeLabel} · ${t.location}`.trim()),
          h('small', t.staffIds && t.staffIds.length > 1 && t.status !== 'declined' ? 'A teammate may take it.' : 'Your manager has been told and will reassign it.')),
        h('button.btn.ghost.small', { type: 'button', onclick: (e) => accept(t, e.currentTarget) }, 'I can go now'))),
    ] : null, taken.length ? [
      h('h2.section-title', 'Taken by teammates'),
      ...taken.map((t) => h('div.taken-row',
        h('span.taken-check', { 'aria-hidden': 'true' }, '✓'),
        h('div', h('strong', `${t.typeEmoji || ''} ${t.typeLabel} · ${t.location}`.trim()),
          h('small', `${t.staffName} is on it. No need to go.`)))),
    ] : null);
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
    const offered = owner(t) === 'offered';
    const doneBtn = h('button.btn.done-btn', { type: 'button', onclick: (e) => finish(t, e.currentTarget) }, 'Done');
    const acceptBtn = t.status === 'assigned'
      ? h('button.btn.ghost.accept-btn', { type: 'button', onclick: (e) => accept(t, e.currentTarget) }, offered ? "I'll take it" : 'On my way')
      : h('span.accepted-note', 'You accepted this');
    const others = (t.staffNames || []).filter((n, i) => (t.staffIds || [])[i] !== uid);
    const mapSlot = h('div.map-slot');
    if (t.mapPoint) {
      getMap(t.mapPoint.mapId).then((m) => { if (m) fill(mapSlot, mapThumb(m, t.mapPoint, t.location)); }).catch(() => {});
    }
    return h(`article.task${urgent ? '.urgent' : ''}${offered ? '.offered' : ''}`, { dataset: { task: t.id, due: ms(t.dueAt), start: ms(t.createdAt) } },
      h('div.tank', { 'aria-hidden': 'true' }, h('div.tank-water')),
      h('div.task-body',
        h('div.task-top',
          h('span.task-type', `${t.typeEmoji || ''} ${t.typeLabel}`.trim()),
          urgent ? h('span.pill.pill-urgent', 'Urgent') : null),
        h('h3.task-where', t.location),
        offered ? h('p.group-note', `Also sent to ${others.join(', ')}. First to accept takes it.`) : null,
        t.note ? h('p.task-note', t.note) : null,
        t.photoId ? photoButton(t.photoId, '📷 Photo from your manager. Tap to view (deleted 2 min after you open it)', { title: `${t.location}` }) : null,
        mapSlot,
        h('div.task-clock',
          h('span.clock-num', { role: 'timer' }, '–:––'),
          h('span.clock-label', 'left')),
        h('div.task-actions', acceptBtn, doneBtn),
        h('div.task-extra',
          h('button.link-btn', { type: 'button', onclick: (e) => finish(t, e.currentTarget, true) }, '📷 Done + photo'),
          h('button.link-btn.cant-go', { type: 'button', onclick: () => cantGo(t) }, "🙅 Can't go"))));
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
      const t = tasks.get(card.dataset.task);
      if (t) localReminders(t, now);
    });
    // Ask the server to send any reminder/alert that is due (it sends each one only once).
    if (now - lastCheck > 20000 && [...tasks.values()].some((t) => (owner(t) === 'mine' || owner(t) === 'offered') && B.nextAction(t, now))) {
      lastCheck = now;
      api('check-overdue').catch(() => {});
    }
  }

  // Sound + message on this screen when a reminder step is reached (the push covers a locked phone).
  function localReminders(t, now) {
    const r = B.reminderTimes(t);
    const steps = [
      ['notAccepted', r.notAccepted, t.status === 'assigned', () => {
        play('reminder');
        toast(owner(t) === 'offered'
          ? `Nobody has taken ${t.location} yet. Tap "I'll take it" if you can go.`
          : `Reminder: ${t.location}. Tap "On my way" so your manager knows you're on it.`, 'warn', 7000);
      }],
      ['almostDue', r.almostDue, true, () => {
        play('almostDue');
        toast(`Almost out of time: ${t.location}. Finish and tap Done to keep your points.`, 'warn', 7000);
      }],
      ['due', r.due, true, () => {
        play('timesUp');
        toast(`Time's up: ${t.location}. Your manager has been told. Finishing late costs points.`, 'error', 9000);
      }],
    ];
    for (const [step, at, applies, fire] of steps) {
      const key = `${t.id}:${step}`;
      if (!at || !applies || now < at || alertedSteps.has(key)) continue;
      alertedSteps.add(key);
      if (now - at < 90000) fire(); // don't replay old alerts when the app is reopened later
    }
  }
  const timer = setInterval(() => { tick(); dutyTick(); }, 1000);

  // ---- Card in / card out ----
  function renderDuty() {
    if (!profile) return;
    if (profile.onDuty) {
      fill(dutyEl,
        h('span.duty-dot', { 'aria-hidden': 'true' }),
        h('div.duty-text', h('strong', 'On duty'), h('small.duty-since', '')),
        h('button.btn.ghost.small.duty-btn', { type: 'button', onclick: (e) => cardOut(e.currentTarget) }, 'Card out'));
    } else {
      fill(dutyEl,
        h('div.duty-text', h('strong', "You're off duty"), h('small', 'Card in when you start work so your manager can send you tasks.')),
        h('button.btn.big.duty-btn', { type: 'button', onclick: (e) => cardIn(e.currentTarget) }, 'Card in'));
    }
    dutyEl.className = `duty-bar ${profile.onDuty ? 'on' : 'off'}`;
    dutyTick();
  }
  function dutyTick() {
    const el = dutyEl.querySelector('.duty-since');
    if (!el || !profile || !profile.dutySince) return;
    const mins = Math.floor((Date.now() - ms(profile.dutySince)) / 60000);
    el.textContent = `since ${timeOfDay(profile.dutySince)} · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  }
  async function cardIn(btn) {
    await busy(btn, async () => {
      try { await api('duty', { action: 'in' }); play('taskDone'); toast("You're on duty. Have a good shift!", 'ok'); }
      catch (e) { toast(e.message, 'error', 7000); }
    });
  }
  async function cardOut(btn) {
    const mine = [...tasks.values()].filter((t) => owner(t) === 'mine').length;
    const ok = await confirmBox('Card out?',
      mine ? `You still have ${mine} open task${mine > 1 ? 's' : ''}. Your manager will see ${mine > 1 ? 'them' : 'it'} as not done.` : 'You stop getting new tasks until you card in again.',
      'Card out', !!mine, 'Stay on duty');
    if (!ok) return;
    await busy(btn, async () => {
      try {
        const r = await api('duty', { action: 'out' });
        const m = r.minutes || 0;
        toast(`Carded out. You worked ${Math.floor(m / 60)}h ${m % 60}m today on this shift.`, 'info', 7000);
      } catch (e) { toast(e.message, 'error', 7000); }
    });
  }

  // ---- Can't go: tell the manager why, optionally with a photo of the area ----
  function cantGo(t) {
    let reason = 'busy';
    let photo = null;
    dialog(`Can't go to ${t.location}?`, (close) => {
      const reasons = [['busy', '🧹 Busy on another task'], ['away', '🚶 Away from site'], ['other', '✋ Other reason']];
      const reasonBox = h('div.chips');
      const drawReasons = () => fill(reasonBox, ...reasons.map(([id, label]) => h(`button.chip${reason === id ? '.on' : ''}`, {
        type: 'button', 'aria-pressed': String(reason === id), onclick: () => { reason = id; drawReasons(); },
      }, label)));
      drawReasons();
      const note = h('input', { placeholder: 'Note (optional), e.g. Cleaning Kitchen, 10 min', maxLength: 200 });
      const photoBox = h('div.photo-slot');
      const drawPhoto = () => fill(photoBox, photo
        ? photoPreview(photo, () => { photo = null; drawPhoto(); })
        : h('button.btn.ghost', { type: 'button', onclick: async () => { photo = await pickPhoto(); drawPhoto(); } }, '📷 Add photo of the area'));
      drawPhoto();
      const sendBtn = h('button.btn.big.wide', { type: 'button', onclick: () => busy(sendBtn, async () => {
        try {
          const r = await api('decline', { taskId: t.id, reason, note: note.value, photo });
          toast(r.everyone ? 'Your manager has been told.' : 'Thanks. A teammate can take it.', 'info');
          close(true);
        } catch (e) { toast(e.message, 'error', 7000); }
      }) }, 'Tell my manager');
      return h('div.sheet-body', h('p', 'Your manager gets an alert and can give it to someone else.'), reasonBox, note, photoBox, sendBtn);
    });
  }

  // ---- Actions ----
  async function accept(t, btn) {
    await busy(btn, async () => {
      try { await api('accept', { taskId: t.id }); }
      catch (e) { toast(e.message, 'error', 7000); }
    });
  }

  async function finish(t, btn, withPhoto) {
    let photo = null;
    if (withPhoto) {
      photo = await pickPhoto();
      if (!photo) return; // cancelled
    }
    await busy(btn, async () => {
      try {
        finishedByMe.add(t.id);
        const r = await api('complete', { taskId: t.id, photo });
        if (photo) toast('Photo sent to your manager.', 'ok');
        play(r.badge.bad ? 'lateDone' : 'taskDone');
        celebrate(t, r);
      } catch (e) {
        finishedByMe.delete(t.id);
        toast(e.message, 'error', 7000);
      }
    });
  }

  function celebrate(t, r) {
    const pts = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)} points`;
    dialog(r.badge.bad ? 'Done, but late' : 'Task done', (close) => {
      const body = h(`div.sheet-body.celebrate${r.badge.bad ? '.is-bad' : ''}`,
        h('div.badge-burst', { 'aria-hidden': 'true' }, r.badge.emoji),
        h('h3', r.badge.label),
        h(`p.points-delta${r.points < 0 ? '.minus' : ''}`, pts(r.points)),
        h('p', `${t.location} · finished in ${duration(r.durationSec)}${r.onTime ? '' : ` (limit ${t.minutes} min)`}`),
        r.badge.bad ? h('p.fade-hint', `Finish your next ${B.FADE_AFTER} tasks on time and this badge fades away.`) : null,
        r.cleared.length ? h('div.cleared-note',
          h('span', { 'aria-hidden': 'true' }, '✨'),
          h('span', r.cleared.length === 1
            ? `Your ${r.cleared[0].emoji} ${r.cleared[0].label} badge from ${r.cleared[0].where} is gone.`
            : `${r.cleared.length} late badges are gone.`)) : null,
        !r.badge.bad && r.activeBad.length ? h('p.fade-hint', `${r.activeBad.length} late badge${r.activeBad.length > 1 ? 's are' : ' is'} fading. Keep going.`) : null,
        r.newMilestones.length ? h('div.new-milestones',
          h('p.strong', r.newMilestones.length > 1 ? 'New badges unlocked' : 'New badge unlocked'),
          ...r.newMilestones.map((m) => h('div.milestone.got', h('span.m-emoji', m.emoji), h('div', h('strong', m.label), h('small', m.desc))))) : null,
        h('button.btn.big.wide', { type: 'button', onclick: () => close(true) }, r.badge.bad ? 'OK' : 'Nice'));
      setTimeout(() => close(true), 10000);
      return body;
    });
  }

  function renderBadges() {
    const s = profile.stats || {};
    const today = new Intl.DateTimeFormat('en-CA').format(new Date());
    const todayDone = s.todayDate === today ? s.todayDone || 0 : 0;
    const pct = s.done ? Math.round((100 * (s.onTime || 0)) / s.done) : null;
    fill(statsEl,
      h(`span.points-total${(s.points || 0) < 0 ? '.minus' : ''}`, h('b', String(s.points || 0)), ' points'),
      h('span', h('b', String(todayDone)), ' done today'),
      h('span', h('b', String(s.streak || 0)), ' on-time streak'),
      pct == null ? null : h('span', h('b', `${pct}%`), ' on time'));

    const counts = profile.badgeCounts || {};
    const owned = profile.milestones || {};
    const bad = profile.badBadges || [];
    fill(badgesEl,
      bad.length ? h('div.bad-badges',
        h('h3', 'Late badges'),
        h('p.hint', `Each one fades a little with every on-time task and disappears after ${B.FADE_AFTER}.`),
        ...bad.map((b) => {
          const good = b.good || 0;
          return h('div.bad-badge', { style: { '--fade': String(1 - good / B.FADE_AFTER) } },
            h('span.m-emoji', b.emoji),
            h('div', h('strong', `${b.label}${b.where ? ' · ' + b.where : ''}`),
              h('small', `${B.FADE_AFTER - good} more on-time task${B.FADE_AFTER - good === 1 ? '' : 's'} to clear`)),
            h('span.fade-dots', { 'aria-label': `${good} of ${B.FADE_AFTER}` },
              ...Array.from({ length: B.FADE_AFTER }, (_, i) => h(`span.dot${i < good ? '.on' : ''}`))));
        })) : null,
      h('div.badge-counts', ...Object.values(B.TASK_BADGES).map((b) =>
        h('div.badge-count', { title: b.desc }, h('span.b-emoji', b.emoji), h('b', String(counts[b.id] || 0)), h('small', b.label)))),
      h('div.milestones', ...B.MILESTONES.map((m) =>
        h(`div.milestone${owned[m.id] ? '.got' : '.locked'}`,
          h('span.m-emoji', owned[m.id] ? m.emoji : '🔒'),
          h('div', h('strong', m.label), h('small', m.desc))))));
  }

  return () => { unsubTasks(); unsubMe(); clearInterval(timer); };
}
