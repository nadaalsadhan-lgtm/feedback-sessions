// api/ratings.js
// ============================================================
// Reads onboarding ratings (deduped per client, newest wins)
// AND the follow-up comments, so the dashboard can show both.
//
// GET /api/ratings -> { ok, count, ratings:[...], comments:{client: {comment, score, at}} }
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
    // --- ratings log ---
    const rResp = await fetch(url + '/lrange/ratings:log/0/-1', {
      headers: { Authorization: 'Bearer ' + authToken }
    });
    const rData = await rResp.json();
    const rRaw = (rData && rData.result) ? rData.result : [];

    const parsed = [];
    for (var i = 0; i < rRaw.length; i++) {
      try { parsed.push(JSON.parse(rRaw[i])); } catch (e) {}
    }
    const seen = {};
    const deduped = [];
    for (var j = 0; j < parsed.length; j++) {
      var rt = parsed[j];
      var key = (rt.client || '') + '|' + (rt.metric || 'onboarding_effort');
      if (seen[key]) continue;
      seen[key] = true;
      deduped.push(rt);
    }

    // --- comments log (newest per client wins) ---
    const cResp = await fetch(url + '/lrange/comments:log/0/-1', {
      headers: { Authorization: 'Bearer ' + authToken }
    });
    const cData = await cResp.json();
    const cRaw = (cData && cData.result) ? cData.result : [];
    const comments = {};
    for (var k = 0; k < cRaw.length; k++) {
      try {
        var cm = JSON.parse(cRaw[k]);
        if (cm.client && !comments[cm.client]) {
          comments[cm.client] = { comment: cm.comment || '', score: cm.score || '', at: cm.at || '' };
        }
      } catch (e) {}
    }

    return res.status(200).json({
      ok: true,
      count: deduped.length,
      ratings: deduped,
      comments: comments
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
