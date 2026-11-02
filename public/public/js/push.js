// Push notifications: register the service worker, ask permission, store this device's token.
import { getMessaging, getToken, onMessage, isSupported, deleteToken } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { app, db, auth } from './firebase.js';
import { h, toast } from './ui.js';

let swReg = null;
let messaging = null;
let currentToken = null;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  } catch (e) { console.warn('Service worker failed', e); }
  return swReg;
}

export async function pushSupported() {
  try { return 'Notification' in window && (await isSupported()); } catch (e) { return false; }
}

export function pushState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/** Get a token and save it under pushTokens/{token}. Call after a tap (iPhone requires it). */
export async function enablePush(role) {
  if (!(await pushSupported())) {
    const ios = /iphone|ipad/i.test(navigator.userAgent);
    throw new Error(ios
      ? 'On iPhone: tap Share → Add to Home Screen, open the app from the home screen, then turn on notifications.'
      : 'This browser cannot receive notifications. Use Chrome, or install the Android app.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in the browser or phone settings for this app.');
  if (!swReg) await registerSW();
  messaging = messaging || getMessaging(app);
  const token = await getToken(messaging, { vapidKey: self.VAPID_KEY, serviceWorkerRegistration: swReg });
  if (!token) throw new Error('Could not get a notification token. Try again.');
  currentToken = token;
  await setDoc(doc(db, 'pushTokens', token), {
    uid: auth.currentUser.uid,
    role,
    device: navigator.userAgent.slice(0, 180),
    updatedAt: serverTimestamp(),
  });
  try { localStorage.setItem('tc_push_token', token); } catch (e) { /* ignore */ }
  return token;
}

/** If permission was already granted earlier, refresh the token silently on every app start. */
export async function refreshPushIfGranted(role) {
  if (pushState() !== 'granted') return false;
  try { await enablePush(role); return true; } catch (e) { console.warn(e); return false; }
}

/** Messages that arrive while the app is open on screen. */
export async function onForegroundPush(handler) {
  if (!(await pushSupported())) return;
  messaging = messaging || getMessaging(app);
  onMessage(messaging, (payload) => handler(payload));
}

/** On sign-out: stop this device from receiving that user's notifications. */
export async function forgetDevice() {
  let token = currentToken;
  try { token = token || localStorage.getItem('tc_push_token'); } catch (e) { /* ignore */ }
  if (token) {
    try { await deleteDoc(doc(db, 'pushTokens', token)); } catch (e) { /* ignore */ }
    try { if (messaging) await deleteToken(messaging); } catch (e) { /* ignore */ }
    try { localStorage.removeItem('tc_push_token'); } catch (e) { /* ignore */ }
  }
}

/** Banner asking to turn on notifications. Hides itself once granted. */
export function pushBanner(role, text) {
  const state = pushState();
  if (state === 'granted') return null;
  const el = h('div.push-banner',
    h('div',
      h('strong', state === 'denied' ? 'Notifications are blocked' : 'Turn on notifications'),
      h('p', state === 'denied'
        ? 'Open your phone or browser settings, allow notifications for this app, then reload.'
        : text)),
    state === 'denied' ? null : h('button.btn', {
      type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { await enablePush(role); el.remove(); toast('Notifications are on for this device.', 'ok'); }
        catch (err) { toast(err.message, 'error', 9000); }
        finally { btn.disabled = false; }
      },
    }, 'Turn on'));
  return el;
}
