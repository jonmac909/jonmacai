export function parseStamp(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number' && Number.isFinite(v)) return v > 0 && v < 1e12 ? v * 1000 : v;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    return n > 0 && n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(s);
}
