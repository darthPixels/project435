#!/usr/bin/env node
/**
 * faxSim.js
 *
 * Main script for the faxSim PDF → TIFF pipeline with optional effects and debug snapshots.
 * Includes new Warp (pinch/stretch) effect module and “Stripes” (formerly NoiseB) effect,
 * plus a new “White Stripes” effect.
 *
 * Workflow:
 *  1) Render each PDF page to a temporary PNG
 *  2) Apply warp (pinch/stretch) distortion
 *  3) Apply small rotation distortion
 *  3b) Insert “White Stripes” effect (white)
 *  4) Strip alpha channel and flatten to white background
 *  5) Convert to grayscale
 *  6) Apply optional Gaussian blur
 *  7) Insert “Stripes” effect (black)
 *  8) Rasterization to ordered dither
 *  9) Error-diffusion dither
 * 10) White-speckle noise effect
 * 11) Optional standalone raster effect
 * 12) Final threshold before 1-bit
 * 13) Dropout effect
 * 14) Tile-shift effect
 * 15) Compress to Group4 TIFF
 * 16) Cleanup intermediate files
 *
 * Dependencies:
 *  - Node.js built-ins: fs, os, path, url, child_process
 *  - ImageMagick (magick.exe) at vendor/imagemagick/
 *  - Effect modules:
 *      faxSim_effect_rotate.js
 *      faxSim_effect_warp.js
 *      faxSim_effect_dropout.js
 *      faxSim_effect_tileshift.js
 *      faxSim_effect_noiseW.js
 *      faxSim_effect_stripes.js
 *      faxSim_effect_stripesW.js    // new White Stripes effect
 *      faxSim_effect_raster.js
 *
 * Usage:
 *   $ node faxSim.js
 *
 * Configuration:
 *   See faxSim.ini for flags and parameters, including:
 *     - debugExcludeEffects = comma‐list of effect keys to skip in debug
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

// Effect modules
import { applyRotateEffect }    from './faxSim_effect_rotate.js';
import { applyWarpEffect }      from './faxSim_effect_warp.js';
import { applyDropoutEffect }   from './faxSim_effect_dropout.js';
import { applyTileshiftEffect } from './faxSim_effect_tileshift.js';
import { applyNoiseWEffect }    from './faxSim_effect_noiseW.js';
import { applyStripesEffect }   from './faxSim_effect_stripes.js';
import { applyStripesWEffect }  from './faxSim_effect_stripesW.js';  // new import
import { applyRasterEffect }    from './faxSim_effect_raster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ------------------------
// Simple INI parser: reads key=value pairs, skips comments/sections
function parseIniFile(filepath) {
  const cfg = {};
  for (let line of fs.readFileSync(filepath, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('#') || line.startsWith('[')) continue;
    const [k, ...rest] = line.split('=');
    const key = k.trim();
    let val = rest.join('=').split(';')[0].trim();
    if (/^(true|false)$/i.test(val))      cfg[key] = val.toLowerCase() === 'true';
    else if (!isNaN(val))                 cfg[key] = Number(val);
    else                                   cfg[key] = val;
  }
  return cfg;
}

const cfg = parseIniFile(path.join(__dirname, 'faxSim.ini'));
console.log('parsed INI:', cfg);

// parse comma-separated list of effects to skip in debug (lowercase keys)
const debugSkip = String(cfg.debugExcludeEffects || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// ImageMagick executable and directories
const IM     = path.join(__dirname, '..', 'vendor', 'imagemagick', 'magick.exe');
const srcDir = path.join(__dirname, '..', 'output', 'pdf');
const dstDir = path.join(__dirname, '..','output', 'tiff');
if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

// ------------------------
// Debug setup: enable logging and snapshots if debugPipeline=true
let DEBUG_PIPELINE = cfg.debugPipeline === true;
// Only debug first PDF
let isFirstPdf   = true;
let currentDebug = false;

const debugDir = path.join(dstDir, 'debugPic');
if (DEBUG_PIPELINE && !fs.existsSync(debugDir)) {
  fs.mkdirSync(debugDir, { recursive: true });
}

function dbgLog(stage, msg) {
  if (currentDebug) console.log(`[DEBUG][${stage}] ${msg}`);
}
function dbgSnap(stage, curPath, name) {
  if (!currentDebug) return;
  const snap = path.join(debugDir, `${name}_${stage}.png`);
  fs.copyFileSync(curPath, snap);
  console.log(`[DEBUG][${stage}] snapshot → ${snap}`);
}

// ------------------------
// Main pipeline: process each PDF in srcDir
;(async () => {
  for (const file of fs.readdirSync(srcDir)) {
    if (path.extname(file).toLowerCase() !== '.pdf') continue;

    // Determine if we debug this run (only true for first PDF)
    currentDebug = DEBUG_PIPELINE && isFirstPdf;
    const isDebugRun = currentDebug;

    const name   = path.parse(file).name;
    const input  = path.join(srcDir, file);
    let cur      = path.join(os.tmpdir(), `${name}_base.png`);
    const output = path.join(dstDir, `${name}.tif`);

    // 1) Render PDF page to PNG at configured resolution
    dbgLog('render', `${IM} -density ${cfg.renderResolution} ${input} ${cur}`);
    execFileSync(IM, ['-density', String(cfg.renderResolution), input, cur], { stdio: 'inherit' });
    dbgSnap('render', cur, name);

    // 2) Warp: pinch/stretch distortion
    {
      const key = 'warp';
      const applyWarp = cfg.applyWarp && (!isDebugRun || !debugSkip.includes(key));
      const warpPerc  = isDebugRun ? 1 : cfg.warpBatchPerc;
      if (applyWarp && Math.random() < warpPerc) {
        const offsetPx = isDebugRun
          ? cfg.warpOffsetPx
          : (cfg.warpOffsetMinPx + Math.random() * (cfg.warpOffsetMaxPx - cfg.warpOffsetMinPx));
        dbgLog('warp', `offsetPx=${offsetPx}`);
        cur = applyWarpEffect(cur, name, os.tmpdir(), IM, true, 1, offsetPx, cfg.warpFinalScale);
        dbgSnap('warp', cur, name);
      }
    }

    // 3) Optional Rotate: small random skew
    {
      const key = 'rotate';
      const applyRotate = cfg.applyRotate && (!isDebugRun || !debugSkip.includes(key));
      const rotatePerc  = isDebugRun ? 1 : cfg.rotateBatchPerc;
      if (applyRotate && Math.random() < rotatePerc) {
        dbgLog('rotate', `batch=${rotatePerc}, min=${cfg.rotateMin}, max=${cfg.rotateMax}`);
        cur = applyRotateEffect(cur, name, os.tmpdir(), IM, true, rotatePerc, cfg.rotateMin, cfg.rotateMax);
        dbgSnap('rotate', cur, name);

        // Mirror after rotate
        {
          const mkey = 'rotatemirror';
          const applyMirror = cfg.rotateMirror && (!isDebugRun || !debugSkip.includes(mkey));
          const mirrorPerc  = isDebugRun ? 1 : cfg.rotateMirrorBatchPerc;
          if (applyMirror && Math.random() < mirrorPerc) {
            const modes = String(cfg.rotateMirrorArray).split(',').map(m => m.trim()).filter(Boolean);
            const mode  = modes[Math.floor(Math.random() * modes.length)];
            dbgLog('rotateMirror', `mode=${mode}`);
            switch (mode) {
              case 'vertical':            execFileSync(IM, [cur, '-flip', cur], { stdio: 'inherit' }); break;
              case 'horizontal':          execFileSync(IM, [cur, '-flop', cur], { stdio: 'inherit' }); break;
              case 'horizontal+vertical': execFileSync(IM, [cur, '-flip', '-flop', cur], { stdio: 'inherit' }); break;
              case '180':                 execFileSync(IM, [cur, '-rotate', '180', cur], { stdio: 'inherit' }); break;
            }
            dbgSnap('rotateMirror', cur, name);
          }
        }
      }
    }

    // 3b) White Stripes effect (white)
    {
      const key = 'stripesw';
      const applyStripesW = cfg.applyStripesW && (!isDebugRun || !debugSkip.includes(key));
      const stripesWPerc = isDebugRun ? 1 : cfg.stripesWBatchPerc;
      if (applyStripesW && Math.random() < stripesWPerc) {
        dbgLog(
          'stripesW',
          `amount=${cfg.stripesWAmount}, dir=${cfg.stripesWDir}, ` +
          `thickMin=${cfg.stripesWThickMin}, thickMax=${cfg.stripesWThickMax}, ` +
          `spacingMin=${cfg.stripesWSpacingMin}, spacingMax=${cfg.stripesWSpacingMax}, ` +
          `distortSize=${cfg.stripesWDistortSize}, distort=${cfg.stripesWDistort}`
        );
        cur = await applyStripesWEffect(
          cur, name, os.tmpdir(), IM,
          1,
          cfg.stripesWAmount,
          cfg.stripesWThickMin,
          cfg.stripesWThickMax,
          cfg.stripesWSpacingMin,
          cfg.stripesWSpacingMax,
          cfg.stripesWDir,
          cfg.stripesWDistortSize,   // noise particle size
          cfg.stripesWDistort        // erosion probability
        );
        // Only snapshot the final stripesW.png on the first PDF debug run
        if (currentDebug) {
          dbgSnap('stripesW', cur, name);
        }
      }
    }

    // 4) Strip alpha channel and flatten
    {
      const key = 'alpha';
      const applyAlpha = cfg.applyAlpha && (!isDebugRun || !debugSkip.includes(key));
      if (applyAlpha) {
        dbgLog('alpha', `${IM} ${cur} -alpha remove -alpha off -background white -flatten ${cur}`);
        execFileSync(IM, [cur, '-alpha', 'remove', '-alpha', 'off', '-background', 'white', '-flatten', cur], { stdio: 'inherit' });
        dbgSnap('alpha', cur, name);
      }
    }

    // 5) Convert to grayscale
    {
      const key = 'gray';
      const applyGray = cfg.applyGray && (!isDebugRun || !debugSkip.includes(key));
      if (applyGray) {
        dbgLog('gray', `${IM} ${cur} -colorspace gray ${cur}`);
        execFileSync(IM, [cur, '-colorspace', 'gray', cur], { stdio: 'inherit' });
        dbgSnap('gray', cur, name);
      }
    }

    // 6) Gaussian blur
    {
      const key = 'blur';
      const doBlur   = cfg.applyBlur && (!isDebugRun || !debugSkip.includes(key));
      const blurPerc = isDebugRun ? 1 : cfg.blurRadBatchPerc;
      if (doBlur) {
        let radius = cfg.blurRadius;
        if (!isDebugRun && Math.random() < blurPerc) {
          radius = cfg.blurRadMin + Math.random() * (cfg.blurRadMax - cfg.blurRadMin);
        }
        dbgLog('blur', `${IM} ${cur} -blind 0x${radius} ${cur}`);
        execFileSync(IM, [cur, '-blur', `0x${radius}`, cur], { stdio: 'inherit' });
        dbgSnap('blur', cur, name);
      }
    }

    // 7) Stripes effect (black)
    {
      const key = 'stripes';
      const applyStripes = cfg.applyStripes && (!isDebugRun || !debugSkip.includes(key));
      const stripePerc   = isDebugRun ? 1 : cfg.stripesBatchPerc;
      if (applyStripes && Math.random() < stripePerc) {
        let density = cfg.stripesDensity;
        if (!isDebugRun && cfg.stripesDensityMin !== undefined && cfg.stripesDensityMax !== undefined) {
          density = cfg.stripesDensityMin + Math.random() * (cfg.stripesDensityMax - cfg.stripesDensityMin);
        }
        dbgLog('stripes', `density=${density}`);
        cur = applyStripesEffect(
          cur, name, os.tmpdir(), IM,
          1,
          cfg.stripesAreasAmount,
          cfg.stripesAreaWidthPx,
          cfg.stripesAreaHeightPx,
          density,
          cfg.applyStripesSmear,
          cfg.stripesSmearLMin,
          cfg.stripesSmearLMax,
          cfg.stripesAreaDir,
          cfg.stripesLineSpacing,
          'black'
        );
        dbgSnap('stripes', cur, name);
      }
    }

    // 8) Rasterization to ordered dither
    {
      const key = 'rasterization';
      const doRaster = cfg.applyRasterization && (!isDebugRun || !debugSkip.includes(key));
      if (doRaster) {
        dbgLog('raster', `${IM} ${cur} +dither -ordered-dither ${cfg.rasterMap} -colors 2 ${cur}`);
        execFileSync(IM, [cur, '+dither', '-ordered-dither', cfg.rasterMap, '-colors', '2', cur], { stdio: 'inherit' });
        dbgSnap('raster', cur, name);
      }
    }

    // 9) Error-diffusion dither
    {
      const key = 'dither';
      const doDither = cfg.applyDither && (!isDebugRun || !debugSkip.includes(key));
      if (doDither) {
        dbgLog('dither', `${IM} ${cur} -dither ${cfg.ditherMethod} -colors ${cfg.ditherColors} ${cur}`);
        execFileSync(IM, [cur, '-dither', cfg.ditherMethod, '-colors', String(cfg.ditherColors), cur], { stdio: 'inherit' });
        dbgSnap('dither', cur, name);
      }
    }

    // 10) White-speckle noise effect
    {
      const key = 'noisew';
      const applyNoiseW = cfg.applyNoiseW && (!isDebugRun || !debugSkip.includes(key));
      const noisePerc   = isDebugRun ? 1 : cfg.noiseWBatchPerc;
      if (applyNoiseW && Math.random() < noisePerc) {
        let density = cfg.noiseWDensity;
        if (!isDebugRun && cfg.noiseWDensityMin !== undefined && cfg.noiseWDensityMax !== undefined) {
          density = cfg.noiseWDensityMin + Math.random() * (cfg.noiseWDensityMax - cfg.noiseWDensityMin);
        }
        dbgLog('noiseW', `density=${density}`);
        cur = applyNoiseWEffect(cur, name, os.tmpdir(), IM, 1, density);
        dbgSnap('noiseW', cur, name);
      }
    }

    // 11) Optional standalone raster effect
    {
      const key = 'rastereffect';
      const applyRaster = cfg.applyRasterEffect && (!isDebugRun || !debugSkip.includes(key));
      const rasterPerc  = isDebugRun ? 1 : cfg.rasterBatchPerc;
      if (applyRaster) {
        dbgLog('rasterEffect', `batch=${rasterPerc}, map=${cfg.rasterMap}`);
        cur = applyRasterEffect(cur, name, os.tmpdir(), IM, rasterPerc, cfg.rasterMap);
        dbgSnap('rasterEffect', cur, name);
      }
    }

    // 12) Final threshold before 1-bit
    {
      const key = 'finalthreshold';
      const doThresh = cfg.applyFinalThreshold && (!isDebugRun || !debugSkip.includes(key));
      if (doThresh) {
        dbgLog('finalThreshold', `${IM} ${cur} -threshold ${cfg.finalThresholdValue}% ${cur}`);
        execFileSync(IM, [cur, '-threshold', `${cfg.finalThresholdValue}%`, cur], { stdio: 'inherit' });
        dbgSnap('finalThreshold', cur, name);
      }
    }

    // 13) Dropout effect
    {
      const key = 'dropout';
      const applyDrop = cfg.applyDropout && (!isDebugRun || !debugSkip.includes(key));
      const dropPerc   = isDebugRun ? 1 : cfg.dropoutBatchPerc;
      if (applyDrop && Math.random() < dropPerc) {
        let amount = cfg.dropoutAmount;
        if (!isDebugRun && cfg.dropoutAmountMin !== undefined && cfg.dropoutAmountMax !== undefined) {
          amount = cfg.dropoutAmountMin + Math.random() * (cfg.dropoutAmountMax - cfg.dropoutAmountMin);
        }
        dbgLog('dropout', `amount=${amount}, size=${cfg.dropoutSize}`);
        cur = applyDropoutEffect(cur, name, os.tmpdir(), IM, amount, cfg.dropoutSize, 1);
        dbgSnap('dropout', cur, name);
      }
    }

    // 14) Tile-shift effect
    {
      const key = 'tileshift';
      const applyTiles = cfg.applyTileshift && (!isDebugRun || !debugSkip.includes(key));
      const tilePerc   = isDebugRun ? 1 : cfg.tileshiftBatchPerc;
      if (applyTiles && Math.random() < tilePerc) {
        let amt = cfg.amountTiles;
        if (!isDebugRun && cfg.amountTilesMin !== undefined && cfg.amountTilesMax !== undefined) {
          amt = cfg.amountTilesMin + Math.floor(Math.random() * (cfg.amountTilesMax - cfg.amountTilesMin + 1));
        }
        dbgLog('tileshift', `amount=${amt}`);
        cur = applyTileshiftEffect(cur, name, os.tmpdir(), IM, 1, amt, cfg.tilesSize, cfg.tilesVariation, cfg.tilesOffsetX, cfg.tilesOffsetY, cfg.offsetVariation);
        dbgSnap('tileshift', cur, name);
      }
    }

    // 15) Compress to Group4 TIFF
    dbgLog('compress', `${IM} ${cur} -monochrome -compress Group4 ${output}`);
    execFileSync(IM, [cur, '-monochrome', '-compress', 'Group4', output], { stdio: 'inherit' });
    if (currentDebug) {
      const snap = path.join(debugDir, `${name}_compress.tif`);
      fs.copyFileSync(output, snap);
      console.log(`[DEBUG][compress] snapshot → ${snap}`);
    }

    // 16) Cleanup intermediate PNG
    dbgLog('cleanup', `unlink ${cur}`);
    fs.unlinkSync(cur);

    console.log(`Converted "${file}" → "${name}.tif"`);

    // After the first PDF, disable debug for subsequent files
    if (isFirstPdf) {
      isFirstPdf   = false;
      currentDebug = false;
    }
  }
})();
