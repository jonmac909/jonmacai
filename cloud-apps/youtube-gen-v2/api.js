function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function topOutliers(rows, n = 3) {
  return [...(rows || [])]
    .filter((r) => r && r.title)
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
      }).filter(Boolean);
      return json(list);
    }
    if (request.method === 'PUT') {
      if (request.headers.get('X-YT2') !== '1') return json({ error: 'Missing header' }, 403);
      let list = [];
      try { list = await request.json(); } catch { list = []; }
      if (!Array.isArray(list)) return json({ error: 'Bad projects' }, 400);
      const now = new Date().toISOString();
      await env.DB.prepare('DELETE FROM video_projects').run();
      for (const p of list) {
        if (!p || !p.id) continue;
        await env.DB.prepare('INSERT INTO video_projects (id, data, updated_at) VALUES (?, ?, ?)')
          .bind(String(p.id), JSON.stringify(p), now).run();
      }
      return json({ ok: true, n: list.length });
    }
  }
  return json({ error: 'Not found' }, 404);
}
