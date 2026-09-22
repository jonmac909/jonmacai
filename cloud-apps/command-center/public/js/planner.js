export function plannerPayload({ id, title, body, area }) {
  const name = String(title || 'Mastermind idea').trim();
  return {
    id,
    title: name,
    body: `Owner: ${area}\nSource: ${id}\n\n${body || ''}`.trim(),
    area,
    source: id,
    verdict: 'implement',
    msg: `Created "Planner - ${name.slice(0, 48)}" under Planner in Orca. Open that worktree.`,
  };
}
