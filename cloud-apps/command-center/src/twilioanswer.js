// Ana phones Jon with a question and he answers on the keypad (2026-11-17).
//   POST /twilio/answer?q=<id>[&n=<options>&r=<retry>&t=<prompt>]  Twilio's <Gather> action. The X-Twilio-Signature is checked with
//        the Twilio auth token (worker secret TWILIO_AUTH_TOKEN) before anything is read or stored. A valid digit (1..n) is stored
//        once; a wrong key repeats the question once (t = the prompt text, covered by the signature because it is in the URL).
//   GET  /twilio/answer/<id>  Ana's script polls it: a dashboard session or a bot token, never open to the public.
import { readSession, timingSafeEqualString } from './auth.js';
import { botOf } from './bots.js';

export const ROUTE = '/twilio/answer';
const Q_RE = /^[0-9a-f]{16,32}$/;
const MAX_FORM = 8 * 1024;
const MAX_PROMPT = 1000;
const enc = new TextEncoder();
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const plain = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...NO_STORE } });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
const twiml = (inner) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { 'Content-Type': 'text/xml; charset=utf-8', ...NO_STORE } });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const VOICE = 'Polly.Matthew';

// Twilio's signature: base64(HMAC-SHA1(authToken, full URL + each POST field as name+value, names sorted)).
export async function twilioSignature(authToken, url, params) {
  const names = [...new Set([...params.keys()])].sort();
  let data = url;
  for (const k of names) for (const v of params.getAll(k).sort()) data += k + v;
  const key = await crypto.subtle.importKey('raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  return btoa(bin);
}

// The question, said again: used for the one repeat after a wrong key.
function gather(action, prompt) {
  const say = `<Say voice="${VOICE}">${esc(prompt)}</Say>`;
  return `<Gather numDigits="1" timeout="10" action="${esc(action)}">${say}</Gather>`;
}

async function postAnswer(request, env) {
  const token = env.TWILIO_AUTH_TOKEN || '';
  if (token.length < 16) return plain('Not configured', 503);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_FORM) return plain('Body too large', 413);
  const raw = await request.text();
  if (raw.length > MAX_FORM) return plain('Body too large', 413);
  const params = new URLSearchParams(raw);
  const url = new URL(request.url);
  const given = request.headers.get('X-Twilio-Signature') || '';
  // The URL Twilio signed is the one it called: https, host, path and query exactly as sent.
  if (!given || !timingSafeEqualString(given, await twilioSignature(token, url.toString(), params))) return plain('Forbidden', 403);

  const q = url.searchParams.get('q') || '';
  if (!Q_RE.test(q)) return plain('Bad question id', 400);
  if (!env.DB) return plain('No database', 503);
  const n = Math.min(Math.max(Number.parseInt(url.searchParams.get('n') || '3', 10) || 3, 1), 9);
  const digits = (params.get('Digits') || '').trim();
  const digit = /^[1-9]$/.test(digits) ? Number(digits) : 0;

  if (digit >= 1 && digit <= n) {
    await env.DB.prepare('INSERT OR IGNORE INTO phone_answers (q, digit, at) VALUES (?, ?, ?)').bind(q, digit, new Date().toISOString()).run();
    return twiml(`<Say voice="${VOICE}">Got it, thanks.</Say>`);
  }
  // A wrong key: repeat the question once, then give up (Ana's script messages Jon instead).
  const prompt = (url.searchParams.get('t') || '').slice(0, MAX_PROMPT);
  if (url.searchParams.get('r') !== '1' && prompt) {
    const next = new URL(url);
    next.searchParams.set('r', '1');
    return twiml(gather(next.toString(), `Sorry, that is not one of the choices. ${prompt}`) + `<Say voice="${VOICE}">I'll message you instead.</Say>`);
  }
  return twiml(`<Say voice="${VOICE}">I'll message you instead.</Say>`);
}

async function getAnswer(request, env, id) {
  if (!Q_RE.test(id)) return json({ error: 'Bad question id' }, 400);
  const who = (await readSession(request, env)) ? 'jon' : await botOf(request, env.DB);
  if (!who) return json({ error: 'Sign in or send a bot token' }, 401);
  const row = await env.DB.prepare('SELECT q, digit, at FROM phone_answers WHERE q = ?').bind(id).first();
  return json(row ? { q: row.q, answered: true, digit: row.digit, at: row.at } : { q: id, answered: false });
}

export async function handleTwilioAnswer(request, env) {
  const path = new URL(request.url).pathname;
  if (path === ROUTE && request.method === 'POST') return postAnswer(request, env);
  if (path.startsWith(`${ROUTE}/`) && request.method === 'GET') return getAnswer(request, env, path.slice(ROUTE.length + 1));
  return plain('Not found', path === ROUTE || path.startsWith(`${ROUTE}/`) ? 405 : 404);
}
