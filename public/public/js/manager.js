// Manager screen: send tasks, live board, team, settings.
import { collection, query, where, onSnapshot, doc, updateDoc, setDoc, addDoc, deleteDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, api } from './firebase.js';
import { h, fill, mount, toast, play, soundSettings, ms, clock, duration, timeOfDay, startOfToday, busy, listenError, dialog, confirmBox } from './ui.js';
import { compressImage, readMapPack, mapView, showOnMap, findPin, putMapInCache } from './maps.js';
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
  const pick = { type: null, customType: '', location: '', mapPoint: null, minutes: null, urgent: false, staffIds: [], note: '', replace: null };
  let maps = [];
  let mapOpen = false;
  let mapTab = null;

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

  unsubs.push(onSnapshot(collection(db, 'maps'), (snap) => {
    maps = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
    maps.forEach(putMapInCache);
    if (pick.location && !pick.mapPoint) pick.mapPoint = findPin(maps, pick.location);
    renderSend();
    if (tab === 'settings') renderMapsSettings();
    renderBoard();
  }, listenError));

  unsubs.push(onSnapshot(collection(db, 'users'), (snap) => {
    const prev = users;
    users = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    if (prev.size) users.forEach((u) => {
      const before = prev.get(u.id);
      if (u.role !== 'staff' || !before || !!before.onDuty === !!u.onDuty) return;
      play('accepted');
      toast(u.onDuty ? `🟢 ${u.name} carded in` : `⚪ ${u.name} carded out`, 'info');
    });
    renderBoardDuty();
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
  let shiftsToday = [];
  let unsubShifts = watchShifts();
  function watchShifts() {
    return onSnapshot(query(collection(db, 'shifts'), where('in', '>=', Timestamp.fromDate(startOfToday()))), (snap) => {
      shiftsToday = snap.docs.map((d) => d.data());
      if (tab === 'team') renderTeam();
    }, listenError);
  }
  function minutesToday(u) {
    let m = 0;
    shiftsToday.filter((x) => x.uid === u.id).forEach((x) => { m += x.out ? (x.minutes || 0) : Math.round((Date.now() - ms(x.in)) / 60000); });
    return m;
  }
  const hm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

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
    if (t.status === 'accepted') {
      play('accepted');
      toast(t.group ? `${t.staffName} took ${t.typeLabel} · ${t.location} (first of ${(t.staffIds || []).length})` : `${t.staffName} accepted ${t.typeLabel} · ${t.location}`, 'info');
    }
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
  // Tasks this person has, plus group tasks offered to them that nobody has taken yet.
  function openCountFor(uid) {
    let n = 0;
    openMap.forEach((t) => { if (t.staffId === uid || (!t.staffId && (t.staffIds || []).includes(uid))) n++; });
    return n;
  }

  function chip(label, selected, onclick, extra = '') {
    return h(`button.chip${selected ? '.on' : ''}${extra}`, { type: 'button', 'aria-pressed': String(!!selected), onclick }, label);
  }

  const staffBox = h('div.staff-box');
  let updateSendBtn = () => {};

  // Only the "Who" list refreshes on live data, so typing in the form is never interrupted.
  let showOffDuty = false;
  function renderStaffPicks() {
    const staff = [...users.values()].filter((u) => u.role === 'staff' && u.active !== false)
      .map((u) => ({ ...u, open: openCountFor(u.id) }))
      .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name));
    pick.staffIds = pick.staffIds.filter((id) => staff.some((u) => u.id === id));
    const toggle = (id) => {
      pick.staffIds = pick.staffIds.includes(id) ? pick.staffIds.filter((x) => x !== id) : [...pick.staffIds, id];
      renderStaffPicks();
    };
    const onDuty = staff.filter((u) => u.onDuty);
    const offDuty = staff.filter((u) => !u.onDuty);
    const dutyIds = onDuty.map((u) => u.id);
    const free = onDuty.filter((u) => !u.open).map((u) => u.id);
    const same = (ids) => ids.length && pick.staffIds.length === ids.length && ids.every((id) => pick.staffIds.includes(id));
    const card = (u) => {
      const on = pick.staffIds.includes(u.id);
      return h(`button.staff-pick${on ? '.on' : ''}${u.onDuty ? '' : '.off-duty'}`, { type: 'button', 'aria-pressed': String(on), onclick: () => toggle(u.id) },
        h('span.avatar', on ? '✓' : initials(u.name)),
        h('span.sp-name', u.name),
        u.onDuty
          ? h(`span.sp-load${u.open ? '.busy' : ''}`, u.open ? `${u.open} open` : 'Free')
          : h('span.sp-load.off', 'Off duty'));
    };
    // Off-duty people stay visible if they're already picked (e.g. reassigning).
    const offShown = showOffDuty ? offDuty : offDuty.filter((u) => pick.staffIds.includes(u.id));
    fill(staffBox, staff.length ? [
      h('div.chips.who-quick',
        onDuty.length > 1 ? chip(`Everyone on duty (${onDuty.length})`, same(dutyIds), () => { pick.staffIds = same(dutyIds) ? [] : dutyIds; renderStaffPicks(); }) : null,
        free.length > 1 && free.length < onDuty.length ? chip(`Free (${free.length})`, same(free), () => { pick.staffIds = free; renderStaffPicks(); }) : null,
        pick.staffIds.length ? chip('Clear', false, () => { pick.staffIds = []; renderStaffPicks(); }) : null),
      onDuty.length
        ? h('div.staff-picks', ...onDuty.map(card))
        : h('p.empty-hint', 'Nobody is on duty right now. Staff tap "Card in" on their phone when they start work.'),
      offShown.length ? h('div.staff-picks.off-list', ...offShown.map(card)) : null,
      offDuty.length ? h('button.link-btn', { type: 'button', onclick: () => { showOffDuty = !showOffDuty; renderStaffPicks(); } },
        showOffDuty ? 'Hide off-duty staff' : `Show off-duty staff (${offDuty.length})`) : null,
      pick.staffIds.length > 1 ? h('p.hint', `All ${pick.staffIds.length} get the alert. The first to accept takes it; the others see who's on it.`) : null,
    ] : h('p.empty-hint', 'No staff yet. Add people in Team.'));
    updateSendBtn();
  }

  function renderSend() {
    const types = config.taskTypes || [];

    const locInput = h('input.inline-input', {
      placeholder: 'Or type a place, e.g. Villa 12', value: (config.locations || []).includes(pick.location) ? '' : pick.location,
      oninput: (e) => {
        pick.location = e.target.value;
        // Typed name matches a pinned place → use its pin; otherwise keep a spot tapped on the map.
        const pin = findPin(maps, pick.location);
        if (pin) pick.mapPoint = pin; else if (pick.mapPoint && pick.mapPoint.place) pick.mapPoint = null;
        updateSendBtn();
      },
      onchange: () => renderSend(),
    });
    const typeInput = h('input.inline-input', {
      placeholder: 'Or type a task', value: pick.customType,
      oninput: (e) => { pick.customType = e.target.value; if (e.target.value) pick.type = null; updateSendBtn(); },
      onchange: () => renderSend(),
    });
    const sendBtn = h('button.btn.big.wide.send-btn', { type: 'button', onclick: (e) => send(e.currentTarget) });
    updateSendBtn = () => {
      const ok = (pick.customType.trim() || pick.type) && pick.location.trim() && pick.staffIds.length && pick.minutes;
      const n = pick.staffIds.length;
      const one = n === 1 && users.get(pick.staffIds[0]);
      sendBtn.disabled = !ok;
      sendBtn.textContent = !n ? 'Choose who to send it to' : one ? `Send to ${one.name}` : `Send to ${n} people`;
    };

    fill(sendPanel, 
      h('h2.panel-title', pick.replace ? 'Reassign task' : 'Send a task'),
      pick.replace ? h('div.reassign-note',
        h('span', `Replacing the task given to ${pick.replace.staffName || (pick.replace.staffNames || []).join(', ')}. The old one closes when you send.`),
        h('button.btn.ghost.small', { type: 'button', onclick: () => { resetPick(); renderSend(); } }, 'Stop reassigning')) : null,

      h('fieldset.step', h('legend', 'What needs doing'),
        h('div.chips', ...types.map((t) => chip(`${t.emoji || ''} ${t.label}`.trim(),
          !pick.customType && pick.type && pick.type.label === t.label,
          () => { pick.type = t; pick.customType = ''; renderSend(); }))),
        typeInput),

      h('fieldset.step', h('legend', 'Where'),
        h('div.chips', ...(config.locations || []).map((l) => chip(`${findPin(maps, l) ? '📍 ' : ''}${l}`, pick.location === l, () => {
          pick.location = l; pick.mapPoint = findPin(maps, l); renderSend();
        }))),
        locInput,
        mapPicker()),

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
    Object.assign(pick, { type: null, customType: '', location: '', mapPoint: null, urgent: false, staffIds: [], note: '', replace: null, minutes: config.defaultMinutes || 10 });
  }

  // Map under "Where": tap a pinned place to pick it, or tap anywhere to mark the exact spot.
  function mapPicker() {
    if (!maps.length) return null;
    const current = maps.find((m) => m.id === (pick.mapPoint ? pick.mapPoint.mapId : mapTab)) || maps[0];
    const status = pick.mapPoint
      ? h('p.map-status', `📍 Marked on ${pick.mapPoint.mapName || 'the map'}`, h('button.btn.ghost.small', { type: 'button', onclick: () => { pick.mapPoint = null; renderSend(); } }, 'Remove pin'))
      : h('p.map-status.muted', 'No spot marked on the map.');
    if (!mapOpen) {
      return h('div.map-picker', status,
        h('button.btn.ghost.small', { type: 'button', onclick: () => { mapOpen = true; renderSend(); } }, pick.mapPoint ? 'Show map' : 'Pick on map'));
    }
    return h('div.map-picker.open', status,
      maps.length > 1 ? h('div.chips', ...maps.map((m) => chip(m.name, m.id === current.id, () => { mapTab = m.id; if (pick.mapPoint && pick.mapPoint.mapId !== m.id) pick.mapPoint = null; renderSend(); }))) : null,
      h('p.hint', 'Tap a pinned place, or tap anywhere to mark the exact spot.'),
      mapView(current, {
        pins: current.pins || [], pan: true,
        selected: pick.location,
        marker: pick.mapPoint && pick.mapPoint.mapId === current.id ? pick.mapPoint : null,
        onTap: (x, y, place) => {
          mapTab = current.id;
          if (place) { pick.location = place; pick.mapPoint = { mapId: current.id, mapName: current.name, x, y, place }; }
          else {
            pick.mapPoint = { mapId: current.id, mapName: current.name, x, y };
            if (!pick.location.trim()) pick.location = `Marked spot · ${current.name}`;
          }
          renderSend();
        },
      }),
      h('button.btn.ghost.small', { type: 'button', onclick: () => { mapOpen = false; renderSend(); } }, 'Hide map'));
  }

  async function send(btn) {
    const type = pick.customType.trim() ? { label: pick.customType.trim(), emoji: '📌' } : pick.type;
    const offDuty = pick.staffIds.map((id) => users.get(id)).filter((u) => u && !u.onDuty);
    if (offDuty.length) {
      const names = offDuty.map((u) => u.name).join(', ');
      const ok = await confirmBox(offDuty.length > 1 ? 'Some people are off duty' : `${names} is off duty`,
        `${names} ${offDuty.length > 1 ? "haven't" : "hasn't"} carded in. Send anyway?`, 'Send anyway', false, 'Go back');
      if (!ok) return;
    }
    await busy(btn, async () => {
      try {
        const r = await api('assign', {
          staffIds: pick.staffIds, staffId: pick.staffIds[0], mapPoint: pick.mapPoint, typeLabel: type.label, typeEmoji: type.emoji || '', location: pick.location.trim(),
          note: pick.note.trim(), minutes: pick.minutes, priority: pick.urgent ? 'urgent' : 'normal',
          replaceTaskId: pick.replace ? pick.replace.id : undefined,
        });
        if (r.pushSent > 0) toast(r.group ? `Sent to ${r.staffName}. The first to accept takes it.` : `Sent to ${r.staffName}. Their phone was notified.`, 'ok');
        else toast(`Sent to ${r.staffName}, but no phone was notified: they need to turn on notifications. The task is on their screen when they open the app.`, 'warn', 9000);
        mapOpen = false;
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
          kpi([...users.values()].filter((u) => u.role === 'staff' && u.onDuty).length, 'on duty'),
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

  // Update just the "on duty" number when someone cards in/out.
  function renderBoardDuty() {
    const el = boardPanel.querySelector('.kpi b');
    if (el) el.textContent = String([...users.values()].filter((u) => u.role === 'staff' && u.onDuty).length);
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
          ...(t.staffId
            ? [h('span.avatar.small', initials(t.staffName)), h('span', t.staffName)]
            : [h('span.avatar.small', '👥'), h('span', { title: (t.staffNames || []).join(', ') }, `Sent to ${(t.staffNames || []).length}: ${(t.staffNames || []).slice(0, 3).join(', ')}${(t.staffNames || []).length > 3 ? '…' : ''}`)]),
          h(`span.status.s-${t.status}`, !t.staffId && isOpen ? 'Waiting for someone' : statusText),
          t.group && t.staffId ? h('span.muted', `first of ${(t.staffIds || []).length}`) : null,
          t.mapPoint ? h('button.map-link', { type: 'button', onclick: () => openTaskMap(t) }, '📍 Map') : null,
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

  function openTaskMap(t) {
    const m = maps.find((x) => x.id === t.mapPoint.mapId);
    if (m) showOnMap(m, t.mapPoint, t.location); else toast('That map was deleted.', 'warn');
  }

  async function cancelTask(t) {
    const ok = await confirmBox('Cancel task?', `${t.typeLabel} · ${t.location} for ${t.staffName || (t.staffNames || []).join(', ')}. It disappears from their screen.`, 'Cancel task', true);
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
    Object.assign(pick, { location: t.location, mapPoint: t.mapPoint || null, minutes: t.minutes, urgent: t.priority === 'urgent', note: t.note || '', replace: t,
      staffIds: t.staffId ? [] : [...(t.staffIds || [])] });
    setTab('send');
    renderSend();
    sendPanel.scrollIntoView({ behavior: 'smooth' });
  }

  // ---------- Team ----------
  function renderTeam() {
    // Staff first, highest points on top; managers at the end.
    const pts = (u) => (u.stats && u.stats.points) || 0;
    const list = [...users.values()].sort((a, b) => (a.role === b.role ? 0 : a.role === 'manager' ? 1 : -1) || (b.active !== false) - (a.active !== false) || (!!b.onDuty - !!a.onDuty) || pts(b) - pts(a) || a.name.localeCompare(b.name));
    fill(teamPanel, 
      h('div.panel-head', h('h2.panel-title', 'Team'), h('button.btn', { type: 'button', onclick: addPerson }, 'Add person')),
      h('div.team-list', ...list.map(person)));
  }

  async function setDuty(u, btn) {
    const out = !!u.onDuty;
    if (!(await confirmBox(out ? `Card out ${u.name}?` : `Card in ${u.name}?`,
      out ? 'Use this if they forgot to card out. Their shift ends now.' : 'Use this if they forgot to card in. Their shift starts now.',
      out ? 'Card out' : 'Card in', false, 'Cancel'))) return;
    await busy(btn, async () => {
      try { await api('duty', { action: out ? 'out' : 'in', uid: u.id }); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  function person(u) {
    const s = u.stats || {};
    const pct = s.done ? `${Math.round((100 * (s.onTime || 0)) / s.done)}%` : '–';
    const owned = B.MILESTONES.filter((m) => u.milestones && u.milestones[m.id]);
    const counts = u.badgeCounts || {};
    return h(`article.person${u.active === false ? '.inactive' : ''}`,
      h('div.person-id',
        h(`span.avatar${u.role === 'staff' && u.onDuty ? '.on-duty' : ''}`, initials(u.name)),
        h('div', h('strong', u.name, u.role === 'staff' ? h(`span.duty-pill${u.onDuty ? '.on' : ''}`, u.onDuty ? `On duty · since ${timeOfDay(u.dutySince)}` : 'Off duty') : null),
          h('small', `@${u.username} · ${u.role === 'manager' ? 'Manager' : 'Staff'}${u.active === false ? ' · switched off' : ''}`))),
      u.role === 'staff' ? h('div.person-stats',
        h(`span.points-total${(s.points || 0) < 0 ? '.minus' : ''}`, h('b', String(s.points || 0)), ' points'),
        h('span', h('b', String(s.done || 0)), ' done'),
        h('span', h('b', pct), ' on time'),
        h('span', h('b', String(s.bestStreak || 0)), ' best streak'),
        h('span', h('b', String(openCountFor(u.id))), ' open now'),
        h('span', h('b', hm(minutesToday(u))), ' on duty today')) : null,
      u.role === 'staff' ? h('div.person-badges',
        ...Object.values(B.TASK_BADGES).filter((b) => counts[b.id]).map((b) => h('span.mini-badge', { title: b.label }, `${b.emoji} ${counts[b.id]}`)),
        ...owned.map((m) => h('span.mini-badge.ms', { title: `${m.label}: ${m.desc}` }, m.emoji)),
        ...(u.badBadges || []).map((b) => h('span.mini-badge.bad', {
          title: `${b.label}${b.where ? ' · ' + b.where : ''}: ${B.FADE_AFTER - (b.good || 0)} on-time tasks to clear`,
          style: { '--fade': String(1 - (b.good || 0) / B.FADE_AFTER) },
        }, `${b.emoji} ${b.good || 0}/${B.FADE_AFTER}`))) : null,
      h('div.person-actions',
        h('button.btn.ghost.small', { type: 'button', onclick: () => resetPin(u) }, 'Reset PIN'),
        u.role === 'staff' && u.active !== false ? h('button.btn.ghost.small', { type: 'button', onclick: (e) => setDuty(u, e.currentTarget) }, u.onDuty ? 'Card out' : 'Card in') : null,
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

  // ---------- Maps (in Settings) ----------
  const mapsBox = h('fieldset.step.maps-box');
  let editingMap = null; // { id, name, image, width, height, pins } being edited
  let pinPlace = '';

  function renderMapsSettings() {
    const locations = config.locations || [];
    if (editingMap) {
      const m = editingMap;
      const pinned = new Set((m.pins || []).map((p) => p.place));
      const unpinned = locations.filter((l) => !pinned.has(l));
      if (!pinPlace) pinPlace = unpinned[0] || '';
      const placeSel = h('select', { 'aria-label': 'Place to pin', onchange: (e) => { pinPlace = e.target.value; } },
        h('option', { value: '' }, 'Choose a place…'),
        ...locations.map((l) => h('option', { value: l, selected: l === pinPlace }, `${pinned.has(l) ? '📍 ' : ''}${l}`)));
      fill(mapsBox,
        h('legend', `Edit map: ${m.name}`),
        h('label', 'Map name', h('input', { value: m.name, maxLength: 40, oninput: (e) => { m.name = e.target.value; } })),
        h('p.hint', 'Choose a place, then tap where it is on the map. Tapping again moves the pin. Places come from the Places list above.'),
        h('div.add-row', placeSel),
        h('small', 'Pin names show on this screen only; staff see the plan with one big pin.'),
        mapView(m, {
          pins: m.pins || [], selected: pinPlace, labels: 'all', pan: true,
          onTap: (x, y, place) => {
            if (place) { pinPlace = place; renderMapsSettings(); return; }
            if (!pinPlace) { toast('Choose a place first, then tap the map.', 'warn'); return; }
            m.pins = (m.pins || []).filter((p) => p.place !== pinPlace).concat([{ place: pinPlace, x, y }]);
            const next = locations.find((l) => !m.pins.some((p) => p.place === l));
            pinPlace = next || pinPlace;
            renderMapsSettings();
          },
        }),
        (m.pins || []).length ? h('div.chips', ...(m.pins || []).map((p) => h('span.chip.removable', `📍 ${p.place}`,
          h('button.icon-btn', { type: 'button', 'aria-label': `Remove pin ${p.place}`, onclick: () => { m.pins = m.pins.filter((x) => x !== p); renderMapsSettings(); } }, '✕')))) : null,
        h('div.row-start',
          h('button.btn', { type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
            if (!m.name.trim()) { toast('Give the map a name.', 'warn'); return; }
            const data = { name: m.name.trim(), image: m.image, width: m.width, height: m.height, pins: m.pins || [], order: m.order || 0, updatedAt: serverTimestamp() };
            try {
              if (m.id) await setDoc(doc(db, 'maps', m.id), data);
              else await addDoc(collection(db, 'maps'), data);
              // Pinned places that aren't in the Places list yet are added to it.
              const missing = [...new Set((m.pins || []).map((p) => p.place))].filter((pl) => !locations.includes(pl));
              if (missing.length) await setDoc(doc(db, 'config', 'app'), { locations: [...locations, ...missing] }, { merge: true });
              toast(missing.length ? `Map saved. ${missing.length} new place${missing.length > 1 ? 's' : ''} added to Places.` : 'Map saved.', 'ok'); editingMap = null; pinPlace = ''; renderMapsSettings();
            } catch (ex) { toast(`Could not save the map: ${ex.message}`, 'error', 9000); }
          }) }, 'Save map'),
          h('button.btn.ghost', { type: 'button', onclick: () => { editingMap = null; pinPlace = ''; renderMapsSettings(); } }, 'Cancel'),
          m.id ? h('button.btn.ghost.danger-text', { type: 'button', onclick: async () => {
            if (!(await confirmBox(`Delete ${m.name}?`, 'Its pins are removed too. Tasks already sent keep their place name.', 'Delete map', true))) return;
            try { await deleteDoc(doc(db, 'maps', m.id)); editingMap = null; toast('Map deleted.', 'info'); renderMapsSettings(); }
            catch (ex) { toast(ex.message, 'error'); }
          } }, 'Delete map') : null));
      return;
    }

    const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        toast('Preparing the map…', 'info', 2500);
        const img = await compressImage(f);
        editingMap = { name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Ground floor', pins: [], order: maps.length, ...img };
        pinPlace = '';
        renderMapsSettings();
      } catch (ex) { toast(ex.message, 'error', 8000); }
    } });
    const packIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const pack = await readMapPack(f);
        editingMap = { ...pack, order: maps.length };
        pinPlace = '';
        toast(`Loaded "${pack.name}" with ${pack.pins.length} pins. Check them, then tap Save map.`, 'info', 7000);
        renderMapsSettings();
      } catch (ex) { toast(ex.message, 'error', 8000); }
    } });
    fill(mapsBox,
      h('legend', 'In-house maps'),
      h('p.hint', 'Upload a floor plan or site map (photo, scan or screenshot) and pin your places on it. Staff then see exactly where to go.'),
      maps.length ? h('div.map-list', ...maps.map((m) => h('div.map-item',
        h('img', { src: m.image, alt: '' }),
        h('div', h('strong', m.name), h('small', `${(m.pins || []).length} pinned place${(m.pins || []).length === 1 ? '' : 's'}`)),
        h('button.btn.ghost.small', { type: 'button', onclick: () => { editingMap = JSON.parse(JSON.stringify(m)); pinPlace = ''; renderMapsSettings(); } }, 'Edit pins')))) : null,
      fileIn, packIn,
      h('div.row-start',
        h('button.btn.ghost', { type: 'button', onclick: () => fileIn.click() }, maps.length ? 'Add another map' : 'Upload a map'),
        h('button.btn.ghost', { type: 'button', onclick: () => packIn.click() }, 'Import map file (.json)')));
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

    renderMapsSettings();
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
      mapsBox,
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
      unsubShifts(); unsubShifts = watchShifts();
      unsubToday = watchTasks(query(collection(db, 'tasks'), where('createdAt', '>=', Timestamp.fromDate(startOfToday()))), todayMap, 'today');
    }
  }, 1000);

  renderSend(); renderBoard();
  return () => { unsubs.forEach((u) => u()); unsubToday(); unsubShifts(); clearInterval(timer); };
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}
