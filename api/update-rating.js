// api/update-rating.js
// ============================================================
// Edits an existing rating's score and/or comment (onboarding or NPS).
// Called by the Edit control on the dashboard.
// Storage: Upstash Redis via REST (KV_REST_API_URL / KV_REST_API_TOKEN).
//
// POST body: { client, metric, score, comment }
//   metric  : "onboarding_effort" | "nps"
//   score   : onboarding -> "easy"|"neutral"|"difficult"
//             nps        -> "0".."10"
//   comment : new comment text ("" clears it)
//
// It rewrites the latest keys AND the append-only logs so the
// dashboard reflects the change immediately and consistently.
// ============================================================

var ONB_VALUE = { easy: 3, neutral: 2, difficult: 1 };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  var url = process.env.KV_REST_API_URL;
  var authToken = process.env.KV_REST_API_TOKEN;
  if (!url || !authToken) return res.status(500).json({ ok: false, error: 'KV env vars not set' });
  var hdr = { headers: { Authorization: 'Bearer ' + authToken } };

  try {
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    var client = body.client;
    var metric = body.metric || 'onboarding_effort';
    var score = (body.score != null) ? String(body.score) : null;
    var comment = (body.comment != null) ? String(body.comment).slice(0, 2000) : null;
    if (!client) return res.status(400).json({ ok: false, error: 'missing client' });

    var now = new Date().toISOString();

    // ---- 1) update the rating (if a score was provided) ----
    if (score !== null && score !== '') {
      var value, category;
      if (metric === 'nps') {
        var n = parseInt(score, 10);
        if (isNaN(n) || n < 0 || n > 10) return res.status(400).json({ ok: false, error: 'bad nps score' });
        value = n;
        category = (n >= 9) ? 'promoter' : (n >= 7) ? 'passive' : 'detractor';
      } else {
        if (!(score in ONB_VALUE)) return res.status(400).json({ ok: false, error: 'bad onboarding score' });
        value = ONB_VALUE[score];
        category = '';
      }
      var rec = {
        client: client, product: '', metric: metric,
        score: score, value: value, category: category,
        token: '', ratedAt: now, edited: true
      };
      var rpayload = encodeURIComponent(JSON.stringify(rec));
      // set latest key
      await fetch(url + '/set/rating:' + client + ':' + metric + '/' + rpayload, hdr);
      // rebuild the ratings log: drop old entries for this client+metric, push the new one on top
      await rebuildLogReplacing(url, hdr, 'ratings:log', client, metric, JSON.stringify(rec));
    }

    // ---- 2) update the comment (if provided) ----
    if (comment !== null) {
      if (comment === '') {
        // clear it
        await fetch(url + '/del/comment:' + client + ':' + metric, hdr);
        await rebuildLogReplacing(url, hdr, 'comments:log', client, metric, null);
      } else {
        var crec = { client: client, product: '', metric: metric, score: score || '', token: '', comment: comment, at: now };
        var cpayload = encodeURIComponent(JSON.stringify(crec));
        await fetch(url + '/set/comment:' + client + ':' + metric + '/' + cpayload, hdr);
        await rebuildLogReplacing(url, hdr, 'comments:log', client, metric, JSON.stringify(crec));
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// Rebuilds a list: removes all entries for client+metric, then (if newItemJson given)
// puts the new item at the front (newest-first via lpush order preserved by rebuild).
async function rebuildLogReplacing(url, hdr, listKey, client, metric, newItemJson) {
  var resp = await fetch(url + '/lrange/' + listKey + '/0/-1', hdr);
  var data = await resp.json();
  var raw = (data && data.result) ? data.result : [];

  var keep = [];
  for (var i = 0; i < raw.length; i++) {
    var obj = null;
    try { obj = JSON.parse(raw[i]); } catch (e) {}
    if (!obj) { keep.push(raw[i]); continue; }
    var sameClient = (obj.client === client);
    var sameMetric = ((obj.metric || 'onboarding_effort') === metric);
    if (sameClient && sameMetric) continue; // drop old ones for this client+metric
    keep.push(raw[i]);
  }

  // clear + rewrite. New item goes first (newest), then the kept items in original order.
  await fetch(url + '/del/' + listKey, hdr);
  var ordered = [];
  if (newItemJson) ordered.push(newItemJson);
  ordered = ordered.concat(keep);
  for (var j = 0; j < ordered.length; j++) {
    var payload = encodeURIComponent(ordered[j]);
    await fetch(url + '/rpush/' + listKey + '/' + payload, hdr);
  }
}
