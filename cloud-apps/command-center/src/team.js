// Team page (redesign V3): Paul's 4-hour cadence, the two GPUs, and one card per
// OpenMausBot bot grouped by its real section. Bot rows come from the `team` collector
// on GPU1 (bots.json + thread event files); nothing here is guessed. Where a value is
// not reported the page says "no data".
const TZ = 'America/Vancouver';
const SLOT_TIMES = ['02:50', '06:50', '10:50', '14:50', '18:50', '22:50'];
const SECTION_ORDER = ['General', 'Content', 'Business', 'Viral View', 'Other'];

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function van(ms, opts) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(ms));
}

function minutesOf(ms) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t) => Number(p.find((x) => x.type === t)?.value || 0);
  return get('hour') * 60 + get('minute');
}

function slotMinutes(label) {
  const [h, m] = label.split(':').map(Number);
  return h * 60 + m;
}

function leftLabel(ms) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function modelLabel(sel = {}) {
  const model = String(sel.model || '');
  if (/claude-opus-5-5/.test(model)) return 'Opus 5.5';
  if (/claude-sonnet-5-5/.test(model)) return 'Sonnet 5.5';
  if (/claude-haiku-5-5/.test(model)) return 'Haiku 5.5';
  if (/deepseek-v4\.1/i.test(model)) return 'DeepSeek V4.1';
  if (!model) return 'no data';
  return model.split('/').pop().replace(/[-_]/g, ' ');
}

function statusMeta(status) {
  if (status === 'working') return { label: 'Working', cls: 'ok', dot: 'ok' };
  if (status === 'waiting') return { label: 'Waiting on Jon', cls: 'risk', dot: 'risk' };
  if (status === 'stuck') return { label: 'Stuck', cls: 'crit', dot: 'crit' };
  if (status === 'idle') return { label: 'Idle', cls: 'idle', dot: 'idle' };
  return { label: 'No data', cls: 'idle', dot: 'idle' };
}

function agoLabel(ms, nowMs) {
  if (!Number.isFinite(ms)) return 'no activity';
  const m = Math.max(0, Math.round((nowMs - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function paulSlots(nowMs) {
  const nowMin = minutesOf(nowMs);
  let nextIdx = SLOT_TIMES.findIndex((t) => slotMinutes(t) > nowMin);
  const wrapped = nextIdx === -1;
  if (wrapped) nextIdx = 0;
  const nextAt = (() => {
    const target = slotMinutes(SLOT_TIMES[nextIdx]);
    const deltaMin = wrapped ? target + 1440 - nowMin : target - nowMin;
    return nowMs + deltaMin * 60000;
  })();
  const slots = SLOT_TIMES.map((time, i) => {
    const past = i < nextIdx || (wrapped && i >= 0);
    const next = i === nextIdx;
    return {
      time,
      state: next ? 'next' : past ? 'past' : 'later',
      // No completion log is collected yet, so a past slot is not called done or missed.
      note: next ? 'Video' : past ? 'No record' : '',
    };
  });
  return {
    title: "Paul · one video every 4 hours",
    next: { time: SLOT_TIMES[nextIdx], label: leftLabel(nextAt - nowMs), at: new Date(nextAt).toISOString() },
    slots,
    note: 'Slot times follow the 4-hour rule. Past slots say “no record” until a completion log is collected.',
  };
}

function gpuCard(host) {
  const g = (host.gpus || [])[0] || null;
  const util = g && Number.isFinite(g.util) ? g.util : null;
  const used = g && Number.isFinite(g.memUsedGb) ? g.memUsedGb : null;
  const total = g && Number.isFinite(g.memTotalGb) ? g.memTotalGb : null;
  const running = (host.running || []).filter((r) => r.on).map((r) => r.label);
  return {
    id: host.id,
    label: host.label,
    name: host.hostname || host.label,
    online: host.online !== false,
    stale: !!host.stale,
    ageLabel: host.ageLabel || '',
    util,
    memUsedGb: used,
    memTotalGb: total,
    vramPct: used != null && total ? Math.round((used / total) * 100) : null,
    tempC: g && Number.isFinite(g.tempC) ? g.tempC : null,
    gpuName: g?.name || '',
    running,
    note: !host.online ? 'No heartbeat' : running.length ? running.slice(0, 3).join(' · ') : 'idle',
  };
}

export function buildTeam(page, by, hosts, nowMs) {
  const row = by.team;
  const data = row ? parse(row.data) : null;
  const bots = Array.isArray(data?.bots) ? data.bots : [];
  page.title = 'Team';
  const n = bots.length;
  page.sub = `${n ? `${n} bots` : 'Bots · no data'} · 2 GPUs · ${van(nowMs, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  const counts = { working: 0, idle: 0, waiting: 0, stuck: 0, unknown: 0 };
  for (const b of bots) {
    const k = ['working', 'idle', 'waiting', 'stuck'].includes(b.status) ? b.status : 'unknown';
    counts[k] += 1;
  }
  page.counts = counts;
  page.pills = [
    counts.working ? { label: `${counts.working} working`, cls: 'ok' } : null,
    counts.waiting ? { label: `${counts.waiting} waiting on Jon`, cls: 'risk' } : null,
    counts.stuck ? { label: `${counts.stuck} stuck`, cls: 'crit' } : null,
    counts.idle ? { label: `${counts.idle} idle`, cls: 'idle' } : null,
  ].filter(Boolean);
  page.available = !!(data?.ok && bots.length);
  page.reason = !row
    ? 'The team collector has not reported from GPU1 yet.'
    : data?.ok === false
      ? `Team collector: ${data.error || 'unavailable'}`
      : !bots.length
        ? 'Team collector reported no bots.'
        : '';
  page.paul = paulSlots(nowMs);
  const gp = hosts.filter((h) => ['gpu1', 'gpu2'].includes(h.id)).map(gpuCard);
  page.gpus = gp;
  const sections = new Map();
  for (const b of bots) {
    const sec = SECTION_ORDER.includes(b.section) ? b.section : b.section ? 'Other' : 'General';
    if (!sections.has(sec)) sections.set(sec, []);
    const meta = statusMeta(b.status);
    sections.get(sec).push({
      id: b.id,
      name: b.short || b.name || 'Bot',
      role: b.role || '',
      section: sec,
      model: modelLabel(b.modelSelection || { model: b.model }),
      modelFull: b.modelSelection?.model || b.model || '',
      status: b.status || 'unknown',
      statusLabel: meta.label,
      statusCls: meta.cls,
      dot: meta.dot,
      task: b.task || '',
      taskAt: b.taskAt || null,
      taskAgo: agoLabel(b.taskAt, nowMs),
      threadId: b.threadId || '',
      stuck: b.status === 'stuck' || b.status === 'waiting',
      next: b.nextRunAt?.at
        ? {
          name: b.nextRunAt.name || '',
          at: b.nextRunAt.at,
          time: van(b.nextRunAt.at, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
        }
        : null,
    });
  }
  page.sections = SECTION_ORDER.filter((s) => sections.has(s)).map((s) => ({
    title: s === 'General' ? "General · Ana's office" : s,
    note: s === 'General' ? '' : '',
    bots: sections.get(s),
  }));
  page.stale = row ? nowMs - Date.parse(row.collected_at) > 3 * 5 * 60 * 1000 : false;
  page.asOf = row?.collected_at || null;
  return page;
}
