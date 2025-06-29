#!/usr/bin/env node
/**
 * Multi-field PDF population script (flattened output)
 *
 * Detailed Usage:
 *   node generateTestdata.js [--pdfOnly] [--xmlOnly] [--logs] [--logsD] [-a <amount>]
 *
 * Flags:
 *   --pdfOnly        Generate only PDF output. Skips XML generation.
 *   --xmlOnly        Generate only XML output. Skips PDF generation.
 *   --logs           Enable summary logs (info level).
 *   --logsD          Enable detailed logs (debug level).
 *   -a, --amount     Number of test data files to generate (integer 1–999). Default: 1.
 *
 * Examples:
 *   # Generate both PDF and XML with summary logs for 5 runs
 *   node generateTestdata.js --logs -a 5
 *
 *   # Generate only PDFs (skip XML) with detailed logs for 3 runs
 *   node generateTestdata.js --pdfOnly --logsD -a 3
 *
 *   # Generate only XML (skip PDF) without logs for 2 runs
 *   node generateTestdata.js --xmlOnly -a 2
 *
 * Output Folder Structure (created if missing):
 *   /output
 *     /pdf      ← generated PDF files, named testdata_<ID>_form8+11_p1.pdf
 *     /xml      ← generated XML files, named testdata_<ID>_form8+11_p1.xml
 *   /logs        ← log files (one per run), named testdata_YYYY-MM-DD_HH-MM.log
 */

import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFName } from 'pdf-lib';
import { Parser, Builder } from 'xml2js';
import winston from 'winston';

// Resolve __dirname (since we're in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ---------------------------------------------------------------------------
// SECTION: CLI ARGUMENTS PARSING
// ---------------------------------------------------------------------------
const args    = process.argv.slice(2);
const onlyPdf = args.includes('--xmlOnly');
const onlyXml = args.includes('--pdfOnly');
if (onlyPdf && onlyXml) {
  console.error('Cannot specify both --pdfOnly and --xmlOnly');
  process.exit(1);
}

let logLevel = 'none';
if (args.includes('--logsD')) logLevel = 'debug';
else if (args.includes('--logs')) logLevel = 'info';

let amount = 1;
const amountIndex = args.findIndex(a => a === '-a' || a === '--amount');
if (amountIndex !== -1) {
  const val = args[amountIndex + 1];
  if (!val || isNaN(val) || +val < 1 || +val > 999) {
    console.error('Amount must be an integer between 1 and 999');
    process.exit(1);
  }
  amount = +val;
}

// Ensure the amount can loop through records if fewer records than amount
let totalRecords = 0; // Total records length


// ---------------------------------------------------------------------------
// SECTION: FILE PATHS
// ---------------------------------------------------------------------------
const baseDir         = __dirname;
const mappingPath     = join(baseDir, 'data',     'fieldmapping_8+11_p1.xml');
const xmlDataPath     = join(baseDir, 'resources','randomData_form8+11_p1.xml');
const pdfTemplatePath = join(baseDir, 'templates','template_8+11_p1.pdf');

const outputPdfDir    = join(baseDir, 'output', 'pdf');
const outputXmlDir    = join(baseDir, 'output', 'xml');
const logsDir         = join(baseDir, 'logs');

// ---------------------------------------------------------------------------
// SECTION: PREPARE OUTPUT DIRECTORIES
// ---------------------------------------------------------------------------
fs.mkdirSync(outputPdfDir, { recursive: true });
fs.mkdirSync(outputXmlDir, { recursive: true });
fs.mkdirSync(logsDir,      { recursive: true });

// ---------------------------------------------------------------------------
// SECTION: LOGGER CONFIGURATION
// ---------------------------------------------------------------------------
const now    = new Date();
const year   = now.getFullYear();
const month  = String(now.getMonth() + 1).padStart(2, '0');
const day    = String(now.getDate()).padStart(2, '0');
const hour24 = now.getHours();
const hour   = String(hour24).padStart(2, '0');
const minute = String(now.getMinutes()).padStart(2, '0');
const ampm   = hour24 >= 12 ? 'PM' : 'AM';

const logFileName = `testdata_${year}-${month}-${day}_${hour}-${minute}.log`;
const logFile     = join(logsDir, logFileName);

const { printf } = winston.format;
const logFormat = printf(({ message }) => message);
const transports = [];
if (logLevel !== 'none') {
  transports.push(new winston.transports.File({ filename: logFile }));
  transports.push(new winston.transports.Console());
}
const logger = winston.createLogger({
  level: logLevel === 'debug' ? 'debug' : 'info',
  format: logFormat,
  transports,
});

// ---------------------------------------------------------------------------
// SECTION: TRACKING STRUCTURES
// ---------------------------------------------------------------------------
const success = { textfield: [], checkbox: [], radiobutton: [], signature: [], unknown: [] };
const failed  = { textfield: [], checkbox: [], radiobutton: [], signature: [], unknown: [] };
let firstRunFieldLogs = [];
let generatedPdfs = 0;
let generatedXmls = 0;
// ---------------------------------------------------------------------------
// SECTION: DATE SPLIT & CONCATENATE HELPER
// ---------------------------------------------------------------------------
/**
 * If given multiple xmlPaths, joins their values with “.” (old concat logic).
 * If given a single xmlPath whose value is a dashed date (YYYY‑MM‑DD), splits it
 * and returns the correct segment based on the pdfField name.
 *
 * @param {string[]} paths     – list of XML tag names
 * @param {object}   record    – current ClaimRecord object
 * @param {string}   pdfField  – the PDF field name (used to detect YYYY/MM/DD)
 * @returns {string}           – either the concatenated string or a date part
 */
function resolveDateSplitAndConcat(paths, record, pdfField) {
  // 1) MULTI‑PATH CONCATENATION
  if (paths.length > 1) {
    const vals = paths.map(p => {
      const arr = record[p];
      return Array.isArray(arr) ? arr[0] : '';
    }).filter(v => v !== '');
    return vals.length === paths.length ? vals.join('.') : '';
  }

  // 2) SINGLE‑PATH DATE SPLIT
  const arr = record[paths[0]];
  const raw = Array.isArray(arr) ? arr[0] : '';
  if (!raw.includes('-')) return raw; // not a date, just return it

  const [yyyy, mm, dd] = raw.split('-');
  const key = pdfField.toLowerCase();
  if (key.includes('yyyy')) return yyyy || '';
  if (key.includes('mm'))   return mm   || '';
  if (key.includes('dd'))   return dd   || '';
  return raw;
}


// Global Declaration of running truncated logs only once
let truncatedLogged = new Set();
let fallbackLogged = new Set();

    // -------------------------------------------------------------------------
    // DEBUG: PDF counter initialization
    // -------------------------------------------------------------------------
    let pdfCounter = 0;  // Initialize the PDF counter


// -------------------------------------------------------------------------
// SECTION: MAIN EXECUTION
// -------------------------------------------------------------------------
(async () => {
  let pdfCount = 0;  // Initialize PDF counter to track how many PDFs we have generated

  for (let run = 1; run <= amount; run++) {
    // -------------------------------------------------------------------------
    // 1) LOAD FIELDMAPPING XML AND RANDOM-DATA XML
    // -------------------------------------------------------------------------
    const [mappingXml, dataXml] = await Promise.all([
      fs.promises.readFile(mappingPath, 'utf-8'),
      fs.promises.readFile(xmlDataPath, 'utf-8'),
    ]);

    const parser = new Parser();
    const mappingDoc = await parser.parseStringPromise(mappingXml);
    const dataDoc = await parser.parseStringPromise(dataXml);

    // -------------------------------------------------------------------------
    // 2) SELECT THIS RUN'S RECORD
    // -------------------------------------------------------------------------
    const records = dataDoc.ClaimRecords.ClaimRecord || [];
    if (records.length === 0) {
      logger.error('No records found in the data XML!');
      process.exit(1); // Exit gracefully if no records are found
    }

    // Ensure we properly cycle through the records, ensuring we generate `amount` PDFs
    const totalRecords = records.length;
    const currentRecordIndex = pdfCount % totalRecords;  // Explicitly use pdfCount to cycle

    // Select the current record to use
    const recordDoc = records[currentRecordIndex];  // Cycle through records based on pdfCount
    const recordMeta = recordDoc.$ || {};
    const recordIdRaw = String(run);
    const recordId = recordIdRaw.padStart(4, '0'); // Zero‑pad to three digits

    // Now increment the PDF counter
    pdfCount++;

    // -------------------------------------------------------------------------
    // 3) BUILD A GROUPING OF MAPPINGS BY pdfField
    // -------------------------------------------------------------------------
    const mappings = (mappingDoc.Mappings.Mapping || []).map(m => m.$ || {});
    const groupMap = mappings.reduce((acc, map) => {
      (acc[map.pdfField] = acc[map.pdfField] || []).push(map);
      return acc;
    }, {});

    // -------------------------------------------------------------------------
    // 4) LOAD PDF TEMPLATE AND GET ITS FORM
    // -------------------------------------------------------------------------
    const pdfBytes = await fs.promises.readFile(pdfTemplatePath);
    const pdfDoc   = await PDFDocument.load(pdfBytes);
    const form     = pdfDoc.getForm();

    // -------------------------------------------------------------------------
    // DEBUG: List all field names (first run only, debug mode)
    // -------------------------------------------------------------------------
    if (run === 1 && logLevel === 'debug') {
      const allFields = form.getFields().map(f => f.getName());
      logger.debug('');
      logger.debug('Available PDF field names (first run):');
      allFields.forEach(name => logger.debug(`  • ${name}`));
      logger.debug('');
    }

    // -------------------------------------------------------------------------
    // 5) PREPARE OBJECT FOR XML OUTPUT
    // -------------------------------------------------------------------------
    const valuesObj = {};

    // Build count of how many mappings share each xmlPath
    const radioMappings = mappings.filter(m => m.type === 'radiobutton');
    const xmlPathCounts = radioMappings.reduce((acc, m) => {
      acc[m.xmlPath] = (acc[m.xmlPath] || 0) + 1;
      return acc;
    }, {});
    // Pre-uncheck any multi-option groups (xmlPath used >1×)
    radioMappings.forEach(m => {
      if (xmlPathCounts[m.xmlPath] > 1) {
        try { form.getCheckBox(m.pdfField).uncheck(); }
        catch {}
      }
    });

    // -------------------------------------------------------------------------
    // 6) POPULATE FIELDS IN THE PDF
    // -------------------------------------------------------------------------
    const fieldLogsCurrentRun = [];
    for (const [pdfField, group] of Object.entries(groupMap)) {
      const type     = (group[0].type || 'text').toLowerCase();
      const xmlPaths = group.map(m => m.xmlPath);

    // CASE: 1 PDF field from multiple XML paths (e.g., Practitioner Name)
      if (type === 'text' && group.length > 1 && !pdfField.match(/YYYY|MM|DD/i)) {
        // --- PDF LOGIC: Concatenate values for the single PDF field ---
        const pdfValues = xmlPaths.map(p => {
            const arr = recordDoc[p];
            return Array.isArray(arr) ? arr[0] : '';
        }).filter(v => v); // Filter out empty values to avoid extra spaces
        const outVal = pdfValues.join(' ');

        // --- XML LOGIC: Add EACH path to the XML output object ---
        let allXmlPathsFound = true;
        group.forEach(mapping => {
            const path = mapping.xmlPath;
            if (path) {
                const val = Array.isArray(recordDoc[path]) ? recordDoc[path][0] : '';
                valuesObj[path] = val;
                if (!val) allXmlPathsFound = false;
            }
        });

        // --- Standard PDF field setting logic ---
        let pdfSuccess = false;
        const field = form.getFields().find(f => f.getName() === pdfField);
        if (field) {
            let textToSet = outVal || '';
            if (typeof field.getMaxLength === 'function') {
                const maxLen = field.getMaxLength();
                if (typeof maxLen === 'number' && textToSet.length > maxLen) {
                    textToSet = textToSet.slice(0, maxLen);
                    if (!truncatedLogged.has(pdfField)) truncatedLogged.add(pdfField);
                }
            }
            try {
                field.setText(textToSet);
                pdfSuccess = true;
                success.textfield.push(pdfField);
            } catch (err) {
                failed.textfield.push(pdfField);
            }
        } else {
            failed.textfield.push(pdfField);
        }

        // --- Logging for this special case ---
        fieldLogsCurrentRun.push({
            pdfField: pdfField,
            type: 'textfield (multi-path)', // Note the special type for logs
            xmlPath: xmlPaths.join(', '),
            option: '',
            value: '',
            pdfFound: pdfSuccess,
            xmlFound: allXmlPathsFound,
            error: pdfSuccess ? '' : 'Failed to set multi-path textfield'
        });
      }

    // CASE: TEXTFIELD (concat multi‑path, split date, or raw)
    else if (type === 'text') {
      const xmlPath = xmlPaths[0];
      const fullVal = Array.isArray(recordDoc[xmlPath]) ? recordDoc[xmlPath][0] : '';
      const outVal = resolveDateSplitAndConcat(xmlPaths, recordDoc, pdfField);
      let pdfSuccess = false;
    
      // Find the actual PDF field name
      const fieldNames = form.getFields().map(f => f.getName());
      const normalize = str => str.replace(/[^a-z0-9]/gi, '').toLowerCase();
      let actual = fieldNames.find(n => n === pdfField)
        || fieldNames.find(n => n.trim().toLowerCase() === pdfField.trim().toLowerCase())
        || fieldNames.find(n => normalize(n) === normalize(pdfField));
    
      if (actual) {
        const field = form.getField(actual);
        let textToSet = outVal || '';
    
        // Log the maxLength and check for truncation
        if (typeof field.getMaxLength === 'function') {
          const maxLen = field.getMaxLength();
          // debug for truncation //
          // logger.debug(`Checking maxLength for "${actual}": ${maxLen}`);
    
          // If the text exceeds the max length, truncate it and log truncation once per field
          if (typeof maxLen === 'number' && textToSet.length > maxLen) {
            textToSet = textToSet.slice(0, maxLen);
            // Log truncation only once per field
            if (!truncatedLogged.has(actual)) {
              truncatedLogged.add(actual);  // Log once
            }
          }
        }
    
        try {
          // Attempt to set the text
          field.setText(textToSet);
          pdfSuccess = true;
          success.textfield.push(actual);
        } catch (err) {
          // 2) Fallback slice if setText failed
          const fallback = textToSet.slice(0, 25);
          try {
            field.setText(fallback);
            pdfSuccess = true;
            success.textfield.push(actual);
    
            // Log fallback once per field
            if (!fallbackLogged.has(actual)) {
              debugOnce(`Fallback slice set on "${actual}"`);
              fallbackLogged.add(actual);  // Log once
            }
          } catch {
            failed.textfield.push(actual);
            debugOnce(`✖ FAILED setText on "${actual}": ${err.message}`);
          }
        }
      } else {
        failed.textfield.push(pdfField);
        debugOnce(`✖ no matching field for "${pdfField}"`);
      }
	  
      // Only add to XML object if an xmlPath was actually defined in the mapping   
      if (xmlPath) {
        valuesObj[xmlPath] = fullVal;
      }
      fieldLogsCurrentRun.push({
        pdfField: actual || pdfField,
        type: 'textfield',
        xmlPath,
        option: group[0].option || '',
        value: group[0].value || '',
        pdfFound: pdfSuccess,
        xmlFound: Boolean(fullVal),
        error: pdfSuccess ? '' : 'Failed to set textfield'
      });
    }

    // CASE: RADIOBUTTON (with safety check for missing xmlPath)
      else if (type === 'radiobutton') {
        const m = group[0];
        const xmlPath = m.xmlPath;
        let xmlVal = '';
        let pdfSuccess = false;

        // ** START FIX **
        // Only process for XML if xmlPath exists
        if (xmlPath) {
            const rawArr = recordDoc[xmlPath];
            xmlVal = Array.isArray(rawArr) ? rawArr[0] : '';
            valuesObj[xmlPath] = xmlVal;
        }
        // ** END FIX **

        const count = xmlPathCounts[xmlPath] || 0;
        try {
            const cb = form.getCheckBox(m.pdfField);
            if (count > 1) {
                if (String(m.option) === String(xmlVal)) cb.check();
                else cb.uncheck();
            } else {
                if (String(xmlVal) === '1') cb.check();
                else cb.uncheck();
            }
            pdfSuccess = true;
            success.radiobutton.push(m.pdfField);
        } catch {
            failed.radiobutton.push(m.pdfField);
        }
        
        fieldLogsCurrentRun.push({
            pdfField: m.pdfField,
            type: 'radiobutton',
            xmlPath,
            option: m.option || '',
            value: m.value || '',
            pdfFound: pdfSuccess,
            xmlFound: Boolean(xmlVal),
            error: pdfSuccess ? '' : 'Failed to toggle radiobutton'
        });
      }
  
      // ANY OTHER CASES
      else {
        failed.unknown.push(pdfField);
        group.forEach(m => {
          const rawArr = recordDoc[m.xmlPath];
          const val    = Array.isArray(rawArr) ? rawArr[0] : '';
          valuesObj[m.xmlPath] = val;
          fieldLogsCurrentRun.push({
            pdfField,
            type: 'unknown',
            xmlPath: m.xmlPath,
            option: m.option || '',
            value: m.value || '',
            pdfFound: false,
            xmlFound: Boolean(val),
            error: `Unsupported type="${type}" or group length=${group.length}`
          });
        });
      }
    }
  
    if (run === 1) firstRunFieldLogs = fieldLogsCurrentRun;

    // -------------------------------------------------------------------------
    // 7) FLATTEN PDF (produce flattened output)
    // -------------------------------------------------------------------------
    form.flatten();
    pdfDoc.catalog.delete(PDFName.of('AcroForm'));
    pdfDoc.getPages().forEach(page => {
      page.node.delete(PDFName.of('Annots'));
    });

    // -------------------------------------------------------------------------
    // 8) WRITE OUTPUTS TO DISK (PDF and XML)
    // -------------------------------------------------------------------------
    if (!onlyXml) {
      const pdfOut = join(outputPdfDir, `testdata_${recordId}_form8+11_p1.pdf`);
      const outPdf = await pdfDoc.save();
      await fs.promises.writeFile(pdfOut, outPdf);

    // -------------------------------------------------------------------------
    // DEBUG) PDF COUNTER
    // -------------------------------------------------------------------------
    pdfCounter++;  // Ensure the counter is incremented here
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`PDF written: ${pdfCounter}`);

      generatedPdfs++;
	  
    }
    if (!onlyPdf) {
      const xmlNameRegex = /^[A-Za-z_][A-Za-z0-9._-]*$/;
      const safeValues = {};
      for (const [k, v] of Object.entries(valuesObj)) {
        if (xmlNameRegex.test(k)) safeValues[k] = v;
      }

      // --- START: MANUAL XML BUILDER ---
      // This gives us 100% control over the output format.

      let xmlStr = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xmlStr += '<ClaimRecords>\n';
      xmlStr += `  <ClaimRecord id="${recordId}">\n`;

      // Loop through all data and build the tags manually
      for (const [key, value] of Object.entries(safeValues)) {
          // This ensures value is a string, even if null/undefined
          const strValue = String(value ?? '');

          // This correctly escapes the 5 standard XML special characters.
		  const escapedValue = String(value ?? '')
				.replace(/&/g, '&')
				.replace(/</g, '<')
				.replace(/>/g, '>')
				.replace(/"/g, '"')
				.replace(/'/g, '&apos;');

          // This guarantees the <tag></tag> format for ALL elements.
          xmlStr += `    <${key}>${escapedValue}</${key}>\n`;
      }

      xmlStr += '  </ClaimRecord>\n';
      xmlStr += '</ClaimRecords>\n';
      
      // --- END: MANUAL XML BUILDER ---

      const xmlOut = join(outputXmlDir, `testdata_${recordId}_form8+11_p1.xml`);
      await fs.promises.writeFile(xmlOut, xmlStr, 'utf-8');
      generatedXmls++;
    }
  }

// ---------------------------------------------------------------------------
// PDF COUNTER
// ---------------------------------------------------------------------------
    logger.info(`Total PDFs written: ${pdfCounter}`);

// ---------------------------------------------------------------------------
// SECTION: DETAILED LOGGING (IF DEBUG)
// ---------------------------------------------------------------------------
  if (logLevel === 'debug') {
    const headers = ['PDF fieldname', 'Type', 'XMLpath', 'Option', 'Value', 'PDF', 'XML', 'Error'];
    const rows = firstRunFieldLogs.map(r => [
      r.pdfField,
      r.type,
      r.xmlPath,
      r.option,
      r.value,
      r.pdfFound ? '✔' : '✖',
      r.xmlFound ? '✔' : '✖',
      r.error || '-'
    ]);
    const allRows = [headers, ...rows];
    const colWidths = headers.map((_, i) =>
      Math.max(...allRows.map(row => String(row[i]).length))
    );

    const formatRow = row =>
      row.map((cell, i) => String(cell).padEnd(colWidths[i] + 2)).join('');

    const sep = '-'.repeat(colWidths.reduce((a, w) => a + w + 2, 0));
    logger.debug('');
    logger.debug('Detailed Field-Level Log (First Record Only)');
    logger.debug(sep);
    logger.debug(formatRow(headers));
    logger.debug(sep);
    rows.forEach(row => logger.debug(formatRow(row)));
    logger.debug(sep);
  }

  // ---------------------------------------------------------------------------
  // SECTION: SUMMARY LOGGING (AT END)
  // ---------------------------------------------------------------------------
  if (logLevel !== 'none') {
    const sep = '-'.repeat(80);
    logger.info('');
    logger.info(sep);
    logger.info('Testdata PDF/XML Summary');
    logger.info(`Date: ${year}-${month}-${day}`);
    logger.info(`Time: ${String(hour24).padStart(2,'0')}:${minute} ${ampm}`);
    logger.info(sep);

    const fcw = 16;

    logger.info('Output');
    logger.info(
      'Type'.padEnd(fcw) +
      'PDF'.padEnd(8) +
      'XML'.padEnd(8) +
      'Match'.padEnd(8) +
      'Miss'.padEnd(8) +
      'Failed'
    );
    [
      { key: 'unknown',     label: 'Unknown:'     },
      { key: 'checkbox',    label: 'Checkbox:'    },
      { key: 'radiobutton', label: 'Radiobutton:' },
      { key: 'textfield',   label: 'Textfield:'   },
      { key: 'signature',   label: 'Signature:'   }
    ].forEach(({ key, label }) => {
      const logsForType = firstRunFieldLogs.filter(l => l.type === key);
      const pdfCount   = logsForType.filter(l => l.pdfFound).length;
      const xmlCount   = logsForType.filter(l => l.xmlFound).length;
      const matchCount = logsForType.filter(l => l.pdfFound && l.xmlFound).length;
      const missCount  = logsForType.filter(l => !l.xmlFound && l.pdfFound).length;
      const failCount  = logsForType.filter(l => !l.pdfFound).length;
      logger.info(
        label.padEnd(fcw) +
        String(pdfCount).padEnd(8) +
        String(xmlCount).padEnd(8) +
        String(matchCount).padEnd(8) +
        String(missCount).padEnd(8) +
        String(failCount)
      );
    });
    logger.info(sep);

    logger.info('Files created');
    logger.info(
      'Type'.padEnd(fcw) +
      'Total'.padEnd(8) +
      'Pop.'.padEnd(8) +
      'Unpop.'.padEnd(8) +
      'Failed'
    );
    const failPdfs = amount - generatedPdfs;
    const failXmls = amount - generatedXmls;
    const unpopPdfs = 0;
    const unpopXmls = 0;
    logger.info(
      '/output/pdf/'.padEnd(fcw) +
      String(amount).padEnd(8) +
      String(generatedPdfs).padEnd(8) +
      String(unpopPdfs).padEnd(8) +
      String(failPdfs)
    );
    logger.info(
      '/output/xml/'.padEnd(fcw) +
      String(amount).padEnd(8) +
      String(generatedXmls).padEnd(8) +
      String(unpopXmls).padEnd(8) +
      String(failXmls)
    );
    logger.info(sep);
  }
})();
