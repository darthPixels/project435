// File: randomData/xmlPath_config.js
// Defines how to populate each XML path from feeder files or constants.
// Each entry maps an xmlPath (key) to a config object:
//  • type: 'default' | 'distribution' | 'regex' | 'custom' | 'date' | 'dateRelative'
//  • dataFile: feeder XML filename (if applicable)
//  • dataTag: tag name to pull from inside the feeder
//  • dataPar: array of attribute names or '#text' for inner text
//  • filter: optional (rec, context) → boolean
//  • pdfFields: array of PDF field names to populate (empty → skip output)

import { randomRecord, weightedRecord } from './randomDataHelpers.js';
import { faker } from '@faker-js/faker';

const sectionConfig = {

  // ------------------ Ethnicity_Distribution -----------------
  Ethnicity_Distribution: {
    type:      'distribution',
    dataFile:  'ethnicity_CA_BC.xml',
    dataTag:   'Ethnicity',
    weightPar: 'weight',
    dataPar:   ['code'],
    pdfFields: []
  },

  // ------------------ P2D_FormType8 -----------------
  P2D_FormType8: {
    type:      'default',
    value:     '1',
    dataPar:   [],
    pdfFields: ['P2D Form Type 8']
  },

  // ------------------ P2D_FormType11 -----------------
  P2D_FormType11: {
    type:      'default',
    value:     '0',
    dataPar:   [],
    pdfFields: ['P2D Form Type 11']
  },

  // ------------------ Claim_DateOfService -----------------
  Claim_DateOfService: {
    type:          'dateRelative',
    relativeTo:    'Inj_IncidentFromDateTime',
    offsetMinDays: 1,
    offsetMaxDays: 7,
    format:        'YYYY-MM-DD',
    pdfFields: [
      'Date Of Service YYYY',
      'Date Of Service MM',
      'Date Of Service DD'
    ]
  },

  // ------------------ Wrkr_DateOfBirth -----------------
  Wrkr_DateOfBirth: {
    type:           'date',
    start:          '1960-01-01',
    endOffsetYears: -18,
    format:         'YYYY-MM-DD',
    pdfFields: [
      'Date Of Birth YYYY',
      'Date Of Birth MM',
      'Date Of Birth DD'
    ]
  },

  // ------------------ Claim_Number -----------------
  Claim_Number: {
    type:      'regex',
    regex:     '^\\d{8}$',
    pdfFields: ['Claim Number']
  },

  // ------------------ Emp_EmployerAccountName -----------------
  Emp_EmployerAccountName: {
    type:      'default',
    dataFile:  'companies_CA_BC.xml',
    dataTag:   'Company',
    dataPar:   ['#text','city'],
    pdfFields: ['Employers Name']
  },

  // ------------------ Wrkr_LastName -----------------
  Wrkr_LastName: {
    type:      'default',
    dataFile:  'lastNames_CA_BC.xml',
    dataTag:   'LastName',
    filter:    (rec, context) => rec.origin.toLowerCase() === context.Ethnicity_Distribution.toLowerCase(),
    dataPar:   ['#text'],
    pdfFields: ['Worker Last Name']
  },

  // ------------------ Emp_PhoneAreaCode -----------------
  Emp_PhoneAreaCode: {
    type:      'default',
    dataFile:  'locations_CA_BC.xml',
    dataTag:   'Location',
    filter:    (rec, context) => rec.city === context.Emp_EmployerAccountName_rec.city,
    dataPar:   ['areaCode'],
    pdfFields: ['Employer Area Code']
  },

  // ------------------ Emp_PhonePrefix -----------------
  Emp_PhonePrefix: {
    type:      'regex',
    regex:     '^[2-9]\\d{2}$',  // Canadian NANP NXX
    pdfFields: ['Employer Prefix']
  },

  // ------------------ Emp_PhoneNumber -----------------
  Emp_PhoneNumber: {
    type:      'regex',
    regex:     '^\\d{4}$',
    pdfFields: ['Employer Phone Number']
  },

  // ------------------ Wrkr_FirstName -----------------
  Wrkr_FirstName: {
    type:      'default',
    dataFile:  'firstNames_CA_BC.xml',
    dataTag:   'FirstName',
    filter:    (rec, context) => rec.origin.toLowerCase() === context.Ethnicity_Distribution.toLowerCase(),
    dataPar:   ['#text'],
    pdfFields: ['Worker First Name']
  },

  // ------------------ Wrkr_MiddleInitials -----------------
  Wrkr_MiddleInitials: {
    type:      'regex',
    regex:     '^[A-Z]$',
    pdfFields: ['Worker Middle Initial']
  },

  // ------------------ Wrkr_Gender -----------------
  Wrkr_Gender: {
    type:      'default',
    dataFile:  'firstNames_CA_BC.xml',
    dataTag:   'FirstName',
    filter:    (rec, context) => rec['#text'] === context.Wrkr_FirstName,
    dataPar:   ['gender'],
    pdfFields: ['Worker Gender']
  },

  // ------------------ Emp_AddressLine1 -----------------
  Emp_AddressLine1: {
    type: 'custom',
    generator: (context) => {
      // Pick a random street name
      const rec = randomRecord('streetNames_CA_BC.xml','Street');
      // Feeder may return a string or object
      const street = typeof rec === 'string' ? rec : rec.Street;
      // Generate a realistic street number (100 to 9999)
      const number = faker.number.int({ min: 100, max: 9999 });
      return `${number} ${street}`;
    },
    pdfFields: ['Employer Address 1']
  },

  // ------------------ Wrkr_AddressLine1 -----------------
  Wrkr_AddressLine1: {
    type: 'custom',
    generator: (context) => {
      let street;
      do {
        const rec = randomRecord('streetNames_CA_BC.xml','Street');
        street = typeof rec === 'string' ? rec : rec.Street;
      } while (street === context.Emp_AddressLine1); // Different from employer's street
      const number = faker.number.int({ min: 100, max: 9999 });  // realistic street numbers
      return `${number} ${street}`;
    },
    pdfFields: ['Worker Address 1']
  },

  // ------------------ Emp_AddressLine2 -----------------
  Emp_AddressLine2: {
    type: 'custom',
    generator: (context) => {
      // Fetch the location based on Emp_PhoneAreaCode, if not found, fall back to any location
      const rec = randomRecord(
        'locations_CA_BC.xml', 'Location',
        r => r.areaCode === context.Emp_PhoneAreaCode
      ) || randomRecord('locations_CA_BC.xml', 'Location'); // Fallback to any record if not found
      return `${rec.city}, BC ${rec.postal}, Canada`;
    },
    pdfFields: ['Employer Address 2']
  },
  
// ------------------ Wrkr_AddressLine2 -----------------
Wrkr_AddressLine2: {
  type: 'custom',
  generator: (context) => {
    // Pick a random location from locations_CA_BC.xml
    const rec = randomRecord('locations_CA_BC.xml', 'Location');
    
    // Log the random record and the area code assignment
    console.log("Random Record fetched:", rec);
    
    // Assign Wrkr_AreaCode to context, and ensure it's always a string
    context.Wrkr_AreaCode = String(rec.areaCode);  // Forcefully convert to string
    console.log("Assigned Wrkr_AreaCode in AddressLine2:", context.Wrkr_AreaCode);  // Debugging line
    
    return `${rec.city}, BC ${rec.postal}, Canada`;
  },
  pdfFields: ['Worker Address 2']
},

  // ------------------ Inj_IncidentFromDateTime -----------------
  Inj_IncidentFromDateTime: {
    type:          'dateRelative',
    relativeTo:    'now',
    offsetMinDays: -90,
    offsetMaxDays: 0,
    format:        'YYYY-MM-DD',
    pdfFields: [
      'Date Of Injury YYYY',
      'Date Of Injury MM',
      'Date Of Injury DD'
    ]
  },

  // ------------------ Wrkr_AreaCode -----------------
  Wrkr_AreaCode: {
    type: 'custom',
    generator: (context) => {
      // Pull what AddressLine2 already put on context
      let areaCode = context.Wrkr_AreaCode;
      console.log("Wrkr_AreaCode (before returning):", areaCode);
  
      // If it's null/undefined, fall back to empty string
      if (areaCode == null) {
        console.error("Wrkr_AreaCode is null or undefined—returning empty string.");
        return '';
      }
  
      // Return as a string
      return String(areaCode);
    },
    pdfFields: ['Worker Area Code']
  },

  // ------------------ Wrkr_Number -----------------
  Wrkr_Number: {
    type:      'regex',
    regex:     '^\\d{3}$',
    pdfFields: ['Worker Phone Number']
  },

  // ------------------ Wrkr_Extension -----------------
  Wrkr_Extension: {
    type:      'regex',
    regex:     '^\\d{4}$',
    pdfFields: ['Worker Phone Extension']
  },

  // ------------------ Wrkr_PersonalHealthNumber -----------------
  Wrkr_PersonalHealthNumber: {
    type:      'regex',
    regex:     '^\\d{10}$',
    pdfFields: ['Worker Personal Health Number']
  },

  // ------------------ Claim_LostTimeIndicator -----------------
  Claim_LostTimeIndicator: {
    type:      'regex',
    regex:     '^[01]$',
    pdfFields: ['Lost Time Indicator']
  },

  // ------------------ Rptm_PeriodStartDatetime -----------------
  Rptm_PeriodStartDatetime: {
    type:          'dateRelative',
    relativeTo:    'Inj_IncidentFromDateTime',
    offsetMinDays: 0,
    offsetMaxDays: 7,
    format:        'YYYY-MM-DD',
    condition:     () => context.Claim_LostTimeIndicator === '0',
    pdfFields: [
      'Report Period Start YYYY',
      'Report Period Start MM',
      'Report Period Start DD'
    ]
  },

  // ------------------ Inj_DiagnosisText -----------------
  Inj_DiagnosisText: {
    type:      'default',
    dataFile:  'diagnoses_CA_BC.xml',
    dataTag:   'Case',
    dataPar:   ['Diagnosis'],
    pdfFields: ['Diagnosis Text']
  },

  // ------------------ Claim_IncidentDescriptionText -----------------
  Claim_IncidentDescriptionText: {
    type:      'default',
    dataFile:  'diagnoses_CA_BC.xml',
    dataTag:   'Case',
    filter:    (rec, context) => rec.Diagnosis === context.Inj_DiagnosisText,
    dataPar:   ['IncidentDescription'],
    pdfFields: ['Incident Description']
  },

  // ------------------ Rptm_ReportedTimePeriodTypeCode -----------------
  Rptm_ReportedTimePeriodTypeCode: {
    type:      'regex',
    regex:     '^[0-4]$',
    pdfFields: ['Report Period Type Code']
  },

  // ------------------ Med_ConsultNurseAdvisorIndicator -----------------
  Med_ConsultNurseAdvisorIndicator: {
    type:      'regex',
    regex:     '^[01]$',
    pdfFields: ['Wish To Consult Yes','Wish To Consult No']
  },

  // ------------------ P2D_MaximalRecoveryDate -----------------
  P2D_MaximalRecoveryDate: {
    type:          'dateRelative',
    relativeTo:    'Rptm_PeriodStartDatetime',
    offsetMinDays: 0,
    offsetMaxDays: 180,
    format:        'YYYY-MM-DD',
    pdfFields: ['Recovery Date']
  },

  // ------------------ Prvdr_PractitionerNumber -----------------
  Prvdr_PractitionerNumber: {
    type:      'regex',
    regex:     '^\\d{5}$',
    pdfFields: ['Practitioner Number']
  },

  // ------------------ Prvdr_RawName -----------------
  Prvdr_RawName: {
    type:      'default',
    dataFile:  'practitioners_CA_BC.xml',
    dataTag:   'Practitioner',
    dataPar:   ['#text'],
    pdfFields: ['Practitioner Full Name']
  },

  // ------------------ Prvdr_FirstName -----------------
  Prvdr_FirstName: {
    type:      'custom',
    generator: () => { /* as before */ },
    pdfFields: ['Practitioner First Name']
  },

  // ------------------ Prvdr_LastName -----------------
  Prvdr_LastName: {
    type: 'custom',
    generator: (context) => {
      // Return the entire provider name as last name
      return context.Prvdr_RawName; // Assuming Prvdr_RawName is a full name
    },
    pdfFields: ['Practitioner Last Name']
  }
};

export default sectionConfig;
