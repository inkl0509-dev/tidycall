// POST /api/duty — card in / card out.
//   { action: 'in' }  or { action: 'out' }            staff do it for themselves
//   { action: 'in' | 'out', uid: '<staff id>' }        a manager does it for someone (e.g. they forgot to card out)
// Each card-in starts a record in the `shifts` collection; card-out closes it with the minutes worked.
const { db, Timestamp, requireUser, route, clean, httpError } = require('./_lib/firebase');

module.exports = route(['POST'], async (req, body) => {
  const user = await requireUser(req);
  const action = body.action === 'out' ? 'out' : body.action === 'in' ? 'in' : null;
  if (!action) throw httpError(400, 'Unknown action.');
  const target = clean(body.uid, 128) || user.uid;
  if (target !== user.uid && user.role !== 'manager') throw httpError(403, 'Only managers can card other people in or out.');

  const store = db();
  const userRef = store.collection('users').doc(target);

  const result = await store.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw httpError(404, 'User not found.');
    const u = snap.data();
    if (u.active === false) throw httpError(400, `${u.name} is switched off.`);
    const now = Timestamp.now();
    const by = target === user.uid ? 'self' : user.uid;

    if (action === 'in') {
      if (u.onDuty) return { onDuty: true, already: true, since: u.dutySince ? u.dutySince.toMillis() : null };
      const shiftRef = store.collection('shifts').doc();
      tx.set(shiftRef, { uid: target, name: u.name, in: now, out: null, minutes: null, open: true, inBy: by });
      tx.update(userRef, { onDuty: true, dutySince: now, currentShiftId: shiftRef.id });
      return { onDuty: true, since: now.toMillis() };
    }

    if (!u.onDuty) return { onDuty: false, already: true };
    const minutes = u.dutySince ? Math.round((now.toMillis() - u.dutySince.toMillis()) / 60000) : null;
    if (u.currentShiftId) {
      const shiftRef = store.collection('shifts').doc(u.currentShiftId);
      const shift = await tx.get(shiftRef);
      if (shift.exists) tx.update(shiftRef, { out: now, minutes, open: false, outBy: by });
    }
    tx.update(userRef, { onDuty: false, dutySince: null, currentShiftId: null, lastDutyOut: now });
    return { onDuty: false, minutes };
  });

  // Tell the person how many tasks they still have open when they card out.
  if (action === 'out' && !result.already) {
    const open = await store.collection('tasks').where('staffId', '==', target).where('open', '==', true).get();
    result.openTasks = open.size;
  }
  return result;
});
