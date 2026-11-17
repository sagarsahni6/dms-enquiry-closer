/**
 * Pure ES module for parsing CSV/Excel enquiry batches, auto-detecting column
 * mappings, merging defaults with per-row overrides, and exporting CSV reports.
 */

export const FIELD_DEFS = [
  {
    key: 'enquiryNo',
    label: 'Enquiry#',
    required: true,
    aliases: [
      'enquiry#',
      'enquiry #',
      'enquiry no',
      'enquiry no.',
      'enquiry number',
      'enquiry id',
      'enquiryid',
      'enquiry',
      'opty no',
      'opportunity #'
    ]
  },
  {
    key: 'followupDone',
    label: 'Followup Done',
    required: false,
    aliases: [
      'followup done',
      'follow-up done',
      'follow up done',
      'hmcl_followup_done',
      'followup'
    ]
  },
  {
    key: 'enquiryStatus',
    label: 'Enquiry Status',
    required: false,
    aliases: [
      'enquiry status',
      'status',
      'close status',
      'target status',
      'new status'
    ]
  },
  {
    key: 'reason',
    label: 'Reason',
    required: false,
    aliases: [
      'reason',
      'close out reason',
      'closeout reason',
      'closing reason',
      'hhml_closeout_reason'
    ]
  },
  {
    key: 'subReason',
    label: 'Close Out Sub Reason',
    required: false,
    aliases: [
      'close out sub reason',
      'closeout sub reason',
      'sub reason',
      'sub-reason',
      'subreason',
      'hhml_closeout_sub_reason'
    ]
  },
  {
    key: 'subReason2',
    label: 'Close Out Sub Reason2',
    required: false,
    aliases: [
      'close out sub reason2',
      'close out sub reason 2',
      'sub reason2',
      'sub reason 2',
      'hhml_closeout_sub_reason2'
    ]
  },
  {
    key: 'nextFollowupDate',
    label: 'Next Follow-Up Date',
    required: false,
    aliases: [
      'next follow-up date',
      'next followup date',
      'next follow up date',
      'followup date',
      'follow-up date',
      'due date',
      'due'
    ]
  },
  {
    key: 'makeBought',
    label: 'Make Bought',
    required: false,
    aliases: [
      'make bought',
      'name of make bought by customer',
      'make',
      'competitor make',
      'hhml_make_bought'
    ]
  },
  {
    key: 'model',
    label: 'Model',
    required: false,
    aliases: [
      'model',
      'competitor model',
      'model bought',
      'hhml_model'
    ]
  },
  {
    key: 'remarks',
    label: 'Remarks',
    required: false,
    aliases: [
      'remarks',
      'remark',
      'comment',
      'comments',
      'notes'
    ]
  },
  {
    key: 'followupAction',
    label: 'Follow-Up Action',
    required: false,
    aliases: [
      'follow-up action',
      'followup action',
      'follow up action',
      'action'
    ]
  }
];

export const DEFAULT_CONFIG = {
  forceClose: true,
  followupDone: 'CONNECTED',
  enquiryStatus: 'Closed',
  reason: 'Bought Competitor',
  subReason: 'Honda Shine',
  subReason2: '',
  nextFollowupDate: 'TODAY',
  makeBought: '',
  model: '',
  remarks: 'Closed by automation',
  followupAction: '',
  oppOrderType: '',
  oppAge: '',
  oppGender: '',
  oppExistingVehicle: '',
  oppPointOfContact: '',
  oppExpectedPurchaseDate: '',
  autoPickEmptyOppCombos: false,
  skipIfClosed: true,
  deduplicate: true,
  dryRun: true,
  stepDelayMs: 250,
  aiEnabled: false,
  aiAutonomousFill: true,
  nimApiKey: '',
  nimBaseUrl: 'https://integrate.api.nvidia.com/v1',
  nimModel: 'nvidia/nemotron-3-nano-30b-a3b',
  aiMaxRetries: 3,
  aiDealerHint: ''
};

/**
 * Resolves a date specification ("TODAY", "+Nd", or explicit "DD/MM/YYYY") into DD/MM/YYYY.
 */
export function resolveDateValue(spec, now = new Date()) {
  const raw = String(spec ?? '').trim();
  if (!raw) return '';

  let targetDate = null;
  if (/^today$/i.test(raw)) {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else {
    const offsetMatch = raw.match(/^\+(\d+)\s*d?$/i);
    if (offsetMatch) {
      const days = Number(offsetMatch[1]);
      targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    }
  }

  if (targetDate) {
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const yyyy = targetDate.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  return raw;
}

/**
 * Normalizes a header string for alias matching.
 */
export function normalizeHeader(header) {
  return String(header ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ');
}

/**
 * Parses RFC-4180 CSV text into a 2D array of trimmed strings.
 */
export function parseCsvText(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

/**
 * Parses an uploaded CSV/XLSX/XLS ArrayBuffer into headers + row objects.
 * @param {ArrayBuffer|Uint8Array} data
 * @param {string} fileName
 * @param {object} [xlsxLib] Optional SheetJS global/module reference
 */
export function parseWorkbookRows(data, fileName = '', xlsxLib = null) {
  const lower = String(fileName).toLowerCase();
  let matrix = [];
  let sheetNames = [];

  if (lower.endsWith('.csv') || (!xlsxLib && !lower.endsWith('.xlsx') && !lower.endsWith('.xls'))) {
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(data instanceof Uint8Array ? data : new Uint8Array(data));
    matrix = parseCsvText(text);
    sheetNames = ['CSV'];
  } else {
    if (!xlsxLib) {
      throw new Error('Excel parser library (XLSX) is not loaded.');
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const workbook = xlsxLib.read(bytes, { type: 'array' });
    sheetNames = workbook.SheetNames || [];
    const firstSheetName = sheetNames.find((name) => {
      const ws = workbook.Sheets[name];
      return ws && ws['!ref'];
    });
    if (!firstSheetName) {
      return { headers: [], records: [], sheetNames };
    }
    const sheet = workbook.Sheets[firstSheetName];
    matrix = xlsxLib.utils
      .sheet_to_json(sheet, { header: 1, defval: '', blankrows: false, raw: false })
      .map((r) => r.map((v) => String(v ?? '').trim()))
      .filter((r) => r.some((v) => v !== ''));
  }

  if (matrix.length === 0) {
    return { headers: [], records: [], sheetNames };
  }

  const rawHeaders = matrix[0];
  const headers = rawHeaders.map((h, idx) => (h ? String(h).trim() : `Column ${idx + 1}`));
  const records = matrix.slice(1).map((cells, rowIdx) => {
    const obj = { __rowNumber: rowIdx + 2 };
    headers.forEach((h, colIdx) => {
      obj[h] = String(cells[colIdx] ?? '').trim();
    });
    return obj;
  });

  return { headers, records, sheetNames };
}

/**
 * Automatically maps spreadsheet headers to canonical enquiry closing fields.
 */
export function autoDetectMapping(headers) {
  const mapping = {};
  const normalizedMap = new Map();
  headers.forEach((h) => {
    normalizedMap.set(normalizeHeader(h), h);
  });

  for (const field of FIELD_DEFS) {
    let matched = '';
    for (const alias of field.aliases) {
      const hit = normalizedMap.get(normalizeHeader(alias));
      if (hit) {
        matched = hit;
        break;
      }
    }
    mapping[field.key] = matched;
  }
  return mapping;
}

/**
 * Builds the executable enquiry closing queue by applying column mapping,
 * merging defaults with per-row overrides, and filtering blank/duplicate rows.
 */
export function buildBatchQueue(records, mapping, defaults = {}, options = {}) {
  const { deduplicate = true } = options;
  const seen = new Set();
  const items = [];
  let skippedEmpty = 0;
  let skippedDuplicates = 0;

  const enquiryHeader = mapping?.enquiryNo;
  if (!enquiryHeader) {
    return { items: [], skippedEmpty: records.length, skippedDuplicates: 0 };
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const enquiryNo = String(rec[enquiryHeader] ?? '').trim();
    if (!enquiryNo) {
      skippedEmpty++;
      continue;
    }

    const dedupeKey = enquiryNo.toUpperCase();
    if (deduplicate && seen.has(dedupeKey)) {
      skippedDuplicates++;
      continue;
    }
    seen.add(dedupeKey);

    const merged = {
      id: `${i + 1}-${enquiryNo}`,
      sourceRow: rec.__rowNumber ?? i + 2,
      enquiryNo
    };

    for (const field of FIELD_DEFS) {
      if (field.key === 'enquiryNo') continue;
      const mappedCol = mapping[field.key];
      const cellVal = mappedCol ? String(rec[mappedCol] ?? '').trim() : '';
      const defVal = String(defaults[field.key] ?? '').trim();
      merged[field.key] = cellVal || defVal;
    }

    items.push(merged);
  }

  return { items, skippedEmpty, skippedDuplicates };
}

/**
 * Escapes a single CSV field according to RFC 4180.
 */
export function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates a downloadable CSV report of processed enquiry rows.
 */
export function buildResultsCsv(rows) {
  const headers = [
    'Source Row',
    'Enquiry#',
    'Result',
    'Previous Status',
    'New Status',
    'Followup Done',
    'Enquiry Status',
    'Reason',
    'Close Out Sub Reason',
    'Close Out Sub Reason2',
    'Next Follow-Up Date',
    'Make Bought',
    'Model',
    'Remarks',
    'Message',
    'Timestamp',
    'AI Recovered',
    'AI Changes',
    'AI Diagnosis'
  ];

  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.sourceRow ?? '',
        r.enquiryNo ?? '',
        r.status ?? 'PENDING',
        r.previousStatus ?? '',
        r.newStatus ?? '',
        r.followupDone ?? '',
        r.enquiryStatus ?? '',
        r.reason ?? '',
        r.subReason ?? '',
        r.subReason2 ?? '',
        r.nextFollowupDate ?? '',
        r.makeBought ?? '',
        r.model ?? '',
        r.remarks ?? '',
        r.message ?? '',
        r.timestamp ?? '',
        r.aiRecovered ? 'YES' : 'NO',
        r.aiChanges ?? '',
        r.aiDiagnosis ?? ''
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return lines.join('\r\n');
}

/**
 * Generates a sample input CSV template matching the user's closing fields.
 */
export function buildSampleCsv(defaults = {}) {
  const headers = [
    'Enquiry#',
    'Followup Done',
    'Enquiry Status',
    'Reason',
    'Close Out Sub Reason',
    'Remarks'
  ];
  const sampleRow = [
    '11365-01-SENQ-0526-1486',
    defaults.followupDone || 'CONNECTED',
    defaults.enquiryStatus || '',
    defaults.reason || '',
    defaults.subReason || '',
    defaults.remarks || ''
  ];
  return [
    headers.map(escapeCsvCell).join(','),
    sampleRow.map(escapeCsvCell).join(',')
  ].join('\r\n');
}
