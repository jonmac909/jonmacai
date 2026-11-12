// Dashboard 3 Factory page (docs/dashboard-3.md): live progress of the video program, one card per video. A pure
// function over the /dashboard/api/d3 answer (d3.factory = the newest video_line feed entry, built in src/d3.js).
// Everything from the feed is data: every string is escaped, none is ever HTML.
import { esc, icon } from './util.js';
import { headerOnly } from './goals.js';

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (v) => (Array.isArray(v) ? v : []);

// "12 s ago", "5 min ago", "3 hr ago".
export function agoShort(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} hr ago`;
}

// A time in Kelowna (America/Vancouver): "Nov 11, 3:36 PM". '' when it is not a time.
export function kelowna(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}

// A video's place in the list and its label: needs you, failed, running, waiting, done.
const KINDS = {
  need: { rank: 0, label: 'Needs you', pill: 'bad' },
  fail: { rank: 1, label: 'Failed', pill: 'bad' },
  gone: { rank: 2, label: 'Stopped', pill: 'warn' },
  run: { rank: 2, label: 'Running', pill: '' },
  wait: { rank: 3, label: 'Waiting', pill: '' },
  done: { rank: 4, label: 'Done', pill: 'ok' },
};
function kindOf(job) {
  const s = String(job?.state || '').toLowerCase();
  if (job?.needs_person || s === 'needs a person') return 'need';
  if (s === 'failed') return 'fail';
  if (s.startsWith('running?')) return 'gone';
  if (s === 'running') return 'run';
  if (s === 'done') return 'done';
  return s === 'todo' || !s ? 'wait' : 'other';
}

// Videos in page order: needs you first, then failed, running, waiting, done; the feed's order inside each group.
export function factoryJobs(F) {
  return list(F?.jobs).filter((j) => j && typeof j === 'object')
    .map((j, i) => ({ j, i, rank: (KINDS[kindOf(j)] || KINDS.wait).rank }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.j);
}

function stepKind(st) {
  const s = String(st?.status || '').toLowerCase();
  if (s === 'running') return 'run';
  if (s === 'done') return 'done';
  if (s === 'failed') return 'fail';
  return s === 'todo' || s === 'waiting' || !s ? 'wait' : 'other';
}

// One step as a chip: waiting = grey, running = accent with "N min", done = green with "N min", failed = red with "try n".
function chip(st) {
  const k = stepKind(st);
  const min = num(st.minutes) ? `${Math.round(st.minutes)} min` : '';
  const [word, extra] = k === 'run' ? ['running', min || 'running']
    : k === 'done' ? ['done', min || 'done']
      : k === 'fail' ? ['failed', num(st.tries) && st.tries > 0 ? `try ${st.tries}` : 'failed']
        : k === 'wait' ? ['waiting', ''] : [String(st.status), String(st.status)];
  const label = [st.name, word, extra && extra !== word ? extra : ''].filter(Boolean).join(', ');
  return `<span class="fcc ${k}" role="listitem" title="${esc(label)}">${esc(st.name)}${extra ? ` · ${esc(extra)}` : ''}</span>`;
}

const row = (label, value) => (value ? `<div class="fcrow"><span class="mut">${esc(label)}</span><span>${esc(value)}</span></div>` : '');

function jobHtml(job) {
  const kind = kindOf(job);
  const K = KINDS[kind] || { label: String(job.state), pill: '' };
  const steps = list(job.steps).filter((s) => s && typeof s === 'object');
  const mins = /^\d+(\.\d+)?$/.test(String(job.minutes_in_state ?? '')) ? ` · ${Math.round(Number(job.minutes_in_state))} min` : '';
  const total = num(job.steps_total) && job.steps_total > 0 ? job.steps_total : steps.length;
  const progress = total ? `${num(job.steps_done) ? job.steps_done : steps.filter((s) => stepKind(s) === 'done').length} of ${plural(total, 'step')} done` : '';
  const meta = [job.channel, progress].filter(Boolean).join(' · ');
  // What is happening now: the running step's own words, else its note, else the video's note.
  const cur = steps.find((s) => stepKind(s) === 'run') || steps.find((s) => s.name && s.name === job.step);
  // A failed step's note is shown in its own block below, so it is not repeated here.
  const now = (cur && stepKind(cur) !== 'fail' && (cur.doing || cur.note)) || job.note
    || (kind === 'wait' ? 'Waiting to start.' : kind === 'done' ? 'All steps are done.' : kind === 'run' && cur ? `Working on ${cur.name}.` : '');
  const gone = kind === 'gone' ? '<p class="fcnote bad"><span class="dot r"></span>This video says it is running, but the program working on it has stopped.</p>' : '';
  const np = job.needs_person && typeof job.needs_person === 'object' ? job.needs_person : null;
  const since = np ? kelowna(np.since) || np.since : '';
  const need = kind !== 'need' ? '' : `<div class="fcneed">
<b>Needs you</b>
${np ? `${row('Step', np.step)}${row('Why', np.why)}${row('Look at', np.look_at)}${row('Since', since)}` : row('Why', job.note || 'The video program is waiting for a person.')}
</div>`;
  const fails = steps.filter((s) => stepKind(s) === 'fail').map((s) => `<div class="fcfail">
<b>${esc(s.name)} failed${num(s.tries) && s.tries > 1 ? ` after ${esc(plural(s.tries, 'try', 'tries'))}` : ''}</b>
${row('What happened', s.note || 'No reason was given.')}${row('How to fix it', s.fix)}
</div>`).join('\n');
  const final = job.final ? `<div class="fcrow fcfinal"><span class="mut">Finished file</span><span>${esc(job.final)}</span></div>` : '';
  return `<section class="card fcjob" data-job="${esc(job.id)}" data-kind="${esc(kind)}">
<div class="hd" style="flex-wrap: wrap"><h2>${esc(job.id)}</h2><span class="mut">${esc(meta)}</span><span class="pill ${K.pill} sp">${esc(K.label)}${esc(mins)}</span></div>
${need}
${steps.length ? `<div class="fcsteps" role="list" aria-label="Steps">${steps.map(chip).join('')}</div>` : ''}
${gone}${now && !(kind === 'need' && !np && now === job.note) ? `<p class="fcnow">${esc(now)}</p>` : ''}
${fails}
${final}
</section>`;
}

// "2026-11-11T23:36:42Z  nora-5   pack   started   pid 2732" -> its Kelowna time and the rest, columns joined by dots.
function eventHtml(e, i) {
  const m = /^(\S+)\s+(.*)$/.exec(String(e ?? '').trim());
  const at = m ? kelowna(m[1]) : '';
  const rest = (at ? m[2] : String(e ?? '')).trim().split(/\s{2,}/).filter(Boolean).join(' · ');
  return `<div class="fcev${i === 0 ? ' first' : ''}"><span class="mut">${esc(at)}</span><span>${esc(rest)}</span></div>`;
}

export function renderFactory(d3resp, ui = {}, d2resp = null) {
  const F = d3resp?.d3?.factory;
  const head = headerOnly(d2resp, 'Factory', 'Every video being made, step by step');
  if (!F || typeof F !== 'object') {
    return `${head}
<section class="card"><p class="mut">No feed: the video program has not reported.</p></section>`;
  }
  const nowMs = num(ui.now) ? ui.now : Date.parse(d3resp?.asOf);
  const age = (iso) => (Number.isFinite(nowMs) && Number.isFinite(Date.parse(iso)) ? agoShort(nowMs - Date.parse(iso)) : '');
  const jobs = factoryJobs(F);
  const kinds = jobs.map(kindOf);
  const count = (key, k) => (num(F.counts?.[key]) ? F.counts[key] : kinds.filter((x) => (Array.isArray(k) ? k.includes(x) : x === k)).length);
  const c = { jobs: num(F.counts?.jobs) ? F.counts.jobs : jobs.length, running: count('running', ['run', 'gone']), done: count('done', 'done'), need: count('needs_person', 'need') };
  const updated = age(F.updated || F.at);
  const notes = [
    F.stale ? `<p class="fcnote bad" role="status"><span class="dot r"></span>The video program is not reporting.${age(F.at) ? ` Its last report came ${esc(age(F.at))}, so what you see below may be out of date.` : ''}</p>` : '',
    F.scheduler_running === false ? '<p class="fcnote bad" role="status"><span class="dot r"></span>The scheduler is not running. No video will move to its next step until it is started again.</p>'
      : F.scheduler_running == null ? '<p class="fcnote grey"><span class="dot"></span>The video program did not say whether the scheduler is running.</p>' : '',
  ].filter(Boolean).join('\n');
  const unread = list(F.unreadable_jobs);
  const summary = `<section class="card" style="gap: 10px; padding: 16px 22px">
<div class="hd" style="flex-wrap: wrap; gap: 8px"><b>${esc(plural(c.jobs, 'video'))}</b><span class="pill">${c.running} running</span><span class="pill ${c.done ? 'ok' : ''}">${c.done} done</span><span class="pill ${c.need ? 'bad' : ''}">${c.need === 1 ? '1 needs you' : `${c.need} need you`}</span><span class="mut sp">${updated ? `updated ${esc(updated)}` : ''}</span></div>
${notes}${unread.length ? `\n<p class="mut">${esc(plural(unread.length, 'video'))} could not be read: ${esc(unread.join(', '))}</p>` : ''}
</section>`;
  const cards = jobs.length ? jobs.map(jobHtml).join('\n') : '<section class="card"><p class="mut">No videos are being made right now.</p></section>';
  const events = list(F.events).filter((e) => typeof e === 'string').reverse();
  return `${head}
${summary}
<div class="fclist${F.stale ? ' fcstale' : ''}">
${cards}
</div>
<section class="card" style="gap: 0">
<div class="hd cardhd"><span class="chip">${icon('list')}</span><h2>Latest events</h2><span class="mut sp">${events.length ? 'newest first, Kelowna time' : ''}</span></div>
${events.length ? events.map(eventHtml).join('\n') : '<p class="mut" style="padding-top: 14px">No events yet.</p>'}
</section>`;
}
