// Proof files (bots/DASH.md "Proof files"): a bot uploads one file with its token and gets back an https link
// anyone can open, so QC and Jon never get a GPU1 path. The name is 128 random bits, so it can't be guessed.
// Upload: POST /dashboard/api/v1/files?name=<file name>, raw bytes, Content-Length required.
// Read:   GET  /dashboard/f/<32 hex>.<ext>, no sign-in. Stored in the UPLOADS R2 bucket under proofs/.
import { botOf } from './bots.js';

const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf', mp4: 'video/mp4',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8',
};
// Workers take request bodies up to 100 MB. Longer renders go through review_publish.mjs (multipart).
export const PROOF_MAX = 95 * 1024 * 1024;
export const FILE_PREFIX = '/dashboard/f/';
const NAME_RE = /^[0-9a-f]{32}\.(png|jpe?g|pdf|mp4|txt|md|json)$/;

const out = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function uploadProofFile(request, env) {
  if (request.method !== 'POST') return out({ ok: false, error: 'Use POST' }, 405);
  const bot = await botOf(request, env.DB);
  if (!bot) return out({ ok: false, error: 'Unauthorized' }, 401);
  if (!env.UPLOADS) return out({ ok: false, error: 'File storage is not set up here' }, 503);
  const name = new URL(request.url).searchParams.get('name') || '';
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  if (!TYPES[ext]) return out({ ok: false, error: `Not a proof file type: ${Object.keys(TYPES).join(', ')}` }, 415);
  const raw = request.headers.get('Content-Length');
  if (raw === null || !/^\d+$/.test(raw)) return out({ ok: false, error: 'Content-Length is required' }, 411);
  const size = Number(raw);
  if (size === 0 || !request.body) return out({ ok: false, error: 'The file is empty' }, 400);
  if (size > PROOF_MAX) return out({ ok: false, error: 'Over 95 MB: publish renders with review_publish.mjs' }, 413);
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const file = `${id}.${ext === 'jpeg' ? 'jpg' : ext}`;
  // A body with a known length streams straight to R2 (no 95 MB copy in memory).
  try {
    await env.UPLOADS.put(`proofs/${file}`, request.body, {
      httpMetadata: { contentType: TYPES[ext] },
      customMetadata: { bot, name: name.slice(-200) },
    });
  } catch (err) {
    console.error('proof file put failed', err);
    return out({ ok: false, error: 'Storage failed; try again' }, 502);
  }
  return out({ ok: true, url: `${new URL(request.url).origin}${FILE_PREFIX}${file}`, bytes: size });
}

// GET and HEAD, with byte ranges so an mp4 plays on iPhone and seeks on desktop.
export async function serveProofFile(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not found', { status: 404 });
  const file = new URL(request.url).pathname.slice(FILE_PREFIX.length);
  if (!NAME_RE.test(file) || !env.UPLOADS) return new Response('Not found', { status: 404 });
  const key = `proofs/${file}`;
  // We parse the Range ourselves: real R2's object.range doesn't always echo usable numbers.
  // One "bytes=a-b", "bytes=a-" or "bytes=-n" range; anything else is ignored and the whole file is sent.
  const m = request.method === 'GET' && /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('Range') || '').trim());
  const want = !m || (m[1] === '' && m[2] === '') || (m[1] !== '' && m[2] !== '' && +m[2] < +m[1]) ? null
    : m[1] === '' ? { suffix: +m[2] } : { offset: +m[1], ...(m[2] !== '' ? { length: +m[2] - +m[1] + 1 } : {}) };
  const ranged = !!want;
  let obj;
  try {
    obj = request.method === 'HEAD' || want?.suffix === 0 ? await env.UPLOADS.head(key) : await env.UPLOADS.get(key, ranged ? { range: want } : {});
  } catch (err) {
    if (ranged) return new Response('Range not satisfiable', { status: 416 }); // R2 throws on a range past the end
    console.error('proof file read failed', err);
    return new Response('Storage failed; try again', { status: 502 });
  }
  if (!obj) return new Response('Not found', { status: 404 });
  const ext = file.split('.').pop();
  const headers = {
    'Content-Type': TYPES[ext],
    'Accept-Ranges': 'bytes',
    'Content-Length': String(obj.size),
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  };
  // Text never runs as a page (Chrome's PDF viewer won't open under a sandbox, so only text gets it).
  if (/^(txt|md|json)$/.test(ext)) headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
  if (ranged) {
    const offset = 'suffix' in want ? Math.max(0, obj.size - want.suffix) : want.offset;
    const length = Math.min('suffix' in want ? obj.size - offset : want.length ?? obj.size - offset, obj.size - offset);
    if (length <= 0) return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${obj.size}` } });
    headers['Content-Length'] = String(length);
    headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${obj.size}`;
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}
