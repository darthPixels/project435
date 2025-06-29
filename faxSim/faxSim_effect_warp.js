// faxSim_effect_warp.js
// ------------------------------------------------------------
// Module: Warp effect via ImageMagick “Shepards” distortion
// Pads → warps → auto‐scales to fit → applies a final downscale → centers
// on a WxH canvas so nothing ever gets clipped and you can
// tweak a final scale via INI.
// ------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * applyWarpEffect
 *
 * @param {string}  cur             - Path to current image
 * @param {string}  name            - Base filename for intermediates
 * @param {string}  tmpDir          - Directory for temp files
 * @param {string}  IM              - Path to magick executable
 * @param {boolean} applyWarp       - Enable/disable the warp
 * @param {number}  warpBatchPerc   - Fraction of pages to warp (0.0–1.0)
 * @param {number}  warpOffsetPx    - Corner offset in pixels
 * @param {number}  warpFinalScale  - Final downscale factor (0.0–1.0)
 * @returns {string}                - Path to warped image
 */
export function applyWarpEffect(
  cur, name, tmpDir, IM,
  applyWarp,
  warpBatchPerc,
  warpOffsetPx,
  warpFinalScale
) {
  // 1. Maybe skip
  if (!applyWarp || Math.random() > warpBatchPerc) return cur;

  // 2. Read original width & height
  const [w, h] = execFileSync(
    IM, [cur, '-format', '%w %h', 'info:'],
    { encoding: 'utf8' }
  ).trim().split(/\s+/).map(Number);

  // 3. Clamp offset
  const rawOff = Number(warpOffsetPx) || 0;
  const limit  = Math.min(w, h) / 2 - 1;
  const off    = Math.max(-limit, Math.min(limit, rawOff));

  // 4. Pad by diagonal so nothing ever clips
  const diag = Math.ceil(Math.hypot(w, h));
  const pad  = diag;
  const pw   = w + 2 * pad;
  const ph   = h + 2 * pad;

  // 5. Control points on padded canvas
  const ctrl = [
    `${pad},${pad}           ${pad+off},${pad+off}`,       // TL
    `${pad+w},${pad}         ${pad+w-off},${pad+off}`,     // TR
    `${pad},${pad+h}         ${pad+off},${pad+h-off}`,     // BL
    `${pad+w},${pad+h}       ${pad+w-off},${pad+h-off}`    // BR
  ].join(' ');

  // 6. Paths
  const padPath = path.join(tmpDir, `${name}_warp_pad.png`);
  const outPath = path.join(tmpDir, `${name}_warp.png`);

  // 7. Pad & warp
  execFileSync(
    IM,
    [
      cur,
      '-background', 'transparent',
      '-extent',    `${pw}x${ph}`,        // pad
      '-virtual-pixel','transparent',
      '-distort','Shepards', ctrl,        // warp
      padPath
    ],
    { stdio: 'inherit' }
  );

  // 8. Get warped bbox (“WxH+X+Y”)
  const geom = execFileSync(
    IM, [padPath, '-format', '%@', 'info:'], { encoding: 'utf8' }
  ).trim();
  const [size] = geom.split('+');
  const [TW, TH] = size.split('x').map(Number);

  // 9. Scale-to-fit inside w×h
  const fitScale = Math.min(w/TW, h/TH);
  // 10. Apply final downscale factor from INI
  const finalScale = fitScale * (Number(warpFinalScale) || 1);

  const TW2 = Math.round(TW * finalScale);
  const TH2 = Math.round(TH * finalScale);

  // 11. Crop → resize → center → flatten
  execFileSync(
    IM,
    [
      padPath,
      '-crop',    geom,           // isolate warped content
      '+repage',
      '-resize',  `${TW2}x${TH2}`,// apply final scale
      '-background','white',
      '-gravity','center',
      '-extent',  `${w}x${h}`,     // center on page
      outPath
    ],
    { stdio: 'inherit' }
  );

  // 12. Cleanup
  fs.unlinkSync(cur);
  fs.unlinkSync(padPath);
  return outPath;
}
