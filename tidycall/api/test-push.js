// POST /api/test-push — sends a test notification to the signed-in user's own devices.
const { requireUser, pushToUsers, baseUrl, route } = require('./_lib/firebase');

module.exports = route(['POST'], async (req) => {
  const user = await requireUser(req);
  const r = await pushToUsers([user.uid], {
    title: '🔔 Test notification',
    body: 'Notifications are working on this device.',
    tag: 'test',
    link: `${baseUrl(req)}/`,
    data: { type: 'test' },
  });
  return { devices: r.devices, sent: r.sent };
});
