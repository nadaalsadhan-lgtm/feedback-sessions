// api/ratings.js
// ============================================================
// Reads ratings + comments from Upstash, deduped per client+metric.
// Splits by metric so the dashboard can show onboarding AND NPS.
//
// GET /api/ratings ->
//   {
//     ok, 
//     ratings:   [...],                      // onboarding only (back-compat)
//     comments:  { client: {...} },          // onboarding comments (back-compat)
//     nps:       [...],                       // NPS ratings
//     npsComments: { client: {...} },         // NPS comments
//     all:       [...]                        // every rating, any metric
//   }
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.KV_REST_API_URL;
  const authToken = process.env.KV_REST_API_TOKEN;
  if (!url || !authToken) return res.status(500).json({ ok: false, error: 'KV env vars not set' });

  try {
    // ---- ratings log ----
    const rResp = await fetch(url + '/lrange/ratings:log/0/-1', { headers: { Authorization: 'Bearer ' + authToken } });
    const rData = await rResp.json();
    const rRaw = (rData && rData.result) ? rData.result : [];

    const parsed = [];
    for (var i = 0; i < rRaw.length; i++) { try { parsed.push(JSON.parse(rRaw[i])); } catch (e) {} }

    // dedupe per client+metric (newest first)
    const seen = {};
    const dedupAll = [];
    for (var j = 0; j < parsed.length; j++) {
      var rt = parsed[j];
      var m = rt.metric || 'onboarding_effort';
      var key = (rt.client || '') + '|' + m;
      if (seen[key]) continue;
      seen[key] = true;
      dedupAll.push(rt);
    }

    var onboarding = dedupAll.filter(function (x) { return (x.metric || 'onboarding_effort') === 'onboarding_effort'; });
    var nps = dedupAll.filter(function (x) { return x.metric === 'nps'; });

    // ---- comments log ----
    const cResp = await fetch(url + '/lrange/comments:log/0/-1', { headers: { Authorization: 'Bearer ' + authToken } });
    const cData = await cResp.json();
    const cRaw = (cData && cData.result) ? cData.result : [];
    var comments = {};      // onboarding
    var npsComments = {};   // nps
    for (var k = 0; k < cRaw.length; k++) {
      try {
        var cm = JSON.parse(cRaw[k]);
        var mm = cm.metric || 'onboarding_effort';
        if (!cm.client) continue;
        if (mm === 'nps') {
          if (!npsComments[cm.client]) npsComments[cm.client] = { comment: cm.comment || '', score: cm.score || '', at: cm.at || '' };
        } else {
          if (!comments[cm.client]) comments[cm.client] = { comment: cm.comment || '', score: cm.score || '', at: cm.at || '' };
        }
      } catch (e) {}
    }

    return res.status(200).json({
      ok: true,
      count: onboarding.length,
      ratings: onboarding,
      comments: comments,
      nps: nps,
      npsComments: npsComments,
      all: dedupAll
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
