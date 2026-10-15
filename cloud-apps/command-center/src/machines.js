// GPU1 and GPU2 live status from the 60 s machine heartbeat (collectors/lib/machine_stats.py).
export const MACHINE_INTERVAL_MS = 60 * 1000;
export const OFFLINE_MS = 5 * 60 * 1000;
export const LOW_DISK_GB = 50;
export const HIGH_COMMIT_PCT = 90;

export const HOSTS = [
  { id: 'gpu1', label: 'GPU1', source: 'machine_gpu1', role: 'DaVinci builds · RTX 5090' },
  { id: 'gpu2', label: 'GPU2', source: 'machine_gpu2', role: 'Avatar Studio · gaming PC' },
];

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.floor(h / 24)} days ago`;
}

function running(r = {}, gpus = []) {
  const out = [];
  const util = gpus.length ? Math.max(...gpus.map((g) => num(g.util) ?? 0)) : null;
  if (r.resolve?.open) {
    const busy = util != null && util >= 30 ? ` · GPU ${util}% busy` : '';
    out.push({ label: 'DaVinci Resolve', value: r.resolve.project ? `open · ${r.resolve.project}${busy}` : `open${busy}`, on: true });
  } else out.push({ label: 'DaVinci Resolve', value: 'closed', on: false });
  const ff = num(r.ffmpeg) ?? 0;
  out.push({ label: 'ffmpeg', value: ff ? `${ff} running` : 'none', on: ff > 0 });
  const qwen = num(r.qwen) ?? 0;
  out.push({ label: 'Qwen image jobs', value: qwen ? `${qwen} running` : 'none', on: qwen > 0 });
  const py = Array.isArray(r.python) ? r.python : [];
  const scripts = [...new Set(py.map((p) => String(p.script || 'python').slice(0, 40)))];
  out.push({ label: 'Python', value: py.length ? `${py.length} · ${scripts.slice(0, 4).join(', ')}` : 'none', on: py.length > 0 });
  if (r.docker != null) out.push({ label: 'Docker', value: r.docker ? 'up' : 'down', on: !!r.docker });
  if (r.orca != null) out.push({ label: 'Orca', value: r.orca ? 'up' : 'down', on: !!r.orca });
  return out;
}

export function buildMachine(host, row, nowMs) {
  if (!row) {
    return { ...host, online: false, stale: true, level: 'crit', ageLabel: 'no heartbeat yet', alerts: ['No heartbeat received'], gpus: [], disks: [], running: [] };
  }
  const d = parse(row.data);
  const t = Date.parse(row.collected_at);
  const age = Number.isFinite(t) ? Math.max(0, nowMs - t) : Infinity;
  const stale = age > 3 * MACHINE_INTERVAL_MS;
  const offline = age > OFFLINE_MS;
  const alerts = [];
  if (offline) alerts.push(`Offline · last seen ${Number.isFinite(age) ? ago(age) : 'unknown'}`);
  const disks = (Array.isArray(d.disks) ? d.disks : []).map((x) => {
    const free = num(x.freeGb);
    const total = num(x.totalGb);
    const low = free != null && free < LOW_DISK_GB;
    if (low) alerts.push(`${x.drive} only ${Math.round(free)} GB free`);
    return { drive: String(x.drive || '?'), freeGb: free, totalGb: total, usedPct: free != null && total ? Math.round((1 - free / total) * 100) : null, low };
  });
  const commitPct = num(d.commit?.pct);
  const commitHigh = commitPct != null && commitPct > HIGH_COMMIT_PCT;
  if (commitHigh) alerts.push(`Commit ${commitPct}% of limit`);
  const errors = (Array.isArray(d.errors) ? d.errors : []).map((e) => String(e).slice(0, 60));
  const gpus = (Array.isArray(d.gpus) ? d.gpus : []).map((g) => ({
    name: String(g.name || 'GPU').replace(/^NVIDIA (GeForce )?/, ''),
    util: num(g.util),
    memUsedGb: num(g.memUsedGb),
    memTotalGb: num(g.memTotalGb),
    tempC: num(g.tempC),
  }));
  const gaming = d.gaming && typeof d.gaming === 'object' ? { on: !!d.gaming.on, why: String(d.gaming.why || '').slice(0, 80) } : null;
  return {
    ...host,
    hostname: String(d.hostname || host.label),
    online: !offline,
    stale,
    level: alerts.length ? 'crit' : stale ? 'stale' : 'ok',
    ageLabel: Number.isFinite(age) ? `seen ${ago(age)}` : 'seen unknown',
    updatedAt: row.collected_at,
    alerts,
    errors,
    gpus,
    ram: d.ram ? { usedGb: num(d.ram.usedGb), totalGb: num(d.ram.totalGb) } : null,
    commit: d.commit ? { usedGb: num(d.commit.usedGb), limitGb: num(d.commit.limitGb), pct: commitPct, high: commitHigh } : null,
    disks,
    uptimeH: num(d.uptimeH),
    gaming: host.id === 'gpu2' ? gaming : undefined,
    running: running(d.running, gpus),
  };
}

export function buildMachines(by, nowMs) {
  return HOSTS.map((h) => buildMachine(h, by[h.source], nowMs));
}
