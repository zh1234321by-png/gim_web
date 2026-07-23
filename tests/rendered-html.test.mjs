import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the SEGM home page", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /SEGM/);
  assert.match(html, /IONO00XAN1/);
  assert.match(html, /LIVE IONOSPHERE/);
  assert.match(html, /全球电离层/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server-renders the real-time observatory", async () => {
  const response = await render("/observatory");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /IONOSPHERE OBSERVATORY/);
  assert.match(html, /IONO00XAN1/);
  assert.match(html, /全球电离层实时观测台/);
  assert.match(html, /IGS SSR 4076\.201/);
});

test("ships the real-time bridge, high-resolution map source, and sample fallback", async () => {
  const [bridge, map, sample] = await Promise.all([
    readFile(new URL("../scripts/realtime_gim_bridge.py", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TecMap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/realtime/demo.json", import.meta.url), "utf8"),
  ]);

  assert.match(bridge, /IONO00XAN1/);
  assert.match(bridge, /4076_201/);
  assert.match(bridge, /\/series\.json/);
  assert.match(map, /gim-viewer\.html/);
  assert.match(map, /COASTLINES/);
  assert.match(map, /series\.json/);

  const payload = JSON.parse(sample);
  assert.ok(payload.frames.length >= 2);
  assert.equal(payload.frames.at(-1).source.mountpoint, "IONO00XAN1");
  assert.equal(payload.grid.lat.length, 71);
  assert.equal(payload.grid.lon.length, 73);
  assert.equal(payload.frames.at(-1).values.length, 71 * 73);

  await access(new URL("../scripts/实时观测台部署说明.md", import.meta.url));
});
