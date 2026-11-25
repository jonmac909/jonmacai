// One-word video links from data (2026-11-24): bots register a word for a new video with
//   POST /track/api/words  Authorization: Bearer <LINK_REGISTER_TOKEN>  {"word":"neon","title":"Gemini 4 Neon","youtube_url":"..."}
// and get its six links (jonmac.ai/<word>, <word>x, <word>li, <word>fb, <word>ig, <word>tt). GET lists every word.
// The word is stored in D1 skool_words and gets a "jonmac.ai/<word>*" route (re-made after a deploy by syncSlugRoutes).
// Secret LINK_REGISTER_TOKEN (D:\AgentTeam\secrets\link-register.token on GPU1); unset = the endpoint refuses (503).
import { timingSafeEqualString } from './auth.js';
import { YT_RE } from './skool.js';
import {
  WORD_RE, SHORT_LINKS, SHORT_PLATFORMS, SOCIAL_SLUGS, OTHER_ROUTES, HOST, SCRIPT,
  loadWords, videoLinks, listRoutes, slugRefusal, ensureSlugRoute, wordPattern,
} from './skoolroutes.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
const no = (error, status) => json({ ok: false, error }, status);
const SUFFIXES = Object.keys(SHORT_PLATFORMS);
const CREATE = 'CREATE TABLE IF NOT EXISTS skool_words (word TEXT PRIMARY KEY, title TEXT NOT NULL, youtube_url TEXT, created_at TEXT NOT NULL)';

// Another worker's route whose path starts with /<word> would be swallowed by the word's wildcard.
function routeUnder(routes, word) {
  for (const r of [...OTHER_ROUTES, ...(routes || [])]) {
    if (!r?.pattern || r.script === SCRIPT || r.pattern === `${HOST}/*`) continue;
    if (r.pattern.startsWith(`${HOST}/${word}`)) return r.pattern;
  }
  return null;
}

// Why the word can't be registered, or null. words = the merged list (seed + D1).
export async function wordRefusal(env, word, words, routes) {
  if (!WORD_RE.test(word)) return 'Word: 2 to 31 lower-case letters or numbers, starting with a letter, no dashes';
  const social = SOCIAL_SLUGS.find((s) => word.startsWith(s));
  if (social) return `"${word}" starts with "${social}", which is already a social link`;
  for (const w of Object.keys(words)) {
    if (w === word) return `"${word}" is already a word`;
    if (word.startsWith(w) || w.startsWith(word)) return `"${word}" overlaps the word "${w}"`;
  }
  const under = routeUnder(routes, word);
  if (under) return `"${word}" would cover another app on jonmac.ai (${under})`;
  for (const suffix of SUFFIXES) {
    const slug = word + suffix;
    if (env.DB && await env.DB.prepare('SELECT 1 FROM skool_links WHERE slug = ?').bind(slug).first()) return `jonmac.ai/${slug} is already a /track link`;
    const why = await slugRefusal(env, slug, routes);
    if (why) return why;
  }
  return null;
}

function authFail(request, env) {
  if (!env.LINK_REGISTER_TOKEN) return no('Link registration is switched off (LINK_REGISTER_TOKEN not set)', 503);
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m || !timingSafeEqualString(m[1], env.LINK_REGISTER_TOKEN)) return no('Bad or missing token', 401);
  return null;
}

export async function wordsApi(request, env, nowMs = Date.now()) {
  const fail = authFail(request, env);
  if (fail) return fail;
  if (!env.DB) return no('Database missing', 503);
  if (request.method === 'GET') {
    const words = await loadWords(env.DB);
    let made = {};
    try { made = Object.fromEntries(((await env.DB.prepare('SELECT word, created_at FROM skool_words').all()).results || []).map((r) => [r.word, r.created_at])); } catch { /* no table yet */ }
    const list = Object.entries(words).map(([word, w]) => ({ word, title: w.title, youtube_url: w.youtube_url || null, builtin: Object.hasOwn(SHORT_LINKS, word), created_at: made[word] || null, links: videoLinks(word, words) }));
    return json({ ok: true, words: list });
  }
  if (request.method !== 'POST') return no('Method not allowed', 405);
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return no('Body must be JSON: {"word","title","youtube_url"}', 400);
  const word = String(b.word ?? '').trim().toLowerCase();
  const title = String(b.title ?? '').trim().slice(0, 200);
  const yt = String(b.youtube_url ?? '').trim();
  if (!WORD_RE.test(word)) return no('Word: 2 to 31 lower-case letters or numbers, starting with a letter, no dashes', 400);
  if (!title) return no('Title is required', 400);
  if (yt && !YT_RE.test(yt)) return no('YouTube URL must be a youtube.com or youtu.be video link', 400);
  const words = await loadWords(env.DB);
  if (Object.hasOwn(words, word)) {
    if (words[word].title !== title) return no(`"${word}" is already the word for "${words[word].title}"`, 409);
    return json({ ok: true, word, created: false, links: videoLinks(word, words) });
  }
  const routes = await listRoutes(env);
  const why = await wordRefusal(env, word, words, routes);
  if (why) return no(why, 409);
  await env.DB.prepare(CREATE).run();
  const r = await env.DB.prepare('INSERT OR IGNORE INTO skool_words (word, title, youtube_url, created_at) VALUES (?, ?, ?, ?)')
    .bind(word, title, yt || null, new Date(nowMs).toISOString()).run();
  if (!r.meta?.changes) { // a parallel register won the race
    const row = await env.DB.prepare('SELECT title FROM skool_words WHERE word = ?').bind(word).first();
    if (row?.title !== title) return no(`"${word}" is already the word for "${row?.title}"`, 409);
    return json({ ok: true, word, created: false, links: videoLinks(word, { [word]: row }) });
  }
  const { route, warning } = await ensureSlugRoute(env, word, routes, wordPattern(word));
  return json({ ok: true, word, created: true, links: videoLinks(word, { [word]: { title } }), route, ...(warning ? { warning } : {}) }, 201);
}
