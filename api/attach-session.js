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

    // POST -> attach (or delete)
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    if (!body.client) return res.status(400).json({ ok: false, error: 'missing client' });

    // Delete a single session by id (rewrites the list without it)
    if (body.action === 'delete') {
      var listKey = 'sessions:' + encodeURIComponent(body.client);
      var cur = await fetch(url + '/lrange/sessions:' + encodeURIComponent(body.client) + '/0/-1', hdr);
      var curData = await cur.json();
      var rawArr = (curData && curData.result) ? curData.result : [];
      var kept = [];
      for (var j = 0; j < rawArr.length; j++) {
        var obj = null; try { obj = JSON.parse(rawArr[j]); } catch(e){}
        if (!obj) continue;
        var idMatch = String(obj.id||'') === String(body.id) || String(obj.at||'') === String(body.id) || String(obj.date||'') === String(body.id);
        if (!idMatch) kept.push(rawArr[j]);
      }
      // clear the list, then re-push the kept items
      await fetch(url + '/del/sessions:' + encodeURIComponent(body.client), { method:'POST', headers: hdr.headers });
      for (var k = 0; k < kept.length; k++) {
        await fetch(url + '/rpush/sessions:' + encodeURIComponent(body.client) + '/' + encodeURIComponent(kept[k]), hdr);
      }
      return res.status(200).json({ ok: true, deleted: body.id, remaining: kept.length });
    }

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
