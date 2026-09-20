// Unit tests for receiptRegions.js (pure geometry + voting).
// Run: node test-regions.mjs  (from frontend/src/mobile)
import {
  normalizeDecimalToken, extractNumericTokens, groupRows, findHeaderRow,
  columnBandsFromHeader, fallbackBands, assignColumn, itemArea, findTotalRow,
  regionRects, voteNumeric, editSimilarity, fuzzyWordMatch, joinSplitNumbers,
  fixDigitConfusion, estimateTextSkew,
} from './receiptRegions.js';

let pass = 0, fail = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got:  ${a}\n  want: ${e}`); }
};
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); } };

// --- decimal normalization (§5): 22,27→22.27, 82,80→82.80 ---
eq('dot', normalizeDecimalToken('22.27'), 22.27);
eq('decimal comma', normalizeDecimalToken('22,27'), 22.27);
eq('decimal comma 82', normalizeDecimalToken('82,80'), 82.8);
eq('thousands', normalizeDecimalToken('2,218.75'), 2218.75);
eq('thousands round', normalizeDecimalToken('2000.00'), 2000);
eq('peso prefix', normalizeDecimalToken('₱2,000.00'), 2000);
eq('php prefix', normalizeDecimalToken('Php74.60'), 74.6);
eq('per-liter suffix', normalizeDecimalToken('62.50/L'), 62.5);
eq('garbage', normalizeDecimalToken('O0O'), null);
eq('double dot', normalizeDecimalToken('22.2.7'), null);
eq('empty', normalizeDecimalToken(''), null);

// --- header row + column bands from simulated Stage-1 word boxes ---
// Simulates the uploaded PETRON receipt table header + item row + total row.
const W = (text, x0, y0, x1, y1, conf = 85) => ({ text, conf, x0, y0, x1, y1 });
const words = [
  W('PETRON', 0.35, 0.02, 0.65, 0.05, 90),
  W('Date:', 0.1, 0.2, 0.16, 0.22, 88), W('09/11/2026', 0.17, 0.2, 0.3, 0.22, 80),
  W('S.I.#', 0.1, 0.23, 0.16, 0.25, 86), W('2001204971', 0.17, 0.23, 0.3, 0.25, 82),
  W('Description', 0.05, 0.4, 0.25, 0.43, 90), W('Qty.', 0.35, 0.4, 0.42, 0.43, 88),
  W('Price', 0.5, 0.4, 0.6, 0.43, 89), W('Amount', 0.72, 0.4, 0.85, 0.43, 90),
  W('*Xtra', 0.05, 0.45, 0.12, 0.47, 70), W('Advance', 0.13, 0.45, 0.24, 0.47, 72),
  W('2.68', 0.36, 0.45, 0.41, 0.47, 78), W('Php74.60', 0.5, 0.45, 0.62, 0.47, 76),
  W('Php200.00', 0.72, 0.45, 0.86, 0.47, 80),
  W('Total', 0.1, 0.55, 0.18, 0.57, 88), W('(incl.', 0.19, 0.55, 0.27, 0.57, 80),
  W('VAT)', 0.28, 0.55, 0.34, 0.57, 80), W('Php200.00', 0.72, 0.55, 0.86, 0.57, 84),
  W('Cash', 0.2, 0.65, 0.27, 0.67, 85), W('Tendered', 0.28, 0.65, 0.4, 0.67, 85),
  W('Php500.00', 0.72, 0.65, 0.86, 0.67, 88),
  W('Change', 0.4, 0.68, 0.5, 0.7, 85), W('Php300.00', 0.72, 0.68, 0.86, 0.7, 88),
];

const header = findHeaderRow(words);
ok('header found', !!header);
ok('header has qty+price+amount', header && !!header.qtyBox && !!header.priceBox && !!header.amountBox);
const bands = columnBandsFromHeader(header);
eq('bands source', bands.source, 'header');
eq('2.68 in qty band', assignColumn(0.385, bands), 'qty');
eq('74.60 in price band', assignColumn(0.56, bands), 'price');
eq('200.00 in amount band', assignColumn(0.79, bands), 'amount');
eq('date NOT in any column', assignColumn(0.235, bands) === 'qty' ? 'qty?' : assignColumn(0.235, bands), null);

const totalRow = findTotalRow(words);
ok('total row found', !!totalRow);
ok('total row is Total (incl VAT)', totalRow && /total/i.test(totalRow.row.text));
ok('total row NOT tendered/change', totalRow && !/tendered|change/i.test(totalRow.row.text));
ok('total value zone right of label', totalRow && totalRow.labelX1 < 0.6);

const area = itemArea(words, header.row, totalRow.row);
ok('item area below header', area.y0 > header.row.y1);
ok('item area above total', area.y1 < totalRow.row.y0 + 0.01);
ok('item row inside area', 0.46 > area.y0 && 0.46 < area.y1);

const rects = regionRects(bands, area, totalRow);
ok('qty rect', !!rects.qty && rects.qty.w > 0.05 && rects.qty.h > 0);
ok('price rect', !!rects.price);
ok('amount rect', !!rects.amount);
ok('total rect right side', !!rects.total && rects.total.x > 0.3);

// --- agreement voting (§4): 4 passes agree → HIGH ---
const v1 = voteNumeric([
  { value: 22.27, conf: 80, pass: 'V1' }, { value: 22.27, conf: 78, pass: 'V3' },
  { value: 22.27, conf: 82, pass: 'V5' }, { value: 22.27, conf: 75, pass: 'V1up' },
]);
eq('unanimous HIGH', [v1.value, v1.verdict], [22.27, 'HIGH']);
eq('unanimous passes', v1.passes, 4);

// Split passes: 2 vs 2 → top by conf, still VERIFY (never invented).
const v2 = voteNumeric([
  { value: 2, conf: 60, pass: 'V1' }, { value: 2, conf: 62, pass: 'V3' },
  { value: 22.27, conf: 80, pass: 'V5' }, { value: 22.27, conf: 81, pass: 'V1up' },
]);
eq('split picks higher-conf', v2.value, 22.27);
ok('split not HIGH', v2.verdict !== 'HIGH' || v2.passes >= 2);

// Lone weak reading → REJECT (the "₱17" case must not fill).
const v3 = voteNumeric([{ value: 17, conf: 40, pass: 'V1' }]);
eq('lone weak REJECT', [v3.value, v3.verdict], [null, 'REJECT']);

// Lone strong reading → VERIFY (shown, never auto-trusted blindly).
const v4 = voteNumeric([{ value: 2000, conf: 88, pass: 'V1' }]);
eq('lone strong VERIFY', [v4.value, v4.verdict], [2000, 'VERIFY']);

// Empty → REJECT.
const v5 = voteNumeric([]);
eq('empty REJECT', [v5.value, v5.verdict], [null, 'REJECT']);

// Two strong agreements → HIGH (early-exit path).
const v6 = voteNumeric([
  { value: 74.6, conf: 78, pass: 'V1' }, { value: 74.6, conf: 80, pass: 'V3' },
]);
eq('two strong HIGH', [v6.value, v6.verdict], [74.6, 'HIGH']);

// Fallback bands shape.
const fb = fallbackBands();
ok('fallback bands ordered', fb.qty[1] <= fb.price[1] && fb.price[1] <= fb.amount[1]);

// --- fuzzy label matching (OCR-mangled headers) ---
ok('Qu.~qu variant', fuzzyWordMatch('Qu.', ['qu', 'qty', 'quantity']) > 0);
ok('Pica~Price', fuzzyWordMatch('Pica', ['price', 'prlce']) > 0);
ok('Amott~Amount', fuzzyWordMatch('Amott', ['amount', 'amout']) > 0);
ok('TAT~VAT', fuzzyWordMatch('TAT)', ['vat', 'vaf']) > 0);
eq('no false match', fuzzyWordMatch('Cash', ['qty', 'price', 'amount']), 0);
eq('short word guard', fuzzyWordMatch('a', ['amount']), 0);
ok('similarity sane', editSimilarity('kitten', 'sitting') > 0.5 && editSimilarity('kitten', 'sitting') < 1);

// --- digit confusion only inside digit fragments (§12) ---
eq('z.568→2.568', fixDigitConfusion('z.568'), '2.568');
eq('Php200.0C→Php200.00', fixDigitConfusion('Php200.0C'), 'Php200.00');
eq('Total untouched', fixDigitConfusion('Total'), 'Total');
eq('Cash untouched', fixDigitConfusion('Cash Tendered'), 'Cash Tendered');
eq('Zero untouched', fixDigitConfusion('Zero Rated'), 'Zero Rated');

// --- split-decimal joins ---
const jw = (text, x0, conf = 80) => ({ text, conf, x0, x1: x0 + 0.05 });
eq('74.+60 join', joinSplitNumbers([jw('ppp74.', 0.40), jw('60', 0.47)]).map((j) => j.value), [74.6]);
eq('Php+74.60 join', joinSplitNumbers([jw('Php', 0.40), jw('74.60', 0.45)]).map((j) => j.value), [74.6]);
eq('200+00 never joins', joinSplitNumbers([jw('200', 0.50), jw('00', 0.60)]).map((j) => j.value), []);
eq('far words never join', joinSplitNumbers([jw('74.', 0.40), jw('60', 0.60)]).map((j) => j.value), []);

// --- text skew from engine line ids ---
const skewWords = [];
for (let r = 0; r < 8; r++) {
  for (let c = 0; c < 5; c++) {
    const x = 0.1 + c * 0.15, y = 0.2 + r * 0.05 + x * -0.04; // -2.3° tilt
    skewWords.push({ text: 'w', conf: 80, x0: x, y0: y, x1: x + 0.08, y1: y + 0.015, _line: r });
  }
}
const skew = estimateTextSkew(skewWords);
ok('skew ≈ -2.3°', skew !== null && Math.abs((skew * 180) / Math.PI + 2.3) < 0.6);
eq('skew null on scatter', estimateTextSkew([
  { text: 'a', conf: 1, x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.12 },
  { text: 'b', conf: 1, x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.52 },
]), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
