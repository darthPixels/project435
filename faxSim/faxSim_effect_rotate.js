import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * applyRotateEffect
 *
 * Rotates the entire page by a small random angle, without changing
 * output resolution or format. Controlled via INI flags.
 *
 * @param {string} cur              - Path to current image
 * @param {string} name             - Base name for temp files
 * @param {string} tmpDir           - Directory for intermediates
 * @param {string} IM               - ImageMagick binary path
 * @param {boolean} applyRotate     - Whether to enable rotation
 * @param {number} rotateBatchPerc  - Fraction of pages to rotate (0–1)
 * @param {number} rotateMin        - Minimum rotation angle (degrees)
 * @param {number} rotateMax        - Maximum rotation angle (degrees)
 * @returns {string}                - Path to (possibly) rotated image
 */
export function applyRotateEffect(
  cur,
  name,
  tmpDir,
  IM,
  applyRotate,
  rotateBatchPerc,
  rotateMin,
  rotateMax
) {
  // skip rotation if disabled or by batch percentage
  if (!applyRotate || Math.random() > rotateBatchPerc) {
    return cur;
  }

  // read page dimensions
  const [w, h] = execFileSync(
    IM,
    ['identify', '-format', '%w %h', cur],
    { encoding: 'utf8' }
  )
    .trim()
    .split(' ')
    .map(Number);

  // pick random angle in [rotateMin, rotateMax]
  const angle = rotateMin + Math.random() * (rotateMax - rotateMin);

  // output path
  const outPath = path.join(tmpDir, `${name}_rotated.png`);

  // rotate around center, keep same canvas size and background
  execFileSync(
    IM,
    [
      cur,
      '-background', 'white',
      '-virtual-pixel', 'background',
      '-distort', 'SRT', `${angle}`,
      '-gravity', 'center',
      '-extent', `${w}x${h}`,
      outPath
    ],
    { stdio: 'inherit' }
  );

  // remove old file and return new
  fs.unlinkSync(cur);
  return outPath;
}
