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
 * L441-10 C. com. late-payment (supplétif): BCE main refinancing rate + 10 points,
 * semester-frozen (1 Jan / 1 Jul), + 40 € indemnity (D.441-5).
 * No live BCE fetch (Worker 10 ms / 50 subrequest budget). Default is the
 * H2-2026 frozen MRO, sourced 2026-09-07:
 * ECB Data Portal MRO 2.40 % from 17 June 2026, held 23 July 2026
 * https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/key-ecb-interest-rates
 * https://www.ecb.europa.eu/press/pr/date/2026/html/ (11 June +25 bp; 23 July hold)
 */
export const BCE_MRO_PCT_H2_2026 = 2.4;
export const INDEMNITY_EUR = 40;

export function latePenalties(input) {
  const i = input && typeof input === "object" ? input : {};
  const amount = Number(i.amount_ttc ?? i.amount_due ?? i.amount_ht ?? i.amount);
  const days = Number(i.days_late ?? i.days);
  const bceIn = i.bce_refi_pct;
  const bce = bceIn === undefined || bceIn === null || bceIn === "" ? BCE_MRO_PCT_H2_2026 : Number(bceIn);
  const missing = [];
  if (!Number.isFinite(amount) || amount < 0) missing.push("amount_ttc");
  if (!Number.isFinite(days) || days < 0) missing.push("days_late");
  if (!Number.isFinite(bce)) missing.push("bce_refi_pct");
  if (missing.length) {
    return {
      ok: false,
      missing,
      error: "Need amount_ttc (EUR unpaid, usually TTC) and days_late (>=0). Optional bce_refi_pct (annual %; default = BCE MRO at 1 Jul 2026 = 2.40).",
    };
  }
  const annualPct = bce + 10;
  const interest = amount * (annualPct / 100) * (days / 365);
  const indemnity = INDEMNITY_EUR;
  const total = interest + indemnity;
  const round2 = (n) => Math.round(n * 100) / 100;
  const clause =
    "Pénalités de retard : taux d'intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage, exigibles le jour suivant la date de règlement figurant sur la facture, sans rappel (L441-10 II C. com.). Indemnité forfaitaire pour frais de recouvrement : 40 € (D.441-5 C. com.).";
  return {
    ok: true,
    amount_ttc: round2(amount),
    amount_ht: round2(amount),
    days_late: days,
    bce_refi_pct: bce,
    bce_refi_pct_defaulted: bceIn === undefined || bceIn === null || bceIn === "",
    bce_refi_semester: "H2-2026 (taux en vigueur au 1er juillet, L441-10 II)",
    annual_rate_pct: annualPct,
    day_count: 365,
    interest_eur: round2(interest),
    indemnity_eur: indemnity,
    total_eur: round2(total),
    clause,
    source: {
      l441_10: "C. com. L441-10 II — BCE MRO + 10 points, frozen 1 Jan / 1 Jul",
      d441_5: "C. com. D.441-5 — indemnité 40 €",
      bce_mro_default: "2.40 % from 17 June 2026 (ECB Data Portal; 23 July 2026 hold). Pass bce_refi_pct to override.",
      not: "Not legal advice. Unpaid amount is usually TTC.",
    },
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

/**
 * Metropolitan FR public holidays 2026–2027 (C. trav. L.3133-1).
 * 2026 Easter Monday 6 Apr, Ascension 14 May, Whit Monday 25 May
 * (franceinfo / calendriergratuit.fr, checked 2026-09-07).
 */
export const FR_HOLIDAYS = {
  "2026-01-01": "Jour de l'An",
  "2026-04-06": "Lundi de Pâques",
  "2026-05-01": "Fête du Travail",
  "2026-05-08": "Victoire 1945",
  "2026-05-14": "Ascension",
  "2026-05-25": "Lundi de Pentecôte",
  "2026-07-14": "Fête nationale",
  "2026-08-15": "Assomption",
  "2026-11-01": "Toussaint",
  "2026-11-11": "Armistice 1918",
  "2026-12-25": "Noël",
  "2027-01-01": "Jour de l'An",
  "2027-03-29": "Lundi de Pâques",
  "2027-05-01": "Fête du Travail",
  "2027-05-06": "Ascension",
  "2027-05-08": "Victoire 1945",
  "2027-05-17": "Lundi de Pentecôte",
  "2027-07-14": "Fête nationale",
  "2027-08-15": "Assomption",
  "2027-11-01": "Toussaint",
  "2027-11-11": "Armistice 1918",
  "2027-12-25": "Noël",
};

const ALSACE_EXTRA = {
  "2026-04-03": "Vendredi Saint (Alsace-Moselle)",
  "2026-12-26": "Saint-Étienne (Alsace-Moselle)",
  "2027-03-26": "Vendredi Saint (Alsace-Moselle)",
  "2027-12-26": "Saint-Étienne (Alsace-Moselle)",
};

function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (ymd(d) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  return d;
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function holidayName(iso, alsace) {
  return FR_HOLIDAYS[iso] || (alsace ? ALSACE_EXTRA[iso] : undefined);
}

function isWeekend(d) {
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

function nextOpenDay(d, alsace) {
  let x = new Date(d.getTime());
  for (let i = 0; i < 14; i++) {
    const iso = ymd(x);
    if (!isWeekend(x) && !holidayName(iso, alsace)) return x;
    x = addDays(x, 1);
  }
  return x;
}

/** Invoice due date. L441-10 delays are calendar days unless the contract says otherwise. */
export function dueDate(input) {
  const i = input && typeof input === "object" ? input : {};
  const start = parseISODate(i.invoice_date || i.date);
  const net = Number(i.net_days ?? i.days ?? 30);
  const alsace = Boolean(i.alsace_moselle);
  if (!start) {
    return { ok: false, missing: ["invoice_date"], error: "invoice_date YYYY-MM-DD required." };
  }
  if (!Number.isFinite(net) || net < 0 || net > 3650) {
    return { ok: false, missing: ["net_days"], error: "net_days 0–3650." };
  }
  const calendar = addDays(start, net);
  const open = nextOpenDay(calendar, alsace);
  const holidays = [];
  for (let n = 0; n <= net + 10; n++) {
    const d = addDays(start, n);
    const iso = ymd(d);
    const name = holidayName(iso, alsace);
    if (name) holidays.push({ date: iso, name });
  }
  return {
    ok: true,
    invoice_date: ymd(start),
    net_days: net,
    calendar_due: ymd(calendar),
    next_open_day: ymd(open),
    rolled_to_open: ymd(open) !== ymd(calendar),
    weekday_calendar_due: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][calendar.getUTCDay()],
    holidays_in_window: holidays,
    alsace_moselle: alsace,
    note: "L441-10 payment periods are calendar days. next_open_day skips Sat/Sun + L.3133-1 holidays (métropole 2026–2027). Not legal advice.",
    source: "C. trav. L.3133-1; 2026 dates: franceinfo.fr jours-feries-en-2026 (Lundi de Pâques 6 avr, Ascension 14 mai, Pentecôte 25 mai).",
  };
}

const TVA = {
  standard: { rate_pct: 20, cgi: "CGI art. 278", examples: ["most goods and services"] },
  intermediate: { rate_pct: 10, cgi: "CGI art. 278 bis", examples: ["restaurant on-site, passenger transport, some renovations"] },
  reduced: { rate_pct: 5.5, cgi: "CGI art. 278-0 bis", examples: ["most food, books, some energy"] },
  super_reduced: { rate_pct: 2.1, cgi: "CGI art. 281 quater", examples: ["press, some medicines"] },
  exempt: { rate_pct: 0, cgi: "exempt / hors champ — not a rate", examples: ["some education, insurance, 293 B franchise is not a VAT rate"] },
};

/** Statutory ceiling on agreed B2B payment terms (L441-10 I). */
export function paymentTermMax(input) {
  const i = input && typeof input === "object" ? input : {};
  const invoiceDate = String(i.invoice_date || "").trim();
  return {
    ok: true,
    max_days_after_invoice_issue: 60,
    alt_45_end_of_month: {
      allowed: true,
      condition:
        "Expressly stipulated in the contract and not a manifest abuse vis-à-vis the creditor.",
    },
    invoice_date: invoiceDate || null,
    source: "C. com. L441-10 I (délai convenu ≤ 60 jours après émission ; dérogation 45 jours fin de mois).",
    note: "Ceiling, not a recommended term. Shorter delays are valid. Not legal advice.",
  };
}

export function holidays(input) {
  const i = input && typeof input === "object" ? input : {};
  const year = String(i.year || "2026");
  if (!/^\d{4}$/.test(year)) {
    return { ok: false, missing: ["year"], error: "year as YYYY (2026 or 2027)." };
  }
  const alsace = Boolean(i.alsace_moselle);
  const out = [];
  for (const [d, name] of Object.entries(FR_HOLIDAYS)) {
    if (d.startsWith(year + "-")) out.push({ date: d, name, scope: "metropolitan" });
  }
  if (alsace) {
    for (const [d, name] of Object.entries(ALSACE_EXTRA)) {
      if (d.startsWith(year + "-")) out.push({ date: d, name, scope: "alsace-moselle" });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return {
    ok: out.length > 0,
    year,
    count: out.length,
    holidays: out,
    source: "C. trav. L.3133-1. 2026 dates cross-checked franceinfo.fr / calendriergratuit.fr (2026-09-07).",
    note: "Métropole. Alsace-Moselle extras only if alsace_moselle=true. Not overseas abolition days.",
  };
}

export function tvaRate(input) {
  const i = input && typeof input === "object" ? input : {};
  const key = String(i.rate || i.category || i.kind || "").toLowerCase().replace(/[-\s]+/g, "_");
  const alias = {
    standard: "standard",
    normal: "standard",
    "20": "standard",
    intermediate: "intermediate",
    intermediaire: "intermediate",
    "10": "intermediate",
    reduced: "reduced",
    reduit: "reduced",
    "5.5": "reduced",
    "5_5": "reduced",
    super_reduced: "super_reduced",
    superreduit: "super_reduced",
    "2.1": "super_reduced",
    exempt: "exempt",
    exonere: "exempt",
    "293b": "exempt",
    "293_b": "exempt",
  };
  const k = alias[key];
  if (!k) {
    return {
      ok: false,
      missing: ["rate"],
      error: "rate: standard|intermediate|reduced|super_reduced|exempt",
      rates: Object.fromEntries(Object.entries(TVA).map(([id, v]) => [id, v.rate_pct])),
    };
  }
  return {
    ok: true,
    category: k,
    ...TVA[k],
    note: "Indicative metropolitan rates. 293 B is a franchise, not a 0% rate. Not a tax ruling.",
  };
}
