// GET  /api/setup — tells the login screen whether the server is configured and whether a manager exists.
// POST /api/setup — creates the very first manager. Needs SETUP_KEY and only works while no manager exists.
const { db, auth, Timestamp, route, clean, httpError, emailFor } = require('./_lib/firebase');

const DEFAULT_CONFIG = {
  taskTypes: [
    { label: 'Clean', emoji: '🧽' },
    { label: 'Towels needed', emoji: '🧺' },
    { label: 'Refill soap / tissue', emoji: '🧴' },
    { label: 'Empty trash', emoji: '🗑️' },
    { label: 'Wet floor / spill', emoji: '💧' },
    { label: 'Check & tidy', emoji: '👀' },
  ],
  locations: [
    'Toilet 1', 'Toilet 2', 'Toilet 3', 'Shower 1', 'Shower 2',
    'Reception floor', 'Lobby', 'Restaurant', 'Pool deck', 'Jetty', 'Corridor', 'Staff room',
  ],
  defaultMinutes: 10,
};

module.exports = route(['GET', 'POST'], async (req, body) => {
  if (req.method === 'GET') {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) return { serverReady: false, needsSetup: true, setupKeySet: !!process.env.SETUP_KEY };
    const managers = await db().collection('users').where('role', '==', 'manager').limit(1).get();
    return { serverReady: true, needsSetup: managers.empty, setupKeySet: !!process.env.SETUP_KEY };
  }

  if (!process.env.SETUP_KEY) throw httpError(400, 'Add a SETUP_KEY environment variable in Vercel first, then redeploy.');
  if (String(body.setupKey || '') !== process.env.SETUP_KEY) throw httpError(403, 'Setup key is wrong.');
  const store = db();
  const managers = await store.collection('users').where('role', '==', 'manager').limit(1).get();
  if (!managers.empty) throw httpError(409, 'Setup is already done. Sign in instead.');

  const name = clean(body.name, 40);
  const username = clean(body.username, 30).toLowerCase();
  const pin = String(body.pin || '');
  if (!name) throw httpError(400, 'Enter your name.');
  if (!/^[a-z0-9._-]{2,30}$/.test(username)) throw httpError(400, 'Username: 2–30 letters, numbers, dots or dashes.');
  if (!/^\d{6,12}$/.test(pin)) throw httpError(400, 'PIN must be 6–12 digits.');

  const rec = await auth().createUser({ email: emailFor(username), password: pin, displayName: name });
  await auth().setCustomUserClaims(rec.uid, { role: 'manager' });
  await store.collection('users').doc(rec.uid).set({
    name, username, role: 'manager', active: true, createdAt: Timestamp.now(),
    stats: {}, milestones: {}, badgeCounts: {}, recentBadges: [],
  });
  const cfg = store.collection('config').doc('app');
  if (!(await cfg.get()).exists) await cfg.set(DEFAULT_CONFIG);
  return { ok: true };
});
