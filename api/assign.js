// POST /api/assign — manager sends a task to one or more staff. Creates the task and pushes it to their phones.
// Sent to several people: everyone gets the push, and the first to accept takes it (see api/accept.js).
const { db, Timestamp, requireUser, pushToUsers, baseUrl, route, clean, httpError } = require('./_lib/firebase');

const MAX_PEOPLE = 30;

function readMapPoint(p) {
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.x); const y = Number(p.y);
  const mapId = clean(p.mapId, 128);
  if (!mapId || !(x >= 0 && x <= 1) || !(y >= 0 && y <= 1)) return null;
  return { mapId, mapName: clean(p.mapName, 60), x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
}

module.exports = route(['POST'], async (req, body) => {
  const manager = await requireUser(req, 'manager');

  let ids = Array.isArray(body.staffIds) ? body.staffIds : [body.staffId];
  ids = [...new Set(ids.map((x) => clean(x, 128)).filter(Boolean))];
  const typeLabel = clean(body.typeLabel, 60) || 'Task';
  const typeEmoji = clean(body.typeEmoji, 8);
  const location = clean(body.location, 80);
  const note = clean(body.note, 200);
  const priority = body.priority === 'urgent' ? 'urgent' : 'normal';
  const minutes = Math.round(Number(body.minutes));
  const mapPoint = readMapPoint(body.mapPoint);
  if (!ids.length) throw httpError(400, 'Choose at least one staff member.');
  if (ids.length > MAX_PEOPLE) throw httpError(400, `Send to at most ${MAX_PEOPLE} people at once.`);
  if (!location) throw httpError(400, 'Choose or type a location.');
  if (!(minutes >= 1 && minutes <= 240)) throw httpError(400, 'Time limit must be between 1 and 240 minutes.');

  const store = db();
  const snaps = await Promise.all(ids.map((id) => store.collection('users').doc(id).get()));
  const people = snaps.map((s, i) => {
    if (!s.exists) throw httpError(404, 'One of the chosen staff members no longer exists. Reload and try again.');
    const u = s.data();
    if (u.active === false) throw httpError(400, `${u.name} is switched off.`);
    return { id: ids[i], name: u.name };
  });
  const group = people.length > 1;

  const managerSnap = await store.collection('users').doc(manager.uid).get();
  const managerName = (managerSnap.exists && managerSnap.data().name) || 'Manager';

  const now = Timestamp.now();
  const ref = store.collection('tasks').doc();
  const task = {
    typeLabel, typeEmoji, location, note, priority, minutes, mapPoint,
    staffIds: people.map((p) => p.id),
    staffNames: people.map((p) => p.name),
    group,
    // One person: it's theirs straight away. Several: nobody owns it until someone accepts.
    staffId: group ? null : people[0].id,
    staffName: group ? '' : people[0].name,
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
  const push = await pushToUsers(task.staffIds, {
    title,
    body: `${location} · finish within ${minutes} min${group ? ' · first to accept takes it' : ''}${note ? ` · ${note}` : ''}`,
    tag: `task-${ref.id}`,
    requireInteraction: true,
    vibrate: priority === 'urgent' ? [400, 120, 400, 120, 400, 120, 600] : [250, 100, 250],
    link: `${baseUrl(req)}/?task=${ref.id}`,
    ttl: minutes * 60,
    data: { type: 'task', taskId: ref.id },
  });
  await ref.update({ pushDevices: push.sent });

  return { id: ref.id, pushSent: push.sent, staffName: group ? `${people.length} people` : people[0].name, group };
});
