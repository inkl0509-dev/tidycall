// POST /api/check-overdue — runs the reminder schedule for every open task:
//   • not accepted yet (after ~25% of the time)  → reminder push to the housekeeper
//   • time almost up and not done                → reminder push to the housekeeper
//   • time's up and not done                     → alert push to ALL managers + push to the housekeeper
//   • still not done, every 5 min (max 3)        → reminder push to the housekeeper
//   • still not done at double the time          → second alert to all managers
// Each step happens once per task. Timing rules live in public/js/badges-def.js (REMIND).
//
// Called by: the scheduled job (cron-job.org every minute / GitHub Action) using CRON_SECRET,
// and by any open copy of the app when it sees a step is due (so it's instant while someone has the app open).
const { db, Timestamp, bearer, requireUser, pushToUsers, baseUrl, route } = require('./_lib/firebase');
const { nextAction } = require('../public/js/badges-def.js');

module.exports = route(['GET', 'POST'], async (req) => {
  const token = bearer(req);
  const secret = process.env.CRON_SECRET;
  if (!(secret && token === secret)) await requireUser(req); // any signed-in user may trigger a check

  const store = db();
  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const snap = await store.collection('tasks').where('open', '==', true).get();

  const work = snap.docs.map((d) => ({ doc: d, t: d.data(), action: nextAction(d.data(), nowMs) })).filter((w) => w.action);
  if (!work.length) return { escalated: 0, reminded: 0 };

  let managerIds = null;
  const managers = async () => {
    if (!managerIds) {
      const m = await store.collection('users').where('role', '==', 'manager').get();
      managerIds = m.docs.filter((d) => d.data().active !== false).map((d) => d.id);
    }
    return managerIds;
  };
  const base = baseUrl(req);
  let escalated = 0;
  let reminded = 0;

  for (const { doc, t, action } of work) {
    const what = `${t.typeEmoji ? t.typeEmoji + ' ' : ''}${t.typeLabel}`;
    const reminders = (t.reminders || 0) + 1;
    const staffLink = `${base}/?task=${doc.id}`;
    // Unaccepted group task: remind everyone it was sent to.
    const unclaimed = !t.staffId;
    const recipients = unclaimed ? (t.staffIds || []) : [t.staffId];
    const staffPush = (title, body, urgent) => pushToUsers(recipients, {
      title, body, tag: `task-${doc.id}`, requireInteraction: true,
      vibrate: urgent ? [500, 200, 500, 200, 500] : [250, 100, 250],
      link: staffLink, data: { type: 'reminder', taskId: doc.id, step: action },
    });

    // Claim the step first so two checks running at once never send it twice.
    const claim = {
      notAccepted: { remindedNotAccepted: now, reminders, lastReminderAt: now },
      almostDue: { remindedAlmostDue: now, remindedNotAccepted: t.remindedNotAccepted || now, reminders, lastReminderAt: now },
      escalate: { escalatedAt: now, overdue: true, reminders, lastReminderAt: now },
      overdueReminder: { overdueReminders: (t.overdueReminders || 0) + 1, reminders, lastReminderAt: now },
      managerRepeat: { managerRepeatAt: now },
    }[action];
    try {
      await doc.ref.update(claim, { lastUpdateTime: doc.updateTime });
    } catch (e) {
      continue; // someone else handled it
    }

    const leftMin = Math.max(1, Math.round((t.dueAt.toMillis() - nowMs) / 60000));
    const overMin = Math.max(1, Math.round((nowMs - t.dueAt.toMillis()) / 60000));
    const notOpened = t.status === 'assigned';

    if (action === 'notAccepted') {
      await staffPush(`🔔 Reminder: ${what}`, unclaimed
        ? `${t.location} · nobody has taken it yet. Tap "I'll take it" · ${leftMin} min left`
        : `${t.location} · please tap "On my way" · ${leftMin} min left`);
      reminded++;
    } else if (action === 'almostDue') {
      await staffPush(`⏳ ${leftMin} min left: ${what}`, `${t.location} · finish and tap Done to avoid losing points`, true);
      reminded++;
    } else if (action === 'overdueReminder') {
      await staffPush(`⏰ Still not done: ${what}`, `${t.location} · ${overMin} min over time · tap Done when finished`, true);
      reminded++;
    } else if (action === 'escalate' || action === 'managerRepeat') {
      const second = action === 'managerRepeat';
      await pushToUsers(await managers(), {
        title: `${second ? '🚨 Still overdue' : '⏰ Overdue'}: ${what}`,
        body: unclaimed
          ? `Nobody has accepted ${t.location} (sent to ${(t.staffNames || []).join(', ')}) · ${overMin} min over (${t.minutes} min limit)`
          : `${t.staffName} ${notOpened ? "hasn't opened" : "hasn't finished"} ${t.location} · ${overMin} min over (${t.minutes} min limit)`,
        tag: `overdue-${doc.id}`,
        requireInteraction: true,
        vibrate: [500, 200, 500],
        link: `${base}/?view=board&task=${doc.id}`,
        data: { type: 'overdue', taskId: doc.id },
      });
      if (!second) {
        await staffPush(`⏰ Time's up: ${what}`, `${t.location} · your manager has been told · finish and tap Done`, true);
        reminded++;
      }
      escalated++;
    }
  }
  return { escalated, reminded };
});
