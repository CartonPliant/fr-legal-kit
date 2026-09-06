import { latePenalties, einvoiceWho, checkSiret, checkIban } from "./legal.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AMOUNT = "10000"; // $0.01 USDC
const NETWORK = "eip155:8453";
const DEFAULT_FACILITATOR = "https://facilitator.payai.network";
const SERVICE = "fr-legal-kit";

function payTo(env) {
  const a = (env && env.PAY_TO) || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) return null;
  return a;
}

function facilitatorUrl(env) {
  return ((env && env.FACILITATOR_URL) || DEFAULT_FACILITATOR).replace(/\/$/, "");
}

function origin(req) {
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function b64json(obj) {
  const s = JSON.stringify(obj);
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(s)));
  return Buffer.from(s, "utf8").toString("base64");
}

function paymentRequired(req, env, resourcePath, description, tags, bazaar) {
  const to = payTo(env);
  const url = origin(req) + resourcePath;
  const body = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url,
      description,
      mimeType: "application/json",
      serviceName: SERVICE,
      tags,
    },
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        asset: USDC_BASE,
        amount: AMOUNT,
        payTo: to,
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
    extensions: { bazaar },
  };
  return new Response("{}", {
    status: 402,
    headers: {
      "content-type": "application/json",
      "payment-required": b64json(body),
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
    },
  });
}

function paymentHeader(req) {
  return (
    req.headers.get("PAYMENT-SIGNATURE") ||
    req.headers.get("payment-signature") ||
    req.headers.get("X-PAYMENT") ||
    req.headers.get("x-payment") ||
    ""
  );
}

async function settleIfPaid(req, env, requirements) {
  const header = paymentHeader(req);
  if (!header) return { paid: false };
  const fac = facilitatorUrl(env);
  const payload = { x402Version: 2, paymentHeader: header, paymentRequirements: requirements };
  const verify = await fetch(`${fac}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const verifyJson = await verify.json().catch(() => ({}));
  if (!verify.ok || verifyJson.isValid === false || verifyJson.success === false) {
    return { paid: false, error: verifyJson, status: verify.status };
  }
  const settle = await fetch(`${fac}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const settleJson = await settle.json().catch(() => ({}));
  if (!settle.ok && settle.status !== 200) {
    return { paid: false, error: settleJson, status: settle.status };
  }
  return { paid: true, settlement: settleJson };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });
}

function requirements(env) {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: USDC_BASE,
    amount: AMOUNT,
    payTo: payTo(env),
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };
}

async function handlePaid(req, env, path, description, tags, bazaar, fn) {
  const to = payTo(env);
  if (!to) return json({ error: "PAY_TO wallet not configured" }, 503);
  const paid = await settleIfPaid(req, env, requirements(env));
  if (!paid.paid) {
    if (paymentHeader(req)) {
      return json({ error: "payment_rejected", detail: paid.error || null }, 402);
    }
    return paymentRequired(req, env, path, description, tags, bazaar);
  }
  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const result = fn(body);
  const extra = {};
  if (paid.settlement) extra["payment-response"] = b64json({ settlement: paid.settlement });
  return json(result, 200, extra);
}

const ROUTES = {
  "/v1/late-penalties": {
    description:
      "French L441-10 late-payment: BCE+10pts interest + 40€ indemnity from amount_ht and days_late. No live BCE fetch.",
    tags: ["france", "invoice", "L441-10", "penalties", "legal"],
    bazaar: {
      info: {
        input: {
          type: "http",
          method: "POST",
          body: { amount_ht: 1000, days_late: 30, bce_refi_pct: 2.15 },
        },
        output: { type: "json", example: { ok: true, total_eur: 50.12, clause: "..." } },
      },
    },
    fn: latePenalties,
  },
  "/v1/einvoice-who": {
    description:
      "French e-invoice calendar: who must receive (2026-09-01 all) vs emit (GE/ETI 2026, PME/micro 2027). Size in, dates out. No registry lookup.",
    tags: ["france", "e-invoice", "facture-electronique", "pdp", "2026"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { size: "pme", as_of: "2026-09-07" } },
        output: {
          type: "json",
          example: { ok: true, receive: { obligatory_now: true }, emit: { obligatory_from: "2027-09-01" } },
        },
      },
    },
    fn: einvoiceWho,
  },
  "/v1/check-siret": {
    description: "SIRET/SIREN checksum (Luhn / La Poste). Does not call INSEE.",
    tags: ["france", "siret", "luhn", "checksum"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { siret: "44306184100047" } },
        output: { type: "json", example: { ok: true, type: "siret", rule: "luhn" } },
      },
    },
    fn: checkSiret,
  },
  "/v1/check-iban": {
    description: "IBAN ISO 13616 checksum. Does not prove the account exists.",
    tags: ["iban", "checksum", "payments"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { iban: "FR1420041010050500013M02606" } },
        output: { type: "json", example: { ok: true, country: "FR" } },
      },
    },
    fn: checkIban,
  },
};

function llmsTxt(base) {
  return `# fr-legal-kit

Offline French legal helpers for AI agents. No INSEE, no scrape, no PDP.

## Paid — $0.01 USDC on Base (eip155:8453) each POST

POST ${base}/v1/einvoice-who
JSON: { "size": "micro"|"pme"|"eti"|"ge", "as_of": "YYYY-MM-DD" }
or { "employees": 12, "ca_eur": 400000 }

POST ${base}/v1/late-penalties
JSON: { "amount_ht": 1200, "days_late": 18, "bce_refi_pct": 2.15 }

POST ${base}/v1/check-siret
JSON: { "siret": "14 digits" }

POST ${base}/v1/check-iban
JSON: { "iban": "FRxx..." }

Discovery: ${base}/.well-known/x402.json
Agent card: ${base}/.well-known/agent-card.json
Related (mentions 293 B / L441-9): https://fr-invoice-mentions.monnet-yanis1.workers.dev/llms.txt
`;
}

function wellKnownX402(req, env) {
  const to = payTo(env);
  const base = origin(req);
  return {
    x402Version: 2,
    kind: "resource-server",
    name: SERVICE,
    description:
      "French e-invoice calendar, L441-10 late penalties, SIRET/IBAN checksums. Offline. No registry lookup.",
    resources: Object.entries(ROUTES).map(([path, r]) => ({
      url: `${base}${path}`,
      method: "POST",
      description: r.description,
      mimeType: "application/json",
    })),
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        asset: USDC_BASE,
        amount: AMOUNT,
        payTo: to,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
}

function agentCard(req) {
  const base = origin(req);
  return {
    protocolVersion: "0.3.0",
    name: SERVICE,
    description:
      "French legal kit for agents: e-invoice obligation calendar (Sep 2026 reform), L441-10 penalties, SIRET/IBAN checksums. Paid x402 USDC on Base.",
    url: `${base}/a2a`,
    version: "1.0.0",
    provider: { organization: "Yanis Monnet EI", url: base },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: Object.entries(ROUTES).map(([path, r]) => ({
      id: path.replace("/v1/", ""),
      name: path,
      description: r.description,
      tags: r.tags,
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    })),
  };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type, payment-signature, x-payment, payment-required",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        },
      });
    }
    const u = new URL(req.url);
    const path = u.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health" && req.method === "GET") {
      return json({ ok: true, pay_to_configured: Boolean(payTo(env)) });
    }
    if (path === "/llms.txt" && req.method === "GET") {
      return new Response(llmsTxt(origin(req)), {
        headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" },
      });
    }
    if (path === "/.well-known/x402.json" && req.method === "GET") {
      return json(wellKnownX402(req, env));
    }
    if (path === "/.well-known/agent-card.json" && req.method === "GET") {
      return json(agentCard(req));
    }
    if (path === "/a2a" && req.method === "GET") {
      return json(agentCard(req));
    }
    if (path === "/a2a" && req.method === "POST") {
      let body = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }
      if (body && body.jsonrpc === "2.0") {
        const method = body.method;
        if (method === "message/send" || method === "tasks/send") {
          return json({
            jsonrpc: "2.0",
            id: body.id ?? null,
            result: {
              role: "agent",
              parts: [
                {
                  type: "text",
                  text: llmsTxt(origin(req)),
                },
              ],
            },
          });
        }
        return json({
          jsonrpc: "2.0",
          id: body.id ?? null,
          error: { code: -32601, message: "Method not found. Paid skills are POST /v1/* with x402." },
        });
      }
      return json({ error: "Send JSON-RPC message/send or POST a paid /v1/* route" }, 400);
    }
    if (ROUTES[path] && req.method === "POST") {
      const r = ROUTES[path];
      return handlePaid(req, env, path, r.description, r.tags, r.bazaar, r.fn);
    }
    if (path === "/" && req.method === "GET") {
      return json({
        name: SERVICE,
        paid: "POST /v1/einvoice-who | /v1/late-penalties | /v1/check-siret | /v1/check-iban — $0.01 USDC Base x402",
        docs: "/llms.txt",
        x402: "/.well-known/x402.json",
        related: "https://fr-invoice-mentions.monnet-yanis1.workers.dev",
      });
    }
    return json({ error: "not_found" }, 404);
  },
};
