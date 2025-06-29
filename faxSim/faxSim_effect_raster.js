// Filename: faxSim_effect_raster.js
// ──────────────────────────────────────────────────────────────────────────────
// Simple ordered‐dither “raster” effect module.
// Applies an ImageMagick ordered‐dither to a 1‐bit (or gray) PNG, producing
// a halftone/raster overlay that can be composited or used standalone.
//
// Exports:
//   applyRasterEffect(cur, name, tmpDir, IM, batchPerc, rasterMap)
//
// Params:
//   cur         – path to current PNG
//   name        – base filename (no ext)
//   tmpDir      – temp directory (e.g. os.tmpdir())
//   IM          – ImageMagick CLI command
//   batchPerc   – fraction of files to affect (0–1)
//   rasterMap   – map name (o2x2, o4x4, o8x8, etc.)
// Returns:
//   path to new PNG (or original if skipped)
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export function applyRasterEffect(
  cur, name, tmpDir, IM,
  batchPerc, rasterMap
) {
  // 1) Batch‐skip
  if (batchPerc < 1 && Math.random() > batchPerc) {
    return cur;
  }

  // 2) Build output path
  const out = path.join(tmpDir, `${name}_raster.png`);

  // 3) Ordered‐dither pass
  execFileSync(IM, [
    cur,
    '+dither',
    '-ordered-dither',
    rasterMap,
    out
  ], { stdio: 'inherit' });

  // 4) Cleanup original
  fs.unlinkSync(cur);

  return out;
}
