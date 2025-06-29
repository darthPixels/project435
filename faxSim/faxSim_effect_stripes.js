// faxSim_effect_stripes.js
// ------------------------------------------------------------
// Module: “Stripes” effect (formerly NoiseB)
// Draws clusters of colored speckles with optional motion-blur.
// ------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// random integer in [min, max)
const randInt = (min, max) =>
  Math.floor(Math.random() * (max - min)) + min;

// Box–Muller Gaussian generator (mean=0, σ=1)
const randGaussian = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// clamp value between min and max
const clamp = (val, min, max) =>
  val < min ? min : val > max ? max : val;

/**
 * applyStripesEffect
 *
 * @param {string}  cur             - current image path
 * @param {string}  name            - base filename for intermediates
 * @param {string}  tmpDir          - temp directory for intermediates
 * @param {string}  IM              - path to magick executable
 * @param {number}  batchPerc       - fraction of pages to process (0–1)
 * @param {number}  areasAmount     - number of stripe clusters
 * @param {number}  areaWidthPx     - width of each cluster
 * @param {number}  areaHeightPx    - height of each cluster
 * @param {number}  density         - proportion of pixels to plot (0–1)
 * @param {boolean} applySmear      - toggle motion-blur inside clusters
 * @param {number}  smearLMin       - minimal blur length
 * @param {number}  smearLMax       - maximal blur length
 * @param {string|number} areaDir   - smear direction angle or 'random'
 * @param {number}  lineSpacing     - only plot speckles on every X scanlines
 * @param {string}  color           - 'black' or 'white'
 * @returns {string}                - path to new image (or original if skipped)
 */
export function applyStripesEffect(
  cur,
  name,
  tmpDir,
  IM,
  batchPerc,
  areasAmount,
  areaWidthPx,
  areaHeightPx,
  density,
  applySmear,
  smearLMin,
  smearLMax,
  areaDir,
  lineSpacing,
  color = 'black'
) {
  // Skip some pages if batchPerc < 1
  if (batchPerc < 1 && Math.random() > batchPerc) {
    return cur;
  }

  // 1) Get page dimensions
  const [w, h] = execFileSync(
    IM,
    ['identify', '-format', '%w %h', cur],
    { encoding: 'utf8' }
  ).trim().split(/\s+/).map(Number);

  const cxPage = w / 2;
  const cyPage = h / 2;
  const maxDist = Math.hypot(cxPage, cyPage);

  let composite = cur;

  // 2) Generate each stripe-cluster
  for (let a = 0; a < areasAmount; a++) {
    // Random cluster center (kept in bounds)
    const cx = randInt(Math.floor(areaWidthPx/2), w - Math.ceil(areaWidthPx/2));
    const cy = randInt(Math.floor(areaHeightPx/2), h - Math.ceil(areaHeightPx/2));

    // Cluster box origin & size
    const halfW = Math.floor(areaWidthPx/2);
    const halfH = Math.floor(areaHeightPx/2);
    const x0 = cx - halfW;
    const y0 = cy - halfH;
    const bw = areaWidthPx;
    const bh = areaHeightPx;

    // Number of speckles to plot
    const pixelCount = Math.floor(Math.PI * halfW * halfH * density);
    if (pixelCount < 1) continue;

    // Gaussian spread so ±1σ ≈ 80% of box
    const regionFrac = 0.8;
    const sigmaX = (bw * regionFrac) / 2;
    const sigmaY = (bh * regionFrac) / 2;

    // Build MVG commands
    const mvgLines = [
      'push graphic-context',
      `viewbox 0 0 ${bw} ${bh}`,
      `fill ${color}`,
      'stroke none'
    ];

    for (let i = 0; i < pixelCount; i++) {
      // sample around center with Gaussian
      const xi = clamp(Math.round(halfW + randGaussian() * sigmaX), 0, bw - 1);
      const yi = clamp(Math.round(halfH + randGaussian() * sigmaY), 0, bh - 1);

      // stripe spacing
      if (lineSpacing > 1 && (yi % lineSpacing) !== 0) continue;

      // fade edges
      const dx = Math.abs(xi - halfW) / halfW;
      const dy = Math.abs(yi - halfH) / halfH;
      const fade = Math.pow(1 - Math.max(dx, dy), 2);
      if (fade < 0.05) continue;

      // jitter & probability
      const jitter = randGaussian() * 0.1;
      const weight = clamp(fade + jitter, 0, 1);
      if (Math.random() > weight) continue;

      mvgLines.push(`point ${xi},${yi}`);
    }

    mvgLines.push('pop graphic-context');

    // Write MVG & render speckles
    const mvgPath = path.join(tmpDir, `${name}_stripes_blob${a}.mvg`);
    fs.writeFileSync(mvgPath, mvgLines.join('\n'), 'utf8');

    const base = path.join(tmpDir, `${name}_stripes_blob${a}_base.png`);
    execFileSync(IM, ['-size', `${bw}x${bh}`, 'canvas:none', base], { stdio: 'inherit' });

    const speck = path.join(tmpDir, `${name}_stripes_blob${a}_speck.png`);
    execFileSync(IM, [base, '-draw', `@${mvgPath}`, speck], { stdio: 'inherit' });

    fs.unlinkSync(base);
    fs.unlinkSync(mvgPath);

    // Optional motion-blur smear
    let layer = speck;
    if (applySmear) {
      const dist    = Math.hypot(cx - cxPage, cy - cyPage);
      const rawLen  = smearLMin + (smearLMax - smearLMin) * (1 - dist / maxDist);
      const blurLen = clamp(rawLen, smearLMin, smearLMax);
      const angle   = areaDir === 'random' ? Math.random() * 360 : Number(areaDir);

      const smeared = path.join(tmpDir, `${name}_stripes_blob${a}_smear.png`);
      execFileSync(
        IM,
        [
          speck,
          '-virtual-pixel', 'transparent',
          '-motion-blur', `0x${blurLen.toFixed(1)}+${angle}`,
          smeared
        ],
        { stdio: 'inherit' }
      );

      fs.unlinkSync(speck);
      layer = smeared;
    }

    // Composite back onto page
    const next = path.join(tmpDir, `${name}_stripes_blob${a}_comp.png`);
    execFileSync(
      IM,
      [
        composite,
        layer,
        '-geometry', `+${x0}+${y0}`,
        '-compose', 'Over',
        '-composite',
        next
      ],
      { stdio: 'inherit' }
    );

    fs.unlinkSync(composite);
    fs.unlinkSync(layer);
    composite = next;
  }

  return composite;
}
