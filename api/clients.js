// api/clients.js
// ============================================================
// Manage the client list in Upstash (shared, persists).
// Stored as a single JSON array under key "clients:list".
//
// GET  /api/clients                      -> { ok, clients:[{name,group}] }
// POST /api/clients { action:"add",    name, group }
// POST /api/clients { action:"update", oldName, name, group }
// POST /api/clients { action:"delete", name }
// POST /api/clients { action:"seed",   clients:[...] }   (one-time import)
//
// group is "HYRDD" | "INVIEWS" | "BOTH".
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
  var KEY = 'clients:list';

  async function readClients() {
    var r = await fetch(url + '/get/' + KEY, hdr);
    var d = await r.json();
    if (!d || !d.result) return [];
    try { return JSON.parse(d.result) || []; } catch (e) { return []; }
  }
  async function writeClients(list) {
    var payload = encodeURIComponent(JSON.stringify(list));
    await fetch(url + '/set/' + KEY + '/' + payload, hdr);
  }
  function norm(s){ return (s||'').toString().trim(); }
  function validGroup(g){ return ['HYRDD','INVIEWS','BOTH'].indexOf(g) !== -1 ? g : 'HYRDD'; }

  try {
    if (req.method === 'GET') {
      var clients = await readClients();
      return res.status(200).json({ ok: true, clients: clients });
    }

    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    var action = body.action;
    var list = await readClients();

    // Auto-match clients to Pipedrive deals by name. Returns suggestions
    // for the user to review — does NOT save until confirmed via 'update'.
    if (action === 'matchPipedrive') {
      var pdToken = process.env.PIPEDRIVE_API_TOKEN;
      var pdDomain = process.env.PIPEDRIVE_DOMAIN || 'api';
      if (!pdToken) return res.status(200).json({ ok: false, error: 'PIPEDRIVE_API_TOKEN not set' });

      // 1) Fetch ALL deals once (paginated), across all statuses.
      var allDeals = [];
      var start = 0, more = true, guard = 0;
      while (more && guard < 40) {
        guard++;
        var listUrl = 'https://' + pdDomain + '.pipedrive.com/api/v1/deals'
          + '?status=all_not_deleted&limit=500&start=' + start
          + '&api_token=' + encodeURIComponent(pdToken);
        var lr = await fetch(listUrl);
        var ld = await lr.json();
        var batch = (ld && ld.data) ? ld.data : [];
        for (var b = 0; b < batch.length; b++) {
          if (batch[b] && batch[b].id) allDeals.push({ id: batch[b].id, title: batch[b].title || '' });
        }
        var pg = ld && ld.additional_data && ld.additional_data.pagination;
        if (pg && pg.more_items_in_collection) { start = pg.next_start; } else { more = false; }
      }

      // helper: normalize for comparison (lowercase, strip punctuation/extra spaces)
      function nz(s){
        return String(s||'').toLowerCase()
          .replace(/[()\[\]{}._\-|,،]/g,' ')
          .replace(/\b(company|co|ltd|llc|corp|corporation|holding|group|the|by|kabi|hyrdd|inviews)\b/g,' ')
          .replace(/\s+/g,' ').trim();
      }
      // extract acronym tokens inside parentheses e.g. "... (TDF) (HYRDD)" -> ["tdf","hyrdd"]
      function parenTokens(s){
        var out = [], m, re = /\(([^)]+)\)/g;
        while ((m = re.exec(String(s||'')))) out.push(m[1].toLowerCase().trim());
        return out;
      }

      // 2) Match each client against all deals with several strategies.
      var results = [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var rawName = String(c.name||'').trim();
        var nName = nz(rawName);
        var lowName = rawName.toLowerCase();
        if (!rawName) { results.push({ name: c.name, current: c.pipedriveId||'', match: null, confidence: 'none' }); continue; }

        var scored = [];
        for (var d = 0; d < allDeals.length; d++) {
          var title = allDeals[d].title;
          var nTitle = nz(title);
          var lowTitle = title.toLowerCase();
          var score = 0;

          // strong: exact normalized equality
          if (nName && nTitle === nName) score = 100;
          // strong: acronym appears as its own token in parentheses  e.g. app "TDF" vs "...(TDF)..."
          else if (parenTokens(title).indexOf(lowName) !== -1) score = 95;
          // strong: whole app name appears as a standalone word in title
          else if (nName && new RegExp('(^| )' + nName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '( |$)').test(nTitle)) score = 85;
          // medium: title contains the app name substring
          else if (lowName.length >= 3 && lowTitle.indexOf(lowName) !== -1) score = 70;
          // medium: app name contains the title (title is the short form)
          else if (nTitle.length >= 3 && nName.indexOf(nTitle) !== -1) score = 65;
          else {
            // weak: word-overlap ratio
            var aw = nName.split(' ').filter(Boolean);
            var tw = nTitle.split(' ').filter(Boolean);
            if (aw.length && tw.length) {
              var hit = 0;
              for (var w = 0; w < aw.length; w++) { if (aw[w].length>2 && tw.indexOf(aw[w])!==-1) hit++; }
              var ratio = hit / aw.length;
              if (ratio >= 0.6) score = 40 + Math.round(ratio*20);
            }
          }
          if (score > 0) scored.push({ id: allDeals[d].id, title: title, score: score });
        }

        scored.sort(function(a,b){ return b.score - a.score; });

        if (scored.length) {
          var conf = scored[0].score >= 85 ? 'high' : (scored[0].score >= 65 ? 'medium' : 'low');
          results.push({
            name: c.name, current: c.pipedriveId||'',
            match: { id: scored[0].id, title: scored[0].title },
            confidence: conf,
            alternatives: scored.slice(1,4).map(function(x){ return { id:x.id, title:x.title }; })
          });
        } else {
          results.push({ name: c.name, current: c.pipedriveId||'', match: null, confidence: 'none' });
        }
      }
      return res.status(200).json({ ok: true, results: results, dealCount: allDeals.length });
    }

    // Bulk-save Pipedrive IDs after the user reviews the matches.
    if (action === 'savePipedriveIds') {
      var updates = body.updates || {}; // { "TDF": 584, ... }
      list.forEach(function (c) {
        if (updates[c.name] != null && updates[c.name] !== '') c.pipedriveId = String(updates[c.name]);
      });
      await writeClients(list);
      return res.status(200).json({ ok: true, clients: list });
    }

    if (action === 'seed') {
      // Only seeds if the list is currently empty (won't overwrite existing).
      if (list.length > 0) return res.status(200).json({ ok: true, seeded: false, count: list.length });
      var incoming = Array.isArray(body.clients) ? body.clients : [];
      var cleaned = [];
      var seen = {};
      incoming.forEach(function (c) {
        var nm = norm(c.name); if (!nm) return;
        var key = nm.toLowerCase(); if (seen[key]) return; seen[key] = true;
        cleaned.push({ name: nm, group: validGroup(c.group) });
      });
      await writeClients(cleaned);
      return res.status(200).json({ ok: true, seeded: true, count: cleaned.length });
    }

    if (action === 'add') {
      var name = norm(body.name);
      var group = validGroup(body.group);
      if (!name) return res.status(400).json({ ok: false, error: 'missing name' });
      if (list.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); }))
        return res.status(400).json({ ok: false, error: 'client already exists' });
      list.push({ name: name, group: group, pipedriveId: norm(body.pipedriveId) });
      await writeClients(list);
      return res.status(200).json({ ok: true, clients: list });
    }

    if (action === 'update') {
      var oldName = norm(body.oldName);
      var newName = norm(body.name);
      var g = validGroup(body.group);
      if (!oldName || !newName) return res.status(400).json({ ok: false, error: 'missing name' });
      var idx = list.findIndex(function (c) { return c.name.toLowerCase() === oldName.toLowerCase(); });
      if (idx === -1) return res.status(404).json({ ok: false, error: 'client not found' });
      // prevent collision with a different existing client
      if (newName.toLowerCase() !== oldName.toLowerCase()
          && list.some(function (c) { return c.name.toLowerCase() === newName.toLowerCase(); }))
        return res.status(400).json({ ok: false, error: 'another client already has that name' });
      list[idx] = { name: newName, group: g, pipedriveId: norm(body.pipedriveId) };
      await writeClients(list);
      return res.status(200).json({ ok: true, clients: list, renamedFrom: oldName, renamedTo: newName });
    }

    if (action === 'delete') {
      var dname = norm(body.name);
      if (!dname) return res.status(400).json({ ok: false, error: 'missing name' });
      var next = list.filter(function (c) { return c.name.toLowerCase() !== dname.toLowerCase(); });
      await writeClients(next);

      // Optionally purge this client's feedback data too.
      if (body.purgeData === true) {
        var metrics = ['onboarding_effort', 'nps'];
        for (var i = 0; i < metrics.length; i++) {
          await fetch(url + '/del/rating:' + dname + ':' + metrics[i], hdr);
          await fetch(url + '/del/comment:' + dname + ':' + metrics[i], hdr);
        }
        await fetch(url + '/del/sessions:' + encodeURIComponent(dname), hdr);
      }
      return res.status(200).json({ ok: true, clients: next, purged: body.purgeData === true });
    }

    return res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
