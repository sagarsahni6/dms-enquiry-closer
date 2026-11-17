import {
  FIELD_DEFS,
  DEFAULT_CONFIG,
  parseWorkbookRows,
  autoDetectMapping,
  buildBatchQueue,
  buildResultsCsv,
  buildSampleCsv
} from './lib/batch_parser.js';
import { RETIRED_NIM_MODELS, parseDealerHint } from './lib/nim_client.js';

const STORAGE_KEY = 'heroDmsCloserConfig_v1';

const els = {
  refreshStatusBtn: document.getElementById('refreshStatusBtn'),
  connectionBanner: document.getElementById('connectionBanner'),
  connectionText: document.getElementById('connectionText'),
  downloadSampleBtn: document.getElementById('downloadSampleBtn'),
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  fileLabel: document.getElementById('fileLabel'),
  fileMeta: document.getElementById('fileMeta'),
  mappingDetails: document.getElementById('mappingDetails'),
  mappingGrid: document.getElementById('mappingGrid'),
  defFollowupDone: document.getElementById('defFollowupDone'),
  defEnquiryStatus: document.getElementById('defEnquiryStatus'),
  defReason: document.getElementById('defReason'),
  defSubReason: document.getElementById('defSubReason'),
  defSubReason2: document.getElementById('defSubReason2'),
  defNextFollowupDate: document.getElementById('defNextFollowupDate'),
  defMakeBought: document.getElementById('defMakeBought'),
  defModel: document.getElementById('defModel'),
  defRemarks: document.getElementById('defRemarks'),
  defFollowupAction: document.getElementById('defFollowupAction'),
  oppOrderType: document.getElementById('oppOrderType'),
  oppAge: document.getElementById('oppAge'),
  oppGender: document.getElementById('oppGender'),
  oppExistingVehicle: document.getElementById('oppExistingVehicle'),
  oppPointOfContact: document.getElementById('oppPointOfContact'),
  oppExpectedPurchaseDate: document.getElementById('oppExpectedPurchaseDate'),
  autoPickEmptyOppCombos: document.getElementById('autoPickEmptyOppCombos'),
  stepDelayMs: document.getElementById('stepDelayMs'),
  forceClose: document.getElementById('forceClose'),
  skipIfClosed: document.getElementById('skipIfClosed'),
  deduplicate: document.getElementById('deduplicate'),
  dryRun: document.getElementById('dryRun'),
  aiEnabled: document.getElementById('aiEnabled'),
  aiAutonomousFill: document.getElementById('aiAutonomousFill'),
  aiModeBadge: document.getElementById('aiModeBadge'),
  nimApiKey: document.getElementById('nimApiKey'),
  toggleNimKeyBtn: document.getElementById('toggleNimKeyBtn'),
  nimModel: document.getElementById('nimModel'),
  fetchModelsBtn: document.getElementById('fetchModelsBtn'),
  nimModelList: document.getElementById('nimModelList'),
  nimBaseUrl: document.getElementById('nimBaseUrl'),
  aiMaxRetries: document.getElementById('aiMaxRetries'),
  aiDealerHint: document.getElementById('aiDealerHint'),
  testNimBtn: document.getElementById('testNimBtn'),
  nimTestStatus: document.getElementById('nimTestStatus'),
  scanResultsBox: document.getElementById('scanResultsBox'),
  scanTitle: document.getElementById('scanTitle'),
  scanChips: document.getElementById('scanChips'),
  closeScanBtn: document.getElementById('closeScanBtn'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  stopBtn: document.getElementById('stopBtn'),
  validationAlert: document.getElementById('validationAlert'),
  statTotal: document.getElementById('statTotal'),
  statDone: document.getElementById('statDone'),
  statSkipped: document.getElementById('statSkipped'),
  statFailed: document.getElementById('statFailed'),
  progressFill: document.getElementById('progressFill'),
  queueBody: document.getElementById('queueBody'),
  retryFailedBtn: document.getElementById('retryFailedBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn')
};

const FIELD_INPUT_MAP = {
  followupDone: els.defFollowupDone,
  enquiryStatus: els.defEnquiryStatus,
  reason: els.defReason,
  subReason: els.defSubReason,
  subReason2: els.defSubReason2,
  nextFollowupDate: els.defNextFollowupDate,
  makeBought: els.defMakeBought,
  model: els.defModel,
  remarks: els.defRemarks,
  followupAction: els.defFollowupAction
};

const state = {
  activeTabId: null,
  pageReady: false,
  parsedFile: null, // { fileName, headers, records }
  mapping: {},
  queue: [],
  runState: 'IDLE', // IDLE | RUNNING | PAUSED | STOPPING
  activeScanField: null
};

function showAlert(msg) {
  if (!msg) {
    els.validationAlert.hidden = true;
    els.validationAlert.textContent = '';
    return;
  }
  els.validationAlert.textContent = msg;
  els.validationAlert.hidden = false;
}

function getConfigFromUI() {
  return {
    followupDone: els.defFollowupDone.value.trim(),
    enquiryStatus: els.defEnquiryStatus.value.trim(),
    reason: els.defReason.value.trim(),
    subReason: els.defSubReason.value.trim(),
    subReason2: els.defSubReason2.value.trim(),
    nextFollowupDate: els.defNextFollowupDate.value.trim(),
    makeBought: els.defMakeBought.value.trim(),
    model: els.defModel.value.trim(),
    remarks: els.defRemarks.value.trim(),
    followupAction: els.defFollowupAction.value.trim(),
    oppOrderType: els.oppOrderType.value.trim(),
    oppAge: els.oppAge.value.trim(),
    oppGender: els.oppGender.value.trim(),
    oppExistingVehicle: els.oppExistingVehicle.value.trim(),
    oppPointOfContact: els.oppPointOfContact.value.trim(),
    oppExpectedPurchaseDate: els.oppExpectedPurchaseDate.value.trim(),
    autoPickEmptyOppCombos: els.autoPickEmptyOppCombos.checked,
    forceClose: Boolean(els.forceClose?.checked),
    skipIfClosed: els.skipIfClosed.checked,
    deduplicate: els.deduplicate.checked,
    dryRun: els.dryRun.checked,
    stepDelayMs: Math.max(0, Number(els.stepDelayMs.value || 250)),
    aiEnabled: els.aiEnabled.checked,
    aiAutonomousFill: els.aiAutonomousFill.checked,
    nimApiKey: els.nimApiKey.value.trim(),
    nimBaseUrl: els.nimBaseUrl.value.trim() || DEFAULT_CONFIG.nimBaseUrl,
    nimModel: els.nimModel.value.trim() || DEFAULT_CONFIG.nimModel,
    aiMaxRetries: Math.min(5, Math.max(1, Number(els.aiMaxRetries.value || DEFAULT_CONFIG.aiMaxRetries))),
    aiDealerHint: els.aiDealerHint.value.trim()
  };
}

function updateAiBadge() {
  const on = els.aiEnabled.checked;
  els.aiModeBadge.textContent = on ? 'Active' : 'Off';
  els.aiModeBadge.className = on ? 'ai-pill ai-pill-on' : 'ai-pill';
}

function applyConfigToUI(cfg) {
  const merged = { ...DEFAULT_CONFIG, ...cfg };
  els.defFollowupDone.value = merged.followupDone;
  els.defEnquiryStatus.value = merged.enquiryStatus;
  els.defReason.value = merged.reason;
  els.defSubReason.value = merged.subReason;
  els.defSubReason2.value = merged.subReason2;
  els.defNextFollowupDate.value = merged.nextFollowupDate ?? DEFAULT_CONFIG.nextFollowupDate;
  els.defMakeBought.value = merged.makeBought;
  els.defModel.value = merged.model;
  els.defRemarks.value = merged.remarks;
  els.defFollowupAction.value = merged.followupAction;
  els.oppOrderType.value = merged.oppOrderType || '';
  els.oppAge.value = merged.oppAge || '';
  els.oppGender.value = merged.oppGender || '';
  els.oppExistingVehicle.value = merged.oppExistingVehicle || '';
  els.oppPointOfContact.value = merged.oppPointOfContact || '';
  els.oppExpectedPurchaseDate.value = merged.oppExpectedPurchaseDate || '';
  els.autoPickEmptyOppCombos.checked = Boolean(merged.autoPickEmptyOppCombos);
  els.stepDelayMs.value = String(merged.stepDelayMs);
  if (els.forceClose) els.forceClose.checked = merged.forceClose !== false;
  els.skipIfClosed.checked = Boolean(merged.skipIfClosed);
  els.deduplicate.checked = Boolean(merged.deduplicate);
  els.dryRun.checked = Boolean(merged.dryRun);
  els.aiEnabled.checked = Boolean(merged.aiEnabled);
  els.aiAutonomousFill.checked = merged.aiAutonomousFill !== false;
  els.nimApiKey.value = merged.nimApiKey || '';
  els.nimBaseUrl.value = merged.nimBaseUrl || DEFAULT_CONFIG.nimBaseUrl;
  const savedModel = String(merged.nimModel || '').trim();
  els.nimModel.value =
    !savedModel || RETIRED_NIM_MODELS.has(savedModel) ? DEFAULT_CONFIG.nimModel : savedModel;
  els.aiMaxRetries.value = String(merged.aiMaxRetries ?? DEFAULT_CONFIG.aiMaxRetries);
  els.aiDealerHint.value = merged.aiDealerHint || '';
  updateAiBadge();
  updateRunButtons();
}

async function saveConfig() {
  const cfg = getConfigFromUI();
  await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
}

async function loadSavedConfig() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  applyConfigToUI(res?.[STORAGE_KEY] || DEFAULT_CONFIG);
}

async function getActiveBrowserTab() {
  const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const current = currentTabs[0] || null;
  if (current?.url?.startsWith('https://connect.heromotocorp.biz/')) {
    return current;
  }

  const dmsTabs = await chrome.tabs.query({ url: 'https://connect.heromotocorp.biz/*' });
  if (dmsTabs.length > 0) {
    return dmsTabs.find((t) => t.active) || dmsTabs[0];
  }

  return current;
}

async function checkDmsTabConnection() {
  const tab = await getActiveBrowserTab();
  if (!tab?.id) {
    state.activeTabId = null;
    state.pageReady = false;
    setBanner('err', 'No active browser tab found.');
    updateRunButtons();
    return;
  }

  state.activeTabId = tab.id;
  if (tab.url && !tab.url.startsWith('https://connect.heromotocorp.biz/')) {
    state.pageReady = false;
    setBanner('warn', 'Open Hero Connect DMS tab to connect.');
    updateRunButtons();
    return;
  }

  try {
    const injectRes = await chrome.runtime.sendMessage({
      type: 'ENSURE_TAB_READY',
      tabId: tab.id,
      tabUrl: tab.url
    });
    if (!injectRes?.ok) {
      state.pageReady = false;
      setBanner('warn', injectRes?.error || 'Open Hero Connect DMS tab.');
      updateRunButtons();
      return;
    }

    const checkRes = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_PAGE' });
    state.pageReady = Boolean(checkRes?.ready);
    if (checkRes?.ready) {
      setBanner('ok', 'Connected: Hero DMS Enquiry Calls view ready.');
    } else {
      setBanner('warn', checkRes?.reason || 'Navigate to Enquiry Calls view in DMS.');
    }
  } catch {
    state.pageReady = false;
    setBanner('warn', 'Open Hero Connect DMS Enquiry Calls view.');
  }

  updateRunButtons();
}

function setBanner(kind, text) {
  els.connectionBanner.className = `banner banner-${kind}`;
  els.connectionText.textContent = text;
}

function renderMappingUI(headers) {
  els.mappingGrid.innerHTML = '';
  for (const field of FIELD_DEFS) {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const lbl = document.createElement('label');
    lbl.textContent = field.required ? `${field.label} *` : field.label;

    const sel = document.createElement('select');
    sel.dataset.fieldKey = field.key;

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = field.required ? '-- Select column --' : '(Use default)';
    sel.appendChild(noneOpt);

    for (const h of headers) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      sel.appendChild(opt);
    }

    sel.value = state.mapping[field.key] || '';
    sel.addEventListener('change', () => {
      state.mapping[field.key] = sel.value;
      rebuildQueueFromParsedFile();
    });

    wrap.append(lbl, sel);
    els.mappingGrid.appendChild(wrap);
  }
  els.mappingDetails.hidden = false;
}

function rebuildQueueFromParsedFile() {
  if (!state.parsedFile) return;
  const cfg = getConfigFromUI();
  const { items, skippedEmpty, skippedDuplicates } = buildBatchQueue(
    state.parsedFile.records,
    state.mapping,
    cfg,
    { deduplicate: cfg.deduplicate }
  );

  state.queue = items.map((item) => ({
    ...item,
    status: 'PENDING',
    previousStatus: '',
    newStatus: '',
    message: '',
    aiRecovered: false,
    aiChanges: '',
    aiDiagnosis: '',
    timestamp: ''
  }));

  const parts = [`${items.length} queued`];
  if (skippedDuplicates > 0) parts.push(`${skippedDuplicates} duplicates skipped`);
  if (skippedEmpty > 0) parts.push(`${skippedEmpty} blank skipped`);
  els.fileMeta.textContent = parts.join(' • ');

  if (!state.mapping.enquiryNo) {
    showAlert('Select which column contains Enquiry# under Column Mapping.');
  } else {
    showAlert('');
  }

  renderQueueTable();
  updateRunButtons();
}

async function handleFileSelection(file) {
  if (!file) return;
  showAlert('');
  try {
    const buffer = await file.arrayBuffer();
    const parsed = parseWorkbookRows(buffer, file.name, window.XLSX);
    if (!parsed.headers.length || !parsed.records.length) {
      throw new Error('The selected file has no data rows.');
    }
    state.parsedFile = {
      fileName: file.name,
      headers: parsed.headers,
      records: parsed.records
    };
    state.mapping = autoDetectMapping(parsed.headers);
    els.fileLabel.textContent = file.name;
    renderMappingUI(parsed.headers);
    rebuildQueueFromParsedFile();
  } catch (err) {
    showAlert(err?.message || 'Failed to read file.');
  }
}

function renderQueueTable() {
  const rows = state.queue;
  const total = rows.length;
  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    if (r.status === 'CLOSED' || r.status === 'DRY_RUN_OK') done++;
    else if (r.status === 'SKIPPED') skipped++;
    else if (r.status === 'FAILED') failed++;
  }

  const finished = done + skipped + failed;
  els.statTotal.textContent = String(total);
  els.statDone.textContent = String(done);
  els.statSkipped.textContent = String(skipped);
  els.statFailed.textContent = String(failed);
  els.progressFill.style.width = total > 0 ? `${Math.round((finished / total) * 100)}%` : '0%';

  els.queueBody.innerHTML = '';
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty-cell';
    td.textContent = 'Upload a CSV or Excel file to begin.';
    tr.appendChild(td);
    els.queueBody.appendChild(tr);
    return;
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tr = document.createElement('tr');

    const tdIdx = document.createElement('td');
    tdIdx.textContent = String(i + 1);

    const tdEnq = document.createElement('td');
    tdEnq.textContent = r.enquiryNo;

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge badge-${r.status}`;
    badge.textContent = r.status;
    tdStatus.appendChild(badge);
    if (r.aiRecovered) {
      const aiBadge = document.createElement('span');
      aiBadge.className = 'badge badge-ai';
      aiBadge.textContent = 'AI FIXED';
      tdStatus.appendChild(aiBadge);
    }

    const tdMsg = document.createElement('td');
    tdMsg.textContent = r.message || [r.followupDone, r.enquiryStatus, r.reason].filter(Boolean).join(' / ') || 'Pending';
    tdMsg.title = r.aiDiagnosis ? `${tdMsg.textContent}\nAI Diagnosis: ${r.aiDiagnosis}` : tdMsg.textContent;

    tr.append(tdIdx, tdEnq, tdStatus, tdMsg);
    els.queueBody.appendChild(tr);
  }
}

function updateRunButtons() {
  const isIdle = state.runState === 'IDLE';
  const isRunning = state.runState === 'RUNNING';
  const isPaused = state.runState === 'PAUSED';
  const hasQueue = state.queue.length > 0;
  const hasFailed = state.queue.some((r) => r.status === 'FAILED');

  els.startBtn.textContent = els.dryRun.checked
    ? 'Start Dry Run'
    : (els.forceClose?.checked ? 'Start Force Close' : 'Start Live Close');
  els.startBtn.disabled = !isIdle || !hasQueue || !state.pageReady;

  els.pauseBtn.disabled = !(isRunning || isPaused);
  els.pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';

  els.stopBtn.disabled = isIdle;
  els.retryFailedBtn.disabled = !isIdle || !hasFailed || !state.pageReady;
  els.exportCsvBtn.disabled = !hasQueue;
}

async function waitWhilePaused() {
  while (state.runState === 'PAUSED') {
    await new Promise((r) => setTimeout(r, 150));
  }
}

function validateBeforeRun() {
  const cfg = getConfigFromUI();
  if (state.queue.length === 0) return 'Upload a CSV or Excel file with Enquiry# rows first.';
  if (!state.pageReady || !state.activeTabId) return 'Navigate to the Hero Connect DMS Enquiry Calls view first.';

  if (!cfg.dryRun) {
    if (cfg.forceClose) {
      if (!cfg.enquiryStatus) {
        cfg.enquiryStatus = 'Closed';
        els.defEnquiryStatus.value = 'Closed';
      }
      for (const r of state.queue) {
        if (r.status === 'PENDING' && !r.enquiryStatus) {
          r.enquiryStatus = 'Closed';
        }
      }
    } else {
      const missingStatus = state.queue.some((r) => r.status === 'PENDING' && !r.enquiryStatus);
      if (missingStatus) {
        return 'Provide a default "Enquiry Status" (or map an Enquiry Status column) before running Live Close.';
      }
    }
    if (cfg.aiEnabled && !cfg.nimApiKey) {
      return 'Enter your NVIDIA NIM API Key (or uncheck AI Auto-Recovery) before running Live Close.';
    }
  }
  return '';
}

async function ensureCustomNimHostPermission(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.origin === 'https://integrate.api.nvidia.com') return true;
    const originPattern = `${parsed.origin}/*`;
    if (chrome.permissions?.contains && chrome.permissions?.request) {
      const has = await chrome.permissions.contains({ origins: [originPattern] });
      if (!has) {
        return await chrome.permissions.request({ origins: [originPattern] });
      }
    }
    return true;
  } catch {
    return false;
  }
}

function syncPendingRowDefaults() {
  const cfg = getConfigFromUI();
  if (!state.parsedFile) return;
  const { items } = buildBatchQueue(state.parsedFile.records, state.mapping, cfg, {
    deduplicate: cfg.deduplicate
  });
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const row of state.queue) {
    if (row.status === 'PENDING' && byId.has(row.id)) {
      Object.assign(row, byId.get(row.id));
    }
  }
}

async function runBatch(onlyRetryFailed = false) {
  if (state.runState !== 'IDLE') return;
  showAlert('');

  if (onlyRetryFailed) {
    for (const row of state.queue) {
      if (row.status === 'FAILED') {
        row.status = 'PENDING';
        row.message = '';
      }
    }
  }

  const cfg = getConfigFromUI();
  await saveConfig();

  if (!onlyRetryFailed && !cfg.dryRun) {
    const hasPending = state.queue.some((r) => r.status === 'PENDING');
    const hasDryRunRows = state.queue.some((r) => r.status === 'DRY_RUN_OK');
    if (!hasPending && hasDryRunRows) {
      rebuildQueueFromParsedFile();
    }
  }

  syncPendingRowDefaults();
  const validationErr = validateBeforeRun();
  if (validationErr) {
    showAlert(validationErr);
    return;
  }

  if (!cfg.dryRun && cfg.aiEnabled) {
    const permOk = await ensureCustomNimHostPermission(cfg.nimBaseUrl);
    if (!permOk) {
      showAlert('Host permission denied for custom NVIDIA NIM Base URL.');
      return;
    }
  }

  const targetTabId = state.activeTabId;
  await chrome.tabs
    .sendMessage(targetTabId, { type: 'RESET_AI_SESSION', fatalOnly: onlyRetryFailed })
    .catch(() => {});
  state.runState = 'RUNNING';
  updateRunButtons();
  renderQueueTable();

  for (const row of state.queue) {
    if (row.status !== 'PENDING') continue;

    await waitWhilePaused();
    if (state.runState === 'STOPPING' || state.runState === 'IDLE') break;

    row.status = 'RUNNING';
    row.message = cfg.dryRun ? 'Verifying in DMS...' : 'Closing enquiry...';
    renderQueueTable();

    try {
      const response = await chrome.tabs.sendMessage(targetTabId, {
        type: 'PROCESS_ENQUIRY',
        item: row,
        options: {
          forceClose: cfg.forceClose !== false,
          dryRun: cfg.dryRun,
          skipIfClosed: cfg.skipIfClosed,
          stepDelayMs: cfg.stepDelayMs,
          oppOrderType: cfg.oppOrderType,
          oppAge: cfg.oppAge,
          oppGender: cfg.oppGender,
          oppExistingVehicle: cfg.oppExistingVehicle,
          oppPointOfContact: cfg.oppPointOfContact,
          oppExpectedPurchaseDate: cfg.oppExpectedPurchaseDate,
          autoPickEmptyOppCombos: cfg.autoPickEmptyOppCombos,
          aiEnabled: cfg.aiEnabled,
          aiAutonomousFill: cfg.aiAutonomousFill,
          aiMaxRetries: cfg.aiMaxRetries,
          aiDealerHint: cfg.aiDealerHint,
          parsedDealerHint: parseDealerHint(cfg.aiDealerHint)
        }
      });

      if (!response?.ok || !response.result) {
        throw new Error(response?.error || 'No response from DMS tab.');
      }

      const res = response.result;
      row.status = res.status || 'FAILED';
      row.previousStatus = res.previousStatus || '';
      row.newStatus = res.newStatus || '';
      row.message = res.message || '';
      row.aiRecovered = Boolean(res.aiRecovered);
      row.aiChanges = res.aiChanges || '';
      row.aiDiagnosis = res.aiDiagnosis || '';
      row.timestamp = res.timestamp || new Date().toISOString();
    } catch (err) {
      row.status = 'FAILED';
      row.message = err?.message || 'Communication error with DMS tab.';
      row.timestamp = new Date().toISOString();
    }

    renderQueueTable();
    if (state.runState === 'STOPPING') break;
  }

  state.runState = 'IDLE';
  updateRunButtons();
}

async function handleScanOptions(fieldKey) {
  showAlert('');
  await checkDmsTabConnection();
  if (!state.pageReady || !state.activeTabId) {
    showAlert('Open the DMS Enquiry Calls view first to scan dropdown options.');
    return;
  }

  try {
    const res = await chrome.tabs.sendMessage(state.activeTabId, {
      type: 'SCAN_OPTIONS',
      fieldKey
    });
    if (!res?.ok) {
      showAlert(res?.error || 'Could not scan dropdown options.');
      return;
    }

    state.activeScanField = fieldKey;
    els.scanTitle.textContent = `${res.label} options (${res.options.length})`;
    els.scanChips.innerHTML = '';

    for (const optText of res.options) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = optText;
      chip.addEventListener('click', () => {
        const targetInput = FIELD_INPUT_MAP[fieldKey];
        if (targetInput) {
          targetInput.value = optText;
          saveConfig();
          syncPendingRowDefaults();
          renderQueueTable();
        }
      });
      els.scanChips.appendChild(chip);
    }

    els.scanResultsBox.hidden = false;
  } catch (err) {
    showAlert(err?.message || 'Failed scanning dropdown options.');
  }
}

function populateNimModelDatalist(models = []) {
  if (!Array.isArray(models) || models.length === 0) return;
  els.nimModelList.innerHTML = '';
  for (const id of models) {
    const opt = document.createElement('option');
    opt.value = id;
    els.nimModelList.appendChild(opt);
  }
}

async function handleFetchNimModels() {
  const cfg = getConfigFromUI();
  await saveConfig();
  els.nimTestStatus.className = 'muted small';
  els.nimTestStatus.textContent = 'Fetching live models...';
  els.fetchModelsBtn.disabled = true;

  try {
    const permOk = await ensureCustomNimHostPermission(cfg.nimBaseUrl);
    if (!permOk) {
      els.nimTestStatus.className = 'ai-status-err small';
      els.nimTestStatus.textContent = 'Permission denied for Base URL.';
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: 'FETCH_NIM_MODELS',
      nimConfig: {
        nimApiKey: cfg.nimApiKey,
        nimBaseUrl: cfg.nimBaseUrl
      }
    });

    if (res?.ok && Array.isArray(res.models) && res.models.length > 0) {
      populateNimModelDatalist(res.models);
      if (!cfg.nimModel || RETIRED_NIM_MODELS.has(cfg.nimModel) || !res.models.includes(cfg.nimModel)) {
        els.nimModel.value = res.models[0];
        await saveConfig();
      }
      els.nimTestStatus.className = 'ai-status-ok small';
      els.nimTestStatus.textContent = `Loaded ${res.models.length} active models`;
    } else {
      els.nimTestStatus.className = 'ai-status-err small';
      els.nimTestStatus.textContent = res?.error || 'No active models returned.';
    }
  } catch (err) {
    els.nimTestStatus.className = 'ai-status-err small';
    els.nimTestStatus.textContent = err?.message || 'Failed fetching models.';
  } finally {
    els.fetchModelsBtn.disabled = false;
  }
}

async function handleTestNimConnection() {
  const cfg = getConfigFromUI();
  await saveConfig();
  els.nimTestStatus.className = 'muted small';
  els.nimTestStatus.textContent = 'Testing NIM API...';
  els.testNimBtn.disabled = true;

  try {
    const permOk = await ensureCustomNimHostPermission(cfg.nimBaseUrl);
    if (!permOk) {
      els.nimTestStatus.className = 'ai-status-err small';
      els.nimTestStatus.textContent = 'Permission denied for Base URL.';
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: 'TEST_NIM_CONNECTION',
      nimConfig: {
        nimApiKey: cfg.nimApiKey,
        nimBaseUrl: cfg.nimBaseUrl,
        nimModel: cfg.nimModel
      }
    });

    if (res?.ok) {
      if (Array.isArray(res.availableModels) && res.availableModels.length > 0) {
        populateNimModelDatalist(res.availableModels);
      }
      if (res.switchedFrom && res.model) {
        els.nimModel.value = res.model;
        await saveConfig();
        els.nimTestStatus.className = 'ai-status-ok small';
        els.nimTestStatus.textContent = `Auto-switched to ${res.model} (${res.latencyMs}ms)`;
      } else {
        els.nimTestStatus.className = 'ai-status-ok small';
        els.nimTestStatus.textContent = `Connected (${res.model}, ${res.latencyMs}ms)`;
      }
    } else {
      els.nimTestStatus.className = 'ai-status-err small';
      els.nimTestStatus.textContent = res?.error || 'Connection failed.';
    }
  } catch (err) {
    els.nimTestStatus.className = 'ai-status-err small';
    els.nimTestStatus.textContent = err?.message || 'Connection test error.';
  } finally {
    els.testNimBtn.disabled = false;
  }
}

function downloadTextFile(filename, content, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  els.refreshStatusBtn.addEventListener('click', () => checkDmsTabConnection());

  els.downloadSampleBtn.addEventListener('click', () => {
    const csv = buildSampleCsv(getConfigFromUI());
    downloadTextFile('sample_enquiries.csv', csv);
  });

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    els.fileInput.value = '';
    if (file) handleFileSelection(file);
  });

  els.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropZone.classList.add('drag-over');
  });

  els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('drag-over');
  });

  els.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelection(file);
  });

  const configInputs = [
    ...Object.values(FIELD_INPUT_MAP),
    els.oppOrderType,
    els.oppAge,
    els.oppGender,
    els.oppExistingVehicle,
    els.oppPointOfContact,
    els.oppExpectedPurchaseDate,
    els.autoPickEmptyOppCombos,
    els.stepDelayMs,
    els.forceClose,
    els.skipIfClosed,
    els.deduplicate,
    els.dryRun,
    els.aiEnabled,
    els.aiAutonomousFill,
    els.nimApiKey,
    els.nimModel,
    els.nimBaseUrl,
    els.aiMaxRetries,
    els.aiDealerHint
  ];

  for (const input of configInputs) {
    const onConfigChange = async () => {
      updateAiBadge();
      await saveConfig();
      if (input === els.deduplicate) {
        rebuildQueueFromParsedFile();
      } else {
        syncPendingRowDefaults();
        renderQueueTable();
      }
      updateRunButtons();
    };
    input.addEventListener('change', onConfigChange);
    if (input.type === 'text' || input.type === 'number' || input.type === 'password') {
      input.addEventListener('input', () => {
        saveConfig();
        syncPendingRowDefaults();
        renderQueueTable();
        updateRunButtons();
      });
    }
  }

  els.toggleNimKeyBtn.addEventListener('click', () => {
    const isHidden = els.nimApiKey.type === 'password';
    els.nimApiKey.type = isHidden ? 'text' : 'password';
    els.toggleNimKeyBtn.textContent = isHidden ? 'Hide' : 'Show';
  });

  els.fetchModelsBtn.addEventListener('click', () => handleFetchNimModels());
  els.testNimBtn.addEventListener('click', () => handleTestNimConnection());

  for (const btn of document.querySelectorAll('.btn-scan')) {
    btn.addEventListener('click', () => handleScanOptions(btn.dataset.scan));
  }

  els.closeScanBtn.addEventListener('click', () => {
    els.scanResultsBox.hidden = true;
  });

  els.startBtn.addEventListener('click', () => runBatch(false));

  els.pauseBtn.addEventListener('click', () => {
    if (state.runState === 'RUNNING') {
      state.runState = 'PAUSED';
    } else if (state.runState === 'PAUSED') {
      state.runState = 'RUNNING';
    }
    updateRunButtons();
  });

  els.stopBtn.addEventListener('click', () => {
    if (state.runState === 'RUNNING' || state.runState === 'PAUSED') {
      state.runState = 'STOPPING';
      updateRunButtons();
    }
  });

  els.retryFailedBtn.addEventListener('click', () => runBatch(true));

  els.exportCsvBtn.addEventListener('click', () => {
    const csv = buildResultsCsv(state.queue);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadTextFile(`dms_enquiry_results_${stamp}.csv`, csv);
  });

  chrome.tabs.onActivated.addListener(() => {
    if (state.runState === 'IDLE') checkDmsTabConnection();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === state.activeTabId && changeInfo.status === 'complete' && state.runState === 'IDLE') {
      checkDmsTabConnection();
    }
  });
}

(async () => {
  await loadSavedConfig();
  bindEvents();
  await checkDmsTabConnection();
})();
