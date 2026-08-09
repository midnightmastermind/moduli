// helpers/imageOutline.js
//
// Turn a photo into a LINE DRAWING — black strokes on white, nothing else.
//
// ── WHY THIS IS CANNY AND NOT A THRESHOLD ──────────────────────────────────
//
// The obvious version — blur, run a Sobel operator, keep every pixel whose
// gradient is over some cutoff — was written first and produced SOLID BLOBS,
// twice. A Sobel magnitude is high across the whole SHOULDER of an edge, not
// just at its crest, so on a photo of anything soft (a face, fabric, foliage)
// the "edges" merge into filled regions. The picture looked like a bad
// threshold because that is exactly what it was.
//
// What fixes it is the two steps a real Canny has and a threshold does not:
//
//   NON-MAXIMUM SUPPRESSION — keep a pixel only if its gradient is the local
//   peak ALONG the gradient direction. This is what turns a wide ramp into a
//   one-pixel line, and it is the whole difference between a drawing and a
//   blob.
//
//   HYSTERESIS — a strong pixel starts a line; a weak one is kept only if it
//   is reachable from a strong one. A single cutoff either drops the faint
//   continuation of a real contour or admits every speck of sensor noise;
//   two cutoffs plus connectivity does neither.
//
// ── THE THRESHOLDS ARE PERCENTILES, NOT ABSOLUTE VALUES ────────────────────
//
// `high: 0.88` means "the 88th percentile of this image's own gradients", not
// a fixed number. An absolute cutoff is tuned to one photo's contrast and is
// wrong for the next one — a dim scan produces nothing, a high-contrast one
// produces mud. A percentile asks for a roughly consistent amount of ink
// whatever the exposure, which is what makes a single preset usable across
// the photos a person actually drops.
//
// ── EVERYTHING HERE IS PURE ────────────────────────────────────────────────
//
// Plain typed arrays in, plain typed arrays out — no canvas, no DOM. jsdom has
// no canvas, so any pixel logic that lived behind one would be untestable, and
// this is the half where being wrong is invisible until someone looks at a
// picture. The canvas work (decode, draw, encode) stays in the caller.

// ── THE PRESETS WERE TUNED BY LOOKING, NOT BY REASONING ────────────────────
//
// Rendered through the real tracer against real images and inspected. The
// first colouring guess (σ2.6 / 0.93 / 0.74) was measurably wrong in a way no
// unit test would have caught: it produced clean lines that DROPPED THE
// SUBJECT — the heavy blur plus a 93rd-percentile bar kept only the highest-
// contrast background contours, and what it did keep came out DASHED. Broken
// outlines are worse than sparse ones for a colouring page, because you cannot
// fill a region whose border has gaps.
//
// What fixed it was not a higher bar but letting each seed RUN FURTHER.
// `high` seeds the contours; the low threshold decides how far each seed is
// allowed to extend.
//
// AND THE LOW THRESHOLD IS A RATIO OF `high`, NOT ITS OWN PERCENTILE — which
// is the second thing looking caught. A percentile rank for the low bar
// assumes a broad spread of gradients, which a PHOTO has and LINE ART does
// not: on a clean ring (one uniform stroke, so nearly every ridge pixel has
// the same magnitude) an independent 68th-percentile cut chopped the contour
// into dashes at arbitrary angles. Measured on that ring, `low = 0.4 * high`
// (the classic Canny ratio) took it from 0.24% ink in broken dashes to 0.97%
// in continuous arcs, and moved the two real photos by almost nothing
// (2.2 → 2.4%, 7.9 → 7.5%). Someone drops a screenshot or a scanned diagram
// as readily as a photo, and only the ratio survives both.
//
// NOT tuned further against that ring: its remaining gaps are on the
// diagonals, where anti-aliasing genuinely halves the gradient. Lowering
// `high` to chase them barely moved the ring (0.97 → 1.05%) and made both
// photos twice as busy — over-fitting to a synthetic input at the expense of
// the real ones.
//
// HONEST LIMIT: this is edge detection, so the regions it outlines are NOT
// guaranteed closed. A true colouring page — every region sealed and fillable
// — needs segmentation, which is a different algorithm and a different
// session. What this delivers is a good tracing, not a fillable one.
export const OUTLINE_MODES = {
  // A colouring page: bolder lines, thickened so they read and hold ink.
  coloring: { sigma: 1.8, high: 0.88, lowRatio: 0.4, dilate: 1 },
  // A blueprint: finer and busier, keeping structure and detail. Less blur, no
  // thickening — a technical tracing rather than a drawing.
  blueprint: { sigma: 1.3, high: 0.88, lowRatio: 0.4, dilate: 0 },
};

export const DEFAULT_OUTLINE_MODE = "coloring";

/** Rec. 709 luma — the weights that match perceived brightness. */
export function toGrayscale(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return out;
}

/**
 * Gaussian blur, applied as two 1-D passes.
 *
 * Separable because a 2-D Gaussian is the product of two 1-D ones: for a
 * radius-r kernel that is 2(2r+1) multiplies per pixel instead of (2r+1)², and
 * on a full-size phone photo that is the difference between a responsive drop
 * and a visibly stalled one.
 */
export function gaussianBlur(src, width, height, sigma) {
  if (!(sigma > 0)) return Float32Array.from(src);
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / denom);
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  // Edges CLAMP rather than wrap or zero. Wrapping bleeds the far side of the
  // image in; zeroing invents a hard black border, which then reads as a
  // strong edge and draws a frame around every output.
  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        acc += src[y * width + xx] * kernel[k + radius];
      }
      tmp[y * width + x] = acc;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += tmp[yy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

/** Sobel: gradient magnitude and direction per pixel. */
export function sobel(src, width, height) {
  const mag = new Float32Array(width * height);
  const dir = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = src[i - width - 1], t = src[i - width], tr = src[i - width + 1];
      const l = src[i - 1], r = src[i + 1];
      const bl = src[i + width - 1], b = src[i + width], br = src[i + width + 1];
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      mag[i] = Math.hypot(gx, gy);
      dir[i] = Math.atan2(gy, gx);
    }
  }
  return { mag, dir };
}

/**
 * Non-maximum suppression — THE step that makes this a drawing.
 *
 * Each pixel's gradient direction is snapped to one of four neighbour axes and
 * the pixel is kept only if it out-peaks both neighbours along that axis. A
 * wide gradient ramp collapses to the single pixel at its crest.
 */
export function nonMaxSuppress(mag, dir, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      // Gradient direction is modulo 180°: a light→dark edge and its dark→light
      // twin lie on the same axis.
      let a = dir[i] * (180 / Math.PI);
      if (a < 0) a += 180;
      let n1, n2;
      if (a < 22.5 || a >= 157.5) { n1 = mag[i - 1]; n2 = mag[i + 1]; }                       // horizontal
      else if (a < 67.5) { n1 = mag[i - width + 1]; n2 = mag[i + width - 1]; }                // diagonal /
      else if (a < 112.5) { n1 = mag[i - width]; n2 = mag[i + width]; }                       // vertical
      else { n1 = mag[i - width - 1]; n2 = mag[i + width + 1]; }                              // diagonal \
      // ASYMMETRIC on purpose: strictly greater on one side, greater-or-equal
      // on the other. With `>=` on both, a PLATEAU of equal gradients — which
      // is exactly what a long even ramp produces — passes everywhere and the
      // whole slope survives as a blob. This keeps one pixel of a plateau
      // instead of all of it.
      out[i] = (mag[i] > n1 && mag[i] >= n2) ? mag[i] : 0;
    }
  }
  return out;
}

/**
 * The gradient value at a given percentile of the NON-ZERO magnitudes.
 *
 * Non-zero only, and that matters: after suppression most of the frame is
 * exactly 0, so a percentile over every pixel would land in that dead mass and
 * the "93rd percentile" would be near nothing. Ranking only the surviving
 * ridge pixels is what makes the number mean what it says.
 */
export function percentile(values, p) {
  const live = [];
  for (let i = 0; i < values.length; i++) if (values[i] > 0) live.push(values[i]);
  if (!live.length) return 0;
  live.sort((a, b) => a - b);
  const idx = Math.min(live.length - 1, Math.max(0, Math.round(p * (live.length - 1))));
  return live[idx];
}

/**
 * Double threshold + hysteresis, flood-filled from the strong pixels.
 *
 * Iterative with an explicit stack rather than recursion: a long contour on a
 * 12-megapixel photo is tens of thousands of pixels deep, and recursion blows
 * the stack on exactly the images this is for.
 */
export function hysteresis(mag, width, height, hi, lo) {
  const keep = new Uint8Array(width * height);
  const stack = [];
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] >= hi) { keep[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width, y = (i / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (!keep[n] && mag[n] >= lo) { keep[n] = 1; stack.push(n); }
      }
    }
  }
  return keep;
}

/** Thicken by `radius` pixels so a hairline reads (and prints) as a stroke. */
export function dilate(keep, width, height, radius) {
  if (!(radius > 0)) return keep;
  const out = new Uint8Array(keep.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let dy = -radius; dy <= radius && !on; dy++) {
        for (let dx = -radius; dx <= radius && !on; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (keep[ny * width + nx]) on = 1;
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

/**
 * A photo → a line drawing. RGBA in, RGBA out, same dimensions.
 *
 * OPAQUE WHITE BACKGROUND, not transparency. The user asked for a trace, and a
 * transparent PNG of black lines is invisible on this app's dark surfaces —
 * it would look like the shape produced nothing.
 *
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @param {string|object} mode  a key of OUTLINE_MODES, or an explicit params object
 * @returns {{ rgba: Uint8ClampedArray, inkRatio: number }}
 */
export function traceOutline(rgba, width, height, mode = DEFAULT_OUTLINE_MODE) {
  const p = typeof mode === "string" ? (OUTLINE_MODES[mode] || OUTLINE_MODES[DEFAULT_OUTLINE_MODE]) : mode;

  const gray = toGrayscale(rgba, width, height);
  const blurred = gaussianBlur(gray, width, height, p.sigma);
  const { mag, dir } = sobel(blurred, width, height);
  const thin = nonMaxSuppress(mag, dir, width, height);
  const hi = percentile(thin, p.high);
  const lo = hi * (p.lowRatio ?? 0.4);
  // NOTHING SURVIVED SUPPRESSION → trace nothing. Without this guard a flat or
  // near-flat image sets both thresholds to 0, `mag >= 0` is true for every
  // pixel, and the output is a SOLID BLACK RECTANGLE — the worst possible
  // answer to "there are no edges here", and one a low-contrast scan reaches
  // easily.
  let keep = hi > 0
    ? dilate(hysteresis(thin, width, height, hi, lo), width, height, p.dilate)
    : new Uint8Array(width * height);

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, o = 0; i < keep.length; i++, o += 4) {
    const v = keep[i] ? 0 : 255;
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
  }
  // How much of the frame is ink. The caller reports it, because "the trace is
  // blank" and "the trace is a solid block" are both failures a user should be
  // told about rather than left to discover.
  let ink = 0;
  for (let i = 0; i < keep.length; i++) if (keep[i]) ink++;
  return { rgba: out, inkRatio: keep.length ? ink / keep.length : 0 };
}

// ── The browser half ────────────────────────────────────────────────────────
//
// Decode → trace → encode. Kept apart from the pixel math above so that math
// stays testable: jsdom has no canvas, so anything behind one is unreachable
// from a unit test, and this is a feature whose output is a PICTURE — the half
// where being wrong is invisible until someone looks.

/** Longest edge the tracer runs at. */
export const OUTLINE_MAX_EDGE = 1600;

/**
 * A File/Blob holding an image → a File holding its line drawing.
 *
 * DOWNSCALED FIRST. The tracer is O(pixels) with a Gaussian whose kernel grows
 * with σ, so a 12-megapixel phone photo is seconds of blocked main thread, and
 * the extra resolution buys nothing — a trace of a 12MP image is the same
 * drawing with thinner lines. 1600px keeps a full-page print legible.
 *
 * @returns {Promise<{ file: File, inkRatio: number, width: number, height: number }>}
 */
export async function traceImageFile(file, mode = DEFAULT_OUTLINE_MODE) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, OUTLINE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const cx = canvas.getContext("2d", { willReadFrequently: true });
  // WHITE UNDERNEATH, before the image. A transparent PNG (or a screenshot with
  // an alpha channel) otherwise composites over black, and every light region
  // of it reads as a hard edge — the trace comes back framed in garbage.
  cx.fillStyle = "#fff";
  cx.fillRect(0, 0, width, height);
  cx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const src = cx.getImageData(0, 0, width, height);
  const { rgba, inkRatio } = traceOutline(src.data, width, height, mode);
  cx.putImageData(new ImageData(rgba, width, height), 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not encode the outline");
  // PNG, not JPEG: this is two-tone line art, which JPEG turns to mush around
  // every stroke and which PNG compresses far smaller anyway.
  const name = `${String(file?.name || "image").replace(/\.[^.]+$/, "")} — ${mode}.png`;
  return { file: new File([blob], name, { type: "image/png" }), inkRatio, width, height };
}
