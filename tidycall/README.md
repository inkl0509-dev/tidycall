# TidyCall — live housekeeping tasks

Managers send a task ("Clean · Toilet 2 · 10 min") to one housekeeper. The housekeeper's phone gets a push notification and the timer starts. They tap **Done**, the manager's board updates live (no push), and the housekeeper earns a badge. If the timer runs out, every manager gets a push alert.

**Stack:** HTML + JavaScript (no framework) · Firebase (login, Firestore live database, Cloud Messaging push) · Vercel (hosting + server functions) · GitHub (code) · Android app made from the website with PWABuilder.

---

## What each person sees

**Manager** (phone, tablet or PC)
- **Send task:** pick what (Clean, Towels needed…), where (Toilet 2, Shower 1…), time limit (5–60 min), urgent or not, an optional note, and who. Each housekeeper shows *Free* or *2 open* so you can pick someone available.
- **Live board:** Over time (red) · In progress (live countdowns, Sent / Accepted) · Finished today (time taken + badge). Updates instantly when staff accept or finish. Reassign or cancel any open task.
- A red bar and sound when something runs over time, plus a push to every manager's phone.
- **Team:** add housekeepers (username + PIN), reset PINs, switch people off, see each person's stats and badges.
- **Settings:** edit task types and places, default time limit, test notifications.

**Housekeeper** (phone)
- Push notification for every new task (urgent tasks vibrate harder).
- Big card per task: the place in large type, and a "water level" that drains as time runs out (amber when low, red when over).
- **On my way** (optional, tells the manager they've seen it) and **Done**.
- A badge pops up after every task, plus milestone badges.

### Badges
| Every task gets one | When |
|---|---|
| ⚡ Lightning | Done in under half the time |
| 🚨 Rapid Responder | Urgent task done on time |
| ✅ On Time | Done before the deadline |
| 💪 Got It Done | Done after the deadline |

Milestones (earned once): 🌱 First Shine (1st task), 🥉 10 tasks, 🥈 50, 🥇 100, 🏆 500, 🔥 5 on time in a row, ☄️ 20 in a row, 🏎️ 10 Lightning badges, 🌟 10 tasks in one day. Change them in `public/js/badges-def.js`.

---

## Setup (about 30–40 minutes, once)

You need: a Google account (Firebase), a GitHub account, a Vercel account (sign in with GitHub). All have free plans.

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> → **Add project** → name it (e.g. `tidycall`) → Analytics can be off.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
   (Staff never see an email. The app turns the username into a hidden login.)
3. **Build → Firestore Database → Create database** → choose a location close to you (e.g. `asia-south1` Mumbai) → **Start in production mode**.
4. Open the **Rules** tab, delete everything, paste the whole content of `firestore.rules` from this project, click **Publish**.
5. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (any nickname, no hosting). Copy the values inside `firebaseConfig = { … }`.
6. **Project settings → Cloud Messaging → Web configuration → Web Push certificates → Generate key pair.** Copy the key.
7. **Project settings → Service accounts → Generate new private key.** A `.json` file downloads. Keep it secret: never put it in GitHub.

### 2. Put your Firebase settings in the code
Open `public/firebase-config.js` and paste:
- the values from step 1.5 into `FIREBASE_CONFIG`
- the key from step 1.6 into `VAPID_KEY`
- optionally change `APP_NAME`

### 3. Upload to GitHub
1. On <https://github.com/new> create a **private** repository (e.g. `tidycall`).
2. Click **uploading an existing file**, drag in **everything inside the project folder** (including the `.github` folder if your computer shows hidden folders), and **Commit**.
   Or with git: `git init && git add . && git commit -m "TidyCall" && git branch -M main && git remote add origin https://github.com/YOU/tidycall.git && git push -u origin main`

### 4. Deploy on Vercel
1. <https://vercel.com/new> → import the GitHub repository. Framework preset: **Other**. Leave build settings empty.
2. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Open the `.json` from step 1.7 in a text editor, copy **all** of it, paste here |
| `SETUP_KEY` | Any password you make up. Used once to create the first manager |
| `CRON_SECRET` | Another long random password (e.g. 30 random letters/numbers) |
| `APP_TIMEZONE` | `Indian/Maldives` (or your time zone; used for "done today") |

3. **Deploy.** You get a URL like `https://tidycall.vercel.app`.
   Every time you change code on GitHub, Vercel redeploys by itself. If you change an environment variable later: **Deployments → ⋯ → Redeploy**.

### 5. First sign-in
1. Open your Vercel URL → **First-time setup** → enter the `SETUP_KEY`, your name, a username and a 6+ digit PIN.
2. Go to **Team → Add person** for each housekeeper (name, username, PIN). Give them their username and PIN.
3. **Settings:** edit task types and places to match your property (villas, jetty, etc.) and **Save settings**.
4. On every phone (managers and staff): sign in, tap **Turn on** in the yellow box, allow notifications. Use **Settings → Send test notification** to check.

### 6. Overdue alerts when nobody has the app open
When a timer runs out, any open copy of the app tells the server immediately. To also catch overdue tasks while every phone is locked, something must ping the server regularly:

**cron-job.org (recommended, free, every minute)**
1. Sign up at <https://cron-job.org> → **Create cronjob**.
2. URL: `https://YOUR-APP.vercel.app/api/check-overdue` · Schedule: every 1 minute.
3. **Advanced:** Request method **POST**; add header `Authorization` with value `Bearer YOUR_CRON_SECRET`.
4. Save, then click **Test run**: the response should be `{"escalated":0}`.

**GitHub Action (backup, every ~5 min, already included)**
Repository → **Settings → Secrets and variables → Actions → New repository secret**: add `APP_URL` (your Vercel URL, no trailing slash) and `CRON_SECRET` (same as in Vercel). Check it under the **Actions** tab → *Overdue check* → **Run workflow**.

> Vercel's own cron jobs only run once a day on the free plan, so they are not used here. On Vercel Pro you can add `"crons": [{ "path": "/api/check-overdue", "schedule": "* * * * *" }]` to `vercel.json` instead.

### 7. Android app
The Android app wraps your website (a *Trusted Web Activity*), so you only maintain one codebase and push notifications keep working.

1. Go to <https://www.pwabuilder.com>, enter your Vercel URL, click **Start**, then **Package for stores → Android → Generate package**.
   - Package ID: e.g. `com.yourresort.tidycall` (cannot change later)
   - App name: TidyCall (or your name)
   - Signing key: let PWABuilder create a new one
2. Download the zip. Inside you'll find:
   - an `.apk` file → install directly on staff phones (open the file on the phone and allow "Install unknown apps"),
   - an `.aab` file → for publishing on Google Play (optional),
   - `signing.keystore` + `signing-key-info.txt` → **back these up**; you need them to publish updates,
   - `assetlinks.json`.
3. Open `assetlinks.json`, copy the `package_name` and the `sha256_cert_fingerprints` value. In Vercel add environment variables:
   - `ANDROID_PACKAGE_NAME` = the package name
   - `ANDROID_SHA256` = the fingerprint (if you later publish on Google Play, also add Play's app-signing fingerprint, comma-separated)
   Redeploy, then check `https://YOUR-APP.vercel.app/.well-known/assetlinks.json` shows them. This removes the browser address bar from the app.
4. Open the app on the phone, sign in, tap **Turn on** for notifications.

You only rebuild the APK if you change the app name, icon or URL. Normal code changes reach the app automatically through Vercel.

**iPhone:** open the URL in Safari → Share → **Add to Home Screen**, open it from the home screen, sign in and turn on notifications (iOS 16.4 or newer).

---

## How it works

```
Manager phone ──POST /api/assign──▶ Vercel ──▶ Firestore (task)   ──live──▶ Manager board
                                       └────▶ Firebase Cloud Messaging ──push──▶ Staff phone
Staff phone ──POST /api/complete──▶ Vercel ──▶ Firestore (done + badge) ──live──▶ Manager board
cron-job.org ─POST /api/check-overdue─▶ Vercel ──▶ push to all managers (+ reminder to staff)
```

| File | Job |
|---|---|
| `public/index.html`, `public/css/app.css` | The app page and its look |
| `public/js/app.js` | Sign-in, first-time setup, opens the manager or staff screen |
| `public/js/manager.js` | Send task, live board, team, settings |
| `public/js/staff.js` | Task cards, countdown, Done, badges |
| `public/js/push.js` | Notification permission and device registration |
| `public/js/badges-def.js` | Badge rules (used by both app and server) |
| `public/sw.js` | Background push + offline shell |
| `api/assign.js` | Creates a task and pushes it to the housekeeper |
| `api/complete.js` | Closes the task, awards badges, updates stats |
| `api/check-overdue.js` | Finds tasks past their limit, alerts managers once per task |
| `api/staff.js` | Add person, reset PIN, switch on/off |
| `api/setup.js` | Creates the first manager |
| `api/test-push.js` | Test notification |
| `api/assetlinks.js` | Android app verification file |
| `firestore.rules` | Who can read/change what in the database |

**Firestore collections:** `users` (name, role, stats, badges) · `tasks` (what, where, who, status, times, badge) · `config/app` (task types, places) · `pushTokens` (one per device).

**Security:** passwords/PINs are handled by Firebase Auth. Roles are stored as Firebase custom claims set by the server, so a housekeeper can't make themselves a manager. Staff can only read their own tasks and only change a task from *Sent* to *Accepted*; creating and completing tasks goes through the server, so badges can't be faked.

**Cost:** for one property this stays inside the free Firebase (Spark) plan: Cloud Messaging is free and the Firestore free quota is far above what a housekeeping team uses. Vercel's free Hobby plan is meant for personal, non-commercial use; for a business, check Vercel's plan terms (Pro is the commercial plan).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Almost ready" screen | `public/firebase-config.js` still has the `PASTE_` placeholders |
| "Server not set up" on sign-in | `FIREBASE_SERVICE_ACCOUNT` missing in Vercel, or you didn't redeploy after adding it |
| "Access denied by Firestore rules" | Paste `firestore.rules` in Firebase → Firestore → Rules and **Publish** |
| A toast says Firestore needs an index | Click **Create it** in the toast, wait 1–2 minutes, reload |
| "Sent, but no phone was notified" | That housekeeper hasn't tapped **Turn on** for notifications on their phone yet, or blocked them in Android settings |
| No notifications on Android app | Phone Settings → Apps → TidyCall → Notifications → allow. Also turn off battery optimisation for the app so Android doesn't delay pushes |
| Overdue push only when app is open | Set up cron-job.org (step 6) |
| Forgot a PIN | A manager uses **Team → Reset PIN** |

Badge rules can be tested with `npm test`.
