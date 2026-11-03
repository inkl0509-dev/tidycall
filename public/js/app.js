// App start: sign-in, first-time setup, then the manager or staff screen.
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { configured, auth, api, emailFor } from './firebase.js';
import { h, mount, toast, busy } from './ui.js';
import { registerSW, forgetDevice } from './push.js';

const APP = self.APP_NAME || 'TidyCall';
export const APP_VERSION = '2026-11-03.2'; // keep the same as api/setup.js

/** Checks the server matches this page, and shows a red banner with the fix if not. */
async function healthCheck() {
  document.body.append(h('footer.app-version', `${APP} · version ${APP_VERSION}`));
  let s;
  try { s = await api('setup', {}, { method: 'GET', anonymous: true }); } catch (e) { return; }
  const problems = [];
  const appProject = (self.FIREBASE_CONFIG || {}).projectId;
  if (s.serverProject && appProject && s.serverProject !== appProject) {
    problems.push(`The website uses Firebase project "${appProject}" but the server key in Vercel (FIREBASE_SERVICE_ACCOUNT) is for "${s.serverProject}". Both must be the same project. Download a new key from project "${appProject}" (Project settings → Service accounts), paste it into Vercel, and redeploy.`);
  }
  if (s.version !== APP_VERSION) {
    problems.push(`The website (version ${APP_VERSION}) and server (version ${s.version || 'older'}) don't match. Upload all files from the latest zip to GitHub again.`);
  }
  if (!problems.length) return;
  document.body.prepend(h('div.health-banner', { role: 'alert' }, h('strong', 'Setup problem'), ...problems.map((p) => h('p', p))));
}
document.title = APP;
let teardown = null;

function brand() {
  return h('div.brand', h('span.brand-mark', { 'aria-hidden': 'true' }), h('span', APP));
}

function notConfigured() {
  mount(h('main.auth',
    h('div.auth-card',
      brand(),
      h('h1', 'Almost ready'),
      h('p', 'Paste your Firebase web settings into public/firebase-config.js, commit the change, and Vercel will redeploy. The README walks through it step by step.'))));
}

async function loginScreen() {
  let status = { needsSetup: false, serverReady: true };
  try { status = await api('setup', {}, { method: 'GET', anonymous: true }); } catch (e) { /* show login anyway */ }

  const err = h('p.form-error', { role: 'alert' });
  const form = h('form.stack',
    h('label', 'Username', h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, required: true })),
    h('label', 'PIN', h('input', { name: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true, minLength: 6 })),
    err,
    h('button.btn.big', { type: 'submit' }, 'Sign in'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(form.querySelector('button'), async () => {
      try {
        await signInWithEmailAndPassword(auth, emailFor(form.username.value), form.pin.value);
      } catch (ex) {
        const code = ex.code || '';
        err.textContent = /invalid|wrong|not-found|credential/.test(code) ? 'Username or PIN is wrong.'
          : code.includes('disabled') ? 'This account is switched off. Ask your manager.'
          : code.includes('too-many') ? 'Too many tries. Wait a minute and try again.'
          : code.includes('network') ? 'No connection. Check the Wi-Fi.'
          : ex.message;
      }
    });
  });

  const card = h('div.auth-card', brand(), h('h1', 'Sign in'), form);

  if (!status.serverReady) {
    card.append(h('p.hint', 'Server not set up yet: add FIREBASE_SERVICE_ACCOUNT in Vercel → Settings → Environment Variables, then redeploy.'));
  } else if (status.needsSetup) {
    card.append(h('button.btn.ghost.wide', { type: 'button', onclick: setupScreen }, 'First-time setup: create the manager account'));
  }
  mount(h('main.auth', card));
}

function setupScreen() {
  const err = h('p.form-error', { role: 'alert' });
  const form = h('form.stack',
    h('p', 'Create the first manager account. You need the SETUP_KEY you saved in Vercel.'),
    h('label', 'Setup key', h('input', { name: 'setupKey', type: 'password', required: true })),
    h('label', 'Your name', h('input', { name: 'name', required: true, maxLength: 40 })),
    h('label', 'Username', h('input', { name: 'username', autocapitalize: 'none', spellcheck: false, required: true, pattern: '[a-zA-Z0-9._-]{2,30}' }),
      h('small', 'Letters and numbers, no spaces. Example: irufan')),
    h('label', 'PIN (6–12 digits)', h('input', { name: 'pin', type: 'password', inputmode: 'numeric', pattern: '\\d{6,12}', required: true })),
    err,
    h('div.row-end',
      h('button.btn.ghost', { type: 'button', onclick: loginScreen }, 'Back'),
      h('button.btn', { type: 'submit' }, 'Create manager')));
  form.addEventListener('submit', (e) => {
    e.preventDefault(); err.textContent = '';
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await api('setup', { setupKey: form.setupKey.value, name: form.elements.namedItem('name').value, username: form.username.value, pin: form.pin.value }, { anonymous: true });
        toast('Manager created. Signing you in…', 'ok');
        await signInWithEmailAndPassword(auth, emailFor(form.username.value), form.pin.value);
      } catch (ex) { err.textContent = ex.message; }
    });
  });
  mount(h('main.auth', h('div.auth-card', brand(), h('h1', 'First-time setup'), form)));
}

export async function logout() {
  await forgetDevice();
  if (teardown) { teardown(); teardown = null; }
  await signOut(auth);
}

async function start() {
  if (!configured) return notConfigured();
  healthCheck();
  registerSW();
  await setPersistence(auth, browserLocalPersistence).catch(() => {});

  onAuthStateChanged(auth, async (user) => {
    if (teardown) { teardown(); teardown = null; }
    if (!user) return loginScreen();
    mount(h('main.loading', h('span.spinner', { 'aria-label': 'Loading' })));
    const token = await user.getIdTokenResult(true).catch(() => null);
    const role = token && token.claims.role;
    const ctx = { user, role, logout, brand, APP };
    if (role === 'manager') {
      const m = await import('./manager.js');
      teardown = m.start(ctx);
    } else if (role === 'staff') {
      const s = await import('./staff.js');
      teardown = s.start(ctx);
    } else {
      mount(h('main.auth', h('div.auth-card', brand(), h('h1', 'No role yet'),
        h('p', 'This account was not created from the Team screen, so it has no role. Ask a manager to add you.'),
        h('button.btn', { onclick: logout }, 'Sign out'))));
    }
  });
}

start();
