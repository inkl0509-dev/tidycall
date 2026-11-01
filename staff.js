// POST /api/staff — manager adds staff, resets a PIN, renames, or activates/deactivates someone.
const { db, auth, Timestamp, requireUser, route, clean, httpError, emailFor } = require('./_lib/firebase');

const USERNAME = /^[a-z0-9._-]{2,30}$/;
const PIN = /^\d{6,12}$/;

module.exports = route(['POST'], async (req, body) => {
  const manager = await requireUser(req, 'manager');
  const store = db();
  const action = body.action;

  if (action === 'create') {
    const name = clean(body.name, 40);
    const username = clean(body.username, 30).toLowerCase();
    const pin = String(body.pin || '');
    const role = body.role === 'manager' ? 'manager' : 'staff';
    if (!name) throw httpError(400, 'Enter a name.');
    if (!USERNAME.test(username)) throw httpError(400, 'Username: 2–30 letters, numbers, dots or dashes, no spaces.');
    if (!PIN.test(pin)) throw httpError(400, 'PIN must be 6–12 digits.');
    let rec;
    try {
      rec = await auth().createUser({ email: emailFor(username), password: pin, displayName: name });
    } catch (e) {
      if (e.code === 'auth/email-already-exists') throw httpError(409, `The username "${username}" is taken.`);
      throw e;
    }
    await auth().setCustomUserClaims(rec.uid, { role });
    await store.collection('users').doc(rec.uid).set({
      name, username, role, active: true, createdAt: Timestamp.now(), createdBy: manager.uid,
      stats: { done: 0, onTime: 0, late: 0, lightning: 0, streak: 0, bestStreak: 0 },
      milestones: {}, badgeCounts: {}, recentBadges: [],
    });
    return { uid: rec.uid };
  }

  const uid = clean(body.uid, 128);
  if (!uid) throw httpError(400, 'Missing user.');
  const ref = store.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, 'User not found.');

  if (action === 'resetPin') {
    const pin = String(body.pin || '');
    if (!PIN.test(pin)) throw httpError(400, 'PIN must be 6–12 digits.');
    await auth().updateUser(uid, { password: pin });
    await auth().revokeRefreshTokens(uid);
    return { ok: true };
  }

  if (action === 'setActive') {
    const active = !!body.active;
    if (!active && uid === manager.uid) throw httpError(400, "You can't deactivate yourself.");
    await auth().updateUser(uid, { disabled: !active });
    if (!active) {
      await auth().revokeRefreshTokens(uid);
      const tokens = await store.collection('pushTokens').where('uid', '==', uid).get();
      await Promise.all(tokens.docs.map((d) => d.ref.delete()));
    }
    await ref.update({ active });
    return { ok: true };
  }

  if (action === 'rename') {
    const name = clean(body.name, 40);
    if (!name) throw httpError(400, 'Enter a name.');
    await auth().updateUser(uid, { displayName: name });
    await ref.update({ name });
    return { ok: true };
  }

  throw httpError(400, 'Unknown action.');
});
