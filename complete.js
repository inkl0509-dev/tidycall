// POST /api/complete — staff taps Done. Closes the task, awards a badge, updates stats.
// No push is sent: the manager's board updates live from Firestore.
const { db, Timestamp, requireUser, route, clean, httpError, todayKey } = require('./_lib/firebase');
const { award } = require('../public/js/badges-def.js');

module.exports = route(['POST'], async (req, body) => {
  const user = await requireUser(req);
  const taskId = clean(body.taskId, 128);
  if (!taskId) throw httpError(400, 'Missing task.');

  const store = db();
  const taskRef = store.collection('tasks').doc(taskId);
  const userRef = store.collection('users').doc(user.uid);

  return store.runTransaction(async (tx) => {
    const [taskSnap, userSnap] = await Promise.all([tx.get(taskRef), tx.get(userRef)]);
    if (!taskSnap.exists) throw httpError(404, 'This task no longer exists.');
    const task = taskSnap.data();
    if (task.staffId !== user.uid) throw httpError(403, 'This task belongs to someone else.');
    if (task.status === 'cancelled') throw httpError(409, 'The manager cancelled this task.');
    if (!task.open) throw httpError(409, 'This task is already done.');

    const now = Timestamp.now();
    const durationSec = Math.max(0, Math.round((now.toMillis() - task.createdAt.toMillis()) / 1000));
    const onTime = now.toMillis() <= task.dueAt.toMillis();
    const profile = userSnap.exists ? userSnap.data() : {};

    const result = award(profile.stats, profile.milestones, {
      durationSec,
      limitSec: task.minutes * 60,
      onTime,
      urgent: task.priority === 'urgent',
      today: todayKey(now.toDate()),
    });

    const badge = { id: result.badge.id, emoji: result.badge.emoji, label: result.badge.label };
    tx.update(taskRef, {
      status: 'done', open: false, doneAt: now, durationSec, onTime,
      overdue: !onTime, badge,
      acceptedAt: task.acceptedAt || now,
    });

    const milestones = Object.assign({}, profile.milestones || {});
    result.newMilestones.forEach((m) => { milestones[m.id] = now; });
    const badgeCounts = Object.assign({}, profile.badgeCounts || {});
    badgeCounts[badge.id] = (badgeCounts[badge.id] || 0) + 1;
    const recent = [{ ...badge, at: now, taskId, where: task.location }, ...(profile.recentBadges || [])].slice(0, 20);

    tx.set(userRef, { stats: result.stats, milestones, badgeCounts, recentBadges: recent }, { merge: true });

    return {
      badge,
      durationSec,
      onTime,
      newMilestones: result.newMilestones.map((m) => ({ id: m.id, emoji: m.emoji, label: m.label, desc: m.desc })),
      stats: result.stats,
    };
  });
});
