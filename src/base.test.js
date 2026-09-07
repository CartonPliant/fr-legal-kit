import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  keccak256,
  bytesToHex,
  namehash,
  isqrt,
  priceUsdFromSqrt,
  resolveToken,
  parseFeeHistory,
  basePrice,
  baseGas,
  baseEns,
  BASE_ADDRS,
} from "./base.js";
import worker from "./worker.js";

const env = { PAY_TO: "0xc361074554c13EEE51feab63ED180EF6b9911B3e" };

describe("keccak256", () => {
  it("matches Ethereum empty hash", () => {
    assert.equal(
      bytesToHex(keccak256(new Uint8Array(0))),
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });
  it("hashes the getPool selector", () => {
    const h = bytesToHex(keccak256("getPool(address,address,uint24)"));
    assert.equal(h.slice(0, 10), "0x1698ee82");
  });
});

describe("namehash", () => {
  it("hashes vitalik.eth", () => {
    assert.equal(
      bytesToHex(namehash("vitalik.eth")),
      "0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835",
    );
  });
  it("hashes the eth tld", () => {
    assert.equal(
      bytesToHex(namehash("eth")),
      "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae",
    );
  });
});

describe("priceUsdFromSqrt", () => {
  it("round-trips a $2000 token0 (WETH-like)", () => {
    const target = (2000n * 10n ** 6n * (1n << 192n)) / 10n ** 18n;
    const sqrtP = isqrt(target);
    const usd = priceUsdFromSqrt(sqrtP, true, 18, 6);
    assert.ok(Math.abs(usd - 2000) < 0.01, usd);
  });
  it("round-trips a token1 (USDC is token0)", () => {
    const sq = (10n ** 8n * (1n << 192n)) / (50000n * 10n ** 6n);
    const sqrtP = isqrt(sq);
    const usd = priceUsdFromSqrt(sqrtP, false, 8, 6);
    assert.ok(Math.abs(usd - 50000) / 50000 < 0.001, String(usd));
  });
});

describe("resolveToken", () => {
  it("maps WETH ticker", () => {
    const r = resolveToken("WETH");
    assert.equal(r.ok, true);
    assert.equal(r.token, BASE_ADDRS.WETH.toLowerCase());
  });
  it("accepts a 0x address", () => {
    const r = resolveToken(BASE_ADDRS.USDC);
    assert.equal(r.ok, true);
    assert.equal(r.token, BASE_ADDRS.USDC.toLowerCase());
  });
  it("rejects garbage", () => {
    const r = resolveToken("not-a-token");
    assert.equal(r.ok, false);
  });
});

describe("parseFeeHistory", () => {
  it("reads last base fee and 21k transfer", () => {
    const r = parseFeeHistory({
      oldestBlock: "0x10",
      baseFeePerGas: ["0x5", "0x3b9aca00"],
      reward: [
        ["0x1", "0x2", "0x3"],
        ["0x3b9aca00", "0x77359400", "0xb2d05e00"],
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.base_fee_wei, String(1e9));
    assert.equal(r.base_fee_gwei, 1);
    assert.equal(r.tip_gwei.mid, 2);
    assert.equal(r.transfer_21k_wei, String(21000n * (1000000000n + 2000000000n)));
  });
});

function jsonRpc(result) {
  return {
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

describe("basePrice", () => {
  it("returns 1 USD for USDC without RPC", async () => {
    const r = await basePrice({ token: "USDC" }, { fetch: async () => {
      throw new Error("should not rpc");
    } });
    assert.equal(r.ok, true);
    assert.equal(r.usd, 1);
  });
  it("reads WETH from a mocked slot0", async () => {
    const target = (2500n * 10n ** 6n * (1n << 192n)) / 10n ** 18n;
    const sqrtP = isqrt(target);
    const slotData = "0x" + sqrtP.toString(16).padStart(64, "0") + "0".repeat(64 * 6);
    const r = await basePrice(
      { token: "WETH" },
      {
        fetch: async () => jsonRpc(slotData),
      },
    );
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.usd - 2500) < 1, r.usd);
    assert.equal(r.pool, BASE_ADDRS.WETH_USDC_POOL.toLowerCase());
  });
});

describe("baseGas", () => {
  it("parses feeHistory from RPC", async () => {
    const r = await baseGas(
      {},
      {
        fetch: async () =>
          jsonRpc({
            oldestBlock: "0xabc",
            baseFeePerGas: ["0x5f5e100"],
            reward: [["0x1", "0x2", "0x3"]],
          }),
      },
    );
    assert.equal(r.ok, true);
    assert.equal(r.chain_id, 8453);
    assert.equal(r.asof_block, "0xabc");
  });
});

describe("baseEns", () => {
  it("rejects a name without a dot", async () => {
    const r = await baseEns({ name: "vitalik" });
    assert.equal(r.ok, false);
  });
  it("resolves a mocked registry+resolver", async () => {
    let n = 0;
    const resolver = "0x4976fb03c32e5b8cfe2b6ccb31c1408a9bd23873";
    const addr = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const r = await baseEns(
      { name: "vitalik.eth" },
      {
        fetch: async () => {
          n += 1;
          if (n === 1) return jsonRpc("0x" + resolver.slice(2).padStart(64, "0"));
          return jsonRpc("0x" + addr.slice(2).padStart(64, "0"));
        },
      },
    );
    assert.equal(r.ok, true);
    assert.equal(r.address, addr);
    assert.equal(r.resolver, resolver);
  });
});

describe("paid routes 402 without payment", () => {
  for (const path of ["/v1/base-price", "/v1/base-gas", "/v1/base-ens"]) {
    it(`POST ${path} is 402`, async () => {
      const res = await worker.fetch(
        new Request(`https://fr-legal-kit.example${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        env,
      );
      assert.equal(res.status, 402);
      assert.ok(res.headers.get("payment-required"));
    });
  }
});
