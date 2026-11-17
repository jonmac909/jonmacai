// Email check for the Skool pop-over (Jon, 2026-11-16: "verify every email"). A Worker port of the checks in
// github.com/AfterShip/email-verifier and github.com/umuterturk/email-verifier (both MIT; lists and licence note in src/data/).
// No Go server, no third-party verification API and no SMTP (Workers cannot open port 25). Checks, in order:
//   1. syntax  2. "Did you mean" typo suggestion  3. disposable domain  4. role address (admin@, info@, noreply@ ...)
//   5. the domain can receive mail: MX (or, as a fallback, A/AAAA) over Cloudflare DNS-over-HTTPS, 1.5 s, fails open.
// Result: { ok, check, reason, message, suggestion }. check is what we store per lead:
//   valid = passed everything; suggested = looked like a typo and the visitor kept it; risky = passed but not proven
//   (DNS timed out or the domain only has an A record). A refused email (ok false) is never stored.
import DISPOSABLE from './data/disposable-domains.js';
import FREE from './data/free-domains.js';
import ROLES from './data/role-accounts.js';

export const DOH_URL = 'https://cloudflare-dns.com/dns-query';
export const DNS_TIMEOUT_MS = 1500;
const disposable = new Set(DISPOSABLE.split('\n'));
const freeList = FREE.split('\n');
const free = new Set(freeList);
const roles = new Set(ROLES.split('\n'));

// Upstream suggestion tables (metadata_suggestion.go).
const SLD = new Set(['yahoo', 'hotmail', 'mail', 'live', 'outlook', 'gmx', 'gmail', 'icloud', 'aol']);
const TLD = new Set(['com', 'com.au', 'com.tw', 'ca', 'co.nz', 'co.uk', 'de', 'fr', 'it', 'ru', 'org', 'edu', 'gov', 'jp', 'nl', 'kr', 'se', 'eu', 'ie',
  'co.il', 'us', 'at', 'be', 'dk', 'hk', 'es', 'gr', 'ch', 'no', 'cz', 'in', 'net', 'net.au', 'info', 'biz', 'mil', 'co.jp', 'sg', 'hu', 'uk']);
const MAIN = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'me.com', 'mail.com', 'gmx.com', 'proton.me', 'protonmail.com', 'ymail.com', 'googlemail.com', 'yahoo.co.uk', 'hotmail.co.uk']);
const DOMAIN_THRESHOLD = 0.82, TLD_THRESHOLD = 0.6;

const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function parseEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!email || email.length > 254 || /\s/.test(email)) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL_RE.test(local)) return null;
  try { domain = new URL(`http://${domain}`).hostname; } catch { return null; } // punycode for international names
  const labels = domain.split('.');
  if (domain.length > 253 || labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return null;
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return null; // an IP address is not a mail domain here
  return { local, domain, email: `${local}@${domain}` };
}

export function isDisposable(domain) {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) if (disposable.has(parts.slice(i).join('.'))) return true; // also x.mailinator.com
  return false;
}
export const isRole = (local) => roles.has(local.split('+')[0]);

// Damerau-Levenshtein (adjacent swap counts 1, so gmial.com is one step from gmail.com), as a 0..1 similarity.
function similarity(a, b) {
  const n = Math.max(a.length, b.length);
  if (!n) return 1;
  if (Math.abs(a.length - b.length) / n > 1 - TLD_THRESHOLD) return 0;
  let p2 = null, p1 = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur[j] = v;
    }
    p2 = p1; p1 = cur;
  }
  return 1 - p1[b.length] / n;
}
function closest(word, candidates, threshold) {
  let best = '', top = -1;
  for (const c of candidates) {
    if (c === word) return word;
    const s = similarity(word, c);
    if (s > top) { top = s; best = c; }
  }
  return top >= threshold ? best : '';
}

// "" when the domain looks right, else the domain we think they meant (upstream SuggestDomain, plus swaps).
export function suggestDomain(domain) {
  if (!domain || free.has(domain)) return '';
  const parts = domain.split('.');
  const sld = parts.length >= 2 ? parts[parts.length - 2] : '', tld = parts[parts.length - 1];
  if (sld && SLD.has(sld) && TLD.has(tld)) return '';
  if (sld && SLD.has(sld)) { // hotmail.con, yahoo.cmo: right provider, wrong ending (checked first so it lands on .com, not on a look-alike like hotmail.co)
    const fix = closest(tld, TLD, TLD_THRESHOLD);
    if (fix && fix !== tld) return [...parts.slice(0, -1), fix].join('.');
  }
  const near = closest(domain, freeList, DOMAIN_THRESHOLD);
  if (near && near !== domain) return near;
  return '';
}

// Can this domain receive mail? 'mx' | 'a' (no MX, but an address: mail goes there) | 'none' (nothing, or a null MX) | 'unknown' (DNS failed or timed out).
export async function dnsMail(domain, fetchImpl = fetch, timeoutMs = DNS_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const ask = async (type) => {
    const r = await fetchImpl(`${DOH_URL}?name=${encodeURIComponent(domain)}&type=${type}`, { headers: { Accept: 'application/dns-json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('dns');
    const j = await r.json();
    if (j.Status === 3) return { gone: true, answers: [] }; // NXDOMAIN
    if (j.Status !== 0) throw new Error('dns'); // SERVFAIL and friends: unknown, not proof
    return { gone: false, answers: j.Answer || [] };
  };
  try {
    const mx = await ask('MX');
    if (mx.gone) return 'none';
    const hosts = mx.answers.filter((a) => a.type === 15);
    if (hosts.length) return hosts.every((a) => /^\d+\s+\.?$/.test(String(a.data).trim())) ? 'none' : 'mx'; // "0 ." is a null MX: this domain takes no mail
    const a = await ask('A');
    if (a.answers.some((x) => x.type === 1)) return 'a';
    const aaaa = await ask('AAAA');
    return aaaa.answers.some((x) => x.type === 28) ? 'a' : 'none';
  } catch { return 'unknown'; } finally { clearTimeout(timer); }
}

const MSG = {
  syntax: 'Please enter a valid email address.',
  disposable: 'Please use your own, permanent email address, not a temporary one.',
  role: 'Please use your personal email address, not a shared one like info@ or admin@.',
  nodomain: "That email's domain can't receive mail. Please check the spelling.",
};

// keepTypo: the visitor was shown "Did you mean ...?" and chose to keep what they typed.
export async function checkEmail(raw, { fetchImpl = fetch, keepTypo = false, timeoutMs = DNS_TIMEOUT_MS } = {}) {
  const p = parseEmail(raw);
  if (!p) return { ok: false, check: null, reason: 'syntax', message: MSG.syntax, email: '' };
  const base = { email: p.email, suggestion: '' };
  const fix = suggestDomain(p.domain); // first: the upstream disposable list also holds typo domains like gmial.com, and "Did you mean gmail.com?" is the kinder answer
  const typo = fix && (!isDisposable(p.domain) || MAIN.has(fix)); // a disposable domain only counts as a typo when it is one of a big provider (gmial.com), not a look-alike of a small one (yopmail.com ~ popmail.com)
  if (typo && !keepTypo) return { ...base, ok: false, check: 'suggested', reason: 'typo', suggestion: `${p.local}@${fix}`, message: `Did you mean ${p.local}@${fix}?` };
  if (isDisposable(p.domain)) return { ...base, ok: false, check: null, reason: 'disposable', message: MSG.disposable };
  if (isRole(p.local)) return { ...base, ok: false, check: null, reason: 'role', message: MSG.role };
  const dns = await dnsMail(p.domain, fetchImpl, timeoutMs);
  if (dns === 'none') return { ...base, ok: false, check: null, reason: 'nodomain', message: MSG.nodomain };
  if (typo) return { ...base, ok: true, check: 'suggested', reason: 'typo-kept', suggestion: `${p.local}@${fix}`, message: '' };
  if (dns === 'mx') return { ...base, ok: true, check: 'valid', reason: 'ok', message: '' };
  return { ...base, ok: true, check: 'risky', reason: dns === 'a' ? 'no-mx' : 'dns-unchecked', message: '' };
}
