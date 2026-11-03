/* Badges, points and reminder timing. Shared by the browser (window.BADGES) and the server (require).
 * Change the numbers here to adjust the rules; both sides pick them up. */
(function (root) {
  // ---------- Points ----------
  const POINTS = { lightning: 15, rapid: 12, ontime: 10, late: -5, verylate: -10 };

  // Good badges: one per task finished on time (best one wins).
  const TASK_BADGES = {
    lightning: { id: 'lightning', emoji: '⚡', label: 'Lightning',       desc: 'Finished in under half the time' },
    rapid:     { id: 'rapid',     emoji: '🚨', label: 'Rapid Responder', desc: 'Urgent task finished on time' },
    ontime:    { id: 'ontime',    emoji: '✅', label: 'On Time',         desc: 'Finished before the deadline' },
  };

  // Bad badges: given when a task is finished late. Each one fades and disappears
  // after FADE_AFTER on-time tasks finished after it.
  const BAD_BADGES = {
    late:     { id: 'late',     emoji: '🐢', label: 'Late',      desc: 'Finished after the time limit', bad: true },
    verylate: { id: 'verylate', emoji: '🐌', label: 'Very Late', desc: 'Took more than double the time', bad: true },
  };
  const FADE_AFTER = 4;

  // Milestones: earned once, when the condition is first met. `s` = stats after the task.
  const MILESTONES = [
    { id: 'first',    emoji: '🌱', label: 'First Shine',  desc: 'First task finished',          test: (s) => s.done >= 1 },
    { id: 'done10',   emoji: '🥉', label: 'Ten Down',     desc: '10 tasks finished',            test: (s) => s.done >= 10 },
    { id: 'done50',   emoji: '🥈', label: 'Fifty Fresh',  desc: '50 tasks finished',            test: (s) => s.done >= 50 },
    { id: 'done100',  emoji: '🥇', label: 'Hundred Club', desc: '100 tasks finished',           test: (s) => s.done >= 100 },
    { id: 'done500',  emoji: '🏆', label: 'Legend',       desc: '500 tasks finished',           test: (s) => s.done >= 500 },
    { id: 'streak5',  emoji: '🔥', label: 'Hot Streak',   desc: '5 on-time tasks in a row',     test: (s) => s.streak >= 5 },
    { id: 'streak20', emoji: '☄️', label: 'Unstoppable',  desc: '20 on-time tasks in a row',    test: (s) => s.streak >= 20 },
    { id: 'speed10',  emoji: '🏎️', label: 'Speedster',    desc: '10 Lightning badges',          test: (s) => (s.lightning || 0) >= 10 },
    { id: 'bigday',   emoji: '🌟', label: 'Big Day',      desc: '10 tasks finished in one day', test: (s) => (s.todayDone || 0) >= 10 },
    { id: 'pts500',   emoji: '💎', label: '500 Points',   desc: 'Reached 500 points',           test: (s) => (s.points || 0) >= 500 },
  ];

  /**
   * Work out the badge, points, new stats, milestones and bad-badge changes for one finished task.
   * @param prev   previous stats
   * @param owned  milestones already owned {id: timestamp}
   * @param bad    active bad badges [{id, emoji, label, taskId, where, at, good}]
   * @param t      {durationSec, limitSec, onTime, urgent, today:'YYYY-MM-DD', taskId, where, at}
   */
  function award(prev, owned, bad, t) {
    const s = Object.assign(
      { done: 0, onTime: 0, late: 0, lightning: 0, streak: 0, bestStreak: 0, todayDate: '', todayDone: 0, points: 0, cleared: 0 },
      prev || {}
    );
    let badge;
    if (!t.onTime) badge = t.durationSec > 2 * t.limitSec ? BAD_BADGES.verylate : BAD_BADGES.late;
    else if (t.durationSec <= t.limitSec / 2) badge = TASK_BADGES.lightning;
    else if (t.urgent) badge = TASK_BADGES.rapid;
    else badge = TASK_BADGES.ontime;
    const points = POINTS[badge.id];

    s.done += 1;
    s.points += points;
    if (t.onTime) { s.onTime += 1; s.streak += 1; } else { s.late += 1; s.streak = 0; }
    if (badge.id === 'lightning') s.lightning += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (s.todayDate !== t.today) { s.todayDate = t.today; s.todayDone = 0; }
    s.todayDone += 1;

    // Bad badges: an on-time task moves every active one a step closer to fading away.
    let activeBad = (bad || []).map((b) => Object.assign({}, b));
    let cleared = [];
    if (t.onTime) {
      activeBad.forEach((b) => { b.good = (b.good || 0) + 1; });
      cleared = activeBad.filter((b) => b.good >= FADE_AFTER);
      activeBad = activeBad.filter((b) => b.good < FADE_AFTER);
      s.cleared += cleared.length;
    } else {
      activeBad.unshift({ id: badge.id, emoji: badge.emoji, label: badge.label, taskId: t.taskId || '', where: t.where || '', at: t.at || null, good: 0 });
    }

    const newMilestones = MILESTONES.filter((m) => !(owned && owned[m.id]) && m.test(s));
    return { badge, points, stats: s, newMilestones, activeBad, cleared };
  }

  // ---------- Reminders ----------
  // Times are worked out from each task's own time limit.
  const REMIND = {
    notAcceptedMin: 60,      // remind if not accepted after 25% of the time, at least 1 min…
    notAcceptedMax: 180,     // …and at most 3 min
    almostDueMax: 120,       // "time almost up" reminder 2 min before the end (or at 80% for short tasks)
    overdueEvery: 300,       // after time's up, remind the housekeeper every 5 min…
    overdueRepeats: 3,       // …up to 3 more times
    managerRepeatAfter: 1,   // managers get a second alert when it's this many time-limits overdue (1 = double time)
  };

  const toMs = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : ts ? +ts : 0);

  function reminderTimes(task) {
    const created = toMs(task.createdAt);
    const due = toMs(task.dueAt);
    const L = Math.max(1, (due - created) / 1000);
    const almostDue = due - Math.min(REMIND.almostDueMax, 0.2 * L) * 1000;
    const notAccepted = created + Math.min(REMIND.notAcceptedMax, Math.max(REMIND.notAcceptedMin, 0.25 * L)) * 1000;
    return { created, due, limitSec: L, notAccepted: notAccepted < almostDue ? notAccepted : null, almostDue, managerRepeat: due + REMIND.managerRepeatAfter * L * 1000 };
  }

  /** What should happen to this task now? One of: notAccepted, almostDue, escalate, overdueReminder, managerRepeat, or null. */
  function nextAction(task, now) {
    if (!task || !task.open || task.status === 'declined') return null; // declined: managers were already told
    const r = reminderTimes(task);
    if (now >= r.due) {
      if (!task.escalatedAt) return 'escalate';
      if (now >= r.managerRepeat && !task.managerRepeatAt) return 'managerRepeat';
      const n = task.overdueReminders || 0;
      if (n < REMIND.overdueRepeats && now >= toMs(task.lastReminderAt || task.escalatedAt) + REMIND.overdueEvery * 1000) return 'overdueReminder';
      return null;
    }
    if (now >= r.almostDue && !task.remindedAlmostDue) return 'almostDue';
    if (r.notAccepted && task.status === 'assigned' && now >= r.notAccepted && !task.remindedNotAccepted) return 'notAccepted';
    return null;
  }

  const api = { POINTS, TASK_BADGES, BAD_BADGES, FADE_AFTER, MILESTONES, REMIND, award, reminderTimes, nextAction, toMs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BADGES = api;
})(typeof self !== 'undefined' ? self : this);
