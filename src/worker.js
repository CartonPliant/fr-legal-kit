import { latePenalties, einvoiceWho, checkSiret, checkIban, dueDate, tvaRate, holidays, paymentTermMax, mentionFields, vatKey, penaltyText, franchise293b, dunningSteps, openDays, invoiceNumbering, amountWords } from "./legal.js";

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
      "French L441-10 late-payment: BCE MRO+10pts interest + 40€ indemnity (D.441-5) from amount_ttc and days_late. Default MRO 2.40% (H2 2026, ECB). No live BCE fetch.",
    tags: ["france", "invoice", "L441-10", "penalties", "legal"],
    bazaar: {
      info: {
        input: {
          type: "http",
          method: "POST",
          body: { amount_ttc: 1000, days_late: 30, bce_refi_pct: 2.4 },
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
  "/v1/due-date": {
    description:
      "French invoice due date: invoice_date + net_days (calendar). Also next_open_day skipping weekends + L.3133-1 holidays 2026–2027. No live calendar fetch.",
    tags: ["france", "invoice", "due-date", "jours-feries"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { invoice_date: "2026-04-01", net_days: 30 } },
        output: { type: "json", example: { ok: true, calendar_due: "2026-05-01", next_open_day: "2026-05-04" } },
      },
    },
    fn: dueDate,
  },
  "/v1/tva-rate": {
    description:
      "Indicative FR VAT rate table: standard 20 / intermediate 10 / reduced 5.5 / super_reduced 2.1 / exempt. Not a tax ruling.",
    tags: ["france", "tva", "vat", "cgi"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { rate: "standard" } },
        output: { type: "json", example: { ok: true, rate_pct: 20, cgi: "CGI art. 278" } },
      },
    },
    fn: tvaRate,
  },
  "/v1/holidays": {
    description:
      "French metropolitan public holidays for 2026 or 2027 (C. trav. L.3133-1). Optional Alsace-Moselle extras. No live fetch.",
    tags: ["france", "jours-feries", "calendar", "invoice"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { year: 2026, alsace_moselle: false } },
        output: { type: "json", example: { ok: true, count: 11, holidays: [{ date: "2026-04-06", name: "Lundi de Pâques" }] } },
      },
    },
    fn: holidays,
  },
  "/v1/payment-term-max": {
    description:
      "Statutory ceiling on agreed FR B2B payment terms: 60 days after invoice issue, or 45 days end-of-month if stipulated (L441-10 I). Not a recommended term.",
    tags: ["france", "invoice", "L441-10", "payment-terms"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { invoice_date: "2026-09-07" } },
        output: { type: "json", example: { ok: true, max_days_after_invoice_issue: 60 } },
      },
    },
    fn: paymentTermMax,
  },
  "/v1/mention-fields": {
    description:
      "Checklist of French invoice/quote legal mention fields (L441-9, L441-10, 293 B). JSON in, list of required ids out. No lookup.",
    tags: ["france", "invoice", "mentions", "293B", "L441-9"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { kind: "facture", tva_franchise_293b: true } },
        output: { type: "json", example: { ok: true, required: [{ id: "siret" }, { id: "293b" }] } },
      },
    },
    fn: mentionFields,
  },
  "/v1/vat-key": {
    description:
      "French intra-community VAT identifier from SIREN: FR + 2-digit key + SIREN. Key = (12 + 3*(siren%97))%97 (CGI 286 ter). Not a VIES proof.",
    tags: ["france", "tva", "vat", "siren", "286ter"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { siren: "404833048" } },
        output: { type: "json", example: { ok: true, vat_fr: "FR83404833048", key: "83" } },
      },
    },
    fn: vatKey,
  },
  "/v1/penalty-text": {
    description:
      "Statutory L441-10 / D.441-5 invoice mention strings (rate BCE MRO+10 pts + 40 € indemnity). No amount required. Default MRO 2.40% H2 2026.",
    tags: ["france", "invoice", "L441-10", "mentions", "penalties"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { bce_refi_pct: 2.4 } },
        output: {
          type: "json",
          example: { ok: true, mentions: { late_penalties: "…12,40 %…", indemnity: "…40 €…" } },
        },
      },
    },
    fn: penaltyText,
  },
  "/v1/franchise-293b": {
    description:
      "CGI 293 B franchise-en-base 2026 thresholds (services 37 500/41 250, goods 85 000/93 500) plus the statutory invoice mention. 25 000 € unique threshold was abandoned. Not a tax ruling.",
    tags: ["france", "tva", "293B", "franchise", "invoice"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { activity: "services", ca_n1_eur: 20000 } },
        output: {
          type: "json",
          example: { ok: true, status: "franchise", mention: "TVA non applicable, art. 293 B du CGI" },
        },
      },
    },
    fn: franchise293b,
  },
  "/v1/dunning-steps": {
    description:
      "Suggested FR B2B dunning calendar after the due date (J+1 / J+8 / J+15). L441-10 penalties accrue without a reminder. Usage, not a statutory timetable.",
    tags: ["france", "invoice", "dunning", "relance", "L441-10"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { due_date: "2026-09-07" } },
        output: {
          type: "json",
          example: { ok: true, steps: [{ id: "relance_1", calendar_date: "2026-09-08" }] },
        },
      },
    },
    fn: dunningSteps,
  },
  "/v1/open-days": {
    description:
      "Inclusive count of French metropolitan open days between two dates (skip Sat/Sun + L.3133-1 holidays 2026–2027). Optional Alsace-Moselle extras.",
    tags: ["france", "calendar", "jours-ouvres", "jours-feries"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { from: "2026-04-03", to: "2026-04-07" } },
        output: { type: "json", example: { ok: true, open_days_inclusive: 2, holiday_days: 1 } },
      },
    },
    fn: openDays,
  },
  "/v1/invoice-numbering": {
    description:
      "French invoice numbering helper (C. com. L441-9): unique chronological sequence, no gaps. Returns next number from last_number plus the statutory rules.",
    tags: ["france", "invoice", "L441-9", "numbering"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { last_number: "F-2026-0042" } },
        output: { type: "json", example: { ok: true, next_number: "F-2026-0043" } },
      },
    },
    fn: invoiceNumbering,
  },
  "/v1/amount-words": {
    description:
      "French amount in words for invoices (douze euros et quarante centimes). Traditional hyphenation. Not a statutory mention.",
    tags: ["france", "invoice", "montant", "lettres"],
    bazaar: {
      info: {
        input: { type: "http", method: "POST", body: { amount_eur: 12.4 } },
        output: { type: "json", example: { ok: true, words: "douze euros et quarante centimes" } },
      },
    },
    fn: amountWords,
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
JSON: { "amount_ttc": 1200, "days_late": 18, "bce_refi_pct": 2.4 }

POST ${base}/v1/check-siret
JSON: { "siret": "14 digits" }

POST ${base}/v1/check-iban
JSON: { "iban": "FRxx..." }

POST ${base}/v1/due-date
JSON: { "invoice_date": "2026-04-01", "net_days": 30, "alsace_moselle": false }

POST ${base}/v1/tva-rate
JSON: { "rate": "standard"|"intermediate"|"reduced"|"super_reduced"|"exempt" }

POST ${base}/v1/holidays
JSON: { "year": 2026, "alsace_moselle": false }

POST ${base}/v1/payment-term-max
JSON: { "invoice_date": "2026-09-07" }

POST ${base}/v1/mention-fields
JSON: { "kind": "facture", "tva_franchise_293b": true }

POST ${base}/v1/vat-key
JSON: { "siren": "404833048" }

POST ${base}/v1/penalty-text
JSON: { "bce_refi_pct": 2.4 }

POST ${base}/v1/franchise-293b
JSON: { "activity": "services"|"goods"|"lawyers"|"authors", "ca_n1_eur": 20000, "ca_n_eur": 18000 }

POST ${base}/v1/dunning-steps
JSON: { "due_date": "2026-09-07" }
or { "invoice_date": "2026-09-01", "net_days": 30 }

POST ${base}/v1/open-days
JSON: { "from": "2026-04-03", "to": "2026-04-07", "alsace_moselle": false }

POST ${base}/v1/invoice-numbering
JSON: { "last_number": "F-2026-0042" }

POST ${base}/v1/amount-words
JSON: { "amount_eur": 12.4 }

MCP (tools/list free, tools/call paid): POST ${base}/mcp

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

async function handleMcp(req, env) {
  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const id = body && body.id !== undefined ? body.id : null;
  const method = body && body.method;
  if (method === "initialize") {
    return json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: SERVICE, version: "1.1.0" },
      },
    });
  }
  if (method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
  }
  if (method === "tools/list") {
    const tools = Object.entries(ROUTES).map(([p, r]) => ({
      name: p.replace("/v1/", "").replace(/-/g, "_"),
      description: r.description + " Paid $0.01 USDC Base x402.",
      inputSchema: { type: "object", additionalProperties: true },
    }));
    return json({ jsonrpc: "2.0", id, result: { tools } });
  }
  if (method === "tools/call") {
    const raw = String((body.params && body.params.name) || "");
    const path = `/v1/${raw.replace(/_/g, "-")}`;
    const r = ROUTES[path];
    if (!r) {
      return json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool ${raw}` } });
    }
    const fake = new Request(origin(req) + path, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify((body.params && body.params.arguments) || {}),
    });
    const paid = await handlePaid(fake, env, path, r.description, r.tags, r.bazaar, r.fn);
    if (paid.status === 402) {
      return paid;
    }
    const data = await paid.json().catch(() => ({}));
    return json({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(data) }] },
    });
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
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
    if ((path === "/openapi.json" || path === "/.well-known/openapi.json") && req.method === "GET") {
      const base = origin(req);
      const paths = {};
      for (const [p, r] of Object.entries(ROUTES)) {
        paths[p] = {
          post: {
            summary: r.description,
            operationId: p.replace("/v1/", "").replace(/-/g, "_"),
            "x-x402": { amount: "0.01", asset: "USDC", network: "eip155:8453" },
            requestBody: { content: { "application/json": { schema: { type: "object" } } } },
            responses: { 200: { description: "Paid result" }, 402: { description: "Payment required" } },
          },
        };
      }
      return json({
        openapi: "3.1.0",
        info: { title: SERVICE, version: "1.2.0", description: wellKnownX402(req, env).description },
        servers: [{ url: base }],
        paths,
      });
    }
    if (path === "/llms.txt" && req.method === "GET") {
      return new Response(llmsTxt(origin(req)), {
        headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" },
      });
    }
    if (path === "/.well-known/402index-verify.txt" && req.method === "GET") {
      return new Response("28ef896cd2d9204716196fc578d6f087bbd2e08da99634ab7ac9277263953b5b\n", {
        headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" },
      });
    }
    if ((path === "/.well-known/x402.json" || path === "/.well-known/x402") && req.method === "GET") {
      return json(wellKnownX402(req, env));
    }
    if ((path === "/.well-known/agent-card.json" || path === "/.well-known/agent.json") && req.method === "GET") {
      return json(agentCard(req));
    }
    if ((path === "/.well-known/mcp.json" || path === "/.well-known/mcp") && req.method === "GET") {
      const base = origin(req);
      return json({
        name: SERVICE,
        description: "French legal helpers for agents. tools/list free; tools/call x402 $0.01 USDC Base.",
        transport: { type: "streamable-http", url: `${base}/mcp` },
        endpoint: `${base}/mcp`,
        tools: Object.keys(ROUTES).map((p) => p.replace("/v1/", "")),
      });
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
    if (path === "/mcp" && req.method === "GET") {
      return json({
        name: SERVICE,
        transport: "json-rpc POST /mcp",
        tools: Object.keys(ROUTES).map((p) => p.replace("/v1/", "")),
        paid: "$0.01 USDC Base on tools/call",
      });
    }
    if (path === "/mcp" && req.method === "POST") {
      return handleMcp(req, env);
    }
    if (ROUTES[path] && (req.method === "POST" || req.method === "GET")) {
      const r = ROUTES[path];
      if (req.method === "GET") {
        if (!payTo(env)) return json({ error: "PAY_TO wallet not configured" }, 503);
        return paymentRequired(req, env, path, r.description, r.tags, r.bazaar);
      }
      return handlePaid(req, env, path, r.description, r.tags, r.bazaar, r.fn);
    }
    if (path === "/" && req.method === "GET") {
      return json({
        name: SERVICE,
        paid: "POST /v1/* — $0.01 USDC Base x402 (einvoice-who, late-penalties, due-date, holidays, payment-term-max, mention-fields, vat-key, penalty-text, franchise-293b, tva-rate, check-siret, check-iban)",
        mcp: "POST /mcp",
        docs: "/llms.txt",
        x402: "/.well-known/x402.json",
        related: "https://fr-invoice-mentions.monnet-yanis1.workers.dev",
      });
    }
    return json({ error: "not_found" }, 404);
  },
};
