// Receipt image enhancement before REAL OCR (Tesseract LSTM) — no dependencies.
// The ORIGINAL file is never modified: it stays attached to the form and is
// uploaded as-is. Only processed copies are sent to the OCR engine.
//
// Pipeline: EXIF orientation → receipt-boundary crop → 90° orientation fix
// → deskew → upscale to OCR resolution → grayscale → uneven-lighting
// flatten → contrast stretch → Sauvola adaptive threshold → unsharp mask.
// A second, handwriting-safe grayscale render (no thresholding) is exported
// separately so faint/handwritten strokes the binarizer might drop still get
// an OCR pass. Nothing is ever upscaled blindly or cropped aggressively:
// every stage falls back to the previous image when detection is
// inconclusive.

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file); // older browsers: ignore EXIF orientation
  }
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function toBlob(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('preprocess failed'))), 'image/jpeg', quality);
  });
}

function getGray(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  }
  return { gray, w, h, put: (fn) => {
    for (let i = 0; i < gray.length; i++) { const v = fn(gray[i], i); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; }
    ctx.putImageData(img, 0, 0);
  } };
}

// Crop unnecessary background: bright-paper mask minus border-connected
// background → bounding box of the largest remaining blob. Returns null when
// inconclusive so the caller keeps the full image.
function detectReceiptBox(srcCanvas) {
  try {
    const W = 400;
    const scale = W / srcCanvas.width;
    const H = Math.max(1, Math.round(srcCanvas.height * scale));
    const small = makeCanvas(W, H);
    small.getContext('2d').drawImage(srcCanvas, 0, 0, W, H);
    const { gray, w, h } = getGray(small);
    const n = w * h;
    // Dark mask; flood-fill the dark region connected to the border (= table/
    // hand/background). What remains is foreground, usually the paper.
    const dark = new Uint8Array(n);
    for (let i = 0; i < n; i++) dark[i] = gray[i] < 110 ? 1 : 0;
    const seen = new Uint8Array(n);
    const stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + (w - 1)); }
    while (stack.length) {
      const i = stack.pop();
      if (i < 0 || i >= n || seen[i] || !dark[i]) continue;
      seen[i] = 1;
      const x = i % w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      stack.push(i - w, i + w);
    }
    // Largest 4-connected foreground blob.
    const comp = new Int32Array(n).fill(-1);
    let best = null;
    let cid = 0;
    for (let i = 0; i < n; i++) {
      if (dark[i] && !seen[i] && comp[i] === -1) {
        let minX = w, maxX = -1, minY = h, maxY = -1, count = 0;
        const st = [i];
        comp[i] = cid;
        while (st.length) {
          const j = st.pop();
          count++;
          const x = j % w, y = (j / w) | 0;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          const nb = [j - 1, j + 1, j - w, j + w];
          for (const k of nb) {
            if (k < 0 || k >= n || comp[k] !== -1) continue;
            if (!(dark[k] && !seen[k])) continue;
            const kx = k % w;
            if (Math.abs(kx - (j % w)) + Math.abs(((k / w) | 0) - ((j / w) | 0)) !== 1) continue;
            comp[k] = cid;
            st.push(k);
          }
        }
        // Paper should be tall-ish and cover a decent area.
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        if (count > n * 0.08 && bh > bw * 0.8 && (!best || count > best.count)) {
          best = { minX, maxX, minY, maxY, count };
        }
        cid++;
      }
    }
    if (!best || best.count > n * 0.97) return null;
    const m = 0.02; // 2% margin so no text is clipped
    const fx = srcCanvas.width / w, fy = srcCanvas.height / h;
    const x0 = Math.max(0, Math.floor((best.minX - w * m) * fx));
    const y0 = Math.max(0, Math.floor((best.minY - h * m) * fy));
    const x1 = Math.min(srcCanvas.width, Math.ceil((best.maxX + w * m) * fx));
    const y1 = Math.min(srcCanvas.height, Math.ceil((best.maxY + h * m) * fy));
    if (x1 - x0 < srcCanvas.width * 0.3 || y1 - y0 < srcCanvas.height * 0.3) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  } catch {
    return null;
  }
}

// Deskew: try small rotations, keep the angle with the sharpest horizontal
// text lines (max row-intensity variance). ±8° in 0.5° steps on a small copy.
function deskewAngle(srcCanvas) {
  try {
    const W = 400;
    const H = Math.max(1, Math.round(srcCanvas.height * (W / srcCanvas.width)));
    const small = makeCanvas(W, H);
    const sctx = small.getContext('2d');
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, W, H);
    sctx.drawImage(srcCanvas, 0, 0, W, H);
    const { gray } = getGray(small);
    const rad = (deg) => (deg * Math.PI) / 180;
    const score = (deg) => {
      const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
      const cx = W / 2, cy = H / 2;
      let total = 0;
      const rows = 60;
      for (let r = 0; r < rows; r++) {
        const y = ((r + 0.5) / rows) * H;
        let sum = 0, sum2 = 0, cnt = 0;
        for (let x = 0; x < W; x += 2) {
          const dx = x - cx, dy = y - cy;
          const sx = Math.round(cx + dx * c + dy * s);
          const sy = Math.round(cy - dx * s + dy * c);
          if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
          const v = gray[(sy * W + sx) | 0];
          sum += v; sum2 += v * v; cnt++;
        }
        if (cnt > 10) total += sum2 / cnt - (sum / cnt) ** 2;
      }
      return total / rows;
    };
    let bestDeg = 0, bestScore = score(0);
    const scores = new Map([[0, bestScore]]);
    for (let deg = -8; deg <= 8; deg += 0.5) {
      if (deg === 0) continue;
      const sc = score(deg);
      scores.set(deg, sc);
      if (sc > bestScore * 1.02) { bestScore = sc; bestDeg = deg; }
    }
    // Guard against runaway metrics (QR blocks, diagonal paper edges): only
    // trust a LOCAL PEAK that clearly beats 0°. A monotonic rise to the
    // search edge means "no text lines found" — deskewing there would rotate
    // by a wrong angle AND blur faint print. Return 0 instead.
    if (Math.abs(bestDeg) < 0.5) return 0;
    const s0 = scores.get(0);
    if (!(bestScore > s0 * 1.06)) return 0;
    const prev = scores.get(Math.round((bestDeg - 0.5) * 2) / 2);
    const next = scores.get(Math.round((bestDeg + 0.5) * 2) / 2);
    if (prev !== undefined && prev > bestScore) return 0;
    if (next !== undefined && next > bestScore) return 0;
    return bestDeg;
  } catch {
    return 0;
  }
}

export function rotateCanvas(src, deg) {
  if (!deg) return src;
  const r = (deg * Math.PI) / 180;
  const w = src.width, h = src.height;
  const W = Math.ceil(Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r)));
  const H = Math.ceil(Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r)));
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(r);
  ctx.drawImage(src, -w / 2, -h / 2);
  return out;
}

// 90° orientation fix: receipt text runs in horizontal lines, so row
// intensity variance should dominate column variance. When it doesn't, the
// photo was taken sideways — rotate 90° (direction picked by re-scoring).
// Returns 0, 90 or 270. Falls back to 0 when inconclusive.
function orientationDeg(srcCanvas) {
  try {
    const W = 240;
    const H = Math.max(1, Math.round(srcCanvas.height * (W / srcCanvas.width)));
    const small = makeCanvas(W, H);
    const sctx = small.getContext('2d');
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, W, H);
    sctx.drawImage(srcCanvas, 0, 0, W, H);
    const { gray, w, h } = getGray(small);
    const rowVar = projectionVar(gray, w, h, 'row');
    const colVar = projectionVar(gray, w, h, 'col');
    // Clearly horizontal text already — nothing to do.
    if (rowVar >= colVar * 1.15) return 0;
    // Clearly vertical text — pick the 90° turn with stronger line structure.
    if (colVar > rowVar * 1.15) {
      const cw = rotateCanvas(small, 90);
      const ccw = rotateCanvas(small, -90);
      const cwScore = projectionVar(getGray(cw).gray, cw.width, cw.height, 'row');
      const ccwScore = projectionVar(getGray(ccw).gray, ccw.width, ccw.height, 'row');
      return cwScore >= ccwScore ? 90 : 270;
    }
    return 0;
  } catch {
    return 0;
  }
}

function projectionVar(gray, w, h, axis) {
  const n = axis === 'row' ? h : w;
  const len = axis === 'row' ? w : h;
  let total = 0, count = 0;
  for (let i = 0; i < n; i += 1) {
    let sum = 0, sum2 = 0, c = 0;
    for (let j = 0; j < len; j += 2) {
      const v = axis === 'row' ? gray[i * w + j] : gray[j * w + i];
      sum += v; sum2 += v * v; c++;
    }
    if (c > 4) { total += sum2 / c - (sum / c) ** 2; count++; }
  }
  return count ? total / count : 0;
}

// Flatten uneven lighting/shadows: estimate the slow background illumination
// with a large box blur (integral image) and re-center each pixel around the
// global mean. Text contrast is preserved; gradients and vignettes are not.
function flattenLighting(gray, w, h) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    for (let x = 0; x < w; x++) {
      rs += gray[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
    }
  }
  const r = Math.max(20, Math.round(Math.min(w, h) / 6));
  let global = 0;
  for (let i = 0; i < gray.length; i++) global += gray[i];
  global /= gray.length;
  const out = new Float32Array(gray.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const a = y0 * W + x0, b = y0 * W + x1 + 1, c = (y1 + 1) * W + x0, d = (y1 + 1) * W + x1 + 1;
      const bg = (sum[d] - sum[b] - sum[c] + sum[a]) / ((x1 - x0 + 1) * (y1 - y0 + 1));
      out[y * w + x] = Math.max(0, Math.min(255, gray[y * w + x] - bg + global));
    }
  }
  return out;
}

// Percentile contrast stretch (1st–99th): boosts faded thermal print
// without clipping the way min/max normalization would.
function contrastStretch(gray) {
  const sorted = Float32Array.from(gray).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)] ?? 0;
  const hi = sorted[Math.ceil(sorted.length * 0.99) - 1] ?? 255;
  if (hi - lo < 8) return Float32Array.from(gray);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / (hi - lo)));
  }
  return out;
}

// Sauvola adaptive threshold via integral images (window ~1/40 of width).
// Handles shadows/uneven light far better than one global cutoff.
function sauvola(gray, w, h) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sum2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rs2 = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      rs += v; rs2 += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
      sum2[(y + 1) * W + x + 1] = sum2[y * W + x + 1] + rs2;
    }
  }
  const win = Math.max(15, Math.min(61, Math.round(w / 40) | 0 || 15));
  const hw = win >> 1, k = 0.34, R = 128;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - hw), y1 = Math.min(h - 1, y + hw);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - hw), x1 = Math.min(w - 1, x + hw);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const a = y0 * W + x0, b = y0 * W + x1 + 1, c = (y1 + 1) * W + x0, d = (y1 + 1) * W + x1 + 1;
      const mean = (sum[d] - sum[b] - sum[c] + sum[a]) / area;
      const varr = Math.max(0, (sum2[d] - sum2[b] - sum2[c] + sum2[a]) / area - mean * mean);
      const std = Math.sqrt(varr);
      const t = mean * (1 + k * (std / R - 1));
      out[y * w + x] = gray[y * w + x] < t ? 0 : 255;
    }
  }
  return out;
}

// Unsharp mask on the bilevel image edges: thickens faint strokes.
function unsharp(gray, w, h, amount = 0.6) {
  const out = new Float32Array(gray.length);
  const at = (x, y) => gray[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const blur = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) + 4 * at(x, y)) / 8;
      out[y * w + x] = Math.max(0, Math.min(255, at(x, y) + amount * (at(x, y) - blur)));
    }
  }
  return out;
}

export async function preprocessForOcr(file) {
  const bmp = await loadBitmap(file);
  try {
    // Render at a capped size first (detail preserved, work bounded).
    const CAP = 2600;
    const s0 = Math.min(1, CAP / Math.max(bmp.width, bmp.height));
    let canvas = makeCanvas(bmp.width * s0, bmp.height * s0);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);

    // 1) Receipt boundary crop (fallback: full image).
    const box = detectReceiptBox(canvas);
    if (box) {
      const cropped = makeCanvas(box.w, box.h);
      cropped.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      canvas = cropped;
    }

    // 2) 90° orientation fix (fallback: 0°) then fine deskew (fallback: 0°).
    const orient = orientationDeg(canvas);
    if (orient) canvas = rotateCanvas(canvas, orient);
    const deg = deskewAngle(canvas);
    if (deg) canvas = rotateCanvas(canvas, deg);

    // 3) Resize to high OCR resolution: longest side ≈ 2200px.
    const TARGET = 2200;
    const s1 = TARGET / Math.max(canvas.width, canvas.height);
    if (s1 > 1.02 || s1 < 0.98) {
      const r = makeCanvas(canvas.width * s1, canvas.height * s1);
      const rctx = r.getContext('2d');
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(canvas, 0, 0, r.width, r.height);
      canvas = r;
    }

    // 4) Grayscale → lighting flatten → contrast stretch → Sauvola
    // adaptive threshold → gentle unsharp.
    const { gray, w, h, put } = getGray(canvas);
    const flat = flattenLighting(gray, w, h);
    const stretched = contrastStretch(flat);
    const bw = sauvola(stretched, w, h);
    const sharp = unsharp(Float32Array.from(bw), w, h, 0.5);
    put((_, i) => Math.max(0, Math.min(255, Math.round(sharp[i]))));

    const blob = await toBlob(canvas);
    return { blob, width: canvas.width, height: canvas.height, deskewDeg: deg, orientedDeg: orient, cropped: !!box };
  } finally {
    if (typeof bmp.close === 'function') bmp.close();
  }
}

// Handwriting-safe grayscale render (NO thresholding): lighting flatten +
// contrast stretch on grayscale only, so faint print and handwritten strokes
// survive as gray levels instead of being binarized away. Alternate OCR pass.
export async function grayscaleForOcr(file) {
  const bmp = await loadBitmap(file);
  try {
    const CAP = 2600;
    const s0 = Math.min(1, CAP / Math.max(bmp.width, bmp.height));
    let canvas = makeCanvas(bmp.width * s0, bmp.height * s0);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const box = detectReceiptBox(canvas);
    if (box) {
      const cropped = makeCanvas(box.w, box.h);
      cropped.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      canvas = cropped;
    }
    const orient = orientationDeg(canvas);
    if (orient) canvas = rotateCanvas(canvas, orient);
    const deg = deskewAngle(canvas);
    if (deg) canvas = rotateCanvas(canvas, deg);
    const TARGET = 2200;
    const s1 = TARGET / Math.max(canvas.width, canvas.height);
    if (s1 > 1.02 || s1 < 0.98) {
      const r = makeCanvas(canvas.width * s1, canvas.height * s1);
      const rctx = r.getContext('2d');
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(canvas, 0, 0, r.width, r.height);
      canvas = r;
    }
    const { gray, w, h, put } = getGray(canvas);
    const enhanced = contrastStretch(flattenLighting(gray, w, h));
    put((_, i) => Math.max(0, Math.min(255, Math.round(enhanced[i]))));
    const blob = await toBlob(canvas);
    return { blob, width: canvas.width, height: canvas.height, deskewDeg: deg, orientedDeg: orient, cropped: !!box };
  } finally {
    if (typeof bmp.close === 'function') bmp.close();
  }
}

// Plain upscale of the ORIGINAL (no thresholding): alternate Pass-3 render so
// the OCR engine sees the same pixels rendered differently. Aspect preserved,
// never cropped.
export async function upscaleForOcr(file, factor = 2) {
  const bmp = await loadBitmap(file);
  try {
    const capped = Math.max(bmp.width, bmp.height) * factor > 3000
      ? 3000 / Math.max(bmp.width, bmp.height)
      : factor;
    const canvas = makeCanvas(bmp.width * capped, bmp.height * capped);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas);
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    if (typeof bmp.close === 'function') bmp.close();
  }
}

// ---------------------------------------------------------------------------
// Coarse receipt crop — runs FIRST on the full photo, before any other
// detection. Flood-fill segmentation fails when bright background (table,
// palm rest) touches the paper, and keyboard TEXT destroys page
// segmentation, so the coarse crop uses cues that are reliable per side:
//   LEFT/TOP: sustained dark→bright paper edges (keyboard is dark).
//   RIGHT/BOTTOM: last printed row/column + margin (table has no print and
//     is harmless when included; keyboard text is what must be excluded).
// Returns { box:{x,y,w,h} in src px, skewDeg, lines } or null (caller keeps
// the full image). Pure geometry — safe, bounded, always validated.
// ---------------------------------------------------------------------------

function fitEdgeLine(pts) {
  let cur = pts, a = 0, b = 0;
  for (let it = 0; it < 4; it++) {
    const n = cur.length;
    if (n < 8) return null;
    let st = 0, sv = 0;
    for (const p of cur) { st += p.t; sv += p.v; }
    const mt = st / n, mv = sv / n;
    let stt = 0, stv = 0;
    for (const p of cur) { stt += (p.t - mt) * (p.t - mt); stv += (p.t - mt) * (p.v - mv); }
    if (stt < 1e-9) return null;
    a = stv / stt; b = mv - a * mt;
    const next = cur.filter((p) => Math.abs(p.v - (a * p.t + b)) < 2.5);
    if (next.length === cur.length) { cur = next; break; }
    cur = next;
  }
  return { a, b, n: cur.length };
}

function scanCoarseEdges(srcCanvas) {
  const W = 400;
  const scale = W / srcCanvas.width;
  const H = Math.max(1, Math.round(srcCanvas.height * scale));
  const small = makeCanvas(W, H);
  small.getContext('2d').drawImage(srcCanvas, 0, 0, W, H);
  const { gray, w, h } = getGray(small);
  const at = (x, y) => gray[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  const hband = (x0, x1, y) => { let s = 0, c = 0; for (let x = x0; x <= x1; x++) { s += at(x, y); c++; } return c ? s / c : 0; };
  const vband = (y0, y1, x) => { let s = 0, c = 0; for (let y = y0; y <= y1; y++) { s += at(x, y); c++; } return c ? s / c : 0; };
  const R = 4, TH = 22;

  // LEFT edge points: first sustained dark→bright step per row.
  const L = [];
  const yA = Math.round(h * 0.05), yB = Math.round(h * 0.95);
  for (let y = yA; y <= yB; y++) {
    for (let x = R; x < w / 2; x++) {
      if (hband(x + 1, x + R, y) - hband(x - R, x - 1, y) > TH) {
        if (hband(x + R + 2, Math.min(w - 1, x + 60), y) > 130) L.push({ t: y, v: x });
        break;
      }
    }
  }
  const left = fitEdgeLine(L);
  // Paper edges are near-vertical/horizontal: reject wild fits.
  if (!left || left.n < 20 || Math.abs(left.a) > 0.5) return null;
  const skewDeg = (Math.atan(left.a) * 180) / Math.PI;

  // TOP edge points between the left line and 90% width.
  const T = [];
  const topX0 = Math.round(left.a * (h * 0.1) + left.b) + 4;
  for (let x = Math.max(R, topX0); x <= Math.round(w * 0.9); x++) {
    for (let y = R; y < h / 2; y++) {
      if (vband(y + 1, y + R, x) - vband(y - R, y - 1, x) > TH) {
        if (vband(y + R + 2, Math.min(h - 1, y + 80), x) > 130) T.push({ t: x, v: y });
        break;
      }
    }
  }
  const top = fitEdgeLine(T);
  const topY = (x) => (top && top.n >= 12 && Math.abs(top.a) < 0.5 ? top.a * x + top.b : h * 0.02);

  // BOTTOM: last printed row + margin (table below has no print).
  const leftBot = Math.round(left.a * (h - 1) + left.b) + 5;
  let yLast = -1;
  for (let y = h - 1; y > Math.round(h * 0.5); y--) {
    let c = 0, t = 0;
    for (let x = leftBot; x < w; x += 2) { t++; if (at(x, y) < 120) c++; }
    if (c / t > 0.015) { yLast = y; break; }
  }
  if (yLast < 0) return null;
  const yBot = Math.min(h - 1, yLast + 14);

  // RIGHT: last printed column + margin, scanned over the LOWER band only
  // (upper-right often holds keyboard keycaps with glyphs).
  const yTopSafe = Math.max(topY(w / 2) + 15, topY(w / 2) + (yBot - topY(w / 2)) * 0.45);
  let xLast = -1;
  for (let x = w - 1; x > leftBot; x -= 2) {
    let c = 0, t = 0;
    for (let y = Math.round(yTopSafe); y < yBot - 8; y += 2) { t++; if (at(x, y) < 120) c++; }
    if (t > 0 && c / t > 0.02) { xLast = x; break; }
  }
  if (xLast < 0) return null;
  const xRight = Math.min(w - 1, xLast + 14);

  const yTopSafe2 = Math.max(0, Math.round(topY(w / 2)) - 8);
  const xLeftSafe = Math.max(0, Math.round(left.a * ((yTopSafe2 + yBot) / 2) + left.b) - 8);
  return {
    skewDeg,
    left, top: top && top.n >= 12 ? top : null,
    boxSmall: { x0: xLeftSafe, y0: yTopSafe2, x1: Math.round(xRight) + 6, y1: Math.round(yBot) + 6 },
  };
}

export function coarseCropBox(srcCanvas) {
  try {
    const e = scanCoarseEdges(srcCanvas);
    if (!e) return null;
    const fx = srcCanvas.width / 400;
    const H = Math.round(srcCanvas.height * (400 / srcCanvas.width));
    const fy = srcCanvas.height / H;
    const x0 = Math.max(0, Math.floor(e.boxSmall.x0 * fx));
    const y0 = Math.max(0, Math.floor(e.boxSmall.y0 * fy));
    const x1 = Math.min(srcCanvas.width, Math.ceil(e.boxSmall.x1 * fx));
    const y1 = Math.min(srcCanvas.height, Math.ceil(e.boxSmall.y1 * fy));
    if (x1 - x0 < srcCanvas.width * 0.3 || y1 - y0 < srcCanvas.height * 0.3) return null;
    if (x1 - x0 > srcCanvas.width * 0.995 && y1 - y0 > srcCanvas.height * 0.995) return null;
    return {
      box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      skewDeg: e.skewDeg,
      leftN: e.left.n, topN: e.top ? e.top.n : 0,
    };
  } catch {
    return null;
  }
}
// ---------------------------------------------------------------------------
// Stage 0b — receipt quad detection + perspective warp (no dependencies).
// Runs on the coarse crop (receipt-dominant frame), where flood-fill
// segmentation is reliable. Falls back to null (box crop) when inconclusive.
// ---------------------------------------------------------------------------
// Finds the paper's four corners from a bright-paper mask (border-connected
// dark background removed first) and warps the quad to a straight rectangle
// with a two-triangle affine split. Returns null when inconclusive so the
// caller falls back to the bounding-box crop.
// ---------------------------------------------------------------------------

function maskExtremeQuad(small, gray, w, h) {
  const n = w * h;
  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) bright[i] = gray[i] > 140 ? 1 : 0;
  // Remove bright pixels connected to the border (white table/background).
  const seen = new Uint8Array(n);
  const stack = [];
  for (let x = 0; x < w; x++) { if (bright[x]) stack.push(x); const b = (h - 1) * w + x; if (bright[b]) stack.push(b); }
  for (let y = 0; y < h; y++) { const l = y * w; if (bright[l]) stack.push(l); const r = y * w + w - 1; if (bright[r]) stack.push(r); }
  while (stack.length) {
    const i = stack.pop();
    if (i < 0 || i >= n || seen[i] || !bright[i]) continue;
    seen[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    stack.push(i - w, i + w);
  }
  // Largest 4-connected interior bright blob = the paper.
  const comp = new Int32Array(n).fill(-1);
  let best = null;
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (bright[i] && !seen[i] && comp[i] === -1) {
      let minX = w, maxX = -1, minY = h, maxY = -1, count = 0;
      const st = [i];
      comp[i] = cid;
      while (st.length) {
        const j = st.pop();
        count++;
        const x = j % w, y = (j / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const nb = [j - 1, j + 1, j - w, j + w];
        for (const k of nb) {
          if (k < 0 || k >= n || comp[k] !== -1) continue;
          if (!(bright[k] && !seen[k])) continue;
          const kx = k % w;
          if (Math.abs(kx - (j % w)) + Math.abs(((k / w) | 0) - ((j / w) | 0)) !== 1) continue;
          comp[k] = cid;
          st.push(k);
        }
      }
      if (count > n * 0.08 && (!best || count > best.count)) {
        best = { minX, maxX, minY, maxY, count, id: cid };
      }
      cid++;
    }
  }
  if (!best || best.count > n * 0.97) return null;
  const bw = best.maxX - best.minX + 1, bh = best.maxY - best.minY + 1;
  if (bw < w * 0.3 || bh < h * 0.3) return null;
  // Corners = extreme (x+y)/(x−y) points of the blob.
  const corners = { tl: null, tr: null, br: null, bl: null };
  let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
  for (let y = best.minY; y <= best.maxY; y++) {
    for (let x = best.minX; x <= best.maxX; x++) {
      const i = y * w + x;
      if (comp[i] !== best.id) continue;
      const s = x + y, d = x - y;
      if (s < sMin) { sMin = s; corners.tl = { x, y }; }
      if (s > sMax) { sMax = s; corners.br = { x, y }; }
      if (d > dMax) { dMax = d; corners.tr = { x, y }; }
      if (d < dMin) { dMin = d; corners.bl = { x, y }; }
    }
  }
  if (!corners.tl || !corners.tr || !corners.br || !corners.bl) return null;
  // Sanity: quad must fill most of its own bounding box (rejects diagonals).
  const polyArea = Math.abs(
    (corners.tr.x - corners.tl.x) * (corners.br.y - corners.tl.y) -
    (corners.br.x - corners.tl.x) * (corners.tr.y - corners.tl.y)
  ) / 2 + Math.abs(
    (corners.br.x - corners.tl.x) * (corners.bl.y - corners.tl.y) -
    (corners.bl.x - corners.tl.x) * (corners.br.y - corners.tl.y)
  ) / 2;
  if (polyArea < bw * bh * 0.6) return null;
  return corners;
}

export function detectQuad(srcCanvas) {
  try {
    const W = 400;
    const scale = W / srcCanvas.width;
    const H = Math.max(1, Math.round(srcCanvas.height * scale));
    const small = makeCanvas(W, H);
    small.getContext('2d').drawImage(srcCanvas, 0, 0, W, H);
    const { gray, w, h } = getGray(small);
    const q = maskExtremeQuad(small, gray, w, h);
    if (!q) return null;
    const fx = srcCanvas.width / w, fy = srcCanvas.height / h;
    // 2% outward margin so no text is clipped, clamped to the image.
    const cx = srcCanvas.width / 2, cy = srcCanvas.height / 2;
    const out = {};
    for (const k of ['tl', 'tr', 'br', 'bl']) {
      const px = q[k].x * fx, py = q[k].y * fy;
      const dx = px - cx, dy = py - cy;
      const len = Math.hypot(dx, dy) || 1;
      const m = Math.min(srcCanvas.width, srcCanvas.height) * 0.02;
      out[k] = {
        x: Math.max(0, Math.min(srcCanvas.width - 1, px + (dx / len) * m)),
        y: Math.max(0, Math.min(srcCanvas.height - 1, py + (dy / len) * m)),
      };
    }
    return out;
  } catch {
    return null;
  }
}

// Affine map sending srcTri → dstTri (each 3×{x,y}), solved via Cramer's rule.
function affineFor(srcTri, dstTri) {
  const [x0, y0, x1, y1, x2, y2] = srcTri;
  const [u0, v0, u1, v1, u2, v2] = dstTri;
  const det = x0 * (y1 - y2) - x1 * (y0 - y2) + x2 * (y0 - y1);
  if (Math.abs(det) < 1e-8) return null;
  const a = (u0 * (y1 - y2) - u1 * (y0 - y2) + u2 * (y0 - y1)) / det;
  const b = (v0 * (y1 - y2) - v1 * (y0 - y2) + v2 * (y0 - y1)) / det;
  const c = (x0 * (u1 - u2) - x1 * (u0 - u2) + x2 * (u0 - u1)) / det;
  const d = (x0 * (v1 - v2) - x1 * (v0 - v2) + x2 * (v0 - v1)) / det;
  const e = (x0 * (y2 * u1 - y1 * u2) - x1 * (y2 * u0 - y0 * u2) + x2 * (y1 * u0 - y0 * u1)) / det;
  const f = (x0 * (y2 * v1 - y1 * v2) - x1 * (y2 * v0 - y0 * v2) + x2 * (y1 * v0 - y0 * v1)) / det;
  return [a, b, c, d, e, f];
}

// Perspective warp of a quad to a straight W×H rectangle via two triangles.
// Falls back to null (caller keeps the box crop) on degenerate quads.
export function warpQuad(src, quad, W, H) {
  try {
    const out = makeCanvas(W, H);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const tris = [
      { s: [quad.tl, quad.tr, quad.br], d: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }] },
      { s: [quad.tl, quad.br, quad.bl], d: [{ x: 0, y: 0 }, { x: W, y: H }, { x: 0, y: H }] },
    ];
    for (const t of tris) {
      const m = affineFor(
        [t.s[0].x, t.s[0].y, t.s[1].x, t.s[1].y, t.s[2].x, t.s[2].y],
        [t.d[0].x, t.d[0].y, t.d[1].x, t.d[1].y, t.d[2].x, t.d[2].y],
      );
      if (!m) return null;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(t.d[0].x, t.d[0].y);
      ctx.lineTo(t.d[1].x, t.d[1].y);
      ctx.lineTo(t.d[2].x, t.d[2].y);
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
    return out;
  } catch {
    return null;
  }
}

function quadOutputSize(quad, target = 2000) {
  const top = Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y);
  const bottom = Math.hypot(quad.br.x - quad.bl.x, quad.br.y - quad.bl.y);
  const left = Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y);
  const right = Math.hypot(quad.br.x - quad.tr.x, quad.br.y - quad.tr.y);
  const w = Math.max(1, (top + bottom) / 2), h = Math.max(1, (left + right) / 2);
  const s = target / Math.max(w, h);
  return { W: Math.round(w * s), H: Math.round(h * s) };
}

// ---------------------------------------------------------------------------
// prepareReceipt: full Stage-0 pipeline.
//   load (EXIF) → quad detect → perspective warp (fallback: box crop,
//   fallback: full image) → 90° orientation → deskew → straightened canvas.
// Returns the corrected canvas plus geometry meta for the debug panel.
// ---------------------------------------------------------------------------
export async function prepareReceipt(file, target = 2000) {
  const bmp = await loadBitmap(file);
  try {
    const CAP = 2600;
    const s0 = Math.min(1, CAP / Math.max(bmp.width, bmp.height));
    const base = makeCanvas(bmp.width * s0, bmp.height * s0);
    base.getContext('2d').drawImage(bmp, 0, 0, base.width, base.height);

    // 0) Coarse crop FIRST: exact left/top paper edges + text-extent
    // right/bottom. Removes keyboard/background text that destroys page
    // segmentation. Everything downstream runs on the receipt-dominant crop.
    let coarse = null;
    let coarseBox = coarseCropBox(base);
    if (coarseBox) {
      const { x, y, w, h } = coarseBox.box;
      coarse = makeCanvas(w, h);
      coarse.getContext('2d').drawImage(base, x, y, w, h, 0, 0, w, h);
    }
    const stage0 = coarse || base;

    let canvas = stage0;
    let quad = detectQuad(stage0);
    let usedWarp = false;
    if (quad) {
      const { W, H } = quadOutputSize(quad, target);
      const warped = warpQuad(stage0, quad, W, H);
      if (warped) {
        canvas = warped;
        usedWarp = true;
      } else {
        quad = null;
      }
    }
    let box = null;
    if (!usedWarp) {
      box = detectReceiptBox(stage0);
      if (box) {
        const cropped = makeCanvas(box.w, box.h);
        cropped.getContext('2d').drawImage(stage0, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        canvas = cropped;
      }
      const s1 = target / Math.max(canvas.width, canvas.height);
      if (s1 > 1.02 || s1 < 0.98) {
        const r = makeCanvas(canvas.width * s1, canvas.height * s1);
        const rctx = r.getContext('2d');
        rctx.imageSmoothingEnabled = true;
        rctx.imageSmoothingQuality = 'high';
        rctx.drawImage(canvas, 0, 0, r.width, r.height);
        canvas = r;
      }
    }

    const orient = orientationDeg(canvas);
    if (orient) canvas = rotateCanvas(canvas, orient);
    const deg = deskewAngle(canvas);
    if (deg) canvas = rotateCanvas(canvas, deg);

    return {
      canvas, quad, box, usedWarp, orientedDeg: orient, deskewDeg: deg,
      coarse: coarseBox ? coarseBox.box : null,
      skewDeg: coarseBox ? coarseBox.skewDeg : 0,
    };
  } finally {
    if (typeof bmp.close === 'function') bmp.close();
  }
}

// Clamped sub-canvas crop with optional relative margin (0..1 of rect size).
export function cropCanvas(src, rect, margin = 0) {
  const mw = rect.w * margin, mh = rect.h * margin;
  const x0 = Math.max(0, Math.floor(rect.x - mw));
  const y0 = Math.max(0, Math.floor(rect.y - mh));
  const x1 = Math.min(src.width, Math.ceil(rect.x + rect.w + mw));
  const y1 = Math.min(src.height, Math.ceil(rect.y + rect.h + mh));
  const out = makeCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  out.getContext('2d').drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
  return out;
}

export function canvasToBlob(canvas, quality = 0.92) {
  return toBlob(canvas, quality);
}

// Upscale a region crop 3–4× for small handwritten digits (capped so the
// longest side never exceeds 3600px).
export function upscaleRegion(src, factor = 3.5, cap = 3600) {
  const f = Math.min(factor, cap / Math.max(src.width, src.height));
  if (f <= 1.02) return src;
  const out = makeCanvas(src.width * f, src.height * f);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

// ---------------------------------------------------------------------------
// Six OCR render variants of the SAME corrected receipt. Handwritten pencil/
// pen strokes are thin and light: the default renders never binarize, and
// even the adaptive-threshold variant uses a gentle k + wide window so
// strokes survive. V6 fuses dot-matrix dots into solid strokes.
// Agreement across variants drives field confidence.
//   V1 original-enhanced | V2 grayscale | V3 high-contrast |
//   V4 sharpened | V5 adaptive-threshold (gentle) | V6 closed print
//   (region upscales are applied per-crop in the service).
// ---------------------------------------------------------------------------
function grayOf(canvas) {
  return getGray(canvas);
}

function applyGray(canvas, arr) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < arr.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(arr[i])));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function strongContrast(gray) {
  const sorted = Float32Array.from(gray).sort();
  const lo = sorted[Math.floor(sorted.length * 0.005)] ?? 0;
  const hi = sorted[Math.ceil(sorted.length * 0.995) - 1] ?? 255;
  const out = new Float32Array(gray.length);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.max(0, Math.min(1, (gray[i] - lo) / span));
    out[i] = 255 * Math.pow(v, 0.85); // gentle gamma lifts mid-tone strokes
  }
  return out;
}

function gentleSauvola(gray, w, h) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sum2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rs2 = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      rs += v; rs2 += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
      sum2[(y + 1) * W + x + 1] = sum2[y * W + x + 1] + rs2;
    }
  }
  // Wide window + low k: keeps light handwritten strokes, still kills shade.
  const win = Math.max(25, Math.min(81, Math.round(w / 30) | 0 || 25));
  const hw = win >> 1, k = 0.22, R = 128;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - hw), y1 = Math.min(h - 1, y + hw);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - hw), x1 = Math.min(w - 1, x + hw);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const a = y0 * W + x0, b = y0 * W + x1 + 1, c = (y1 + 1) * W + x0, d = (y1 + 1) * W + x1 + 1;
      const mean = (sum[d] - sum[b] - sum[c] + sum[a]) / area;
      const varr = Math.max(0, (sum2[d] - sum2[b] - sum2[c] + sum2[a]) / area - mean * mean);
      const t = mean * (1 + k * (Math.sqrt(varr) / R - 1));
      out[y * w + x] = gray[y * w + x] < t ? 0 : 255;
    }
  }
  return out;
}

// Morphological closing (dilate→erode) on a bilevel image: fuses the
// disconnected dots of dot-matrix print into solid strokes the LSTM was
// trained on. Proven on faint receipts where plain thresholding reads
// fragments ("Php4." instead of "Php74.60").
function closeBinary(bw, w, h, r = 1) {
  const at = (src, x, y) => src[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  const dil = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let j = -r; j <= r && m !== 0; j++) {
        for (let i = -r; i <= r; i++) {
          if (at(bw, x + i, y + j) === 0) { m = 0; break; }
        }
      }
      dil[y * w + x] = m;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let j = -r; j <= r && m !== 255; j++) {
        for (let i = -r; i <= r; i++) {
          if (at(dil, x + i, y + j) === 255) { m = 255; break; }
        }
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

export function renderVariants(corrected) {
  const { gray, w, h } = grayOf(corrected);
  const flat = flattenLighting(gray, w, h);
  const standard = contrastStretch(Float32Array.from(flat));

  const v1 = cloneCanvas(corrected); // V1: enhanced original (no threshold)
  applyGray(v1, unsharp(standard, w, h, 0.5));

  const v2 = cloneCanvas(corrected); // V2: plain grayscale (flatten only)
  applyGray(v2, flat);

  const v3 = cloneCanvas(corrected); // V3: high-contrast
  applyGray(v3, unsharp(strongContrast(flat), w, h, 0.4));

  const v4 = cloneCanvas(corrected); // V4: sharpened
  applyGray(v4, unsharp(standard, w, h, 1.0));

  const v5 = cloneCanvas(corrected); // V5: gentle adaptive threshold
  applyGray(v5, Float32Array.from(gentleSauvola(standard, w, h)));

  const v6 = cloneCanvas(corrected); // V6: closed print (dot-matrix dots fused)
  applyGray(v6, Float32Array.from(closeBinary(gentleSauvola(standard, w, h), w, h, 1)));

  return [
    { name: 'V1 enhanced', canvas: v1 },
    { name: 'V2 grayscale', canvas: v2 },
    { name: 'V3 high-contrast', canvas: v3 },
    { name: 'V4 sharpened', canvas: v4 },
    { name: 'V5 adaptive-threshold', canvas: v5 },
    { name: 'V6 closed print', canvas: v6 },
  ];
}
// NOTE: legacy upscaleForOcr lives above (line ~421); do not duplicate it here.
