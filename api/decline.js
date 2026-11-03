// POST /api/decline — staff taps "Can't go" on a task: busy on another task, away from site, or other.
// Optional note and photo of the area. Managers get a push so they can reassign.
// Sent to several people: the task stays open for the others; managers are alerted when everyone has said no.
const { db, Timestamp, requireUser, pushToUsers, baseUrl, route, clean, httpError } = require('./_lib/firebase');
const { checkImage, addPhoto } = require('./_lib/photos');

const REASONS = { busy: 'Busy on another task', away: 'Away from site', other: "Can't go" };

module.exports = route(['POST'], async (req, body) => {
  const user = await requireUser(req);
  const taskId = clean(body.taskId, 128);
  const reason = REASONS[body.reason] ? body.reason : 'other';
  const note = clean(body.note, 200);
  const image = checkImage(body.photo);
  if (!taskId) throw httpError(400, 'Missing task.');

  const store = db();
  const ref = store.collection('tasks').doc(taskId);
  const meSnap = await store.collection('users').doc(user.uid).get();
  const myName = (meSnap.exists && meSnap.data().name) || 'Staff';

  const out = await store.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw httpError(404, 'This task no longer exists.');
    const t = snap.data();
    if (!t.open) throw httpError(409, 'This task is already closed.');
    const ids = t.staffIds || (t.staffId ? [t.staffId] : []);
    if (!ids.includes(user.uid)) throw httpError(403, 'This task was not sent to you.');
    if (t.staffId && t.staffId !== user.uid) throw httpError(409, `${t.staffName} already took this task.`);

    const now = Timestamp.now();
    const photoId = image ? addPhoto(store, tx, {
      image, taskId, kind: 'decline', from: user.uid, fromName: myName, place: t.location, toManagers: true,
    }) : null;
    const entry = { uid: user.uid, name: myName, reason, reasonText: REASONS[reason], note, at: now, photoId };
    const declines = (t.declines || []).filter((d) => d.uid !== user.uid).concat([entry]);
    const everyone = t.staffId === user.uid || ids.every((id) => declines.some((d) => d.uid === id));
    const update = { declines };
    if (everyone) Object.assign(update, { status: 'declined', declinedAt: now, needsReassign: true });
    tx.update(ref, update);
    return { t, entry, everyone, count: declines.length, total: ids.length };
  });

  // Alert managers when nobody is left to do it (a single person, or everyone in a group said no).
  if (out.everyone) {
    const m = await store.collection('users').where('role', '==', 'manager').get();
    const managerIds = m.docs.filter((d) => d.data().active !== false).map((d) => d.id);
    const who = out.total > 1 ? `Nobody can go (${out.total} asked)` : `${myName} can't go`;
    await pushToUsers(managerIds, {
      title: `🙅 ${who}: ${out.t.typeLabel} · ${out.t.location}`,
      body: `${out.entry.reasonText}${note ? ` · ${note}` : ''}${out.entry.photoId ? ' · 📷 photo attached' : ''} · tap to reassign`,
      tag: `declined-${taskId}`,
      requireInteraction: true,
      vibrate: [300, 100, 300],
      link: `${baseUrl(req)}/?view=board&task=${taskId}`,
      data: { type: 'declined', taskId },
    });
  }
  return { ok: true, everyone: out.everyone };
});
