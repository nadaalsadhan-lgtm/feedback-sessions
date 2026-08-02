// api/attach-session.js
// ============================================================
// Attaches a recorded-session transcript to a client (stored in Upstash),
// so it appears on that client's page. Used for Fireflies imports (and can
// hold Groq Whisper sessions too if you want them server-side later).
//
// POST { client, source, title, date, text, summary }
//   source: "fireflies" | "in_app"
// GET  ?client=NAME  -> { ok, sessions:[...] } for that client
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var url = process.env.KV_REST_API_URL;
  var authToken = process.env.KV_REST_API_TOKEN;
  if (!url || !authToken) return res.status(500).json({ ok: false, error: 'KV env vars not set' });
  var hdr = { headers: { Authorization: 'Bearer ' + authToken } };

  try {
    if (req.method === 'GET') {
      var client = (req.query && req.query.client) || '';
      if (!client) return res.status(400).json({ ok: false, error: 'missing client' });
      var resp = await fetch(url + '/lrange/sessions:' + encodeURIComponent(client) + '/0/-1', hdr);
      var data = await resp.json();
      var raw = (data && data.result) ? data.result : [];
      var sessions = [];
      for (var i = 0; i < raw.length; i++) { try { sessions.push(JSON.parse(raw[i])); } catch (e) {} }
      return res.status(200).json({ ok: true, sessions: sessions });
    }

    // POST -> attach
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    if (!body.client) return res.status(400).json({ ok: false, error: 'missing client' });

    var record = {
      id: 'sess_' + Date.now(),
      client: body.client,
      source: body.source || 'fireflies',
      title: body.title || '',
      date: body.date || new Date().toISOString(),
      text: (body.text || '').toString().slice(0, 100000),
      summary: (body.summary || '').toString().slice(0, 10000),
      at: new Date().toISOString()
    };
    var payload = encodeURIComponent(JSON.stringify(record));
    await fetch(url + '/lpush/sessions:' + encodeURIComponent(body.client) + '/' + payload, hdr);

    return res.status(200).json({ ok: true, id: record.id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
