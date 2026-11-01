// Quick check of the badge rules: node scripts/test-badges.js
const assert = require('assert');
const { award } = require('../public/js/badges-def.js');

let r = award({}, {}, { durationSec: 120, limitSec: 600, onTime: true, urgent: false, today: '2026-11-01' });
assert.equal(r.badge.id, 'lightning');
assert.deepEqual(r.newMilestones.map((m) => m.id), ['first']);
assert.equal(r.stats.streak, 1);

r = award(r.stats, { first: 1 }, { durationSec: 500, limitSec: 600, onTime: true, urgent: true, today: '2026-11-01' });
assert.equal(r.badge.id, 'rapid');

r = award(r.stats, { first: 1 }, { durationSec: 400, limitSec: 600, onTime: true, urgent: false, today: '2026-11-01' });
assert.equal(r.badge.id, 'ontime');
assert.equal(r.stats.todayDone, 3);

r = award(r.stats, { first: 1 }, { durationSec: 700, limitSec: 600, onTime: false, urgent: false, today: '2026-11-02' });
assert.equal(r.badge.id, 'done');
assert.equal(r.stats.streak, 0);
assert.equal(r.stats.bestStreak, 3);
assert.equal(r.stats.todayDone, 1, 'resets on a new day');

let s = {}; let owned = {}; const got = [];
for (let i = 0; i < 10; i++) {
  r = award(s, owned, { durationSec: 60, limitSec: 600, onTime: true, urgent: false, today: '2026-11-03' });
  s = r.stats; r.newMilestones.forEach((m) => { owned[m.id] = 1; got.push(m.id); });
}
assert.deepEqual(got.sort(), ['bigday', 'done10', 'first', 'speed10', 'streak5'].sort());
console.log('Badge rules: all checks passed');
