// api/pipedrive.js
// ============================================================
// Posts a Client Preferences summary to Pipedrive as a Note on the
// client's Organization (or Deal). Reads PIPEDRIVE_API_TOKEN and
// (optionally) PIPEDRIVE_DOMAIN (e.g. "kabi" for kabi.pipedrive.com).
//
// POST { orgId?, dealId?, personId?, note }  -> creates a note
// The app calls this automatically after a preferences submission.
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: false, error: 'POST only' });

  var token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) return res.status(200).json({ ok: false, error: 'PIPEDRIVE_API_TOKEN not set' });
  var domain = process.env.PIPEDRIVE_DOMAIN || 'api'; // "api" works for most; else your company domain

  try {
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    var note = (body.note || '').toString();
    if (!note) return res.status(200).json({ ok: false, error: 'missing note' });

    var payload = { content: note };
    if (body.orgId)    payload.org_id = body.orgId;
    if (body.dealId)   payload.deal_id = body.dealId;
    if (body.personId) payload.person_id = body.personId;
    if (!payload.org_id && !payload.deal_id && !payload.person_id) {
      return res.status(200).json({ ok: false, error: 'need orgId, dealId, or personId' });
    }

    var base = 'https://' + domain + '.pipedrive.com/api/v1/notes?api_token=' + encodeURIComponent(token);
    var upstream = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await upstream.json();
    if (!upstream.ok || (data && data.success === false)) {
      var msg = (data && data.error) ? data.error : ('Pipedrive error ' + upstream.status);
      return res.status(200).json({ ok: false, error: msg });
    }
    return res.status(200).json({ ok: true, id: data && data.data && data.data.id });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
};
