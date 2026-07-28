// api/rate.js
// ============================================================
// Records a one-click onboarding rating from the KABi email.
// Storage: Upstash Redis via REST (env: KV_REST_API_URL / KV_REST_API_TOKEN).
//
// After recording:
//   - score "easy"      -> simple thank-you page
//   - score "neutral"   -> thank-you + follow-up question form
//   - score "difficult" -> thank-you + follow-up question form
// The follow-up form posts the comment to /api/feedback.
// ============================================================

const KABI_BLUE = '#216AB1';
const KABI_TURQUOISE = '#1EAFD9';
const KABI_TOPAZ = '#0EB3AE';
const KABI_METEORITE = '#3D3185';

const VALID = { easy: 3, neutral: 2, difficult: 1 };

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const client = q.client;
  const product = q.product || '';
  const metric = q.metric || 'onboarding_effort';
  const score = q.score;
  const token = q.token || '';

  if (!client || !score || !(score in VALID)) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(simplePage('Invalid link', 'Please use the buttons in the email.'));
  }

  const record = {
    client: client,
    product: product,
    metric: metric,
    score: score,
    value: VALID[score],
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
    } else {
      console.error('Upstash env vars not set');
    }
  } catch (err) {
    console.error('Redis write failed:', err.message);
  }

  res.setHeader('Content-Type', 'text/html');

  // Easy -> simple thank-you. Neutral/Difficult -> follow-up form.
  if (score === 'easy') {
    return res.status(200).send(simplePage('Thank you!', 'Your onboarding feedback has been recorded.'));
  } else {
    return res.status(200).send(followUpPage(client, product, score, token));
  }
};

// ---------- simple thank-you page ----------
function simplePage(title, body) {
  return shell(
    '<div class="tick">&#10003;</div>' +
    '<h1>' + title + '</h1>' +
    '<p>' + body + '</p>'
  );
}

// ---------- thank-you + follow-up question ----------
function followUpPage(client, product, score, token) {
  // Hidden fields carry context so the comment is saved against the right client.
  var inner =
    '<div class="tick">&#10003;</div>' +
    '<h1>Thank you!</h1>' +
    '<p>Your rating has been recorded. Could you tell us what would have made onboarding smoother?</p>' +
    '<form id="fbform" onsubmit="return submitFb(event)">' +
      '<textarea id="comment" rows="4" placeholder="Your feedback (optional)" ' +
        'style="width:100%;box-sizing:border-box;border:1.5px solid #d5dde5;border-radius:10px;padding:12px;font-size:14px;font-family:Arial,sans-serif;resize:vertical;"></textarea>' +
      '<button type="submit" class="btn" style="margin-top:14px;border:none;cursor:pointer;">Send feedback</button>' +
    '</form>' +
    '<div id="done" style="display:none;margin-top:8px;color:' + KABI_TOPAZ + ';font-weight:bold;">Thank you — received!</div>' +
    '<script>' +
      'function submitFb(e){e.preventDefault();' +
        'var c=document.getElementById("comment").value;' +
        'var body={client:' + JSON.stringify(client) + ',product:' + JSON.stringify(product) +
                  ',score:' + JSON.stringify(score) + ',token:' + JSON.stringify(token) + ',comment:c};' +
        'fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})' +
          '.then(function(){document.getElementById("fbform").style.display="none";' +
            'document.getElementById("done").style.display="block";})' +
          '.catch(function(){document.getElementById("fbform").style.display="none";' +
            'document.getElementById("done").style.display="block";});' +
        'return false;}' +
    '</script>';
  return shell(inner);
}

// ---------- shared page shell ----------
function shell(innerHtml) {
  return '<!DOCTYPE html>'
    + '<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>KABi</title><style>'
    + 'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;'
    + 'display:flex;align-items:center;justify-content:center;min-height:100vh;}'
    + '.card{background:#fff;max-width:460px;width:90%;border-radius:14px;overflow:hidden;'
    + 'box-shadow:0 6px 24px rgba(0,0,0,.08);}'
    + '.head{background:' + KABI_BLUE + ';color:#fff;padding:24px;text-align:center;'
    + 'font-size:22px;font-weight:bold;letter-spacing:.5px;}'
    + '.body{padding:30px 28px;text-align:center;}'
    + '.tick{width:60px;height:60px;border-radius:50%;background:' + KABI_TOPAZ + ';'
    + 'margin:0 auto 16px;display:flex;align-items:center;justify-content:center;'
    + 'color:#fff;font-size:32px;}'
    + 'h1{color:' + KABI_BLUE + ';font-size:22px;margin:0 0 8px;}'
    + 'p{color:#333;font-size:15px;line-height:1.6;margin:0 0 18px;}'
    + '.foot{background:' + KABI_METEORITE + ';color:#fff;font-size:12px;text-align:center;padding:14px;}'
    + '.btn{display:inline-block;background:' + KABI_TURQUOISE + ';color:#fff;text-decoration:none;'
    + 'font-weight:bold;padding:12px 26px;border-radius:8px;font-size:14px;}'
    + '</style></head><body>'
    + '<div class="card"><div class="head">KABi</div>'
    + '<div class="body">' + innerHtml + '</div>'
    + '<div class="foot">KABi &bull; Continuously improving your experience</div>'
    + '</div></body></html>';
}
