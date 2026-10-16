// Home "what's going on right now": Needs Jon, videos ready for Jon, webinar countdown,
// sponsors vs $10k, Viral View MRR vs $10k. Every value comes from a live slice or says "no data".
import { cashTile } from './cash.js';
import { freshness } from './snapshot.js';

export const MRR_TARGET_CENTS = 1000000;

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function usd(cents) {
  return `$${Math.round((Number(cents) || 0) / 100).toLocaleString('en-US')}`;
}

export function mrrTile(viralRow, nowMs, intervalMs) {
  const d = viralRow ? parse(viralRow.data) : null;
  const cur = d?.subscriptions?.current;
  const cents = cur && cur.mrrCents != null ? Number(cur.mrrCents) : NaN;
  if (!Number.isFinite(cents)) return { icon: 'trend', label: 'Viral View MRR', value: 'no data', sub: 'Viral View feed has no MRR', stale: true };
  const f = freshness(viralRow.collected_at, nowMs, intervalMs);
  const pct = Math.min(100, Math.round(cents / MRR_TARGET_CENTS * 100));
  return {
    icon: 'trend',
    label: 'Viral View MRR',
    value: usd(cents),
    goal: '/ $10k by Dec 14',
    pct,
    pg: pct >= 100 ? 'ok' : pct >= 50 ? 'risk' : 'crit',
    sub: `${Number(cur.activeCustomers) || 0} paying customers · ${f.label}`,
    stale: f.stale,
  };
}

export function buildNow(out, by, nowMs, intervals) {
  const home = out.pages.home;
  const nj = by.needs_jon ? parse(by.needs_jon.data) : null;
  const njFresh = by.needs_jon ? freshness(by.needs_jon.collected_at, nowMs, intervals.needs_jon) : null;
  const videos = out.pages.videos;
  const web = out.pages.webinar;
  const cash = home.sponsorsCash;
  const ready = videos?.ready || [];
  home.now = {
    needsJon: {
      available: !!nj?.ok,
      stale: !nj?.ok || !!njFresh?.stale,
      updated: nj?.updated || '',
      items: (nj?.items || []).slice(0, 8),
    },
    ready: { available: !!(videos && videos.rows && videos.rows.length), stale: !!videos?.stale, reason: videos ? videos.reason : 'Production feed not loaded', items: ready },
    tiles: [
      web?.tiles?.[0]
        ? { ...web.tiles[0], sub: `${web.tiles[0].sub} · ${web.green || ''} by Oct 19` }
        : { icon: 'clock', label: 'Webinar starts in', value: 'no data' },
      cash ? cashTile(cash) : { icon: 'dollar', label: 'Sponsors', value: 'no data' },
      mrrTile(by.viralview, nowMs, intervals.viralview),
      { icon: 'film', label: 'Videos ready for Jon', value: videos?.rows?.length ? String(ready.length) : 'no data', sub: ready.map((r) => r.channel).join(' · ') || (videos?.rows?.length ? 'None right now' : (videos?.reason || 'Production feed unavailable')) },
    ],
  };
  return home.now;
}
