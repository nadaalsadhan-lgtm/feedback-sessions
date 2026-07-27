// api/rate.js
// ============================================================
// Records a one-click onboarding rating from the KABi email.
// Same style as your api/groq.js (module.exports + fetch).
//
// Storage: Upstash Redis via its REST API — NO npm package needed.
// After you connect the Upstash database to the project, Vercel
// adds these env vars automatically:
//     KV_REST_API_URL
//     KV_REST_API_TOKEN
// This file reads those. Nothing to install, nothing to rename.
// ============================================================

const KABI_BLUE = '#216AB1';
const KABI_TURQUOISE = '#1EAFD9';
const KABI_TOPAZ = '#0EB3AE';
const KABI_METEORITE = '#3D3185';

const VALID = { easy: 3, neutral: 2, difficult: 1 };

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const client = q.client;
  const product = q.product || '';
  const metric = q.metric || 'onboarding_effort';
  const score = q.score;
  const token = q.token || '';

  if (!client || !score || !(score in VALID)) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(page('Invalid link', 'Please use the buttons in the email.', ''));
  }

  const record = {
    client: client,
    product: product,
    metric: metric,
    score: score,
    value: VALID[score],
    token: token,
    ratedAt: new Date().toISOString()
  };

  // --- write to Upstash Redis via REST ---
  try {
    const url = process.env.KV_REST_API_URL;
    const authToken = process.env.KV_REST_API_TOKEN;
    if (url && authToken) {
      const payload = encodeURIComponent(JSON.stringify(record));
      // latest rating for this client+metric
      await fetch(url + '/set/rating:' + client + ':' + metric + '/' + payload, {
        headers: { Authorization: 'Bearer ' + authToken }
      });
      // append-only log of every click
      await fetch(url + '/lpush/ratings:log/' + payload, {
        headers: { Authorization: 'Bearer ' + authToken }
      });
    } else {
      console.error('Upstash env vars not set');
    }
  } catch (err) {
    console.error('Redis write failed:', err.message);
  }

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(page(
    'Thank you!',
    'Your onboarding feedback has been recorded.',
    'Optional: what would have made onboarding smoother?'
  ));
};

function page(title, body, follow) {
  var followBtn = follow
    ? '<a class="btn" href="#" onclick="return false;">' + follow + '</a>'
    : '';
  return '<!DOCTYPE html>'
    + '<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>KABi</title><style>'
    + 'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;'
    + 'display:flex;align-items:center;justify-content:center;min-height:100vh;}'
    + '.card{background:#fff;max-width:440px;width:90%;border-radius:14px;overflow:hidden;'
    + 'box-shadow:0 6px 24px rgba(0,0,0,.08);}'
    + '.head{background:' + KABI_BLUE + ';color:#fff;padding:26px;text-align:center;'
    + 'font-size:22px;font-weight:bold;letter-spacing:.5px;}'
    + '.body{padding:30px 28px;text-align:center;}'
    + '.tick{width:64px;height:64px;border-radius:50%;background:' + KABI_TOPAZ + ';'
    + 'margin:0 auto 18px;display:flex;align-items:center;justify-content:center;'
    + 'color:#fff;font-size:34px;}'
    + 'h1{color:' + KABI_BLUE + ';font-size:22px;margin:0 0 8px;}'
    + 'p{color:#000;font-size:15px;line-height:1.6;margin:0 0 20px;}'
    + '.foot{background:' + KABI_METEORITE + ';color:#fff;font-size:12px;text-align:center;padding:16px;}'
    + 'a.btn{display:inline-block;background:' + KABI_TURQUOISE + ';color:#fff;text-decoration:none;'
    + 'font-weight:bold;padding:12px 22px;border-radius:8px;font-size:14px;}'
    + '</style></head><body>'
    + '<div class="card"><div class="head">KABi</div>'
    + '<div class="body"><div class="tick">&#10003;</div>'
    + '<h1>' + title + '</h1><p>' + body + '</p>' + followBtn + '</div>'
    + '<div class="foot">KABi &bull; Improving how it feels to partner with us</div>'
    + '</div></body></html>';
}
