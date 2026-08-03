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
    var pipedriveFields = null;
    try {
      var pdId = await clientPipedriveId(url, hdr, name);
      var pdToken = process.env.PIPEDRIVE_API_TOKEN;
      if (pdId && pdToken) {
        var pdDomain = process.env.PIPEDRIVE_DOMAIN || 'api';

        // 1) Post the note (existing behaviour)
        var noteHtml = pipedriveNote(record, routing);
        var pdPayload = { content: noteHtml, deal_id: Number(pdId) || undefined };
        var pdUrl = 'https://' + pdDomain + '.pipedrive.com/api/v1/notes?api_token=' + encodeURIComponent(pdToken);
        var pdResp = await fetch(pdUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pdPayload)
        });
        var pdData = await pdResp.json();
        pipedriveResult = (pdResp.ok && pdData && pdData.success !== false)
          ? { ok: true, id: pdData.data && pdData.data.id }
          : { ok: false, error: (pdData && pdData.error) || ('Pipedrive error ' + pdResp.status) };

        // 2) Update the two custom fields on the deal
        var fieldUpdate = pipedriveCustomFields(record);
        if (Object.keys(fieldUpdate).length) {
          var dealUrl = 'https://' + pdDomain + '.pipedrive.com/api/v1/deals/' + encodeURIComponent(pdId) + '?api_token=' + encodeURIComponent(pdToken);
          var fResp = await fetch(dealUrl, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fieldUpdate)
          });
          var fData = await fResp.json();
          pipedriveFields = (fResp.ok && fData && fData.success !== false)
            ? { ok: true }
            : { ok: false, error: (fData && fData.error) || ('Pipedrive field error ' + fResp.status) };
        }
      }
    } catch (e) { pipedriveResult = { ok: false, error: e.message }; }

    return res.status(200).json({ ok: true, routing: routing, pipedrive: pipedriveResult, pipedriveFields: pipedriveFields });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// Maps preferences answers -> Pipedrive custom field keys/option IDs.
// Currently only two fields are reflected: Communication Tool + Language.
function pipedriveCustomFields(p) {
  var out = {};

  // Preferred Communication Tool (field_type: set / multiple options)
  // form label -> Pipedrive option id
  var TOOL_KEY = 'ca50cc5ff0eeeb68c65311bff04d97ca540804db';
  var TOOL_MAP = { 'Email':255, 'Phone':256, 'WhatsApp':257, 'Teams':259 }; // Slack intentionally dropped
  if (p.commTool && TOOL_MAP[p.commTool] != null) {
    // "set" fields accept a comma-separated string of option ids
    out[TOOL_KEY] = String(TOOL_MAP[p.commTool]);
  }

  // Preferred Language (field_type: enum / single option)
  var LANG_KEY = '24cd6d24a412932cfc213dbb6a7d6e9a551ae3b5';
  var LANG_MAP = { 'Arabic':253, 'English':254 };
  if (p.commLanguage && LANG_MAP[p.commLanguage] != null) {
    out[LANG_KEY] = LANG_MAP[p.commLanguage];
  }

  return out;
}

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
