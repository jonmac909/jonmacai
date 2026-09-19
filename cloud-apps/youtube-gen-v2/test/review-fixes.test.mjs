import test from 'node:test';
import assert from 'node:assert/strict';
import { handleYt2Api } from '../api.js';

function memDb() {
  const projects = new Map();
  return {
    projects,
    prepare(sql) {
      const s = String(sql);
      const stmt = {
        _args: [],
        bind(...args) { stmt._args = args; return stmt; },
        async all() { return { results: [...projects.values()] }; },
        async run() {
          if (/DELETE FROM video_projects\s*$/.test(s) || /DELETE FROM video_projects;?$/.test(s)) {
            projects.clear();
          } else if (/DELETE FROM video_projects WHERE/.test(s)) {
            const like = String(stmt._args[0] || '');
            for (const id of [...projects.keys()]) {
              if (like.includes('%') ? id.startsWith(like.replace('%', '')) : id === like) projects.delete(id);
            }
          } else if (/INSERT/.test(s)) {
            projects.set(stmt._args[0], { id: stmt._args[0], data: stmt._args[1], updated_at: stmt._args[2] });
          }
        },
      };
      return stmt;
    },
  };
}

test('yt2 PUT does not wipe command-center video_projects rows', async () => {
  const DB = memDb();
  DB.projects.set('cc-pipeline', {
    id: 'cc-pipeline',
    data: JSON.stringify({ id: 'cc-pipeline', titleOptions: ['Dash video'] }),
    updated_at: 't0',
  });
  const res = await handleYt2Api(new Request('https://jonmac.ai/yt2/api/projects', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-YT2': '1' },
    body: JSON.stringify([{ id: 'mine', titleOptions: ['Yt2'], templateId: 'trend_to_revenue' }]),
  }), { DB });
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(DB.projects.get('cc-pipeline'), 'CC row must survive');
  const ids = [...DB.projects.keys()];
  assert.ok(ids.some((id) => id.includes('mine') || id.startsWith('yt2:')));
});

test('yt2 GET does not return command-center pipeline rows', async () => {
  const DB = memDb();
  DB.projects.set('cc-pipeline', {
    id: 'cc-pipeline',
    data: JSON.stringify({ id: 'cc-pipeline', titleOptions: ['Dash video'] }),
    updated_at: 't0',
  });
  DB.projects.set('yt2:mine', {
    id: 'yt2:mine',
    data: JSON.stringify({ id: 'yt2:mine', origin: 'yt2', titleOptions: ['Yt2'] }),
    updated_at: 't1',
  });
  const res = await handleYt2Api(new Request('https://jonmac.ai/yt2/api/projects'), { DB });
  const list = await res.json();
  assert.equal(list.some((p) => p.id === 'cc-pipeline' || p.id === 'Dash video'), false);
  assert.ok(list.some((p) => String(p.id).includes('mine')));
});

test('yt2 refresh proxy is gone so /yt cookies are not stripped', async () => {
  const res = await handleYt2Api(new Request('https://jonmac.ai/yt2/api/refresh', { method: 'POST' }), {});
  assert.equal(res.status, 404);
});

test('yt2 remake persists template and reports missing renderer', async () => {
  const DB = memDb();
  const res = await handleYt2Api(new Request('https://jonmac.ai/yt2/api/remake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-YT2': '1' },
    body: JSON.stringify({ id: 'abc', templateId: 'brand_build', sourceId: 'vid', title: 'AI UGC ads' }),
  }), { DB });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.missing.includes('render worker'));
  const stored = JSON.parse(DB.projects.get('yt2:abc').data);
  assert.equal(stored.templateId, 'brand_build');
  assert.equal(stored.source.id, 'vid');
});
