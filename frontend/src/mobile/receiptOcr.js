// Pure receipt-text parser + validator — no imports, no JSX, safe to unit-test.
// NEVER invents values: every field comes from text actually printed on the
// receipt. Garbage fragments ("JpeTROY K" raw, "1 L", "₱2") are rejected by
// validation instead of being passed to the form:
//
// * fuel stations map to a CANONICAL known brand (exact or similarity-gated
//   fuzzy match). Unknown text is never auto-filled.
// * fuel products map through FUEL_PRODUCT_MAP (e.g. "D POWER" -> Diesel,
//   "XTRA ADVANCE" -> Gasoline). Unknown products are surfaced as
//   fuel_product WITHOUT an invented fuel_type.
// * O↔0 I↔1 S↔5 B↔8 G↔6 confusion is normalized ONLY inside captured numeric
//   tokens — never in normal text.
// * liters/price/total must pass plausibility ranges AND cross-validation
//   (liters × price ≈ total); impossible combos are dropped, not filled.
// * totals prioritize TOTAL (INCL VAT) / GRAND TOTAL / AMOUNT DUE lines and
//   ignore VAT breakdowns (VATable/VAT amount) and Tendered/Change lines.
// * Description/Qty/Price/Amount table rows are parsed as a unit so Qty,
//   Price and Amount are never confused with invoice/date/reference numbers.
// * odometer is extracted ONLY from an explicit ODO/ODOMETER/KM label.
// * dates must be calendar-valid; years are never re-based.
// Missing/low-tier fields stay null so the form leaves them editable.
//
// Per-field verification model (see buildFieldStates):
//   VERIFIED           — label/brand evidence + cross-validation passed
//   NEEDS_VERIFICATION — fuzzy/inferred evidence, low confidence, or
//                        cross-validation mismatch: show, never auto-trust
//   NOT_DETECTED       — nothing readable on the receipt for this field

export const FUEL_TYPE_MAP = { diesel: 'Diesel', gasoline: 'Gasoline', premium: 'Premium', unleaded: 'Unleaded', biofuel: 'Biofuel' };

// Configured fuel-product mapping: raw product description (as printed on
// Philippine fuel receipts) -> normalized fuel type. ONLY products listed
// here are auto-classified; anything else is surfaced as fuel_product with
// fuel_type left null (NEEDS_VERIFICATION, never guessed).
export const FUEL_PRODUCT_MAP = {
  'd power': 'Diesel',
  'diesel': 'Diesel',
  'diesel max': 'Diesel',
  'turbo diesel': 'Diesel',
  'power diesel': 'Diesel',
  'gasoline': 'Gasoline',
  'unleaded': 'Gasoline',
  'xtra': 'Gasoline',
  'xtra advance': 'Gasoline',
  'xtra unleaded': 'Gasoline',
  'xcs': 'Gasoline',
  'blaze': 'Gasoline',
  'premium': 'Gasoline',
  'regular': 'Gasoline',
  'silver': 'Gasoline',
  'platinum': 'Gasoline',
  'v-power': 'Gasoline',
  'vpower': 'Gasoline',
  'fuelserve': 'Gasoline',
};

// Field verification statuses — the contract consumed by ReceiptScanner and
// the fuel forms (Save stays disabled while required fields need verification).
export const FIELD_STATUS = {
  VERIFIED: 'VERIFIED',
  NEEDS_VERIFICATION: 'NEEDS_VERIFICATION',
  NOT_DETECTED: 'NOT_DETECTED',
};

// Fields that must be VERIFIED (or manually corrected + revalidated) before
// the transaction may be saved.
export const REQUIRED_FIELDS = ['fuel_type', 'liters', 'price_per_liter', 'total_amount', 'record_date', 'receipt_reference'];

// Receipt-level detection states.
export const RECEIPT_STATUS = {
  DETECTED: 'DETECTED',
  PARTIAL: 'PARTIAL',
  NOT_DETECTED: 'NOT_DETECTED',
};

const STATION_CANONICAL = {
  petron: 'PETRON',
  shell: 'SHELL',
  caltex: 'CALTEX',
  phoenix: 'PHOENIX',
  seaoil: 'SEAOIL',
  unioil: 'UNIOIL',
  cleanfuel: 'CLEANFUEL',
  jetti: 'JETTI',
  ptt: 'PTT',
  total: 'TOTAL',
  rephil: 'REPHIL',
  pnoc: 'PNOC',
  'flying v': 'FLYING V',
  'philippine national oil company': 'PHILIPPINE NATIONAL OIL COMPANY',
};
const KNOWN_STATIONS = Object.keys(STATION_CANONICAL);

// Confidence tiers — the ONLY confidence shown in the UI. The OCR engine
// reports a single page-level score, so per-field percentages would be
// invented; tiers reflect actual evidence strength instead.
export const TIER = { HIGH: 'high', MEDIUM: 'medium', VERIFY: 'verify' };
const VIA_TIER = {
  label: 'high', brand: 'high',
  'brand-fuzzy': 'medium', fuzzy: 'medium', inferred: 'medium', header: 'medium',
  table: 'high', 'table-fuzzy': 'medium',
  // Stage-2 numeric region votes (bbox-located, multi-pass agreement).
  'numeric-region': 'high', 'numeric-region-weak': 'medium',
  'header-weak': 'verify',
};
export function tierFor(via) {
  return VIA_TIER[via] || 'verify';
}

// Map an evidence tier (+ cross-validation outcome for amounts) to the
// user-facing field status. Amount fields that fail the liters×price≈total
// check are NEVER VERIFIED even with a clean label match.
export function statusFor(tier, { isAmount = false, crossOk = true, hasValue = true } = {}) {
  if (!hasValue) return FIELD_STATUS.NOT_DETECTED;
  if (isAmount && !crossOk) return FIELD_STATUS.NEEDS_VERIFICATION;
  if (tier === 'high') return FIELD_STATUS.VERIFIED;
  return FIELD_STATUS.NEEDS_VERIFICATION;
}

const SKIP_LINE = /(official receipt|sales invoice|acknowledgement|this serves as|thank you|vat |tin\b|machine|terminal|clerk|cashier|change|tender|cash\b|charge|duplicate|reprint|\btotal\b|\bamount\b|\bliters?\b|\bqty\b|\bquantity\b|\bvolume\b|\bprice\b|\bunit\b|\brate\b|\bbalance\b|\bdue\b|\bodo\b|odometer|mileage)/i;

// Lines that must NEVER supply the receipt total: VAT breakdowns, tendered /
// change / payment lines, and balance inquiries. The authoritative total is
// TOTAL (INCL VAT) / GRAND TOTAL / AMOUNT DUE / NET SALES.
const TOTAL_EXCLUDE = /(zero\s*rated|vat\s*exempt|vatable|vat\s*amount|vat\b.{0,10}sales|tendered|change\b|payment|cash\b|charge\b|balance\s*(?:inquiry|enquiry)|remaining|available)/i;
const TOTAL_LABEL = /\b(?:grand\s*total|total\s*(?:amount(?:\s*due)?|sales)?(?:\s*\(?incl\.?\s*vat\)?)?|amount\s*due|net\s*(?:sales?|amount)|gross\s*(?:total|sales|amount)|balance\s*due|sale\s*amount|total\s*amount\s*due)\b/i;

// Receipt shows a discount/VAT adjustment: liters×price may legitimately
// exceed the printed total, so keep the printed TOTAL as authoritative.
const DISCOUNT_HINT = /(discount|less|deduction|rebate|vat|tax|withholding|ewt|net of|net\s*amount)/i;

// ---------------------------------------------------------------------------
// Numeric handling (numeric context ONLY)
// ---------------------------------------------------------------------------

// Normalize OCR letter/digit confusion inside an already-isolated numeric
// token. Never call this on normal text.
function ocrDigits(s) {
  return String(s)
    .replace(/[oO]/g, '0')
    .replace(/[iIl]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[bB]/g, '8')
    .replace(/[gG]/g, '6');
}

// "₱2,218.75" -> 2218.75 ; "P62.50/L" -> 62.50 ; "35,50 L" -> 35.50 ;
// "35.5O L" (OCR) -> 35.50. Returns null for anything not plausibly numeric.
export function normalizeNum(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[\s]/g, '').trim();
  if (!s) return null;
  s = s.replace(/^(?:php|₱|p)/i, '').replace(/(?:php|₱)$/i, '');
  // Unit suffixes OCR may leave attached: "/L", "L", "LTRS", "LITERS", "PERL".
  s = s.replace(/(?:\/l(?:trs?|iters?)?|perl(?:iters?)?|ltrs?|liters?|l)$/i, '');
  if (!s) return null;
  // Confusion cleanup on the isolated token, then strict shape check.
  const hadLetters = /[A-Za-z]/.test(s);
  const cleaned = ocrDigits(s).replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    // Retry as thousand-separated ("2,325.25") before giving up.
    const noComma = ocrDigits(s);
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(noComma)) {
      const n = Number(noComma.replace(/,/g, ''));
      if (!Number.isFinite(n)) return null;
      if (hadLetters && n === 0) return null;
      return n;
    }
    if (/^\d+,\d{1,2}$/.test(noComma)) {
      const n = Number(noComma.replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      if (hadLetters && n === 0) return null;
      return n;
    }
    return null; // rejects garbage like O0O, --, symbols
  }
  // "2,325.25" (after comma strip "2325.25") vs "35,50" decimal comma:
  // decide from the ORIGINAL separators.
  let n;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(ocrDigits(s))) n = Number(ocrDigits(s).replace(/,/g, ''));
  else if (/^\d+,\d{1,2}$/.test(ocrDigits(s)) && !ocrDigits(s).includes('.')) n = Number(ocrDigits(s).replace(',', '.'));
  else n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  // Letter-garbage mapping to all zeros ("O0O") is not a reading.
  if (hadLetters && n === 0) return null;
  return n;
}

const NUM = '([0-9][0-9,]*(?:[.,][0-9]+)?)';

function numResult(raw, via, min, max, opts = {}) {
  const n = normalizeNum(raw);
  if (n === null || n < (min ?? 0)) return null;
  if (max !== undefined && n > max) return null;
  // A bare unit fragment like "1 L" / "₱2" is OCR noise, not a reading:
  // genuine receipt values carry decimals or at least two digits.
  if (opts.unit && !/[.,]\d/.test(String(raw).replace(/[\s]/g, '')) && n < 10) return null;
  return { value: Math.round(n * 100) / 100, via };
}

// ---------------------------------------------------------------------------
// Text normalization helpers (label search only unless noted)
// ---------------------------------------------------------------------------

// OCR often confuses 0↔O, 1↔I, 5↔S. Normalize a COPY for label search only;
// values are always extracted from the original line.
function loose(line) {
  return line.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/5/g, 's');
}

// Stronger confusion table for brand/fuel matching (OCR also mixes 8↔B, 6↔G).
function leet(line) {
  return line.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/5/g, 's')
    .replace(/8/g, 'b').replace(/6/g, 'g');
}

// Tesseract on photos often inserts spaces: "P E T R O N". Collapse a COPY
// back to one token so brand/fuel matching still works.
export function squishSpacedLetters(s) {
  const t = String(s || '').trim();
  if (/^(?:[A-Za-z]\s+){2,}[A-Za-z](?:\s+[A-Za-z]+)*$/.test(t)) return t.replace(/\s+/g, '');
  return s;
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Match a line against the known station list. Returns the CANONICAL brand
// name plus similarity — never the raw OCR line. Unknown text returns null.
export function matchStation(line) {
  const squished = String(squishSpacedLetters(line) || '');
  const variants = [line.toLowerCase(), squished.toLowerCase(), leet(squished)];
  for (const brand of KNOWN_STATIONS) {
    if (variants.some((v) => v.includes(brand))) {
      return { value: STATION_CANONICAL[brand], similarity: 1, method: 'exact' };
    }
  }
  const tokens = variants.flatMap((v) => v.split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
  let best = null;
  for (const brand of KNOWN_STATIONS) {
    const compact = brand.replace(/[^a-z0-9]/g, '');
    if (compact.length < 3) continue;
    for (const t of tokens) {
      if (Math.abs(t.length - compact.length) > 2) continue;
      const d = editDistance(t, compact);
      const sim = 1 - d / Math.max(t.length, compact.length);
      // Short brand names need a near-exact match — a loose gate turns
      // OCR garbage like "JpeTROY" into "PETRON". Digit confusion is
      // already covered by the exact leet() path above.
      const need = compact.length <= 6 ? 0.8 : 0.65;
      if (sim >= need && (!best || sim > best.similarity)) {
        best = { value: STATION_CANONICAL[brand], similarity: Math.round(sim * 100) / 100, method: 'fuzzy' };
      }
    }
  }
  return best;
}

function firstLine(lines, re) {
  for (const ln of lines) { const m = ln.match(re); if (m) return { line: ln, m }; }
  return null;
}

function firstLooseLine(lines, keywordRe) {
  for (const ln of lines) {
    if (keywordRe.test(loose(ln))) {
      // OCR noise can embed digits in the label itself (PR1CE) — take the LAST number.
      const all = [...ln.matchAll(new RegExp(NUM, 'g'))];
      if (all.length) return { line: ln, m: all[all.length - 1], fuzzy: true };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates (calendar-validated; years are never re-based)
// ---------------------------------------------------------------------------

function strictDate(y, m, d) {
  y = +y; m = +m; d = +d;
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > dim) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDate(text) {
  // Labeled date preferred: "Date: 09/19/2026", "09-19-2026", "2026-09-19", "Sep 19, 2026"
  const labeled = text.match(/\bdate\b[^0-9\n]*([0-9]{1,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i);
  const generic = labeled ? labeled[1] : (text.match(/\b([0-9]{4}-[0-9]{2}-[0-9]{2})\b/) || [])[1];
  let d = generic || null;
  if (!d) {
    const m = (labeled ? null : text.match(/\b([0-9]{1,2})[\/\-.]([0-9]{1,2})[\/\-.]([0-9]{2,4})\b/));
    if (m) d = `${m[1]}/${m[2]}/${m[3]}`;
  }
  if (!d) {
    const m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+([0-9]{1,2}),?\s+([0-9]{4})/i);
    if (m) {
      const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const iso = strictDate(m[3], months[m[1].slice(0, 3).toLowerCase()], m[2]);
      return iso ? { date: iso, time: null, via: 'label', source: m[0] } : { date: null, time: null, via: null, source: null };
    }
    return { date: null, time: null, via: null, source: null };
  }
  // Normalize to ISO. PH receipts use MM/DD/YYYY unless the first part > 12.
  let iso = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m2, d2] = d.split('-');
    iso = strictDate(y, m2, d2);
  } else {
    const parts = d.split(/[\/\-.]/);
    if (parts.length === 3) {
      let [a, b, c] = parts.map((x) => x.trim());
      if (c.length === 2) c = `20${c}`;
      if (+a > 12 && +b <= 12) iso = strictDate(c, b, a); // DD/MM/YYYY
      else iso = strictDate(c, a, b); // MM/DD/YYYY (PH)
    }
  }
  const timeM = text.match(/\btime\b[^0-9\n]*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
  return { date: iso, time: timeM ? timeM[1].trim() : null, via: labeled ? 'label' : 'header', source: (labeled ? labeled[0] : d) || null };
}

// Suspicious-date check: still populate the field, but warn when the receipt
// date is in the future or more than a year older than today.
export function dateWarning(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = new Date(`${iso}T00:00:00`).getTime();
  if (Number.isNaN(t)) return null;
  const days = (Date.now() - t) / 86400000;
  const [y, m, d] = iso.split('-');
  const disp = `${d}/${m}/${y}`;
  if (days < -1) return `Receipt date detected: ${disp}. The date is in the future. Please verify the receipt date.`;
  if (days > 365) return `Receipt date detected: ${disp}. The date looks old compared with today. Please verify the receipt date.`;
  return null;
}

// ---------------------------------------------------------------------------
// Field extractors
// ---------------------------------------------------------------------------

function parseStation(lines) {
  // Canonical brand match anywhere (exact substring or similarity-gated
  // fuzzy) — but never on a value/label line.
  for (const ln of lines) {
    if (SKIP_LINE.test(ln) || SKIP_LINE.test(loose(ln))) continue;
    if (ln.replace(/[^A-Za-z]/g, '').length < 3) continue;
    const hit = matchStation(ln);
    if (hit) return { value: hit.value, via: hit.method === 'exact' ? 'brand' : 'brand-fuzzy', similarity: hit.similarity, source: ln };
  }
  // Otherwise the first header-like line — flagged WEAK: shown for review but
  // never auto-filled (this is where "JpeTROY K"-style garbage used to leak).
  for (const ln of lines.slice(0, 5)) {
    const t = ln.trim();
    if (t.length < 3 || t.length > 80) continue;
    if (SKIP_LINE.test(t) || SKIP_LINE.test(loose(t))) continue;
    if (/[:#]/.test(t) && /\b(no|tin|or|ref|tel|date|time)\b/i.test(t)) continue;
    if ((t.match(/[A-Za-z]/g) || []).length < 3) continue;
    if ((t.match(/[0-9]/g) || []).length > t.length / 2) continue;
    // Mastheads print in CAPS or Title Case; intercaps ("JpeTROY") and
    // all-lowercase fragments ("hello world") are OCR garbage, not names.
    if (!(/[A-Z]{3,}|\b[A-Z][a-z]{3,}/.test(t))) continue;
    if (/[a-z][A-Z]/.test(t)) continue;
    const v = t.replace(/[^A-Za-z0-9 &\-.']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
    if (v) return { value: v, via: 'header-weak', source: ln };
  }
  return null;
}

function parseReference(lines) {
  // S.I.# (sales invoice) is the primary PH fuel-receipt reference.
  const si = firstLine(lines, /\bS\.?\s*I\.?\s*#?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/#.]{1,30})/i);
  if (si && /\d/.test(si.m[1] || '')) {
    const raw = String(si.m[1]).trim().slice(0, 100);
    if (raw.length >= 2 && !/^[0.\-,#\s]+$/.test(raw)) return { value: raw, via: 'label', source: si.line };
  }
  const hit = firstLine(lines, /\b(?:o\.?\s*r\.?\s*(?:no\.?|number|[:#])\s*[:#]?|or\s*(?:no\.?|number|[#:])\s*[:#]?|receipt\s*(?:no\.?|number|[#:])\s*[:#]?|ref(?:erence)?\s*(?:no\.?|number|[:#])\s*[:#]?|transaction\s*(?:no\.?|number|[#:])\s*[:#]?|invoice\s*(?:no\.?|number|[#:])\s*[:#]?|control\s*(?:no\.?|number|[#:])\s*[:#]?)\s*([A-Za-z0-9][A-Za-z0-9\-/#.]{1,30})/i)
    || firstLooseLine(lines, /\b(?:or|receipt|ref|transaction|invoice|control)\b[^\n]*\bno\b/);
  if (!hit) return null;
  const raw = (hit.m[1] || '').trim().slice(0, 100);
  if (raw.length < 2 || !/\d/.test(raw)) return null; // must contain a digit: rejects O0O/symbols
  if (/^[0.\-,#\s]+$/.test(raw)) return null;
  return { value: raw, via: hit.fuzzy ? 'fuzzy' : 'label', source: hit.line };
}

// Odometer — labeled lines ONLY (ODO / ODOMETER / KM READING / MILEAGE).
// Never inferred: a wrong odometer corrupts the vehicle record.
function parseOdometer(lines) {
  const hit = firstLine(lines, /\b(?:odometer(?:\s*reading)?|\bodo\b|km\s*(?:reading|run)|mileage)\b[^0-9]{0,12}([0-9][0-9,.\s]{0,11})/i)
    || firstLooseLine(lines, /\b(?:odometer|\bodo\b|mileage)\b/);
  if (!hit) return null;
  const digits = ocrDigits(String(hit.m[1] || '').replace(/[\s,]/g, '')).replace(/\./g, '');
  if (!/^\d{1,7}$/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isInteger(n) || n < 0 || n > 5000000) return null;
  return { value: n, via: hit.fuzzy ? 'fuzzy' : 'label', source: hit.line };
}

// Fuel product + normalized fuel type. Returns BOTH the original detected
// product description and the mapped type, e.g. { product: 'D POWER',
// type: 'Diesel', via: 'label' }. Unknown products return the raw text with
// type null — the caller must NOT invent a classification.
function parseFuelProduct(lines) {
  // 1) Explicit generic fuel words (strongest evidence).
  const ft = firstLine(lines, /\b(diesel|gasoline|premium|unleaded|biofuel)\b/i);
  if (ft) {
    return {
      product: ft.m[1].replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 100),
      type: FUEL_TYPE_MAP[ft.m[1].toLowerCase()],
      via: 'label',
      source: ft.line,
    };
  }
  // 2) Configured product mapping on the confusion-tolerant copy. Longest
  // keys first so "XTRA ADVANCE" wins over "XTRA", "TURBO DIESEL" over "DIESEL".
  const keys = Object.keys(FUEL_PRODUCT_MAP).sort((a, b) => b.length - a.length);
  for (const ln of lines) {
    if (/^\s*(tin|tel|phone|plate|address|cashier|name)\b/i.test(ln)) continue;
    const norm = leet(String(squishSpacedLetters(ln)).replace(/\s+/g, ' '));
    for (const key of keys) {
      if (norm.includes(key)) {
        // Preserve the receipt's own product wording for display: strip
        // quantities, currency and symbols so "2.68 Php74.60" never bleeds
        // into the product name.
        const words = String(ln)
          .replace(/php/gi, ' ')
          .replace(/[0-9][0-9,]*(?:[.,][0-9]+)?/g, ' ')
          .replace(/[^A-Za-z +\-/.]/g, ' ')
          .split(/\s+/)
          // Single capitals are meaningful in fuel names (D POWER, V-POWER)
          // but lowercase fragments are usually OCR noise.
          .filter((w) => /^[A-Z]$/.test(w) || /[A-Za-z]{2,}/.test(w));
        const raw = (words.join(' ').trim().slice(0, 100) || key).toUpperCase();
        return { product: raw, type: FUEL_PRODUCT_MAP[key], via: 'label', source: ln };
      }
    }
  }
  // 3) Fuzzy pass for OCR-mangled words (DIE5EL, UN1EADED, "D I E S E L").
  for (const ln of lines) {
    const norm = leet(String(squishSpacedLetters(ln)).replace(/\s+/g, ' '));
    const m = norm.match(/\b(diesel|gasoline|premium|unleaded|biofuel)\b/);
    if (m) {
      return { product: m[1].toUpperCase(), type: FUEL_TYPE_MAP[m[1]], via: 'fuzzy', source: ln };
    }
    if (/\bgas\b/.test(norm)) return { product: 'GAS', type: 'Gasoline', via: 'fuzzy', source: ln };
  }
  return null;
}

// Description / Qty / Price / Amount table: parse the header once, then read
// each item row as a (qty, price, amount) triple. Row-level parsing keeps the
// three numbers assigned to the right meaning instead of letting each number
// float as a candidate for every field.
function parseTableAmounts(lines) {
  const headerIdx = lines.findIndex((ln) => {
    const l = loose(ln);
    return /\bdescription\b/.test(l) && /\bqty\b|\bquantity\b/.test(l) && /\bprice\b/.test(l) && /\bamount\b/.test(l);
  });
  if (headerIdx === -1) return null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const ln = lines[i];
    // Stop at the totals/discount section.
    if (TOTAL_LABEL.test(ln) || DISCOUNT_HINT.test(ln) || /^\s*(payment|cashier|change)\b/i.test(ln)) break;
    if (/^\s*(name|tin|address|business)\b/i.test(ln)) continue;
    const nums = [...ln.matchAll(new RegExp(NUM, 'g'))].map((m) => m[1]);
    if (nums.length < 2) continue;
    const parsed = nums.map(normalizeNum).filter((n) => n !== null);
    if (parsed.length < 2) continue;
    // Item row: qty is the small decimal (< 1000, usually < 100), price is
    // the mid-range unit price, amount is the largest. Prefer exact triples
    // where qty × price ≈ amount.
    const cands = parsed.filter((n) => n >= 0.1 && n <= 10000000);
    let best = null;
    for (const q of cands) {
      if (q < 0.1 || q > 10000) continue;
      for (const p of cands) {
        if (p === q || p < 1 || p > 100000) continue;
        for (const a of cands) {
          if (a === q || a === p || a < 1) continue;
          const err = Math.abs(q * p - a) / Math.max(1, a);
          if (err <= 0.05 && (!best || err < best.err)) best = { q, p, a, err };
        }
      }
    }
    if (best) {
      const round2 = (n) => Math.round(n * 100) / 100;
      return {
        liters: { value: round2(best.q), via: 'table', source: ln },
        price: { value: round2(best.p), via: 'table', source: ln },
        total: { value: round2(best.a), via: 'table', source: ln },
      };
    }
    // Fallback: exactly the "Qty Price Amount" column order with the last
    // three numbers on the line (e.g. "2.68 Php74.60 Php200.00").
    if (parsed.length >= 3) {
      const [q, p, a] = parsed.slice(-3);
      if (q >= 0.1 && q <= 10000 && p >= 1 && p <= 100000 && a >= 1) {
        const err = Math.abs(q * p - a) / Math.max(1, a);
        if (err <= 0.08) {
          const round2 = (n) => Math.round(n * 100) / 100;
          return {
            liters: { value: round2(q), via: 'table-fuzzy', source: ln },
            price: { value: round2(p), via: 'table-fuzzy', source: ln },
            total: { value: round2(a), via: 'table-fuzzy', source: ln },
          };
        }
      }
    }
  }
  return null;
}

function extractDetails(rawText) {
  const empty = {
    fuel_station: null, fuel_product: null, fuel_type: null, record_date: null, record_time: null,
    odometer_reading: null, liters: null, price_per_liter: null,
    total_amount: null, receipt_reference: null, address: null, transaction_no: null,
  };
  const via = {};
  const sources = {};
  if (!rawText || typeof rawText !== 'string') return { values: empty, via, sources };
  const text = rawText.replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { values: empty, via, sources };
  const values = { ...empty };
  const set = (k, res) => {
    if (res) {
      values[k] = res.value;
      via[k] = res.via;
      if (res.source) sources[k] = String(res.source).slice(0, 200);
    }
  };

  // Fuel product + normalized type (configured mapping only — unknown
  // products keep fuel_type null so the UI marks it NEEDS_VERIFICATION).
  const fp = parseFuelProduct(lines);
  if (fp) {
    set('fuel_product', { value: fp.product, via: fp.via, source: fp.source });
    if (fp.type) set('fuel_type', { value: fp.type, via: fp.via, source: fp.source });
  }

  // Description/Qty/Price/Amount table rows bind qty+price+amount together.
  const table = parseTableAmounts(lines);
  if (table) {
    set('liters', { ...table.liters, via: table.liters.via });
    set('price_per_liter', { value: table.price.value, via: table.price.via, source: table.price.source });
    // The row amount is a candidate total; the labeled TOTAL section below
    // (authoritative) may confirm or override it.
    set('total_amount', { value: table.total.value, via: table.total.via, source: table.total.source });
  }

  // Liters — labeled line first, then unit-suffixed value, then fuzzy label.
  // Range 0.5–10000 L; bare single-digit "1 L" fragments are OCR noise.
  // Skipped when the table already supplied a high-confidence reading.
  if (!values.liters || via.liters === 'table-fuzzy') {
    let hit = firstLine(lines, new RegExp(`\\b(?:liters?|litres?|ltrs?|ltr|qty\\.?|quantity|volume|fuel\\s*(?:qty|quantity|volume|liters?))\\b[^0-9\\n]*${NUM}`, 'i'));
    let res = hit ? numResult(hit.m[1], 'label', 0.5, 10000) : null;
    let src = hit ? hit.line : null;
    if (!res) {
      hit = firstLine(lines, new RegExp(`${NUM}\\s*(?:liters?|ltrs?)\\b`, 'i'))
        || firstLine(lines, new RegExp(`${NUM}\\s*l\\b`, 'i')); // "35.50L", "35.50 L"
      res = hit ? numResult(hit.m[1] || hit.m[2], 'label', 0.5, 10000, { unit: true }) : null;
      src = hit ? hit.line : null;
    }
    if (!res) {
      hit = firstLooseLine(lines, /\b(?:liters?|qty|quantity|volume)\b/);
      res = hit ? numResult(hit.m[1], 'fuzzy', 0.5, 10000) : null;
      src = hit ? hit.line : null;
    }
    // Only override the table reading with a labeled (stronger) one.
    if (res && (!values.liters || res.via === 'label')) {
      set('liters', { value: res.value, via: res.via, source: src });
    } else if (res && !values.liters) {
      set('liters', { value: res.value, via: res.via, source: src });
    }
  }

  // Price per liter — table value first, then labeled lines (unit price,
  // plain "Price" column, "/L", "per liter"), then fuzzy label.
  if (!values.price_per_liter || via.price_per_liter === 'table-fuzzy') {
    let hit = firstLine(lines, new RegExp(`\\b(?:unit\\s*price|fuel\\s*price|price\\s*\\/?\\s*l(?:iter|itre|tr)?s?|price\\s*per\\s*l(?:iter|itre|tr)?s?|rate\\s*\\/?\\s*l|p\\s*/\\s*l)\\b[^0-9\\n]*${NUM}`, 'i'))
      || firstLine(lines, new RegExp(`${NUM}\\s*/\\s*l\\b`, 'i'))
      || firstLine(lines, new RegExp(`${NUM}\\s*per\\s*l(?:iter|itre|tr)?s?\\b`, 'i')) // "62.50 per liter"
      || firstLine(lines, new RegExp(`\\bprice\\b[^0-9\\n]{0,12}${NUM}`, 'i')); // "Price Php74.60" column
    let res = hit ? numResult(hit.m[1], 'label', 1, 100000, { unit: true }) : null;
    let src = hit ? hit.line : null;
    if (!res) {
      hit = firstLooseLine(lines, /\b(?:unit\s*price|price|rate)\b/);
      res = hit ? numResult(hit.m[1], 'fuzzy', 1, 100000) : null;
      src = hit ? hit.line : null;
    }
    if (res && (!values.price_per_liter || res.via === 'label')) {
      set('price_per_liter', { value: res.value, via: res.via, source: src });
    } else if (res && !values.price_per_liter) {
      set('price_per_liter', { value: res.value, via: res.via, source: src });
    }
  }

  // Total — the printed TOTAL section is authoritative. Priority:
  //   1. explicit TOTAL (INCL VAT) / GRAND TOTAL / AMOUNT DUE / NET SALES
  //      (last such line wins — receipts repeat it near the bottom);
  //   2. fuzzy total/grand/net/gross/balance-due wording;
  // VAT breakdowns (VATable/VAT amount/Zero-rated/Exempt) and
  // Tendered/Change/Payment lines are NEVER totals.
  const totals = [];
  for (const ln of lines) {
    if (TOTAL_EXCLUDE.test(ln)) continue;
    const mm = ln.match(new RegExp(`${TOTAL_LABEL.source}[^0-9\\n]*${NUM}`, 'i'));
    if (mm) {
      const all = [...ln.matchAll(new RegExp(NUM, 'g'))];
      totals.push({ raw: all[all.length - 1][1], via: 'label', source: ln, strong: true });
    } else if (/\b(?:grand\s*total|total|net\ssales?|net\samount|gross|balance\s*due)\b/.test(loose(ln)) && !/invoice|reprint|duplicate/i.test(ln)) {
      const all = [...ln.matchAll(new RegExp(NUM, 'g'))];
      if (all.length) totals.push({ raw: all[all.length - 1][1], via: 'fuzzy', source: ln, strong: false });
    }
  }
  if (totals.length) {
    // Prefer the last STRONG (explicitly labeled) total; fall back to the
    // last fuzzy one. The row-amount from the table is only a fallback.
    const strong = totals.filter((t) => t.strong);
    const pick = (strong.length ? strong : totals)[(strong.length ? strong : totals).length - 1];
    const r = numResult(pick.raw, pick.via, 1, 10000000);
    if (r) set('total_amount', { value: r.value, via: r.via, source: pick.source });
  }

  // Fallback for receipts that print bare values without labels:
  //   PETRON / DIESEL / 35.50 / 62.50 / 2218.75
  // Only assigns numbers actually printed on the receipt, and only when a
  // liters x price ~= total triple exists. Never overrides a labeled match.
  inferUnlabeledAmounts(lines, values, via, sources);

  const ref = parseReference(lines);
  set('receipt_reference', ref);

  let m = firstLine(lines, /\btransaction\s*(?:number|id)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/#.]{1,30})/i);
  if (m && m.m[1].toLowerCase() !== (values.receipt_reference || '').toLowerCase()) {
    set('transaction_no', { value: m.m[1].trim().slice(0, 100), via: 'label', source: m.line });
  }

  const { date, time, via: dateVia, source: dateSrc } = parseDate(text);
  if (date) { values.record_date = date; via.record_date = dateVia; if (dateSrc) sources.record_date = String(dateSrc).slice(0, 200); }
  if (time) { values.record_time = time; via.record_time = dateVia; }

  const odo = parseOdometer(lines);
  set('odometer_reading', odo);

  const st = parseStation(lines);
  set('fuel_station', st);

  m = firstLine(lines, /\baddress\s*[:\-]?\s*(.{5,120})/i)
    || firstLine(lines, /(.{5,120}\b(?:st\.|ave\.|brgy\.|barangay|city|province|road|highway)\b.{0,60})/i);
  if (m) set('address', { value: m.m[1].trim().slice(0, 200), via: 'label', source: m.line });

  // Cross-field plausibility: drop values that cannot physically coexist
  // (e.g. total "₱2" next to 35.50 L). When the receipt shows a discount,
  // VAT or tax adjustment, the printed TOTAL is authoritative and the trio
  // is kept for review instead of being dropped. Dropped fields return to
  // manual entry (NOT_DETECTED) rather than carrying a guessed value.
  validateAmounts(values, via, sources, text);

  return { values, via, sources };
}

// Fallback for receipts that print bare values without labels.
// (see extractDetails; unchanged semantics)
function inferUnlabeledAmounts(lines, values, via, sources) {
  if (values.liters && values.price_per_liter && values.total_amount) return;
  const cands = [];
  for (const ln of lines) {
    if (/\b(tin|tel|phone|plate|vat\b|invoice|date|time|s\.?\s*i\.?\s*#?)\b/i.test(ln)) continue;
    if (TOTAL_EXCLUDE.test(ln)) continue;
    const s = String(ln)
      .replace(/\b\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, ' ')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?/gi, ' ');
    for (const m of s.matchAll(new RegExp(NUM, 'g'))) {
      const n = normalizeNum(m[1]);
      if (n === null || n < 0.5 || n > 1000000) continue;
      cands.push(n);
    }
  }
  if (cands.length < 2) return;
  const close = (a, b) => Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.01);
  let best = null;
  for (let i = 0; i < cands.length; i++) {
    for (let j = 0; j < cands.length; j++) {
      if (j === i) continue;
      for (let k = 0; k < cands.length; k++) {
        if (k === i || k === j) continue;
        const li = cands[i], pr = cands[j], tot = cands[k];
        if (li < 0.5 || li > 10000 || pr < 1 || pr > 100000 || tot < 1) continue;
        if (values.liters && !close(li, values.liters)) continue;
        if (values.price_per_liter && !close(pr, values.price_per_liter)) continue;
        if (values.total_amount && !close(tot, values.total_amount)) continue;
        const err = Math.abs(li * pr - tot) / Math.max(1, tot);
        if (err > 0.03) continue;
        // Prefer document order (liters, price, total as printed).
        const score = err + ((i < j && j < k) ? 0 : 0.005);
        if (!best || score < best.score) best = { li, pr, tot, score };
      }
    }
  }
  if (!best) return;
  const round2 = (n) => Math.round(n * 100) / 100;
  if (!values.liters) { values.liters = round2(best.li); via.liters = 'inferred'; }
  if (!values.price_per_liter) { values.price_per_liter = round2(best.pr); via.price_per_liter = 'inferred'; }
  if (!values.total_amount) { values.total_amount = round2(best.tot); via.total_amount = 'inferred'; }
}

// Drop physically impossible combinations so garbage never reaches the form.
// With discount/VAT/tax hints on the receipt the printed total is kept as
// authoritative (flagged for review, never silently dropped).
function validateAmounts(values, via, sources, fullText = '') {
  const { liters: li, price_per_liter: pr, total_amount: tot } = values;
  if (li && pr && tot) {
    const hasAdjustment = DISCOUNT_HINT.test(fullText || '');
    if (hasAdjustment) return; // keep trio; cross-check flags it for review
    // A total smaller than either factor is impossible when both factors ≥ 1.
    if (li >= 1 && pr >= 1 && tot < Math.min(li, pr)) {
      values.total_amount = null; delete via.total_amount; delete sources.total_amount; return;
    }
    if (pr >= 1 && li > tot) { values.liters = null; delete via.liters; delete sources.liters; return; }
    if (li >= 1 && pr > tot) { values.price_per_liter = null; delete via.price_per_liter; delete sources.price_per_liter; }
  }
}

// Total check: |liters × price − detected total| within rounding tolerance.
// With discounts/VAT/taxes the printed total stays authoritative — the
// mismatch is reported (NEEDS_VERIFICATION) rather than rejecting the receipt.
export function checkTotal(values, rawText = '') {
  const li = +values.liters, pr = +values.price_per_liter, tot = +values.total_amount;
  if (!(li > 0) || !(pr > 0) || !(tot > 0)) return { checked: false, totalMatches: false, calculatedTotal: null };
  const calculatedTotal = Math.round(li * pr * 100) / 100;
  const tolerance = Math.max(1, Math.abs(tot) * 0.02);
  const diff = Math.round(Math.abs(calculatedTotal - tot) * 100) / 100;
  const totalMatches = diff <= tolerance;
  const out = {
    checked: true,
    totalMatches,
    calculatedTotal,
    detectedTotal: tot,
    diff,
  };
  if (!totalMatches && DISCOUNT_HINT.test(String(rawText || ''))) {
    out.note = 'Calculated amount differs from the printed total — the receipt shows a discount, VAT or tax adjustment. The printed total is authoritative.';
  }
  return out;
}

// Build the per-field verification state consumed by the UI and the
// save-gate: every field carries { value, confidence, source, tier, status }.
// Statuses: VERIFIED | NEEDS_VERIFICATION | NOT_DETECTED. Nothing is ever
// invented — unreadable fields are NOT_DETECTED, uncertain ones are
// NEEDS_VERIFICATION.
export function buildFieldStates(values, via, tiers, validation, sources = {}, meanConf = 80) {
  const AMOUNTS = new Set(['liters', 'price_per_liter', 'total_amount']);
  const crossOk = !validation || !validation.checked || validation.totalMatches;
  const states = {};
  for (const k of Object.keys(values)) {
    const v = values[k];
    if (v === null || v === undefined || v === '') {
      states[k] = { value: null, confidence: 0, source: sources[k] || null, tier: null, status: FIELD_STATUS.NOT_DETECTED };
      continue;
    }
    const tier = tiers[k] || 'verify';
    const confidence = fieldConfidence(via[k], meanConf);
    states[k] = {
      value: v,
      confidence,
      source: sources[k] || null,
      tier,
      status: statusFor(tier, { isAmount: AMOUNTS.has(k), crossOk, hasValue: true }),
    };
  }
  // fuel_type derived purely from an unmapped product word is review-only.
  return states;
}

// Revalidate user-corrected values before saving. `formValues` uses the
// snake_case form shape { fuel_type, liters, price_per_liter,
// receipt_total|total_amount, record_date, receipt_reference }; `prevStates`
// is the OCR field-state map. Returns { states, canSave, issues } where
// states mirrors buildFieldStates for the required fields and canSave is
// false while any required field still NEEDS_VERIFICATION / NOT_DETECTED.
export function validateCorrectedValues(formValues = {}, prevStates = {}) {
  const get = (s, ...keys) => {
    for (const k of keys) {
      const v = s[k];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  };
  const candidate = {
    fuel_type: get(formValues, 'fuel_type'),
    liters: get(formValues, 'liters'),
    price_per_liter: get(formValues, 'price_per_liter'),
    total_amount: get(formValues, 'total_amount', 'receipt_total'),
    record_date: get(formValues, 'record_date'),
    receipt_reference: get(formValues, 'receipt_reference'),
  };
  const li = candidate.liters !== null ? +candidate.liters : NaN;
  const pr = candidate.price_per_liter !== null ? +candidate.price_per_liter : NaN;
  const tot = candidate.total_amount !== null ? +candidate.total_amount : NaN;
  const calc = Number.isFinite(li) && Number.isFinite(pr) && li > 0 && pr > 0 ? Math.round(li * pr * 100) / 100 : null;
  const crossOk = calc !== null && Number.isFinite(tot) && tot > 0
    ? Math.abs(calc - tot) <= Math.max(1, Math.abs(tot) * 0.02)
    : true; // nothing to cross-check yet — don't block on math alone
  const plausible = {
    fuel_type: typeof candidate.fuel_type === 'string' && candidate.fuel_type.trim().length > 0,
    liters: Number.isFinite(li) && li > 0 && li <= 10000,
    price_per_liter: Number.isFinite(pr) && pr > 0 && pr <= 100000,
    total_amount: Number.isFinite(tot) && tot > 0 && tot <= 10000000,
    record_date: /^\d{4}-\d{2}-\d{2}$/.test(String(candidate.record_date || '')) && !Number.isNaN(new Date(`${candidate.record_date}T00:00:00`).getTime()),
    receipt_reference: candidate.receipt_reference === null || (String(candidate.receipt_reference).trim().length >= 2 && /\d/.test(String(candidate.receipt_reference))),
  };
  const states = {};
  const issues = [];
  for (const k of REQUIRED_FIELDS) {
    const prev = prevStates[k];
    const wasOcrVerified = prev && prev.status === FIELD_STATUS.VERIFIED;
    const ok = !!plausible[k] && (k === 'liters' || k === 'price_per_liter' || k === 'total_amount' ? crossOk : true);
    if (candidate[k] === null || candidate[k] === undefined || candidate[k] === '') {
      states[k] = FIELD_STATUS.NOT_DETECTED;
      issues.push(k);
    } else if (ok && (wasOcrVerified || prev?.manuallyCorrected)) {
      states[k] = FIELD_STATUS.VERIFIED;
    } else if (ok && !prev) {
      // Manually typed with no OCR reading to contradict — accept as verified.
      states[k] = FIELD_STATUS.VERIFIED;
    } else if (ok) {
      states[k] = FIELD_STATUS.NEEDS_VERIFICATION;
      issues.push(k);
    } else {
      states[k] = FIELD_STATUS.NEEDS_VERIFICATION;
      issues.push(k);
    }
  }
  return { states, canSave: issues.length === 0, issues, crossOk, calculatedTotal: calc };
}

// Predictable structured response consumed by the form:
//
// {
//   success: true,
//   receipt: { fuelStation, fuelProduct, fuelType, date, time, odometer,
//              liters, pricePerLiter, totalAmount, referenceNumber },
//   tiers: { fuelStation: 'high'|'medium'|'verify', ... },
//   fieldStates: { liters: { value, confidence, source, tier, status }, ... },
//   receiptStatus: 'DETECTED' | 'PARTIAL' | 'NOT_DETECTED',
//   validation: { totalMatches, calculatedTotal, detectedTotal, checked }
// }
export function buildReceiptResponse(values, via, sources = {}) {
  const tiers = {};
  for (const k of Object.keys(values)) {
    if (values[k] !== null && values[k] !== undefined) tiers[k] = tierFor(via[k]);
  }
  const validation = checkTotal(values);
  const crossOk = !validation.checked || validation.totalMatches;
  const fieldStates = buildFieldStates(values, via, tiers, validation, sources);
  const receipt = {
    fuelStation: values.fuel_station ?? null,
    fuelProduct: values.fuel_product ?? null,
    fuelType: values.fuel_type ?? null,
    date: values.record_date ?? null,
    time: values.record_time ?? null,
    odometer: values.odometer_reading ?? null,
    liters: values.liters ?? null,
    pricePerLiter: values.price_per_liter ?? null,
    totalAmount: values.total_amount ?? null,
    referenceNumber: values.receipt_reference ?? null,
  };
  const present = Object.values(receipt).filter((v) => v !== null && v !== undefined).length;
  const requiredPresent = ['fuelType', 'liters', 'pricePerLiter', 'totalAmount', 'date', 'referenceNumber']
    .filter((k) => receipt[k] !== null && receipt[k] !== undefined).length;
  const receiptStatus = present === 0 ? RECEIPT_STATUS.NOT_DETECTED : requiredPresent >= 4 && crossOk ? RECEIPT_STATUS.DETECTED : RECEIPT_STATUS.PARTIAL;
  const success = present > 0;
  return { success, receipt, tiers, fieldStates, receiptStatus, sources, validation };
}

// Legacy field-confidence (kept for back-compat; the UI uses tiers because
// the engine only reports one page-level score).
const VIA_ADJ = { label: 0, brand: -2, 'brand-fuzzy': -12, fuzzy: -12, header: -18, 'header-weak': -40, inferred: -15, table: 0, 'table-fuzzy': -12, 'numeric-region': 0, 'numeric-region-weak': -12 };
export function fieldConfidence(via, meanConf) {
  const base = Number.isFinite(+meanConf) ? +meanConf : 80;
  const adj = VIA_ADJ[via] ?? -15;
  return Math.max(0, Math.min(99, Math.round(base + adj)));
}

export function parseReceiptDetails(rawText, meanConf) {
  const { values, via, sources } = extractDetails(rawText);
  const confidence = {};
  const tiers = {};
  for (const k of Object.keys(values)) {
    if (values[k] !== null && values[k] !== undefined) {
      confidence[k] = fieldConfidence(via[k], meanConf);
      tiers[k] = tierFor(via[k]);
    }
  }
  const validation = checkTotal(values, rawText);
  return { values, via, sources, confidence, tiers, fieldStates: buildFieldStates(values, via, tiers, validation, sources, meanConf), validation };
}

// Back-compat: values only.
export function parseReceiptText(rawText) {
  return extractDetails(rawText).values;
}

// Client-side gate before upload/OCR: extension + MIME + 10 MB.
export const RECEIPT_MAX_SIZE = 10 * 1024 * 1024;
const RECEIPT_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const RECEIPT_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateReceiptFile(file) {
  if (!file) return 'Please select a receipt image.';
  const name = String(file.name || '');
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (!RECEIPT_EXTS.includes(ext)) return 'Only JPG, JPEG, PNG and WEBP images are allowed.';
  if (file.type && !RECEIPT_MIMES.includes(file.type)) return 'Invalid image type. Only JPG, PNG and WEBP are allowed.';
  if (file.size > RECEIPT_MAX_SIZE) return 'Receipt image must not exceed 10 MB.';
  if (file.size <= 0) return 'Selected file is empty.';
  return null;
}
