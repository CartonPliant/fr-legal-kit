# fr-legal-kit

x402 API for AI agents. Offline French legal helpers. **$0.01 USDC** on Base per call. No INSEE, no scrape, no PDP.

Live: https://fr-legal-kit.monnet-yanis1.workers.dev

## Routes

| POST | What |
|---|---|
| `/v1/einvoice-who` | Who must **receive** e-invoices since 1 Sep 2026 vs **emit** (GE/ETI 2026, PME/micro 2027) |
| `/v1/late-penalties` | L441-10 C. com. interest (BCE MRO +10 pts, H2-2026 default **2.40%**) + 40 € (D.441-5) |
| `/v1/due-date` | Invoice date + net days; next open day skipping L.3133-1 holidays 2026–2027 |
| `/v1/holidays` | Metropolitan public holidays (11 in 2026, Easter Monday **6 Apr**) |
| `/v1/payment-term-max` | Agreed-term ceiling: 60 days after invoice, or 45 days EOM if stipulated (L441-10 I) |
| `/v1/tva-rate` | Indicative VAT 20 / 10 / 5.5 / 2.1 |
| `/v1/mention-fields` | Checklist of L441-9 / 293 B / L441-10 mention field ids |
| `/v1/vat-key` | FR intra-community VAT id from SIREN (CGI 286 ter formula, not VIES) |
| `/v1/penalty-text` | Collable L441-10 + D.441-5 mention strings (12,40 % + 40 €) |
| `/v1/franchise-293b` | 2026 293 B thresholds (37 500 / 85 000 €) + statutory mention |
| `/v1/dunning-steps` | Relance calendar J+1 / J+8 / J+15 after due date (usage; L441-10 sans rappel) |
| `/v1/check-siret` | SIRET/SIREN checksum only |
| `/v1/check-iban` | IBAN ISO 13616 checksum only |
| `POST /mcp` | MCP JSON-RPC: `tools/list` free, `tools/call` $0.01 |

See `/llms.txt` on the host. Isolated SKU — not Devis d’abord, not Fiche Pleine, not Ibis.

Related paid API: [fr-invoice-mentions](https://fr-invoice-mentions.monnet-yanis1.workers.dev) (mention blocks, $0.02).
