// api/groq.js
// ============================================================
// Proxy to the Groq chat-completions API (OpenAI-compatible).
// Reads GROQ_API_KEY from Vercel env vars.
//
// *** ADMIN-ONLY: every request must carry the admin password. ***
// (Called by the dashboard's session analysis + AI agent, which
//  send the password via the login snippet's fetch wrapper.)
// ============================================================
var auth = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // --- admin gate: nothing below runs without the correct password ---
  if (!auth.check(req, res)) return;

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
