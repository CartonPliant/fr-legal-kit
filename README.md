# fr-legal-kit

x402 API for AI agents. Offline French legal helpers. **$0.01 USDC** on Base per call. No INSEE, no scrape, no PDP.

Live: https://fr-legal-kit.monnet-yanis1.workers.dev

## Routes

| POST | What |
|---|---|
| `/v1/einvoice-who` | Who must **receive** e-invoices since 1 Sep 2026 vs **emit** (GE/ETI 2026, PME/micro 2027) |
| `/v1/late-penalties` | L441-10 C. com. interest (BCE+10 pts) + 40 € indemnity |
| `/v1/check-siret` | SIRET/SIREN checksum only |
| `/v1/check-iban` | IBAN ISO 13616 checksum only |

See `/llms.txt` on the host. Isolated SKU — not Devis d’abord, not Fiche Pleine, not Ibis.

Related paid API: [fr-invoice-mentions](https://fr-invoice-mentions.monnet-yanis1.workers.dev) (mention blocks, $0.02).
