function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function yt2Id(id) {
  const s = String(id);
  return s.startsWith('yt2:') ? s : `yt2:${s}`;
}

function isYt2Project(p) {
  return Boolean(p) && (p.origin === 'yt2' || String(p.id || '').startsWith('yt2:'));
}

function asYt2(p) {
  const id = yt2Id(p.id);
  return { ...p, id, origin: 'yt2' };
}

function refreshRows(body) {
  if (Array.isArray(body?.rows)) return { rows: body.rows, listed: true };
  if (Array.isArray(body?.videos)) return { rows: body.videos, listed: true };
  if (Array.isArray(body?.items)) return { rows: body.items, listed: true };
  if (Array.isArray(body?.data)) return { rows: body.data, listed: true };
  if (Array.isArray(body?.data?.rows)) return { rows: body.data.rows, listed: true };
  return { rows: [], listed: false };
}
export function isAiUgc(title) {
  const t = String(title || '');
  if (!t) return false;
  if (/\bAI\s*UGC\b/i.test(t)) return true;
  if (/\bAI[- ]?video[- ]generation\b/i.test(t)) return true;
  return /\bUGC\b/i.test(t) && /\bAI\b/i.test(t);
}

export function topOutliers(rows, n = 3) {
  return [...(rows || [])]
    .filter((r) => r && r.title && isAiUgc(r.title))
    .sort((a, b) => Number(b.outlier_score || 0) - Number(a.outlier_score || 0))
    .slice(0, n);
}

async function rowsFromAssets(request, env) {
  const url = new URL('/rows_data.json', request.url);
  const res = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  if (!res.ok) return [];
  try {
    const data = await res.json();
    return Array.isArray(data) ? data : data.rows || [];
  } catch {
    return [];
  }
}

export async function handleYt2Api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (path.endsWith('/api/outliers') && request.method === 'GET') {
    const rows = await rowsFromAssets(request, env);
    const channels = new Set(rows.map((r) => r.channel).filter(Boolean)).size;
    return json({ outliers: topOutliers(rows), channels, ranked: rows.length });
  }
  if (path.endsWith('/api/projects')) {
    if (!env.DB) return json({ error: 'No database' }, 500);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT data FROM video_projects ORDER BY updated_at DESC').all();
      const list = (results || []).map((r) => {
        try { return JSON.parse(r.data); } catch { return null; }
      }).filter(isYt2Project);
      return json(list);
    }
    if (request.method === 'PUT') {
      if (request.headers.get('X-YT2') !== '1') return json({ error: 'Missing header' }, 403);
      let list = [];
      try { list = await request.json(); } catch { list = []; }
      if (!Array.isArray(list)) return json({ error: 'Bad projects' }, 400);
      const now = new Date().toISOString();
      // ponytail: upsert yt2 rows only; never DELETE FROM video_projects
      for (const p of list) {
        if (!p || !p.id) continue;
        const row = asYt2(p);
        await env.DB.prepare('INSERT OR REPLACE INTO video_projects (id, data, updated_at) VALUES (?, ?, ?)')
          .bind(row.id, JSON.stringify(row), now).run();
      }
      return json({ ok: true, n: list.length });
    }
  }
  if (path.endsWith('/api/refresh') && request.method === 'POST') {
    // Cookie Path=/ is required so /yt login cookies are sent to /yt2/api/refresh
    const cookie = request.headers.get('cookie') || '';
    const res = await fetch(new URL('/yt/api/channels/refresh', request.url), {
      method: 'POST',
      headers: { cookie, accept: 'application/json' },
      redirect: 'manual',
    }).catch(() => null);
    if (!res) return json({ ok: false, error: 'YouTube login service unreachable' }, 502);
    if (res.status === 307 || res.status === 302 || res.status === 401) {
      return json({ ok: false, needLogin: true, login: '/yt/login?next=/yt2/' }, 401);
    }
    const body = await res.json().catch(() => ({}));
    const mapped = refreshRows(body);
    const ok = Boolean(res.ok && mapped.listed);
    return json({
      ok,
      rows: mapped.rows,
      generatedAt: body.generatedAt,
      refreshed: body.refreshed,
      error: ok ? undefined : (body.error || 'No video rows'),
    }, ok ? 200 : (res.ok ? 200 : res.status));
  }
  if (path.endsWith('/api/remake') && request.method === 'POST') {
    if (request.headers.get('X-YT2') !== '1') return json({ error: 'Missing header' }, 403);
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    if (!env.DB) return json({ error: 'No database' }, 500);
    const id = yt2Id(body.id || `remake_${Date.now()}`);
    const project = {
      id,
      origin: 'yt2',
      createdAt: new Date().toISOString(),
      stage: 'script',
      templateId: body.templateId || 'trend_to_revenue',
      source: body.source || { id: body.sourceId, title: body.title || '' },
      titleOptions: [body.title || 'Remake'],
      selectedTitleIndex: 0,
      missing: ['script LLM', 'render worker'],
    };
    await env.DB.prepare('INSERT OR REPLACE INTO video_projects (id, data, updated_at) VALUES (?, ?, ?)')
      .bind(id, JSON.stringify(project), project.createdAt).run();
    return json({ ok: true, projectId: id, missing: project.missing, note: 'Project and template saved. Script LLM and render worker are not connected.' });
  }
  return json({ error: 'Not found' }, 404);
}
