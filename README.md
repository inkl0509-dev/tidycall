# TidyCall — live housekeeping tasks

Managers send a task ("Clean · Toilet 2 · 10 min") to one housekeeper. The housekeeper's phone gets a push notification and the timer starts. They tap **Done**, the manager's board updates live (no push), and the housekeeper earns a badge. If the timer runs out, every manager gets a push alert.

**Stack:** HTML + JavaScript (no framework) · Firebase (login, Firestore live database, Cloud Messaging push) · Vercel (hosting + server functions) · GitHub (code) · Android app (`android/` folder, Android Studio) that opens the website full screen.

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

### "Can't go" and photos
**Can't go:** under each task a housekeeper can tap **🙅 Can't go**, pick *Busy on another task*, *Away from site* or *Other*, add a note and a **photo of the area**, and tap **Tell my manager**. Managers get a push and the task moves to **Can't go: reassign** at the top of the board, with the reason and a **📷 Photo** button. **Reassign** opens it on the Send screen with the people who said no left out. For a task sent to several people, managers are only alerted when everyone has said no. If plans change, the housekeeper can tap **I can go now**.

**Photos:**
- Managers can add a photo when sending a task (**Photo (optional)** on the Send screen).
- Housekeepers can tap **📷 Done + photo** to send a picture of the finished area.
- **Photos are temporary.** Each one is deleted 2 minutes after its receiver first opens it (a countdown shows), or after 24 hours if nobody opens it. Managers get **⬇ Save to device** to keep a copy before it's gone.
- Photos are shrunk on the phone and stored in Firestore, so no extra Firebase setup is needed.

### Card in / card out
Housekeepers tap **Card in** at the top of their screen when they start work and **Card out** when they leave. If they still have open tasks when carding out, they're warned first.

- **Send task → Who** lists on-duty staff first. **Everyone on duty** picks all of them; off-duty staff are under **Show off-duty staff**. Sending to someone off duty asks you to confirm.
- Managers get a small message when someone cards in or out, and the board shows how many are **on duty**.
- **Team** shows *On duty · since 8:02 AM* and the hours on duty today. Managers can **Card in / Card out** someone who forgot.
- Every shift is saved in the `shifts` collection (start, end, minutes).

### In-house map
**Settings → In-house maps → Upload a map**: a photo, scan or screenshot of your floor plan or site map (one per floor or area if you like). Then choose each place from the list and tap where it is on the map to pin it. Pinned places show 📍 on the Send screen.

When sending a task, tap a pinned place, or open **Pick on map** and tap the exact spot (e.g. "the corner by the lift"). The housekeeper's task card shows a small map centred on the pin; tapping it opens the full map with zoom. The manager's board has a **📍 Map** button on those tasks.

Maps are saved in Firestore (shrunk automatically to fit), so no extra Firebase setup is needed.

**Ready-made map:** `maps/lounge-map.json` is your lounge plan with 18 places already pinned. In **Settings → In-house maps → Import map file (.json)**, choose it, check the pins, and tap **Save map**. Any pinned places missing from your Places list are added automatically. You don't need to upload this file to GitHub.

Wide plans scroll sideways on phones so the pins stay easy to tap.

### Sending a task to several people
In **Who**, tap as many people as you like (or **Everyone** / **Everyone free**). They all get the alert. The first one to tap **I'll take it** (or **Done**) gets the task:
- Everyone else's card moves to **Taken by teammates: Aisha is on it. No need to go.** and their buttons disappear.
- Their phone notification is quietly replaced with "✓ Aisha is on it" (no sound).
- Only one person can take it, even if two tap at the same moment.
- If nobody accepts, reminders go to all of them, and the manager's overdue alert says "Nobody has accepted".

The board shows these as **Sent to 3: Aisha, Ali, Hassan · Waiting for someone**, then the name of whoever took it.

### Points and badges
| Finished | Badge | Points |
|---|---|---|
| In under half the time | ⚡ Lightning | +15 |
| Urgent task, on time | 🚨 Rapid Responder | +12 |
| On time | ✅ On Time | +10 |
| Late | 🐢 Late (bad badge) | −5 |
| More than double the time | 🐌 Very Late (bad badge) | −10 |

**Bad badges fade away.** Each bad badge gets lighter with every on-time task finished after it, and disappears after **4** on-time tasks. Staff see the progress dots on their screen; managers see e.g. `🐢 2/4` on the Team page. A new late task gives a new bad badge that starts again from 0 (older ones keep their progress).

Milestones (earned once): 🌱 First Shine (1st task), 🥉 10 tasks, 🥈 50, 🥇 100, 🏆 500, 🔥 5 on time in a row, ☄️ 20 in a row, 🏎️ 10 Lightning badges, 🌟 10 tasks in one day, 💎 500 points. The Team page lists staff by points, highest first.

### Reminders and alerts (example: a 10-minute task)
| When | Who gets a push |
|---|---|
| 2½ min, still not tapped "On my way" | Housekeeper: reminder |
| 2 min left, not done | Housekeeper: "2 min left, tap Done to avoid losing points" |
| Time's up, not done | **All managers**: overdue alert. Housekeeper: "Time's up" |
| Every 5 min after that (up to 3 times) | Housekeeper: "Still not done" |
| Double the time, still not done | **All managers**: second alert |

The not-accepted reminder comes at 25% of the time (between 1 and 3 min); "almost up" comes 2 min before the end (or at 80% for short tasks). The manager's board shows `🔔 reminded 3×` on each task. Change the numbers in `public/js/badges-def.js` (`POINTS`, `FADE_AFTER`, `REMIND`).

### Sounds
Each phone can choose its own sounds: staff tap **🔊** at the top of their screen, managers open **Settings → Sounds on this device**. Pick a tone (Chime, Bell, Alarm, Siren and more) and how many times it repeats for every alert, set the volume, and use **▶ Test** to hear it. Sound and vibration can be switched off.

| Staff hear | Managers hear |
|---|---|
| New task, new urgent task, reminder, time almost up, time's up, task done, task done late | Task sent, staff tapped "On my way", task finished, task finished late, task overdue |

These sounds play while the app is open on screen. When the phone is locked, alerts use the phone's normal notification sound.

These reminders need the cron-job.org check from setup step 6 (every minute) to reach phones that are locked.

---|---|
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
The full Android Studio project is in the `android` folder; see `android/README.md` to build the APK yourself. The quicker route without Android Studio is PWABuilder, below.

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
| `public/js/maps.js` | In-house maps: upload, pins, map view |
| `public/js/photos.js` | Take a photo, view it with the countdown, save to device |
| `public/js/badges-def.js` | Points, badge and reminder rules (used by both app and server) |
| `public/sw.js` | Background push + offline shell |
| `api/assign.js` | Creates a task and pushes it to the housekeeper |
| `api/complete.js` | Closes the task, gives points and a badge (or a bad badge if late), fades old bad badges |
| `api/check-overdue.js` | Sends the reminder schedule: staff reminders, manager overdue alerts |
| `api/accept.js` | "On my way" / "I'll take it": first to accept takes a group task |
| `api/duty.js` | Card in / card out, shift records |
| `api/decline.js` | "Can't go" with reason, note and photo; alerts managers |
| `api/photo.js` | Opens a temporary photo (starts the 2-minute countdown), deletes it, adds a done photo |
| `api/staff.js` | Add person, reset PIN, switch on/off |
| `api/setup.js` | Creates the first manager |
| `api/test-push.js` | Test notification |
| `api/assetlinks.js` | Android app verification file |
| `firestore.rules` | Who can read/change what in the database |
| `android/` | Android Studio project for the mobile app |

**Firestore collections:** `users` (name, role, stats, badges) · `tasks` (what, where, who, status, times, badge, map pin) · `config/app` (task types, places) · `maps` (floor plans + pins) · `shifts` (card in/out records) · `photos` (temporary pictures) · `pushTokens` (one per device).

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
| "Choose a staff member" even though someone is selected | The website and server files are from different versions. Upload all files again (keep your `public/firebase-config.js`) |

## Run on your own computer
VS Code Live Server only shows pages and can't run the `api` folder. To run everything locally: `npm i -g vercel`, then in this folder `vercel link`, `vercel env pull`, `vercel dev`, and open <http://localhost:3000>.

Points, badge and reminder rules can be tested with `npm test`.
