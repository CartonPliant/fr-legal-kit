import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  siretOk,
  ibanOk,
  latePenalties,
  einvoiceWho,
  classifySize,
  dueDate,
  tvaRate,
  holidays,
  paymentTermMax,
  mentionFields,
  vatKey,
  penaltyText,
  franchise293b,
  dunningSteps,
  openDays,
  invoiceNumbering,
  amountWords,
  alsaceHolidays,
  dueDateEom,
  htTtc,
  daysLate,
  sirenFromSiret,
  quoteValidity,
  apeNaf,
  postcodeFr,
  legalForm,
  ibanFr,
  creditNote,
  phoneFr,
  capitalSocial,
  rcsMention,
  invoiceCurrency,
} from "./legal.js";

describe("siretOk", () => {
  it("accepts a well-known valid SIRET", () => {
    const r = siretOk("44306184100047");
    assert.equal(r.ok, true);
    assert.equal(r.compact, "44306184100047");
  });
  it("rejects a bad checksum", () => {
    assert.equal(siretOk("44306184100048").ok, false);
  });
});

describe("ibanOk", () => {
  it("accepts a constructed FR IBAN", () => {
    const r = ibanOk("FR1420041010050500013M02606");
    assert.equal(r.ok, true);
    assert.equal(r.country, "FR");
  });
  it("rejects a mutated check digit", () => {
    assert.equal(ibanOk("FR1520041010050500013M02606").ok, false);
  });
});

describe("latePenalties", () => {
  it("computes interest + 40 € indemnity", () => {
    const r = latePenalties({ amount_ht: 1000, days_late: 365, bce_refi_pct: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.annual_rate_pct, 12);
    assert.equal(r.interest_eur, 120);
    assert.equal(r.indemnity_eur, 40);
    assert.equal(r.total_eur, 160);
    assert.match(r.clause, /L441-10/);
  });
  it("lists missing fields", () => {
    const r = latePenalties({});
    assert.equal(r.ok, false);
    assert.ok(r.missing.includes("amount_ttc"));
  });
  it("defaults BCE MRO to the H2-2026 frozen 2.40 %", () => {
    const r = latePenalties({ amount_ttc: 1000, days_late: 365 });
    assert.equal(r.ok, true);
    assert.equal(r.bce_refi_pct, 2.4);
    assert.equal(r.bce_refi_pct_defaulted, true);
    assert.equal(r.annual_rate_pct, 12.4);
    assert.equal(r.interest_eur, 124);
    assert.equal(r.indemnity_eur, 40);
    assert.equal(r.total_eur, 164);
  });
});

describe("einvoiceWho", () => {
  it("micro receives now, emits 2027", () => {
    const r = einvoiceWho({ size: "micro", as_of: "2026-09-07" });
    assert.equal(r.ok, true);
    assert.equal(r.receive.obligatory_now, true);
    assert.equal(r.emit.obligatory_now, false);
    assert.equal(r.emit.obligatory_from, "2027-09-01");
  });
  it("ETI emits since 2026-09-01", () => {
    const r = einvoiceWho({ size: "eti", as_of: "2026-09-07" });
    assert.equal(r.emit.obligatory_now, true);
    assert.equal(r.emit.obligatory_from, "2026-09-01");
  });
  it("heuristic GE from employee count", () => {
    assert.equal(classifySize({ employees: 6000 }), "ge");
    assert.equal(classifySize({ employees: 3, ca_eur: 100000 }), "micro");
  });
});

describe("dueDate", () => {
  it("adds calendar days and rolls weekend/holiday", () => {
    const r = dueDate({ invoice_date: "2026-04-01", net_days: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.calendar_due, "2026-04-06");
    assert.equal(r.next_open_day, "2026-04-07");
    assert.equal(r.rolled_to_open, true);
    assert.ok(r.holidays_in_window.some((h) => h.date === "2026-04-06"));
  });
});

describe("tvaRate", () => {
  it("returns 20 for standard", () => {
    const r = tvaRate({ rate: "standard" });
    assert.equal(r.ok, true);
    assert.equal(r.rate_pct, 20);
  });
});

describe("holidays", () => {
  it("lists 11 metropolitan 2026 days including Easter Monday", () => {
    const r = holidays({ year: 2026 });
    assert.equal(r.ok, true);
    assert.equal(r.count, 11);
    assert.ok(r.holidays.some((h) => h.date === "2026-04-06"));
  });
});

describe("paymentTermMax", () => {
  it("returns 60 days and 45 EOM derogation", () => {
    const r = paymentTermMax({});
    assert.equal(r.ok, true);
    assert.equal(r.max_days_after_invoice_issue, 60);
    assert.equal(r.alt_45_end_of_month.allowed, true);
  });
});

describe("mentionFields", () => {
  it("includes 293 B for franchise EI facture", () => {
    const r = mentionFields({ kind: "facture", tva_franchise_293b: true });
    assert.equal(r.ok, true);
    const ids = r.required.map((x) => x.id);
    assert.ok(ids.includes("293b"));
    assert.ok(ids.includes("siret"));
    assert.ok(ids.includes("indemnity_40"));
  });
});

describe("vatKey", () => {
  it("computes FR83404833048 for SIREN 404833048", () => {
    const r = vatKey({ siren: "404833048" });
    assert.equal(r.ok, true);
    assert.equal(r.key, "83");
    assert.equal(r.vat_fr, "FR83404833048");
  });
  it("pads key and accepts SIRET (La Poste)", () => {
    const r = vatKey({ siret: "35600000000000" });
    assert.equal(r.ok, true);
    assert.equal(r.siren, "356000000");
    assert.equal(r.vat_fr, "FR39356000000");
  });
  it("rejects short input", () => {
    const r = vatKey({ siren: "123" });
    assert.equal(r.ok, false);
  });
});

describe("penaltyText", () => {
  it("uses H2-2026 MRO 2.40 → 12.40% + 40 €", () => {
    const r = penaltyText({});
    assert.equal(r.ok, true);
    assert.equal(r.annual_rate_pct, 12.4);
    assert.equal(r.indemnity_eur, 40);
    assert.match(r.mentions.late_penalties, /12,40/);
    assert.match(r.mentions.indemnity, /40 €/);
  });
});

describe("franchise293b", () => {
  it("returns 2026 service thresholds and the statutory mention", () => {
    const r = franchise293b({ activity: "services" });
    assert.equal(r.ok, true);
    assert.equal(r.thresholds.base_eur, 37500);
    assert.equal(r.thresholds.major_eur, 41250);
    assert.equal(r.mention, "TVA non applicable, art. 293 B du CGI");
  });
  it("goods 85 000 / 93 500 and franchise when CA N-1 under base", () => {
    const r = franchise293b({ activity: "goods", ca_n1_eur: 80000 });
    assert.equal(r.thresholds.base_eur, 85000);
    assert.equal(r.thresholds.major_eur, 93500);
    assert.equal(r.status, "franchise");
  });
  it("exit_immediate when CA N exceeds majoré", () => {
    const r = franchise293b({ activity: "services", ca_n_eur: 42000 });
    assert.equal(r.status, "exit_immediate");
  });
});

describe("dunningSteps", () => {
  it("schedules relance + mise en demeure from due_date", () => {
    const r = dunningSteps({ due_date: "2026-09-07" });
    assert.equal(r.ok, true);
    assert.equal(r.due_date, "2026-09-07");
    assert.equal(r.penalties_without_reminder, true);
    const ids = r.steps.map((s) => s.id);
    assert.deepEqual(ids, ["relance_1", "relance_2", "mise_en_demeure"]);
    assert.equal(r.steps[0].calendar_date, "2026-09-08");
    assert.equal(r.steps[2].calendar_date, "2026-09-22");
  });
  it("accepts invoice_date + net_days", () => {
    const r = dunningSteps({ invoice_date: "2026-09-01", net_days: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.due_date, "2026-09-01");
  });
});

describe("openDays", () => {
  it("counts Easter week 2026 métropole (Fri 3 Apr–Tue 7 Apr)", () => {
    const r = openDays({ from: "2026-04-03", to: "2026-04-07" });
    assert.equal(r.ok, true);
    assert.equal(r.calendar_days_inclusive, 5);
    assert.equal(r.weekend_days, 2);
    assert.equal(r.holiday_days, 1);
    assert.equal(r.open_days_inclusive, 2);
    assert.equal(r.holidays[0].date, "2026-04-06");
  });
  it("treats Good Friday as a holiday in Alsace-Moselle", () => {
    const r = openDays({ from: "2026-04-03", to: "2026-04-07", alsace_moselle: true });
    assert.equal(r.holiday_days, 2);
    assert.equal(r.open_days_inclusive, 1);
  });
});

describe("invoiceNumbering", () => {
  it("increments F-2026-0042", () => {
    const r = invoiceNumbering({ last_number: "F-2026-0042" });
    assert.equal(r.ok, true);
    assert.equal(r.next_number, "F-2026-0043");
    assert.ok(r.rules.some((x) => x.id === "no_gap"));
  });
  it("returns rules without a last number", () => {
    const r = invoiceNumbering({});
    assert.equal(r.ok, true);
    assert.equal(r.next_number, null);
    assert.ok(r.rules.length >= 4);
  });
});

describe("amountWords", () => {
  it("writes 12,40 €", () => {
    const r = amountWords({ amount_eur: 12.4 });
    assert.equal(r.ok, true);
    assert.equal(r.words, "douze euros et quarante centimes");
  });
  it("handles 80, 71, 200 and 1234.56", () => {
    assert.equal(amountWords({ amount_eur: 80 }).words, "quatre-vingts euros");
    assert.equal(amountWords({ amount_eur: 71 }).words, "soixante et onze euros");
    assert.equal(amountWords({ amount_eur: 200 }).words, "deux cents euros");
    assert.equal(
      amountWords({ amount_eur: 1234.56 }).words,
      "mille deux cent trente-quatre euros et cinquante-six centimes",
    );
  });
});

describe("alsaceHolidays", () => {
  it("lists Good Friday and St Stephen 2026 plus 11 metropolitan days", () => {
    const r = alsaceHolidays({ year: 2026 });
    assert.equal(r.ok, true);
    assert.equal(r.extra_count, 2);
    assert.equal(r.combined_count, 13);
    const dates = r.extras.map((x) => x.date);
    assert.ok(dates.includes("2026-04-03"));
    assert.ok(dates.includes("2026-12-26"));
  });
});

describe("dueDateEom", () => {
  it("computes 45 FDM from 2026-09-07", () => {
    const r = dueDateEom({ invoice_date: "2026-09-07" });
    assert.equal(r.ok, true);
    assert.equal(r.month_end, "2026-09-30");
    assert.equal(r.statutory_45_eom.due, "2026-11-14");
    assert.equal(r.usage_45_then_eom.due, "2026-10-31");
  });
});

describe("htTtc", () => {
  it("adds 20% from HT and reverses from TTC", () => {
    const up = htTtc({ amount_ht: 100, rate: "standard" });
    assert.equal(up.ok, true);
    assert.equal(up.vat, 20);
    assert.equal(up.amount_ttc, 120);
    const down = htTtc({ amount_ttc: 120, rate: "standard" });
    assert.equal(down.amount_ht, 100);
    assert.equal(down.vat, 20);
  });
  it("uses 5.5% reduced", () => {
    const r = htTtc({ amount_ht: 100, rate: "reduced" });
    assert.equal(r.rate_pct, 5.5);
    assert.equal(r.amount_ttc, 105.5);
  });
});

describe("daysLate", () => {
  it("counts 18 calendar days after the due date", () => {
    const r = daysLate({ due_date: "2026-09-07", as_of: "2026-09-25" });
    assert.equal(r.ok, true);
    assert.equal(r.days_late, 18);
    assert.equal(r.not_yet_due, false);
  });
  it("is zero on the due date and negative before", () => {
    assert.equal(daysLate({ due_date: "2026-09-07", as_of: "2026-09-07" }).days_late, 0);
    const early = daysLate({ due_date: "2026-09-07", as_of: "2026-09-01" });
    assert.equal(early.days_late, 0);
    assert.equal(early.not_yet_due, true);
  });
});

describe("sirenFromSiret", () => {
  it("splits a valid SIRET and computes the VAT key", () => {
    const r = sirenFromSiret({ siret: "44306184100047" });
    assert.equal(r.ok, true);
    assert.equal(r.siren, "443061841");
    assert.equal(r.nic, "00047");
    assert.equal(r.vat_fr, "FR64443061841");
  });
});

describe("quoteValidity", () => {
  it("adds 30 days from 2026-09-07", () => {
    const r = quoteValidity({ quote_date: "2026-09-07" });
    assert.equal(r.ok, true);
    assert.equal(r.validity_days, 30);
    assert.equal(r.expires_on, "2026-10-07");
    assert.match(r.mention, /30 jours/);
  });
});

describe("apeNaf", () => {
  it("accepts dotted and compact 62.01Z", () => {
    const a = apeNaf({ code: "62.01Z" });
    const b = apeNaf({ ape: "6201Z" });
    assert.equal(a.ok, true);
    assert.equal(a.formatted, "62.01Z");
    assert.equal(a.compact, "6201Z");
    assert.equal(b.ok, true);
    assert.equal(b.formatted, "62.01Z");
  });
  it("rejects 4 digits without a letter", () => {
    assert.equal(apeNaf({ code: "6201" }).ok, false);
  });
});

describe("postcodeFr", () => {
  it("maps Paris, Corsica and Guadeloupe prefixes", () => {
    assert.equal(postcodeFr({ postcode: "75001" }).department, "75");
    assert.equal(postcodeFr({ cp: "20000" }).department, "2A");
    assert.equal(postcodeFr({ cp: "20200" }).department, "2B");
    assert.equal(postcodeFr({ postcode: "97100" }).department, "971");
    assert.equal(postcodeFr({ postcode: "67000" }).alsace_moselle, true);
  });
});

describe("legalForm", () => {
  it("asks EI quality for micro and capital/RCS for SAS", () => {
    const ei = legalForm({ form: "micro" });
    assert.equal(ei.ok, true);
    assert.ok(ei.extra.some((x) => x.id === "ei_quality"));
    const sas = legalForm({ form: "SAS" });
    assert.equal(sas.is_societe, true);
    assert.ok(sas.extra.some((x) => x.id === "capital"));
    assert.ok(sas.extra.some((x) => x.id === "rcs"));
  });
});

describe("ibanFr", () => {
  it("splits a constructed FR IBAN", () => {
    const r = ibanFr({ iban: "FR1420041010050500013M02606" });
    assert.equal(r.ok, true);
    assert.equal(r.length, 27);
    assert.equal(r.bank, "20041");
    assert.equal(r.branch, "01005");
    assert.equal(r.rib_key, "06");
  });
});

describe("creditNote", () => {
  it("increments AV-2026-0007 and references the original invoice", () => {
    const r = creditNote({ original_number: "F-2026-0042", last_avoir: "AV-2026-0007" });
    assert.equal(r.ok, true);
    assert.equal(r.next_number, "AV-2026-0008");
    assert.match(r.mentions[0], /F-2026-0042/);
    assert.ok(r.rules.some((x) => x.id === "ref_original"));
  });
  it("requires original_number", () => {
    assert.equal(creditNote({ last_avoir: "AV-1" }).ok, false);
  });
  it("reverses 100 HT at 20%", () => {
    const r = creditNote({
      original_number: "F-1",
      last_avoir: "AV-0000",
      amount_ht: 100,
      rate: "standard",
    });
    assert.equal(r.credit_ttc, 120);
    assert.equal(r.signed_ht, -100);
  });
});

describe("phoneFr", () => {
  it("normalizes a metropolitan mobile", () => {
    const r = phoneFr({ phone: "06 12 34 56 78" });
    assert.equal(r.ok, true);
    assert.equal(r.national, "0612345678");
    assert.equal(r.e164, "+33612345678");
    assert.equal(r.kind, "mobile");
    assert.equal(r.invoice_mention, "Tél. 06 12 34 56 78");
  });
  it("accepts +33 geographic", () => {
    const r = phoneFr({ tel: "+33 1 23 45 67 89" });
    assert.equal(r.ok, true);
    assert.equal(r.national, "0123456789");
    assert.equal(r.kind, "geographic");
    assert.equal(r.zone, "01");
  });
  it("rejects a short number", () => {
    assert.equal(phoneFr({ phone: "123" }).ok, false);
  });
});

describe("capitalSocial", () => {
  it("formats SAS 1000 €", () => {
    const r = capitalSocial({ form: "sas", amount_eur: 1000 });
    assert.equal(r.ok, true);
    assert.equal(r.mention, "SAS au capital de 1 000,00 €");
    assert.equal(r.is_societe, true);
  });
  it("skips capital for micro", () => {
    const r = capitalSocial({ form: "micro", amount_eur: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.mention, null);
    assert.equal(r.is_societe, false);
  });
  it("formats variable capital with a minimum", () => {
    const r = capitalSocial({ form: "sas", amount_eur: 10000, variable: true, min_eur: 1 });
    assert.match(r.mention, /capital variable/);
    assert.match(r.mention, /minimum 1,00 €/);
  });
});

describe("rcsMention", () => {
  it("groups SIREN with the greffe city", () => {
    const r = rcsMention({ city: "Pau", siren: "404833048" });
    assert.equal(r.ok, true);
    assert.equal(r.mention, "RCS Pau 404 833 048");
    assert.equal(r.siren, "404833048");
  });
  it("accepts a SIRET and Paris", () => {
    const r = rcsMention({ ville: "Paris", siret: "44306184100047" });
    assert.equal(r.ok, true);
    assert.equal(r.siren, "443061841");
    assert.equal(r.mention, "RCS Paris 443 061 841");
  });
  it("requires the greffe city", () => {
    assert.equal(rcsMention({ siren: "404833048" }).ok, false);
  });
});

describe("invoiceCurrency", () => {
  it("defaults to EUR as French legal tender", () => {
    const r = invoiceCurrency({});
    assert.equal(r.ok, true);
    assert.equal(r.currency, "EUR");
    assert.equal(r.legal_tender_fr, true);
    assert.match(r.mention, /euros/);
  });
  it("flags VAT in EUR for a USD invoice", () => {
    const r = invoiceCurrency({ currency: "USD" });
    assert.equal(r.ok, true);
    assert.equal(r.vat_in_eur, true);
    assert.equal(r.legal_tender_fr, false);
    assert.match(r.mention, /USD/);
  });
  it("rejects an unknown code", () => {
    assert.equal(invoiceCurrency({ currency: "XYZ" }).ok, false);
  });
});
