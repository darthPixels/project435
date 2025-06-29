// Filename: faxSim_effect_dropout.js
// ──────────────────────────────────────────────────────────────────────────────
// Dropout (Random Blocks) Effect Module for faxSim.js
//
// Description:
//   Applies a “dropout” effect by overlaying random white-square blocks
//   via ImageMagick MVG. Can be enabled for a percentage of images in a batch.
//
// Location & Integration:
//   Place alongside faxSim.js in your CLI_app directory.
//   In faxSim.js, import:
//     import { applyDropoutEffect } from './faxSim_effect_dropout.js';
//
// Dependencies:
//   • child_process.execFileSync
//   • fs, os, path (built-in Node modules)
//   • ImageMagick CLI (magick or convert) referenced by your IM variable
//
// Exported Function:
//   applyDropoutEffect(cur, name, tmpDir, IM, dropoutAmount, dropoutSize, dropoutBatchPerc)
//     – cur               
//         Path to current PNG file
//     – name              
//         Base filename (no extension) for naming temp output
//     – tmpDir            
//         Temp directory (e.g. os.tmpdir())
//     – IM                
//         ImageMagick command (e.g. 'magick')
//     – dropoutAmount     
//         Fraction (0–1) of total image area to cover with blocks
//     – dropoutSize       
//         Block size in px (floats <1 → 1px minimum)
//     – dropoutBatchPerc  
//         Fraction (0–1) of images in batch that get this effect
//
// Usage in faxSim.js (example):
//   if (cfg.applyRandomBlocks) {
//     cur = applyDropoutEffect(
//       cur, name, os.tmpdir(), IM,
//       cfg.dropoutAmount, cfg.dropoutSize, cfg.dropoutBatchPerc
//     );
//   }

// ──────────────────────────────────────────────────────────────────────────────
// Section: Imports
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// ──────────────────────────────────────────────────────────────────────────────
// Section: MVG Generation Helper
/**
 * createMVG()
 * Generates an MVG script file containing random white rectangles.
 *
 * @param {number} w             Image width in px
 * @param {number} h             Image height in px
 * @param {number} dropoutAmount Fraction of total area to cover (0–1)
 * @param {number} dropoutSize   Desired block size in px (floats <1 → 1px)
 * @returns {string|null}        Path to .mvg file or null if no blocks needed
 */
function createMVG(w, h, dropoutAmount, dropoutSize) {
  // Ensure each block is at least 1px
  const blockSize = dropoutSize < 1 ? 1 : Math.floor(dropoutSize);

  const totalArea = w * h;
  const blockArea = blockSize * blockSize;
  const count     = Math.floor((totalArea * dropoutAmount) / blockArea);

  if (count < 1) {
    // Nothing to draw
    return null;
  }

  // Build MVG commands
  const lines = [
    'push graphic-context',
    `viewbox 0 0 ${w} ${h}`,
    'fill white',
    'stroke none'
  ];

  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * (w - blockSize));
    const y = Math.floor(Math.random() * (h - blockSize));
    lines.push(`rectangle ${x},${y} ${x + blockSize - 1},${y + blockSize - 1}`);
  }

  lines.push('pop graphic-context');

  // Write MVG to temp file
  const mvgPath = path.join(
    os.tmpdir(),
    `mvg_dropout_${Date.now()}_${Math.random().toString().slice(2)}.mvg`
  );
  fs.writeFileSync(mvgPath, lines.join('\n'), 'utf8');
  return mvgPath;
}

// ──────────────────────────────────────────────────────────────────────────────
// Section: Main Effect Function
/**
 * applyDropoutEffect()
 * Applies the random‐blocks dropout effect (for a subset of batch items).
 *
 * @param {string} cur               Current PNG filepath
 * @param {string} name              Base name for output
 * @param {string} tmpDir            Temp directory (e.g. os.tmpdir())
 * @param {string} IM                ImageMagick CLI command
 * @param {number} dropoutAmount     Fraction of area to cover (0–1)
 * @param {number} dropoutSize       Block size in px (floats <1 → 1px)
 * @param {number} dropoutBatchPerc  Fraction of images in batch to affect (0–1)
 * @returns {string}                 Path to resulting PNG (or original if skipped)
 */
export function applyDropoutEffect(
  cur, name, tmpDir, IM,
  dropoutAmount, dropoutSize, dropoutBatchPerc
) {
  // 1) Decide whether this image gets the effect
  if (dropoutBatchPerc < 1 && Math.random() > dropoutBatchPerc) {
    return cur;
  }

  // 2) Get image dimensions
  const [w, h] = execFileSync(
    IM,
    ['identify', '-format', '%w %h', cur],
    { encoding: 'utf8' }
  ).trim().split(' ').map(Number);

  // 3) Create MVG script
  const mvgFile = createMVG(w, h, dropoutAmount, dropoutSize);
  if (!mvgFile) {
    // No blocks needed
    return cur;
  }

  // 4) Apply MVG overlay
  const outPath = path.join(tmpDir, `${name}_rb.png`);
  execFileSync(IM, [cur, '-draw', `@${mvgFile}`, outPath], { stdio: 'inherit' });

  // 5) Cleanup temp files
  fs.unlinkSync(cur);
  fs.unlinkSync(mvgFile);

  // 6) Return new image path
  return outPath;
}
