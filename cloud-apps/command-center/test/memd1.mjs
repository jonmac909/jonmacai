export function memD1() {
  const snapshots = new Map();
  const actions = [];
  return {
    snapshots,
    actions,
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
          return null;
        },
        async all() {
          const a = stmt._args;
          if (/FROM snapshots/.test(s)) return { results: [...snapshots.values()] };
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
          } else if (/INSERT INTO actions/.test(s)) {
            actions.push({
              id: a[0], kind: a[1], target: a[2], payload: a[3], status: a[4],
              result: a[5], idem_key: a[6], created_at: a[7], finished_at: a[8], claimed_at: null,
            });
          } else if (/status = 'claimed'/.test(s)) {
            const row = actions.find((x) => x.id === a[1] && x.status === 'queued');
            if (row) {
              row.status = 'claimed';
              row.claimed_at = a[0];
            }
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
          return { success: true };
        },
      };
      return stmt;
    },
  };
}
