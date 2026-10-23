// Daniel's daily partners@ report plus his deal tracker, for the top of the Sponsors tab.
// Source `partners_report` is pushed hourly from GPU1 (jon-tasks/push.py). Names, stages and
// next steps only; the report itself is written by Daniel at about 07:30 Pacific.
const TZ = 'America/Vancouver';
const STAGES = { signed: 'Signed', posted: 'Posted', negotiating: 'Negotiating', closed: 'Closed' };

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}
function pacificDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
function stamp(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  return `${f} PT`;
}

export function buildPartners(row, nowMs = Date.now()) {
  if (!row) return { available: false, title: 'Partners@ report', note: 'No report has reached the dashboard yet.' };
  const data = parse(row.data);
  const report = data.report;
  if (!report || !Array.isArray(report.sections)) return { available: false, title: 'Partners@ report', note: 'Report unreadable.' };
  const today = pacificDay(nowMs);
  const current = report.date === today;
  const pipe = data.pipeline;
  return {
    available: true,
    title: 'Partners@ report',
    date: report.date,
    current,
    headline: report.title || '',
    note: report.note || '',
    updated: `Report written ${stamp(report.fileUpdatedAt)} · synced ${stamp(row.collected_at)}`,
    status: current ? 'Today' : `Old: ${report.date}`,
    sections: report.sections.map((s) => ({ title: s.title, items: (s.items || []).map(String) })),
    pipeline: pipe ? {
      meta: `${pipe.total} brands tracked · tracker edited ${stamp(pipe.fileUpdatedAt)}`,
      counts: Object.entries(pipe.counts || {}).map(([k, v]) => `${v} ${k}`).join(' · '),
      deals: (pipe.deals || []).map((d) => ({
        brand: d.brand,
        stage: STAGES[d.stage] || d.stage,
        value: d.value && d.value !== 'unknown' ? d.value : '',
        next: d.next || '',
        nextDate: d.nextDate || '',
      })),
    } : null,
  };
}
