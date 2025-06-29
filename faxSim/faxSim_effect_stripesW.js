// ====================================================
// FILE: faxSim_effect_stripesW.js
// SECTION: White Stripes Effect (Sharp-based, corrected noise logic)
// DESCRIPTION:
//   Draws white stripes (random position, thickness, spacing),
//   then “erodes” them by punching per-pixel noise holes so the
//   original content shows through. Pure JS + Sharp.
// DEPENDENCIES:
//   • sharp    (npm install sharp)
//   • fs, path
// PARAMETERS:
//   curPath           – path to the current PNG
//   name              – base filename (for debug snapshots only)
//   tmpdir            – temp directory (unused here)
//   IM                – (ignored here)
//   batchPerc         – batch probability (checked by caller)
//   amount            – # of stripes
//   thickMin, thickMax– min/max stripe thickness (px)
//   spacingMin, spacingMax – min/max gap between stripes (px)
//   dir               – 'horizontal'|'vertical'
//   noiseSize         – blur radius for the noise map (px)
//   distort           – fraction [0..1] of stripe pixels to **erase**
// RETURNS:
//   Promise<string>   – resolves to curPath when done
// ====================================================

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export async function applyStripesWEffect(
  curPath, name, tmpdir, IM,
  batchPerc,
  amount,
  thickMin,
  thickMax,
  spacingMin,
  spacingMax,
  dir,
  noiseSize,
  distort
) {
  // 1) load original
  const img = sharp(curPath);
  const { width, height } = await img.metadata();

  // 2) build stripe mask (1‐byte per pixel: 255=stripe)
  const stripeMask = Buffer.alloc(width * height, 0);
  let offset = Math.floor(Math.random() * (dir === 'horizontal' ? height : width));
  for (let i = 0; i < amount; i++) {
    const thickness = thickMin + Math.floor(Math.random() * (thickMax - thickMin + 1));
    const spacing   = i < amount - 1
      ? spacingMin + Math.floor(Math.random() * (spacingMax - spacingMin + 1))
      : 0;
    offset += spacing;
    const jitter = Math.floor((Math.random() * 2 - 1) * spacing);
    const maxPos = (dir === 'horizontal' ? height : width) - thickness;
    const pos    = Math.max(0, Math.min(maxPos, offset + jitter));

    if (dir === 'horizontal') {
      for (let y = pos; y < pos + thickness; y++) {
        stripeMask.fill(255, y * width, y * width + width);
      }
    } else {
      for (let y = 0; y < height; y++) {
        stripeMask.fill(255, y * width + pos, y * width + pos + thickness);
      }
    }

    offset += thickness;
  }

  // 3) build noise mask: 0=erase, 255=keep
  // 3) build noise mask: random binary → blur → manual threshold
  const noiseRaw = Buffer.alloc(width * height);
  for (let i = 0; i < noiseRaw.length; i++) {
    // start with 0=erase or 255=keep
    noiseRaw[i] = (Math.random() < distort ? 0 : 255);
  }
  // 3a) blur it to create patches roughly noiseSize in diameter
  const blurred = await sharp(noiseRaw, { raw: { width, height, channels: 1 } })
    .blur(noiseSize > 1 ? noiseSize/2 : 1)
    .raw()
    .toBuffer();
  // 3b) threshold in JS so we know it's truly binary
  const thresh = 128; // mid-gray
  const noiseMask = Buffer.alloc(width * height);
  for (let i = 0; i < blurred.length; i++) {
    noiseMask[i] = blurred[i] > thresh ? 255 : 0;
  }

  // 4) AND stripeMask & noiseMask → finalMask
  const finalMask = Buffer.alloc(width * height);
  for (let i = 0; i < finalMask.length; i++) {
    finalMask[i] = (stripeMask[i] === 255 && noiseMask[i] === 255) ? 255 : 0;
  }

  /*/ 5) debug dumps
  const debugDir = path.join('output','tiff','debugPic');
  if (fs.existsSync(debugDir)) {
    await sharp(stripeMask, { raw:{width, height, channels:1} })
      .png({ compressionLevel:9 })
      .toFile(path.join(debugDir, `${name}_stripesW_stripes.png`));
    await sharp(noiseMask,  { raw:{width, height, channels:1} })
      .png({ compressionLevel:9 })
      .toFile(path.join(debugDir, `${name}_stripesW_noise.png`));
    await sharp(finalMask,  { raw:{width, height, channels:1} })
      .png({ compressionLevel:9 })
      .toFile(path.join(debugDir, `${name}_stripesW_final.png`));
  }
  /*/

  // 6) build a white RGBA overlay from finalMask
  const overlay = Buffer.alloc(width * height * 4);
  for (let i = 0; i < finalMask.length; i++) {
    const v = finalMask[i];
    overlay[4*i + 0] = 255;
    overlay[4*i + 1] = 255;
    overlay[4*i + 2] = 255;
    overlay[4*i + 3] = v;
  }

  // 7) composite into a Buffer, then overwrite curPath
  const outputBuffer = await img
    .composite([{
      input: overlay,
      raw:    { width, height, channels: 4 },
      blend:  'over'
    }])
    .png({ compressionLevel:9 })
    .toBuffer();

  await fs.promises.writeFile(curPath, outputBuffer);
  return curPath;
}
