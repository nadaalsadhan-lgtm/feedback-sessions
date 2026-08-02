// api/transcribe.js
// ============================================================
// High-quality speech-to-text via Groq Whisper.
// Hardened: ALWAYS returns JSON (never an HTML crash page),
// so the client can handle failures gracefully.
// Reads GROQ_API_KEY. POST { audio: "<base64>", mimeType }.
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: false, error: 'POST only' });

  try {
    var apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(200).json({ ok: false, error: 'GROQ_API_KEY not set' });

    // Body may arrive parsed or as a raw string depending on Vercel config.
    var body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); }
      catch (e) {
        // read the raw stream as a fallback
        body = await readJsonBody(req);
      }
    }
    body = body || {};

    var b64 = body.audio || '';
    var mimeType = body.mimeType || 'audio/webm';
    if (!b64) return res.status(200).json({ ok: false, error: 'missing audio' });

    var comma = b64.indexOf(',');
    if (b64.slice(0, 5) === 'data:' && comma !== -1) b64 = b64.slice(comma + 1);

    var audioBuffer;
    try { audioBuffer = Buffer.from(b64, 'base64'); }
    catch (e) { return res.status(200).json({ ok: false, error: 'bad base64' }); }
    if (!audioBuffer || !audioBuffer.length) return res.status(200).json({ ok: false, error: 'empty audio' });

    var ext = mimeType.indexOf('mp4') !== -1 ? 'mp4'
            : mimeType.indexOf('mpeg') !== -1 ? 'mp3'
            : mimeType.indexOf('wav') !== -1 ? 'wav'
            : mimeType.indexOf('ogg') !== -1 ? 'ogg'
            : 'webm';
    var filename = 'audio.' + ext;
    var boundary = '----kabiform' + Date.now();
    var CRLF = '\r\n';

    function field(name, value) {
      return Buffer.from('--' + boundary + CRLF
        + 'Content-Disposition: form-data; name="' + name + '"' + CRLF + CRLF
        + value + CRLF, 'utf8');
    }
    var fileHeader = Buffer.from('--' + boundary + CRLF
      + 'Content-Disposition: form-data; name="file"; filename="' + filename + '"' + CRLF
      + 'Content-Type: ' + mimeType + CRLF + CRLF, 'utf8');
    var fileFooter = Buffer.from(CRLF, 'utf8');
    var closing = Buffer.from('--' + boundary + '--' + CRLF, 'utf8');

    var multipartBody = Buffer.concat([
      field('model', 'whisper-large-v3-turbo'),
      field('response_format', 'json'),
      field('temperature', '0'),
      fileHeader, audioBuffer, fileFooter,
      closing
    ]);

    var upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'multipart/form-data; boundary=' + boundary
      },
      body: multipartBody
    });

    var textResp = await upstream.text();
    var data;
    try { data = JSON.parse(textResp); } catch (e) { data = null; }

    if (!upstream.ok) {
      var em = (data && data.error && data.error.message) ? data.error.message : ('Groq error ' + upstream.status);
      return res.status(200).json({ ok: false, error: em });
    }
    return res.status(200).json({ ok: true, text: (data && data.text) ? data.text : '' });

  } catch (err) {
    // Never crash into an HTML page — always JSON.
    return res.status(200).json({ ok: false, error: (err && err.message) ? err.message : 'transcribe failed' });
  }
};

// Fallback raw-body reader
function readJsonBody(req) {
  return new Promise(function (resolve) {
    var data = '';
    req.on('data', function (c) { data += c; });
    req.on('end', function () { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', function () { resolve({}); });
  });
}
