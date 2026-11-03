// POST /api/photo — open or expire a temporary photo, or add a photo to a finished task.
//   { action: 'view',   id }                 receiver opens it: starts the 2-minute countdown, returns the image
//   { action: 'expire', id }                 called when the countdown ends: deletes it
//   { action: 'add',    taskId, image }      staff adds a "done" photo to a task they finished
const { db, Timestamp, requireUser, route, clean, httpError } = require('./_lib/firebase');
const { VIEW_SECONDS, checkImage, addPhoto, purgePhotos } = require('./_lib/photos');

module.exports = route(['POST'], async (req, body) => {
  const user = await requireUser(req);
  const store = db();
  const isManager = user.role === 'manager';

  if (body.action === 'add') {
    const taskId = clean(body.taskId, 128);
    const image = checkImage(body.image);
    if (!taskId || !image) throw httpError(400, 'Missing photo.');
    const ref = store.collection('tasks').doc(taskId);
    const snap = await ref.get();
    if (!snap.exists) throw httpError(404, 'This task no longer exists.');
    const t = snap.data();
    if (t.staffId !== user.uid) throw httpError(403, 'You can only add photos to your own tasks.');
    const me = await store.collection('users').doc(user.uid).get();
    const id = await addPhoto(store, null, {
      image, taskId, kind: 'done', from: user.uid, fromName: (me.exists && me.data().name) || '', place: t.location, toManagers: true,
    });
    await ref.update({ donePhotoId: id });
    return { id };
  }

  const id = clean(body.id, 128);
  if (!id) throw httpError(400, 'Missing photo.');
  const ref = store.collection('photos').doc(id);

  if (body.action === 'view') {
    const out = await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { gone: true };
      const p = snap.data();
      const allowed = (p.toManagers && isManager) || (p.to || []).includes(user.uid) || (isManager && p.from === user.uid);
      if (!allowed) throw httpError(403, 'This photo is not for you.');
      const receiver = (p.toManagers && isManager) || (p.to || []).includes(user.uid);
      let deleteAt = p.deleteAt;
      // The countdown starts the first time a receiver opens it (the sender looking again doesn't count).
      if (!deleteAt && receiver) {
        const now = Timestamp.now();
        deleteAt = Timestamp.fromMillis(now.toMillis() + VIEW_SECONDS * 1000);
        tx.update(ref, { viewedAt: now, viewedBy: user.uid, deleteAt });
      }
      return { image: p.image, place: p.place, fromName: p.fromName, kind: p.kind, createdAt: p.createdAt.toMillis(), deleteAt: deleteAt ? deleteAt.toMillis() : null };
    });
    return out;
  }

  if (body.action === 'expire') {
    const snap = await ref.get();
    if (snap.exists) {
      const p = snap.data();
      if (p.deleteAt && p.deleteAt.toMillis() <= Date.now() + 5000) await ref.delete();
    }
    purgePhotos(store).catch(() => {}); // tidy up anything else that's due
    return { ok: true };
  }

  throw httpError(400, 'Unknown action.');
});
