#!/usr/bin/env node
/**
 * generateRandomData.js
 *
 * CLI to generate randomized ClaimRecords XML blocks for Form 8+11.
 *
 * SECTIONS:
 *   1. Imports & Constants      – External modules and constant definitions
 *   2. Helper Functions         – Padding, escaping, and sorting utilities
 *   3. Value Generators         – Logic for each xmlPath_config type
 *   4. CLI Parsing & Seeding    – Parse flags and seed Math.random
 *   5. Template Loading         – Read xml_outputTemplate.xml and extract tags
 *   6. Record Generation Loop   – Build each <ClaimRecord> with values
 *   7. Output Assembly          – Wrap records with <ClaimRecords> and formatting
 *   8. File Writing & Summary   – Write to disk and log completeness
 *
 * USAGE:
 *   node generateRandomData.js -a <n> [-s <seed>] [--outDir <path>]
 *
 * DEPENDENCIES:
 *   • xml_outputTemplate.xml    – blank template with one <ClaimRecord>…</ClaimRecord>
 *   • xmlPath_config.js         – config for each XML tag
 *   • randomDataHelpers.js      – exports randomRecord, weightedRecord
 *   • seedrandom                – seedable Math.random
 *   • randexp                   – regex‑based random string gen
 */

//// 1. Imports & Constants ////////////////////////////////////////
import fs               from 'fs/promises';
import path             from 'path';
import { fileURLToPath }from 'url';
import seedrandom       from 'seedrandom';
import RandExp          from 'randexp';

import xmlPathConfig    from './xmlPath_config.js';
import { randomRecord, weightedRecord } from './randomDataHelpers.js';

// Shim __dirname in ES modules
const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);

// Fields generated internally but not emitted
const helperPaths = ['Ethnicity_Distribution', 'Prvdr_RawName'];

//// 2. Helper Functions ///////////////////////////////////////////
// Zero‑pad numbers to 4 digits for id attribute
function pad4(num) {
  return String(num).padStart(4, '0');
}

// Escape special XML characters in values
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Topo‑sort xmlPath keys by optional dependencies array
function sortByDependencies(cfg) {
  const result = [];
  const state  = {}; // track visiting/visited
  function visit(key, trail = []) {
    if (state[key] === 'visiting') {
      throw new Error(`Circular dependency: ${[...trail, key].join(' → ')}`);
    }
    if (!state[key]) {
      state[key] = 'visiting';
      for (const dep of cfg[key].dependencies || []) {
        if (cfg[dep]) {
          visit(dep, [...trail, key]);
        } else {
          console.warn(`⚠️ Missing dependency "${dep}" for "${key}"`);
        }
      }
      state[key] = 'visited';
      result.push(key);
    }
  }
  Object.keys(cfg).forEach(k => visit(k));
  return result;
}

//// 3. Value Generators ///////////////////////////////////////////
// Generate a value for a given xmlPath based on its config
function generateValue(xmlPath, cfg, context) {
  let val = '';
  switch (cfg.type) {
    case 'distribution': {
      const rec = weightedRecord(cfg.dataFile, cfg.dataTag, cfg.weightPar, cfg.filter);
      val = rec[cfg.dataPar[0]];
      context[xmlPath] = val;
      context[`${xmlPath}_rec`] = rec;
      break;
    }
    case 'default': {
      if (cfg.dataFile) {
        const rec = randomRecord(cfg.dataFile, cfg.dataTag, cfg.filter);
        val = cfg.dataPar.map(p => rec[p]).join(' ');
        context[xmlPath] = val;
        context[`${xmlPath}_rec`] = rec;
      } else {
        val = (typeof cfg.value === 'function'
          ? cfg.value(context)
          : cfg.value) || '';
        context[xmlPath] = val;
      }
      break;
    }
    case 'regex': {
      val = new RandExp(new RegExp(cfg.regex)).gen();
      context[xmlPath] = val;
      break;
    }
    case 'custom': {
      val = cfg.generator(context);
      context[xmlPath] = val;
      break;
    }
    case 'date': {
      const start = new Date(cfg.start);
      let end;
      if (cfg.end) {
        end = new Date(cfg.end);
      } else if (cfg.endOffsetYears != null) {
        end = new Date();
        end.setFullYear(end.getFullYear() + cfg.endOffsetYears);
      } else {
        end = new Date();
      }
      const t = start.getTime() +
                Math.random() * (end.getTime() - start.getTime());
      val = new Date(t).toISOString().slice(0, 10);
      context[xmlPath] = val;
      break;
    }
    case 'dateRelative': {
      let base = cfg.relativeTo === 'now'
        ? new Date()
        : new Date(context[cfg.relativeTo] || Date.now());
      if (isNaN(base.getTime())) base = new Date();
      const days = Math.floor(
        Math.random() * (cfg.offsetMaxDays - cfg.offsetMinDays + 1)
      ) + cfg.offsetMinDays;
      val = new Date(base.getTime() + days * 86400000)
        .toISOString().slice(0, 10);
      context[xmlPath] = val;
      break;
    }
    default:
      throw new Error(`Unknown type "${cfg.type}" for "${xmlPath}"`);
  }
  return val;
}

//// 4. CLI Parsing & Seeding //////////////////////////////////////
async function main() {
  const argv = process.argv.slice(2);
  let amount = 1, seed, outDir = path.resolve(__dirname, '../resources');

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-a' || a === '--amount') {
      amount = parseInt(argv[++i], 10);
    } else if (a === '-s' || a === '--seed') {
      seed = argv[++i];
    } else if (a === '--outDir') {
      outDir = argv[++i];
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }

  if (seed) seedrandom(seed, { global: true });

  //// 5. Template Loading ////////////////////////////////////////

  // Read entire template
  const raw = await fs.readFile(
    path.join(__dirname, 'xml_outputTemplate.xml'),
    'utf-8'
  );
  // Extract xml declaration if present
  const declMatch = raw.match(/^(<\?xml[\s\S]*?\?>\s*)/);
  const xmlDecl   = declMatch ? declMatch[1].trimEnd() : '';
  // Extract opening <ClaimRecords> tag
  const openMatch = raw.match(/<ClaimRecords[^>]*>/);
  const opening   = openMatch ? openMatch[0] : '<ClaimRecords>';
  // Extract closing tag
  const closeMatch= raw.match(/<\/ClaimRecords>/);
  const closing   = closeMatch ? closeMatch[0] : '</ClaimRecords>';

  //// 6. Record Generation Loop /////////////////////////////////

  const sortedPaths = sortByDependencies(xmlPathConfig);
  const records     = [];

  for (let i = 1; i <= amount; i++) {
    const context = {};
    global.__rndCtx__ = context;

    // Populate every xmlPath into context
    for (const xp of sortedPaths) {
      try {
        generateValue(xp, xmlPathConfig[xp], context);
      } catch (err) {
        console.error(`Error generating ${xp}:`, err);
        context[xp] = '';
      }
    }

    // Build one ClaimRecord string
    let rec = `  <ClaimRecord id="${pad4(i)}">`;
    for (const xp of sortedPaths) {
      if (helperPaths.includes(xp)) continue;
      const v = escapeXml(context[xp] ?? '');
      rec += `\n    <${xp}>${v}</${xp}>`;
    }
    rec += `\n  </ClaimRecord>`;
    records.push(rec);
  }

  //// 7. Output Assembly /////////////////////////////////////////

  // Combine declaration, opening tag, blank line, records, blank line, closing tag
  const outXml = [
    xmlDecl,
    opening,
    '',
    ...records,
    '',
    closing
  ].filter(Boolean).join('\n') + '\n';

  //// 8. File Writing & Summary /////////////////////////////////

  // Ensure output directory exists
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'randomData_form8+11_p1.xml');
  // Write the assembled XML
  await fs.writeFile(outFile, outXml, 'utf-8');

  // Log success and per-field summary
  console.log(`\n✅ Wrote ${amount} record(s) to ${outFile}`);
  console.log('\nField population summary:');
  for (const xp of sortedPaths) {
    if (helperPaths.includes(xp)) continue;
    const missing = records.filter(r => new RegExp(`<${xp}></${xp}>`).test(r)).length;
    console.log(
      missing === 0
        ? `  ✔ ${xp}`
        : `  ✖ ${xp} (${missing}/${amount} missing)`
    );
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
