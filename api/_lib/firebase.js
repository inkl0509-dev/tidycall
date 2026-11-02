// Shared server helpers: Firebase Admin, auth checks, push sending.
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

// Usernames become hidden e-mail addresses for Firebase Auth. Must match public/js/firebase.js.
const LOGIN_DOMAIN = 'staff.tidycall.example.com';

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw httpError(500, 'Server is not set up: the FIREBASE_SERVICE_ACCOUNT environment variable is missing in Vercel.');
  let text = raw.trim();
  if (!text.startsWith('{')) text = Buffer.from(text, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return sa;
}

function app() {
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount()) });
  return getApps()[0];
}

const db = () => { app(); return getFirestore(); };
const auth = () => { app(); return getAuth(); };
const messaging = () => { app(); return getMessaging(); };

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function bearer(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

/** Verify the Firebase ID token sent by the browser. Optionally require a role. */
async function requireUser(req, role) {
  const token = bearer(req);
  if (!token) throw httpError(401, 'Please sign in again.');
  let user;
  try {
    user = await auth().verifyIdToken(token, true);
  } catch (e) {
    throw httpError(401, 'Your session has expired. Please sign in again.');
  }
  if (role && user.role !== role) throw httpError(403, 'Only managers can do this.');
  return user;
}

function emailFor(username) {
  const u = String(username || '').trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`;
}

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

function todayKey(date = new Date()) {
  const tz = process.env.APP_TIMEZONE || 'Indian/Maldives';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Send one push to every device of the given users. Removes dead tokens. Returns devices reached. */
async function pushToUsers(uids, msg) {
  uids = [...new Set(uids.filter(Boolean))];
  if (!uids.length) return { sent: 0, devices: 0 };
  const tokens = [];
  for (let i = 0; i < uids.length; i += 30) {
    const snap = await db().collection('pushTokens').where('uid', 'in', uids.slice(i, i + 30)).get();
    snap.forEach((d) => tokens.push(d.id));
  }
  if (!tokens.length) return { sent: 0, devices: 0 };

  let sent = 0;
  const dead = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await messaging().sendEachForMulticast({
      tokens: batch,
      data: Object.fromEntries(Object.entries(msg.data || {}).map(([k, v]) => [k, String(v)])),
      webpush: {
        headers: { Urgency: 'high', TTL: String(msg.ttl || 3600) },
        notification: msg.silent
          // Quiet update that replaces an earlier notification with the same tag (e.g. "Aisha is on it").
          ? { title: msg.title, body: msg.body, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag: msg.tag, silent: true }
          : {
            title: msg.title,
            body: msg.body,
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
            tag: msg.tag,
            renotify: true,
            silent: false, // normal alerts always use the phone's notification sound
            requireInteraction: !!msg.requireInteraction,
            vibrate: msg.vibrate || [200, 100, 200],
          },
        fcmOptions: msg.link ? { link: msg.link } : undefined,
      },
      android: { priority: 'high' },
    });
    res.responses.forEach((r, j) => {
      if (r.success) sent++;
      else {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument') {
          dead.push(batch[j]);
        }
      }
    });
  }
  await Promise.all(dead.map((t) => db().collection('pushTokens').doc(t).delete().catch(() => {})));
  return { sent, devices: tokens.length };
}

/** Wrap a handler with JSON error handling and a method check. */
function route(methods, fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!methods.includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const out = await fn(req, body, res);
      if (!res.headersSent) res.status(200).json(out || { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      res.status(status).json({ error: e.message || 'Something went wrong' });
    }
  };
}

const clean = (v, max = 120) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

module.exports = {
  db, auth, messaging, Timestamp, FieldValue,
  httpError, bearer, requireUser, emailFor, baseUrl, todayKey, pushToUsers, route, clean, LOGIN_DOMAIN,
};
