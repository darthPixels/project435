// File: randomData/randomDataHelpers.js
// ──────────────────────────────────────────────────────────────────────────────
// Provides `randomRecord` & `weightedRecord` for use in xmlPath_config.js

import fs               from 'fs';
import path             from 'path';
import { fileURLToPath }from 'url';
import { XMLParser }    from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const dataDir    = path.resolve(__dirname, 'data');
const parser     = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '',
  ignoreDeclaration:   true
});

// Load every XML feeder once
const feeders = {};
fs.readdirSync(dataDir)
  .filter(f => f.endsWith('.xml'))
  .forEach(f => {
    feeders[f] = parser.parse(
      fs.readFileSync(path.join(dataDir, f), 'utf-8')
    );
  });

/**
 * Pick a random record from a feeder file, optionally filtered.
 * @param {string} dataFile  - filename in dataDir (e.g. 'streetNames_CA_BC.xml')
 * @param {string} dataTag   - XML tag inside that file ('Street', 'Location', etc.)
 * @param {function} [filter] - optional (rec, context) => boolean
 */
export function randomRecord(dataFile, dataTag, filter) {
  const wrap = feeders[dataFile];
  if (!wrap) throw new Error(`Feeder not found: ${dataFile}`);
  const rootKey = Object.keys(wrap)[0];
  let list = wrap[rootKey][dataTag];
  if (!Array.isArray(list)) list = [list];
  if (filter) list = list.filter(rec => filter(rec, global.__rndCtx__ || {}));
  if (!list.length) throw new Error(`No records for ${dataTag} in ${dataFile}`);
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Pick a weighted random record based on a numeric attribute.
 * @param {string} dataFile
 * @param {string} dataTag
 * @param {string} weightPar   - attribute name holding the weight
 * @param {function} [filter]
 */
export function weightedRecord(dataFile, dataTag, weightPar, filter) {
  const wrap = feeders[dataFile];
  if (!wrap) throw new Error(`Feeder not found: ${dataFile}`);
  const rootKey = Object.keys(wrap)[0];
  let list = wrap[rootKey][dataTag];
  if (!Array.isArray(list)) list = [list];
  if (filter) list = list.filter(rec => filter(rec, global.__rndCtx__ || {}));
  if (!list.length) throw new Error(`No records for ${dataTag} in ${dataFile}`);
  const weights = list.map(r => parseFloat(r[weightPar] || 1));
  const total   = weights.reduce((s,w)=>s+w,0);
  let rnd = Math.random()*total;
  for (let i=0; i<list.length; i++) {
    rnd -= weights[i];
    if (rnd <= 0) return list[i];
  }
  return list[list.length-1];
}
