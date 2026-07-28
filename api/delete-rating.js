// api/delete-rating.js
// ============================================================
// Deletes a client's onboarding rating (and their comment).
// Called by the Delete button on the dashboard.
// Storage: Upstash Redis via REST (KV_REST_API_URL / KV_REST_API_TOKEN).
//
// POST body: { client, metric }   (metric defaults to onboarding_effort)
//
// Note: this removes the "latest" keys for that client AND filters the
// append-only logs so the client no longer appears in the dashboard.
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  var url = process.env.KV_REST_API_URL;
  var authToken = process.env.KV_REST_API_TOKEN;
  if (!url || !authToken) return res.status(500).json({ ok: false, error: 'KV env vars not set' });

  try {
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    var client = body.client;
    var metric = body.metric || 'onboarding_effort';
    if (!client) return res.status(400).json({ ok: false, error: 'missing client' });

    var hdr = { headers: { Authorization: 'Bearer ' + authToken } };

    // 1) delete the "latest" keys
    await fetch(url + '/del/rating:' + client + ':' + metric, hdr);
    await fetch(url + '/del/comment:' + client + ':' + metric, hdr);

    // 2) rebuild ratings:log without this client
    await rebuildLog(url, hdr, 'ratings:log', client, metric);
    // 3) rebuild comments:log without this client
    await rebuildLog(url, hdr, 'comments:log', client, null);

    return res.status(200).json({ ok: true, deleted: client });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// Reads a list, drops entries matching client (+metric if given), rewrites it.
async function rebuildLog(url, hdr, listKey, client, metric) {
  var resp = await fetch(url + '/lrange/' + listKey + '/0/-1', hdr);
  var data = await resp.json();
  var raw = (data && data.result) ? data.result : [];

  var keep = [];
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    var obj = null;
    try { obj = JSON.parse(item); } catch (e) {}
    if (!obj) { keep.push(item); continue; }
    var sameClient = (obj.client === client);
    var sameMetric = metric ? ((obj.metric || 'onboarding_effort') === metric) : true;
    if (sameClient && sameMetric) continue; // drop it
    keep.push(item);
  }

  // clear the list, then push back the kept items (preserve order: newest-first)
  await fetch(url + '/del/' + listKey, hdr);
  // rpush in original order to preserve newest-first layout
  for (var j = 0; j < keep.length; j++) {
    var payload = encodeURIComponent(keep[j]);
    await fetch(url + '/rpush/' + listKey + '/' + payload, hdr);
  }
}
