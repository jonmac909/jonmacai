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
  await env.UPLOADS.put(`proofs/${file}`, request.body, {
    httpMetadata: { contentType: TYPES[ext] },
    customMetadata: { bot, name: name.slice(-200) },
  });
  return out({ ok: true, url: `${new URL(request.url).origin}${FILE_PREFIX}${file}`, bytes: size });
}

export async function serveProofFile(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not found', { status: 404 });
  const file = new URL(request.url).pathname.slice(FILE_PREFIX.length);
  const obj = NAME_RE.test(file) && env.UPLOADS ? await env.UPLOADS.get(`proofs/${file}`) : null;
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    headers: {
      'Content-Type': TYPES[file.split('.').pop()],
      'Content-Length': String(obj.size),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
