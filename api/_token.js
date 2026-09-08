// api/_token.js
// ============================================================
// Per-client signed link token. Not an endpoint — a helper.
//
// A client's link looks like:
//   preferences.html?client=Sirar%20by%20STC&t=<token>
//
// token = HMAC-SHA256(LINK_SECRET, normalizedClientName)
//
// Because outsiders don't know LINK_SECRET, they can't forge a
// token for any other client name — so editing the ?client= value
// to reach a different client fails the check.
//
// LINK_SECRET is a long random string set in Vercel env vars.
// ============================================================

var crypto = require('crypto');

// Must match how keys are normalized elsewhere: trim + lowercase.
function normName(name) {
  return String(name || '').trim().toLowerCase();
}

// Derive the token for a given client name.
function tokenFor(name) {
  var secret = process.env.LINK_SECRET;
  if (!secret) return null; // caller must handle (fail closed)
  return crypto.createHmac('sha256', secret).update(normName(name)).digest('hex');
}

function timingSafeHex(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (e) {
    return false;
  }
}

// Verify a request's (client, token) pair for a client-facing endpoint.
// Reads client name + token from body first, then query string.
// If invalid, sends 403 and returns false — caller should `return`.
function check(req, res) {
  var secret = process.env.LINK_SECRET;
  if (!secret) {
    res.status(500).json({ ok: false, error: 'LINK_SECRET not set on server' });
    return false;
  }

  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var q = req.query || {};

  var name = body.client || body.name || q.client || q.name || '';
  var tok  = body.t || body.token || q.t || q.token || '';

  var expected = tokenFor(name);
  if (expected && timingSafeHex(tok, expected)) return true;

  res.status(403).json({ ok: false, error: 'invalid or missing link token' });
  return false;
}

module.exports = { tokenFor: tokenFor, check: check, normName: normName };
