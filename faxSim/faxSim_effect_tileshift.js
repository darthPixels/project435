// Filename: faxSim_effect_tileshift.js
// ──────────────────────────────────────────────────────────────────────────────
// Tile Shift Effect Module (with alpha + debug borders) for faxSim.js
//
// Description:
//   Copies and pastes random tiles from the image, ensuring an alpha channel
//   exists so compositing works, and draws a 1px red border around each tile.
//
// Integration:
//   Place alongside faxSim.js.
//   In faxSim.js, import:
//     import { applyTileshiftEffect } from './faxSim_effect_tileshift.js';
//
// Dependencies:
//   • child_process.execFileSync
//   • fs, os, path (built-in Node modules)
//   • ImageMagick CLI (magick/convert) referenced by your IM variable
//
// Exported Function:
//   applyTileshiftEffect(
//     cur, name, tmpDir, IM,
//     batchPerc, amountTiles,
//     tilesSize, tilesVariation,
//     tilesOffsetX, tilesOffsetY,
//     offsetVariation
//   )
//   – cur               : current PNG filepath
//   – name              : base filename (no extension)
//   – tmpDir            : temp directory (e.g. os.tmpdir())
//   – IM                : ImageMagick CLI command
//   – batchPerc         : fraction (0–1) of files to affect
//   – amountTiles       : number of tiles to copy/paste
//   – tilesSize         : base tile size in px
//   – tilesVariation    : extra random size up to +n px
//   – tilesOffsetX      : base horizontal offset in px
//   – tilesOffsetY      : base vertical offset in px
//   – offsetVariation   : extra random offset up to +n px
//   Returns new PNG path (or original if skipped).

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// ──────────────────────────────────────────────────────────────────────────────
// Helper: random integer between min and max inclusive
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Effect Function
export function applyTileshiftEffect(
  cur, name, tmpDir, IM,
  batchPerc, amountTiles,
  tilesSize, tilesVariation,
  tilesOffsetX, tilesOffsetY,
  offsetVariation
) {
  // 1) Skip some images based on batch percentage
  if (batchPerc < 1 && Math.random() > batchPerc) {
    return cur;
  }

  // 2) Get image dimensions
  const [w, h] = execFileSync(
    IM,
    ['identify', '-format', '%w %h', cur],
    { encoding: 'utf8' }
  ).trim().split(' ').map(Number);

  // 3) Build ImageMagick command arguments (ensure alpha)
  const targs = [
    cur,
    '-alpha', 'set'   // ← ensure alpha channel for compositing
  ];
  for (let i = 0; i < amountTiles; i++) {
    const extra = randInt(0, tilesVariation);
    const ts    = tilesSize + extra;
    let x = randInt(0, w - ts);
    let y = randInt(0, h - ts);
    const dx = tilesOffsetX + randInt(0, offsetVariation);
    const dy = tilesOffsetY + randInt(0, offsetVariation);
    let px = x + dx;
    let py = y + dy;
    if (px + ts > w) px = w - ts;
    if (py + ts > h) py = h - ts;

    targs.push(
      '(',
        '+clone',
        '-crop',       `${ts}x${ts}+${x}+${y}`,
        '+repage',
      ')',
      '-geometry', `+${px}+${py}`,
      '-compose',  'Over',
      '-composite'
    );
  }

  // 4) Execute ImageMagick and cleanup
  const outPath = path.join(tmpDir, `${name}_tiles.png`);
  execFileSync(IM, [ ...targs, outPath ], { stdio: 'inherit' });
  fs.unlinkSync(cur);

  return outPath;
}
