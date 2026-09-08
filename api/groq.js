// api/groq.js
// ============================================================
// Proxy to the Groq chat-completions API (OpenAI-compatible).
// Reads GROQ_API_KEY from Vercel env vars.
//
// *** ADMIN-ONLY: gate is INLINED here (no external require) because
//     this endpoint is reached via a custom vercel.json route. ***
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // --- inline admin gate ---
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'ADMIN_PASSWORD not set on server' });
  var provided = (req.headers && (req.headers['x-admin-password'] || req.headers['X-Admin-Password'])) || '';
  if (!provided && req.body) {
    var pb = req.body;
    if (typeof pb === 'string') { try { pb = JSON.parse(pb); } catch (e) { pb = {}; } }
    if (pb && pb.adminPassword) provided = pb.adminPassword;
  }
  function safeEq(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a.length !== b.length) return false;
    var out = 0;
    for (var i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return out === 0;
  }
  if (!safeEq(provided, expected)) return res.status(401).json({ error: 'unauthorized' });
  // --- end gate ---

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not set' });
  try {
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const groqMessages = [];
    if (body.system) groqMessages.push({ role: 'system', content: body.system });
    if (body.messages) groqMessages.push(...body.messages);
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: body.model || 'llama-3.3-70b-versatile', max_tokens: body.max_tokens || 1024, messages: groqMessages }),
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message || 'Groq error' });
    const text = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
