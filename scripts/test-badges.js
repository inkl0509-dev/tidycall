// Checks the badge, points and reminder rules: node scripts/test-badges.js
const assert = require('assert');
const B = require('../public/js/badges-def.js');
const { award, nextAction, FADE_AFTER } = B;
const day = '2026-11-02';
const go = (st, owned, bad, o) => award(st, owned, bad, Object.assign({ limitSec: 600, urgent: false, today: day, taskId: 't', where: 'Toilet 2' }, o));

// Good tasks
let r = go({}, {}, [], { durationSec: 120, onTime: true });
assert.equal(r.badge.id, 'lightning'); assert.equal(r.points, 15);
assert.deepEqual(r.newMilestones.map((m) => m.id), ['first']);
r = go(r.stats, { first: 1 }, r.activeBad, { durationSec: 500, onTime: true, urgent: true });
assert.equal(r.badge.id, 'rapid'); assert.equal(r.points, 12);
r = go(r.stats, { first: 1 }, r.activeBad, { durationSec: 400, onTime: true });
assert.equal(r.badge.id, 'ontime'); assert.equal(r.stats.points, 37);

// Late: minus points + bad badge, streak reset
r = go(r.stats, { first: 1 }, r.activeBad, { durationSec: 700, onTime: false, taskId: 'late1' });
assert.equal(r.badge.id, 'late'); assert.equal(r.points, -5); assert.equal(r.stats.points, 32);
assert.equal(r.stats.streak, 0); assert.equal(r.activeBad.length, 1); assert.equal(r.activeBad[0].good, 0);
// Very late (more than double the time)
r = go(r.stats, { first: 1 }, r.activeBad, { durationSec: 1300, onTime: false, taskId: 'late2' });
assert.equal(r.badge.id, 'verylate'); assert.equal(r.points, -10); assert.equal(r.activeBad.length, 2);

// Fading: 3 good tasks → still there with good=3; 4th → both cleared
for (let i = 1; i <= FADE_AFTER - 1; i++) {
  r = go(r.stats, { first: 1 }, r.activeBad, { durationSec: 400, onTime: true });
  assert.equal(r.activeBad.length, 2); assert.equal(r.activeBad[0].good, i);
}
r = go(r.stats, { first: 1 }, r.activeBad, { durationSec: 400, onTime: true });
assert.equal(r.activeBad.length, 0); assert.equal(r.cleared.length, 2); assert.equal(r.stats.cleared, 2);

// A late task in between: older badge keeps its progress, the new one starts at 0
let bad = [{ id: 'late', good: 2 }];
r = go({}, {}, bad, { durationSec: 700, onTime: false });
assert.deepEqual(r.activeBad.map((b) => b.good), [0, 2]);
r = go(r.stats, {}, r.activeBad, { durationSec: 300, onTime: true });
r = go(r.stats, {}, r.activeBad, { durationSec: 300, onTime: true });
assert.equal(r.cleared.length, 1); assert.deepEqual(r.activeBad.map((b) => b.good), [2]);

// Reminder schedule for a 10-minute task
const t0 = 1_000_000_000_000;
const task = (o) => Object.assign({ open: true, status: 'assigned', createdAt: t0, dueAt: t0 + 600e3 }, o);
assert.equal(nextAction(task(), t0 + 60e3), null);
assert.equal(nextAction(task(), t0 + 150e3), 'notAccepted');            // 25% = 2.5 min
assert.equal(nextAction(task({ status: 'accepted' }), t0 + 150e3), null);
assert.equal(nextAction(task({ remindedNotAccepted: 1 }), t0 + 300e3), null);
assert.equal(nextAction(task({ remindedNotAccepted: 1 }), t0 + 480e3), 'almostDue'); // 2 min before
assert.equal(nextAction(task(), t0 + 600e3), 'escalate');
const esc = task({ escalatedAt: t0 + 600e3, lastReminderAt: t0 + 600e3 });
assert.equal(nextAction(esc, t0 + 700e3), null);
assert.equal(nextAction(esc, t0 + 900e3), 'overdueReminder');           // +5 min
assert.equal(nextAction(task({ escalatedAt: 1, lastReminderAt: t0 + 1100e3, overdueReminders: 1 }), t0 + 1200e3), 'managerRepeat'); // double time
assert.equal(nextAction(task({ escalatedAt: 1, managerRepeatAt: 1, overdueReminders: 3, lastReminderAt: 1 }), t0 + 5000e3), null);
assert.equal(nextAction(task({ open: false }), t0 + 5000e3), null);
// 5-minute task: not-accepted reminder after 75 s, almost-due at 4 min
assert.equal(nextAction(task({ dueAt: t0 + 300e3 }), t0 + 80e3), 'notAccepted');
assert.equal(nextAction(task({ dueAt: t0 + 300e3, remindedNotAccepted: 1 }), t0 + 241e3), 'almostDue');

console.log('Badges, points and reminders: all checks passed');
