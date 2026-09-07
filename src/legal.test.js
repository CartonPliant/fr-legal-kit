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
