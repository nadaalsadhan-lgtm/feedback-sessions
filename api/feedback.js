// api/feedback.js
// ============================================================
// Saves the follow-up comment a client types after choosing
// Neutral or Difficult. Called by the form on the thank-you page.
// Storage: Upstash Redis via REST (same env vars as rate.js).
//
// POST body: { client, product, score, token, comment }
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  try {
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    var record = {
      client: body.client || '',
      product: body.product || '',
      score: body.score || '',
      token: body.token || '',
      comment: (body.comment || '').toString().slice(0, 2000), // cap length
      at: new Date().toISOString()
    };

    if (!record.client) return res.status(400).json({ ok: false, error: 'missing client' });

    var url = process.env.KV_REST_API_URL;
    var authToken = process.env.KV_REST_API_TOKEN;
    if (url && authToken) {
      var payload = encodeURIComponent(JSON.stringify(record));
      // latest comment per client, plus an append-only comment log
      await fetch(url + '/set/comment:' + record.client + ':onboarding_effort/' + payload, {
        headers: { Authorization: 'Bearer ' + authToken }
      });
      await fetch(url + '/lpush/comments:log/' + payload, {
        headers: { Authorization: 'Bearer ' + authToken }
      });
    } else {
      console.error('Upstash env vars not set');
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
