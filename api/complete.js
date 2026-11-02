// POST /api/complete — staff taps Done. Closes the task, gives points and a badge (or a bad badge if late).
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

    const r = award(profile.stats, profile.milestones, profile.badBadges, {
      durationSec,
      limitSec: task.minutes * 60,
      onTime,
      urgent: task.priority === 'urgent',
      today: todayKey(now.toDate()),
      taskId,
      where: task.location,
      at: now,
    });

    const badge = { id: r.badge.id, emoji: r.badge.emoji, label: r.badge.label, bad: !!r.badge.bad };
    tx.update(taskRef, {
      status: 'done', open: false, doneAt: now, durationSec, onTime,
      overdue: !onTime, badge, points: r.points,
      acceptedAt: task.acceptedAt || now,
    });

    const milestones = Object.assign({}, profile.milestones || {});
    r.newMilestones.forEach((m) => { milestones[m.id] = now; });
    const badgeCounts = Object.assign({}, profile.badgeCounts || {});
    badgeCounts[badge.id] = (badgeCounts[badge.id] || 0) + 1;
    const recent = [{ ...badge, points: r.points, at: now, taskId, where: task.location }, ...(profile.recentBadges || [])].slice(0, 20);

    tx.set(userRef, {
      stats: r.stats, milestones, badgeCounts, recentBadges: recent,
      badBadges: r.activeBad,
      points: r.stats.points, // top-level copy for sorting
    }, { merge: true });

    return {
      badge,
      points: r.points,
      totalPoints: r.stats.points,
      durationSec,
      onTime,
      newMilestones: r.newMilestones.map((m) => ({ id: m.id, emoji: m.emoji, label: m.label, desc: m.desc })),
      cleared: r.cleared.map((b) => ({ id: b.id, emoji: b.emoji, label: b.label, where: b.where })),
      activeBad: r.activeBad.map((b) => ({ id: b.id, emoji: b.emoji, label: b.label, good: b.good })),
      stats: r.stats,
    };
  });
});
