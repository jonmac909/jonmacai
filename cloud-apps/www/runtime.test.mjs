import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

test("Workers runtime preserves root, nested paths and queries for GET and HEAD", async () => {
  const runtime = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("./worker.mjs", import.meta.url)),
    compatibilityDate: "2026-08-01",
  });
  try {
    for (const method of ["GET", "HEAD", "POST"]) {
      for (const path of ["/", "/clone/software.html?utm_source=www&x=a%2Bb", "/a%2Fb?q=%26%3D"]) {
        const response = await runtime.dispatchFetch(`https://www.jonmac.ai${path}`, { method, redirect: "manual" });
        assert.equal(response.status, 308);
        assert.equal(response.headers.get("Location"), `https://jonmac.ai${path}`);
        assert.equal(await response.text(), "");
      }
    }
  } finally {
    await runtime.dispose();
  }
});
