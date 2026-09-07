import { describe, it } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const env = { PAY_TO: "0xc361074554c13EEE51feab63ED180EF6b9911B3e" };

async function hit(path, method) {
  return worker.fetch(new Request(`https://fr-legal-kit.example${path}`, { method }), env);
}

function isImage(res) {
  return (res.headers.get("content-type") || "").startsWith("image/");
}

describe("favicon for x402scan scrapeFavicon", () => {
  it("HEAD /favicon.ico is 200 with image/* (no GET fallback on 404)", async () => {
    const res = await hit("/favicon.ico", "HEAD");
    assert.equal(res.status, 200);
    assert.ok(isImage(res), res.headers.get("content-type"));
    assert.equal(await res.text(), "");
  });

  it("GET /favicon.ico is 200 ICO bytes", async () => {
    const res = await hit("/favicon.ico", "GET");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/x-icon");
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 16);
    assert.equal(buf[0], 0);
    assert.equal(buf[1], 0);
    assert.equal(buf[2], 1);
    assert.equal(buf[3], 0);
  });

  it("HEAD /favicon.png and /favicon.svg are 200 image/*", async () => {
    const png = await hit("/favicon.png", "HEAD");
    const svg = await hit("/favicon.svg", "HEAD");
    assert.equal(png.status, 200);
    assert.equal(svg.status, 200);
    assert.ok(isImage(png), png.headers.get("content-type"));
    assert.ok(isImage(svg), svg.headers.get("content-type"));
  });
});
