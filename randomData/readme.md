# generateRandomData.js README

## Overview

**generateRandomData.js** is a Node.js CLI tool that generates randomized XML data blocks for **Form 8+11** claim records. It produces a file containing N `<ClaimRecord>` entries inside a `<ClaimRecords>` root, each populated from a combination of:

1. **An XML template** (`xml_outputTemplate.xml`)
2. **Field configuration** (`xmlPath_config.js`)
3. **Feeder data**: various XML files under `data/`

---

## Contents

1. [Project Structure](#project-structure)  
2. [How Feeder Files Work](#how-feeder-files-work)  
3. [Field Configuration (`xmlPath_config.js`)](#field-configuration-xmlpath_configjs)  
4. [Helper Module (`randomDataHelpers.js`)](#helper-module-randomdatahelpersjs)  
5. [Script Sections](#script-sections)  
6. [CLI Options & Usage](#cli-options--usage)  
7. [Examples](#examples)  
8. [Detailed Workflow](#detailed-workflow)  

---

## Project Structure

```
root/
├─ randomData/
│   ├─ generateRandomData.js     # Main CLI script
│   ├─ xml_outputTemplate.xml    # Blank template with one <ClaimRecord>
│   ├─ xmlPath_config.js         # Config for each XML tag generator
│   ├─ randomDataHelpers.js      # feeder helpers: randomRecord, weightedRecord
│   └─ data/                     # Feeder XML files:
│       ├─ companies_CA_BC.xml
│       ├─ diagnoses_CA_BC.xml
│       ├─ ethnicity_CA_BC.xml
│       ├─ firstNames_CA_BC.xml
│       ├─ hospitals_CA_BC.xml
│       ├─ lastNames_CA_BC.xml
│       ├─ locations_CA_BC.xml
│       ├─ practitioners_CA_BC.xml
│       └─ streetNames_CA_BC.xml
├─ resources/                    # Default output directory
│   └─ randomData_form8+11_p1.xml
└─ data/
    └─ fieldmapping_8+11_p1.xml  # PDF ↔ XML tag mapping
```

---

## How Feeder Files Work

- Located in `randomData/data/`.
- Each feeder is an XML file with a single root, containing repeated records:
  ```xml
  <Companies>
    <Company name="Coastal Gas Processing" city="Kitimat"/>
    <!-- more <Company> nodes -->
  </Companies>
  ```
- The helper module `randomDataHelpers.js`:
  - **Loads** all feeder XML into memory at startup using `fast-xml-parser`.
  - **randomRecord(dataFile, dataTag, filter)**:
    - Picks a random `<dataTag>` node from `dataFile`.
    - Optionally filters records by `(rec, context) => boolean`.
  - **weightedRecord(dataFile, dataTag, weightParam, filter)**:
    - Picks a record with probability proportional to `parseFloat(rec[weightParam])`.

---

## Field Configuration (`xmlPath_config.js`)

- Exports an object mapping XML tag names (e.g. `Wrkr_LastName`) to config:
  ```js
  Wrkr_LastName: {
    type: 'default',          // generation type
    dataFile: 'lastNames_CA_BC.xml',
    dataTag: 'LastName',
    dataPar: ['surname'],     // which attribute(s) to join
    filter: (rec, ctx) => rec.ethnicity === ctx.Ethnicity_Distribution,
    dependencies: ['Ethnicity_Distribution'],
    pdfFields: ['Worker Last Name']
  }
  ```
- Supported `type` values:
  - **distribution**: use weightedRecord
  - **default**: randomRecord or constant/function value
  - **regex**: `RandExp` generator
  - **custom**: custom JS `(context) => value`
  - **date**: random between dates
  - **dateRelative**: relative date

---

## Helper Module (`randomDataHelpers.js`)

```js
export function randomRecord(dataFile, dataTag, filter) { ... }
export function weightedRecord(dataFile, dataTag, weightParam, filter) { ... }
```

- Feeder files loaded from `path.resolve(__dirname, 'data')`.
- Uses `fast-xml-parser` with:
  ```js
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    ignoreDeclaration: true
  });
  ```

---

## Script Sections

1. **Imports & Constants**  
   External modules and constants (e.g. `helperPaths`).

2. **Helper Functions**  
   - `pad4()`: zero-pad record IDs  
   - `escapeXml()`: sanitize field values  
   - `sortByDependencies()`: topological sort by `dependencies` array  

3. **Value Generators**  
   `generateValue(xmlPath, cfg, context)` handles all `cfg.type` cases.

4. **CLI Parsing & Seeding**  
   Parses `-a/--amount`, `-s/--seed`, `--outDir`; calls `seedrandom()`.

5. **Template Loading**  
   Reads `xml_outputTemplate.xml`, extracts:
   - XML declaration (`<?xml ...?>`)  
   - Opening `<ClaimRecords>` tag  
   - Closing `</ClaimRecords>` tag  

6. **Record Generation Loop**  
   For each record `i`:
   - Initialize `context`  
   - Populate each field via `generateValue`  
   - Build `<ClaimRecord id="000i">` with child tags  

7. **Output Assembly**  
   Joins header, blank line, each record (with blank lines), and footer.

8. **File Writing & Summary**  
   Writes `randomData_form8+11_p1.xml` and logs field completeness.

---

## CLI Options & Usage

```
-a, --amount <n>      # number of records (default: 1)
-s, --seed <string>   # RNG seed (reproducible)
--outDir <path>       # output directory (default: ../resources)
```

---

## Examples

```bash
# 1. Ten random records
node generateRandomData.js -a 10

# 2. Twenty-five seeded records
node generateRandomData.js -a 25 -s blue42

# 3. Output to custom directory
node generateRandomData.js -a 5 --outDir ../myOutputs

# 4. Combined flags
node generateRandomData.js --amount 100 --seed abc123 --outDir /tmp/xmlTest
```

---

## Detailed Workflow

1. **Argument parsing** sets `amount`, optional `seed`, and `outDir`.
2. **Seeding** locks `Math.random` if `-s` provided.
3. **Feeder load** via `randomDataHelpers.js`.
4. **Template parse** slices template into header, record template, and footer.
5. **Dependency sort** orders xmlPaths for correct generation order.
6. **For each record**:
   - `context = {}`  
   - For each `xmlPath` in order: `generateValue()` populates `context[xp]`.  
   - Skip `helperPaths` when emitting.  
   - Build record string with `<Tag>value</Tag>` lines.
7. **Assemble** final XML with correct spacing.
8. **Write** to `${outDir}/randomData_form8+11_p1.xml`.
9. **Log** summary of any empty fields.

---

*End of README*
