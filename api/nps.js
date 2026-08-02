// api/nps.js
// ============================================================
// Records a one-click NPS rating (0-10) from the KABi email.
// Stored the SAME way as onboarding, but with metric = "nps",
// so /api/ratings and the dashboard already understand it.
//
// Link format:
//   /api/nps?client=SNB&product=KABi&score=9&token=SNB
//
// After recording:
//   - Promoter (9-10)   -> simple thank-you
//   - Passive  (7-8)    -> thank-you + follow-up ("what would make it a 10?")
//   - Detractor (0-6)   -> thank-you + follow-up ("what would improve your experience?")
// Follow-up posts to /api/feedback with metric "nps".
// ============================================================

const KABI_BLUE = '#216AB1';
const KABI_TURQUOISE = '#1EAFD9';
const KABI_TOPAZ = '#0EB3AE';
const KABI_METEORITE = '#3D3185';

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const client = q.client;
  const product = q.product || '';
  const metric = 'nps';
  const scoreRaw = q.score;
  const token = q.token || '';

  const n = parseInt(scoreRaw, 10);
  if (!client || isNaN(n) || n < 0 || n > 10) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(simplePage('Invalid link', 'Please use the buttons in the email.'));
  }

  // category
  var category = (n >= 9) ? 'promoter' : (n >= 7) ? 'passive' : 'detractor';

  const record = {
    client: client,
    product: product,
    metric: metric,
    score: String(n),      // "0".."10"
    value: n,              // numeric 0..10
    category: category,
    token: token,
    ratedAt: new Date().toISOString()
  };

  try {
    const url = process.env.KV_REST_API_URL;
    const authToken = process.env.KV_REST_API_TOKEN;
    if (url && authToken) {
      const payload = encodeURIComponent(JSON.stringify(record));
      await fetch(url + '/set/rating:' + client + ':' + metric + '/' + payload, {
        headers: { Authorization: 'Bearer ' + authToken }
      });
      await fetch(url + '/lpush/ratings:log/' + payload, {
        headers: { Authorization: 'Bearer ' + authToken }
      });
      // A new NPS score supersedes any old follow-up comment for this client.
      await fetch(url + '/del/comment:' + client + ':' + metric, {
        headers: { Authorization: 'Bearer ' + authToken }
      });
    } else {
      console.error('Upstash env vars not set');
    }
  } catch (err) {
    console.error('Redis write failed:', err.message);
  }

  res.setHeader('Content-Type', 'text/html');

  if (category === 'promoter') {
    return res.status(200).send(simplePage('Thank you!', 'Thank you for your feedback — it means a lot.'));
  } else {
    var prompt = (category === 'passive')
      ? 'Thank you! What would make your experience with us a 10?'
      : 'Thank you! What would most improve your experience with us?';
    return res.status(200).send(followUpPage(client, product, String(n), token, prompt));
  }
};

function simplePage(title, body) {
  return shell('<div class="tick">&#10003;</div><h1>' + title + '</h1><p>' + body + '</p>');
}

function followUpPage(client, product, score, token, promptText) {
  var inner =
    '<div class="tick">&#10003;</div>' +
    '<div id="ask">' +
      '<h1>Thank you!</h1>' +
      '<p>' + promptText + '</p>' +
      '<form id="fbform" onsubmit="return submitFb(event)">' +
        '<textarea id="comment" rows="4" placeholder="Your feedback (optional)" ' +
          'style="width:100%;box-sizing:border-box;border:1.5px solid #d5dde5;border-radius:10px;padding:12px;font-size:14px;font-family:Arial,sans-serif;resize:vertical;"></textarea>' +
        '<button type="submit" class="btn" style="margin-top:14px;border:none;cursor:pointer;">Send feedback</button>' +
      '</form>' +
    '</div>' +
    '<div id="done" style="display:none;"><h1>Thank you!</h1><p>Your feedback has been received.</p></div>' +
    '<script>' +
      'function submitFb(e){e.preventDefault();' +
        'var c=document.getElementById("comment").value;' +
        'var body={client:' + JSON.stringify(client) + ',product:' + JSON.stringify(product) +
                  ',score:' + JSON.stringify(score) + ',token:' + JSON.stringify(token) + ',metric:"nps",comment:c};' +
        'fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})' +
          '.then(function(){document.getElementById("ask").style.display="none";document.getElementById("done").style.display="block";})' +
          '.catch(function(){document.getElementById("ask").style.display="none";document.getElementById("done").style.display="block";});' +
        'return false;}' +
    '</script>';
  return shell(inner);
}

function shell(innerHtml) {
  return '<!DOCTYPE html>'
    + '<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>KABi</title><style>'
    + 'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;'
    + 'display:flex;align-items:center;justify-content:center;min-height:100vh;}'
    + '.card{background:#fff;max-width:460px;width:90%;border-radius:14px;overflow:hidden;'
    + 'box-shadow:0 6px 24px rgba(0,0,0,.08);}'
    + '.head{background:#ffffff;padding:26px 24px;text-align:center;border-bottom:2px solid ' + KABI_TURQUOISE + ';}'
    + '.body{padding:30px 28px;text-align:center;}'
    + '.tick{width:60px;height:60px;border-radius:50%;background:' + KABI_TOPAZ + ';'
    + 'margin:0 auto 16px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px;}'
    + 'h1{color:' + KABI_BLUE + ';font-size:22px;margin:0 0 8px;}'
    + 'p{color:#333;font-size:15px;line-height:1.6;margin:0 0 18px;}'
    + '.foot{background:' + KABI_METEORITE + ';color:#fff;font-size:12px;text-align:center;padding:14px;}'
    + '.btn{display:inline-block;background:' + KABI_TURQUOISE + ';color:#fff;text-decoration:none;'
    + 'font-weight:bold;padding:12px 26px;border-radius:8px;font-size:14px;}'
    + '</style></head><body>'
    + '<div class="card"><div class="head"><img src="https://feedback-sessions.vercel.app/KABi_Logo.png" alt="KABi" width="120" style="width:120px;height:auto;display:block;margin:0 auto;"></div>'
    + '<div class="body">' + innerHtml + '</div>'
    + '<div class="foot">KABi &bull; Continuously improving your experience</div>'
    + '</div></body></html>';
}
