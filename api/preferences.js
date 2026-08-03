// api/preferences.js
// ============================================================
// Client Preferences form (shared at contract signing).
// Stored in Upstash under prefs:{client}. Also feeds the client page.
//
// GET  /api/preferences?client=NAME  -> { ok, prefs:{...} | null }
// POST /api/preferences { client, ...answers }  -> saves
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var url = process.env.KV_REST_API_URL;
  var token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ ok: false, error: 'KV env vars not set' });
  var hdr = { headers: { Authorization: 'Bearer ' + token } };

  try {
    if (req.method === 'GET') {
      var client = (req.query && req.query.client) || '';
      if (!client) return res.status(400).json({ ok: false, error: 'missing client' });
      var r = await fetch(url + '/get/prefs:' + encodeURIComponent(client), hdr);
      var d = await r.json();
      if (!d || !d.result) return res.status(200).json({ ok: true, prefs: null });
      var prefs; try { prefs = JSON.parse(d.result); } catch (e) { prefs = null; }
      return res.status(200).json({ ok: true, prefs: prefs });
    }

    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    var name = (body.client || '').toString().trim();
    if (!name) return res.status(400).json({ ok: false, error: 'missing client' });

    function clean(v){ return (v == null ? '' : v.toString()).slice(0, 3000); }

    var record = {
      client: name,
      product: clean(body.product),
      // owner
      ownerName: clean(body.ownerName),
      ownerRole: clean(body.ownerRole),
      ownerEmail: clean(body.ownerEmail),
      ownerPhone: clean(body.ownerPhone),
      // working together
      commTool: clean(body.commTool),
      commLanguage: clean(body.commLanguage),
      cadence: clean(body.cadence),
      detailLevel: clean(body.detailLevel),
      updateFormat: clean(body.updateFormat),
      // goals & context
      goals: clean(body.goals),
      success: clean(body.success),
      challenge: clean(body.challenge),
      usedSimilar: clean(body.usedSimilar),
      // exceptional
      oneThing: clean(body.oneThing),
      frustration: clean(body.frustration),
      socialOk: clean(body.socialOk),
      submittedAt: new Date().toISOString()
    };

    var payload = encodeURIComponent(JSON.stringify(record));
    await fetch(url + '/set/prefs:' + encodeURIComponent(name) + '/' + payload, hdr);
    // keep a log too
    await fetch(url + '/lpush/prefs:log/' + payload, hdr);

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
