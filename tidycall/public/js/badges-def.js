/* Badge definitions — shared by the browser (window.BADGES) and the server (require). */
(function (root) {
  // Awarded on every completed task (exactly one per task, best one wins).
  const TASK_BADGES = {
    lightning: { id: 'lightning', emoji: '⚡', label: 'Lightning', desc: 'Finished in under half the time' },
    rapid:     { id: 'rapid',     emoji: '🚨', label: 'Rapid Responder', desc: 'Urgent task finished on time' },
    ontime:    { id: 'ontime',    emoji: '✅', label: 'On Time', desc: 'Finished before the deadline' },
    done:      { id: 'done',      emoji: '💪', label: 'Got It Done', desc: 'Finished, a little after the deadline' },
  };

  // Earned once, when the condition is first met. `s` is the staff member's stats after the task.
  const MILESTONES = [
    { id: 'first',    emoji: '🌱', label: 'First Shine',   desc: 'First task finished',          test: (s) => s.done >= 1 },
    { id: 'done10',   emoji: '🥉', label: 'Ten Down',      desc: '10 tasks finished',            test: (s) => s.done >= 10 },
    { id: 'done50',   emoji: '🥈', label: 'Fifty Fresh',   desc: '50 tasks finished',            test: (s) => s.done >= 50 },
    { id: 'done100',  emoji: '🥇', label: 'Hundred Club',  desc: '100 tasks finished',           test: (s) => s.done >= 100 },
    { id: 'done500',  emoji: '🏆', label: 'Legend',        desc: '500 tasks finished',           test: (s) => s.done >= 500 },
    { id: 'streak5',  emoji: '🔥', label: 'Hot Streak',    desc: '5 on-time tasks in a row',     test: (s) => s.streak >= 5 },
    { id: 'streak20', emoji: '☄️', label: 'Unstoppable',   desc: '20 on-time tasks in a row',    test: (s) => s.streak >= 20 },
    { id: 'speed10',  emoji: '🏎️', label: 'Speedster',     desc: '10 Lightning badges',          test: (s) => (s.lightning || 0) >= 10 },
    { id: 'bigday',   emoji: '🌟', label: 'Big Day',       desc: '10 tasks finished in one day', test: (s) => (s.todayDone || 0) >= 10 },
  ];

  /**
   * Pick the badge for one finished task and work out new stats + milestones.
   * @param {object} prev   previous stats {done,onTime,late,lightning,streak,bestStreak,todayDate,todayDone}
   * @param {object} owned  milestones already owned {id: timestamp}
   * @param {object} t      {durationSec, limitSec, onTime, urgent, today:'YYYY-MM-DD'}
   */
  function award(prev, owned, t) {
    const s = Object.assign(
      { done: 0, onTime: 0, late: 0, lightning: 0, streak: 0, bestStreak: 0, todayDate: '', todayDone: 0 },
      prev || {}
    );
    let badge;
    if (t.onTime && t.durationSec <= t.limitSec / 2) badge = TASK_BADGES.lightning;
    else if (t.onTime && t.urgent) badge = TASK_BADGES.rapid;
    else if (t.onTime) badge = TASK_BADGES.ontime;
    else badge = TASK_BADGES.done;

    s.done += 1;
    if (t.onTime) { s.onTime += 1; s.streak += 1; } else { s.late += 1; s.streak = 0; }
    if (badge.id === 'lightning') s.lightning += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (s.todayDate !== t.today) { s.todayDate = t.today; s.todayDone = 0; }
    s.todayDone += 1;

    const newMilestones = MILESTONES.filter((m) => !(owned && owned[m.id]) && m.test(s));
    return { badge, stats: s, newMilestones };
  }

  const api = { TASK_BADGES, MILESTONES, award };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BADGES = api;
})(typeof self !== 'undefined' ? self : this);
