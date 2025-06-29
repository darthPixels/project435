#!/usr/bin/env node
/**
 * Debug script: list all form field names and each widget’s Rect.
 *
 * Usage:
 *   node listFields.js
 *
 * Output:
 *   - For each field: its exact pdf-lib name.
 *   - For each widget of that field: the [x1, y1, x2, y2] rectangle.
 */

import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Resolve __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

(async () => {
  const templatePath = join(__dirname, 'templates', 'template_8+11_p1.pdf');
  if (!fs.existsSync(templatePath)) {
    console.error(`Cannot find template at ${templatePath}`);
    process.exit(1);
  }

  const pdfBytes = await fs.promises.readFile(templatePath);
  const pdfDoc   = await PDFDocument.load(pdfBytes);
  const form     = pdfDoc.getForm();
  const fields   = form.getFields();

  console.log('\n=== LIST OF FORM FIELDS AND WIDGET RECTANGLES ===\n');
  for (const field of fields) {
    const name = field.getName();
    console.log(`Field name: "${name}"`);

    // Access low-level AcroField to enumerate widgets
    const acroField = field.acroField;
    const widgets   = acroField.getWidgets();
    if (!widgets.length) {
      console.log('  (no widgets found)');
      continue;
    }

    for (let i = 0; i < widgets.length; i++) {
      const widget = widgets[i];
      const rectRef = widget.dict.get(PDFName.of('Rect'));
      let rectArr = null;

      if (rectRef && typeof rectRef.asArray === 'function') {
        rectArr = rectRef.asArray().map(num => num.asNumber());
      }
      console.log(`  Widget ${i}: Rect = ${rectArr || 'N/A'}`);
    }
    console.log('');
  }
})();
