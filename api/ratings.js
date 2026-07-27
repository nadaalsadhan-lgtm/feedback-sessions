// api/ratings.js
// ============================================================
// Reads all recorded onboarding ratings back out of Upstash,
// so your dashboard can display them.
// Same style as api/groq.js and api/rate.js (module.exports + fetch).
//
// GET /api/ratings           -> { ok, count, ratings: [...] }
// Returns the append-only log (newest first).
// ============================================================

module.exports = async function handler(req, res) {
  // allow your dashboard (any origin) to fetch this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.KV_REST_API_URL;
  const authToken = process.env.KV_REST_API_TOKEN;

  if (!url || !authToken) {
    return res.status(500).json({ ok: false, error: 'KV env vars not set' });
  }

  try {
    // read the whole ratings:log list (index 0 .. -1 = all items)
    const resp = await fetch(url + '/lrange/ratings:log/0/-1', {
      headers: { Authorization: 'Bearer ' + authToken }
    });
    const data = await resp.json();

    // Upstash REST returns { result: [ "<json string>", ... ] }
    const raw = (data && data.result) ? data.result : [];
    const ratings = [];
    for (var i = 0; i < raw.length; i++) {
      try {
        ratings.push(JSON.parse(raw[i]));
      } catch (e) {
        // skip any malformed entry
      }
    }

    return res.status(200).json({
      ok: true,
      count: ratings.length,
      ratings: ratings   // already newest-first because we lpush new ones
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
