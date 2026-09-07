---
name: fr-legal-kit
description: Base token USD (Uniswap v3), Base EIP-1559 gas, ENS resolve, plus French legal helpers. Use when an agent needs a Base spot price, gas, or ENS addr, or a French invoice calendar. Paid $0.01 USDC on Base via x402. No CoinGecko key, no INSEE.
---

# fr-legal-kit

Remote MCP + HTTP x402. Start with Base price/gas (wallets already pay those).

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

Start with `base_price` (`{"token":"WETH"}`), `base_gas` (`{}`), `base_ens` (`{"name":"vitalik.eth"}`). POST JSON to `/v1/<tool>` if not using MCP. Not legal advice, not a PDP, not INSEE, not CoinGecko.