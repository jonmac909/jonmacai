// Test-only module loader: the Worker ships with NEXT_SESSION = null (no live date, nothing sells).
// The sales-flow tests still need a dated session, so this swaps in Thu Nov 12 2026, 4 PM PT, the date
// those tests were written for. CLONE_TEST_NEXT_SESSION=null keeps the shipped null.
export const TEST_SESSION = 'Date.UTC(2026, 10, 13, 0, 0, 0)';
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith('/src/reminder-plan.js') && process.env.CLONE_TEST_NEXT_SESSION !== 'null') {
    const source = String(result.source), swapped = source.replace('export const NEXT_SESSION = null;', 'export const NEXT_SESSION = ' + TEST_SESSION + ';');
    if (swapped === source) throw new Error('NEXT_SESSION line not found in reminder-plan.js');
    return { ...result, source: swapped };
  }
  return result;
}
