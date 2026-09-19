export const COLLECTOR_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

export const INTERVALS = {
  agents_mac: COLLECTOR_INTERVAL_MS,
  agents_gpu2: COLLECTOR_INTERVAL_MS,
};

const MACHINES = [
  { id: 'mac', label: 'Mac mini', source: 'agents_mac' },
  { id: 'gpu2', label: 'GPU2', source: 'agents_gpu2' },
];

export function ageLabel(ageMs) {
  const m = Math.floor(ageMs / 60000);
  if (m < 1) return 'updated just now';
  if (m === 1) return 'updated 1 min ago';
  if (m < 60) return `updated ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return 'updated 1 hr ago';
  if (h < 48) return `updated ${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'updated 1 day ago' : `updated ${d} days ago`;
}

export function freshness(collectedAt, nowMs, intervalMs) {
  const t = Date.parse(collectedAt);
  if (!Number.isFinite(t)) return { ageMs: Infinity, stale: true, label: 'updated unknown' };
  const ageMs = Math.max(0, nowMs - t);
  return { ageMs, stale: ageMs > 3 * intervalMs, label: ageLabel(ageMs) };
}

function parseData(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export function mergeSnapshot(fixture, rows, nowMs = Date.now()) {
  const out = JSON.parse(JSON.stringify(fixture));
  const by = {};
  const staleSources = [];
  for (const row of rows || []) {
    by[row.source] = row;
    const interval = INTERVALS[row.source] ?? DEFAULT_INTERVAL_MS;
    const f = freshness(row.collected_at, nowMs, interval);
    out.sources[row.source] = { updatedAt: row.collected_at, stale: f.stale, ageLabel: f.label };
    if (f.stale) {
      const m = MACHINES.find((x) => x.source === row.source);
      staleSources.push({ source: row.source, label: m ? m.label : row.source, ageLabel: f.label });
    }
  }
  if (out.pages.agents) {
    out.pages.agents.machines = MACHINES.map((m) => {
      const row = by[m.source];
      if (!row) return { ...m, hostname: '', ageLabel: 'No heartbeat yet', stale: false };
      const data = parseData(row.data);
      const f = freshness(row.collected_at, nowMs, INTERVALS[m.source]);
      return {
        ...m,
        hostname: data.hostname || m.label,
        ageLabel: f.label,
        stale: f.stale,
        updatedAt: row.collected_at,
      };
    });
    out.pages.agents.staleSources = staleSources;
  }
  return out;
}
