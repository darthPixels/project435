# WorkSafeBC Test Data Generator (version 004)

This CLI project automates the creation of synthetic test PDFs and corresponding XML datasets for the WorkSafeBC claims management forms (Form 8+11). It replaces manual paperwork by generating both fillable forms and data payloads for end-to-end testing. fileciteturn0file0

---

## Table of Contents

1. [Project Overview](#project-overview)  
2. [Getting Started](#getting-started)  
3. [Folder & File Structure](#folder--file-structure)  
4. [Dependencies & Installation](#dependencies--installation)  
5. [Usage](#usage)  
6. [Input Specifications](#input-specifications)  
7. [generateFieldmapping.js Workflow](#generatefieldmappingjs-workflow)  
8. [generateTestdata.js Workflow](#generatetestdatajs-workflow)  
9. [Field Mapping Configuration](#field-mapping-configuration)  
10. [Random XML Generator](#random-xml-generator)  
11. [Troubleshooting](#troubleshooting)  
12. [Future Extensions](#future-extensions)  
13. [Contributing](#contributing)  

---

## Project Overview

WorkSafeBC is the provincial workers’ compensation board in British Columbia, Canada. Traditionally, Form 8+11 submissions are scanned and manually keyed into XML by a vendor.  
This tool suite generates synthetic claim records and:

- Fills the official PDF form template via **pdf-lib**  
- Produces matching XML datasets via **xml2js**  
- Outputs both to `/output/pdf/` and `/output/xml/` for AI training and pipeline validation fileciteturn0file0

---

## Getting Started

1. **Clone the repo**  
   ```bash
   git clone <repo-url>
   cd <repo-directory>
   ```
2. **Verify prerequisites** (see next section).  
3. **Install dependencies**:  
   ```bash
   npm install
   ```
4. **Make CLI scripts executable**:
   ```bash
   chmod +x generateTestdata.js generateFieldmapping.js generateXML.js
   ```

---

## Folder & File Structure

```text
/ (project root)
│
├─ AIhelpers/
│  └─ PDFfields.md             # Source-of-truth field list and mapping notes
│
├─ data/
│  └─ fieldmapping_8+11_p1.xml # Field-mapping configuration
│
├─ templates/
│  └─ template_8+11_p1.pdf     # Blank PDF form template
│
├─ resources/
│  ├─ randomData_form8+11_p1.xml # Sample data records
│  └─ fontsHandwriting.xml       # Handwriting font definitions
│
├─ fonts/                       # Handwriting font files
│
├─ output/
│  ├─ pdf/                      # Filled PDF outputs
│  └─ xml/                      # Generated XML outputs
│
├─ generateTestdata.js         # Main data-population CLI
├─ generateFieldmapping.js     # Builds or updates the mapping XML
├─ generateXML.js              # Generates randomData XML file
├─ structure.md                # Auto-generated folder tree
├─ README.md                   # This documentation file
└─ package.json                # Node.js dependencies & scripts
```

---

## Dependencies & Installation

- **Node.js** v16.x or higher  
- **npm** (comes with Node.js)  
- **pdf-lib** (PDF form handling)  
- **xml2js** (XML parsing/building)  

Install packages:

```bash
npm install pdf-lib xml2js winston
```

---

## Usage

```bash
node generateTestdata.js [--pdfOnly] [--xmlOnly] [--logs] [--logsD] [-a | --amount <count>]
```

- `--pdfOnly`  
  Generate only filled PDF files (skips XML generation).  
- `--xmlOnly`  
  Generate only XML files (skips PDF generation).  
- `--logs`  
  Output a concise overview log to console and `logs/`.  
- `--logsD`  
  Produce detailed per-field logs **and** overview (implies `--logs`).  
- `-a, --amount <count>`  
  Number of records to process (1–999). Default: 1.  

**Examples**

- Generate 5 PDFs with summary logs:  
  ```bash
  node generateTestdata.js --amount 5 --logs
  ```
- Generate 3 XMLs only, no logs:  
  ```bash
  node generateTestdata.js --xmlOnly --amount 3
  ```
- Generate 2 PDFs & XMLs with detailed logs:  
  ```bash
  node generateTestdata.js --amount 2 --logs --logsD
  ```

---

## Input Specifications

1. **Field Mapping** (`data/fieldmapping_8+11_p1.xml`)  
   - `<Mapping>` entries with:  
     - `pdfField`: exact AcroForm field name  
     - `xmlPath`: tag(s) in random data XML (comma-separated)  
     - `type`: `text`, `checkbox`, or `radiobutton`  
     - Optional `format` for date fields  

2. **Random Data XML** (`resources/randomData_form8+11_p1.xml`)  
   - Root: `<ClaimRecords>`  
   - Contains one or more `<ClaimRecord id="...">` elements matching `xmlPath` in the mapping  

3. **PDF Template** (`templates/template_8+11_p1.pdf`)  
   - AcroForm PDF with named fields (text, checkboxes, radio buttons)  

---

## generateFieldmapping.js Workflow

> *Generates or updates the field-mapping XML by scanning the PDF’s form fields.*  

1. **Prerequisite:** Optimize the PDF in Acrobat:  
   - Acrobat --> Main menu --> Save as other --> Optimized PDF --> Settings: Standard --> OK 
   - This flattening ensures all AcroForm fields are discoverable by `pdf-lib`.  

2. **Field Extraction & Ordering**  
   - The script reads every form field from `template_8+11_p1.pdf`.  
   - Fields are auto-named `A1`, `A2`, … in visual reading order (left→right, top→bottom).  

3. **Dummy XML Paths**  
   - Each extracted field is assigned a placeholder `xmlPath`.  
   - You must manually update these in `data/fieldmapping_8+11_p1.xml` to match real claim data needs.  

4. **Manual Ordering Cleanup**  
   - In complex layouts (split multi-line fields), auto sequencing may misorder fields.  
   - Review `data/fieldmapping_8+11_p1.xml` and reorder or rename entries to match the PDF layout.  

5. **Output**  
   - Overwrites or writes `data/fieldmapping_8+11_p1.xml` with updated `<Mapping>` entries and attributes.  

You only need to run this when adding/removing PDF fields or changing the template.  

---

## generateTestdata.js Workflow

1. **Initialization**  
   - Parse CLI flags (`--pdfOnly`, `--xmlOnly`, `--logs`, `--logsD`, `--amount`).  
   - Load `data/fieldmapping_8+11_p1.xml` and `resources/randomData_form8+11_p1.xml`.  
   - Preload PDF template via `pdf-lib`.  

2. **Record Loop**  
   - For `run` = 1 to `amount`:  
     - Select the `run`-th `<ClaimRecord>` in the random data XML (warn & stop if out of range).  
     - Clone the blank PDF form.  
     - For each mapping entry:  
       - Extract the value(s) from the current record’s `xmlPath`.  
       - Populate the PDF field (`text` vs. `checkbox`/`radiobutton`).  
       - Track success/failure per field.  

3. **Save Outputs**  
   - Write filled PDF to `output/pdf/testdata_<ID>_form8+11_p1.pdf`.  
   - Build a trimmed XML containing only populated fields, save to `output/xml/testdata_<ID>_form8+11_p1.xml`.  

4. **Logging**  
   - `--logs`: print a concise **Overview** with dates, counts, and file statistics.  
   - `--logsD`: print a detailed per-field **ErrorLog**, then the **Overview**.  

---

## Field Mapping Configuration

- **AIhelpers/PDFfields.md** documents every field name, type, and intended XML path.  
- Use this as your source of truth when editing `data/fieldmapping_8+11_p1.xml`. fileciteturn0file0

---

## Random XML Generator (`generateXML.js`)

- Fills `resources/randomData_form8+11_p1.xml` with synthetic claim records.  
- Ensures each `<ClaimRecord>` matches `xmlPath` entries in your field mapping.  

---

## Troubleshooting

- **Missing file errors**: verify paths under `data/`, `resources/`, `templates/`.  
- **Field not found**: run `generateFieldmapping.js`, then manually adjust XML paths.  
- **Log output empty**: ensure you passed `--logs` or `--logsD`.  
- **Node module errors**: run `npm install`, check Node.js version (`node -v`).  

---

## Future Extensions

- **Signature support**: embed base64 images into signature fields.  
- **Multi-record exports**: emit multiple `<ClaimRecord>` elements in a single run.  
- **Handwritten simulation**: overlay TTF/OTF fonts for realistic handwriting. fileciteturn0file0

---

## Contributing

1. Fork the repo & create a feature branch.  
2. Write tests for new functionality.  
3. Submit a pull request with a clear description.  
4. Ensure README.md and AIhelpers/PDFfields.md are up to date.  

---

© Stefan Denk GmbH – Claims Management CLI App (v004)
