export function memD1() {
  const snapshots = new Map();
  const actions = [];
  const deals = new Map();
  const ideas = new Map();
  const projects = new Map();
  const posts = new Map();
  const habits = new Map();
  const checklist = new Map();
  const drafts = new Map();
  return {
    snapshots,
    actions,
    deals,
    ideas,
    projects,
    posts,
    habits,
    checklist,
    drafts,
    prepare(sql) {
      const s = String(sql);
      const stmt = {
        _args: [],
        bind(...args) {
          stmt._args = args;
          return stmt;
        },
        async first() {
          const a = stmt._args;
          if (/FROM snapshots WHERE source/.test(s)) return snapshots.get(a[0]) || null;
          if (/FROM actions WHERE idem_key/.test(s)) return actions.find((x) => x.idem_key === a[0]) || null;
          if (/FROM actions WHERE id/.test(s)) return actions.find((x) => x.id === a[0]) || null;
          if (/FROM ideas WHERE id/.test(s)) return ideas.get(a[0]) || null;
          if (/FROM posts WHERE id/.test(s)) return posts.get(a[0]) || null;
          return null;
        },
        async all() {
          const a = stmt._args;
          if (/FROM snapshots/.test(s)) return { results: [...snapshots.values()] };
          if (/FROM deal_stage_overrides/.test(s)) {
            return { results: [...deals.entries()].map(([deal_id, row]) => ({ deal_id, stage: row.stage || row })) };
          }
          if (/FROM ideas/.test(s)) return { results: [...ideas.values()] };
          if (/FROM video_projects/.test(s)) return { results: [...projects.values()] };
          if (/FROM posts/.test(s)) return { results: [...posts.values()] };
          if (/FROM checklist/.test(s)) {
            return { results: [...checklist.values()].filter((r) => !a[0] || r.day === a[0]) };
          }
          if (/FROM habits/.test(s)) return { results: [...habits.values()] };
          if (/FROM content_drafts/.test(s)) {
            return { results: [...drafts.values()].filter((r) => !a[0] || r.tenant === a[0]) };
          }
          if (/FROM actions WHERE kind/.test(s)) {
            const rows = actions.filter((x) => x.kind === a[0]).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
            return { results: rows.slice(0, 1) };
          }
          if (/FROM actions WHERE target/.test(s)) {
            return {
              results: actions
                .filter((x) => x.target === a[0] && x.status === 'queued')
                .slice(0, 10)
                .map((x) => ({ ...x })),
            };
          }
          return { results: [] };
        },
        async run() {
          const a = stmt._args;
          if (/INSERT OR REPLACE INTO snapshots/.test(s)) {
            snapshots.set(a[0], { source: a[0], data: a[1], collected_at: a[2], received_at: a[3] });
          } else if (/INSERT OR REPLACE INTO checklist/.test(s)) {
            checklist.set(`${a[0]}|${a[1]}`, { day: a[0], item: a[1], done_at: a[2], how: a[3] });
          } else if (/INSERT OR REPLACE INTO habits/.test(s)) {
            habits.set(`${a[0]}|${a[1]}`, { day: a[0], kind: a[1], done: a[2], note: a[3] });
          } else if (/INSERT OR REPLACE INTO ideas/.test(s)) {
            ideas.set(a[0], {
              id: a[0], title: a[1], body: a[2], area: a[3], verdict: a[4],
              status: a[5], created_at: a[6], updated_at: a[7],
            });
          } else if (/INSERT OR REPLACE INTO posts/.test(s)) {
            posts.set(a[0], {
              id: a[0], platform: a[1], posted_at: a[2], url: a[3], first_line: a[4], source: a[5],
            });
          } else if (/INSERT INTO actions/.test(s)) {
            actions.push({
              id: a[0], kind: a[1], target: a[2], payload: a[3], status: a[4],
              result: a[5], idem_key: a[6], created_at: a[7], finished_at: a[8], claimed_at: null,
            });
          } else if (/DELETE FROM video_projects/.test(s)) {
            projects.clear();
          } else if (/INSERT INTO video_projects/.test(s)) {
            projects.set(a[0], { id: a[0], data: a[1], updated_at: a[2] });
          } else if (/INSERT OR REPLACE INTO deal_stage_overrides/.test(s)) {
            deals.set(a[0], { deal_id: a[0], stage: a[1], updated_at: a[2] });
          } else if (/INSERT OR IGNORE INTO content_drafts/.test(s)) {
            const key = `${a[1]}|${a[2]}|${a[3]}|${a[4]}`;
            const clash = drafts.has(a[0]) || [...drafts.values()].some((r) => `${r.tenant}|${r.day}|${r.platform}|${r.slot}` === key);
            if (clash) return { success: true, meta: { changes: 0 } };
            drafts.set(a[0], {
              id: a[0], tenant: a[1], day: a[2], platform: a[3], slot: a[4],
              body: a[5], subject: a[6], first_line: a[7], status: a[8],
              source: a[9], error: a[10], updated_at: a[11],
            });
            return { success: true, meta: { changes: 1 } };
          } else if (/UPDATE content_drafts SET body/.test(s)) {
            const row = drafts.get(a[3]);
            if (!row || row.tenant !== a[4]) return { success: true, meta: { changes: 0 } };
            row.body = a[0];
            row.first_line = a[1];
            row.status = 'edited';
            row.updated_at = a[2];
            row.error = '';
            return { success: true, meta: { changes: 1 } };
          } else if (/UPDATE content_drafts SET status = 'approved'/.test(s)) {
            const row = drafts.get(a[1]);
            if (!row || row.tenant !== a[2]) return { success: true, meta: { changes: 0 } };
            row.status = 'approved';
            row.updated_at = a[0];
            return { success: true, meta: { changes: 1 } };
          } else if (/status = 'claimed'/.test(s)) {
            const row = actions.find((x) => x.id === a[1] && x.status === 'queued');
            if (row) {
              row.status = 'claimed';
              row.claimed_at = a[0];
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          } else if (/SET payload/.test(s)) {
            const row = actions.find((x) => x.id === a[1]);
            if (row) row.payload = a[0];
          } else if (/UPDATE actions SET status/.test(s) && /finished_at/.test(s)) {
            const row = actions.find((x) => x.id === a[3]);
            if (row) {
              row.status = a[0];
              row.result = a[1];
              row.finished_at = a[2];
            }
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}
