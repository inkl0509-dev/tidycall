// Served at /.well-known/assetlinks.json (see vercel.json). Lets the Android app open without a browser bar.
// Set ANDROID_PACKAGE_NAME and ANDROID_SHA256 (comma-separated if several) in Vercel.
module.exports = (req, res) => {
  const pkg = process.env.ANDROID_PACKAGE_NAME;
  const prints = String(process.env.ANDROID_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (!pkg || !prints.length) return res.status(200).send('[]');
  res.status(200).send(JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
  }], null, 2));
};
