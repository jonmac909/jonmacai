// A stand-in for Cloudflare DNS-over-HTTPS in tests: every domain has an MX unless a test says otherwise.
// stubDns({ 'nomail.test': 'none', 'slow.test': 'timeout', 'aonly.test': 'a', 'broken.test': 'servfail' }) ; calls are recorded in stubDns.calls.
const real = globalThis.fetch;
export const calls = [];
let rules = {};
export function stubDns(map = {}) { rules = map; calls.length = 0; }
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'cloudflare-dns.com') return real(input, init);
  const name = url.searchParams.get('name'), type = url.searchParams.get('type');
  calls.push(`${name}/${type}`);
  const rule = rules[name] || 'mx';
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/dns-json' } });
  if (rule === 'timeout') return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
  if (rule === 'servfail') return json({ Status: 2 });
  if (rule === 'none') return json({ Status: 3 });
  if (rule === 'noanswer') return json({ Status: 0 });
  if (rule === 'nullmx') return json({ Status: 0, Answer: type === 'MX' ? [{ type: 15, data: '0 .' }] : [] });
  if (rule === 'a') return json({ Status: 0, Answer: type === 'A' ? [{ type: 1, data: '192.0.2.1' }] : [] });
  return json({ Status: 0, Answer: type === 'MX' ? [{ type: 15, data: `10 mx.${name}.` }] : [] });
};
