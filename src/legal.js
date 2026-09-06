/** Local FR legal helpers for agents. No network, no INSEE. */

const SIRET_RE = /^\d{14}$/;
const SIREN_RE = /^\d{9}$/;

export function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

/** INSEE Luhn on SIRET (14). La Poste 356000000: sum % 5 === 0. */
export function siretOk(raw) {
  const n = digits(raw);
  if (n.length === 9) return { ok: SIREN_RE.test(n), type: "siren", compact: n };
  if (n.length !== 14) return { ok: false, type: "unknown", compact: n };
  if (!SIRET_RE.test(n)) return { ok: false, type: "siret", compact: n };
  if (n.startsWith("356000000")) {
    const sum = [...n].reduce((a, d) => a + Number(d), 0);
    return { ok: sum % 5 === 0, type: "siret", compact: n, rule: "la-poste" };
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(n[13 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return { ok: sum % 10 === 0, type: "siret", compact: n, rule: "luhn" };
}

/** ISO 13616 IBAN checksum (mod 97 == 1). */
export function ibanOk(raw) {
  const s = String(raw || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) {
    return { ok: false, compact: s, reason: "format" };
  }
  if (s.length < 15 || s.length > 34) {
    return { ok: false, compact: s, reason: "length" };
  }
  const rearr = s.slice(4) + s.slice(0, 4);
  let num = "";
  for (const ch of rearr) {
    if (ch >= "A" && ch <= "Z") num += String(ch.charCodeAt(0) - 55);
    else num += ch;
  }
  let rem = 0;
  for (const ch of num) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return { ok: rem === 1, compact: s, country: s.slice(0, 2) };
}

/**
 * L441-10 C. com. late-payment: BCE refinancing rate + 10 points, 40 € recovery indemnity.
 * Prorata 365 days. bce_refi_pct is an input (no live BCE fetch).
 */
export function latePenalties(input) {
  const i = input && typeof input === "object" ? input : {};
  const amount = Number(i.amount_ht ?? i.amount);
  const days = Number(i.days_late ?? i.days);
  const bceIn = i.bce_refi_pct;
  const bce = bceIn === undefined || bceIn === null || bceIn === "" ? 2.15 : Number(bceIn);
  const missing = [];
  if (!Number.isFinite(amount) || amount < 0) missing.push("amount_ht");
  if (!Number.isFinite(days) || days < 0) missing.push("days_late");
  if (!Number.isFinite(bce)) missing.push("bce_refi_pct");
  if (missing.length) {
    return {
      ok: false,
      missing,
      error: "Need amount_ht (EUR) and days_late (>=0). Optional bce_refi_pct (annual %).",
    };
  }
  const annualPct = bce + 10;
  const interest = amount * (annualPct / 100) * (days / 365);
  const indemnity = 40;
  const total = interest + indemnity;
  const round2 = (n) => Math.round(n * 100) / 100;
  const clause =
    "Pénalités de retard : taux directeur de la BCE + 10 points, exigibles le jour suivant la date de règlement figurant sur la facture, sans rappel (L441-10 C. com.). Indemnité forfaitaire pour frais de recouvrement : 40 €.";
  return {
    ok: true,
    amount_ht: round2(amount),
    days_late: days,
    bce_refi_pct: bce,
    bce_refi_pct_defaulted: bceIn === undefined || bceIn === null || bceIn === "",
    annual_rate_pct: annualPct,
    day_count: 365,
    interest_eur: round2(interest),
    indemnity_eur: indemnity,
    total_eur: round2(total),
    clause,
    source: "C. com. L441-10. BCE rate is caller-supplied (default 2.15 if omitted). Not legal advice.",
  };
}

const SIZE_ALIAS = {
  micro: "micro",
  tpe: "micro",
  "micro-entreprise": "micro",
  "micro entreprise": "micro",
  pme: "pme",
  "petite": "pme",
  eti: "eti",
  "taille intermediaire": "eti",
  "taille intermédiaire": "eti",
  ge: "ge",
  grande: "ge",
  "grande entreprise": "ge",
};

/**
 * E-invoice FR calendar (economie.gouv.fr, in force 1 Sep 2026).
 * Receive: all VAT-liable firms 2026-09-01.
 * Emit + e-reporting: GE/ETI 2026-09-01, PME/micro 2027-09-01.
 * Size from explicit `size` or heuristic on employees / ca_eur / bilan_eur.
 */
export function einvoiceWho(input) {
  const i = input && typeof input === "object" ? input : {};
  const size = classifySize(i);
  if (!size) {
    return {
      ok: false,
      missing: ["size"],
      error:
        "Pass size: micro|pme|eti|ge — or employees and/or ca_eur and/or bilan_eur for a heuristic class.",
    };
  }
  const receiveFrom = "2026-09-01";
  const emitFrom = size === "ge" || size === "eti" ? "2026-09-01" : "2027-09-01";
  const today = String(i.as_of || "2026-09-07");
  const receiveNow = today >= receiveFrom;
  const emitNow = today >= emitFrom;
  return {
    ok: true,
    size,
    size_source: i.size ? "explicit" : "heuristic",
    receive: {
      obligatory_from: receiveFrom,
      obligatory_now: receiveNow,
      how: "Via a plateforme agréée (PDP). All VAT-liable firms, any size.",
    },
    emit: {
      obligatory_from: emitFrom,
      obligatory_now: emitNow,
      how: "Facture électronique via plateforme agréée + e-reporting.",
    },
    e_reporting_from: emitFrom,
    tolerance_2026:
      "Administration announced a listening/tolerance phase for implementation difficulties through end of 2026 (economie.gouv.fr). Not a repeal.",
    notes: [
      "Assujettis à la TVA only. This is a calendar helper, not a PDP and not legal advice.",
      "Heuristic size is not an INSEE/liasse fiscale ruling.",
    ],
    source: "https://www.economie.gouv.fr/actualites/facturation-electronique-entre-entreprises-coup-denvoi-de-la-reforme",
  };
}

export function classifySize(i) {
  const raw = String(i.size || i.category || "").trim().toLowerCase();
  if (raw && SIZE_ALIAS[raw]) return SIZE_ALIAS[raw];
  const emp = numOrNaN(i.employees ?? i.salaries);
  const ca = numOrNaN(i.ca_eur ?? i.turnover_eur);
  const bil = numOrNaN(i.bilan_eur ?? i.balance_eur);
  if (![emp, ca, bil].some(Number.isFinite)) return null;
  const e = Number.isFinite(emp) ? emp : 0;
  const c = Number.isFinite(ca) ? ca : 0;
  const b = Number.isFinite(bil) ? bil : 0;
  if (e >= 5000 || c > 1.5e9 || b > 2e9) return "ge";
  if (e >= 250 || c > 50e6 || b > 43e6) return "eti";
  if (e >= 10 || c > 2e6 || b > 2e6) return "pme";
  return "micro";
}

function numOrNaN(v) {
  if (v === undefined || v === null || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function checkSiret(input) {
  const i = input && typeof input === "object" ? input : {};
  const r = siretOk(i.siret || i.siren || i.value);
  return {
    ok: r.ok,
    ...r,
    note: "Checksum only. Does not prove the number exists at INSEE/Sirene.",
  };
}

export function checkIban(input) {
  const i = input && typeof input === "object" ? input : {};
  const r = ibanOk(i.iban || i.value);
  return {
    ...r,
    note: "ISO 13616 checksum only. Does not prove the account exists.",
  };
}
