// POST /api/check-overdue — finds tasks past their time limit and pushes an alert to all managers
// (plus a reminder to the staff member). Each task is escalated once.
//
// Called by: any signed-in app that sees a timer run out (instant), and by a scheduled job
// (cron-job.org every minute, or the GitHub Action every 5 minutes) using CRON_SECRET.
const { db, Timestamp, bearer, requireUser, pushToUsers, baseUrl, route } = require('./_lib/firebase');

module.exports = route(['GET', 'POST'], async (req) => {
  const token = bearer(req);
  const secret = process.env.CRON_SECRET;
  if (!(secret && token === secret)) await requireUser(req); // any signed-in user may trigger a check

  const store = db();
  const now = Timestamp.now();
  const since = Timestamp.fromMillis(now.toMillis() - 36 * 3600 * 1000);
  const snap = await store.collection('tasks').where('dueAt', '<=', now).where('dueAt', '>=', since).get();

  const due = snap.docs.filter((d) => d.data().open && !d.data().escalatedAt);
  if (!due.length) return { escalated: 0 };

  const managers = await store.collection('users').where('role', '==', 'manager').get();
  const managerIds = managers.docs.filter((d) => d.data().active !== false).map((d) => d.id);
  const base = baseUrl(req);

  let escalated = 0;
  for (const doc of due) {
    // Claim the task; if another check got there first this write fails and we skip it.
    try {
      await doc.ref.update({ escalatedAt: now, overdue: true }, { lastUpdateTime: doc.updateTime });
    } catch (e) {
      continue;
    }
    escalated++;
    const t = doc.data();
    const what = `${t.typeEmoji ? t.typeEmoji + ' ' : ''}${t.typeLabel}`;
    await pushToUsers(managerIds, {
      title: `⏰ Overdue: ${what}`,
      body: `${t.staffName} hasn't finished ${t.location} (${t.minutes} min limit).`,
      tag: `overdue-${doc.id}`,
      requireInteraction: true,
      vibrate: [500, 200, 500],
      link: `${base}/?view=board&task=${doc.id}`,
      data: { type: 'overdue', taskId: doc.id },
    });
    await pushToUsers([t.staffId], {
      title: `⏰ Time's up: ${what}`,
      body: `${t.location} · please finish and tap Done.`,
      tag: `task-${doc.id}`,
      requireInteraction: true,
      vibrate: [500, 200, 500],
      link: `${base}/?task=${doc.id}`,
      data: { type: 'reminder', taskId: doc.id },
    });
  }
  return { escalated };
});
