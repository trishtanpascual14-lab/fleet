// Receipt OCR service — TWO-STAGE on-device pipeline (tesseract.js):
//
//   STAGE 0  image File → coarse crop (keyboard never enters OCR) →
//            perspective warp / box fallback → straightened receipt + renders
//   STAGE 1  PRINTED text (broad charset, PSM 6, word boxes): station,
//            invoice#, date, labels, product, references → table geometry
//            (column bands, item rows, TOTAL row) from bounding boxes
//   STAGE 2  HANDWRITTEN numerics per ROW-LEVEL crop (qty / price / amount /
//            total rows): 3.5x upscale, derotate, NUMERIC whitelist,
//            PSM 7 (single text line), 3 variant passes per crop →
//            agreement voting → value + confidence
//
// Field assignment is by LOCATION (bbox column/row), never by fishing digits
// out of full-page text. A rejected/missing value stays
// NOT_DETECTED/NEEDS_VERIFICATION — never invented.
//
// Response:
// {
//   success, receipt: { fuelStation, fuelProduct, fuelType, date, time,
//     odometer, liters, pricePerLiter, totalAmount, referenceNumber },
//   tiers, fieldStates, receiptStatus, sources, validation,
//   raw: { chars, passes: [...] },
//   debug: { corrected, variants, quad, box, coarse, skew, bands,
//            bandsSource, rects, regionCrops, stage1Words, stage1Texts,
//            regionPasses, votes, itemRows } (canvases in memory only)
// }

import { parseReceiptDetails, buildReceiptResponse, validateReceiptFile } from './receiptOcr';
import {
  prepareReceipt, renderVariants, cropCanvas, canvasToBlob, upscaleRegion,
  rotateCanvas,
} from './receiptPreprocess';
import {
  groupRows, findHeaderRow, columnBandsFromHeader, fallbackBands,
  itemArea, findTotalRow, regionRects, extractNumericTokens,
  voteNumeric, estimateTextSkew, shearCorrectWords,
  itemDataRows, totalValueRect, fixDigitConfusion, assignColumn,
  joinSplitNumbers,
} from './receiptRegions';

const CORE_FIELDS = ['fuel_station', 'fuel_product', 'fuel_type', 'record_date', 'liters', 'price_per_liter', 'total_amount', 'receipt_reference'];

// Broad charset for printed text. NOTE: no engine-level numeric whitelist —
// proven harmful: when a crop contains ANY non-whitelisted glyph, LSTM beam
// search collapses the whole line to empty (measured). Numeric focus is
// enforced at the token layer instead (extractNumericTokens +
// fixDigitConfusion + per-field range gates + agreement voting).
const PRINTED_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,₱Pph:/-#() ';

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      let createWorker;
      try {
        ({ createWorker } = await import('tesseract.js'));
      } catch (e) {
        throw new Error(`OCR engine failed to load (tesseract.js): ${e?.message || e}`);
      }
      try {
        const worker = await createWorker('eng', 1);
        await worker.setParameters({
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        return worker;
      } catch (e) {
        throw new Error(`OCR engine failed to start (language-data load failed — check network): ${e?.message || e}`);
      }
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

export function resetOcrEngine() {
  workerPromise = null;
}

function toWords(data, w, h) {
  // tesseract.js v7 returns layout ONLY when requested via output flags
  // ({ blocks: true } in recognize()). data.words is NOT populated —
  // walk the blocks → paragraphs → lines → words hierarchy instead.
  const words = [];
  let lineIdx = 0;
  const push = (wd, line) => {
    if (!wd || typeof wd.text !== 'string' || !wd.text.trim() || !wd.bbox) return;
    const b = wd.bbox;
    if (!(b.x1 > b.x0 && b.y1 > b.y0)) return;
    words.push({
      text: wd.text.trim(),
      conf: typeof wd.confidence === 'number' ? wd.confidence : (typeof data?.confidence === 'number' ? data.confidence : 0),
      x0: b.x0 / w,
      y0: b.y0 / h,
      x1: b.x1 / w,
      y1: b.y1 / h,
      _line: line,
    });
  };
  const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
  if (blocks.length) {
    for (const bl of blocks) {
      const paras = bl?.paragraphs || [];
      for (const p of paras) {
        const lines = p?.lines || [];
        for (const ln of lines) {
          const myLine = lineIdx++;
          for (const wd of ln?.words || []) push(wd, myLine);
        }
        for (const wd of p?.words || []) push(wd, lineIdx++);
      }
      for (const wd of bl?.words || []) push(wd, lineIdx++);
    }
  }
  if (!words.length && Array.isArray(data?.words)) {
    for (const wd of data.words) push(wd, undefined);
  }
  return words.filter((wd) => wd.x1 > wd.x0 && wd.y1 > wd.y0);
}

async function recognizeWith(worker, blob, { psm, whitelist, label, w, h }) {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    tessedit_char_whitelist: whitelist,
  });
  const started = Date.now();
  // NOTE: { blocks: true } is REQUIRED — without it tesseract.js returns
  // text only and every bounding box below is empty (geometry silently
  // degrades to fallbacks).
  const { data } = await worker.recognize(blob, {}, { blocks: true });
  const text = data?.text || '';
  const conf = typeof data?.confidence === 'number' ? data.confidence : 0;
  const words = toWords(data, w, h);
  console.log('[FUEL OCR] OCR response received:', { pass: label, engineConf: Math.round(conf), ms: Date.now() - started, chars: text.length, words: words.length });
  console.log('[FUEL OCR] Raw OCR text:', text);
  return { text, conf, words };
}

export async function runReceiptOcr(file, onStage) {
  console.log('[FUEL OCR] Upload started');
  console.log('[FUEL OCR] File type:', file?.type || 'unknown');
  console.log('[FUEL OCR] File size:', file?.size ?? 'unknown', 'bytes');
  console.log('[FUEL OCR] OCR provider: tesseract.js (on-device, eng LSTM)');
  console.log('[FUEL OCR] OCR request started');
  const stage = (s) => { try { onStage?.(s); } catch { /* ignore */ } };
  const problem = validateReceiptFile(file);
  if (problem) {
    const err = new Error(problem);
    err.code = 'INVALID_IMAGE';
    throw err;
  }
  if (!file || !(file.size > 0)) {
    const err = new Error(`Invalid image file (size: ${file?.size ?? 'unknown'}, type: ${file?.type || 'unknown'}).`);
    err.code = 'INVALID_IMAGE';
    throw err;
  }

  const worker = await getWorker();
  const attempts = [];
  const debug = {
    corrected: null, variants: [], quad: null, box: null, coarse: null,
    skew: null, usedWarp: false,
    bands: null, bandsSource: null, rects: {}, regionCrops: {},
    stage1Words: [], stage1Texts: {}, regionPasses: [], votes: {}, itemRows: [],
  };

  // ---- STAGE 0: straighten -------------------------------------------------
  stage('Straightening receipt…');
  console.log('[FUEL OCR] Preprocessing started');
  const prep = await prepareReceipt(file, 2000);
  const corrected = prep.canvas;
  debug.corrected = corrected;
  debug.quad = prep.quad;
  debug.box = prep.box;
  debug.coarse = prep.coarse || null;
  debug.usedWarp = prep.usedWarp;
  console.log('[FUEL OCR] Preprocessed image dimensions:', `${corrected.width}x${corrected.height}`);
  console.log('[FUEL OCR] OCR geometry:', {
    coarse: !!prep.coarse, usedWarp: prep.usedWarp, cropped: !!prep.box,
    orientedDeg: prep.orientedDeg, deskewDeg: prep.deskewDeg,
    coarseSkewDeg: typeof prep.skewDeg === 'number' ? +prep.skewDeg.toFixed(2) : prep.skewDeg,
  });

  const variants = renderVariants(corrected);
  debug.variants = variants.map((v) => ({ name: v.name, canvas: v.canvas }));
  const byName = Object.fromEntries(variants.map((v) => [v.name, v.canvas]));
  const blobOf = (canvas) => canvasToBlob(canvas);

  // ---- STAGE 1: printed text + bboxes --------------------------------------
  stage('Reading printed text (stage 1 of 2)…');
  let s1;
  try {
    s1 = await recognizeWith(worker, await blobOf(byName['V1 enhanced']), {
      psm: 6, whitelist: PRINTED_CHARSET, label: 'Stage 1: printed V1/PSM6',
      w: corrected.width, h: corrected.height,
    });
    attempts.push({ name: 'Stage 1: printed text', chars: s1.text.length, fields: 0, engineConf: Math.round(s1.conf), error: null });
  } catch (e) {
    attempts.push({ name: 'Stage 1: printed text', chars: 0, fields: 0, engineConf: null, error: e?.message || String(e) });
    throw new Error(`Printed-text OCR failed: ${e?.message || e}`);
  }
  debug.stage1Words = s1.words;
  debug.stage1Texts.V1 = s1.text;
  console.log('[FUEL OCR] OCR detected blocks:', s1.words.length, 'words');

  // Text skew measured from the word boxes themselves (no pixel resampling).
  // Falls back to the coarse paper-edge skew when boxes are inconclusive.
  let skewTan = 0;
  const textSkew = estimateTextSkew(s1.words);
  if (textSkew !== null) {
    skewTan = Math.tan(textSkew);
  } else if (typeof prep.skewDeg === 'number' && Number.isFinite(prep.skewDeg) && Math.abs(prep.skewDeg) <= 5) {
    // Paper edges lie (curl/shadow skew them) — only trust small angles.
    skewTan = Math.tan((prep.skewDeg * Math.PI) / 180);
  }
  const skewDeg = (Math.atan(skewTan) * 180) / Math.PI;
  debug.skew = { radians: textSkew, tan: skewTan, degrees: skewDeg, source: textSkew !== null ? 'word-boxes' : 'coarse-edge' };
  console.log('[FUEL OCR] OCR bounding boxes: skew estimate', `${skewDeg.toFixed(2)}° (${debug.skew.source})`);
  const geoWords = shearCorrectWords(s1.words, skewTan);

  const parsed = parseReceiptDetails(s1.text, s1.conf);
  const foundPrinted = CORE_FIELDS.filter((k) => parsed.values[k] !== null && parsed.values[k] !== undefined);
  attempts[0].fields = foundPrinted.length;
  console.log('[FUEL OCR] Fuel product candidate:', parsed.values.fuel_product, '| type:', parsed.values.fuel_type);
  console.log('[FUEL OCR] Date candidates:', parsed.values.record_date, '| Reference candidates:', parsed.values.receipt_reference);

  // ---- Date/reference dual-pass agreement ----------------------------------
  // A wrong-but-valid date ("08/14/2026" for "09/11/2026") passes every
  // text check — require a second render to agree, else NEEDS_VERIFICATION.
  if (parsed.values.record_date || parsed.values.receipt_reference) {
    stage('Verifying date and reference…');
    try {
      const s3 = await recognizeWith(worker, await blobOf(byName['V3 high-contrast']), {
        psm: 6, whitelist: PRINTED_CHARSET, label: 'Stage 1b: verify V3/PSM6',
        w: corrected.width, h: corrected.height,
      });
      debug.stage1Texts.V3 = s3.text;
      attempts.push({ name: 'Stage 1b: date/ref verify', chars: s3.text.length, fields: 0, engineConf: Math.round(s3.conf), error: null });
      const p3 = parseReceiptDetails(s3.text, s3.conf);
      if (parsed.values.record_date && p3.values.record_date !== parsed.values.record_date) {
        console.log('[FUEL OCR] Date disagreement:', parsed.values.record_date, 'vs', p3.values.record_date, '→ NEEDS_VERIFICATION');
        parsed.via.record_date = 'fuzzy';
      }
      if (parsed.values.receipt_reference && p3.values.receipt_reference !== parsed.values.receipt_reference) {
        console.log('[FUEL OCR] Reference disagreement:', parsed.values.receipt_reference, 'vs', p3.values.receipt_reference, '→ NEEDS_VERIFICATION');
        parsed.via.receipt_reference = 'fuzzy';
      }
    } catch (e) {
      console.warn('[FUEL OCR] date/ref verify pass failed:', e?.message || e);
    }
  }

  // ---- Table geometry from bounding boxes ----------------------------------
  const header = findHeaderRow(geoWords);
  const bands = header ? columnBandsFromHeader(header) : { ...fallbackBands(), source: 'fallback' };
  if (header?.fuzzy) bands.source = 'header-fuzzy';
  debug.bands = bands;
  debug.bandsSource = bands.source || 'fallback';
  const totalRow = findTotalRow(geoWords);
  const area = itemArea(geoWords, header?.row || null, totalRow?.row || null);
  const rects = regionRects(bands, area, totalRow);
  debug.rects = rects;
  const dataRows = itemDataRows(geoWords, header?.row || null, totalRow?.row || null, bands);
  debug.itemRows = dataRows.map((d) => ({
    y: +d.row.yc.toFixed(3),
    text: d.row.text,
    qty: d.tokens.qty.map((t) => t.value),
    price: d.tokens.price.map((t) => t.value),
    amount: d.tokens.amount.map((t) => t.value),
  }));
  console.log('[FUEL OCR] OCR table geometry:', {
    header: header ? `${header.row.text} (fuzzy=${!!header.fuzzy})` : null,
    bands: debug.bandsSource, area,
    totalRow: totalRow ? `${totalRow.row.text} (fuzzy=${!!totalRow.fuzzy})` : null,
    dataRows: debug.itemRows.length,
  });
  console.log('[FUEL OCR] Quantity candidates:', JSON.stringify(debug.itemRows.flatMap((r) => r.qty)));
  console.log('[FUEL OCR] Unit price candidates:', JSON.stringify(debug.itemRows.flatMap((r) => r.price)));
  console.log('[FUEL OCR] Amount candidates:', JSON.stringify(debug.itemRows.flatMap((r) => r.amount)));

  // ---- Debug-only region crops: product / date / reference rows -----------
  // (display only — extraction for these stays with the text parser).
  try {
    const allRows = groupRows(geoWords);
    const cropOf = (r, x0 = 0, x1 = 1) => upscaleRegion(cropCanvas(byName['V1 enhanced'], {
      x: x0 * corrected.width,
      y: Math.max(0, r.y0 - 0.008) * corrected.height,
      w: (x1 - x0) * corrected.width,
      h: (r.y1 - r.y0 + 0.016) * corrected.height,
    }, 0.01), 1);
    const descBand = bands.qty ? [0, bands.qty[0]] : [0, 0.3];
    const firstData = dataRows[0];
    if (firstData && !debug.regionCrops.description) {
      debug.regionCrops.description = cropOf(firstData.row, descBand[0], descBand[1]);
    }
    const dateRow = allRows.find((r) => /\d\s*[\/\-.]\s*\d/.test(r.text) && r.yc < 0.5);
    if (dateRow) debug.regionCrops.date = cropOf(dateRow);
    const refRow = allRows.find((r) => /\b(s\.?\s*i\.?#?|o\.?\s*r\.?|ref|invoice)\b/i.test(r.text));
    if (refRow) debug.regionCrops.reference = cropOf(refRow);
  } catch (e) {
    console.warn('[FUEL OCR] debug crops failed:', e?.message || e);
  }

  // ---- STAGE 2: position-pooled multi-pass voting + joint corroboration ----
  // Crop re-OCR keeps failing on dot-matrix print (segmentation collapses
  // without page context), while FULL-PAGE passes read the numbers — noisily
  // but present. So: full-page PSM 6 on V1+V3+V5 (+V6 when unresolved),
  // every numeric word pooled by WHERE it sits (column bands / total-row
  // zone), row line-crops (V5+V6) adding samples, per-field votes, then the
  // trio corroborated jointly (liters x price ~= total selects among
  // DETECTED candidates — math disambiguates, never invents).
  const values = { ...parsed.values };
  const via = { ...parsed.via };
  const sources = { ...(parsed.sources || {}) };
  const numericTiers = {};
  const numericVotes = {};
  let lineAmount = null;

  const fallbackUsed = debug.bandsSource === 'fallback';
  const FIELD_MINMAX = {
    liters: [0.05, 10000], price_per_liter: [0.5, 100000], total_amount: [1, 10000000],
  };
  const lineX0 = bands.qty ? Math.max(0.15, bands.qty[0] - 0.03) : 0.25;
  // pool[field] = [{ value, conf, pass }]
  const pool = { liters: [], price_per_liter: [], total_amount: [], amount: [] };
  const poolValue = (field, value, conf, pass) => {
    const [mn, mx] = FIELD_MINMAX[field] || [0, Infinity];
    if (field === 'amount') { pool.amount.push({ value, conf, pass }); return; }
    if (value < mn || value > mx) return;
    pool[field].push({ value, conf, pass });
  };
  const poolWord = (wd, passName, field) => {
    for (const t of extractNumericTokens(fixDigitConfusion(wd.text))) {
      poolValue(field, t.value, wd.conf || 0, passName);
    }
  };
  // Attribute one engine word (normalized coords) to a pool by position.
  // Total-row zone wins over columns (a total-row "00" must never be liters).
  const attributeWord = (wd, passName) => {
    const cx = (wd.x0 + wd.x1) / 2, cy = (wd.y0 + wd.y1) / 2;
    if (totalRow && cy > totalRow.row.y0 - 0.012 && cy < totalRow.row.y1 + 0.012
      && cx >= totalRow.labelX1 - 0.02) {
      poolWord(wd, `${passName} (total-row)`, 'total_amount');
      return;
    }
    if (cy < area.y0 || cy > area.y1) return;
    const col = assignColumn(cx, bands);
    if (col === 'qty') poolWord(wd, passName, 'liters');
    else if (col === 'price') poolWord(wd, passName, 'price_per_liter');
    else if (col === 'amount') poolWord(wd, passName, 'amount');
  };
  const attributeJoins = (rows, passName) => {
    for (const r of rows || []) {
      for (const j of joinSplitNumbers(r.words || [])) {
        const cx = (j.x0 + j.x1) / 2, cy = j.yc;
        let field = null;
        if (totalRow && cy > totalRow.row.y0 - 0.012 && cy < totalRow.row.y1 + 0.012 && cx >= totalRow.labelX1 - 0.02) {
          field = 'total_amount';
        } else if (cy >= area.y0 && cy <= area.y1) {
          const col = assignColumn(cx, bands);
          field = col === 'qty' ? 'liters' : col === 'price' ? 'price_per_liter' : col === 'amount' ? 'amount' : null;
        }
        if (field) poolValue(field, j.value, j.conf, `${passName} (join)`);
      }
    }
  };

  // V1 words already recognized — pool them first.
  for (const wd of s1.words || []) attributeWord(wd, 'Stage1/V1');
  attributeJoins(groupRows(geoWords), 'Stage1/V1');

  // V5 full pass (always): a different render = a genuinely different sample.
  stage('Reading values (stage 2 of 2)…');
  try {
    const s5 = await recognizeWith(worker, await blobOf(byName['V5 adaptive-threshold']), {
      psm: 6, whitelist: PRINTED_CHARSET, label: 'Stage 1b: values V5/PSM6',
      w: corrected.width, h: corrected.height,
    });
    debug.stage1Texts.V5 = s5.text;
    attempts.push({ name: 'Stage 1b: values V5', chars: s5.text.length, fields: 0, engineConf: Math.round(s5.conf), error: null });
    for (const wd of s5.words || []) attributeWord(wd, 'Stage1/V5');
    attributeJoins(groupRows(shearCorrectWords(s5.words || [], skewTan)), 'Stage1/V5');
  } catch (e) {
    attempts.push({ name: 'Stage 1b: values V5', chars: 0, fields: 0, engineConf: null, error: e?.message || String(e) });
    console.warn('[FUEL OCR] V5 full pass failed:', e?.message || e);
  }

  // Row line crops (V5+V6, broad charset): catch what page passes miss.
  {
    const lineJobs = [];
    for (const d of dataRows.slice(0, 3)) {
      const nums = ['qty', 'price', 'amount'].flatMap((k) => d.tokens[k]);
      if (!nums.length) continue;
      const numYc = nums.reduce((s, t) => s + (t.word.y0 + t.word.y1) / 2, 0) / nums.length;
      const rowMaxX = Math.max(...d.row.words.map((w) => w.x1));
      const x1 = Math.min(1, rowMaxX + 0.05);
      if (x1 <= lineX0 + 0.05) continue;
      lineJobs.push({ key: `row${lineJobs.length}`, rect: { x: lineX0, y: Math.max(0, numYc - 0.011), w: x1 - lineX0, h: 0.022 } });
      if (lineJobs.length >= 3) break;
    }
    if (totalRow) {
      const trect = totalValueRect(totalRow);
      if (trect) {
        const rightNums = (totalRow.row.words || []).filter((w) => (w.x0 + w.x1) / 2 >= totalRow.labelX1 - 0.02 && extractNumericTokens(w.text).length);
        const vmax = rightNums.length ? Math.max(...rightNums.map((w) => w.x1)) : trect.x + trect.w;
        const bounded = { ...trect, w: Math.min(1, vmax + 0.05) - trect.x };
        if (bounded.w > 0.03) lineJobs.push({ key: 'total', rect: bounded, isTotal: true });
      }
    }
    const derotate = Math.abs(skewDeg) >= 0.5
      ? (crop) => rotateCanvas(crop, -skewDeg)
      : (crop) => crop;
    let li = 0;
    for (const job of lineJobs) {
      const jobLabel = job.key === 'total' ? 'Total Amount Due' : `item row ${++li}`;
      stage(`Reading ${jobLabel} (stage 2 of 2)…`);
      if (!debug.regionCrops[job.key]) {
        debug.regionCrops[job.key] = upscaleRegion(cropCanvas(byName['V1 enhanced'], {
          x: job.rect.x * corrected.width, y: job.rect.y * corrected.height,
          w: job.rect.w * corrected.width, h: job.rect.h * corrected.height,
        }, 0.02), 1);
      }
      for (const tag of ['V5 adaptive-threshold', 'V6 closed print']) {
        const px = {
          x: Math.round(job.rect.x * corrected.width), y: Math.round(job.rect.y * corrected.height),
          w: Math.round(job.rect.w * corrected.width), h: Math.round(job.rect.h * corrected.height),
        };
        try {
          let crop = upscaleRegion(cropCanvas(byName[tag], px, 0.02), 3.5);
          crop = derotate(crop);
          const short = tag.split(' ')[0];
          const passName = `${jobLabel} ${short}/PSM7`;
          const rec = await recognizeWith(worker, await blobOf(crop), {
            psm: 7, whitelist: PRINTED_CHARSET, label: passName,
            w: crop.width, h: crop.height,
          });
          debug.regionPasses.push({ region: job.key, pass: passName, text: rec.text, conf: Math.round(rec.conf), words: rec.words.map((wd) => ({ ...wd })) });
          for (const wd of rec.words || []) {
            const gx = job.rect.x + ((wd.x0 + wd.x1) / 2) * job.rect.w;
            const gy = job.rect.y + ((wd.y0 + wd.y1) / 2) * job.rect.h;
            attributeWord({ ...wd, x0: gx - 0.001, x1: gx + 0.001, y0: gy - 0.001, y1: gy + 0.001 }, passName);
          }
          const local = (rec.words || []).map((wd) => ({
            ...wd,
            x0: job.rect.x + wd.x0 * job.rect.w, x1: job.rect.x + wd.x1 * job.rect.w,
            y0: job.rect.y + wd.y0 * job.rect.h, y1: job.rect.y + wd.y1 * job.rect.h,
          }));
          for (const j of joinSplitNumbers(local)) {
            const cx = (j.x0 + j.x1) / 2;
            let field = null;
            if (job.key === 'total') field = 'total_amount';
            else if (j.yc >= area.y0 && j.yc <= area.y1) {
              const col = assignColumn(cx, bands);
              field = col === 'qty' ? 'liters' : col === 'price' ? 'price_per_liter' : col === 'amount' ? 'amount' : null;
            }
            if (field) poolValue(field, j.value, j.conf, `${passName} (join)`);
          }
        } catch (e) {
          console.warn(`[FUEL OCR] ${jobLabel} line pass failed:`, e?.message || e);
        }
      }
      attempts.push({ name: `Stage 2: ${jobLabel}`, chars: 0, fields: 0, engineConf: null, error: null });
    }
  }

  // V3 + V6 full passes (conditional): different segmentations that often
  // catch what V1/V5 miss ("2.68" clean). Run only when the V1+V5 pool
  // leaves fewer than 2 fields with an agreed (≥2-pass) value.
  {
    const agreed = (field) => {
      const v = voteNumeric(pool[field]);
      return v.value !== null && v.passes >= 2 ? 1 : 0;
    };
    if (agreed('liters') + agreed('price_per_liter') + agreed('total_amount') < 2) {
      stage('Verifying values (extra pass)…');
      for (const [tag, label] of [['V3 high-contrast', 'Stage 1c: values V3'], ['V6 closed print', 'Stage 1d: values V6']]) {
        try {
          const sx = await recognizeWith(worker, await blobOf(byName[tag]), {
            psm: 6, whitelist: PRINTED_CHARSET, label: `${label}/PSM6`,
            w: corrected.width, h: corrected.height,
          });
          debug.stage1Texts[tag.split(' ')[0]] = sx.text;
          attempts.push({ name: label, chars: sx.text.length, fields: 0, engineConf: Math.round(sx.conf), error: null });
          for (const wd of sx.words || []) attributeWord(wd, label);
          attributeJoins(groupRows(shearCorrectWords(sx.words || [], skewTan)), label);
        } catch (e) {
          attempts.push({ name: label, chars: 0, fields: 0, engineConf: null, error: e?.message || String(e) });
          console.warn(`[FUEL OCR] ${label} failed:`, e?.message || e);
        }
      }
    } else {
      console.log('[FUEL OCR] values agreed after V1+V5 — skipping V3/V6 full passes');
    }
  }

  // Vote per field over the pooled location-selected candidates.
  const castVote = (field) => voteNumeric(pool[field]);
  const votes = {
    liters: castVote('liters'),
    price_per_liter: castVote('price_per_liter'),
    total_amount: castVote('total_amount'),
  };
  console.log('[FUEL OCR] Quantity candidates:', JSON.stringify(pool.liters.map((v) => v.value)));
  console.log('[FUEL OCR] Unit price candidates:', JSON.stringify(pool.price_per_liter.map((v) => v.value)));
  console.log('[FUEL OCR] Amount candidates:', JSON.stringify(pool.amount.map((v) => v.value)));
  console.log('[FUEL OCR] Total candidates:', JSON.stringify(pool.total_amount.map((v) => v.value)));
  debug.votes = {
    qty: votes.liters, price: votes.price_per_liter, total: votes.total_amount,
    amount: voteNumeric(pool.amount),
  };

  // Joint corroboration: the trio (liters × price ≈ total) selects among
  // DETECTED candidates. Each chosen value must already be pooled (≥1 read);
  // the combo must close within 2%. Corroborated fields become VERIFIED —
  // three independent location-constrained reads agreeing to <2% is strong
  // evidence. Printed TOTAL stays authoritative: it is never synthesized.
  {
    const comboCands = {
      liters: [votes.liters.value, ...votes.liters.alternatives.map((a) => a.value)].filter((v) => v !== null && v !== undefined),
      price_per_liter: [votes.price_per_liter.value, ...votes.price_per_liter.alternatives.map((a) => a.value)].filter((v) => v !== null && v !== undefined),
      total_amount: [votes.total_amount.value, ...votes.total_amount.alternatives.map((a) => a.value)].filter((v) => v !== null && v !== undefined),
    };
    // Seed from the text parse so a field the pool missed can still join.
    for (const [f, v] of [['liters', +values.liters], ['price_per_liter', +values.price_per_liter], ['total_amount', +values.total_amount]]) {
      if (v > 0 && !comboCands[f].includes(v)) comboCands[f].push(v);
    }
    let bestCombo = null;
    for (const li of comboCands.liters) {
      for (const pr of comboCands.price_per_liter) {
        if (!(li > 0) || !(pr > 0)) continue;
        const calc = li * pr;
        for (const tt of comboCands.total_amount) {
          if (!(tt > 0)) continue;
          const err = Math.abs(calc - tt) / Math.max(1, tt);
          if (!bestCombo || err < bestCombo.err) bestCombo = { li, pr, tt, err };
        }
      }
    }
    if (bestCombo && bestCombo.err <= 0.02) {
      console.log('[FUEL OCR] joint corroboration:', JSON.stringify(bestCombo));
      const apply = (field, value) => {
        values[field] = Math.round(value * 100) / 100;
        via[field] = 'numeric-region';
        sources[field] = `Joint corroboration (liters × price ≈ total, err ${(bestCombo.err * 100).toFixed(2)}%)`;
        numericTiers[field] = 'high';
        const pv = votes[field];
        numericVotes[field] = { value: values[field], passes: Math.max(2, pv.passes || 0), avgConf: Math.max(60, pv.avgConf || 0), verdict: 'HIGH', alternatives: [] };
      };
      apply('liters', bestCombo.li);
      apply('price_per_liter', bestCombo.pr);
      apply('total_amount', bestCombo.tt);
    }
  }

  // Fields the joint step did not corroborate fall back to individual votes.
  for (const [field, label] of [['liters', 'Quantity'], ['price_per_liter', 'Unit Price'], ['total_amount', 'Total Amount Due']]) {
    if (numericVotes[field]) continue; // corroborated above
    let vote = votes[field];
    // Fallback bands are positional guesses — cap at VERIFY, never HIGH.
    if (vote.verdict === 'HIGH' && fallbackUsed && field !== 'total_amount') {
      vote = { ...vote, verdict: 'VERIFY' };
    }
    console.log(`[FUEL OCR] ${label} vote:`, JSON.stringify(vote));
    if (vote.verdict === 'REJECT' || vote.value === null) continue; // keep text parse (or null) — never guess
    values[field] = vote.value;
    const strong = vote.verdict === 'HIGH';
    via[field] = strong ? 'numeric-region' : 'numeric-region-weak';
    sources[field] = `${label} region (${vote.passes} pass${vote.passes === 1 ? '' : 'es'} agree, avg conf ${vote.avgConf}%)`;
    numericTiers[field] = strong ? 'high' : 'medium';
    numericVotes[field] = vote;
  }
  // Amount is cross-check only (not a saved field).
  // Amount is cross-check only (not a saved field).
  {
    const av = voteNumeric(pool.amount);
    if (av.value) lineAmount = av.value;
  }


  const merged = { values, via, tiers: { ...parsed.tiers, ...numericTiers }, sources };
  const chars = attempts.reduce((n, a) => n + (a.chars || 0), 0);

  const response = buildReceiptResponse(merged.values, merged.via, merged.sources);
  response.tiers = merged.tiers;
  // Stamp the TRUE multi-pass agreement confidence onto numeric fields —
  // not the page-level engine score.
  for (const [field, vote] of Object.entries(numericVotes)) {
    const st = response.fieldStates?.[field];
    if (st) {
      st.confidence = Math.round(vote.avgConf);
      st.passes = vote.passes;
      st.agreement = vote.verdict;
    }
  }
  if (lineAmount !== null) {
    response.validation = { ...response.validation, lineAmount };
  }
  response.raw = { chars, passes: attempts };
  response.debug = debug;
  console.log('[FUEL OCR] Final extracted values:', JSON.stringify({
    fuelProduct: response.receipt.fuelProduct, fuelType: response.receipt.fuelType,
    liters: response.receipt.liters, pricePerLiter: response.receipt.pricePerLiter,
    totalAmount: response.receipt.totalAmount, date: response.receipt.date,
    referenceNumber: response.receipt.referenceNumber,
    receiptStatus: response.receiptStatus,
  }));
  console.log('[FUEL OCR] OCR payload to form:', { ...response, debug: '[canvases omitted]' });
  return response;
}

export { CORE_FIELDS };
