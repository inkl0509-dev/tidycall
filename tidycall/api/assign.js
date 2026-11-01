// POST /api/assign — manager sends a task to one staff member. Creates the task and pushes it to their phone.
const { db, Timestamp, requireUser, pushToUsers, baseUrl, route, clean, httpError } = require('./_lib/firebase');

module.exports = route(['POST'], async (req, body) => {
  const manager = await requireUser(req, 'manager');

  const staffId = clean(body.staffId, 128);
  const typeLabel = clean(body.typeLabel, 60) || 'Task';
  const typeEmoji = clean(body.typeEmoji, 8);
  const location = clean(body.location, 80);
  const note = clean(body.note, 200);
  const priority = body.priority === 'urgent' ? 'urgent' : 'normal';
  const minutes = Math.round(Number(body.minutes));
  if (!staffId) throw httpError(400, 'Choose a staff member.');
  if (!location) throw httpError(400, 'Choose or type a location.');
  if (!(minutes >= 1 && minutes <= 240)) throw httpError(400, 'Time limit must be between 1 and 240 minutes.');

  const store = db();
  const staffSnap = await store.collection('users').doc(staffId).get();
  if (!staffSnap.exists) throw httpError(404, 'That staff member no longer exists.');
  const staff = staffSnap.data();
  if (staff.active === false) throw httpError(400, `${staff.name} is deactivated.`);

  const managerSnap = await store.collection('users').doc(manager.uid).get();
  const managerName = (managerSnap.exists && managerSnap.data().name) || 'Manager';

  const now = Timestamp.now();
  const ref = store.collection('tasks').doc();
  const task = {
    typeLabel, typeEmoji, location, note, priority, minutes,
    staffId, staffName: staff.name,
    createdBy: manager.uid, createdByName: managerName,
    status: 'assigned', open: true,
    createdAt: now,
    dueAt: Timestamp.fromMillis(now.toMillis() + minutes * 60000),
    acceptedAt: null, doneAt: null, escalatedAt: null, overdue: false,
    pushDevices: 0,
  };

  const batch = store.batch();
  batch.set(ref, task);
  // "Reassign": close the old task in the same write.
  const replace = clean(body.replaceTaskId, 128);
  if (replace) {
    const oldRef = store.collection('tasks').doc(replace);
    const old = await oldRef.get();
    if (old.exists && old.data().open) {
      batch.update(oldRef, { status: 'cancelled', open: false, cancelledAt: now, cancelledBy: manager.uid, reassignedTo: ref.id });
    }
  }
  await batch.commit();

  const title = `${priority === 'urgent' ? '🚨 URGENT · ' : ''}${typeEmoji ? typeEmoji + ' ' : ''}${typeLabel}`;
  const push = await pushToUsers([staffId], {
    title,
    body: `${location} · finish within ${minutes} min${note ? ` · ${note}` : ''}`,
    tag: `task-${ref.id}`,
    requireInteraction: true,
    vibrate: priority === 'urgent' ? [400, 120, 400, 120, 400, 120, 600] : [250, 100, 250],
    link: `${baseUrl(req)}/?task=${ref.id}`,
    ttl: minutes * 60,
    data: { type: 'task', taskId: ref.id },
  });
  await ref.update({ pushDevices: push.sent });

  return { id: ref.id, pushSent: push.sent, staffName: staff.name };
});
