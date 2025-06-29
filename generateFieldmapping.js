/*
====================================================
  generateFieldmapping.js
----------------------------------------------------
  Description:
  - This script parses all PDF form templates located in the /templates directory
  - Extracts field names, determines field types, and calculates on-page positions (center coordinates)
  - Outputs visually ordered XML mappings to /data/fieldmapping_*.xml
  
  Important:
  - PDFs must be optimized with Acrobat:
    Acrobat → File Menu → Save As Other → Optimized PDF → Settings: Standard → OK
  - This ensures compatibility with pdf-lib and exposes field positions for processing

  Output:
  - XML with formatted <Mapping pdfField="" xmlPath="" type="" /> entries
  - The visual order is determined top-down, left-right
  - Dummy XML paths are assigned and must be adjusted manually if meaningful XML data is required
  - Field ordering may be wrong if layout splits across columns/rows—check template visually

  Dependencies:
  - pdf-lib
  - fs/promises
  - path

  Folder Structure:
  ./templates/                  // Input directory for form PDFs
  ./data/                       // Output directory for generated XMLs
  ./generateFieldmapping.js     // This script
====================================================
*/

// [1] ─── Import Dependencies ───────────────────────────────────────────────
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument, PDFNumber, PDFName, PDFArray } from 'pdf-lib';

// [2] ─── Define Input and Output Directories ───────────────────────────────
const templatesDir = path.resolve('./templates');
const outputDir = path.resolve('./data');

// [3] ─── Utility: Convert to camelCase ─────────────────────────────────────
function toCamelCase(str) {
  return str
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
      index === 0 ? word.toLowerCase() : word.toUpperCase()
    )
    .replace(/\s+/g, '');
}

// [4] ─── Utility: Extract Center Coordinates from Rect ─────────────────────
function getRectCoordinates(rect) {
  if (!(rect instanceof PDFArray) || rect.size() !== 4) return null;
  const [x1, y1, x2, y2] = [0, 1, 2, 3].map(i => {
    const n = rect.get(i);
    return n instanceof PDFNumber ? n.asNumber() : 0;
  });
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

// [5] ─── Main PDF Processing Function ──────────────────────────────────────
async function processPDF(filePath, fileName) {
  const rawData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(rawData);
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  const mappingMap = new Map();
  const positions = [];
  const seenRadioGroups = new Set();

  // [5.1] Loop over fields and classify them
  for (const field of fields) {
    const name = field.getName();
    const type = field.constructor.name;
    const simplifiedType =
      type === 'PDFTextField' ? 'text'
      : type === 'PDFCheckBox' ? 'checkbox'
      : type === 'PDFRadioGroup' ? 'radiobutton'
      : type === 'PDFSignature' ? 'signature'
      : 'unknown';

    const acroField = field.acroField;
    const widgets = acroField?.getWidgets?.() ?? [];

    // [5.2] Handle radiobuttons and grouped checkboxes (multiple widgets)
    if (simplifiedType === 'radiobutton' || (simplifiedType === 'checkbox' && widgets.length > 1)) {
      if (seenRadioGroups.has(name)) continue;
      seenRadioGroups.add(name);

      for (let i = 0; i < widgets.length; i++) {
        const xmlPath = `${toCamelCase(name)}_${i}`;
        const key = `${name}__${i}`;
        mappingMap.set(key, { pdfField: name, xmlPath, type: 'radiobutton' });

        const rawRect = widgets[i]?.dict?.get(PDFName.of('Rect'));
        const center = getRectCoordinates(rawRect);
        if (center) {
          positions.push({ key, name, x: center[0], y: center[1] });
        }
      }
    } else {
      // [5.3] Handle all other fields (text, checkbox, signature)
      const xmlPath = toCamelCase(name);
      const key = `${name}`;
      mappingMap.set(key, { pdfField: name, xmlPath, type: simplifiedType });

      const rawRect = acroField?.dict?.get(PDFName.of('Rect'));
      const center = getRectCoordinates(rawRect);
      if (center) {
        positions.push({ key, name, x: center[0], y: center[1] });
      }
    }
  }

  // [6] ─── Sort by visual order: Top-down, left-right ──────────────────────
  const sorted = positions.sort((a, b) => b.y - a.y || a.x - b.x);

  // [7] ─── Build XML Output ────────────────────────────────────────────────
  const padding = (s, len) => (s + ' '.repeat(len)).slice(0, len);
  const col1 = Math.max(...Array.from(mappingMap.values()).map(m => m.pdfField.length), 12);
  const col2 = Math.max(...Array.from(mappingMap.values()).map(m => m.xmlPath.length), 10);

  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Mappings>'
  ];

  sorted.forEach(pos => {
    const match = mappingMap.get(pos.key);
    if (match) {
      const line = `  <Mapping pdfField="${padding(match.pdfField, col1)}" xmlPath="${padding(match.xmlPath, col2)}" type="${match.type}" />`;
      xmlLines.push(line);
    } else {
      console.warn('⚠️ No mapping found for:', pos);
    }
  });

  xmlLines.push('</Mappings>');

  const outName = 'fieldmapping_' + fileName.replace(/^template_/, '').replace(/\.pdf$/, '.xml');
  const outPath = path.join(outputDir, outName);

  await fs.writeFile(outPath, xmlLines.join('\n'), 'utf-8');
  console.log(`✅ Created: ${outName}`);

  // [8] ─── Log Visual Field Order for Debug ────────────────────────────────
  console.log('\n📌 Field visual sequence (top-down, left-right):');
  sorted.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name} @ (${Math.round(p.x)}, ${Math.round(p.y)})`);
  });
}

// [9] ─── Main Routine: Process all PDFs in /templates ─────────────────────
async function main() {
  const files = await fs.readdir(templatesDir);
  const pdfs = files.filter(f => f.endsWith('.pdf'));

  for (const pdfFile of pdfs) {
    const fullPath = path.join(templatesDir, pdfFile);
    await processPDF(fullPath, pdfFile);
  }
}

main().catch(err => console.error('❌ Error:', err));
