import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  DEFAULT_CONFIG,
  parseCsvText,
  parseWorkbookRows,
  autoDetectMapping,
  buildBatchQueue,
  buildResultsCsv,
  buildSampleCsv,
  resolveDateValue
} from '../dms-enquiry-closer/lib/batch_parser.js';

test('parseCsvText handles BOM, quoted commas, escaped quotes, and blank lines', () => {
  const csv = [
    '\uFEFF"Enquiry#",Reason,Remarks',
    '11365-01-SENQ-0526-1486,"Price, High","Customer said ""call later"""',
    '  , , ',
    '11365-01-SENQ-0526-1487,Duplicate,Second row'
  ].join('\r\n');

  const rows = parseCsvText(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['Enquiry#', 'Reason', 'Remarks']);
  assert.deepEqual(rows[1], [
    '11365-01-SENQ-0526-1486',
    'Price, High',
    'Customer said "call later"'
  ]);
  assert.deepEqual(rows[2], ['11365-01-SENQ-0526-1487', 'Duplicate', 'Second row']);
});

test('parseWorkbookRows parses XLSX buffer and autoDetectMapping resolves aliases', () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Enquiry Number', 'Follow-Up Done', 'Status', 'Close Out Reason', 'Sub Reason', 'Notes'],
    ['ENQ-001', 'CONNECTED', 'Closed', 'Not Interested', 'Budget Issue', 'Call ok'],
    ['ENQ-002', '', '', '', '', '']
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Enquiries');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const parsed = parseWorkbookRows(buf, 'batch.xlsx', XLSX);
  assert.deepEqual(parsed.headers, [
    'Enquiry Number',
    'Follow-Up Done',
    'Status',
    'Close Out Reason',
    'Sub Reason',
    'Notes'
  ]);
  assert.equal(parsed.records.length, 2);

  const mapping = autoDetectMapping(parsed.headers);
  assert.equal(mapping.enquiryNo, 'Enquiry Number');
  assert.equal(mapping.followupDone, 'Follow-Up Done');
  assert.equal(mapping.enquiryStatus, 'Status');
  assert.equal(mapping.reason, 'Close Out Reason');
  assert.equal(mapping.subReason, 'Sub Reason');
  assert.equal(mapping.remarks, 'Notes');
});

test('buildBatchQueue merges defaults with overrides and deduplicates case-insensitively', () => {
  const records = [
    { __rowNumber: 2, 'Enquiry#': 'ENQ-100', Reason: 'Bought Competitor', Remarks: '' },
    { __rowNumber: 3, 'Enquiry#': 'enq-100', Reason: 'Duplicate', Remarks: 'dup' },
    { __rowNumber: 4, 'Enquiry#': '', Reason: 'Ignored', Remarks: '' },
    { __rowNumber: 5, 'Enquiry#': 'ENQ-101', Reason: '', Remarks: 'Default reason' }
  ];
  const mapping = autoDetectMapping(['Enquiry#', 'Reason', 'Remarks']);
  const defaults = {
    ...DEFAULT_CONFIG,
    followupDone: 'CONNECTED',
    enquiryStatus: 'Closed',
    reason: 'Not Interested',
    subReason: 'Budget Issue'
  };

  const result = buildBatchQueue(records, mapping, defaults, { deduplicate: true });
  assert.equal(result.skippedEmpty, 1);
  assert.equal(result.skippedDuplicates, 1);
  assert.equal(result.items.length, 2);

  assert.equal(result.items[0].enquiryNo, 'ENQ-100');
  assert.equal(result.items[0].followupDone, 'CONNECTED');
  assert.equal(result.items[0].enquiryStatus, 'Closed');
  assert.equal(result.items[0].reason, 'Bought Competitor');
  assert.equal(result.items[0].subReason, 'Budget Issue');

  assert.equal(result.items[1].enquiryNo, 'ENQ-101');
  assert.equal(result.items[1].reason, 'Not Interested');
  assert.equal(result.items[1].remarks, 'Default reason');
});

test('buildResultsCsv and buildSampleCsv produce valid escaped CSV', () => {
  const sample = buildSampleCsv({ followupDone: 'CONNECTED', enquiryStatus: 'Closed' });
  const parsedSample = parseCsvText(sample);
  assert.equal(parsedSample[0][0], 'Enquiry#');
  assert.equal(parsedSample[1][1], 'CONNECTED');
  assert.equal(parsedSample[1][2], 'Closed');

  const report = buildResultsCsv([
    {
      sourceRow: 2,
      enquiryNo: 'ENQ-1',
      status: 'FAILED',
      previousStatus: 'Open',
      newStatus: '',
      message: 'Error: "Reason" required, please select',
      timestamp: '2026-11-11T08:00:00.000Z',
      aiRecovered: true,
      aiChanges: 'Variant: "" -> "Drum"',
      aiDiagnosis: 'Missing required Variant'
    }
  ]);
  const parsedReport = parseCsvText(report);
  assert.equal(parsedReport.length, 2);
  assert.equal(parsedReport[1][1], 'ENQ-1');
  assert.equal(parsedReport[1][2], 'FAILED');
  assert.equal(parsedReport[1][14], 'Error: "Reason" required, please select');
  assert.equal(parsedReport[1][16], 'YES');
  assert.equal(parsedReport[1][17], 'Variant: "" -> "Drum"');
  assert.equal(parsedReport[1][18], 'Missing required Variant');
});

test('resolveDateValue and nextFollowupDate mapping handle TODAY, +Nd, and explicit dates', () => {
  const ref = new Date(2026, 10, 11); // 11 Nov 2026
  assert.equal(resolveDateValue('TODAY', ref), '11/11/2026');
  assert.equal(resolveDateValue('+2d', ref), '13/11/2026');
  assert.equal(resolveDateValue('25/11/2026', ref), '25/11/2026');
  assert.equal(resolveDateValue('', ref), '');

  const mapping = autoDetectMapping(['Enquiry#', 'Next Follow-Up Date']);
  assert.equal(mapping.nextFollowupDate, 'Next Follow-Up Date');
  assert.equal(DEFAULT_CONFIG.nextFollowupDate, 'TODAY');
  assert.equal(DEFAULT_CONFIG.forceClose, true);
  assert.equal(DEFAULT_CONFIG.enquiryStatus, 'Closed');
  assert.equal(DEFAULT_CONFIG.reason, 'Bought Competitor');
  assert.equal(DEFAULT_CONFIG.subReason, 'Honda Shine');
});
