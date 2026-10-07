// A reviewable static preview under /clone; production APIs stay on Cloudflare.
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = new URL('../public/', import.meta.url);
const output = new URL('../.netlify-preview/', import.meta.url);
await mkdir(new URL('clone/', output), { recursive: true });
await cp(source, new URL('clone/', output), {
  recursive: true, filter: path => !path.endsWith('_headers'),
});
await writeFile(new URL('_redirects', output), '/ /clone/ 302\n/clone /clone/ 302\n');
await writeFile(new URL('_headers', output), '/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-cache\n');
console.log('Clone static preview prepared at ' + fileURLToPath(output));
