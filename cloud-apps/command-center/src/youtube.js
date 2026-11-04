// Track from the YouTube APIs (Jon, 2026-11-04), replacing the Studio scraper (D:\AgentTeam\tools\studio_read.py).
// Each channel is its own Google identity, so Jon connects each once with read-only consent. Then:
// - status comes from the Data API; views, AVD and subs from the Analytics API, like Studio (public view counts until it has them), when Track is opened (at most every 20 minutes) and hourly from the cron;
// - impressions and CTR come from Reporting API reach reports in the 10-minute cron (at most every 6 hours a channel).
// Both fill yt_stats, the rows the Track and Calendar pages already read.
import { YOUTUBE_CHANNELS, pacific } from './channels.js';

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
const CALLBACK = '/dashboard/api/youtube/callback';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const REPORTING = 'https://youtubereporting.googleapis.com/v1';
const REACH = 'channel_reach_basic_a1';
// Quota: 10,000 Data API units a day for this project (Track only). A sync is at most 5 units a channel, so even Track
// open all day (72 syncs) plus the hourly cron stays under it for 23 channels.
const SYNC_EVERY_MS = 20 * 60 * 1000;
const CRON_SYNC_EVERY_MS = 3600 * 1000;
const REACH_EVERY_MS = 6 * 3600 * 1000;
const SYNC_WAIT_MS = 8000; // Track answers with what's stored after this; the sync finishes in the background
const MAX_VIDEOS = 100; // newest uploads per channel: 2 playlist pages + 2 video pages at most
const REPORTS_PER_RUN = 10; // the first run has ~30 days of backfill; the rest waits for the next cron
const YOUTUBE_ID_RE = /^[\w-]{11}$/;
const NOT_SET_UP = 'YouTube is not set up yet: a Google client or token key secret is missing.';

// Copied from D:\AgentTeam\tools\youtube_upload.py CHANNELS (ids checked on youtube.com 2026-10-30). Eleanor Whitfield
// has none yet: her first connect keeps the channel Jon picks, unless it is one of these.
export const CHANNEL_IDS = {
  'jon-mac': 'UC21BTzNwbWbQF4d22iq950w',
  jonmacai: 'UCVLKdNuEVq3dxNCU2EMxqOg',
  'theo-creates': 'UCkFjK8d-7lfxqv3QUg8cI5Q',
  'sienna-creates': 'UCGiPAxrv67y0RWohzLZbyPQ',
  'zane-creates': 'UCwSZZcyK_mTeEtN4Mu-QB0Q',
  'aria-creates': 'UCyEqHP8AtuPDzIWH7klmfkg',
  'ash-creates': 'UCunL92G3UzjUwSFyh8kvU8A',
  'mina-creates': 'UC6XzgM4IyRqSo9x6OwI2yqA',
  'max-creates': 'UCfTP8sUPbX9R2PYxk9Txilg',
  'peter-collins': 'UC4ElbvMXjotuSot1rMhRx5A',
  'jack-mercer': 'UCP4LZ2M-dz3tLaSDohBp5yw',
  'rosa-cooks': 'UC13zfnUYAzTbK0scEj-ENDw',
  'rosas-clean-home': 'UCGWwd-g7dzWuu00qERpOesQ',
  'rosas-house-hacks': 'UCdc02lfXuQEKZEmxhC7HCdQ',
  'giovanni-moretti': 'UC-IKqe1B22dw4ki-C_L_Aig',
  'frank-bennett-dogs': 'UCC4wThHwp6t1xymt9FYw80g',
  'ruth-calder': 'UCFiCcgw7wbxzbGTJ6F_vn9A',
  'dale-whitaker-pitbulls': 'UCAS0vfGZ1Q_fIUeACpjEUjQ',
  'nora-fairweather-cats': 'UCA-p6ISXtMw0rNxqIGvXlpg',
  'gail-merriman-golf': 'UCmuuW-Cd9JI_FvD6JnC4MSQ',
  'naomi-takeda-japan': 'UCVQ1IvY122yx8G8zXAgPo1g',
  'walter-brandt-dogs': 'UCFohnIKCzMdwzUQw5rIjKUw',
};

const ready = (env) => !!(env.YT_CLIENT_ID && env.YT_CLIENT_SECRET && env.YT_TOKEN_KEY && env.DB);
const iso = (ms) => new Date(ms).toISOString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
// no-referrer: the callback URL carries Google's one-time code.
const page = (status, text) => new Response(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>YouTube</title>
<p>${esc(text)}</p><p><a href="/dashboard/#track">Back to Track</a></p>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

// Refresh tokens are sealed with AES-GCM (YT_TOKEN_KEY, 32 bytes base64), bound to their channel slug so a row
// can't be swapped onto another channel.
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function aesKey(env) {
  const raw = unb64(env.YT_TOKEN_KEY);
  if (raw.length !== 32) throw new Error('YT_TOKEN_KEY must be 32 bytes, base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, text, slug) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(slug) }, await aesKey(env), new TextEncoder().encode(text));
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`;
}
async function unseal(env, sealed, slug) {
  const [iv, ct] = String(sealed).split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(slug) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// A Google API answer as JSON, or an error in plain words with Google's reason (never the token).
async function getJson(fetchFn, url, token, init = {}) {
  const res = await fetchFn(url, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { hostname, pathname } = new URL(url);
    throw new Error(`${hostname.split('.')[0]} ${pathname.split('/').pop()} answered ${res.status}: ${String(data.error?.message || '').slice(0, 200)}`);
  }
  return data;
}

async function tokenCall(env, fetchFn, params) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, ...params }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function accessToken(env, fetchFn, row) {
  const { status, data } = await tokenCall(env, fetchFn, { grant_type: 'refresh_token', refresh_token: await unseal(env, row.token, row.channel) });
  if (data.access_token) return data.access_token;
  throw new Error(data.error === 'invalid_grant' ? 'Google access was removed: connect this channel again' : `Token refresh answered ${status}`);
}

// The channel's reach report job, made if it has none. Reports start a day or two after.
async function reachJob(fetchFn, token) {
  const { jobs = [] } = await getJson(fetchFn, `${REPORTING}/jobs`, token);
  const have = jobs.find((j) => j.reportTypeId === REACH);
  if (have) return have.id;
  const made = await getJson(fetchFn, `${REPORTING}/jobs`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportTypeId: REACH, name: 'Track reach' }),
  });
  return made.id;
}

// The Google account each channel consents from (Jon, 2026-11-04). Every other channel is on partners@.
const OWNER_LOGIN = { 'jon-mac': 'jon@jonmac.co', jonmacai: 'jon@thejonmac.com', default: 'partners@thejonmac.com' };

// GET /youtube/connect?channel=<slug> (Jon's session): off to Google's consent with a one-use state.
export async function youtubeConnect(request, env, nowMs = Date.now()) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('channel') || '';
  if (!ready(env)) return page(501, NOT_SET_UP);
  if (!YOUTUBE_CHANNELS.some((c) => c.slug === slug)) return page(400, 'Unknown channel. Use a Track channel, like peter-collins.');
  const state = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM yt_oauth_states WHERE expires_at < ?').bind(iso(nowMs)),
    env.DB.prepare('INSERT INTO yt_oauth_states (state, channel, expires_at) VALUES (?, ?, ?)').bind(state, slug, iso(nowMs + 30 * 60 * 1000)),
  ]);
  const params = new URLSearchParams({
    client_id: env.YT_CLIENT_ID, redirect_uri: `${url.origin}${CALLBACK}`, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'select_account consent', include_granted_scopes: 'false', state, // select_account: Google shows the brand-channel picker
    login_hint: OWNER_LOGIN[slug] || OWNER_LOGIN.default, // the account that owns the channel, never Jon's personal Gmail
  });
  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'Cache-Control': 'no-store' } });
}

// GET /youtube/callback: Google's redirect back. The session cookie is SameSite=Strict, so it doesn't come along on
// this cross-site redirect; the one-use state, only made by a signed-in /connect, is what lets it in.
export async function youtubeCallback(request, env, fetchFn = globalThis.fetch, nowMs = Date.now()) {
  if (!ready(env)) return page(501, NOT_SET_UP);
  const url = new URL(request.url);
  const q = url.searchParams;
  const row = q.get('state') ? await env.DB.prepare('DELETE FROM yt_oauth_states WHERE state = ? RETURNING channel, expires_at').bind(q.get('state')).first() : null;
  if (!row || row.expires_at < iso(nowMs)) return page(400, 'This link expired or was already used. Start again from the connect link.');
  if (q.get('error') || !q.get('code')) return page(400, 'Google did not give access, so nothing was connected.');
  const slug = row.channel;
  const label = YOUTUBE_CHANNELS.find((c) => c.slug === slug)?.label || slug;
  const { status: tokStatus, data: tok } = await tokenCall(env, fetchFn, { grant_type: 'authorization_code', code: q.get('code'), redirect_uri: `${url.origin}${CALLBACK}` });
  if (!tok.access_token || !tok.refresh_token) {
    console.error('youtube callback token', tokStatus, tok.error, tok.error_description);
    return page(502, `Google did not give lasting access (${tokStatus} ${String(tok.error || 'no refresh token').slice(0, 80)}). Try the connect link again.`);
  }
  const granted = String(tok.scope || '').split(' ');
  if (!SCOPES.every((s) => granted.includes(s))) return page(400, 'Both read-only permissions are needed (YouTube and YouTube Analytics). Try again and tick both.');
  let me;
  try {
    me = (await getJson(fetchFn, `${DATA}/channels?part=id,snippet&mine=true`, tok.access_token)).items?.[0];
  } catch (err) {
    console.error('youtube callback channels', err.message);
    return page(502, `YouTube did not answer (${err.message}). Try the connect link again.`); // Google's reason, never the token
  }
  if (!me) return page(400, `That Google login has no YouTube channel. Pick ${label} when Google asks.`);
  const name = me.snippet?.title || me.id;
  const expected = CHANNEL_IDS[slug];
  const taken = Object.keys(CHANNEL_IDS).find((s) => s !== slug && CHANNEL_IDS[s] === me.id)
    || (await env.DB.prepare('SELECT channel FROM yt_api WHERE channel_id = ? AND channel != ?').bind(me.id, slug).first())?.channel;
  if ((expected && me.id !== expected) || taken) return page(400, `That is ${name}, not ${label}. Try again and pick ${label}.`);
  const now = iso(nowMs);
  await env.DB.prepare(`INSERT INTO yt_api (channel, channel_id, name, token, connected_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (channel) DO UPDATE SET channel_id = excluded.channel_id, name = excluded.name, token = excluded.token,
    connected_at = excluded.connected_at, sync_tried_at = NULL, sync_error = NULL, reach_tried_at = NULL`)
    .bind(slug, me.id, name, await seal(env, tok.refresh_token, slug), now).run();
  let note = '';
  try {
    await env.DB.prepare('UPDATE yt_api SET reach_job = ?, reach_error = NULL WHERE channel = ?').bind(await reachJob(fetchFn, tok.access_token), slug).run();
  } catch (err) {
    note = ' Impressions and CTR are not set up yet; the next sync tries again.';
    await env.DB.prepare('UPDATE yt_api SET reach_error = ? WHERE channel = ?').bind(err.message, slug).run();
  }
  return page(200, `Connected ${name}.${note}`);
}

// YouTube's video as yt_stats fields, in the words studio_read posted: live, scheduled, private, unlisted.
export function statsOf(v, nowMs) {
  const out = {};
  const privacy = v.status?.privacyStatus;
  const at = v.status?.publishAt;
  if (privacy === 'public') out.status = 'live';
  else if (privacy === 'private' && at && Date.parse(at) > nowMs) Object.assign(out, { status: 'scheduled', scheduled_at: iso(Date.parse(at)), scheduled_date: pacific(at).day });
  else if (privacy === 'private' || privacy === 'unlisted') Object.assign(out, { status: privacy, scheduled_at: null, scheduled_date: null });
  const views = Number(v.statistics?.viewCount);
  if (v.statistics?.viewCount != null && Number.isFinite(views)) out.views = views;
  return out;
}

// One Analytics row (views, averageViewDuration, subscribersGained, subscribersLost) as yt_stats fields. AVD is seconds.
export function studioOf([views, avd, gained, lost]) {
  return { views: Number(views), avd: Number(views) > 0 ? Number(avd) : null, subs: Number(gained) - Number(lost) };
}

// One channel: ~3 Data API units (channels, one playlist page, one videos page) and two Analytics calls.
async function syncChannel(env, fetchFn, row, nowMs) {
  const token = await accessToken(env, fetchFn, row);
  const ch = (await getJson(fetchFn, `${DATA}/channels?part=contentDetails,statistics&mine=true`, token)).items?.[0];
  if (!ch || ch.id !== row.channel_id) throw new Error('This login no longer opens the right channel: connect it again');
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  const ids = [];
  for (let pageToken = ''; uploads && ids.length < MAX_VIDEOS;) {
    const p = await getJson(fetchFn, `${DATA}/playlistItems?${new URLSearchParams({ part: 'contentDetails', maxResults: '50', playlistId: uploads, ...(pageToken ? { pageToken } : {}) })}`, token);
    ids.push(...(p.items || []).map((i) => i.contentDetails?.videoId).filter((id) => YOUTUBE_ID_RE.test(id || '')));
    if (!p.nextPageToken) break;
    pageToken = p.nextPageToken;
  }
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    videos.push(...((await getJson(fetchFn, `${DATA}/videos?part=status,statistics&maxResults=50&id=${ids.slice(i, i + 50).join(',')}`, token)).items || []));
  }
  // Studio's numbers (Jon, 2026-11-04): lifetime Analytics views, average view duration and net subscribers, per video
  // and for the channel. Analytics lags a day or two: a video it doesn't list yet keeps its public view count, and a
  // channel with no rows yet, or rows far behind, stores none, so Track falls back. Its failure still saves views and status.
  const studio = new Map();
  let channel = null;
  let problem = null;
  try {
    const base = { ids: 'channel==MINE', startDate: '2005-01-01', endDate: pacific(nowMs).day, metrics: 'views,averageViewDuration,subscribersGained,subscribersLost' };
    for (const [id, ...m] of (await getJson(fetchFn, `${ANALYTICS}?${new URLSearchParams({ ...base, dimensions: 'video', sort: '-views', maxResults: '200' })}`, token)).rows || []) studio.set(id, studioOf(m));
    const [all] = (await getJson(fetchFn, `${ANALYTICS}?${new URLSearchParams(base)}`, token)).rows || [];
    channel = Number(all?.[0]) > 0 ? studioOf(all) : { views: null, avd: null, subs: null }; // a new channel's all-zero row too
  } catch (err) {
    problem = `Analytics not read: ${err.message}`;
  }
  const now = iso(nowMs);
  const statements = [];
  // Analytics runs 2-3 days behind on a new channel (Giovanni: 1 view there vs 82 public, 2026-11-04). Until its
  // count reaches half the public one, keep the public views and show no AVD rather than a number that far behind.
  const behind = (a, pub) => a && pub != null && Number.isFinite(Number(pub)) && a.views < Number(pub) / 2;
  if (behind(channel, ch.statistics?.viewCount)) channel = { views: null, avd: null, subs: null };
  for (const v of videos) {
    const a = studio.get(v.id);
    const s = { ...statsOf(v, nowMs), ...(behind(a, v.statistics?.viewCount) ? { avd: null, subs: null } : a) };
    const fields = Object.keys(s);
    if (!YOUTUBE_ID_RE.test(v.id || '') || !fields.length) continue;
    // A field YouTube didn't give keeps its value, like the old stats route.
    statements.push(env.DB.prepare(`INSERT INTO yt_stats (youtube_id, ${fields.join(', ')}, updated_at) VALUES (?, ${fields.map(() => '?').join(', ')}, ?)
      ON CONFLICT (youtube_id) DO UPDATE SET ${fields.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = excluded.updated_at`).bind(v.id, ...fields.map((k) => s[k]), now));
  }
  const n = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  statements.push(env.DB.prepare('UPDATE yt_api SET subscribers = ?, views = ?, videos = ?, synced_at = ?, sync_error = ? WHERE channel = ?')
    .bind(n(ch.statistics?.subscriberCount), n(ch.statistics?.viewCount), n(ch.statistics?.videoCount), now, problem, row.channel));
  if (channel) {
    statements.push(env.DB.prepare('UPDATE yt_api SET studio_views = ?, studio_subs = ?, studio_avd = ? WHERE channel = ?')
      .bind(channel.views, channel.subs, channel.avd, row.channel));
  }
  await env.DB.batch(statements);
}

// Claims the due channels in one statement: the claim time is the lease, so a second open finds nothing due.
async function claim(db, column, everyMs, nowMs) {
  const { results } = await db.prepare(`UPDATE yt_api SET ${column} = ?1 WHERE ${column} IS NULL OR ${column} < ?2 RETURNING *`)
    .bind(iso(nowMs), iso(nowMs - everyMs)).all();
  return results || [];
}

// Track opened: sync channels not synced for 20 minutes, all at once (23 channels x ~6 calls is far under the paid
// plan's 10,000 subrequests). Answers after SYNC_WAIT_MS at most; the rest finishes in the background.
// The cron passes no ctx and an hourly everyMs, so Track and Calendar stay fresh with nobody opening Track; it waits for the work.
export async function freshen(env, ctx, fetchFn = globalThis.fetch, nowMs = Date.now(), everyMs = SYNC_EVERY_MS) {
  if (!ready(env)) return;
  let rows;
  try {
    rows = await claim(env.DB, 'sync_tried_at', everyMs, nowMs);
  } catch (err) {
    console.error('youtube freshen', err.message); // migration 0020 not applied
    return;
  }
  if (!rows.length) return;
  const work = Promise.allSettled(rows.map((row) => syncChannel(env, fetchFn, row, nowMs).catch((err) => env.DB.prepare('UPDATE yt_api SET sync_error = ? WHERE channel = ?').bind(err.message, row.channel).run())));
  if (!ctx?.waitUntil) {
    await work;
    return;
  }
  ctx.waitUntil(work);
  let timer;
  await Promise.race([work, new Promise((r) => { timer = setTimeout(r, SYNC_WAIT_MS); })]);
  clearTimeout(timer);
}

// A reach report CSV as one row per (video, day): impressions, and CTR in percent. The report's ctr is read as a
// fraction (clicks / impressions). A value over 1 can't be a fraction, so it stops the import loudly (reach_error)
// instead of guessing per report. Check against Studio when the first reports land.
export function parseReach(csv) {
  const [head = '', ...lines] = String(csv).trim().split(/\r?\n/);
  const col = head.split(',');
  const [d, v, n, c] = ['date', 'video_id', 'video_thumbnail_impressions', 'video_thumbnail_impressions_ctr'].map((k) => col.indexOf(k));
  if (d < 0 || v < 0 || n < 0 || c < 0) throw new Error('Reach report has unexpected columns');
  const rows = lines.map((l) => l.split(',')).filter((x) => YOUTUBE_ID_RE.test(x[v] || '') && /^\d{8}$/.test(x[d] || ''));
  if (rows.some((x) => Number(x[c]) > 1)) throw new Error('Reach report CTR is over 1, so it is not a fraction: check the unit against Studio');
  const scale = 100;
  const by = new Map();
  for (const x of rows) {
    const day = `${x[d].slice(0, 4)}-${x[d].slice(4, 6)}-${x[d].slice(6)}`;
    const r = by.get(`${x[v]} ${day}`) || { youtube_id: x[v], day, impressions: 0, clicks: 0 };
    const imp = Number(x[n]) || 0;
    const ctr = Number(x[c]) * scale;
    r.impressions += imp;
    r.clicks += Number.isFinite(ctr) ? imp * ctr : 0;
    by.set(`${x[v]} ${day}`, r);
  }
  return [...by.values()].map(({ clicks, ...r }) => ({ ...r, ctr: r.impressions ? clicks / r.impressions : null }));
}

async function reachChannel(env, fetchFn, row, nowMs) {
  const token = await accessToken(env, fetchFn, row);
  const job = row.reach_job || await reachJob(fetchFn, token);
  const reports = [];
  for (let pageToken = ''; reports.length < 500;) {
    const q = new URLSearchParams({ ...(row.reach_after ? { createdAfter: row.reach_after } : {}), ...(pageToken ? { pageToken } : {}) });
    const p = await getJson(fetchFn, `${REPORTING}/jobs/${encodeURIComponent(job)}/reports?${q}`, token);
    reports.push(...(p.reports || []));
    if (!p.nextPageToken) break;
    pageToken = p.nextPageToken;
  }
  reports.sort((a, b) => Date.parse(a.createTime) - Date.parse(b.createTime));
  const batch = reports.slice(0, REPORTS_PER_RUN);
  const statements = [];
  for (const r of batch) {
    if (!String(r.downloadUrl).startsWith('https://youtubereporting.googleapis.com/')) throw new Error('Reach report download is not on youtubereporting.googleapis.com');
    const res = await fetchFn(r.downloadUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Reach report download answered ${res.status}`);
    for (const x of parseReach(await res.text())) {
      statements.push(env.DB.prepare(`INSERT INTO yt_reach (youtube_id, day, channel, impressions, ctr) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (youtube_id, day) DO UPDATE SET channel = excluded.channel, impressions = excluded.impressions, ctr = excluded.ctr`)
        .bind(x.youtube_id, x.day, row.channel, x.impressions, x.ctr));
    }
  }
  if (batch.length) {
    // Totals over every stored day: impressions summed, CTR weighted by impressions. updated_at moves only on a new row:
    // it stays the views/subs sync time. Reports start ~30 days before the job, so an older video's sum can be under its
    // lifetime count from Studio; lifetime impressions never shrink, so a smaller sum keeps the Studio numbers.
    statements.push(env.DB.prepare(`INSERT INTO yt_stats (youtube_id, impressions, ctr, reach_as_of, updated_at)
      SELECT youtube_id, SUM(impressions), ROUND(SUM(impressions * ctr) / NULLIF(SUM(impressions), 0), 1), MAX(day), ?2
      FROM yt_reach WHERE channel = ?1 GROUP BY youtube_id
      ON CONFLICT (youtube_id) DO UPDATE SET
        ctr = CASE WHEN yt_stats.impressions IS NULL OR excluded.impressions >= yt_stats.impressions THEN excluded.ctr ELSE yt_stats.ctr END,
        impressions = MAX(COALESCE(yt_stats.impressions, 0), excluded.impressions), reach_as_of = excluded.reach_as_of`)
      .bind(row.channel, iso(nowMs)));
  }
  // More reports waiting: clear the lease so the next cron run carries on.
  const more = reports.length > batch.length;
  statements.push(env.DB.prepare(`UPDATE yt_api SET reach_job = ?, reach_after = ?, reach_error = NULL, reach_tried_at = ${more ? 'NULL' : 'reach_tried_at'},
    reach_as_of = (SELECT MAX(day) FROM yt_reach WHERE channel = ?3) WHERE channel = ?3`)
    .bind(job, batch.at(-1)?.createTime || row.reach_after || null, row.channel));
  await env.DB.batch(statements);
}

// 10-minute cron: reach reports for channels not checked for 6 hours.
export async function syncReach(env, fetchFn = globalThis.fetch, nowMs = Date.now()) {
  if (!ready(env)) return;
  const rows = await claim(env.DB, 'reach_tried_at', REACH_EVERY_MS, nowMs);
  await Promise.allSettled(rows.map((row) => reachChannel(env, fetchFn, row, nowMs)
    .catch((err) => env.DB.prepare('UPDATE yt_api SET reach_error = ? WHERE channel = ?').bind(err.message, row.channel).run())));
}

// GET /youtube/status (Jon's session or a bot token): where each channel stands. No secrets.
export async function youtubeStatus(env) {
  let rows;
  try {
    rows = (await env.DB.prepare(`SELECT channel, channel_id, name, subscribers, views, videos, studio_views, studio_subs, studio_avd, synced_at, sync_error,
      reach_job, reach_as_of, reach_error FROM yt_api`).all()).results || [];
  } catch {
    return json({ error: 'Migration 0020 or 0021 is not applied' }, 503);
  }
  const by = new Map(rows.map((r) => [r.channel, r]));
  return json({
    ok: true,
    setUp: ready(env) || NOT_SET_UP,
    channels: YOUTUBE_CHANNELS.map((c) => {
      const r = by.get(c.slug);
      return {
        channel: c.slug, label: c.label, connected: !!r, channelId: r?.channel_id || CHANNEL_IDS[c.slug] || null, name: r?.name || null,
        subscribers: r?.subscribers ?? null, views: r?.views ?? null, videos: r?.videos ?? null,
        studio: { views: r?.studio_views ?? null, subs: r?.studio_subs ?? null, avdSeconds: r?.studio_avd ?? null }, // lifetime Analytics, as Studio shows
        lastSync: r?.synced_at || null, lastError: r?.sync_error || null,
        reachJob: !!r?.reach_job, reachAsOf: r?.reach_as_of || null, reachError: r?.reach_error || null,
        connect: `/dashboard/api/youtube/connect?channel=${c.slug}`,
      };
    }),
  });
}

// 10-minute cron: views, status and subs for channels not synced for an hour, so Track and Calendar are fresh at 07:00.
export const syncStats = (env, fetchFn = globalThis.fetch, nowMs = Date.now()) => freshen(env, null, fetchFn, nowMs, CRON_SYNC_EVERY_MS);
