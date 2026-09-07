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

function endOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** 45-days-end-of-month due dates (L441-10 I derogation). Must be stipulated. */
export function dueDateEom(input) {
  const i = input && typeof input === "object" ? input : {};
  const start = parseISODate(i.invoice_date || i.date);
  const alsace = Boolean(i.alsace_moselle);
  if (!start) {
    return { ok: false, missing: ["invoice_date"], error: "invoice_date YYYY-MM-DD required." };
  }
  const monthEnd = endOfMonth(start);
  const statutory = addDays(monthEnd, 45);
  const plus45 = addDays(start, 45);
  const usage = endOfMonth(plus45);
  return {
    ok: true,
    invoice_date: ymd(start),
    month_end: ymd(monthEnd),
    statutory_45_eom: {
      due: ymd(statutory),
      next_open_day: ymd(nextOpenDay(statutory, alsace)),
      meaning: "45 calendar days after the end of the month of invoice issue (usual L441-10 I reading).",
    },
    usage_45_then_eom: {
      due: ymd(usage),
      next_open_day: ymd(nextOpenDay(usage, alsace)),
      meaning: "Invoice date + 45 calendar days, then end of that month. Some contracts use this.",
    },
    alsace_moselle: alsace,
    source: "C. com. L441-10 I (dérogation 45 jours fin de mois, si stipulée et non abusive).",
    note: "Optional ceiling, not the default. Default max is 60 days after invoice issue (/v1/payment-term-max). Not legal advice.",
  };
}

const TVA = {
  standard: { rate_pct: 20, cgi: "CGI art. 278", examples: ["most goods and services"] },
  intermediate: { rate_pct: 10, cgi: "CGI art. 278 bis", examples: ["restaurant on-site, passenger transport, some renovations"] },
  reduced: { rate_pct: 5.5, cgi: "CGI art. 278-0 bis", examples: ["most food, books, some energy"] },
  super_reduced: { rate_pct: 2.1, cgi: "CGI art. 281 quater", examples: ["press, some medicines"] },
  exempt: { rate_pct: 0, cgi: "exempt / hors champ — not a rate", examples: ["some education, insurance, 293 B franchise is not a VAT rate"] },
};

/** Checklist of FR invoice/quote mention fields. L441-9 + L441-10 + 293 B. */
export function mentionFields(input) {
  const i = input && typeof input === "object" ? input : {};
  const kind = String(i.kind || "facture").toLowerCase();
  const franchise = Boolean(i.tva_franchise_293b ?? true);
  const ei = i.entrepreneur_individuel !== false;
  const required = [
    { id: "date", on: "facture", label: "Date d'émission" },
    { id: "number", on: "facture", label: "Numéro unique chronologique" },
    { id: "seller_name", on: "both", label: "Nom du vendeur" },
    { id: "seller_address", on: "both", label: "Adresse du vendeur" },
    { id: "siret", on: "both", label: "SIRET" },
    { id: "buyer_name", on: "both", label: "Nom du client" },
    { id: "buyer_address", on: "both", label: "Adresse du client" },
    { id: "lines", on: "both", label: "Désignation, quantité, prix unitaire HT" },
    { id: "payment_date", on: "facture", label: "Date de règlement" },
    { id: "late_penalties", on: "facture", label: "Taux des pénalités de retard" },
    { id: "indemnity_40", on: "facture", label: "Indemnité forfaitaire 40 €" },
  ];
  if (franchise) {
    required.push({ id: "293b", on: "both", label: "TVA non applicable, art. 293 B du CGI" });
  } else {
    required.push({ id: "vat_number", on: "both", label: "N° TVA intracommunautaire" });
    required.push({ id: "vat_rate", on: "facture", label: "Taux / montant de TVA" });
  }
  if (ei) required.push({ id: "ei", on: "both", label: "Qualité d'entrepreneur individuel" });
  if (kind === "devis") {
    required.push({ id: "validity", on: "devis", label: "Durée de validité (usage commercial, hors L441-9)" });
  }
  const filtered = required.filter((r) => r.on === "both" || r.on === kind || kind === "both");
  return {
    ok: true,
    kind,
    tva_franchise_293b: franchise,
    entrepreneur_individuel: ei,
    required: filtered,
    source: "C. com. L441-9 (mentions facture), L441-10 + D.441-5 (pénalités / 40 €), CGI art. 293 B si franchise.",
    note: "Checklist helper. RCS/APE/capital social depend on form. Not a legal opinion.",
  };
}

/**
 * FR intra-community VAT identifier from SIREN.
 * clé = (12 + 3 × (SIREN mod 97)) mod 97  (CGI art. 286 ter — public formula).
 * Does not prove VIES registration.
 */
export function vatKey(input) {
  const i = input && typeof input === "object" ? input : {};
  const n = digits(i.siren || i.siret || i.number || i.value);
  const siren = n.length === 14 ? n.slice(0, 9) : n;
  if (!SIREN_RE.test(siren)) {
    return {
      ok: false,
      missing: ["siren"],
      error: "Need siren (9 digits) or siret (14). Uses the first 9 digits of a SIRET.",
    };
  }
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  const key2 = String(key).padStart(2, "0");
  return {
    ok: true,
    siren,
    key: key2,
    vat_fr: `FR${key2}${siren}`,
    formula: "(12 + 3 * (siren % 97)) % 97",
    source: "CGI art. 286 ter (structure FR + clé 2 chiffres + SIREN). Public checksum, not a SIE attribution.",
    note: "Computes the canonical FR VAT identifier from SIREN. Does not prove the number is registered at VIES. Not a tax ruling.",
  };
}

/** Statutory L441-10 / D.441-5 mention strings for invoices (no amount required). */
export function penaltyText(input) {
  const i = input && typeof input === "object" ? input : {};
  const bceIn = i.bce_refi_pct;
  const bce = bceIn === undefined || bceIn === null || bceIn === "" ? BCE_MRO_PCT_H2_2026 : Number(bceIn);
  if (!Number.isFinite(bce)) {
    return { ok: false, missing: ["bce_refi_pct"], error: "bce_refi_pct must be a number if provided." };
  }
  const annual = bce + 10;
  const annualFr = annual.toFixed(2).replace(".", ",");
  return {
    ok: true,
    bce_refi_pct: bce,
    annual_rate_pct: annual,
    indemnity_eur: INDEMNITY_EUR,
    mentions: {
      late_penalties: `Pénalités de retard : ${annualFr} % par an (taux directeur de la BCE + 10 points — C. com. L441-10).`,
      indemnity: `Indemnité forfaitaire pour frais de recouvrement : ${INDEMNITY_EUR} € (C. com. D.441-5).`,
    },
    source: "C. com. L441-10 + D.441-5. Default MRO H2-2026 = 2.40% (ECB, effective 17 June 2026).",
    note: "Supplétive statutory wording for the invoice. Not a legal opinion.",
  };
}

/**
 * CGI 293 B franchise-en-base thresholds for calendar 2026 (= 2025 figures).
 * The LF 2025 unique 25 000 € threshold was abandoned (loi 3 nov. 2025).
 */
export const FRANCHISE_293B_2026 = {
  goods: {
    label: "Ventes de marchandises, restauration, hébergement",
    base_eur: 85000,
    major_eur: 93500,
  },
  services: {
    label: "Prestations de services / professions libérales (hors avocats)",
    base_eur: 37500,
    major_eur: 41250,
  },
  lawyers: {
    label: "Avocats — activités réglementées",
    base_eur: 50000,
    major_eur: 55000,
  },
  authors: {
    label: "Auteurs et artistes-interprètes — cession de droits",
    base_eur: 50000,
    major_eur: 55000,
  },
};

const FRANCHISE_ALIAS = {
  services: "services",
  service: "services",
  prestation: "services",
  liberal: "services",
  bnc: "services",
  goods: "goods",
  ventes: "goods",
  commerce: "goods",
  hebergement: "goods",
  bic: "goods",
  lawyers: "lawyers",
  avocat: "lawyers",
  avocats: "lawyers",
  authors: "authors",
  auteur: "authors",
  artistes: "authors",
};

export function franchise293b(input) {
  const i = input && typeof input === "object" ? input : {};
  const raw = String(i.activity || i.kind || "services")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const key = FRANCHISE_ALIAS[raw];
  if (!key) {
    return {
      ok: false,
      missing: ["activity"],
      error: "activity: services|goods|lawyers|authors",
    };
  }
  const t = FRANCHISE_293B_2026[key];
  const n1 = i.ca_n1_eur === undefined || i.ca_n1_eur === null || i.ca_n1_eur === "" ? null : Number(i.ca_n1_eur);
  const n = i.ca_n_eur === undefined || i.ca_n_eur === null || i.ca_n_eur === "" ? null : Number(i.ca_n_eur);
  if (n1 !== null && !Number.isFinite(n1)) {
    return { ok: false, missing: ["ca_n1_eur"], error: "ca_n1_eur must be a number (EUR HT)." };
  }
  if (n !== null && !Number.isFinite(n)) {
    return { ok: false, missing: ["ca_n_eur"], error: "ca_n_eur must be a number (EUR HT)." };
  }
  let status = "unknown";
  let detail = "Pass ca_n1_eur and/or ca_n_eur (EUR HT) for a heuristic.";
  if (n !== null && n > t.major_eur) {
    status = "exit_immediate";
    detail = "CA N above majoré: indicative exit from the 1st day of the month of exceedance.";
  } else if (n1 !== null && n1 > t.major_eur) {
    status = "out";
    detail = "CA N-1 above majoré: not in franchise for year N.";
  } else if (n1 !== null && n1 > t.base_eur) {
    status = "keep_until_31_dec";
    detail = "CA N-1 between base and majoré: typically keep franchise until 31 Dec of that year, then TVA on 1 Jan.";
  } else if (n1 !== null && n1 <= t.base_eur) {
    status = "franchise";
    detail = "CA N-1 at or under base: franchise for year N while CA N stays at or under majoré.";
  }
  return {
    ok: true,
    year: 2026,
    activity: key,
    thresholds: t,
    ca_n1_eur: n1,
    ca_n_eur: n,
    status,
    detail,
    mention: "TVA non applicable, art. 293 B du CGI",
    abandoned_25000:
      "The unique 25 000 € threshold from LF 2025 was abandoned (loi 3 nov. 2025). 2026 keeps 2025 figures.",
    source:
      "CGI art. 293 B. 2026 = 2025: services 37 500 / 41 250; goods 85 000 / 93 500; lawyers/authors (regulated/rights) 50 000 / 55 000.",
    note: "Indicative table. Mixed activities and creation-year prorata are out of scope. Not a tax ruling.",
  };
}

/**
 * Suggested B2B dunning calendar after the due date.
 * L441-10 penalties accrue without a reminder; the dates are commercial usage.
 */
export function dunningSteps(input) {
  const i = input && typeof input === "object" ? input : {};
  let due = parseISODate(i.due_date);
  if (!due && (i.invoice_date || i.date)) {
    const dd = dueDate({
      invoice_date: i.invoice_date || i.date,
      net_days: i.net_days ?? i.days ?? 30,
      alsace_moselle: i.alsace_moselle,
    });
    if (!dd.ok) return dd;
    due = parseISODate(dd.calendar_due);
  }
  if (!due) {
    return {
      ok: false,
      missing: ["due_date"],
      error: "due_date YYYY-MM-DD, or invoice_date + net_days.",
    };
  }
  const alsace = Boolean(i.alsace_moselle);
  const offsets = [
    { id: "relance_1", offset_days: 1, kind: "amiable", label: "Première relance amiable" },
    { id: "relance_2", offset_days: 8, kind: "amiable", label: "Deuxième relance amiable" },
    { id: "mise_en_demeure", offset_days: 15, kind: "formal", label: "Mise en demeure (LRAR, usage)" },
  ];
  const steps = offsets.map((s) => {
    const d = addDays(due, s.offset_days);
    const open = nextOpenDay(d, alsace);
    return { ...s, calendar_date: ymd(d), next_open_day: ymd(open) };
  });
  return {
    ok: true,
    due_date: ymd(due),
    steps,
    penalties_without_reminder: true,
    penalties_note:
      "L441-10 interest + 40 € indemnity are due automatically from the day after the due date; a reminder is not a condition.",
    source:
      "C. com. L441-10 (pénalités de plein droit, sans rappel). Step dates are commercial usage, not a statutory timetable.",
    note: "Usage calendar for recovery letters. Not a legal opinion. Not a huissier product.",
  };
}

/** Inclusive count of metropolitan open days between two dates (skip Sat/Sun + L.3133-1). */
export function openDays(input) {
  const i = input && typeof input === "object" ? input : {};
  const from = parseISODate(i.from || i.start || i.start_date);
  const to = parseISODate(i.to || i.end || i.end_date);
  const alsace = Boolean(i.alsace_moselle);
  if (!from) return { ok: false, missing: ["from"], error: "from YYYY-MM-DD." };
  if (!to) return { ok: false, missing: ["to"], error: "to YYYY-MM-DD." };
  if (to < from) return { ok: false, error: "to must be on or after from." };
  const span = Math.round((to - from) / 86400000);
  if (span > 400) return { ok: false, error: "window max 400 calendar days." };
  let open = 0;
  let weekend = 0;
  let holiday = 0;
  const holidaysHit = [];
  for (let n = 0; n <= span; n++) {
    const d = addDays(from, n);
    const iso = ymd(d);
    const h = holidayName(iso, alsace);
    if (isWeekend(d)) weekend += 1;
    else if (h) {
      holiday += 1;
      holidaysHit.push({ date: iso, name: h });
    } else open += 1;
  }
  return {
    ok: true,
    from: ymd(from),
    to: ymd(to),
    calendar_days_inclusive: span + 1,
    open_days_inclusive: open,
    weekend_days: weekend,
    holiday_days: holiday,
    holidays: holidaysHit,
    alsace_moselle: alsace,
    source: "C. trav. L.3133-1 metropolitan holidays 2026–2027. Inclusive count.",
    note: "Open = not Saturday/Sunday and not a listed holiday. L441-10 delays are calendar unless the contract says otherwise. Not legal advice.",
  };
}

/** L441-9 chronological invoice numbering helper. */
export function invoiceNumbering(input) {
  const i = input && typeof input === "object" ? input : {};
  const last = String(i.last_number || i.last || "").trim();
  const rules = [
    { id: "unique", text: "Numéro unique pour chaque facture." },
    { id: "chrono", text: "Fondé sur une séquence chronologique continue (C. com. L441-9)." },
    { id: "no_gap", text: "Pas de trou : une facture annulée conserve son numéro ; un avoir ne le réutilise pas." },
    { id: "multi_seq", text: "Plusieurs séquences possibles (établissement, année, catégorie) si chacune est chronologique." },
    { id: "prefix", text: "Un préfixe (année, site) est admis tant que la partie numérique reste continue dans la séquence." },
  ];
  let prefix = "";
  let seq = null;
  let width = 4;
  if (last) {
    const m = /^(.*?)(\d+)$/.exec(last);
    if (!m) {
      return { ok: false, error: "last_number must end with digits (e.g. F-2026-0042)." };
    }
    prefix = m[1];
    seq = Number(m[2]);
    width = m[2].length;
  } else if (i.last_seq !== undefined && i.last_seq !== null && i.last_seq !== "") {
    seq = Number(i.last_seq);
    if (!Number.isFinite(seq) || seq < 0 || !Number.isInteger(seq)) {
      return { ok: false, missing: ["last_seq"], error: "last_seq must be a non-negative integer." };
    }
    const year = i.year != null ? String(i.year) : "";
    prefix = i.prefix != null ? String(i.prefix) : year ? `F-${year}-` : "F-";
    width = Number(i.width) > 0 ? Number(i.width) : 4;
  }
  const next = seq === null ? null : `${prefix}${String(seq + 1).padStart(width, "0")}`;
  return {
    ok: true,
    last_number: last || null,
    next_number: next,
    rules,
    source: "C. com. L441-9 I (numérotation chronologique continue).",
    note: "Next number in one sequence. Does not prove the books have no gaps. Devis numbering is commercial usage, not L441-9. Not a legal opinion.",
  };
}

const FR_U = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize",
];

function frBelow20(n) {
  if (n < 17) return FR_U[n];
  return "dix-" + FR_U[n - 10];
}

function frBelow100(n) {
  if (n < 20) return frBelow20(n);
  const tens = Math.floor(n / 10);
  const u = n % 10;
  if (tens === 7) {
    if (n === 71) return "soixante et onze";
    return "soixante-" + frBelow20(n - 60);
  }
  if (tens === 8) {
    if (u === 0) return "quatre-vingts";
    return "quatre-vingt-" + FR_U[u];
  }
  if (tens === 9) return "quatre-vingt-" + frBelow20(n - 80);
  const names = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
  if (u === 0) return names[tens];
  if (u === 1) return names[tens] + " et un";
  return names[tens] + "-" + FR_U[u];
}

function frBelow1000(n) {
  if (n < 100) return frBelow100(n);
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (r === 0) return c === 1 ? "cent" : FR_U[c] + " cents";
  return (c === 1 ? "cent" : FR_U[c] + " cent") + " " + frBelow100(r);
}

function frInt(n) {
  if (n === 0) return "zéro";
  if (n < 1000) return frBelow1000(n);
  if (n < 1e6) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const tw = th === 1 ? "mille" : frBelow1000(th) + " mille";
    return r === 0 ? tw : tw + " " + frBelow1000(r);
  }
  const m = Math.floor(n / 1e6);
  const r = n % 1e6;
  const mw = m === 1 ? "un million" : frBelow1000(m) + " millions";
  return r === 0 ? mw : mw + " " + frInt(r);
}

/** French amount-in-words for invoices (usage, not a statutory mention). */
export function amountWords(input) {
  const i = input && typeof input === "object" ? input : {};
  let euros;
  let cents;
  if (i.euros !== undefined || i.centimes !== undefined) {
    euros = Number(i.euros ?? 0);
    cents = Number(i.centimes ?? 0);
  } else {
    let raw = i.amount_eur ?? i.amount ?? i.value;
    if (typeof raw === "string") raw = raw.replace(/\s/g, "").replace(",", ".");
    raw = Number(raw);
    if (!Number.isFinite(raw) || raw < 0) {
      return { ok: false, missing: ["amount_eur"], error: "amount_eur >= 0, max 999 999 999.99" };
    }
    const rounded = Math.round(raw * 100);
    euros = Math.floor(rounded / 100);
    cents = rounded % 100;
  }
  if (!Number.isFinite(euros) || !Number.isInteger(euros) || euros < 0 || euros > 999999999) {
    return { ok: false, error: "euros must be an integer 0–999999999." };
  }
  if (!Number.isFinite(cents) || !Number.isInteger(cents) || cents < 0 || cents > 99) {
    return { ok: false, error: "centimes must be an integer 0–99." };
  }
  const ew = frInt(euros);
  const cw = frInt(cents);
  const euroWord = euros <= 1 ? "euro" : "euros";
  const centWord = cents <= 1 ? "centime" : "centimes";
  const words = cents === 0 ? `${ew} ${euroWord}` : `${ew} ${euroWord} et ${cw} ${centWord}`;
  return {
    ok: true,
    euros,
    centimes: cents,
    words,
    words_upper: words.toUpperCase(),
    source: "French invoice amount-in-words (usage). Traditional forms: soixante-dix, quatre-vingts.",
    note: "Not a statutory mention. Cheque/invoice wording helper. Not a legal opinion.",
  };
}

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

/** Dedicated Alsace-Moselle extras: Good Friday + St Stephen, plus the combined calendar. */
export function alsaceHolidays(input) {
  const i = input && typeof input === "object" ? input : {};
  const year = String(i.year || "2026");
  if (!/^\d{4}$/.test(year)) {
    return { ok: false, missing: ["year"], error: "year as YYYY (2026 or 2027)." };
  }
  const extras = [];
  for (const [d, name] of Object.entries(ALSACE_EXTRA)) {
    if (d.startsWith(year + "-")) extras.push({ date: d, name, scope: "alsace-moselle" });
  }
  extras.sort((a, b) => a.date.localeCompare(b.date));
  const metro = holidays({ year, alsace_moselle: false });
  const combined = [...(metro.holidays || []), ...extras].sort((a, b) => a.date.localeCompare(b.date));
  return {
    ok: extras.length > 0,
    year,
    extra_count: extras.length,
    extras,
    combined_count: combined.length,
    combined,
    departments: ["67", "68", "57"],
    source:
      "Alsace-Moselle extras (Vendredi saint, Saint-Étienne) in addition to C. trav. L.3133-1 metropolitan days. Local civil status (concordat).",
    note: "Bas-Rhin, Haut-Rhin, Moselle. Not overseas abolition days. Not legal advice.",
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

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** HT ↔ TTC using the indicative CGI rate table. */
export function htTtc(input) {
  const i = input && typeof input === "object" ? input : {};
  const rateInfo = tvaRate({ rate: i.rate || i.category || i.kind || "standard" });
  if (!rateInfo.ok) return rateInfo;
  const pct = rateInfo.rate_pct;
  const htIn = i.amount_ht ?? i.ht;
  const ttcIn = i.amount_ttc ?? i.ttc;
  const hasHt = htIn !== undefined && htIn !== null && htIn !== "";
  const hasTtc = ttcIn !== undefined && ttcIn !== null && ttcIn !== "";
  if (hasHt === hasTtc) {
    return { ok: false, missing: ["amount_ht"], error: "Pass exactly one of amount_ht or amount_ttc." };
  }
  if (hasHt) {
    const ht = Number(htIn);
    if (!Number.isFinite(ht) || ht < 0) return { ok: false, error: "amount_ht >= 0." };
    const vat = round2(ht * (pct / 100));
    return {
      ok: true,
      direction: "ht_to_ttc",
      amount_ht: round2(ht),
      vat,
      amount_ttc: round2(ht + vat),
      category: rateInfo.category,
      rate_pct: pct,
      cgi: rateInfo.cgi,
      source: rateInfo.cgi,
      note: "Indicative CGI rates, 2-decimal rounding. 293 B/exempt is 0%. Not a tax ruling.",
    };
  }
  const ttc = Number(ttcIn);
  if (!Number.isFinite(ttc) || ttc < 0) return { ok: false, error: "amount_ttc >= 0." };
  const ht = pct === 0 ? round2(ttc) : round2(ttc / (1 + pct / 100));
  return {
    ok: true,
    direction: "ttc_to_ht",
    amount_ht: ht,
    vat: round2(ttc - ht),
    amount_ttc: round2(ttc),
    category: rateInfo.category,
    rate_pct: pct,
    cgi: rateInfo.cgi,
    source: rateInfo.cgi,
    note: "Indicative CGI rates, 2-decimal rounding. 293 B/exempt is 0%. Not a tax ruling.",
  };
}

/** Calendar days late from due_date to as_of (L441-10 periods are calendar). */
export function daysLate(input) {
  const i = input && typeof input === "object" ? input : {};
  let due = parseISODate(i.due_date);
  if (!due && (i.invoice_date || i.date)) {
    const dd = dueDate({
      invoice_date: i.invoice_date || i.date,
      net_days: i.net_days ?? i.days ?? 30,
      alsace_moselle: i.alsace_moselle,
    });
    if (!dd.ok) return dd;
    due = parseISODate(dd.calendar_due);
  }
  const asOf = parseISODate(i.as_of);
  if (!due) {
    return { ok: false, missing: ["due_date"], error: "due_date YYYY-MM-DD, or invoice_date + net_days." };
  }
  if (!asOf) {
    return { ok: false, missing: ["as_of"], error: "as_of YYYY-MM-DD required (no server clock)." };
  }
  const calendar_days = Math.round((asOf - due) / 86400000);
  return {
    ok: true,
    due_date: ymd(due),
    as_of: ymd(asOf),
    calendar_days,
    days_late: Math.max(0, calendar_days),
    not_yet_due: calendar_days < 0,
    due_today: calendar_days === 0,
    source: "C. com. L441-10 delays are calendar days unless the contract says otherwise.",
    note: "Feed days_late into /v1/late-penalties. Not legal advice.",
  };
}

/** Split SIRET into SIREN + NIC, checksum both, optional FR VAT key. No INSEE. */
export function sirenFromSiret(input) {
  const i = input && typeof input === "object" ? input : {};
  const n = digits(i.siret || i.siren || i.value);
  if (n.length === 9) {
    const chk = siretOk(n);
    const vat = vatKey({ siren: n });
    return {
      ok: chk.ok,
      type: "siren",
      siren: n,
      nic: null,
      siret: null,
      vat_fr: vat.ok ? vat.vat_fr : null,
      checksum: chk,
      note: "Checksum only. Does not prove the number exists at INSEE/Sirene.",
    };
  }
  if (n.length !== 14) {
    return { ok: false, missing: ["siret"], error: "Need siret (14 digits) or siren (9)." };
  }
  const siren = n.slice(0, 9);
  const nic = n.slice(9);
  const siretChk = siretOk(n);
  const sirenChk = siretOk(siren);
  const vat = vatKey({ siren });
  return {
    ok: siretChk.ok,
    type: "siret",
    siret: n,
    siren,
    nic,
    vat_fr: vat.ok ? vat.vat_fr : null,
    siret_checksum: siretChk,
    siren_checksum: sirenChk,
    source: "SIRET = SIREN (9) + NIC (5). Luhn / La Poste checksum. VAT key CGI 286 ter.",
    note: "Checksum only. Does not prove the number exists at INSEE/Sirene. Not a VIES proof.",
  };
}

/** Quote (devis) validity calendar. Commercial usage, not L441-9. */
export function quoteValidity(input) {
  const i = input && typeof input === "object" ? input : {};
  const start = parseISODate(i.quote_date || i.devis_date || i.date);
  const days = Number(i.validity_days ?? i.net_days ?? 30);
  const alsace = Boolean(i.alsace_moselle);
  if (!start) {
    return { ok: false, missing: ["quote_date"], error: "quote_date YYYY-MM-DD." };
  }
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    return { ok: false, missing: ["validity_days"], error: "validity_days 1–3650." };
  }
  const expiry = addDays(start, days);
  const open = nextOpenDay(expiry, alsace);
  return {
    ok: true,
    quote_date: ymd(start),
    validity_days: days,
    expires_on: ymd(expiry),
    next_open_day: ymd(open),
    mention: `Devis valable ${days} jours à compter du ${ymd(start)} (jusqu'au ${ymd(expiry)}).`,
    source: "Commercial usage. L441-9 numbering/mentions apply to invoices, not to quote duration. Common 30/60/90 days.",
    note: "Not a statutory term. Put the duration on the quote. Not legal advice.",
  };
}

/** APE/NAF rev.2 format: 4 digits + 1 letter (e.g. 62.01Z). No INSEE lookup. */
export function apeNaf(input) {
  const i = input && typeof input === "object" ? input : {};
  const raw = String(i.code || i.ape || i.naf || i.value || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  const compact = raw.replace(/\./g, "");
  if (!/^\d{4}[A-Z]$/.test(compact)) {
    return { ok: false, missing: ["code"], error: "APE/NAF: 4 digits + 1 letter (e.g. 62.01Z or 6201Z)." };
  }
  return {
    ok: true,
    compact,
    formatted: `${compact.slice(0, 2)}.${compact.slice(2, 4)}${compact.slice(4)}`,
    division: compact.slice(0, 2),
    source: "INSEE NAF rev. 2 code shape (APE). Format check only.",
    note: "Does not prove the code is assigned. APE on invoices is usage for sociétés, not a universal L441-9 field. Not legal advice.",
  };
}

/** French 5-digit postcode → department prefix. No address lookup. */
export function postcodeFr(input) {
  const i = input && typeof input === "object" ? input : {};
  const n = digits(i.postcode || i.cp || i.code_postal || i.code || i.value);
  if (n.length !== 5) {
    return { ok: false, missing: ["postcode"], error: "French postcode: 5 digits." };
  }
  const dep2 = n.slice(0, 2);
  let department = dep2;
  let scope = "metropolitan";
  if (dep2 === "20") {
    department = Number(n.slice(0, 3)) < 202 ? "2A" : "2B";
    scope = "corse";
  } else if (n.startsWith("97") || n.startsWith("98")) {
    department = n.slice(0, 3);
    scope = n.startsWith("98") ? "monaco-or-overseas" : "overseas";
  }
  return {
    ok: true,
    postcode: n,
    department,
    scope,
    alsace_moselle: department === "67" || department === "68" || department === "57",
    source: "La Poste 5-digit format. Corsica 200/201 → 2A, 202+ → 2B (usage).",
    note: "Format and department prefix only. Does not prove the address exists. Not legal advice.",
  };
}

const LEGAL_FORM_ALIAS = {
  ei: "ei",
  entrepreneurindividuel: "ei",
  micro: "micro",
  autoentrepreneur: "micro",
  microentrepreneur: "micro",
  eurl: "eurl",
  sarl: "sarl",
  sas: "sas",
  sasu: "sasu",
  sa: "sa",
  sci: "sci",
};

/** Extra invoice mentions that depend on legal form (on top of L441-9 core). */
export function legalForm(input) {
  const i = input && typeof input === "object" ? input : {};
  const raw = String(i.form || i.legal_form || i.kind || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
  const key = LEGAL_FORM_ALIAS[raw];
  if (!key) {
    return {
      ok: false,
      missing: ["form"],
      error: "form: ei|micro|eurl|sarl|sas|sasu|sa|sci",
    };
  }
  const extra = [];
  const societe = ["eurl", "sarl", "sas", "sasu", "sa", "sci"].includes(key);
  if (key === "ei" || key === "micro") {
    extra.push({ id: "ei_quality", label: "Qualité d'entrepreneur individuel" });
  }
  if (key === "micro" || key === "ei") {
    extra.push({ id: "293b_if_franchise", label: "TVA non applicable, art. 293 B du CGI (si franchise)" });
  }
  if (societe) {
    extra.push({ id: "forme", label: "Forme juridique" });
    extra.push({ id: "capital", label: "Montant du capital social" });
    extra.push({ id: "rcs", label: "RCS + ville du greffe" });
    extra.push({ id: "siege", label: "Siège social" });
  }
  if (key === "sci") extra.push({ id: "objet", label: "Objet social (usage pour SCI)" });
  return {
    ok: true,
    form: key,
    is_societe: societe,
    extra,
    source: "C. com. L441-9 + mentions d'identification selon la forme (RCS/capital pour sociétés ; qualité EI pour l'EI).",
    note: "Extra fields on top of the core L441-9 checklist (/v1/mention-fields). Not a legal opinion.",
  };
}

/** French IBAN structure: FR + 2 check + 5 bank + 5 branch + 11 account + 2 RIB key (27 chars). */
export function ibanFr(input) {
  const i = input && typeof input === "object" ? input : {};
  const r = ibanOk(i.iban || i.value);
  const compact = r.compact || "";
  if (!r.ok) {
    return { ok: false, compact, error: r.reason === "format" ? "IBAN format invalid." : "ISO 13616 checksum failed." };
  }
  if (compact.slice(0, 2) !== "FR") {
    return { ok: false, compact, error: "Not a FR IBAN (prefix FR)." };
  }
  if (compact.length !== 27) {
    return { ok: false, compact, length: compact.length, error: "FR IBAN must be 27 characters." };
  }
  return {
    ok: true,
    compact,
    country: "FR",
    check: compact.slice(2, 4),
    bank: compact.slice(4, 9),
    branch: compact.slice(9, 14),
    account: compact.slice(14, 25),
    rib_key: compact.slice(25, 27),
    length: 27,
    iso_checksum: true,
    source: "ISO 13616 + CFONB FR BBAN (5+5+11+2).",
    note: "Checksum and structure only. Does not prove the account exists.",
  };
}

/** French credit note (avoir): own L441-9 sequence + CGI 289 reference to the original invoice. */
export function creditNote(input) {
  const i = input && typeof input === "object" ? input : {};
  const original = String(i.original_number || i.invoice_number || i.facture || i.original || "").trim();
  if (!original) {
    return {
      ok: false,
      missing: ["original_number"],
      error: "original_number of the invoice being credited is required.",
    };
  }
  const last = String(i.last_avoir || i.last_number || i.last || "").trim();
  let prefix = "AV-";
  let seq = null;
  let width = 4;
  if (last) {
    const m = /^(.*?)(\d+)$/.exec(last);
    if (!m) {
      return { ok: false, error: "last_avoir must end with digits (e.g. AV-2026-0007)." };
    }
    prefix = m[1];
    seq = Number(m[2]);
    width = m[2].length;
  } else {
    const year = i.year != null ? String(i.year) : "2026";
    prefix = i.prefix != null ? String(i.prefix) : `AV-${year}-`;
    if (i.last_seq !== undefined && i.last_seq !== null && i.last_seq !== "") {
      seq = Number(i.last_seq);
      if (!Number.isFinite(seq) || seq < 0 || !Number.isInteger(seq)) {
        return { ok: false, missing: ["last_seq"], error: "last_seq must be a non-negative integer." };
      }
    } else {
      seq = 0;
    }
    width = Number(i.width) > 0 ? Number(i.width) : 4;
  }
  const next = `${prefix}${String(seq + 1).padStart(width, "0")}`;
  const rules = [
    { id: "own_number", text: "L'avoir est une facture : numéro unique (C. com. L441-9)." },
    {
      id: "no_reuse",
      text: "Le numéro de la facture d'origine n'est pas réutilisé ; une facture annulée conserve son numéro.",
    },
    { id: "ref_original", text: "L'avoir mentionne le numéro de la facture d'origine (CGI art. 289)." },
    { id: "own_seq", text: "Séquence dédiée (AV-…) admise si elle est chronologique et sans trou." },
    {
      id: "vat_reverse",
      text: "Si la facture d'origine a facturé de la TVA, l'avoir la reverse à due proportion.",
    },
  ];
  const reason = String(i.reason || i.motif || "").trim();
  const mentions = [`Avoir n° ${next} se rapportant à la facture n° ${original}.`];
  if (reason) mentions.push(`Motif : ${reason}.`);
  const out = {
    ok: true,
    original_number: original,
    last_avoir: last || null,
    next_number: next,
    mentions,
    rules,
    source: "C. com. L441-9 (numérotation) + CGI art. 289 (référence à la facture d'origine).",
    note: "Credit-note numbering and collable mentions. Does not create a PDF. Not a legal opinion.",
  };
  const hasHt = i.amount_ht !== undefined && i.amount_ht !== null && i.amount_ht !== "";
  const hasTtc = i.amount_ttc !== undefined && i.amount_ttc !== null && i.amount_ttc !== "";
  if (hasHt || hasTtc) {
    const money = htTtc({
      amount_ht: hasHt ? i.amount_ht : undefined,
      amount_ttc: hasTtc ? i.amount_ttc : undefined,
      rate: i.rate || i.category || i.kind || "standard",
    });
    if (!money.ok) return money;
    out.credit_ht = money.amount_ht;
    out.credit_vat = money.vat;
    out.credit_ttc = money.amount_ttc;
    out.signed_ht = round2(-money.amount_ht);
    out.signed_vat = round2(-money.vat);
    out.signed_ttc = round2(-money.amount_ttc);
    out.rate_pct = money.rate_pct;
    out.category = money.category;
    mentions.push(
      `Montant crédité : ${money.amount_ht.toFixed(2).replace(".", ",")} € HT / ${money.amount_ttc.toFixed(2).replace(".", ",")} € TTC (TVA ${String(money.rate_pct).replace(".", ",")} %).`,
    );
  }
  return out;
}

/** French phone format (ARCEP plan): 10-digit national or +33 / 0033. No subscriber lookup. */
export function phoneFr(input) {
  const i = input && typeof input === "object" ? input : {};
  const raw = String(i.phone || i.tel || i.numero || i.value || "").trim();
  if (!raw) {
    return { ok: false, missing: ["phone"], error: "phone required (0XXXXXXXXX or +33…)." };
  }
  const n = digits(raw);
  let national = "";
  if (n.length === 10 && n[0] === "0") national = n;
  else if (n.length === 11 && n.startsWith("33")) national = "0" + n.slice(2);
  else if (n.length === 13 && n.startsWith("0033")) national = "0" + n.slice(4);
  else {
    return { ok: false, compact: n, error: "French number: 10 digits starting with 0, or +33 / 0033." };
  }
  const prefix2 = national.slice(0, 2);
  const prefix4 = national.slice(0, 4);
  const overseas = {
    "0262": "reunion",
    "0692": "reunion",
    "0693": "reunion",
    "0590": "guadeloupe",
    "0690": "guadeloupe",
    "0594": "guyane",
    "0694": "guyane",
    "0596": "martinique",
    "0696": "martinique",
    "0269": "mayotte",
    "0639": "mayotte",
  };
  let kind = "other";
  let zone = prefix2;
  if (overseas[prefix4]) {
    kind = "overseas";
    zone = overseas[prefix4];
  } else if (prefix2 === "06" || prefix2 === "07") kind = "mobile";
  else if (["01", "02", "03", "04", "05"].includes(prefix2)) kind = "geographic";
  else if (prefix2 === "09") kind = "voip";
  else if (prefix2 === "08") kind = national.startsWith("0800") || national.startsWith("0805") ? "freephone" : "special";
  const rest = national.slice(1);
  const e164 = "+33" + rest;
  const grouped = national.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  const international_grouped = "+33 " + rest.replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5");
  return {
    ok: true,
    national,
    e164,
    grouped,
    international_grouped,
    kind,
    zone,
    invoice_mention: `Tél. ${grouped}`,
    source: "ARCEP French numbering plan (E.164 +33, national 10 digits). Format only.",
    note: "Does not prove the line exists or is assigned. Not a lookup. Not legal advice.",
  };
}

function formatEurFr(n) {
  const x = round2(n);
  const [int, dec] = x.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped},${dec} €`;
}

/** Invoice mention for share capital (sociétés). Format only — not a Kbis. */
export function capitalSocial(input) {
  const i = input && typeof input === "object" ? input : {};
  const raw = String(i.form || i.legal_form || i.kind || "sas")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
  const form = LEGAL_FORM_ALIAS[raw];
  if (!form) {
    return { ok: false, missing: ["form"], error: "form: ei|micro|eurl|sarl|sas|sasu|sa|sci" };
  }
  if (form === "ei" || form === "micro") {
    return {
      ok: true,
      form,
      is_societe: false,
      mention: null,
      note: "EI / micro : pas de capital social. Use /v1/legal-form for EI quality + 293 B.",
      source: "C. com. L441-9 identification mentions (capital for sociétés only).",
    };
  }
  const amount = i.amount_eur ?? i.capital ?? i.amount ?? i.capital_eur;
  if (amount === undefined || amount === null || amount === "") {
    return { ok: false, missing: ["amount_eur"], error: "amount_eur of the share capital." };
  }
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "amount_eur >= 0." };
  const variable = Boolean(i.variable);
  const labels = { eurl: "EURL", sarl: "SARL", sas: "SAS", sasu: "SASU", sa: "SA", sci: "SCI" };
  const label = labels[form];
  const formatted = formatEurFr(n);
  let mention;
  if (variable) {
    const minRaw = i.min_eur ?? i.minimum ?? i.capital_min;
    const min = minRaw === undefined || minRaw === null || minRaw === "" ? null : Number(minRaw);
    if (min != null && (!Number.isFinite(min) || min < 0)) return { ok: false, error: "min_eur >= 0." };
    mention =
      min != null
        ? `${label} au capital variable de ${formatted} (minimum ${formatEurFr(min)})`
        : `${label} au capital variable de ${formatted}`;
  } else {
    mention = `${label} au capital de ${formatted}`;
  }
  return {
    ok: true,
    form,
    is_societe: true,
    amount_eur: round2(n),
    formatted,
    variable,
    mention,
    source: "C. com. L441-9 / identification of sociétés (montant du capital social).",
    note: "Collable mention. Does not prove the capital on the Kbis. Not a legal opinion.",
  };
}

/** RCS + greffe city collable mention (L441-9 identification). No Kbis lookup. */
export function rcsMention(input) {
  const i = input && typeof input === "object" ? input : {};
  const city = String(i.city || i.ville || i.greffe || "").trim().replace(/\s+/g, " ");
  if (!city) {
    return { ok: false, missing: ["city"], error: "city of the greffe (e.g. Pau, Paris)." };
  }
  const n = digits(i.siren || i.siret || i.number || i.value);
  const siren = n.length === 14 ? n.slice(0, 9) : n;
  if (!SIREN_RE.test(siren)) {
    return { ok: false, missing: ["siren"], error: "Need siren (9 digits) or siret (14)." };
  }
  if (n.length === 14) {
    const chk = siretOk(n);
    if (!chk.ok) return { ok: false, siren, error: "SIRET checksum failed." };
  }
  const grouped = siren.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
  const mention = `RCS ${city} ${grouped}`;
  const raw = String(i.form || i.legal_form || i.kind || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
  const form = LEGAL_FORM_ALIAS[raw] || null;
  return {
    ok: true,
    city,
    siren,
    grouped,
    mention,
    form,
    source: "C. com. L441-9 / R123-237 (RCS + ville du greffe + SIREN).",
    note: "Format only. Does not prove the greffe or the immatriculation. Not a Kbis. Not legal advice.",
  };
}

const ISO4217 = {
  EUR: { name: "euro", symbol: "€", legal_tender_fr: true },
  USD: { name: "US dollar", symbol: "$", legal_tender_fr: false },
  GBP: { name: "pound sterling", symbol: "£", legal_tender_fr: false },
  CHF: { name: "Swiss franc", symbol: "CHF", legal_tender_fr: false },
  CAD: { name: "Canadian dollar", symbol: "CA$", legal_tender_fr: false },
  JPY: { name: "yen", symbol: "¥", legal_tender_fr: false },
};

/** Invoice currency: euro is FR legal tender; foreign ccy allowed, VAT in EUR. Offline ISO 4217 subset. */
export function invoiceCurrency(input) {
  const i = input && typeof input === "object" ? input : {};
  const raw = String(i.currency || i.ccy || i.iso || "EUR")
    .trim()
    .toUpperCase();
  const info = ISO4217[raw];
  if (!info) {
    return {
      ok: false,
      missing: ["currency"],
      error: "currency: EUR|USD|GBP|CHF|CAD|JPY (ISO 4217 subset, offline).",
    };
  }
  const mention = info.legal_tender_fr
    ? "Montants exprimés en euros (EUR)."
    : `Montants exprimés en ${raw}. La TVA est mentionnée en euros (EUR).`;
  return {
    ok: true,
    currency: raw,
    name: info.name,
    symbol: info.symbol,
    legal_tender_fr: info.legal_tender_fr,
    vat_in_eur: true,
    mention,
    source:
      "Euro = legal tender (C. mon. et fin.). Foreign currency invoices allowed; VAT expressed in euros (CGI / BOI-TVA-DECLA-30-20-20).",
    note: "ISO 4217 subset, offline. Not an FX rate. Not a tax ruling.",
  };
}
