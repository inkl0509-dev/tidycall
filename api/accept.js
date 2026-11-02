// POST /api/accept — staff taps "On my way" / "I'll take it".
// For a task sent to several people, the first to accept takes it. The check runs in a transaction,
// so if two people tap at the same moment only one wins; the other is told who took it.
// Everyone else's notification is quietly replaced with "<name> is on it".
const { db, Timestamp, requireUser, pushToUsers, baseUrl, route, clean, httpError } = require('./_lib/firebase');

module.exports = route(['POST'], async (req, body) => {
  const user = await requireUser(req);
  const taskId = clean(body.taskId, 128);
  if (!taskId) throw httpError(400, 'Missing task.');

  const store = db();
  const taskRef = store.collection('tasks').doc(taskId);
  const userRef = store.collection('users').doc(user.uid);

  const out = await store.runTransaction(async (tx) => {
    const [snap, me] = await Promise.all([tx.get(taskRef), tx.get(userRef)]);
    if (!snap.exists) throw httpError(404, 'This task no longer exists.');
    const t = snap.data();
    const ids = t.staffIds || (t.staffId ? [t.staffId] : []);
    if (!ids.includes(user.uid)) throw httpError(403, 'This task was not sent to you.');
    if (t.status === 'cancelled') throw httpError(409, 'The manager cancelled this task.');
    if (!t.open) throw httpError(409, 'This task is already done.');
    if (t.staffId && t.staffId !== user.uid) throw httpError(409, `${t.staffName || 'Someone else'} already took this task.`);
    if (t.status === 'accepted') return { already: true, t };

    const name = (me.exists && me.data().name) || 'Staff';
    tx.update(taskRef, { staffId: user.uid, staffName: name, status: 'accepted', acceptedAt: Timestamp.now() });
    return { already: false, t, name };
  });

  if (!out.already && out.t.group) {
    const others = (out.t.staffIds || []).filter((id) => id !== user.uid);
    await pushToUsers(others, {
      title: `✓ ${out.name} is on it`,
      body: `${out.t.typeLabel} · ${out.t.location}. No need to go.`,
      tag: `task-${taskId}`,
      silent: true,
      link: `${baseUrl(req)}/`,
      data: { type: 'taken', taskId },
    });
  }
  return { ok: true };
});
