// faxSim_effect_brightness.js — Brightness effect module
//
// Applies one of several brightness adjustments to
// the current PNG before alpha stripping. Controlled
// via opts.brightnessOption = 'overlay' | 'modulate' | 'level'.
// Depends on ImageMagick CLI at opts.IM.
//
// Params:
//   cur              — path to input PNG
//   name             — base filename (no extension)
//   tmpDir           — temp directory for outputs
//   IM               — path to magick.exe
//   brightnessMin    — numeric parameter (percent or level low)
//   brightnessMax    — numeric upper bound for random overlay
//   brightnessOption — 'overlay' (default), 'modulate', or 'level'
//
// Returns: path to the new image file
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

export function applyBrightness({
  cur,
  name,
  tmpDir,
  IM,
  brightnessMin,
  brightnessMax,
  brightnessOption = 'overlay'
}) {
  const tmp = path.join(tmpDir, `${name}_bright.png`);

  if (brightnessOption === 'modulate') {
    // Section: -modulate <brightness>% preserves midtones
    // brightnessMin here is percent increase (e.g. 20 → 120%)
    const modValue = 100 + Number(brightnessMin);
    execFileSync(IM, [ cur, '-modulate', String(modValue), tmp ], { stdio: 'inherit' });
  }
  else if (brightnessOption === 'level') {
    // Section: -level adjusts black/white points
    // brightnessMin = black point %, brightnessMax = white point %
    const low = Number(brightnessMin);
    const high = Number(brightnessMax);
    execFileSync(IM, [ cur, '-level', `${low}%`,` ${high}%`, tmp ], { stdio: 'inherit' });
  }
  else {
    // Section: overlay white rectangle with random opacity
    // as before, brightnessMin..brightnessMax percent
    // get image dimensions
    const dims = execFileSync(IM, ['identify','-format','%w %h', cur], { encoding:'utf8' })
      .trim();
    const [w, h] = dims.split(' ').map(Number);
    const opacity = Math.floor(Math.random() * (brightnessMax - brightnessMin + 1))
      + Number(brightnessMin);
    execFileSync(IM, [
      cur,
      '(',
        '-size', `${w}x${h}`,
        'xc:white',
        '-alpha','set',
        '-channel','A',
        '-evaluate','set', `${opacity}%`,
        '+channel',
      ')',
      '-compose','Over',
      '-composite',
      tmp
    ], { stdio: 'inherit' });
  }

  // cleanup original and return new path
  fs.unlinkSync(cur);
  return tmp;
}
