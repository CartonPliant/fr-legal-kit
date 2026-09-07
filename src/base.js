const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const WETH_USDC_POOL = "0xd0b53D9277642d899DF5C87A3966A349A798F224";
const FEES = [500, 3000, 10000];

const TICKERS = {
  usdc: USDC,
  usd: USDC,
  weth: WETH,
  eth: WETH,
  cbbtc: CBBTC,
  btc: CBBTC,
};

const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.publicnode.com",
  "https://1rpc.io/base",
];
const ETH_RPCS = [
  "https://ethereum.publicnode.com",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];

const SEL = {
  getPool: "1698ee82",
  slot0: "3850c7bd",
  decimals: "313ce567",
  resolver: "0178b8bf",
  addr: "3b3b57de",
};

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const RHO = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const MASK64 = (1n << 64n) - 1n;

function rotl64(x, n) {
  const s = BigInt(n % 64);
  x &= MASK64;
  if (s === 0n) return x;
  return ((x << s) | (x >> (64n - s))) & MASK64;
}

function keccakf(st) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) st[x + 5 * y] = (st[x + 5 * y] ^ D) & MASK64;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + ((2 * x + 3 * y) % 5) * 5] = rotl64(st[x + 5 * y], RHO[x + 5 * y]);
      }
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        st[x + 5 * y] = (B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y])) & MASK64;
      }
    }
    st[0] = (st[0] ^ KECCAK_RC[round]) & MASK64;
  }
}

function load64le(bytes, off) {
  let n = 0n;
  for (let i = 0; i < 8; i++) n |= BigInt(bytes[off + i]) << BigInt(8 * i);
  return n;
}

function store64le(bytes, off, n) {
  for (let i = 0; i < 8; i++) bytes[off + i] = Number((n >> BigInt(8 * i)) & 0xffn);
}

export function keccak256(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const st = new BigUint64Array(25);
  const rate = 136;
  const buf = new Uint8Array(rate);
  let offset = 0;
  const xorBlock = () => {
    for (let i = 0; i < 17; i++) st[i] ^= load64le(buf, i * 8);
    keccakf(st);
  };
  for (let i = 0; i < data.length; i++) {
    buf[offset++] = data[i];
    if (offset === rate) {
      xorBlock();
      buf.fill(0);
      offset = 0;
    }
  }
  buf[offset] ^= 0x01;
  buf[rate - 1] ^= 0x80;
  xorBlock();
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) store64le(out, i * 8, st[i]);
  return out;
}

export function bytesToHex(b) {
  let s = "0x";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(h) {
  const s = String(h).replace(/^0x/i, "");
  if (s.length % 2) return hexToBytes("0" + s);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function namehash(name) {
  let node = new Uint8Array(32);
  const n = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
  if (!n) return node;
  const labels = n.split(".");
  for (let i = labels.length - 1; i >= 0; i--) {
    const labelHash = keccak256(new TextEncoder().encode(labels[i]));
    const cat = new Uint8Array(64);
    cat.set(node, 0);
    cat.set(labelHash, 32);
    node = keccak256(cat);
  }
  return node;
}

export function isqrt(n) {
  n = BigInt(n);
  if (n < 0n) throw new Error("neg");
  if (n < 2n) return n;
  let x0 = n;
  let x1 = (n >> 1n) + 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + n / x1) >> 1n;
  }
  return x0;
}

export function priceUsdFromSqrt(sqrtPriceX96, tokenIsToken0, decToken, decQuote = 6) {
  const sqrt = BigInt(sqrtPriceX96);
  if (sqrt === 0n) return 0;
  const decT = BigInt(decToken);
  const decQ = BigInt(decQuote);
  const scale = 10n ** 12n;
  const two192 = 1n << 192n;
  const sq = sqrt * sqrt;
  let scaled;
  if (tokenIsToken0) {
    scaled = (sq * 10n ** decT * scale) / (two192 * 10n ** decQ);
  } else {
    if (sq === 0n) return 0;
    scaled = (two192 * 10n ** decT * scale) / (sq * 10n ** decQ);
  }
  return Number(scaled) / 1e12;
}

function normAddr(a) {
  const s = String(a || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) return null;
  return "0x" + s.slice(2).toLowerCase();
}

export function resolveToken(input) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "token required (ticker or 0x)" };
  const addr = normAddr(raw);
  if (addr) return { ok: true, token: addr, ticker: null };
  const t = raw.toLowerCase().replace(/^\$/, "");
  if (TICKERS[t]) return { ok: true, token: TICKERS[t].toLowerCase(), ticker: t };
  return { ok: false, error: "unknown ticker; pass 0x address" };
}

function pad32(hexNoPrefix) {
  return hexNoPrefix.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
}

function encodeGetPool(a, b, fee) {
  return (
    "0x" +
    SEL.getPool +
    pad32(a) +
    pad32(b) +
    pad32(Number(fee).toString(16))
  );
}

function wordAddr(data) {
  const s = String(data || "").replace(/^0x/i, "").toLowerCase();
  if (s.length < 40) return null;
  const a = "0x" + s.slice(-40);
  if (a === "0x0000000000000000000000000000000000000000") return null;
  return a;
}

function wordUint(data) {
  const s = String(data || "").replace(/^0x/i, "");
  if (!s) return 0n;
  return BigInt("0x" + s.slice(0, 64));
}

async function rpcCall(urls, method, params, fetchImpl) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let last = "rpc_unavailable";
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "fr-legal-kit/1.2",
        },
        body,
      });
      const j = await res.json().catch(() => ({}));
      if (j && j.error) {
        last = j.error.message || "rpc_error";
        continue;
      }
      if (j && j.result !== undefined) return { ok: true, result: j.result };
      last = `http_${res.status}`;
    } catch (e) {
      last = "rpc_network";
    }
  }
  return { ok: false, error: last };
}

async function ethCall(urls, to, data, fetchImpl) {
  return rpcCall(urls, "eth_call", [{ to, data }, "latest"], fetchImpl);
}

export async function basePrice(body, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const urls = deps.baseRpc || BASE_RPCS;
  const resolved = resolveToken((body && (body.token || body.address || body.symbol)) || "");
  if (!resolved.ok) return resolved;
  const token = resolved.token;
  if (token === USDC.toLowerCase()) {
    return { ok: true, token, ticker: resolved.ticker || "usdc", usd: 1, pool: null, quote: USDC.toLowerCase(), asof_block: "latest" };
  }

  let pool = null;
  let fee = null;
  if (token === WETH.toLowerCase()) {
    pool = WETH_USDC_POOL.toLowerCase();
    fee = 500;
  } else {
    for (const f of FEES) {
      const call = await ethCall(urls, FACTORY, encodeGetPool(token, USDC, f), fetchImpl);
      if (!call.ok) return { ok: false, error: call.error };
      const found = wordAddr(call.result);
      if (found) {
        pool = found;
        fee = f;
        break;
      }
    }
  }
  if (!pool) return { ok: false, error: "no_usdc_pool", token };

  const slot = await ethCall(urls, pool, "0x" + SEL.slot0, fetchImpl);
  if (!slot.ok) return { ok: false, error: slot.error };
  const sqrtP = wordUint(slot.result);
  if (sqrtP === 0n) return { ok: false, error: "empty_pool", pool };

  let dec = 18;
  if (token === CBBTC.toLowerCase()) dec = 8;
  else if (token !== WETH.toLowerCase()) {
    const d = await ethCall(urls, token, "0x" + SEL.decimals, fetchImpl);
    if (d.ok) {
      const n = Number(wordUint(d.result));
      if (n >= 0 && n <= 36) dec = n;
    }
  }

  const tokenIsToken0 = token < USDC.toLowerCase();
  const usd = priceUsdFromSqrt(sqrtP, tokenIsToken0, dec, 6);
  const rounded = usd >= 1 ? Math.round(usd * 1e6) / 1e6 : usd;
  return {
    ok: true,
    token,
    ticker: resolved.ticker,
    usd: rounded,
    pool,
    fee,
    quote: USDC.toLowerCase(),
    decimals: dec,
    asof_block: "latest",
  };
}

export function parseFeeHistory(result) {
  const baseFees = (result && result.baseFeePerGas) || [];
  const rewards = (result && result.reward) || [];
  const lastBase = baseFees.length ? BigInt(baseFees[baseFees.length - 1]) : 0n;
  const lastReward = rewards.length ? rewards[rewards.length - 1] : [];
  const tip = (i, fallback) => {
    const v = lastReward[i];
    return v !== undefined ? BigInt(v) : fallback;
  };
  const low = tip(0, 0n);
  const mid = tip(1, low);
  const high = tip(2, mid);
  const transfer = 21000n * (lastBase + mid);
  const gwei = (w) => Number(w) / 1e9;
  return {
    ok: true,
    chain: "base",
    chain_id: 8453,
    asof_block: result.oldestBlock || null,
    base_fee_wei: lastBase.toString(),
    base_fee_gwei: gwei(lastBase),
    tip_wei: { low: low.toString(), mid: mid.toString(), high: high.toString() },
    tip_gwei: { low: gwei(low), mid: gwei(mid), high: gwei(high) },
    transfer_21k_wei: transfer.toString(),
  };
}

export async function baseGas(body, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const urls = deps.baseRpc || BASE_RPCS;
  const hist = await rpcCall(urls, "eth_feeHistory", ["0x4", "latest", [10, 50, 90]], fetchImpl);
  if (hist.ok) return parseFeeHistory(hist.result);
  const gp = await rpcCall(urls, "eth_gasPrice", [], fetchImpl);
  if (!gp.ok) return { ok: false, error: gp.error };
  const wei = BigInt(gp.result);
  return parseFeeHistory({
    oldestBlock: null,
    baseFeePerGas: ["0x" + wei.toString(16)],
    reward: [["0x0", "0x0", "0x0"]],
  });
}

export async function baseEns(body, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const urls = deps.ethRpc || ETH_RPCS;
  const name = String((body && (body.name || body.ens)) || "")
    .trim()
    .toLowerCase();
  if (!name || !name.includes(".")) return { ok: false, error: "name required (e.g. vitalik.eth)" };
  if (name.length > 255) return { ok: false, error: "name too long" };
  const node = namehash(name);
  const nodeHex = bytesToHex(node);
  const resCall = await ethCall(urls, ENS_REGISTRY, "0x" + SEL.resolver + pad32(nodeHex), fetchImpl);
  if (!resCall.ok) return { ok: false, error: resCall.error, name, node: nodeHex };
  const resolver = wordAddr(resCall.result);
  if (!resolver) return { ok: false, error: "unresolved", name, node: nodeHex, resolver: null, address: null };
  const addrCall = await ethCall(urls, resolver, "0x" + SEL.addr + pad32(nodeHex), fetchImpl);
  if (!addrCall.ok) return { ok: false, error: addrCall.error, name, node: nodeHex, resolver };
  const address = wordAddr(addrCall.result);
  if (!address) return { ok: false, error: "no_addr", name, node: nodeHex, resolver, address: null };
  return { ok: true, name, node: nodeHex, resolver, address };
}

export const BASE_ADDRS = { USDC, WETH, CBBTC, FACTORY, ENS_REGISTRY, WETH_USDC_POOL };
