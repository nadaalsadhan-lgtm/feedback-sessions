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
      list.push({ name: name, group: group });
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
      list[idx] = { name: newName, group: g };
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
