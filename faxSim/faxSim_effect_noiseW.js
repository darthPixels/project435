// Filename: faxSim_effect_noiseW.js
// ──────────────────────────────────────────────────────────────────────────────
// Draws exact-density white speckles via MVG points.
//
// Usage:
//   import { applyNoiseWEffect } from './faxSim_effect_noiseW.js';
//   cur = applyNoiseWEffect(cur, name, tmpDir, IM,
//                            cfg.noiseWBatchPerc, cfg.noiseWDensity);
// ──────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

function createSpeckleMVG(w, h, density, color) {
  const total = w * h;
  const count = Math.floor(total * density);
  if (count < 1) return null;
  const lines = [
    'push graphic-context',
    `viewbox 0 0 ${w} ${h}`,
    `fill ${color}`,
    'stroke none'
  ];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    lines.push(`point ${x},${y}`);
  }
  lines.push('pop graphic-context');
  const mvg = path.join(
    os.tmpdir(),
    `noiseW_${Date.now()}_${Math.random().toString().slice(2)}.mvg`
  );
  fs.writeFileSync(mvg, lines.join('\n'));
  return mvg;
}

export function applyNoiseWEffect(
  cur, name, tmpDir, IM,
  batchPerc, density
) {
  if (batchPerc < 1 && Math.random() > batchPerc) return cur;
  const [w,h] = execFileSync(IM,
    ['identify','-format','%w %h',cur],{encoding:'utf8'}
  ).trim().split(' ').map(Number);
  const mvg = createSpeckleMVG(w,h,density,'white');
  if (!mvg) return cur;
  const out = path.join(tmpDir, `${name}_noiseW.png`);
  execFileSync(IM, [cur,'-draw',`@${mvg}`,out],{stdio:'inherit'});
  fs.unlinkSync(cur); fs.unlinkSync(mvg);
  return out;
}
