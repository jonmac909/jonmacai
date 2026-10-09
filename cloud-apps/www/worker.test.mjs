import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

test("canonical redirect preserves encoded paths and the entire query string", () => {
  for (const suffix of ["/", "/clone", "/clone/audit.html?utm_source=www&x=a%2Bb&x=2", "/a%2Fb/%E2%9C%93?q=%26%3D&empty="]) {
    const response = worker.fetch(new Request(`https://www.jonmac.ai${suffix}`), {});
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), `https://jonmac.ai${suffix}`);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.body, null);
  }
});

test("redirect uses the fixed HTTPS destination and drops incoming ports", () => {
  const response = worker.fetch(new Request("http://preview.workers.dev:8787/login?next=https%3A%2F%2Fexample.com"));
  assert.equal(response.headers.get("Location"), "https://jonmac.ai/login?next=https%3A%2F%2Fexample.com");
});

test("HEAD and form/API methods receive a method-preserving redirect", () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const request = new Request("https://www.jonmac.ai/api/example?x=1", { method });
    const response = worker.fetch(request, {});
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), "https://jonmac.ai/api/example?x=1");
    assert.equal(response.body, null);
  }
});

test("Cloudflare version metadata identifies the deployed commit", () => {
  const response = worker.fetch(new Request("https://www.jonmac.ai/"), {
    SITE_VERSION: { tag: "0123456789abcdef", id: "version-id" },
  });
  assert.equal(response.headers.get("X-Site-Commit"), "0123456789abcdef");
  assert.equal(response.headers.get("X-Site-Version"), "version-id");
});
