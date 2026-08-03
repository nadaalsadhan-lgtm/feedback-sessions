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

    // ---- Build per-team routing summaries ----
    var routing = buildRouting(record);

    // ---- Auto-post to Pipedrive (if this client has a Pipedrive ID) ----
    var pipedriveResult = null;
    try {
      var pdId = await clientPipedriveId(url, hdr, name);
      if (pdId) {
        var noteHtml = pipedriveNote(record, routing);
        var proto = (req.headers['x-forwarded-proto'] || 'https');
        var host = req.headers['host'];
        var origin = proto + '://' + host;
        var pdResp = await fetch(origin + '/api/pipedrive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId: Number(pdId) || undefined, note: noteHtml })
        });
        pipedriveResult = await pdResp.json();
      }
    } catch (e) { pipedriveResult = { ok: false, error: e.message }; }

    return res.status(200).json({ ok: true, routing: routing, pipedrive: pipedriveResult });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// Look up a client's Pipedrive org id from the managed clients list.
async function clientPipedriveId(url, hdr, name) {
  try {
    var r = await fetch(url + '/get/clients:list', hdr);
    var d = await r.json();
    if (!d || !d.result) return '';
    var list = JSON.parse(d.result) || [];
    var match = list.find(function (c) { return (c.name || '').toLowerCase() === name.toLowerCase(); });
    return match && match.pipedriveId ? match.pipedriveId : '';
  } catch (e) { return ''; }
}

// Rule-based routing: decide which teams care about which answers.
function buildRouting(p) {
  var teams = {};
  // Marketing: social announcement
  if (p.socialOk) {
    teams.marketing = {
      trigger: 'Social announcement: ' + p.socialOk,
      flag: /^yes/i.test(p.socialOk) ? 'APPROVED to announce' : (/^no/i.test(p.socialOk) ? 'DO NOT announce' : 'Discuss before announcing'),
      details: 'Client "' + p.client + '" answered "' + p.socialOk + '" to announcing the partnership on social media.'
    };
  }
  // Account team: goals, success, comms, cadence
  teams.account = {
    trigger: 'New client preferences submitted',
    details: [
      p.goals ? ('Goals: ' + p.goals) : '',
      p.success ? ('Success (3–6mo): ' + p.success) : '',
      p.commTool ? ('Preferred tool: ' + p.commTool) : '',
      p.commLanguage ? ('Language: ' + p.commLanguage) : '',
      p.cadence ? ('Cadence: ' + p.cadence) : '',
      p.detailLevel ? ('Detail level: ' + p.detailLevel) : ''
    ].filter(Boolean).join('\n')
  };
  // Delivery/Ops: challenges, frustrations, the one thing
  if (p.challenge || p.frustration || p.oneThing) {
    teams.delivery = {
      trigger: 'Experience signals to watch',
      details: [
        p.challenge ? ('Biggest challenge: ' + p.challenge) : '',
        p.frustration ? ('Frustrations: ' + p.frustration) : '',
        p.oneThing ? ('One thing to be exceptional: ' + p.oneThing) : ''
      ].filter(Boolean).join('\n')
    };
  }
  return teams;
}

// Format the Pipedrive note (HTML supported by Pipedrive notes).
function pipedriveNote(p, routing) {
  var lines = [];
  lines.push('<b>Client Preferences — ' + p.client + (p.product ? (' (' + p.product + ')') : '') + '</b>');
  lines.push('');
  if (p.ownerName) lines.push('<b>Project owner:</b> ' + p.ownerName + (p.ownerRole ? (' · ' + p.ownerRole) : ''));
  if (p.ownerEmail || p.ownerPhone) lines.push('<b>Contact:</b> ' + [p.ownerEmail, p.ownerPhone].filter(Boolean).join(' · '));
  lines.push('');
  if (routing.marketing) lines.push('🔵 <b>MARKETING:</b> ' + routing.marketing.flag + ' — ' + routing.marketing.trigger);
  lines.push('');
  lines.push('<b>How they want to work:</b> ' + [p.commTool, p.commLanguage, p.cadence, p.detailLevel].filter(Boolean).join(' · '));
  if (p.updateFormat) lines.push('<b>Updates:</b> ' + p.updateFormat);
  lines.push('');
  if (p.goals) lines.push('<b>Goals:</b> ' + p.goals);
  if (p.success) lines.push('<b>Success (3–6mo):</b> ' + p.success);
  if (p.challenge) lines.push('<b>Biggest challenge:</b> ' + p.challenge);
  if (p.usedSimilar) lines.push('<b>Used similar before:</b> ' + p.usedSimilar);
  if (p.oneThing) lines.push('<b>One exceptional thing:</b> ' + p.oneThing);
  if (p.frustration) lines.push('<b>Frustrations:</b> ' + p.frustration);
  lines.push('');
  lines.push('<i>Submitted ' + new Date(p.submittedAt).toLocaleString() + ' via KABi feedback platform</i>');
  return lines.join('<br>');
}
