// Manager screen: send tasks, live board, team, settings.
import { collection, query, where, onSnapshot, doc, updateDoc, setDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, api } from './firebase.js';
import { h, fill, mount, toast, play, soundSettings, ms, clock, duration, timeOfDay, startOfToday, busy, listenError, dialog, confirmBox } from './ui.js';
import { pushBanner, refreshPushIfGranted, onForegroundPush, pushState, enablePush } from './push.js';

const B = self.BADGES;
const TIMES = [5, 10, 15, 20, 30, 45, 60];
const DEFAULT_CONFIG = { taskTypes: [{ label: 'Clean', emoji: '🧽' }], locations: [], defaultMinutes: 10 };

export function start({ user, logout, brand }) {
  const me = user.uid;
  let config = DEFAULT_CONFIG;
  let users = new Map();
  const todayMap = new Map();
  const openMap = new Map();
  let ready = { today: false, open: false };
  const alerted = new Set();
  let lastCheck = 0;
  let dayKey = startOfToday().getTime();

  // Dispatch form state
  const pick = { type: null, customType: '', location: '', minutes: null, urgent: false, staffId: null, note: '', replace: null };

  const params = new URLSearchParams(location.search);
  let tab = params.get('view') === 'board' ? 'board' : (matchMedia('(min-width: 1000px)').matches ? 'board' : 'send');

  // ---------- Layout ----------
  const alertBar = h('div.alert-bar', { hidden: true, role: 'alert' });
  const sendPanel = h('section.panel.panel-send');
  const boardPanel = h('section.panel.panel-board');
  const teamPanel = h('section.panel.panel-team');
  const settingsPanel = h('section.panel.panel-settings');
  const tabs = [['send', 'Send task', '➕'], ['board', 'Live board', '📋'], ['team', 'Team', '👥'], ['settings', 'Settings', '⚙️']];
  const nav = h('nav.tabs', { 'aria-label': 'Sections' }, ...tabs.map(([id, label, icon]) =>
    h('button.tab', { type: 'button', dataset: { tab: id }, onclick: () => setTab(id) }, h('span.tab-icon', { 'aria-hidden': 'true' }, icon), h('span', label))));

  const banner = pushBanner('manager', 'Get an alert on this device when a task runs over time.');
  const screen = h('div.shell.manager',
    h('header.topbar', brand(), nav,
      h('div.topbar-right', h('span.who', user.displayName || 'Manager'), h('button.btn.ghost.small', { type: 'button', onclick: logout }, 'Sign out'))),
    alertBar,
    banner,
    h('main.manager-main', sendPanel, boardPanel, teamPanel, settingsPanel));
  mount(screen);

  function setTab(id) {
    tab = id;
    screen.dataset.tab = id;
    nav.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === id ? 'page' : 'false'));
    if (id === 'team') renderTeam();
    if (id === 'settings') renderSettings();
  }
  setTab(tab);

  refreshPushIfGranted('manager').then((ok) => { if (ok && banner) banner.remove(); });
  onForegroundPush((p) => {
    const d = (p && p.data) || {};
    const key = `${d.taskId}:${p.notification ? p.notification.title : ''}`;
    if (d.type === 'overdue' && !alerted.has(key)) {
      alerted.add(key); alerted.add(d.taskId); play('overdue');
      toast(p.notification ? `${p.notification.title}: ${p.notification.body}` : 'A task is overdue', 'error', 9000);
    }
  });

  // ---------- Live data ----------
  const unsubs = [];
  unsubs.push(onSnapshot(doc(db, 'config', 'app'), (d) => {
    config = Object.assign({}, DEFAULT_CONFIG, d.data() || {});
    if (pick.minutes == null) pick.minutes = config.defaultMinutes || 10;
    renderSend();
    if (tab === 'settings') renderSettings();
  }, listenError));

  unsubs.push(onSnapshot(collection(db, 'users'), (snap) => {
    users = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    renderStaffPicks();
    if (tab === 'team') renderTeam();
  }, listenError));

  function watchTasks(q, map, key) {
    return onSnapshot(q, (snap) => {
      snap.docChanges().forEach((c) => {
        const t = { id: c.doc.id, ...c.doc.data() };
        const before = all().get(t.id);
        if (c.type === 'removed') map.delete(t.id); else map.set(t.id, t);
        if (ready.today && ready.open && before && c.type !== 'removed') announce(before, t);
      });
      ready[key] = true;
      renderBoard(); renderStaffPicks();
    }, listenError);
  }
  let unsubToday = watchTasks(query(collection(db, 'tasks'), where('createdAt', '>=', Timestamp.fromDate(startOfToday()))), todayMap, 'today');
  unsubs.push(watchTasks(query(collection(db, 'tasks'), where('open', '==', true)), openMap, 'open'));

  function all() {
    const m = new Map(todayMap);
    openMap.forEach((v, k) => m.set(k, v));
    return m;
  }

  // Live updates on the board, no push needed.
  function announce(before, t) {
    if (before.status === t.status) return;
    if (t.status === 'accepted') { play('accepted'); toast(`${t.staffName} accepted ${t.typeLabel} · ${t.location}`, 'info'); }
    if (t.status === 'done') {
      const late = t.badge && t.badge.bad;
      play(late ? 'finishedLate' : 'finished');
      const pts = typeof t.points === 'number' ? ` (${t.points > 0 ? '+' : '−'}${Math.abs(t.points)} pts)` : '';
      toast(`${t.badge ? t.badge.emoji + ' ' : ''}${t.staffName} finished ${t.typeLabel} · ${t.location} in ${duration(t.durationSec)}${late ? ', late' : ''}${pts}`, late ? 'warn' : 'ok', 6000);
      flash(t.id);
    }
  }
  function flash(id) {
    setTimeout(() => { const el = document.querySelector(`[data-row="${id}"]`); if (el) el.classList.add('arrive'); }, 30);
  }

  // ---------- Send task ----------
  function openCountFor(uid) { let n = 0; openMap.forEach((t) => { if (t.staffId === uid) n++; }); return n; }

  function chip(label, selected, onclick, extra = '') {
    return h(`button.chip${selected ? '.on' : ''}${extra}`, { type: 'button', 'aria-pressed': String(!!selected), onclick }, label);
  }

  const staffBox = h('div.staff-box');
  let updateSendBtn = () => {};

  // Only the "Who" list refreshes on live data, so typing in the form is never interrupted.
  function renderStaffPicks() {
    const staff = [...users.values()].filter((u) => u.role === 'staff' && u.active !== false)
      .map((u) => ({ ...u, open: openCountFor(u.id) }))
      .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name));
    if (pick.staffId && !staff.some((u) => u.id === pick.staffId)) pick.staffId = null;
    fill(staffBox, staff.length ? h('div.staff-picks', ...staff.map((u) =>
      h(`button.staff-pick${pick.staffId === u.id ? '.on' : ''}`, {
        type: 'button', 'aria-pressed': String(pick.staffId === u.id),
        onclick: () => { pick.staffId = u.id; renderStaffPicks(); },
      },
      h('span.avatar', initials(u.name)),
      h('span.sp-name', u.name),
      h(`span.sp-load${u.open ? '.busy' : ''}`, u.open ? `${u.open} open` : 'Free'))))
      : h('p.empty-hint', 'No staff yet. Add people in Team.'));
    updateSendBtn();
  }

  function renderSend() {
    const types = config.taskTypes || [];

    const locInput = h('input.inline-input', {
      placeholder: 'Or type a place, e.g. Villa 12', value: (config.locations || []).includes(pick.location) ? '' : pick.location,
      oninput: (e) => { pick.location = e.target.value; updateSendBtn(); },
      onchange: () => renderSend(),
    });
    const typeInput = h('input.inline-input', {
      placeholder: 'Or type a task', value: pick.customType,
      oninput: (e) => { pick.customType = e.target.value; if (e.target.value) pick.type = null; updateSendBtn(); },
      onchange: () => renderSend(),
    });
    const sendBtn = h('button.btn.big.wide.send-btn', { type: 'button', onclick: (e) => send(e.currentTarget) });
    updateSendBtn = () => {
      const ok = (pick.customType.trim() || pick.type) && pick.location.trim() && pick.staffId && pick.minutes;
      const chosen = pick.staffId && users.get(pick.staffId);
      sendBtn.disabled = !ok;
      sendBtn.textContent = chosen ? `Send to ${chosen.name}` : 'Choose who to send it to';
    };

    fill(sendPanel, 
      h('h2.panel-title', pick.replace ? 'Reassign task' : 'Send a task'),
      pick.replace ? h('div.reassign-note',
        h('span', `Replacing the task given to ${pick.replace.staffName}. The old one closes when you send.`),
        h('button.btn.ghost.small', { type: 'button', onclick: () => { resetPick(); renderSend(); } }, 'Stop reassigning')) : null,

      h('fieldset.step', h('legend', 'What needs doing'),
        h('div.chips', ...types.map((t) => chip(`${t.emoji || ''} ${t.label}`.trim(),
          !pick.customType && pick.type && pick.type.label === t.label,
          () => { pick.type = t; pick.customType = ''; renderSend(); }))),
        typeInput),

      h('fieldset.step', h('legend', 'Where'),
        h('div.chips', ...(config.locations || []).map((l) => chip(l, pick.location === l, () => { pick.location = l; renderSend(); }))),
        locInput),

      h('fieldset.step', h('legend', 'Time to finish'),
        h('div.chips', ...TIMES.map((m) => chip(`${m} min`, pick.minutes === m, () => { pick.minutes = m; renderSend(); }))),
        h('label.urgent-toggle',
          h('input', { type: 'checkbox', checked: pick.urgent, onchange: (e) => { pick.urgent = e.target.checked; } }),
          h('span', 'Urgent: louder alert on their phone'))),

      h('fieldset.step', h('legend', 'Note (optional)'),
        h('input.inline-input', { placeholder: 'e.g. Guest waiting, 2 bath towels', maxLength: 200, value: pick.note, oninput: (e) => { pick.note = e.target.value; } })),

      h('fieldset.step', h('legend', 'Who'), staffBox),

      sendBtn);
    renderStaffPicks();
  }

  function resetPick() {
    Object.assign(pick, { type: null, customType: '', location: '', urgent: false, staffId: null, note: '', replace: null, minutes: config.defaultMinutes || 10 });
  }

  async function send(btn) {
    const type = pick.customType.trim() ? { label: pick.customType.trim(), emoji: '📌' } : pick.type;
    await busy(btn, async () => {
      try {
        const r = await api('assign', {
          staffId: pick.staffId, typeLabel: type.label, typeEmoji: type.emoji || '', location: pick.location.trim(),
          note: pick.note.trim(), minutes: pick.minutes, priority: pick.urgent ? 'urgent' : 'normal',
          replaceTaskId: pick.replace ? pick.replace.id : undefined,
        });
        if (r.pushSent > 0) toast(`Sent to ${r.staffName}. Their phone was notified.`, 'ok');
        else toast(`Sent to ${r.staffName}, but no phone was notified: they need to turn on notifications. The task is on their screen when they open the app.`, 'warn', 9000);
        play('sent');
        resetPick(); renderSend();
        if (!matchMedia('(min-width: 1000px)').matches) setTab('board');
        flash(r.id);
      } catch (e) { toast(e.message, 'error', 7000); }
    });
  }

  // ---------- Board ----------
  function renderBoard() {
    const now = Date.now();
    const tasks = [...all().values()];
    const open = tasks.filter((t) => t.open);
    const overdue = open.filter((t) => ms(t.dueAt) < now).sort((a, b) => ms(a.dueAt) - ms(b.dueAt));
    const active = open.filter((t) => ms(t.dueAt) >= now).sort((a, b) => (b.priority === 'urgent') - (a.priority === 'urgent') || ms(a.dueAt) - ms(b.dueAt));
    const done = tasks.filter((t) => t.status === 'done' && ms(t.doneAt) >= dayKey).sort((a, b) => ms(b.doneAt) - ms(a.doneAt));
    const onTime = done.filter((t) => t.onTime).length;
    const avg = done.length ? done.reduce((s, t) => s + (t.durationSec || 0), 0) / done.length : 0;

    fill(boardPanel, 
      h('div.board-head',
        h('h2.panel-title', 'Live board'),
        h('div.kpis',
          kpi(open.length, 'open'),
          kpi(overdue.length, 'overdue', overdue.length ? 'bad' : ''),
          kpi(done.length, 'done today'),
          kpi(done.length ? `${Math.round((100 * onTime) / done.length)}%` : '–', 'on time'),
          kpi(done.length ? duration(avg) : '–', 'avg time'))),
      overdue.length ? section('Over time', overdue, 'over') : null,
      section('In progress', active, 'active', 'Nothing in progress. Send a task to get started.'),
      section('Finished today', done, 'done', 'Finished tasks show up here as soon as staff tap Done.'));
    tickBoard();
  }

  function kpi(v, label, cls = '') { return h(`div.kpi${cls ? '.' + cls : ''}`, h('b', String(v)), h('small', label)); }

  function section(title, list, kind, empty) {
    return h(`div.board-section.sec-${kind}`,
      h('h3', title, h('span.count', String(list.length))),
      list.length ? h('div.rows', ...list.map(row)) : h('p.empty-hint', empty));
  }

  function row(t) {
    const isOpen = t.open;
    const statusText = t.status === 'done' ? 'Done' : t.status === 'accepted' ? 'Accepted' : 'Sent';
    const right = isOpen
      ? h('div.row-time', h('span.row-clock', { dataset: { due: ms(t.dueAt) } }, '–:––'), h('small', `of ${t.minutes} min`))
      : h('div.row-time',
        h('span.row-badge', { title: t.badge ? t.badge.label : '' }, t.badge ? t.badge.emoji : '✓'),
        h('small', `${duration(t.durationSec)}${t.onTime ? '' : ' · late'}`),
        typeof t.points === 'number' ? h(`small.row-points${t.points < 0 ? '.minus' : ''}`, `${t.points > 0 ? '+' : '−'}${Math.abs(t.points)} pts`) : null);
    return h(`div.row.st-${t.status}${t.priority === 'urgent' ? '.urgent' : ''}`, { dataset: { row: t.id } },
      h('div.row-main',
        h('div.row-title', h('span', `${t.typeEmoji || ''} ${t.typeLabel}`.trim()), t.priority === 'urgent' ? h('span.pill.pill-urgent', 'Urgent') : null),
        h('div.row-where', t.location),
        h('div.row-meta',
          h('span.avatar.small', initials(t.staffName)), h('span', t.staffName),
          h(`span.status.s-${t.status}`, statusText),
          h('span.muted', isOpen ? `sent ${timeOfDay(t.createdAt)}` : `done ${timeOfDay(t.doneAt)}`),
          isOpen && t.pushDevices === 0 ? h('span.warn-note', { title: 'Their phone has notifications off' }, 'phone not notified') : null,
          t.reminders ? h('span.remind-note', { title: 'Reminders sent to their phone' }, `🔔 reminded ${t.reminders}×`) : null),
        t.note ? h('div.row-note', t.note) : null),
      right,
      isOpen ? h('div.row-actions',
        h('button.btn.ghost.small', { type: 'button', onclick: () => reassign(t) }, 'Reassign'),
        h('button.btn.ghost.small.danger-text', { type: 'button', onclick: () => cancelTask(t) }, 'Cancel')) : null);
  }

  function tickBoard() {
    const now = Date.now();
    let flipped = false;
    boardPanel.querySelectorAll('.row-clock[data-due]').forEach((el) => {
      const left = (+el.dataset.due - now) / 1000;
      el.textContent = left >= 0 ? clock(left) : `${clock(left)} over`;
      const r = el.closest('.row');
      const wasLate = r.classList.contains('late');
      r.classList.toggle('late', left < 0);
      if (left < 0 && !wasLate && !r.closest('.sec-over')) flipped = true;
    });
    // Overdue alert on this screen.
    const overdue = [...openMap.values()].filter((t) => ms(t.dueAt) < now);
    overdue.forEach((t) => {
      if (!alerted.has(t.id)) { alerted.add(t.id); play('overdue'); }
    });
    // Ask the server to send any reminder or alert that's due (staff reminders, manager alerts). Each is sent once.
    if (now - lastCheck > 20000 && [...openMap.values()].some((t) => B.nextAction(t, now))) {
      lastCheck = now;
      api('check-overdue').catch(() => {});
    }
    alertBar.hidden = !overdue.length;
    if (overdue.length) {
      fill(alertBar, 
        h('span', overdue.length === 1
          ? `Over time: ${overdue[0].staffName} · ${overdue[0].typeLabel} · ${overdue[0].location}`
          : `${overdue.length} tasks are over time`),
        h('button.btn.small', { type: 'button', onclick: () => setTab('board') }, 'Show'));
    }
    if (flipped) renderBoard();
  }

  async function cancelTask(t) {
    const ok = await confirmBox('Cancel task?', `${t.typeLabel} · ${t.location} for ${t.staffName}. It disappears from their screen.`, 'Cancel task', true);
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'tasks', t.id), { status: 'cancelled', open: false, cancelledAt: serverTimestamp(), cancelledBy: me });
      toast('Task cancelled.', 'info');
    } catch (e) { toast(`Could not cancel: ${e.message}`, 'error'); }
  }

  function reassign(t) {
    resetPick();
    const known = (config.taskTypes || []).find((x) => x.label === t.typeLabel);
    if (known) pick.type = known; else pick.customType = t.typeLabel;
    Object.assign(pick, { location: t.location, minutes: t.minutes, urgent: t.priority === 'urgent', note: t.note || '', replace: t });
    setTab('send');
    renderSend();
    sendPanel.scrollIntoView({ behavior: 'smooth' });
  }

  // ---------- Team ----------
  function renderTeam() {
    // Staff first, highest points on top; managers at the end.
    const pts = (u) => (u.stats && u.stats.points) || 0;
    const list = [...users.values()].sort((a, b) => (a.role === b.role ? 0 : a.role === 'manager' ? 1 : -1) || (b.active !== false) - (a.active !== false) || pts(b) - pts(a) || a.name.localeCompare(b.name));
    fill(teamPanel, 
      h('div.panel-head', h('h2.panel-title', 'Team'), h('button.btn', { type: 'button', onclick: addPerson }, 'Add person')),
      h('div.team-list', ...list.map(person)));
  }

  function person(u) {
    const s = u.stats || {};
    const pct = s.done ? `${Math.round((100 * (s.onTime || 0)) / s.done)}%` : '–';
    const owned = B.MILESTONES.filter((m) => u.milestones && u.milestones[m.id]);
    const counts = u.badgeCounts || {};
    return h(`article.person${u.active === false ? '.inactive' : ''}`,
      h('div.person-id',
        h('span.avatar', initials(u.name)),
        h('div', h('strong', u.name), h('small', `@${u.username} · ${u.role === 'manager' ? 'Manager' : 'Staff'}${u.active === false ? ' · switched off' : ''}`))),
      u.role === 'staff' ? h('div.person-stats',
        h(`span.points-total${(s.points || 0) < 0 ? '.minus' : ''}`, h('b', String(s.points || 0)), ' points'),
        h('span', h('b', String(s.done || 0)), ' done'),
        h('span', h('b', pct), ' on time'),
        h('span', h('b', String(s.bestStreak || 0)), ' best streak'),
        h('span', h('b', String(openCountFor(u.id))), ' open now')) : null,
      u.role === 'staff' ? h('div.person-badges',
        ...Object.values(B.TASK_BADGES).filter((b) => counts[b.id]).map((b) => h('span.mini-badge', { title: b.label }, `${b.emoji} ${counts[b.id]}`)),
        ...owned.map((m) => h('span.mini-badge.ms', { title: `${m.label}: ${m.desc}` }, m.emoji)),
        ...(u.badBadges || []).map((b) => h('span.mini-badge.bad', {
          title: `${b.label}${b.where ? ' · ' + b.where : ''}: ${B.FADE_AFTER - (b.good || 0)} on-time tasks to clear`,
          style: { '--fade': String(1 - (b.good || 0) / B.FADE_AFTER) },
        }, `${b.emoji} ${b.good || 0}/${B.FADE_AFTER}`))) : null,
      h('div.person-actions',
        h('button.btn.ghost.small', { type: 'button', onclick: () => resetPin(u) }, 'Reset PIN'),
        u.id === me ? null : h('button.btn.ghost.small', { type: 'button', onclick: (e) => setActive(u, e.currentTarget) }, u.active === false ? 'Switch on' : 'Switch off')));
  }

  function addPerson() {
    dialog('Add person', (close) => {
      const err = h('p.form-error', { role: 'alert' });
      const form = h('form.stack.sheet-body',
        h('label', 'Name', h('input', { name: 'fullname', required: true, maxLength: 40, placeholder: 'e.g. Aisha' })),
        h('label', 'Username', h('input', { name: 'username', required: true, autocapitalize: 'none', spellcheck: false, pattern: '[a-zA-Z0-9._-]{2,30}', placeholder: 'e.g. aisha' }), h('small', 'They type this to sign in. No spaces.')),
        h('label', 'PIN (6–12 digits)', h('input', { name: 'pin', required: true, inputmode: 'numeric', pattern: '\\d{6,12}', placeholder: 'e.g. 482916' }), h('small', 'Give this to them privately. They can ask you to reset it.')),
        h('label', 'Role', h('select', { name: 'role' }, h('option', { value: 'staff' }, 'Staff (receives tasks)'), h('option', { value: 'manager' }, 'Manager (sends tasks)'))),
        err,
        h('div.row-end', h('button.btn.ghost', { type: 'button', onclick: () => close(null) }, 'Close'), h('button.btn', { type: 'submit' }, 'Add person')));
      form.addEventListener('submit', (e) => {
        e.preventDefault(); err.textContent = '';
        const f = form.elements;
        busy(form.querySelector('[type=submit]'), async () => {
          try {
            await api('staff', { action: 'create', name: f.namedItem('fullname').value, username: f.namedItem('username').value, pin: f.namedItem('pin').value, role: f.namedItem('role').value });
            toast(`Added ${f.namedItem('fullname').value}. They sign in with username "${f.namedItem('username').value.toLowerCase()}" and their PIN.`, 'ok', 8000);
            close(true);
          } catch (ex) { err.textContent = ex.message; }
        });
      });
      return form;
    });
  }

  function resetPin(u) {
    dialog(`New PIN for ${u.name}`, (close) => {
      const err = h('p.form-error', { role: 'alert' });
      const form = h('form.stack.sheet-body',
        h('label', 'New PIN (6–12 digits)', h('input', { name: 'pin', required: true, inputmode: 'numeric', pattern: '\\d{6,12}' })),
        h('p.hint', 'They will be signed out on all devices and must sign in with the new PIN.'),
        err,
        h('div.row-end', h('button.btn.ghost', { type: 'button', onclick: () => close(null) }, 'Close'), h('button.btn', { type: 'submit' }, 'Save PIN')));
      form.addEventListener('submit', (e) => {
        e.preventDefault(); err.textContent = '';
        busy(form.querySelector('[type=submit]'), async () => {
          try { await api('staff', { action: 'resetPin', uid: u.id, pin: form.elements.namedItem('pin').value }); toast('PIN saved.', 'ok'); close(true); }
          catch (ex) { err.textContent = ex.message; }
        });
      });
      return form;
    });
  }

  async function setActive(u, btn) {
    const on = u.active === false;
    if (!on && !(await confirmBox(`Switch off ${u.name}?`, 'They are signed out and can no longer receive tasks. Their badges are kept.', 'Switch off', true))) return;
    await busy(btn, async () => {
      try { await api('staff', { action: 'setActive', uid: u.id, active: on }); toast(on ? `${u.name} is switched on.` : `${u.name} is switched off.`, 'info'); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  // ---------- Settings ----------
  function renderSettings() {
    const draft = {
      taskTypes: (config.taskTypes || []).map((t) => ({ ...t })),
      locations: [...(config.locations || [])],
      defaultMinutes: config.defaultMinutes || 10,
    };
    const typesBox = h('div.edit-list');
    const locBox = h('div.chips');
    const draw = () => {
      fill(typesBox, ...draft.taskTypes.map((t, i) => h('div.edit-item',
        h('span', `${t.emoji || ''} ${t.label}`.trim()),
        h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${t.label}`, onclick: () => { draft.taskTypes.splice(i, 1); draw(); } }, '✕'))));
      fill(locBox, ...draft.locations.map((l, i) => h('span.chip.removable', l,
        h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${l}`, onclick: () => { draft.locations.splice(i, 1); draw(); } }, '✕'))));
    };
    draw();

    const emojiIn = h('input.emoji-input', { placeholder: '🧽', maxLength: 4, 'aria-label': 'Emoji' });
    const labelIn = h('input.inline-input', { placeholder: 'New task type, e.g. Mop floor', maxLength: 60 });
    const locIn = h('input.inline-input', { placeholder: 'New place, e.g. Villa 12', maxLength: 80 });
    const addType = () => { const l = labelIn.value.trim(); if (!l) return; draft.taskTypes.push({ label: l, emoji: emojiIn.value.trim() }); labelIn.value = ''; emojiIn.value = ''; draw(); };
    const addLoc = () => { const l = locIn.value.trim(); if (!l || draft.locations.includes(l)) return; draft.locations.push(l); locIn.value = ''; draw(); };
    labelIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addType(); } });
    locIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLoc(); } });

    const minutesSel = h('select', { onchange: (e) => { draft.defaultMinutes = +e.target.value; } },
      ...TIMES.map((m) => h('option', { value: m, selected: m === draft.defaultMinutes }, `${m} minutes`)));

    const pushStatus = h('p', pushState() === 'granted' ? 'On for this device.' : pushState() === 'denied' ? 'Blocked on this device. Allow it in the browser or phone settings.' : 'Off for this device.');

    fill(settingsPanel, 
      h('h2.panel-title', 'Settings'),
      h('fieldset.step', h('legend', 'Task types'), typesBox, h('div.add-row', emojiIn, labelIn, h('button.btn.ghost', { type: 'button', onclick: addType }, 'Add'))),
      h('fieldset.step', h('legend', 'Places'), locBox, h('div.add-row', locIn, h('button.btn.ghost', { type: 'button', onclick: addLoc }, 'Add'))),
      h('fieldset.step', h('legend', 'Default time to finish'), minutesSel),
      h('button.btn.big', { type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        try { await setDoc(doc(db, 'config', 'app'), draft); toast('Settings saved.', 'ok'); }
        catch (ex) { toast(`Could not save: ${ex.message}`, 'error'); }
      }) }, 'Save settings'),
      h('fieldset.step', h('legend', 'Sounds on this device'), soundSettings('manager')),
      h('fieldset.step', h('legend', 'Notifications on this device'), pushStatus,
        h('div.row-start',
          pushState() === 'granted' ? null : h('button.btn.ghost', { type: 'button', onclick: async () => {
            try { await enablePush('manager'); toast('Notifications are on.', 'ok'); renderSettings(); } catch (e) { toast(e.message, 'error', 9000); }
          } }, 'Turn on'),
          h('button.btn.ghost', { type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
            try {
              const r = await api('test-push');
              toast(r.devices ? `Test sent to ${r.sent} of ${r.devices} device(s).` : 'No devices registered for you yet. Turn on notifications first.', r.sent ? 'ok' : 'warn', 7000);
            } catch (ex) { toast(ex.message, 'error'); }
          }) }, 'Send test notification'))));
  }

  // ---------- Timers ----------
  const timer = setInterval(() => {
    tickBoard();
    // New day: re-subscribe the "today" list so the board starts fresh at midnight.
    const k = startOfToday().getTime();
    if (k !== dayKey) {
      dayKey = k; unsubToday(); todayMap.clear(); ready.today = false;
      unsubToday = watchTasks(query(collection(db, 'tasks'), where('createdAt', '>=', Timestamp.fromDate(startOfToday()))), todayMap, 'today');
    }
  }, 1000);

  renderSend(); renderBoard();
  return () => { unsubs.forEach((u) => u()); unsubToday(); clearInterval(timer); };
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}
