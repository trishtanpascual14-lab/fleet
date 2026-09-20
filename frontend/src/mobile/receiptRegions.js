// Receipt table geometry + numeric agreement voting — PURE functions, no DOM,
// no imports. Safe to unit-test in node.
//
// The OCR engine returns words as { text, conf, x0, y0, x1, y1 } with
// coordinates NORMALIZED to 0..1 of the corrected receipt image. Fields are
// assigned by WHERE a number sits (column bands from the detected header
// row), never by scanning raw text for stray digits:
//
//   number under QUANTITY  → liters
//   number under UNIT PRICE → price_per_liter
//   number under AMOUNT     → line amount
//   number right of TOTAL AMOUNT DUE → total_amount
//
// If several OCR passes read the same region and agree on one number,
// confidence is HIGH; a lone weak reading is REJECTED (NOT_DETECTED) rather
// than guessed.

const QTY_RE = /\b(qty\.?|quantity|quantities|volume|liters?|litres?|ltrs?)\b/i;
const PRICE_RE = /\b(unit\s*price|fuel\s*price|price|rate|per\s*l(?:iter|itre|tr)?s?)\b/i;
const AMOUNT_RE = /\b(amounts?|total|extended)\b/i;
const HEADER_WORD_RE = /\b(qty\.?|quantity|price|amount|description|item)\b/i;
const TOTAL_LABEL_RE = /\b(total\s*(amount\s*due|\(?incl|amount)?|grand\s*total|amount\s*due|net\s*(sales|amount))\b/i;
const TOTAL_BANNED_RE = /(tendered|change|payment|vatable|vat\s*amount|zero\s*rated|exempt|cash\b|balance\s*(inquiry|enquiry))/i;
const ITEM_AREA_STOP_RE = /(discount|total|payment|tendered|change|cashier|vat\b)/i;

// "₱2,218.75" -> 2218.75 ; "22,27" -> 22.27 ; "82.80" -> 82.80.
// Returns a rounded-2 number, or null when not plausibly numeric.
export function normalizeDecimalToken(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[\s]/g, '').trim();
  if (!s) return null;
  s = s.replace(/^(?:php|₱|p)+/i, '').replace(/(?:php|₱)$/i, '');
  s = s.replace(/(?:\/l(?:trs?|iters?)?|perl(?:iters?)?|ltrs?|liters?|l)$/i, '');
  if (!/^[0-9][0-9.,]*$/.test(s)) return null;
  const hasDot = s.includes('.');
  const commas = (s.match(/,/g) || []).length;
  if (hasDot) {
    // "2,218.75" -> thousand separators; stray "22.2.7" is garbage.
    if (/\..*\./.test(s)) return null;
    s = s.replace(/,/g, '');
  } else if (commas === 1 && /,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.'); // decimal comma: "22,27"
  } else {
    s = s.replace(/,/g, ''); // thousand separators or noise commas
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

// All numeric-looking substrings inside a text fragment (word or line).
export function extractNumericTokens(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/[0-9][0-9,]*(?:[.,][0-9]+)?/g)) {
    const v = normalizeDecimalToken(m[0]);
    if (v !== null) out.push({ raw: m[0], value: v });
  }
  return out;
}

// Fuzzy word similarity for OCR-mangled labels ("Qu."→Qty, "Pica"→Price,
// "Amott"→Amount, "TAT"→VAT). Letters only, case-insensitive.
export function editSimilarity(a, b) {
  a = String(a || '').toLowerCase().replace(/[^a-z]/g, '');
  b = String(b || '').toLowerCase().replace(/[^a-z]/g, '');
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  if (a === b) return 1;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// Best similarity of a word against candidate spellings. Short words need a
// stronger match so "or"/"an" don't match everything.
export function fuzzyWordMatch(word, candidates, threshold = 0.6) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 2) return 0;
  let best = 0;
  for (const c of candidates) {
    const s = editSimilarity(w, c);
    if (s > best) best = s;
  }
  const need = w.length <= 3 ? Math.max(threshold, 0.66) : threshold;
  return best >= need ? best : 0;
}

const FUZZY_GROUPS = {
  qty: ['qty', 'quantity', 'qunty', 'quanty', 'qti', 'qy', 'qu', 'qt'],
  price: ['price', 'prlce', 'pnce', 'pric', 'pica', 'prica', 'rate'],
  amount: ['amount', 'amout', 'amonut', 'amoun', 'amott', 'total'],
  desc: ['description', 'descriptlon', 'descripton', 'item', 'product'],
  total: ['total', 't0tal', 'tota', 'totai'],
  due: ['due', 'amout', 'amount', 'duee'],
  incl: ['incl', 'lncl', 'ancl', 'inc'],
  vat: ['vat', 'vaf', 'vut', 'vati'],
  grand: ['grand', 'grandt'],
  net: ['net', 'nett'],
};

function rowFuzzyGroups(row) {
  const hits = {};
  for (const w of row.words) {
    for (const [g, cands] of Object.entries(FUZZY_GROUPS)) {
      const s = fuzzyWordMatch(w.text, cands);
      if (s > 0 && (!hits[g] || s > hits[g])) hits[g] = s;
    }
  }
  return hits;
}

function rowFuzzyBanned(rowText, words) {
  // Banned rows (tendered/change/payment/VAT breakdowns) need a STRICT match
  // so "Tendersd" is caught but "Amount" is never banned.
  const banned = ['tendered', 'change', 'payment', 'vatable', 'tender', 'cashier'];
  const toks = String(rowText).toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 4);
  for (const t of toks) {
    for (const b of banned) {
      if (editSimilarity(t, b) >= 0.8) return true;
    }
  }
  void words;
  return false;
}

// Cluster words into rows by vertical overlap. Returns rows sorted by y,
// each { y0, y1, yc, words: [...], text }.
export function groupRows(words, yTol = 0.012) {
  const sorted = [...words].sort((a, b) => ((a.y0 + a.y1) / 2) - ((b.y0 + b.y1) / 2));
  const rows = [];
  for (const w of sorted) {
    const yc = (w.y0 + w.y1) / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(yc - last.yc) <= yTol) {
      last.words.push(w);
      last.y0 = Math.min(last.y0, w.y0);
      last.y1 = Math.max(last.y1, w.y1);
      last.yc = (last.y0 + last.y1) / 2;
    } else {
      rows.push({ y0: w.y0, y1: w.y1, yc, words: [w] });
    }
  }
  for (const r of rows) {
    r.words.sort((a, b) => a.x0 - b.x0);
    r.text = r.words.map((w) => w.text).join(' ');
  }
  return rows;
}

// Locate the "Description Qty Price Amount" header row. Exact words first;
// OCR-mangled labels ("Qu.", "Pica", "Amott") fall back to fuzzy matching
// (flagged via fuzzy:true so the caller tiers it medium, never high).
// Returns null when the header cannot be found (caller uses fallback bands).
export function findHeaderRow(words) {
  const rows = groupRows(words);
  let best = null;
  let bestFuzzy = null;
  for (const r of rows) {
    if (r.yc > 0.75) continue; // header lives in the upper 3/4
    const t = r.text;
    const considerFuzzy = () => {
      const hits = rowFuzzyGroups(r);
      const fscore = (hits.qty ? 1 : 0) + (hits.price ? 1 : 0) + (hits.amount ? 1 : 0);
      if (fscore >= 2 && (!bestFuzzy || fscore > bestFuzzy.score)) {
        const pickF = (g) => {
          let bw = null, bs = 0;
          for (const w of r.words) {
            const s = fuzzyWordMatch(w.text, FUZZY_GROUPS[g]);
            if (s > bs) { bs = s; bw = w; }
          }
          return bw;
        };
        bestFuzzy = {
          score: fscore, row: r, fuzzy: true,
          qtyBox: pickF('qty'), priceBox: pickF('price'), amountBox: pickF('amount'),
        };
      }
    };
    if (!HEADER_WORD_RE.test(t)) {
      // Exact pre-filter missed — try fuzzy groups on this row.
      considerFuzzy();
      continue;
    }
    const hasQty = QTY_RE.test(t);
    const hasPrice = PRICE_RE.test(t);
    const hasAmount = AMOUNT_RE.test(t);
    const score = (hasQty ? 1 : 0) + (hasPrice ? 1 : 0) + (hasAmount ? 1 : 0);
    if (score >= 2) {
      if (!best || score > best.score) {
        const pick = (re) => r.words.find((w) => re.test(w.text));
        best = {
          score,
          row: r,
          qtyBox: pick(QTY_RE) || null,
          priceBox: pick(PRICE_RE) || null,
          amountBox: pick(AMOUNT_RE) || null,
        };
      }
    } else {
      // Label words present but mangled ("Qu.", "Pica") — fuzzy rescue.
      considerFuzzy();
    }
  }
  return best || bestFuzzy;
}

const cxOf = (b) => (b.x0 + b.x1) / 2;

// Column bands from header word boxes + calibrated value geometry.
// Measured on real PH receipts: numeric VALUES sit ~+0.045 right of their
// header LABELS ("Qu."@0.28 → "2.68"@0.33), columns run qty→price→amount
// with ~0.11/0.15 pitch. Label-only edges clip digits, so centers are
// projected to value positions and bands are drawn generously around them;
// assignment is nearest-center (tolerant to label/value offset).
export function columnBandsFromHeader(found) {
  const q = found.qtyBox ? cxOf(found.qtyBox) : null;
  const p = found.priceBox ? cxOf(found.priceBox) : null;
  const a = found.amountBox ? cxOf(found.amountBox) : null;
  const SHIFT = 0.045; // label center → value center
  const est = { q: [], p: [], a: [] };
  if (q !== null) { est.q.push(q + SHIFT); est.p.push(q + 0.11); est.a.push(q + 0.26); }
  if (p !== null) { est.q.push(p - 0.11); est.p.push(p + SHIFT); est.a.push(p + 0.15); }
  if (a !== null) { est.q.push(a - 0.26); est.p.push(a - 0.15); est.a.push(a + SHIFT); }
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  if (!est.q.length) return { ...fallbackBands(), source: 'fallback' };
  const qc = avg(est.q), pc = avg(est.p), ac = avg(est.a);
  const labels = [q, p, a].filter((v) => v !== null).length;
  return {
    qty: [Math.max(0.15, qc - 0.09), qc + 0.09],
    price: [Math.max(0.15, pc - 0.10), pc + 0.10],
    amount: [Math.max(0.15, ac - 0.13), 1],
    centers: { qty: qc, price: pc, amount: ac },
    source: labels >= 3 ? 'header' : 'header-partial',
  };
}

// Positional fallback when no header row is found: typical PH fuel receipt
// layout. Always flagged WEAK — values from these bands need verification.
export function fallbackBands() {
  return {
    qty: [0.3, 0.56],
    price: [0.52, 0.78],
    amount: [0.74, 1.0],
    source: 'fallback',
  };
}

export function assignColumn(xCenter, bands, maxDist = 0.12) {
  if (!bands) return null;
  // Nearest projected VALUE center (tolerant to label/value offset).
  const centers = bands.centers || (() => {
    const midOf = (name) => {
      const b = bands[name];
      return b ? (b[0] + b[1]) / 2 : null;
    };
    return { qty: midOf('qty'), price: midOf('price'), amount: midOf('amount') };
  })();
  let best = null, bestD = Infinity;
  for (const name of ['qty', 'price', 'amount']) {
    const c = centers[name];
    if (c === null || c === undefined) continue;
    // Hard guard: never cross into the description zone or past the right edge.
    const b = bands[name];
    if (b && (xCenter < b[0] - 0.03 || xCenter > b[1] + 0.03)) continue;
    const d = Math.abs(xCenter - c);
    if (d < bestD) { bestD = d; best = name; }
  }
  return bestD <= maxDist ? best : null;
}

// Item area: below the header row, above the totals/discount/payment block.
export function itemArea(words, headerRow, totalRow) {
  const y0 = headerRow ? headerRow.y1 + 0.005 : 0.2;
  let y1 = totalRow ? totalRow.y0 - 0.003 : 0.9;
  const rows = groupRows(words);
  for (const r of rows) {
    if (r.yc <= y0) continue;
    if (totalRow && r.yc >= totalRow.y0) break;
    if (ITEM_AREA_STOP_RE.test(r.text) && /\d/.test(r.text) === false) {
      // A labelless stop line (e.g. "Discount amount w/o VAT" has digits —
      // keep scanning; pure label lines end the item area).
      y1 = Math.min(y1, r.y0 - 0.003);
      break;
    }
    if (/discount|payment|tendered|cashier/i.test(r.text)) {
      y1 = Math.min(y1, r.y0 - 0.003);
      break;
    }
  }
  if (y1 <= y0 + 0.01) y1 = Math.min(0.95, y0 + 0.3);
  return { y0, y1 };
}

// The TOTAL AMOUNT DUE / TOTAL (INCL VAT) / GRAND TOTAL label row — the
// handwritten total beside it gets special priority. VAT breakdowns and
// tendered/change rows are excluded (fuzzy, so "Tendersd" is still caught).
// OCR-mangled labels ("(Fhe. TAT)") fall back to fuzzy matching (flagged via
// fuzzy:true so the caller tiers it medium, never high).
export function findTotalRow(words) {
  const rows = groupRows(words);
  const labelX1Of = (r) => {
    // Label = words BEFORE the first digit-carrying word. (On tilted
    // receipts the row may merge with the next line — e.g. "…php200.LU
    // chp. 00" — and a naive alpha-only max would push the value zone past
    // the actual total.)
    const pre = [];
    for (const w of r.words) {
      if (/\d/.test(w.text)) break;
      pre.push(w);
    }
    const labelWords = pre.filter((w) => /[a-z]/i.test(w.text));
    const pool = labelWords.length ? labelWords : r.words.filter((w) => /[a-z]/i.test(w.text) && !/\d/.test(w.text));
    return pool.length ? Math.max(...pool.map((w) => w.x1)) : 0.5;
  };
  const cands = [];
  const fuzzyCands = [];
  for (const r of rows) {
    if (r.yc < 0.25) continue;
    if (TOTAL_BANNED_RE.test(r.text) || rowFuzzyBanned(r.text, r.words)) continue;
    if (!TOTAL_LABEL_RE.test(r.text)) {
      // Fuzzy rescue: a "total"-like word plus an amount/due/incl/vat-like word.
      const hits = rowFuzzyGroups(r);
      const hasTotal = !!hits.total;
      const hasQual = !!(hits.due || hits.incl || hits.vat || hits.grand || hits.net || hits.amount);
      if (hasTotal && hasQual) fuzzyCands.push({ row: r, labelX1: labelX1Of(r), fuzzy: true });
      continue;
    }
    cands.push({ row: r, labelX1: labelX1Of(r) });
  }
  const pick = (list) => {
    if (!list.length) return null;
    // Prefer "amount due" wording, then the lowest row (totals print last).
    list.sort((a, b) => {
      const ad = /amount\s*due/i.test(a.row.text) ? 0 : 1;
      const bd = /amount\s*due/i.test(b.row.text) ? 0 : 1;
      return ad - bd || b.row.yc - a.row.yc;
    });
    return list[0];
  };
  return pick(cands) || pick(fuzzyCands);
}

// Agreement voting across OCR passes for ONE region.
// cands: [{ value:number, conf:0..100, pass:string }]
// HIGH: ≥3 passes agree (avg conf ≥55), or 2 passes agreeing strongly
// (avg conf ≥75 — enables early exit without a 3rd slow pass).
// VERIFY: ≥2 passes agree, or one strong pass (conf ≥75).
// Otherwise REJECT → NOT_DETECTED, never guessed.
export function voteNumeric(cands) {
  const groups = new Map();
  for (const c of cands) {
    if (c === null || c === undefined) continue;
    const v = typeof c.value === 'number' ? Math.round(c.value * 100) / 100 : normalizeDecimalToken(c.value ?? c.raw ?? c.text);
    if (v === null || !Number.isFinite(v)) continue;
    const key = v.toFixed(2);
    if (!groups.has(key)) groups.set(key, { value: v, votes: [] });
    groups.get(key).votes.push({ conf: Math.max(0, Math.min(100, +c.conf || 0)), pass: c.pass || '?' });
  }
  if (!groups.size) return { value: null, passes: 0, avgConf: 0, verdict: 'REJECT', alternatives: [] };
  const ranked = [...groups.values()].map((g) => ({
    ...g,
    passes: g.votes.length,
    avgConf: Math.round((g.votes.reduce((s, v) => s + v.conf, 0) / g.votes.length) * 10) / 10,
  })).sort((a, b) => b.passes - a.passes || b.avgConf - a.avgConf);
  const top = ranked[0];
  let verdict = 'REJECT';
  if ((top.passes >= 3 && top.avgConf >= 55) || (top.passes >= 2 && top.avgConf >= 75)) verdict = 'HIGH';
  // Two agreeing passes with very low confidence are still guessing (e.g.
  // two "5" fragments at 9% conf) — REJECT below the floor, never verify.
  else if ((top.passes >= 2 && top.avgConf >= 30) || (top.passes === 1 && top.avgConf >= 75)) verdict = 'VERIFY';
  return {
    value: verdict === 'REJECT' ? null : top.value,
    passes: top.passes,
    avgConf: top.avgConf,
    verdict,
    alternatives: ranked.slice(1, 3).map((g) => ({ value: g.value, passes: g.passes, avgConf: g.avgConf })),
  };
}

// Build region rectangles (normalized 0..1) for cropping:
// description / qty / price / amount strips over the item area + total row.
export function regionRects(bands, area, totalRow, padX = 0.015, padY = 0.004) {  const clamp = (v) => Math.max(0, Math.min(1, v));
  const strip = (band) => ({
    x: clamp(band[0] - padX),
    y: clamp(area.y0 - padY),
    w: clamp(band[1] + padX) - clamp(band[0] - padX),
    h: clamp(area.y1 + padY) - clamp(area.y0 - padY),
  });
  const out = {};
  if (bands.qty) out.qty = strip(bands.qty);
  if (bands.price) out.price = strip(bands.price);
  if (bands.amount) out.amount = strip(bands.amount);
  if (bands.qty) {
    out.description = {
      x: 0,
      y: clamp(area.y0 - padY),
      w: clamp(bands.qty[0]),
      h: clamp(area.y1 + padY) - clamp(area.y0 - padY),
    };
  }
  if (totalRow) {
    out.total = {
      x: clamp(totalRow.labelX1 - 0.02),
      y: clamp(totalRow.row.y0 - padY),
      w: 1 - clamp(totalRow.labelX1 - 0.02),
      h: clamp(totalRow.row.y1 + padY) - clamp(totalRow.row.y0 - padY),
    };
  }
  return out;
}

// Rejoin decimals split across adjacent words ("74." + "60" → 74.60,
// "Php" + "74.60" → 74.60). Joins ONLY when the left part ends with a
// decimal mark or is a pure currency prefix — "200" + "00" must NEVER
// become 20000. Words need {text, conf, x0, x1}; pairs must be close
// (gap < maxGap, normalized units). Returns [{ value, conf, text }].
export function joinSplitNumbers(words, maxGap = 0.025) {
  const out = [];
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const L = sorted[i], R = sorted[i + 1];
    const gap = R.x0 - L.x1;
    if (gap < -0.005 || gap > maxGap) continue;
    const lt = String(L.text || '').trim(), rt = String(R.text || '').trim();
    if (!rt || !/^[0-9]/.test(rt)) continue;
    const leftIsDecimal = /[.,]$/.test(lt);
    const leftIsPrefix = /^[A-Za-z₱Pp.]*$/.test(lt) && /[A-Za-z₱Pp]/.test(lt);
    if (!leftIsDecimal && !leftIsPrefix) continue;
    const v = normalizeDecimalToken(lt + rt);
    if (v === null) continue;
    // The joined value must extend, not duplicate, the parts.
    out.push({
      value: v, conf: Math.round(((+L.conf || 0) + (+R.conf || 0)) / 2), text: `${lt}${rt}`,
      x0: L.x0, x1: R.x1, yc: (((L.y0 + L.y1) / 2) + ((R.y0 + R.y1) / 2)) / 2,
    });
  }
  return out;
}

// Map OCR letter/digit confusion ONLY inside fragments that already contain
// a digit ("2O0.00" → "200.00", "z.568" → "2.568", "Php200.0C" → "Php200.00").
// Pure words ("Total", "Cash", "Zero") never contain a digit in the matched
// chunk and pass through untouched.
export function fixDigitConfusion(text) {
  return String(text || '').replace(/[0-9A-Za-z.,₱]*\d[0-9A-Za-z.,₱]*/g, (chunk) =>
    chunk
      .replace(/[oO]/g, '0')
      .replace(/[iIl]/g, '1')
      .replace(/[sS]/g, '5')
      .replace(/[bB]/g, '8')
      .replace(/[gG]/g, '6')
      .replace(/[zZ]/g, '2')
      .replace(/[cC]/g, '0'));
}

// ---------------------------------------------------------------------------
// Tilted-receipt support + row-level crops for single-word OCR (PSM 8).
// A tall multi-line strip fed to PSM 7/8 fails ("Image too small" /
// garbage) — PSM 8 needs ONE text row. These helpers carve tight,
// skew-aware row crops out of the column bands instead.
// ---------------------------------------------------------------------------

// Direct TEXT skew measurement from word boxes. Tesseract already groups
// words into text lines — fit a slope per long line and take the median.
// Robust to fragmented lines and outlier boxes; needs no pixels and no
// resampling. Returns radians (+ = clockwise, y grows downward) or null.
// (Paper edges lie: curl/shadow skew them. Text lines are the truth.)
export function estimateTextSkew(words) {
  const byLine = new Map();
  for (const w of words) {
    const key = w._line !== undefined ? w._line : null;
    if (key === null) continue;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(w);
  }
  let slopes = [];
  if (byLine.size >= 3) {
    for (const ws of byLine.values()) {
      if (ws.length < 3) continue;
      const xs = ws.map((w) => (w.x0 + w.x1) / 2);
      const ys = ws.map((w) => (w.y0 + w.y1) / 2);
      if (Math.max(...xs) - Math.min(...xs) < 0.15) continue;
      const n = xs.length;
      const mx = xs.reduce((a, c) => a + c, 0) / n;
      const my = ys.reduce((a, c) => a + c, 0) / n;
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
      if (sxx > 1e-8) slopes.push(sxy / sxx);
    }
  } else {
    // No line ids (flat word list): pair words with strong vertical overlap
    // (same visual line) over a long baseline and take the median slope.
    const sorted = [...words].sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const A = sorted[i], B = sorted[j];
        const dx = ((B.x0 + B.x1) / 2) - ((A.x0 + A.x1) / 2);
        if (dx < 0.2 || dx > 0.6) continue;
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        const h = Math.min(A.y1 - A.y0, B.y1 - B.y0);
        if (h <= 0 || oy < h * 0.5) continue;
        slopes.push((((B.y0 + B.y1) / 2) - ((A.y0 + A.y1) / 2)) / dx);
      }
    }
  }
  if (slopes.length < 5) return null;
  slopes.sort((a, b) => a - b);
  const med = slopes[Math.floor(slopes.length / 2)];
  if (!Number.isFinite(med) || Math.abs(med) > 0.2) return null;
  // Lines must AGREE: wide spread means no measurable tilt.
  const q1 = slopes[Math.floor(slopes.length * 0.25)];
  const q3 = slopes[Math.floor(slopes.length * 0.75)];
  if (q3 - q1 > 0.06) return null;
  return Math.atan(med);
}

// Shear-correct word boxes for row grouping on tilted receipts:
// y' = y - (x - 0.5) * tan(skew). Returns NEW objects; originals (used for
// crops and debug boxes) are untouched.
export function shearCorrectWords(words, skewTan) {
  if (!skewTan) return words;
  return words.map((w) => {
    const sh = (((w.x0 + w.x1) / 2) - 0.5) * skewTan;
    return { ...w, y0: w.y0 - sh, y1: w.y1 - sh };
  });
}

// Rows inside the item area carrying numeric content in the column bands,
// top-first: [{ row, tokens: { qty:[], price:[], amount:[] } }]. The primary
// item row (first with any band numeric) is the product line; discount/VAT
// rows below carry their own numbers in other positions.
export function itemDataRows(words, headerRow, totalRow, bands) {
  const area = itemArea(words, headerRow, totalRow);
  const rows = groupRows(words).filter((r) => r.yc > area.y0 && r.yc < area.y1);
  const out = [];
  for (const r of rows) {
    const tokens = { qty: [], price: [], amount: [] };
    for (const w of r.words) {
      const cx = (w.x0 + w.x1) / 2;
      const col = assignColumn(cx, bands);
      if (!col) continue;
      for (const t of extractNumericTokens(w.text)) {
        tokens[col].push({ value: t.value, raw: t.raw, conf: w.conf || 0, word: w });
      }
    }
    if (tokens.qty.length || tokens.price.length || tokens.amount.length) {
      out.push({ row: r, tokens });
    }
  }
  return out;
}

// Tight crop around a row's words inside ONE column band (normalized rect),
// padded for residual tilt. Null when the row has no words in that band.
export function rowBandRect(row, band, padX = 0.012, padY = 0.014) {  if (!row || !band) return null;
  const inside = row.words.filter((w) => {
    const cx = (w.x0 + w.x1) / 2;
    return cx >= band[0] && cx <= band[1];
  });
  if (!inside.length) return null;
  const x0 = Math.min(...inside.map((w) => w.x0));
  const x1 = Math.max(...inside.map((w) => w.x1));
  const y0 = Math.min(...inside.map((w) => w.y0));
  const y1 = Math.max(...inside.map((w) => w.y1));
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const ax0 = clamp(x0 - padX), ax1 = clamp(x1 + padX);
  const ay0 = clamp(y0 - padY), ay1 = clamp(y1 + padY);
  if (ax1 - ax0 < 0.01 || ay1 - ay0 < 0.004) return null;
  return { x: ax0, y: ay0, w: ax1 - ax0, h: ay1 - ay0 };
}

// Full-band-width crop of ONE row (normalized rect): x spans the whole
// column band (Stage-1 word boxes are often too narrow and would clip
// digits), y spans the row height. This is a SINGLE text line — the correct
// input for PSM 7 line recognition with a numeric whitelist.
export function bandRowRect(row, band, padX = 0.008, padY = 0.012) {
  if (!row || !band) return null;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const ax0 = clamp(band[0] - padX), ax1 = clamp(band[1] + padX);
  const ay0 = clamp(row.y0 - padY), ay1 = clamp(row.y1 + padY);
  if (ax1 - ax0 < 0.02 || ay1 - ay0 < 0.004) return null;
  return { x: ax0, y: ay0, w: ax1 - ax0, h: ay1 - ay0 };
}

// Tight rect around ONE word (normalized), for numeric re-OCR of an
// already-located number. Only here — on a single-number crop — is a
// numeric whitelist safe (proven: whitelisting a line that also holds label
// text collapses recognition to empty).
export function wordRect(word, padX = 0.008, padY = 0.012) {
  if (!word) return null;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const ax0 = clamp(word.x0 - padX), ax1 = clamp(word.x1 + padX);
  const ay0 = clamp(word.y0 - padY), ay1 = clamp(word.y1 + padY);
  if (ax1 - ax0 < 0.008 || ay1 - ay0 < 0.003) return null;
  return { x: ax0, y: ay0, w: ax1 - ax0, h: ay1 - ay0 };
}

// Right-of-label rect of the TOTAL row for the handwritten total (normalized,
// tilt-padded). Null without a total row.
export function totalValueRect(totalRow, padY = 0.014) {
  if (!totalRow) return null;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const x = clamp(totalRow.labelX1 - 0.02);
  const y0 = clamp(totalRow.row.y0 - padY);
  const y1 = clamp(totalRow.row.y1 + padY);
  if (1 - x < 0.05 || y1 - y0 < 0.004) return null;
  return { x, y: y0, w: 1 - x, h: y1 - y0 };
}
