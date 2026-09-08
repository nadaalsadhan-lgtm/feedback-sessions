// api/_auth.js
// ============================================================
// Shared ADMIN password gate. Not an endpoint — a helper other
// api functions import. Underscore prefix keeps Vercel from
// treating it as its own serverless function.
//
// Usage at the top of an admin function's handler:
//   var auth = require('./_auth');
//   if (!auth.check(req, res)) return;   // 401 already sent
//
// The password is read from the ADMIN_PASSWORD env var (set in
// Vercel project settings — NEVER hardcode it, the repo is public).
//
// The client sends the password in the "x-admin-password" header
// (added by the admin dashboard's login snippet).
// ============================================================

function timingSafeEqual(a, b) {
  // constant-time-ish compare so we don't leak length/character info
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  var out = 0;
  for (var i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Returns true if the request carries the correct admin password.
// If not, sends a 401 and returns false — caller should `return`.
function check(req, res) {
  var expected = process.env.ADMIN_PASSWORD;

  // Fail closed: if the password isn't configured, deny everything
  // rather than accidentally leaving the gate open.
  if (!expected) {
    res.status(500).json({ ok: false, error: 'ADMIN_PASSWORD not set on server' });
    return false;
  }

  var provided =
    (req.headers && (req.headers['x-admin-password'] || req.headers['X-Admin-Password'])) || '';

  // also allow it in the JSON body as a fallback (some tools strip headers)
  if (!provided && req.body) {
    var b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    if (b && b.adminPassword) provided = b.adminPassword;
  }

  if (timingSafeEqual(provided, expected)) return true;

  res.status(401).json({ ok: false, error: 'unauthorized' });
  return false;
}

module.exports = { check: check };
