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
| `/v1/open-days` | Inclusive open-day count between two dates (skip weekend + L.3133-1) |
| `/v1/invoice-numbering` | L441-9 chronological sequence: next number + no-gap rules |
| `/v1/amount-words` | French amount in words (12,40 → douze euros et quarante centimes) |
| `/v1/alsace-holidays` | Alsace-Moselle extras (Good Friday + St Stephen) + combined calendar |
| `/v1/due-date-eom` | 45 jours fin de mois (L441-10 I): month-end+45 and +45-then-EOM |
| `/v1/ht-ttc` | HT ↔ TTC at CGI rates 20 / 10 / 5.5 / 2.1 / 0 |
| `/v1/days-late` | Calendar days from due_date to as_of (input for late-penalties) |
| `/v1/siren-from-siret` | SIRET → SIREN + NIC + checksums + VAT key (no INSEE) |
| `/v1/quote-validity` | Devis validity calendar (default 30 days, usage not L441-9) |
| `/v1/ape-naf` | APE/NAF rev.2 format (4 digits + letter, e.g. 62.01Z). No INSEE |
| `/v1/postcode-fr` | 5-digit postcode → department (2A/2B, 97x, Alsace-Moselle flag) |
| `/v1/legal-form` | Extra invoice mentions by form (EI/micro vs SAS/SARL capital+RCS) |
| `/v1/iban-fr` | FR IBAN 27 chars: bank / branch / account / RIB key + ISO checksum |
| `/v1/credit-note` | Avoir: next AV- number + CGI 289 mention of original invoice (L441-9, no reuse) |
| `/v1/phone-fr` | FR phone format (ARCEP): 10 digits / +33 → E.164 + invoice mention. No lookup |
| `/v1/capital-social` | Share-capital mention (SAS au capital de 1 000,00 €). EI/micro: none |
| `/v1/rcs-mention` | RCS + greffe city + SIREN (`RCS Pau 404 833 048`). Format, not a Kbis |
| `/v1/invoice-currency` | EUR legal tender; foreign ccy OK, VAT in euros. No FX |
| `/v1/escompte` | L441-10 early-payment discount mention, or « Pas d'escompte… » |
| `/v1/acompte` | Down-payment invoice: AC- number, 30% default, remaining TTC (CGI 289) |
| `/v1/date-fr` | Invoice date JJ/MM/AAAA + weekday (L441-9 emission date format) |
| `/v1/payment-means` | Means of payment mention (virement / chèque / CB / …) L441-9 |
| `/v1/interest-start` | L441-10: interest starts the calendar day after the due date |
| `/v1/siege-social` | Siège social mention: street + CP + city (L441-9, not a Kbis) |
| `/v1/net-a-payer` | Invoice footer HT/TVA/TTC + « Net à payer : 1 200,00 € » |
| `/v1/doc-title` | CGI 289 title: Facture / Avoir / acompte / note d'honoraires / Devis |
| `/v1/autoliquidation` | Reverse-charge VAT mention (CGI 283 / BTP 283-2 nonies / import) |
| `/v1/eori` | FR EORI = FR + SIREN (format only, no customs lookup) |
| `/v1/duplicata` | Copy of an invoice: same number, stamped DUPLICATA (not a new invoice) |
| `/v1/rm-mention` | Artisan RM + city + SIREN (`RM Pau 404 833 048`). Format, not a D1 |
| `/v1/buyer` | L441-9 client identification: name + optional SIRET/SIREN + city |
| `/v1/check-siret` | SIRET/SIREN checksum only |
| `/v1/check-iban` | IBAN ISO 13616 checksum only |
| `POST /mcp` | MCP JSON-RPC: `tools/list` free, `tools/call` $0.01 |

See `/llms.txt` on the host. Isolated SKU — not Devis d’abord, not Fiche Pleine, not Ibis.

Related paid API: [fr-invoice-mentions](https://fr-invoice-mentions.monnet-yanis1.workers.dev) (mention blocks, $0.02).
