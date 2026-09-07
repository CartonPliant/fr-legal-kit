---
name: fr-legal-kit
description: French legal helpers for agents (e-invoice calendar, L441-10, SIRET/IBAN, TVA, mentions). Use when drafting a French invoice/devis, checking who must e-invoice, late penalties, or checksums. Paid $0.01 USDC on Base via x402. No INSEE, no scrape.
---

# fr-legal-kit

Remote MCP + HTTP x402. Offline format/calendar only.

- MCP: `https://fr-legal-kit.monnet-yanis1.workers.dev/mcp` (`tools/list` free, `tools/call` 402)
- OpenAPI: `https://fr-legal-kit.monnet-yanis1.workers.dev/openapi.json`
- Manifest: `https://fr-legal-kit.monnet-yanis1.workers.dev/.well-known/x402.json`
- Registry: `io.github.CartonPliant/fr-legal-kit`
- x402scan: https://www.x402scan.com/server/edab7902-3c37-4463-97ef-fa115c225b8d
- Pay: USDC Base `eip155:8453`, $0.01 (`10000` atomic), facilitator `https://facilitator.payai.network`

Install:

```text
npx agentcash add https://fr-legal-kit.monnet-yanis1.workers.dev
```

```json
{ "mcpServers": { "fr-legal-kit": { "url": "https://fr-legal-kit.monnet-yanis1.workers.dev/mcp" } } }
```

Start with `einvoice_who`, `late_penalties`, `check_siret`, `due_date`. POST JSON to `/v1/<tool>` if not using MCP. Not legal advice, not a PDP, not INSEE.