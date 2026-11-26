// jonmac.ai/samples (Jon 2026-11-26): one public page with 8 one-minute style samples. Not in any nav, noindex.
// Videos and posters live in R2 (UPLOADS, key samples/<file>); several are over the 25 MiB static-asset limit.
export const SAMPLES_PATH = '/samples';
export const SAMPLES = ['jay', 'nick', 'duncan', 'jack', 'chase', 'joseph', 'zane', 'robo'];

const FILE_RE = new RegExp(`^/sample-(${SAMPLES.join('|')})-v2\\.(mp4|jpg)$`);
const TYPES = { mp4: 'video/mp4', jpg: 'image/jpeg' };
const label = (n) => `Style: ${n[0].toUpperCase()}${n.slice(1)}`;

function page() {
  const cards = SAMPLES.map((n) => `    <figure class="card">
      <video controls preload="metadata" playsinline poster="${SAMPLES_PATH}/sample-${n}-v2.jpg">
        <source src="${SAMPLES_PATH}/sample-${n}-v2.mp4" type="video/mp4">
      </video>
      <figcaption>${label(n)}</figcaption>
    </figure>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Samples</title>
<style>
  :root { --bg: #f5f7fa; --fg: #11142d; --primary: #47a8df; --border: #e4e4e4; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 1200px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { margin: 0 0 24px; font-size: 28px; font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); gap: 20px; }
  .card { margin: 0; background: #fff; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
  figcaption { padding: 12px 16px; font-weight: 600; font-size: 16px; }
  figcaption::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 10px; border-radius: 50%; background: var(--primary); vertical-align: middle; }
</style>
</head>
<body>
<main>
  <h1>Samples</h1>
  <div class="grid">
${cards}
  </div>
</main>
</body>
</html>
`;
}

export async function handleSamples(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const path = new URL(request.url).pathname;
  if (path === SAMPLES_PATH || path === `${SAMPLES_PATH}/`) {
    return new Response(request.method === 'HEAD' ? null : page(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  const file = path.slice(SAMPLES_PATH.length);
  if (!FILE_RE.test(file) || !env.UPLOADS) return new Response('Not found', { status: 404 });
  return serveObject(request, env, `samples${file}`, TYPES[file.split('.').pop()]);
}

// GET and HEAD with one byte range, so the mp4s seek and play on iPhone (same parsing as prooffiles.js).
async function serveObject(request, env, key, type) {
  const m = request.method === 'GET' && /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('Range') || '').trim());
  const want = !m || (m[1] === '' && m[2] === '') || (m[1] !== '' && m[2] !== '' && +m[2] < +m[1]) ? null
    : m[1] === '' ? { suffix: +m[2] } : { offset: +m[1], ...(m[2] !== '' ? { length: +m[2] - +m[1] + 1 } : {}) };
  let obj;
  try {
    obj = request.method === 'HEAD' || want?.suffix === 0 ? await env.UPLOADS.head(key) : await env.UPLOADS.get(key, want ? { range: want } : {});
  } catch (err) {
    if (want) return new Response('Range not satisfiable', { status: 416 });
    console.error('samples read failed', err);
    return new Response('Storage failed; try again', { status: 502 });
  }
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(obj.size),
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (want) {
    const offset = 'suffix' in want ? Math.max(0, obj.size - want.suffix) : want.offset;
    const length = Math.min('suffix' in want ? obj.size - offset : want.length ?? obj.size - offset, obj.size - offset);
    if (length <= 0) return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${obj.size}` } });
    headers['Content-Length'] = String(length);
    headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${obj.size}`;
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}
