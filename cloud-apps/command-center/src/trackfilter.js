// /track shows real visitors only (Jon, 2026-11-26): team traffic, bots and test sign-ups are not counted.
// New clicks from a team IP or a bot user agent are not stored at all; anything already stored (or stored before a
// team IP was added here) is hidden when /track reads it. Nothing is ever deleted.

// THE SETTING: team IPs. Exact addresses or CIDR ranges, IPv4 or IPv6. Edit this list and deploy.
export const TEAM_IPS = [
  '216.232.165.114', // GPU1 / home office public IPv4 (api.ipify.org, 2026-11-26; Telus, may change)
  '2001:569:f05c:7900::/64', // GPU1 / home office IPv6 network (api64.ipify.org, 2026-11-26)
];

// Headless browsers, scripts, crawlers and link-preview fetchers. web_look.py runs headless Chromium ("HeadlessChrome").
export const BOT_UA_RE = /headless|playwright|puppeteer|selenium|phantomjs|lighthouse|python|requests|aiohttp|httpx|curl|wget|node-fetch|undici|axios|okhttp|go-http|java\/|libwww|bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|slack|vkshare|quora link/i;
export const isBotUA = (ua) => BOT_UA_RE.test(String(ua || '')); // every script and headless browser above names itself

// Test sign-ups: a local part starting with "test" (or "+test", ".test"), "test" in the domain, example domains, team domains.
const TEAM_DOMAINS = ['thejonmac.com', 'jonmac.ai', 'jonmac.co'];
export function isTestEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  if (at < 1) return false;
  const local = e.slice(0, at), domain = e.slice(at + 1);
  return /^test|[+._-]test/.test(local) || domain.includes('test') || /^example\.(com|org|net)$/.test(domain)
    || TEAM_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

// Clicks with no IP (stored before 2026-11-26) can still be told apart by where they came from: Jon's YouTube Studio
// and the dashboard itself are the team.
export const TEAM_REFERRER_SQL = "referrer LIKE 'studio.youtube.com%' OR referrer LIKE 'jonmac.ai/track%' OR referrer LIKE 'jonmac.ai/review%'";

// ---- IP matching (exact or CIDR, IPv4 and IPv6) ----
function parseIp(s) {
  s = String(s || '').trim().toLowerCase();
  const v4 = (t) => {
    const p = t.split('.');
    if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || +x > 255)) return null;
    return p.reduce((n, x) => (n << 8n) | BigInt(+x), 0n);
  };
  if (!s.includes(':')) { const n = v4(s); return n === null ? null : { v: 4, n }; }
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s); // ::ffff:1.2.3.4 -> ::ffff:102:304
  if (m) { const n = v4(m[2]); if (n === null) return null; s = `${m[1]}${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`; }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (h) => (h ? h.split(':') : []);
  const a = part(halves[0]), b = part(halves[1] ?? '');
  if (halves.length === 2 && a.length + b.length > 7) return null;
  const groups = [...a, ...(halves.length === 2 ? Array(8 - a.length - b.length).fill('0') : []), ...b];
  const all = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (all.length !== 8 || all.some((x) => !Number.isFinite(x))) return null;
  return { v: 6, n: all.reduce((n, x) => (n << 16n) | BigInt(x), 0n) };
}

function parseRange(r) {
  const [addr, bits] = String(r).split('/');
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const len = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(len) || len < 0 || len > max) return null;
  const shift = BigInt(max - len);
  return { v: ip.v, shift, base: ip.n >> shift };
}

export function ipInList(ip, list = TEAM_IPS) {
  const p = parseIp(ip);
  if (!p) return false;
  return list.map(parseRange).some((r) => r && r.v === p.v && p.n >> r.shift === r.base);
}
export const isTeamIp = (ip) => ipInList(ip);

// One test for a visit: a team IP or a bot user agent.
export const isTeamOrBot = (ip, ua) => isTeamIp(ip) || isBotUA(ua);
// A stored lead row is hidden on /track when its email is a test, or (new rows) its IP or user agent is team or bot.
export const hiddenLead = (x) => isTestEmail(x.email) || (x.ip != null && isTeamIp(x.ip)) || (x.ua != null && isBotUA(x.ua));

// The read-time click filter for SQL. The IPs and user agents already stored are checked here in JS (CIDR is not SQL),
// then passed back as two JSON lists: `WHERE ... AND ${clause}` with .bind(...params).
export async function clickFilter(db) {
  const [ips, uas] = await Promise.all([
    db.prepare('SELECT DISTINCT ip FROM skool_clicks WHERE ip IS NOT NULL').all(),
    db.prepare('SELECT DISTINCT ua FROM skool_clicks WHERE ua IS NOT NULL').all(),
  ]);
  const badIps = (ips.results || []).map((r) => r.ip).filter(isTeamIp);
  const badUas = (uas.results || []).map((r) => r.ua).filter(isBotUA);
  return {
    clause: `(ip IS NULL OR ip NOT IN (SELECT value FROM json_each(?))) AND (ua IS NULL OR ua NOT IN (SELECT value FROM json_each(?)))`
      + ` AND NOT (referrer IS NOT NULL AND (${TEAM_REFERRER_SQL}))`,
    params: [JSON.stringify(badIps), JSON.stringify(badUas)],
  };
}
