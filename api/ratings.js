// api/ratings.js
// ============================================================
// Reads recorded onboarding ratings back out of Upstash.
// De-duplicates by client: each client counts ONCE, newest
// answer wins. So repeat clicks from the same client update
// their rating instead of stacking.
//
// Same style as api/groq.js and api/rate.js (module.exports + fetch).
//
// GET /api/ratings           -> { ok, count, ratings: [...] }   (deduped, newest-first)
// GET /api/ratings?all=1     -> include the full raw log too (for auditing)
// ============================================================

module.exports = async function handler(req, res) {
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
    const resp = await fetch(url + '/lrange/ratings:log/0/-1', {
      headers: { Authorization: 'Bearer ' + authToken }
    });
    const data = await resp.json();
    const raw = (data && data.result) ? data.result : [];

    // parse all entries
    const parsed = [];
    for (var i = 0; i < raw.length; i++) {
      try { parsed.push(JSON.parse(raw[i])); } catch (e) { /* skip malformed */ }
    }

    // The list is newest-first (rate.js uses lpush). So the FIRST time we
    // see a client+metric, that's their latest answer — keep it, skip the rest.
    const seen = {};
    const deduped = [];
    for (var j = 0; j < parsed.length; j++) {
      var rt = parsed[j];
      var key = (rt.client || '') + '|' + (rt.metric || 'onboarding_effort');
      if (seen[key]) continue;   // older duplicate — ignore
      seen[key] = true;
      deduped.push(rt);
    }

    var payload = {
      ok: true,
      count: deduped.length,   // unique clients
      ratings: deduped         // one row per client, newest-first
    };

    if (req.query && req.query.all) {
      payload.rawCount = parsed.length; // total clicks including duplicates
      payload.raw = parsed;
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
