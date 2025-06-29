#!/usr/bin/env node
/**
 * extractCoordinates.js
 *
 * - Reads fieldmapping XML (/data/fieldmapping_8+11_p1.xml) and original template PDF
 *   (/templates/template_8+11_p1.pdf with live form fields).
 * - Extracts each pdfField’s page, x, y, width, and height (including widget children for
 *   radio/checkbox fields).
 * - Writes that result to /data/coordinates_8+11_p1.json.
 * - Then, for testing, reloads the ORIGINAL template (with form fields), sets
 *   the “Wrkr_LastName” field’s value to “Suleiman,” flattens, removes all annotations,
 *   and saves as /output/pdf/coord_test.pdf.
 */

import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray
} from 'pdf-lib';
import { Parser } from 'xml2js';

// Resolve __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Paths
const mappingXmlPath      = join(__dirname, 'data',     'fieldmapping_8+11_p1.xml');
const coordJsonPath       = join(__dirname, 'data',     'coordinates_8+11_p1.json');
const pdfTemplatePath     = join(__dirname, 'templates','template_8+11_p1.pdf');
const pdfFlatTemplatePath = join(__dirname, 'templates','template_8+11_p1_flat.pdf');
const outputPdfDir        = join(__dirname, 'output',   'pdf');

// Ensure /output/pdf exists
fs.mkdirSync(outputPdfDir, { recursive: true });

/**
 * Look for a /Rect (and /P) on the field dictionary itself;
 * if missing, search its /Kids array for a widget with /Rect and /P.
 */
function findRectAndPage(acroDict, pdfDoc) {
  // 1) Direct /Rect + /P
  const directRect = acroDict.get(PDFName.of('Rect'));
  const directPage = acroDict.get(PDFName.of('P'));
  if (
    directRect instanceof PDFArray &&
    directRect.size() >= 4 &&
    directPage
  ) {
    return { rectArray: directRect, pageRef: directPage };
  }

  // 2) Fallback: check /Kids for a widget dict with /Rect and /P
  const kidsEntry = acroDict.get(PDFName.of('Kids'));
  if (kidsEntry instanceof PDFArray) {
    for (const kidRef of kidsEntry.asArray()) {
      const kidDict = pdfDoc.context.lookup(kidRef);
      if (!(kidDict instanceof PDFDict)) continue;
      const kidRect = kidDict.get(PDFName.of('Rect'));
      const kidPage = kidDict.get(PDFName.of('P'));
      if (kidRect instanceof PDFArray && kidRect.size() >= 4 && kidPage) {
        return { rectArray: kidRect, pageRef: kidPage };
      }
    }
  }
  return null;
}

async function extractCoordinates() {
  console.log('⟳ Extracting coordinates from fieldmapping and template PDF...');

  // 1) Read fieldmapping XML
  const mappingXml = await fs.promises.readFile(mappingXmlPath, 'utf-8');
  const parser     = new Parser();
  const mappingDoc = await parser.parseStringPromise(mappingXml);
  const mappingsRaw = (mappingDoc.Mappings.Mapping || []).map(m => m.$ || {});

  // 2) Load the original template with form fields
  const originalBytes = await fs.promises.readFile(pdfTemplatePath);
  const pdfDoc        = await PDFDocument.load(originalBytes);
  const form          = pdfDoc.getForm();
  const fields        = form.getFields(); // array of PDFField objects

  // Build a lookup: fieldName → annotation dictionary
  const fieldDict = {};
  for (const field of fields) {
    const acroDict = field.acroField.dict;
    const nameObj  = acroDict.get(PDFName.of('T'));
    if (!nameObj) continue;
    const fieldName = nameObj.value;
    fieldDict[fieldName] = acroDict;
  }

  // 3) For each <Mapping pdfField=…> entry, find /Rect and /P
  const coordsArray = [];
  for (const m of mappingsRaw) {
    const fname   = m.pdfField;
    const xmlPath = m.xmlPath;
    const type    = (m.type || 'text').toLowerCase();
    const option  = m.option !== undefined
      ? m.option.split(',').map(o => o.trim())
      : undefined;
    const value   = m.value !== undefined
      ? m.value.split(',').map(v => v.trim())
      : undefined;

    const acroDict = fieldDict[fname];
    if (!acroDict) {
      console.warn(`⚠ Field "${fname}" not found in PDF form. Skipping.`);
      continue;
    }

    const found = findRectAndPage(acroDict, pdfDoc);
    if (!found) {
      console.warn(`⚠ No Rect+/P found for "${fname}". Skipping.`);
      continue;
    }

    const { rectArray, pageRef } = found;
    const x1 = rectArray.get(0).asNumber();
    const y1 = rectArray.get(1).asNumber();
    const x2 = rectArray.get(2).asNumber();
    const y2 = rectArray.get(3).asNumber();
    const width  = x2 - x1;
    const height = y2 - y1;

    // Determine page index from pageRef
    const pageIndex = pdfDoc.getPageIndices().find(i =>
      pdfDoc.getPage(i).ref === pageRef
    );
    if (pageIndex === undefined) {
      console.warn(`⚠ Could not determine page for "${fname}". Skipping.`);
      continue;
    }

    coordsArray.push({
      pdfField: fname,
      xmlPath:  xmlPath,
      type:     type,
      option:   option,
      value:    value,
      coords: {
        page:   pageIndex,
        x:      x1,
        y:      y1,
        width:  width,
        height: height
      }
    });
  }

  // 4) Write to JSON
  await fs.promises.writeFile(coordJsonPath, JSON.stringify(coordsArray, null, 2));
  console.log(`✔ Wrote ${coordsArray.length} entries to ${coordJsonPath}`);

  return coordsArray;
}

async function testDrawWithForm() {
  // Load the JSON to confirm we extracted successfully
  const coordsArray = JSON.parse(await fs.promises.readFile(coordJsonPath, 'utf-8'));
  if (!Array.isArray(coordsArray) || coordsArray.length === 0) {
    console.error('✖ No coordinates found—run extractCoordinates() first.');
    return;
  }

  // 1) Reload the ORIGINAL template (with live form fields)
  const originalBytes = await fs.promises.readFile(pdfTemplatePath);
  const pdfDoc        = await PDFDocument.load(originalBytes);
  const form          = pdfDoc.getForm();

  // 2) Locate the “Wrkr_LastName” mapping entry
  const targetEntry = coordsArray.find(e => e.xmlPath === 'Wrkr_LastName');
  if (!targetEntry) {
    console.error('✖ No coords entry for xmlPath="Wrkr_LastName".');
    return;
  }

  // 3) Set the field value to “Suleiman”
  try {
    form.getTextField('Worker Last Name').setText('Suleiman');
  } catch (e) {
    console.error(`✖ Could not set Worker Last Name: ${e.message}`);
    return;
  }

  // 4) Flatten and remove annotations (to drop widget borders but keep text)
  form.flatten();
  pdfDoc.catalog.delete(PDFName.of('AcroForm'));
  pdfDoc.getPages().forEach(page => {
    page.node.delete(PDFName.of('Annots'));
  });

  // 5) Save to /output/pdf/coord_test.pdf
  const outBytes = await pdfDoc.save();
  const outPath  = join(outputPdfDir, 'coord_test.pdf');
  await fs.promises.writeFile(outPath, outBytes);
  console.log(`✔ Wrote “Suleiman” at Worker Last Name → ${outPath}`);
}

(async () => {
  // 1) Always re-extract coordinates
  await extractCoordinates();

  // 2) Then run the form-based test draw
  await testDrawWithForm();
})();
