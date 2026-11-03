// Firebase setup for the browser + a small helper for calling our Vercel API.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const LOGIN_DOMAIN = 'staff.tidycall.example.com'; // must match api/_lib/firebase.js

export const configured = !!(self.FIREBASE_CONFIG && self.FIREBASE_CONFIG.apiKey && !/PASTE/.test(self.FIREBASE_CONFIG.apiKey));

export const app = configured ? initializeApp(self.FIREBASE_CONFIG) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getFirestore(app) : null;

export function emailFor(username) {
  const u = String(username || '').trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`;
}

/** POST JSON to /api/<path> with the signed-in user's ID token. Throws Error(message) on failure.
 *  On "not authorised" it gets a fresh token and tries once more (fixes most expired-session cases). */
export async function api(path, body = {}, { method = 'POST', anonymous = false } = {}) {
  const send = async (fresh) => {
    const headers = { 'Content-Type': 'application/json' };
    if (!anonymous && auth && auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken(fresh)}`;
    try {
      return await fetch(`/api/${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new Error('No connection. Check the Wi-Fi and try again.');
    }
  };
  let res = await send(false);
  if (res.status === 401 && !anonymous && auth && auth.currentUser) {
    try { res = await send(true); } catch (e) { /* keep the first answer */ }
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error(data.error || `Server error (${res.status}).`);
  return data;
}
