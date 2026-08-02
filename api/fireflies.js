// api/fireflies.js
// ============================================================
// Proxy to the Fireflies.ai GraphQL API.
// Same style as api/groq.js (module.exports + fetch).
// Reads FIREFLIES_API_KEY from Vercel env vars.
//
// Actions (POST body: { action, ... }):
//   { action: "list" }                 -> recent transcripts (id, title, date, duration)
//   { action: "get", id: "<id>" }      -> full transcript text + summary for one meeting
//
// The client transcript is then attached to a client via /api/attach-session.
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  var apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'FIREFLIES_API_KEY not set' });

  try {
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    var action = body.action || 'list';

    var query, variables = {};

    if (action === 'list') {
      // recent transcripts (most recent first). limit kept modest.
      query = 'query Transcripts($limit: Int) { transcripts(limit: $limit) { id title date duration } }';
      variables = { limit: body.limit || 20 };
    } else if (action === 'get') {
      if (!body.id) return res.status(400).json({ ok: false, error: 'missing id' });
      // full transcript: sentences (speaker + text) and summary
      query = 'query Transcript($id: String!) { transcript(id: $id) { id title date duration '
            + 'summary { overview action_items keywords } '
            + 'sentences { speaker_name text } } }';
      variables = { id: body.id };
    } else {
      return res.status(400).json({ ok: false, error: 'unknown action' });
    }

    var upstream = await fetch('https://api.fireflies.ai/graphql', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: query, variables: variables })
    });

    var data = await upstream.json();
    if (!upstream.ok || (data && data.errors)) {
      var msg = (data && data.errors && data.errors[0] && data.errors[0].message) || 'Fireflies API error';
      return res.status(upstream.ok ? 400 : upstream.status).json({ ok: false, error: msg });
    }

    if (action === 'list') {
      var list = (data.data && data.data.transcripts) ? data.data.transcripts : [];
      return res.status(200).json({ ok: true, transcripts: list });
    } else {
      var t = data.data && data.data.transcript;
      if (!t) return res.status(404).json({ ok: false, error: 'transcript not found' });
      // stitch sentences into a plain transcript with speaker labels
      var text = '';
      if (t.sentences && t.sentences.length) {
        text = t.sentences.map(function (s) {
          var who = s.speaker_name ? (s.speaker_name + ': ') : '';
          return who + (s.text || '');
        }).join('\n');
      }
      var summaryText = '';
      if (t.summary) {
        if (t.summary.overview) summaryText += t.summary.overview;
        if (t.summary.action_items) summaryText += (summaryText ? '\n\nAction items:\n' : '') + t.summary.action_items;
      }
      return res.status(200).json({
        ok: true,
        transcript: {
          id: t.id, title: t.title, date: t.date, duration: t.duration,
          text: text, summary: summaryText,
          keywords: (t.summary && t.summary.keywords) ? t.summary.keywords : []
        }
      });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
