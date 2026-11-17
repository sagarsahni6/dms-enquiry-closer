/**
 * ISOLATED-world content runner for Hero Connect DMS (Siebel Open UI).
 * Automates enquiry lookup, activity row creation, text-matched combobox
 * selection, row commit, and Siebel error capture/recovery.
 */
(() => {
  if (window.__heroDmsRunnerInstalled) return;
  window.__heroDmsRunnerInstalled = true;

  const REQ_CHANNEL = 'HERO_DMS_BRIDGE_REQ';
  const RES_CHANNEL = 'HERO_DMS_BRIDGE_RES';

  const SELECTORS = {
    oppApplet: '#s_S_A1_div',
    formApplet: '#s_S_A2_div, #S_A2',
    actApplet: '#s_S_A3_div',
    oppTable: '#s_1_l',
    actTable: '#s_3_l',
    oppQueryBtn: '#s_1_1_24_0_Ctrl, button[title="Opportunities List:Query"]',
    oppGoBtn: '#s_1_1_21_0_Ctrl, button[title="Opportunities List:Go"]',
    oppCancelBtn: '#s_1_1_17_0_Ctrl, button[title="Opportunities List:Cancel"]',
    actNewBtn: '#s_3_1_18_0_Ctrl, button[title="Activities List:New"]',
    actCancelBtn: '#s_3_1_7_0_Ctrl, button[title="Activities List:Cancel"]',
    commitTarget:
      '#s_S_A2_div .siebui-applet-content, #S_A2 div.siebui-applet-content > div > div, #s_S_A2_div'
  };

  const ACTIVITY_COLUMNS = [
    {
      key: 'followupDone',
      label: 'Followup Done',
      suffix: 'HMCL_Followup_Done',
      type: 'combo',
      bcFields: ['HMCL Followup Done', 'Followup Done']
    },
    {
      key: 'enquiryStatus',
      label: 'Enquiry Status',
      suffix: 'Status',
      type: 'combo',
      bcFields: ['Status', 'Enquiry Status']
    },
    {
      key: 'reason',
      label: 'Reason',
      suffix: 'HHML_CloseOut_Reason',
      type: 'combo',
      bcFields: ['HHML CloseOut Reason', 'Reason']
    },
    {
      key: 'subReason',
      label: 'Close Out Sub Reason',
      suffix: 'HHML_CloseOut_Sub_Reason',
      type: 'combo',
      bcFields: ['HHML CloseOut Sub Reason', 'Close Out Sub Reason']
    },
    {
      key: 'subReason2',
      label: 'Close Out Sub Reason2',
      suffix: 'HHML_CloseOut_Sub_Reason2',
      type: 'combo',
      bcFields: ['HHML CloseOut Sub Reason2', 'Close Out Sub Reason2']
    },
    {
      key: 'makeBought',
      label: 'Make Bought',
      suffix: 'HHML_Make_Bought',
      type: 'combo',
      bcFields: ['HHML Make Bought', 'Make Bought']
    },
    {
      key: 'model',
      label: 'Model',
      suffix: 'HHML_Model',
      type: 'combo',
      bcFields: ['HHML Model', 'Model']
    },
    {
      key: 'nextFollowupDate',
      label: 'Next Follow-Up Date',
      suffix: 'Due',
      type: 'date',
      bcFields: ['Due', 'Next Followup Date', 'Next Follow-Up Date']
    },
    {
      key: 'expectedPurchaseDate',
      label: 'Expected Purchase Date',
      suffix: 'HMCL_Expected_Purchase_Date',
      type: 'date',
      bcFields: ['HMCL Expected Purchase Date', 'Expected Purchase Date']
    },
    {
      key: 'expectedVisitDate',
      label: 'Expected Visit Date',
      suffix: 'HMCL_Expected_Visit_Date',
      type: 'date',
      bcFields: ['HMCL Expected Visit Date', 'Expected Visit Date']
    },
    {
      key: 'followUpSource',
      label: 'Follow Up Source',
      suffix: 'HMCL_Follow_Up_Source',
      type: 'combo',
      bcFields: ['HMCL Follow Up Source', 'Follow Up Source']
    },
    {
      key: 'remarks',
      label: 'Remarks',
      suffix: 'Comment',
      type: 'text',
      bcFields: ['Comment', 'Remarks']
    },
    {
      key: 'followupAction',
      label: 'Follow-Up Action',
      suffix: 'Description',
      type: 'text',
      bcFields: ['Description', 'Follow-Up Action']
    }
  ];

  // Batch-level self-learning cache so AI fixes discovered on row 1 speed up subsequent rows
  const sessionAliases = {
    activity: new Map(), // `${fieldKey}:${lowerRaw}` -> canonicalOption
    activityDefaults: new Map(), // `${fieldKey}` -> learned value when missing in input
    opportunity: new Map(), // `${lowerLabel}` -> value
    requiredOppFields: new Set(), // lowercased Opp field labels confirmed required by Siebel in this batch
    fatalAiError: ''
  };

  function lookupSessionActivityAlias(fieldKey, rawVal) {
    return sessionAliases.activity.get(`${fieldKey}:${normalizeText(rawVal).toLowerCase()}`) || '';
  }

  function learnSessionActivityAlias(fieldKey, rawVal, resolvedVal) {
    const k = `${fieldKey}:${normalizeText(rawVal).toLowerCase()}`;
    if (normalizeText(rawVal) && normalizeText(resolvedVal) && rawVal !== resolvedVal) {
      sessionAliases.activity.set(k, normalizeText(resolvedVal));
    }
  }

  function learnSessionActivityDefault(fieldKey, resolvedVal) {
    const val = normalizeText(resolvedVal);
    if (fieldKey && val) {
      sessionAliases.activityDefaults.set(fieldKey, val);
    }
  }

  function isFatalAiConfigError(errMsg) {
    return /NVIDIA NIM API key|authentication failed \(40[13]\)|serverless inference is not enabled|not found for account/i.test(
      String(errMsg || '')
    );
  }

  let reqSeq = 0;
  const pendingBridgeRequests = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== RES_CHANNEL) return;
    const pending = pendingBridgeRequests.get(msg.id);
    if (!pending) return;
    pendingBridgeRequests.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok) {
      pending.resolve(msg.data);
    } else {
      pending.reject(new Error(msg.error || 'Bridge request failed'));
    }
  });

  function callBridge(action, payload = {}, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
      const id = `hdms_${++reqSeq}`;
      const targetOrigin =
        window.location.origin && window.location.origin !== 'null'
          ? window.location.origin
          : '*';

      const timer = setTimeout(() => {
        pendingBridgeRequests.delete(id);
        reject(new Error(`Siebel bridge timed out for ${action}`));
      }, timeoutMs);

      pendingBridgeRequests.set(id, { resolve, reject, timer });
      window.postMessage({ channel: REQ_CHANNEL, id, action, payload }, targetOrigin);
    });
  }

  async function safeBridgeState() {
    try {
      return await callBridge('GET_STATE', {}, 800);
    } catch {
      return { hasSiebel: false, isBusy: false, activeView: '', applets: [] };
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return el.getClientRects().length > 0;
  }

  function isEnabledButton(btn) {
    return Boolean(btn && isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true');
  }

  function clickButton(btn) {
    if (!btn) return;
    btn.scrollIntoView({ block: 'nearest', inline: 'center' });
    btn.click();
  }

  function dispatchMouseClick(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'center' });
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false, view: window }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function dispatchDoubleClick(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'center' });
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    el.dispatchEvent(new MouseEvent('dblclick', opts));
  }

  function setNativeInputValue(inputEl, value) {
    const proto =
      inputEl.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(inputEl, value);
    } else {
      inputEl.value = value;
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function dispatchKey(el, key, keyCode) {
    if (!el) return;
    const opts = {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  async function waitForCondition(predicate, timeoutMs = 10000, intervalMs = 75, errMsg = 'Timed out') {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const val = await predicate();
      if (val) return val;
      await sleep(intervalMs);
    }
    throw new Error(errMsg);
  }

  async function waitForSiebelIdle(timeoutMs = 15000) {
    let consecutiveIdle = 0;
    await waitForCondition(
      async () => {
        const state = await safeBridgeState();
        const maskVisible = isVisible(document.querySelector('#maskoverlay'));
        const busyBody = document.body?.classList.contains('siebui-busy');
        const ajaxBusy = (state.jqueryActive || 0) > 0;
        if (!state.isBusy && !ajaxBusy && !maskVisible && !busyBody) {
          consecutiveIdle++;
          return consecutiveIdle >= 2;
        }
        consecutiveIdle = 0;
        return false;
      },
      timeoutMs,
      80,
      'Siebel DMS remained busy for too long'
    );
  }

  function findEnquiryQueryInput() {
    return (
      document.getElementById('1_Enquiry_') ||
      document.querySelector('#s_1_l input[name="Enquiry_"]') ||
      document.querySelector('#s_1_l td[aria-describedby="s_1_l_Enquiry_"] input')
    );
  }

  function isPickOrMvgDialog(dlg) {
    if (!dlg) return false;
    return Boolean(
      dlg.querySelector('table.ui-jqgrid-btable, tr.jqgrow, .siebui-pick-applet, .siebui-mvg-dialog')
    );
  }

  function findVisibleDialogErrors(isCleanup = false) {
    const messages = [];
    const dialogs = [...document.querySelectorAll('.ui-dialog')].filter((d) => isVisible(d));
    for (const dlg of dialogs) {
      if (isPickOrMvgDialog(dlg)) {
        const cancelBtn = [...dlg.querySelectorAll('button')].find((b) =>
          /^(cancel|close)$/i.test(normalizeText(b.textContent))
        );
        const titleClose = dlg.querySelector('.ui-dialog-titlebar-close');
        if (cancelBtn) dispatchMouseClick(cancelBtn);
        else if (titleClose) dispatchMouseClick(titleClose);
        if (!isCleanup) {
          const title = normalizeText(dlg.querySelector('.ui-dialog-title')?.textContent || 'Picklist');
          messages.push(`Popup dialog "${title}" opened unexpectedly`);
        }
        continue;
      }

      const content = normalizeText(dlg.querySelector('.ui-dialog-content')?.textContent || dlg.textContent);
      if (content) messages.push(content);
      const okBtn = [...dlg.querySelectorAll('button')].find((b) =>
        /^(ok|close|yes)$/i.test(normalizeText(b.textContent))
      );
      if (okBtn) dispatchMouseClick(okBtn);
    }
    return messages;
  }

  async function collectSiebelErrors() {
    const errors = [];

    try {
      const alerts = await callBridge('POP_ALERTS', {}, 800);
      if (Array.isArray(alerts)) {
        for (const a of alerts) {
          if (a?.text) errors.push(a.text);
        }
      }
    } catch {
      // Ignore bridge error when collecting alerts
    }

    for (const errSpanId of ['1_c_err', '2_c_err', '3_c_err']) {
      const span = document.getElementById(errSpanId);
      if (span && isVisible(span)) {
        const msg = normalizeText(span.textContent);
        if (msg) errors.push(msg);
      }
    }

    errors.push(...findVisibleDialogErrors());
    const seen = new Set();
    const deduped = [];
    for (const msg of errors) {
      const clean = normalizeText(msg);
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(clean);
      }
    }
    return deduped;
  }

  function findVisibleDropdownMenus() {
    return [...document.querySelectorAll('ul.ui-autocomplete, ul.ui-menu')].filter((ul) => {
      if (!isVisible(ul)) return false;
      if (ul.id === 's_0' || ul.closest('#_sweappmenu') || ul.id.endsWith('_headerMenu')) {
        return false;
      }
      return ul.querySelectorAll('li.ui-menu-item, li[role="menuitem"], li').length > 0;
    });
  }

  function extractMenuItems(menuEl) {
    const lis = [...menuEl.querySelectorAll('li.ui-menu-item, li')];
    return lis
      .map((li) => {
        const target = li.querySelector('a, div, span') || li;
        return {
          li,
          target,
          label: normalizeText(target.textContent)
        };
      })
      .filter((item) => item.label !== '');
  }

  async function enterGridCellEdit(cell) {
    cell.scrollIntoView({ block: 'nearest', inline: 'center' });
    await sleep(50);

    let editor = cell.querySelector('input, select, textarea');
    if (!editor) {
      dispatchMouseClick(cell);
      const appeared = await waitForCondition(
        () => cell.querySelector('input, select, textarea'),
        450,
        50,
        ''
      ).catch(() => null);
      editor = appeared;
    }

    if (!editor) {
      dispatchDoubleClick(cell);
      editor = await waitForCondition(
        () => cell.querySelector('input, select, textarea'),
        1500,
        60,
        `Could not activate inline editor for cell ${cell.id}`
      );
    }

    await waitForSiebelIdle(10000);
    return editor;
  }

  async function openCellDropdownMenu(cell, fieldLabel) {
    const editor = await enterGridCellEdit(cell);

    if (editor.tagName === 'SELECT') {
      const options = [...editor.options].map((o) => ({
        value: o.value,
        label: normalizeText(o.textContent)
      }));
      return { kind: 'select', editor, options, menuEl: null };
    }

    const icon =
      cell.querySelector('span.siebui-icon-dropdown, [id$="_icon"]') ||
      (editor.nextElementSibling?.matches?.('span, img, a, button') ? editor.nextElementSibling : null);

    if (!icon) {
      throw new Error(`Dropdown icon not found for "${fieldLabel}"`);
    }

    const priorMenus = new Set(findVisibleDropdownMenus());
    dispatchMouseClick(icon);
    await waitForSiebelIdle(10000);

    const menuEl = await waitForCondition(
      () => {
        const visible = findVisibleDropdownMenus();
        const fresh = visible.filter((m) => !priorMenus.has(m));
        const candidate = fresh[fresh.length - 1] || visible[visible.length - 1];
        if (!candidate) return null;
        return extractMenuItems(candidate).length > 0 ? candidate : null;
      },
      4500,
      75,
      `Dropdown menu did not open for "${fieldLabel}"`
    );

    return {
      kind: 'autocomplete',
      editor,
      menuEl,
      options: extractMenuItems(menuEl)
    };
  }

  function findComboOptionMatch(options, colDef, targetValue, allowSmartMatch = false, forceClose = false) {
    const wanted = normalizeText(targetValue).toLowerCase();
    if (!wanted) {
      if (forceClose && options.length > 0) {
        if (colDef.key === 'enquiryStatus') {
          return options.find((o) => /closed|lost/i.test(o.label)) || options[0];
        }
        if (colDef.key === 'followupDone') {
          return options.find((o) => /connected|contacted/i.test(o.label)) || options[0];
        }
        if (colDef.key === 'reason') {
          return options.find((o) => /bought competitor|not interested|lost/i.test(o.label)) || options[0];
        }
        if (colDef.key === 'subReason' || colDef.key === 'subReason2') {
          return options[0];
        }
      }
      return null;
    }

    // 1. Exact case-insensitive match
    const exact = options.find((o) => o.label.toLowerCase() === wanted);
    if (exact) return exact;

    // 2. Space/underscore/hyphen normalized match (e.g. "not contacted" -> "not_contacted")
    const normWanted = wanted.replace(/[\s_-]+/g, '');
    const normMatch = options.find(
      (o) => o.label.toLowerCase().replace(/[\s_-]+/g, '') === normWanted
    );
    if (normMatch) return normMatch;

    // 3. Safe unambiguous DMS synonym (e.g. CONNECTED -> contacted)
    if (colDef.key === 'followupDone' && (wanted === 'connected' || wanted === 'contacted')) {
      const contacted = options.find((o) => /^(contacted|connected)$/i.test(o.label));
      if (contacted) return contacted;
    }

    if (forceClose) {
      // Partial substring match (e.g. "shine" -> "Honda Shine", "competitor" -> "Bought Competitor")
      const partialMatch = options.find(
        (o) => o.label.toLowerCase().includes(wanted) || wanted.includes(o.label.toLowerCase())
      );
      if (partialMatch) return partialMatch;
    }

    if (!allowSmartMatch) return null;

    // 4. Learned session alias
    const learned = lookupSessionActivityAlias(colDef.key, targetValue);
    if (learned) {
      const learnedMatch = options.find((o) => o.label.toLowerCase() === learned.toLowerCase());
      if (learnedMatch) return learnedMatch;
    }

    // 5. Smart fallback to first valid option in active LOV when Force Close is active
    if (forceClose && options.length > 0) {
      if (colDef.key === 'enquiryStatus') {
        return options.find((o) => /closed|lost/i.test(o.label)) || options[0];
      }
      if (colDef.key === 'reason') {
        return options.find((o) => /bought competitor|not interested|lost/i.test(o.label)) || options[0];
      }
      if (colDef.key === 'subReason' || colDef.key === 'subReason2') {
        return options[0];
      }
    }

    return null;
  }

  function findActivityCell(row, colDef) {
    if (!row || !colDef) return null;
    return row.querySelector(
      `td[id$='_s_3_l_${colDef.suffix}'], td[aria-describedby='s_3_l_${colDef.suffix}']`
    );
  }

  function isCellReadOnly(cell) {
    if (!cell) return true;
    return (
      cell.classList.contains('not-editable-cell') ||
      cell.classList.contains('ui-state-disabled-cell') ||
      cell.getAttribute('aria-readonly') === 'true' ||
      cell.getAttribute('editable') === 'false'
    );
  }

  async function selectGridComboOption(row, colDef, targetValue, allowSmartMatch = false, forceClose = false) {
    let cell = findActivityCell(row, colDef);
    if (!cell) {
      throw new Error(`Column "${colDef.label}" (${colDef.suffix}) not found in Activities grid`);
    }

    if (isCellReadOnly(cell)) {
      // Wait briefly in case a prior dropdown change (e.g. Enquiry Status / Reason) is unlocking this column
      const unlockedCell = await waitForCondition(
        () => {
          const freshRow = findActiveActivityRow() || row;
          const freshCell = findActivityCell(freshRow, colDef);
          return freshCell && !isCellReadOnly(freshCell) ? freshCell : null;
        },
        1200,
        80,
        ''
      ).catch(() => null);
      if (unlockedCell) {
        cell = unlockedCell;
      } else {
        const currentVal = normalizeText(cell.textContent || cell.getAttribute('title') || '');
        if (
          currentVal &&
          (currentVal.toLowerCase() === normalizeText(targetValue).toLowerCase() ||
            (colDef.key === 'followupDone' &&
              normalizeText(targetValue).toLowerCase() === 'connected' &&
              currentVal.toLowerCase() === 'contacted'))
        ) {
          return currentVal;
        }
        throw new Error(`Field "${colDef.label}" is read-only for this enquiry`);
      }
    }

    const opened = await openCellDropdownMenu(cell, colDef.label);

    if (opened.kind === 'select') {
      const match = findComboOptionMatch(opened.options, colDef, targetValue, allowSmartMatch, forceClose);
      if (!match) {
        const available = opened.options.map((o) => o.label).filter(Boolean).slice(0, 20);
        throw new Error(
          `Option "${targetValue}" not found in "${colDef.label}". Available: [${available.join(', ')}]`
        );
      }
      opened.editor.value = match.value;
      opened.editor.dispatchEvent(new Event('change', { bubbles: true }));
      dispatchKey(opened.editor, 'Tab', 9);
      await waitForSiebelIdle(10000);
      return match.label;
    }

    const match = findComboOptionMatch(opened.options, colDef, targetValue, allowSmartMatch, forceClose);
    if (!match) {
      dispatchKey(opened.editor, 'Escape', 27);
      const available = opened.options.map((o) => o.label).slice(0, 25);
      throw new Error(
        `Option "${targetValue}" not found in "${colDef.label}". Available: [${available.join(', ')}]`
      );
    }

    dispatchMouseClick(match.target);
    await waitForCondition(() => !isVisible(opened.menuEl), 2500, 60, '').catch(() => {});
    if (opened.editor.isConnected && normalizeText(opened.editor.value).toLowerCase() !== match.label.toLowerCase()) {
      setNativeInputValue(opened.editor, match.label);
    }
    await callBridge(
      'SYNC_GRID_CELL',
      { gridSelector: SELECTORS.actTable, cellId: cell.id, value: match.label, commitCell: false },
      900
    ).catch(() => {});
    dispatchKey(opened.editor, 'Tab', 9);
    await waitForSiebelIdle(12000);
    return match.label;
  }

  async function setGridTextCell(row, colDef, targetValue) {
    const cell = findActivityCell(row, colDef);
    if (!cell) {
      throw new Error(`Column "${colDef.label}" (${colDef.suffix}) not found in Activities grid`);
    }
    if (isCellReadOnly(cell)) {
      return false;
    }
    const val = String(targetValue);
    const editor = await enterGridCellEdit(cell);
    editor.focus();
    setNativeInputValue(editor, val);
    await callBridge(
      'SYNC_GRID_CELL',
      { gridSelector: SELECTORS.actTable, cellId: cell.id, value: val, commitCell: true },
      900
    ).catch(() => {});
    dispatchKey(editor, 'Tab', 9);
    await waitForSiebelIdle(10000);
    return true;
  }

  function resolveDateForSiebel(spec, localeFormat = '') {
    const raw = normalizeText(spec);
    if (!raw) return '';

    const now = new Date();
    let targetDate = null;
    if (/^today$/i.test(raw)) {
      targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else {
      const m = raw.match(/^\+(\d+)\s*d?$/i);
      if (m) {
        targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(m[1]));
      }
    }

    if (!targetDate) return raw;

    const dd = String(targetDate.getDate()).padStart(2, '0');
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const yyyy = targetDate.getFullYear();

    // Respect Siebel LocaleObject format if MM/dd or M/d is explicitly used; Hero DMS defaults to DD/MM/YYYY
    if (/^m{1,2}\/d{1,2}\/y{2,4}$/i.test(localeFormat.trim())) {
      return `${mm}/${dd}/${yyyy}`;
    }
    return `${dd}/${mm}/${yyyy}`;
  }

  async function setGridDateCell(row, colDef, rawSpec) {
    const cell = findActivityCell(row, colDef);
    if (!cell) {
      throw new Error(`Column "${colDef.label}" (${colDef.suffix}) not found in Activities grid`);
    }
    if (isCellReadOnly(cell)) {
      return false;
    }

    const bridgeState = await safeBridgeState();
    const formatted = resolveDateForSiebel(rawSpec, bridgeState.dateFormat || '');
    if (!formatted) return false;

    const editor = await enterGridCellEdit(cell);
    editor.focus();
    setNativeInputValue(editor, formatted);
    await callBridge(
      'SYNC_GRID_CELL',
      { gridSelector: SELECTORS.actTable, cellId: cell.id, value: formatted, commitCell: true },
      900
    ).catch(() => {});
    dispatchKey(editor, 'Tab', 9);
    editor.blur();
    await sleep(60);
    await waitForSiebelIdle(10000);
    return true;
  }

  function findActiveActivityRow() {
    const grid = document.querySelector(SELECTORS.actTable);
    if (!grid) return null;
    return (
      grid.querySelector('tr.ui-state-highlight, tr[aria-selected="true"]') ||
      grid.querySelector('tr.jqgrow')
    );
  }

  function findMatchingOppRow(enquiryNo) {
    const grid = document.querySelector(SELECTORS.oppTable);
    if (!grid) return null;
    const wanted = normalizeText(enquiryNo).toLowerCase();
    const rows = [...grid.querySelectorAll('tr.jqgrow, tbody tr[id]')];
    for (const row of rows) {
      const cell = row.querySelector("td[id$='_s_1_l_Enquiry_'], td[aria-describedby='s_1_l_Enquiry_']");
      const cellText = normalizeText(cell?.textContent || cell?.getAttribute('title') || '');
      if (cellText.toLowerCase() === wanted) {
        return row;
      }
    }
    return null;
  }

  function readOppRowStatus(row) {
    if (!row) return '';
    const statusCell = row.querySelector(
      "td[id$='_s_1_l_HHML_Enquiry_Status'], td[aria-describedby='s_1_l_HHML_Enquiry_Status']"
    );
    return normalizeText(statusCell?.textContent || statusCell?.getAttribute('title') || '');
  }

  async function cancelAnyDirtyModes() {
    const active = document.activeElement;
    if (active && active !== document.body) {
      dispatchKey(active, 'Escape', 27);
    }

    findVisibleDialogErrors(true);

    await callBridge('UNDO_DIRTY_RECORDS', {}, 1500).catch(() => {});
    await waitForSiebelIdle(8000).catch(() => {});

    const actCancel = document.querySelector(SELECTORS.actCancelBtn);
    if (isEnabledButton(actCancel)) {
      clickButton(actCancel);
      await waitForSiebelIdle(8000).catch(() => {});
    }

    const oppCancel = document.querySelector(SELECTORS.oppCancelBtn);
    if (isEnabledButton(oppCancel)) {
      clickButton(oppCancel);
      await waitForSiebelIdle(8000).catch(() => {});
    }

    // Clear any alerts generated during rollback/error cleanup so they never leak into retries
    await callBridge('POP_ALERTS', {}, 600).catch(() => {});
  }

  function getOppFormFieldLabel(input) {
    const rawAria = input.getAttribute('aria-label') || '';
    const cleaned = normalizeText(rawAria.replace(/<[^>]*>/g, ''));
    if (cleaned) return cleaned;
    const lblId = input.getAttribute('aria-labelledby');
    if (lblId) {
      const lblEl = document.getElementById(lblId);
      if (lblEl) return normalizeText(lblEl.textContent).replace(/:$/, '');
    }
    return input.name || 'Unknown Field';
  }

  function isOppInputRequired(input) {
    const ariaReq = input.getAttribute('aria-required') === 'true';
    const rawAria = input.getAttribute('aria-label') || '';
    const ariaStarCount = (rawAria.match(/icon_req\.gif/gi) || []).length;
    if (ariaStarCount === 1) return true;
    const lblId = input.getAttribute('aria-labelledby');
    if (lblId) {
      const lblEl = document.getElementById(lblId);
      const starCount = lblEl ? lblEl.querySelectorAll('img[src*="icon_req"]').length : 0;
      if (starCount === 1) return true;
    }
    return ariaReq && ariaStarCount < 2;
  }

  function isNonClosureOppField(label) {
    return /^(variant|color)$/i.test(normalizeText(label));
  }

  function isModelDependentOppField(label) {
    return /^(variant|color|model interested in)$/i.test(normalizeText(label));
  }

  const INDIAN_STATE_ABBREVS = {
    AP: 'ANDHRA PRADESH', AR: 'ARUNACHAL PRADESH', AS: 'ASSAM', BR: 'BIHAR',
    CG: 'CHHATTISGARH', CH: 'CHANDIGARH', DD: 'DAMAN AND DIU', DL: 'DELHI',
    DN: 'DADRA AND NAGAR HAVELI', GA: 'GOA', GJ: 'GUJARAT', HP: 'HIMACHAL PRADESH',
    HR: 'HARYANA', JH: 'JHARKHAND', JK: 'JAMMU AND KASHMIR', KA: 'KARNATAKA',
    KL: 'KERALA', LA: 'LADAKH', LD: 'LAKSHADWEEP', MH: 'MAHARASHTRA',
    ML: 'MEGHALAYA', MN: 'MANIPUR', MP: 'MADHYA PRADESH', MZ: 'MIZORAM',
    NL: 'NAGALAND', OD: 'ODISHA', OR: 'ODISHA', PB: 'PUNJAB',
    PY: 'PUDUCHERRY', RJ: 'RAJASTHAN', SK: 'SIKKIM', TG: 'TELANGANA',
    TN: 'TAMIL NADU', TR: 'TRIPURA', TS: 'TELANGARNA', UA: 'UTTARAKHAND',
    UK: 'UTTARAKHAND', UP: 'UTTAR PRADESH', WB: 'WEST BENGAL'
  };
  INDIAN_STATE_ABBREVS.TS = 'TELANGANA';

  function getOppFieldCascadeRank(label) {
    const lower = normalizeText(label).toLowerCase();
    if (lower === 'state') return 1;
    if (lower === 'district') return 2;
    if (/tehsil|taluka/.test(lower)) return 3;
    if (/city|town|village/.test(lower)) return 4;
    if (/geo\s*area/.test(lower)) return 5;
    if (/pin\s*code/.test(lower)) return 6;
    if (/address\s*line\s*1/.test(lower)) return 7;
    if (/address\s*line\s*2/.test(lower)) return 8;
    if (/^age/.test(lower)) return 9;
    if (lower === 'gender') return 10;
    return 20;
  }

  function findOppComboOptionMatch(options, fieldLabel, targetValue) {
    const wanted = normalizeText(targetValue).toLowerCase();
    if (!wanted) return null;

    const exact = options.find((o) => o.label.toLowerCase() === wanted);
    if (exact) return exact;

    const normWanted = wanted.replace(/[^a-z0-9]/g, '');
    if (normWanted) {
      const normMatch = options.find(
        (o) => o.label.toLowerCase().replace(/[^a-z0-9]/g, '') === normWanted
      );
      if (normMatch) return normMatch;
    }

    const lowerLabel = normalizeText(fieldLabel).toLowerCase();
    if (lowerLabel === 'state') {
      const expanded = INDIAN_STATE_ABBREVS[wanted.toUpperCase()];
      if (expanded) {
        const stateMatch = options.find((o) => o.label.toLowerCase() === expanded.toLowerCase());
        if (stateMatch) return stateMatch;
      }
      const revEntry = Object.entries(INDIAN_STATE_ABBREVS).find(
        ([, full]) => full.toLowerCase() === wanted
      );
      if (revEntry) {
        const abbrMatch = options.find((o) => o.label.toUpperCase() === revEntry[0]);
        if (abbrMatch) return abbrMatch;
      }
    }

    if (lowerLabel === 'gender') {
      const genderAliases = { m: 'male', male: 'm', f: 'female', female: 'f' };
      const alt = genderAliases[wanted];
      if (alt) {
        const gMatch = options.find((o) => o.label.toLowerCase() === alt);
        if (gMatch) return gMatch;
      }
    }

    if (wanted.length >= 3) {
      const wordMatches = options.filter((o) => {
        const lo = o.label.toLowerCase();
        return lo.startsWith(wanted) || lo.includes(` ${wanted}`) || lo.includes(`${wanted} `);
      });
      if (wordMatches.length === 1) return wordMatches[0];
    }

    return null;
  }

  function isOppValueEffectivelyEmpty(label, rawVal) {
    const val = normalizeText(rawVal);
    if (val === '') return true;
    if (/^age/i.test(normalizeText(label)) && val === '0') return true;
    return false;
  }

  function isEditableOppInput(input) {
    return (
      isVisible(input) &&
      !input.disabled &&
      !input.readOnly &&
      input.getAttribute('aria-readonly') !== 'true'
    );
  }

  function isOppPickInput(input, form) {
    return (
      input.classList.contains('siebui-ctrl-pick') ||
      Boolean((form || document).querySelector(`#${input.name}_icon.siebui-icon-pick`))
    );
  }

  function findEmptyRequiredOpportunityFields(includeNonClosure = false) {
    const form = document.querySelector('#s_S_A2_div');
    if (!form) return [];
    const inputs = [...form.querySelectorAll('input, select, textarea')];
    const emptyFields = [];
    for (const input of inputs) {
      if (!isEditableOppInput(input)) continue;
      if (!isOppInputRequired(input)) continue;
      const label = getOppFormFieldLabel(input);
      if (!includeNonClosure && isNonClosureOppField(label)) continue;
      if (!isOppValueEffectivelyEmpty(label, input.value)) continue;
      emptyFields.push({
        label,
        input,
        isCombo: input.classList.contains('siebui-ctrl-select') || Boolean(form.querySelector(`#${input.name}_icon.siebui-icon-dropdown`)),
        isPick: isOppPickInput(input, form),
        isDate: input.classList.contains('siebui-ctrl-datetime')
      });
    }
    return emptyFields.sort((a, b) => getOppFieldCascadeRank(a.label) - getOppFieldCascadeRank(b.label));
  }

  async function selectOppFormCombo(input, targetValue, pickFirstIfAny = false) {
    const label = getOppFormFieldLabel(input);
    const icon =
      document.getElementById(`${input.name}_icon`) ||
      (input.nextElementSibling?.classList?.contains('siebui-icon-dropdown')
        ? input.nextElementSibling
        : null);
    if (!icon) return '';

    input.scrollIntoView({ block: 'nearest', inline: 'center' });
    input.focus();
    const priorMenus = new Set(findVisibleDropdownMenus());
    dispatchMouseClick(icon);
    await waitForSiebelIdle(8000);

    const menuEl = await waitForCondition(
      () => {
        const visible = findVisibleDropdownMenus();
        const fresh = visible.filter((m) => !priorMenus.has(m));
        const candidate = fresh[fresh.length - 1] || visible[visible.length - 1];
        if (!candidate) return null;
        return extractMenuItems(candidate).length > 0 ? candidate : null;
      },
      3000,
      75,
      ''
    ).catch(() => null);

    if (!menuEl) return '';

    const options = extractMenuItems(menuEl).filter((o) => o.label !== '');
    let chosen = null;
    if (targetValue) {
      chosen = findOppComboOptionMatch(options, label, targetValue);
      if (!chosen) {
        if (pickFirstIfAny && options.length > 0) {
          chosen = options[0];
        } else {
          dispatchKey(input, 'Escape', 27);
          throw new Error(
            `Opportunity Form option "${targetValue}" not found for "${label}". Available: [${options.map((o) => o.label).slice(0, 20).join(', ')}]`
          );
        }
      }
    } else if (pickFirstIfAny && options.length > 0) {
      chosen = options[0];
    }

    if (!chosen) {
      dispatchKey(input, 'Escape', 27);
      return '';
    }

    dispatchMouseClick(chosen.target);
    await waitForCondition(() => !isVisible(menuEl), 2000, 60, '').catch(() => {});
    await waitForSiebelIdle(8000);

    // If this is a cascading parent field (State / District), immediately notify Siebel so child LOVs populate
    if (/^(state|district)$/i.test(label)) {
      await callBridge(
        'SYNC_OPPORTUNITY_FIELDS',
        {
          fields: [{ inputName: input.name, label, value: chosen.label, isDate: false, fromCombo: true }],
          commit: false
        },
        1500
      ).catch(() => {});
      await waitForSiebelIdle(8000);
      await sleep(150);
    }

    return chosen.label;
  }

  function findVisiblePickDialog() {
    return (
      [...document.querySelectorAll('.ui-dialog')]
        .filter((d) => isVisible(d) && isPickOrMvgDialog(d))
        .pop() || null
    );
  }

  async function resolveOpenPickDialog(dlg, targetValue, pickFirstIfAny = true) {
    const wanted = normalizeText(targetValue).toLowerCase();
    const findMatchingRow = () => {
      const rows = [...dlg.querySelectorAll('tr.jqgrow, tbody tr[id]')].filter((r) => isVisible(r));
      if (rows.length === 0) return null;
      if (wanted) {
        const exactRow = rows.find((r) =>
          [...r.querySelectorAll('td')].some((td) => normalizeText(td.textContent).toLowerCase() === wanted)
        );
        if (exactRow) return exactRow;
        const partialRow = rows.find((r) =>
          [...r.querySelectorAll('td')].some((td) => normalizeText(td.textContent).toLowerCase().includes(wanted))
        );
        if (partialRow) return partialRow;
      }
      return pickFirstIfAny ? rows[0] : null;
    };

    let targetRow = findMatchingRow();

    if (!targetRow && wanted) {
      const searchInput = [...dlg.querySelectorAll('input[type="text"]')]
        .filter((inp) => isVisible(inp) && !inp.readOnly && !inp.disabled)
        .find((inp) => !inp.closest('table.ui-jqgrid-btable'));
      if (searchInput) {
        searchInput.focus();
        setNativeInputValue(searchInput, normalizeText(targetValue));
        const goBtn = [...dlg.querySelectorAll('button')].find(
          (b) => isVisible(b) && /^(go|find|search)$/i.test(normalizeText(b.textContent || b.title))
        );
        if (goBtn) {
          dispatchMouseClick(goBtn);
        } else {
          dispatchKey(searchInput, 'Enter', 13);
        }
        await waitForSiebelIdle(8000);
        await sleep(150);
        targetRow = findMatchingRow();
      }
    }

    if (targetRow) {
      dispatchMouseClick(targetRow);
      await sleep(80);
      const okBtn = [...dlg.querySelectorAll('button')].find(
        (b) => isVisible(b) && /^(ok|pick|select)$/i.test(normalizeText(b.textContent))
      );
      if (okBtn) {
        dispatchMouseClick(okBtn);
      } else {
        dispatchDoubleClick(targetRow);
      }
      await waitForCondition(() => !isVisible(dlg), 3000, 70, '').catch(() => {});
      await waitForSiebelIdle(8000);
      return true;
    }

    const cancelBtn = [...dlg.querySelectorAll('button')].find(
      (b) => isVisible(b) && /^(cancel|close)$/i.test(normalizeText(b.textContent))
    );
    if (cancelBtn) dispatchMouseClick(cancelBtn);
    await waitForSiebelIdle(5000).catch(() => {});
    return false;
  }

  async function selectOppPickField(input, targetValue, pickFirstIfAny = true) {
    const val = normalizeText(targetValue);
    const icon =
      document.getElementById(`${input.name}_icon`) ||
      (input.nextElementSibling?.classList?.contains('siebui-icon-pick') ? input.nextElementSibling : null);

    if (icon) {
      input.scrollIntoView({ block: 'nearest', inline: 'center' });
      dispatchMouseClick(icon);
      await waitForSiebelIdle(8000);
      const dlg = await waitForCondition(() => findVisiblePickDialog(), 2500, 75, '').catch(() => null);
      if (dlg) {
        const picked = await resolveOpenPickDialog(dlg, val, pickFirstIfAny);
        if (picked && normalizeText(input.value)) {
          return { value: normalizeText(input.value), fromPick: true };
        }
      }
    }

    if (!val) return null;

    // Fallback: type into input and handle any Pick dialog triggered on Tab/blur
    input.focus();
    setNativeInputValue(input, val);
    dispatchKey(input, 'Tab', 9);
    input.blur();
    await waitForSiebelIdle(8000);

    const lateDlg = findVisiblePickDialog();
    if (lateDlg) {
      await resolveOpenPickDialog(lateDlg, val, pickFirstIfAny);
    }

    return { value: normalizeText(input.value) || val, fromPick: true };
  }

  async function applySingleOppField(input, label, rawVal, bridgeState, { pickFirstIfAny = false, isDateOverride = false, form = null } = {}) {
    const isCombo =
      input.classList.contains('siebui-ctrl-select') ||
      Boolean((form || document).querySelector(`#${input.name}_icon.siebui-icon-dropdown`));
    const isPick = isOppPickInput(input, form);
    const isDate = isDateOverride || input.classList.contains('siebui-ctrl-datetime');
    const val = normalizeText(rawVal);

    if (isCombo) {
      const chosen = await selectOppFormCombo(input, val, pickFirstIfAny);
      if (!chosen) return null;
      return { inputName: input.name, label, value: chosen, isDate: false, fromCombo: true };
    }

    if (isPick) {
      const picked = await selectOppPickField(input, val, pickFirstIfAny || Boolean(val));
      if (!picked || !picked.value) return null;
      return { inputName: input.name, label, value: picked.value, isDate: false, fromPick: true };
    }

    if (!val) return null;
    const finalVal = isDate ? resolveDateForSiebel(val, bridgeState.dateFormat || '') : val;
    input.focus();
    setNativeInputValue(input, finalVal);
    dispatchKey(input, 'Tab', 9);
    input.blur();
    await waitForSiebelIdle(8000);
    return { inputName: input.name, label, value: finalVal, isDate };
  }

  async function syncAndCommitOpportunityFields(syncedFields) {
    if (!Array.isArray(syncedFields) || syncedFields.length === 0) return;
    await callBridge('SYNC_OPPORTUNITY_FIELDS', { fields: syncedFields, commit: true }, 2500).catch(() => {});
    const oppTitle = document.querySelector('#s_S_A1_div .siebui-applet-title');
    if (oppTitle) dispatchMouseClick(oppTitle);
    await sleep(150);
    await waitForSiebelIdle(12000);
    const formErrs = await collectSiebelErrors();
    if (formErrs.length > 0) {
      throw new Error(formErrs.join(' | '));
    }
  }

  async function fillMissingOpportunityFields(options = {}, allowNonClosure = false, forceClose = false) {
    const fallbackMap = [
      { labelMatch: /^booking order type$/i, value: options.oppOrderType || (forceClose ? 'Retail' : '') },
      { labelMatch: /^model interested in$/i, value: options.oppModelInterestedIn },
      ...(allowNonClosure
        ? [
            { labelMatch: /^variant$/i, value: options.oppVariant },
            { labelMatch: /^color$/i, value: options.oppColor }
          ]
        : []),
      { labelMatch: /^existing vehicle$/i, value: options.oppExistingVehicle || (forceClose ? 'No' : '') },
      { labelMatch: /^age/i, value: options.oppAge || (forceClose ? '26' : '') },
      { labelMatch: /^gender$/i, value: options.oppGender || (forceClose ? 'M' : '') },
      { labelMatch: /^state$/i, value: options.oppState || (forceClose ? 'UTTAR PRADESH' : '') },
      { labelMatch: /^district$/i, value: options.oppDistrict || (forceClose ? 'LUCKNOW' : '') },
      { labelMatch: /^tehsil|taluka/i, value: options.oppTehsil || (forceClose ? 'MOHANLALGANJ' : '') },
      { labelMatch: /^city|town|village/i, value: options.oppCity || (forceClose ? 'LUCKNOW' : '') },
      { labelMatch: /^pin\s*code/i, value: options.oppPin || (forceClose ? '226001' : '') },
      { labelMatch: /^point of contact$/i, value: options.oppPointOfContact || (forceClose ? 'Self' : '') },
      { labelMatch: /^expected date of purchase$/i, value: options.oppExpectedPurchaseDate || (forceClose ? 'TODAY' : ''), isDate: true }
    ];

    const autoPick = Boolean(options.autoPickEmptyOppCombos || forceClose);
    const hasAnyExplicit = fallbackMap.some((f) => normalizeText(f.value) !== '');
    if (!hasAnyExplicit && !autoPick) return false;

    const emptyFields = findEmptyRequiredOpportunityFields(allowNonClosure);
    if (emptyFields.length === 0) return false;

    const form = document.querySelector('#s_S_A2_div');
    const bridgeState = await safeBridgeState();
    const syncedFields = [];

    // First apply explicit fallbacks in cascading order
    for (const spec of fallbackMap) {
      const val = normalizeText(spec.value);
      if (!val) continue;
      const field = emptyFields.find((f) => spec.labelMatch.test(f.label));
      if (!field || !isOppValueEffectivelyEmpty(field.label, field.input.value)) continue;

      const synced = await applySingleOppField(field.input, field.label, val, bridgeState, {
        pickFirstIfAny: autoPick,
        isDateOverride: Boolean(spec.isDate),
        form
      });
      if (synced) syncedFields.push(synced);
    }

    // Optional opt-in / Force Close: pick first available option for remaining empty required comboboxes/pick fields (excluding Variant/Color)
    if (autoPick) {
      const remaining = findEmptyRequiredOpportunityFields(allowNonClosure);
      for (const field of remaining) {
        if (!field.isCombo && !field.isPick) continue;
        const synced = await applySingleOppField(field.input, field.label, '', bridgeState, {
          pickFirstIfAny: true,
          form
        });
        if (synced) syncedFields.push(synced);
      }
    }

    if (syncedFields.length > 0) {
      await syncAndCommitOpportunityFields(syncedFields);
      return true;
    }

    return false;
  }

  async function scanOppFormComboOptions(input) {
    const icon =
      document.getElementById(`${input.name}_icon`) ||
      (input.nextElementSibling?.classList?.contains('siebui-icon-dropdown')
        ? input.nextElementSibling
        : null);
    if (!icon) return [];

    input.scrollIntoView({ block: 'nearest', inline: 'center' });
    input.focus();
    const priorMenus = new Set(findVisibleDropdownMenus());
    dispatchMouseClick(icon);
    await waitForSiebelIdle(6000);

    const menuEl = await waitForCondition(
      () => {
        const visible = findVisibleDropdownMenus();
        const fresh = visible.filter((m) => !priorMenus.has(m));
        const candidate = fresh[fresh.length - 1] || visible[visible.length - 1];
        if (!candidate) return null;
        return extractMenuItems(candidate).length > 0 ? candidate : null;
      },
      1800,
      75,
      ''
    ).catch(() => null);

    if (!menuEl) return [];
    const options = extractMenuItems(menuEl).map((o) => o.label).filter(Boolean).slice(0, 40);
    dispatchKey(input, 'Escape', 27);
    await sleep(40);
    return options;
  }

  function isFieldRelevantToOppError(label, errMsg, hasEmptyState) {
    const lowerLabel = normalizeText(label).toLowerCase();
    const lowerErr = String(errMsg || '').toLowerCase();

    // Never open cascading child dropdowns while parent State is empty (slow / empty LOV)
    if (hasEmptyState && /^(district|tehsil\/taluka)$/i.test(lowerLabel)) {
      return false;
    }
    // Skip model-specific dropdown unless error explicitly mentions Model
    if (lowerLabel === 'model interested in' && !/\bmodel\b/i.test(lowerErr)) {
      return false;
    }

    // If Siebel named a specific field (e.g. "Age is required", "Tehsil/Taluka is required"), only scan that field
    const specificMentions = [
      { re: /\bage\b/i, match: /^age/i },
      { re: /\bgender\b/i, match: /^gender$/i },
      { re: /\bstate\b/i, match: /^state$/i },
      { re: /\bdistrict\b/i, match: /^district$/i },
      { re: /\btehsil|taluka\b/i, match: /tehsil|taluka/i },
      { re: /\bcity|town|village\b/i, match: /city|town|village/i },
      { re: /\bpin\s*code|postal\b/i, match: /pin\s*code/i },
      { re: /\bbooking\s*order\s*type\b/i, match: /^booking order type$/i },
      { re: /\bpoint\s*of\s*contact\b/i, match: /^point of contact$/i },
      { re: /\bexisting\s*vehicle\b/i, match: /^existing vehicle$/i }
    ];
    const matchedSpecs = specificMentions.filter((s) => s.re.test(lowerErr));
    if (matchedSpecs.length > 0 && !/please fill all required/i.test(lowerErr)) {
      return matchedSpecs.some((s) => s.match.test(lowerLabel));
    }

    return true;
  }

  async function inspectOpportunityFormState(
    scanEmptyComboOptions = false,
    includeNonClosure = false,
    errMsg = '',
    skipScanLabels = new Set()
  ) {
    const form = document.querySelector('#s_S_A2_div');
    if (!form) return [];
    const inputs = [...form.querySelectorAll('input, select, textarea')];
    const fields = [];
    const stateInput = inputs.find((i) => isEditableOppInput(i) && getOppFormFieldLabel(i).toLowerCase() === 'state');
    const hasEmptyState = Boolean(stateInput && normalizeText(stateInput.value) === '');

    for (const input of inputs) {
      if (!isEditableOppInput(input)) continue;
      const label = getOppFormFieldLabel(input);
      if (!includeNonClosure && isNonClosureOppField(label)) continue;
      const value = normalizeText(input.value);
      const required = isOppInputRequired(input);
      const isEmpty = isOppValueEffectivelyEmpty(label, value);
      const isCombo =
        input.classList.contains('siebui-ctrl-select') ||
        Boolean(form.querySelector(`#${input.name}_icon.siebui-icon-dropdown`));
      const isPick = isOppPickInput(input, form);
      const isDate = input.classList.contains('siebui-ctrl-datetime');

      const entry = { label, value, required, isEmpty, isCombo, isPick, isDate };
      if (
        scanEmptyComboOptions &&
        isCombo &&
        required &&
        isEmpty &&
        !skipScanLabels.has(label.toLowerCase()) &&
        isFieldRelevantToOppError(label, errMsg, hasEmptyState)
      ) {
        entry.availableOptions = await scanOppFormComboOptions(input).catch(() => []);
      }
      fields.push(entry);
    }
    return fields;
  }

  function findMatchingOppInput(inputs, targetLabel) {
    const wanted = normalizeText(targetLabel).toLowerCase();
    const exact = inputs.find((i) => getOppFormFieldLabel(i).toLowerCase() === wanted);
    if (exact) return exact;
    const normWanted = wanted.replace(/[^a-z0-9]/g, '');
    const normMatch = inputs.find(
      (i) => getOppFormFieldLabel(i).toLowerCase().replace(/[^a-z0-9]/g, '') === normWanted
    );
    if (normMatch) return normMatch;
    if (normWanted === 'age' || normWanted === 'ageyears') {
      return inputs.find((i) => /^age/i.test(getOppFormFieldLabel(i))) || null;
    }
    if (/^(tehsil|taluka|taluk|subdistrict)$/.test(normWanted)) {
      return inputs.find((i) => /tehsil|taluka/i.test(getOppFormFieldLabel(i))) || null;
    }
    if (/^(city|town|village|citytownvillage)$/.test(normWanted)) {
      return inputs.find((i) => /city|town|village/i.test(getOppFormFieldLabel(i))) || null;
    }
    if (/^(pin|pincode|postalcode)$/.test(normWanted)) {
      return inputs.find((i) => /pin\s*code/i.test(getOppFormFieldLabel(i))) || null;
    }
    if (normWanted === 'dist') {
      return inputs.find((i) => /^district$/i.test(getOppFormFieldLabel(i))) || null;
    }
    return null;
  }

  async function applyOpportunityUpdates(updates = {}, pickFirstIfAny = false) {
    const entries = Object.entries(updates || {})
      .filter(([, v]) => normalizeText(v) !== '')
      .sort(([a], [b]) => getOppFieldCascadeRank(a) - getOppFieldCascadeRank(b));
    if (entries.length === 0) return false;

    const form = document.querySelector('#s_S_A2_div');
    if (!form) return false;

    const inputs = [...form.querySelectorAll('input, select, textarea')].filter((i) =>
      isEditableOppInput(i)
    );
    const bridgeState = await safeBridgeState();
    const syncedFields = [];

    for (const [targetLabel, rawVal] of entries) {
      const input = findMatchingOppInput(inputs, targetLabel);
      if (!input) continue;

      const label = getOppFormFieldLabel(input);
      const synced = await applySingleOppField(input, label, rawVal, bridgeState, {
        pickFirstIfAny,
        form
      });
      if (synced) syncedFields.push(synced);
    }

    if (syncedFields.length > 0) {
      await syncAndCommitOpportunityFields(syncedFields);
      return true;
    }
    return false;
  }

  function parseMismatchErrorOptions(errMsg) {
    const match = String(errMsg || '').match(
      /Option\s+"[^"]*"\s+not found in\s+"([^"]+)"\.\s*Available:\s*\[([^\]]*)\]/i
    );
    if (!match) return null;
    const label = normalizeText(match[1]);
    const options = match[2]
      .split(',')
      .map((s) => normalizeText(s))
      .filter(Boolean);
    const colDef = ACTIVITY_COLUMNS.find(
      (c) => c.label.toLowerCase() === label.toLowerCase()
    );
    return colDef ? { key: colDef.key, options } : null;
  }

  async function collectAvailableActivityOptions(actRow, errMsg, workingItem, scanAllRelevant = false) {
    const map = {};
    const parsed = parseMismatchErrorOptions(errMsg);
    if (parsed) {
      map[parsed.key] = parsed.options;
      return map;
    }

    if (!actRow) return map;
    const lowerErr = String(errMsg || '').toLowerCase();
    const isReasonClosureErr = /sbl-aps-00802|reason.*closure/i.test(lowerErr);

    for (const colDef of ACTIVITY_COLUMNS) {
      if (colDef.type !== 'combo') continue;
      if (map[colDef.key]) continue;
      const isMentioned =
        lowerErr.includes(colDef.label.toLowerCase()) ||
        (isReasonClosureErr && ['reason', 'subReason', 'subReason2'].includes(colDef.key));
      const isEmpty = !normalizeText(workingItem[colDef.key]);
      const isCoreCloseCol = ['followupDone', 'enquiryStatus', 'reason', 'subReason', 'subReason2', 'makeBought', 'model'].includes(colDef.key);
      if (!isMentioned && !isEmpty && !(scanAllRelevant && isCoreCloseCol)) continue;

      const cell = findActivityCell(actRow, colDef);
      if (!cell || isCellReadOnly(cell)) continue;

      try {
        const opened = await openCellDropdownMenu(cell, colDef.label);
        map[colDef.key] = opened.options.map((o) => o.label).filter(Boolean).slice(0, 40);
        if (opened.kind === 'autocomplete' && opened.editor) {
          dispatchKey(opened.editor, 'Escape', 27);
          await sleep(40);
        }
      } catch {
        // Best-effort scan
      }
    }
    return map;
  }

  function readCurrentActivityRowSnapshot(actRow) {
    if (!actRow) return {};
    const snap = {};
    for (const colDef of ACTIVITY_COLUMNS) {
      const cell = findActivityCell(actRow, colDef);
      if (!cell) continue;
      const inp = cell.querySelector('input, select, textarea');
      const val = inp ? normalizeText(inp.value) : normalizeText(cell.textContent || cell.getAttribute('title') || '');
      snap[colDef.key] = { value: val, readOnly: isCellReadOnly(cell) };
    }
    return snap;
  }

  function findEditableOpenActivityRow() {
    const grid = document.querySelector(SELECTORS.actTable);
    if (!grid) return null;
    const rows = [...grid.querySelectorAll('tr.jqgrow, tbody tr[id]')];
    const statusCol = ACTIVITY_COLUMNS.find((c) => c.key === 'enquiryStatus');
    for (const row of rows) {
      if (row.getAttribute('aria-disabled') === 'true') continue;
      const statusCell = findActivityCell(row, statusCol);
      const statusText = normalizeText(statusCell?.textContent || statusCell?.getAttribute('title') || '');
      if (statusText && statusText.toLowerCase() !== 'open') continue;
      if (statusCell && !isCellReadOnly(statusCell)) return row;
    }
    // Fallback: any row with Open status or blank status where row is selectable
    for (const row of rows) {
      if (row.getAttribute('aria-disabled') === 'true') continue;
      const statusCell = findActivityCell(row, statusCol);
      const statusText = normalizeText(statusCell?.textContent || statusCell?.getAttribute('title') || '');
      if (!statusText || statusText.toLowerCase() === 'open') return row;
    }
    return null;
  }

  function isNonRecoverableError(errMsg) {
    const msg = String(errMsg || '');
    return (
      /not found in Opportunities List/i.test(msg) ||
      /Blank Enquiry#/i.test(msg) ||
      /Open Enquiry Calls view first/i.test(msg) ||
      /NVIDIA NIM API key/i.test(msg) ||
      /NVIDIA NIM authentication failed/i.test(msg)
    );
  }

  async function checkPageStatus() {
    const hasOpportunitiesList = Boolean(document.querySelector(SELECTORS.oppApplet));
    const hasOpportunityForm = Boolean(document.querySelector(SELECTORS.formApplet));
    const hasActivitiesList = Boolean(document.querySelector(SELECTORS.actApplet));
    const hasQueryBtn = Boolean(document.querySelector(SELECTORS.oppQueryBtn));
    const hasNewActBtn = Boolean(document.querySelector(SELECTORS.actNewBtn));
    const bridge = await safeBridgeState();

    const ready =
      hasOpportunitiesList &&
      hasActivitiesList &&
      hasQueryBtn &&
      hasNewActBtn;

    let reason = 'Ready on DMS Enquiry Calls view.';
    if (!ready) {
      reason = bridge.hasSiebel
        ? `Open Enquiry Calls view first (current view: ${bridge.activeView || 'unknown'}).`
        : 'Waiting for Hero Connect DMS Siebel view to finish loading.';
    }

    return {
      ok: true,
      ready,
      url: window.location.href,
      activeView: bridge.activeView,
      isBusy: bridge.isBusy,
      hasOpportunitiesList,
      hasOpportunityForm,
      hasActivitiesList,
      reason
    };
  }

  async function queryEnquiryInDms(enquiryNo, stepDelayMs = 120) {
    let oppRow = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      await waitForSiebelIdle(15000);
      await sleep(120);

      const queryBtn = document.querySelector(SELECTORS.oppQueryBtn);
      if (!isEnabledButton(queryBtn)) {
        throw new Error('Opportunities List:Query button is disabled or hidden.');
      }
      clickButton(queryBtn);
      await waitForSiebelIdle(12000);

      const queryInput = await waitForCondition(
        () => findEnquiryQueryInput(),
        6000,
        75,
        'Enquiry# query input (#1_Enquiry_) did not appear.'
      );

      queryInput.focus();
      setNativeInputValue(queryInput, enquiryNo);
      await sleep(Math.min(120, stepDelayMs));

      // Submit query ONCE: prefer clicking Go button cleanly to avoid duplicate Enter+Go SWEC mismatch
      const goBtn = document.querySelector(SELECTORS.oppGoBtn);
      if (isEnabledButton(goBtn)) {
        clickButton(goBtn);
      } else {
        queryInput.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
        );
      }

      await waitForCondition(
        () => !findEnquiryQueryInput(),
        20000,
        80,
        'Opportunities List did not exit Query mode after submitting Enquiry#.'
      );
      await waitForSiebelIdle(20000);
      await sleep(150);

      const queryErrors = await collectSiebelErrors();
      if (queryErrors.length > 0) {
        const joined = queryErrors.join(' | ');
        if (attempt === 0 && joined.includes('SBL-UIF-00335')) {
          await cancelAnyDirtyModes();
          await sleep(600);
          continue;
        }
        throw new Error(joined);
      }

      oppRow = findMatchingOppRow(enquiryNo);
      if (!oppRow && /of\s+[1-9]/i.test(document.getElementById('s_1_rc')?.textContent || '')) {
        oppRow = await waitForCondition(() => findMatchingOppRow(enquiryNo), 1200, 100, '').catch(() => null);
      }
      break;
    }
    return oppRow;
  }

  async function processSingleEnquiry(item, options = {}) {
    const stepDelayMs = Math.max(0, Number(options.stepDelayMs ?? 200));
    const skipIfClosed = Boolean(options.skipIfClosed ?? true);
    const forceClose = Boolean(options.forceClose ?? true);
    const dryRun = Boolean(options.dryRun ?? false);
    const enquiryNo = normalizeText(item?.enquiryNo);

    if (!enquiryNo) {
      return {
        status: 'FAILED',
        previousStatus: '',
        newStatus: '',
        message: 'Blank Enquiry#',
        timestamp: new Date().toISOString()
      };
    }

    const pageCheck = await checkPageStatus();
    if (!pageCheck.ready) {
      return {
        status: 'FAILED',
        previousStatus: '',
        newStatus: '',
        message: pageCheck.reason,
        timestamp: new Date().toISOString()
      };
    }

    await callBridge('SET_ALERT_CAPTURE', { enabled: true }).catch(() => {});
    await callBridge('POP_ALERTS', {}).catch(() => {});

    let previousStatus = '';
    try {
      await waitForSiebelIdle(15000);
      await cancelAnyDirtyModes();

      // 1. Enter Query mode and lookup Enquiry#
      const oppRow = await queryEnquiryInDms(enquiryNo, stepDelayMs);

      // 2. Verify matched Enquiry row
      if (!oppRow) {
        return {
          status: 'FAILED',
          previousStatus: '',
          newStatus: '',
          message: `Enquiry "${enquiryNo}" not found in Opportunities List.`,
          timestamp: new Date().toISOString()
        };
      }

      if (!oppRow.classList.contains('ui-state-highlight') && oppRow.getAttribute('aria-selected') !== 'true') {
        dispatchMouseClick(oppRow);
        await waitForSiebelIdle(10000);
      }

      previousStatus = readOppRowStatus(oppRow);
      if (!previousStatus) {
        const bridgeState = await safeBridgeState();
        previousStatus = normalizeText(bridgeState.oppRowStatus || '');
      }

      const isAlreadyClosed = /^(closed|lost|cancelled|booked)/i.test(previousStatus);
      if (skipIfClosed && isAlreadyClosed) {
        return {
          status: 'SKIPPED',
          previousStatus,
          newStatus: previousStatus,
          message: `Skipped because current status is "${previousStatus}".`,
          timestamp: new Date().toISOString()
        };
      }

      if (dryRun) {
        const missingReq = findEmptyRequiredOpportunityFields(false).map((f) => f.label);
        const warnText = missingReq.length > 0
          ? ` Warning: empty Opportunity Form fields [${missingReq.join(', ')}].`
          : '';
        return {
          status: 'DRY_RUN_OK',
          previousStatus,
          newStatus: previousStatus,
          message: `Verified in DMS (Status: ${previousStatus || 'Unknown'}).${warnText}`,
          aiRecovered: false,
          aiChanges: '',
          aiDiagnosis: '',
          timestamp: new Date().toISOString()
        };
      }

      const aiEnabled = Boolean(options.aiEnabled);
      const aiAutonomousFill = aiEnabled && options.aiAutonomousFill !== false;
      const aiDealerHint = normalizeText(options.aiDealerHint || '');
      const parsedHint = options.parsedDealerHint || { opp: {}, act: {} };
      const hintOpp = parsedHint.opp || {};
      const hintAct = parsedHint.act || {};
      const hasHintDefaults = Object.keys(hintOpp).length > 0 || Object.keys(hintAct).length > 0;
      const maxAiRetries = aiEnabled ? Math.min(5, Math.max(0, Number(options.aiMaxRetries ?? 3))) : 0;
      const maxLocalHintRetries = !aiEnabled && hasHintDefaults ? 1 : 0;
      const maxForceCloseRetries = forceClose ? 2 : 0;
      const maxAttempts = Math.max(
        forceClose ? 3 : 1,
        1 + maxAiRetries + maxLocalHintRetries + maxForceCloseRetries
      );

      const workingItem = { ...item };
      let pendingOppUpdates = {};
      let pendingForceBcSync = new Set();
      const attemptedLocalOppKeys = new Set();
      const aiFixes = [];
      const attemptHistory = [];
      let lastAiDiagnosis = '';
      let nextAction = 'RETRY_NEW_ACTIVITY';

      // In Force Close mode, prefill closing defaults if omitted
      if (forceClose) {
        if (!normalizeText(workingItem.enquiryStatus)) workingItem.enquiryStatus = 'Closed';
        if (!normalizeText(workingItem.followupDone)) workingItem.followupDone = 'CONNECTED';
        if (!normalizeText(workingItem.nextFollowupDate)) workingItem.nextFollowupDate = 'TODAY';
        if (!normalizeText(workingItem.reason)) workingItem.reason = 'Bought Competitor';
        if (!normalizeText(workingItem.subReason)) workingItem.subReason = 'Honda Shine';
        if (!normalizeText(workingItem.remarks)) workingItem.remarks = 'Closed by automation';
      }

      // Apply Dealer Context Hint Activity defaults for empty fields
      for (const [actKey, hintVal] of Object.entries(hintAct)) {
        if (!normalizeText(workingItem[actKey]) && normalizeText(hintVal)) {
          workingItem[actKey] = normalizeText(hintVal);
          aiFixes.push(`${actKey}: "" -> "${workingItem[actKey]}" (dealer hint)`);
        }
      }

      // Apply previously learned batch-session aliases and missing defaults right away
      if (aiEnabled) {
        for (const colDef of ACTIVITY_COLUMNS) {
          const cur = normalizeText(workingItem[colDef.key]);
          if (cur) {
            const learned = lookupSessionActivityAlias(colDef.key, cur);
            if (learned && learned !== cur) {
              workingItem[colDef.key] = learned;
              aiFixes.push(`${colDef.label}: "${cur}" -> "${learned}" (learned)`);
            }
          } else if (aiAutonomousFill && sessionAliases.activityDefaults.has(colDef.key)) {
            const defVal = sessionAliases.activityDefaults.get(colDef.key);
            workingItem[colDef.key] = defVal;
            aiFixes.push(`${colDef.label}: "" -> "${defVal}" (learned)`);
          }
        }
      }

      // Proactively fill empty required Opportunity fields from Dealer Context Hint or confirmed batch-required session cache
      {
        const emptyOppFields = findEmptyRequiredOpportunityFields(false);
        for (const f of emptyOppFields) {
          if (isModelDependentOppField(f.label)) continue;
          const lowerLabel = f.label.toLowerCase();
          const hintVal = hintOpp[f.label];
          const learnedVal =
            (aiAutonomousFill || sessionAliases.requiredOppFields.has(lowerLabel))
              ? sessionAliases.opportunity.get(lowerLabel)
              : '';
          const chosenVal = normalizeText(hintVal || learnedVal);
          if (chosenVal) {
            pendingOppUpdates[f.label] = chosenVal;
            attemptedLocalOppKeys.add(lowerLabel);
            aiFixes.push(`${f.label}: "" -> "${chosenVal}" (${hintVal ? 'dealer hint' : 'learned'})`);
          }
        }
      }

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let stage = 'OPPORTUNITY_PREP';
        let currentActRow = null;
        const attemptAction = nextAction;

        try {
          if (Object.keys(pendingOppUpdates).length > 0) {
            await applyOpportunityUpdates(pendingOppUpdates, forceClose);
            pendingOppUpdates = {};
            await queryEnquiryInDms(enquiryNo, stepDelayMs).catch(() => {});
          }

          // Optional fallback fill for missing required fields on Opportunity Form (#s_S_A2_div), excluding Variant & Color
          // Note: On attempt 0, do not touch clean Opportunity records before creating activity.
          // Only apply if user explicitly configured fallbacks or if previous attempt failed with missing Opp fields.
          const hasExplicitOppFallbacks = Boolean(
            options.oppAge || options.oppGender || options.oppState ||
            options.oppDistrict || options.oppTehsil || options.oppCity ||
            options.oppPin || options.oppOrderType || options.autoPickEmptyOppCombos
          );
          if (hasExplicitOppFallbacks) {
            const oppModified = await fillMissingOpportunityFields(options, false, false);
            if (oppModified) {
              await queryEnquiryInDms(enquiryNo, stepDelayMs).catch(() => {});
            }
          }

          // 3. Create new Activity row (or edit existing Open Activity row if New is disabled / AI requested / Force Close)
          stage = 'ACTIVITY_CREATE';
          let actRow = null;

          if (attemptAction === 'EDIT_EXISTING_ACTIVITY') {
            actRow = findEditableOpenActivityRow();
            if (!actRow) {
              throw new Error('No editable Open Activity row found to update.');
            }
            dispatchMouseClick(actRow);
            await waitForSiebelIdle(10000);
          } else {
            const canFallbackToOpenRow = Boolean(aiAutonomousFill || forceClose);
            const openRowExists = findEditableOpenActivityRow();
            const newActBtn = await waitForCondition(
              () => {
                const btn = document.querySelector(SELECTORS.actNewBtn);
                return isEnabledButton(btn) ? btn : null;
              },
              canFallbackToOpenRow && openRowExists ? 1200 : 4000,
              80,
              ''
            ).catch(() => null);

            if (newActBtn) {
              clickButton(newActBtn);
              await waitForSiebelIdle(12000);

              const earlyErrors = await collectSiebelErrors();
              if (earlyErrors.length > 0) {
                let errText = earlyErrors.join(' | ');
                if (/required fields at enquiry|SBL-EXL-00151/i.test(errText)) {
                  const includeVC = /\b(variant|color)\b/i.test(errText);
                  const missingReq = findEmptyRequiredOpportunityFields(includeVC).map((f) => f.label);
                  if (missingReq.length > 0 && !/\[Empty on Opportunity Form:/i.test(errText)) {
                    errText += ` [Empty on Opportunity Form: ${missingReq.join(', ')}]`;
                  }
                }
                throw new Error(errText);
              }

              actRow = await waitForCondition(
                () => findActiveActivityRow(),
                5000,
                75,
                'New row in Activities List did not become active.'
              );
            } else {
              const fallbackOpenRow = canFallbackToOpenRow ? findEditableOpenActivityRow() : null;
              if (fallbackOpenRow) {
                actRow = fallbackOpenRow;
                dispatchMouseClick(actRow);
                await waitForSiebelIdle(10000);
                aiFixes.push(
                  forceClose
                    ? 'Activity: New disabled -> updated existing Open row (force close)'
                    : 'Activity: New disabled -> updated existing Open row'
                );
              } else {
                throw new Error('Activities List:New button is disabled or hidden.');
              }
            }
          }

          currentActRow = actRow;
          if (stepDelayMs > 0) await sleep(stepDelayMs);

          // 4. Populate configured columns sequentially (refreshing row ref on each cell)
          stage = 'ACTIVITY_FILL';
          for (const colDef of ACTIVITY_COLUMNS) {
            const val = normalizeText(workingItem[colDef.key]);
            if (!val) continue;

            actRow = findActiveActivityRow() || actRow;
            currentActRow = actRow;

            if (colDef.type === 'combo') {
              const resolved = await selectGridComboOption(actRow, colDef, val, Boolean(aiEnabled || forceClose), forceClose);
              if (resolved && resolved.toLowerCase() !== val.toLowerCase()) {
                learnSessionActivityAlias(colDef.key, val, resolved);
                workingItem[colDef.key] = resolved;
                aiFixes.push(`${colDef.label}: "${val}" -> "${resolved}"`);
              }
            } else if (colDef.type === 'date') {
              await setGridDateCell(actRow, colDef, val);
            } else {
              await setGridTextCell(actRow, colDef, val);
            }

            const midErrors = await collectSiebelErrors();
            if (midErrors.length > 0) {
              throw new Error(midErrors.join(' | '));
            }

            if (stepDelayMs > 0) await sleep(stepDelayMs);
          }

          // Flush pending jqGrid cells and verify/sync all populated fields directly into Siebel BusComp before WriteRecord
          actRow = findActiveActivityRow() || actRow;
          currentActRow = actRow;
          const bridgeStateAfterFill = await safeBridgeState();
          const expectedBcFields = [];
          for (const colDef of ACTIVITY_COLUMNS) {
            const rawVal = normalizeText(workingItem[colDef.key]);
            if (!rawVal) continue;
            const cell = findActivityCell(actRow, colDef);
            if (cell && isCellReadOnly(cell)) continue;
            const finalVal =
              colDef.type === 'date'
                ? resolveDateForSiebel(rawVal, bridgeStateAfterFill.dateFormat || '')
                : rawVal;
            if (finalVal) {
              expectedBcFields.push({
                key: colDef.key,
                bcFields: colDef.bcFields,
                value: finalVal,
                isDate: colDef.type === 'date'
              });
            }
          }

          await callBridge(
            'VERIFY_AND_SYNC_ACTIVITY_BC',
            { expectedFields: expectedBcFields, forceKeys: [...pendingForceBcSync] },
            1200
          ).catch(() => {});
          pendingForceBcSync.clear();
          await waitForSiebelIdle(10000);

          // 5. Commit row by clicking Opportunity Form (matching recording step 33)
          stage = 'ACTIVITY_COMMIT';
          const commitTarget = document.querySelector(SELECTORS.commitTarget);
          if (commitTarget) {
            dispatchMouseClick(commitTarget);
          } else {
            if (document.activeElement && document.activeElement !== document.body) {
              document.activeElement.blur();
            }
            await callBridge('COMMIT_ACTIVITY_RECORD', {}, 1500).catch(() => ({ committed: false }));
          }

          await sleep(350);
          await waitForSiebelIdle(15000);

          const commitErrors = await collectSiebelErrors();
          if (commitErrors.length > 0) {
            throw new Error(commitErrors.join(' | '));
          }

          // Learn any missing Activity defaults that helped close this enquiry for subsequent batch rows
          if (aiEnabled && aiAutonomousFill) {
            for (const key of ['followupDone', 'enquiryStatus', 'reason', 'subReason', 'nextFollowupDate']) {
              if (!normalizeText(item?.[key]) && normalizeText(workingItem[key])) {
                learnSessionActivityDefault(key, workingItem[key]);
              }
            }
          }

          const refreshedOppRow = findMatchingOppRow(enquiryNo);
          const updatedOppStatus = readOppRowStatus(refreshedOppRow);
          const refreshedActRow = findActiveActivityRow();
          const statusCol = ACTIVITY_COLUMNS.find((c) => c.key === 'enquiryStatus');
          const actStatusCell = findActivityCell(refreshedActRow, statusCol);
          const actStatus = normalizeText(actStatusCell?.textContent || actStatusCell?.getAttribute('title') || '');

          return {
            status: 'CLOSED',
            previousStatus,
            newStatus: updatedOppStatus || actStatus || workingItem.enquiryStatus || '',
            message:
              aiFixes.length > 0
                ? (aiEnabled ? `Activity saved after AI fix (${aiFixes.join('; ')}).` : `Activity saved after recovery (${aiFixes.join('; ')}).`)
                : 'Activity saved and enquiry updated.',
            aiRecovered: aiFixes.length > 0,
            aiChanges: aiFixes.join('; '),
            aiDiagnosis: lastAiDiagnosis,
            timestamp: new Date().toISOString()
          };
        } catch (attemptErr) {
          const errMsg = attemptErr?.message || String(attemptErr);
          const isRecordModifiedErr = /SBL-DAT-00523|modified by another user/i.test(errMsg);

          // SBL-DAT-00523 recovery: Record was modified by another user (or prior write).
          // Re-query the enquiry in DMS to refresh the client's rowstamp from the DB.
          // If the record is already Closed in DB, return success! Otherwise retry with fresh rowstamp.
          if (isRecordModifiedErr && attempt < maxAttempts - 1) {
            await cancelAnyDirtyModes().catch(() => {});
            await sleep(300);
            const refreshedOpp = await queryEnquiryInDms(enquiryNo, stepDelayMs).catch(() => null);
            if (refreshedOpp) {
              const freshStatus = readOppRowStatus(refreshedOpp);
              if (/^(closed|lost|cancelled|booked)/i.test(freshStatus)) {
                return {
                  status: 'CLOSED',
                  previousStatus,
                  newStatus: freshStatus,
                  message: 'Activity saved and enquiry closed (confirmed after rowstamp refresh).',
                  aiRecovered: aiFixes.length > 0,
                  aiChanges: aiFixes.join('; '),
                  aiDiagnosis: 'Record was modified/closed during commit (SBL-DAT-00523)',
                  timestamp: new Date().toISOString()
                };
              }
            }
            aiFixes.push('SBL-DAT-00523: re-queried enquiry to refresh database rowstamp');
            nextAction = findEditableOpenActivityRow() ? 'EDIT_EXISTING_ACTIVITY' : 'RETRY_NEW_ACTIVITY';
            continue;
          }

          const isOppRelatedErr =
            stage === 'OPPORTUNITY_PREP' ||
            /required fields at enquiry|SBL-EXL-00151|New button is disabled|\b(state|district|tehsil|taluka|city|town|village|pin\s*code|address|gender|age)\b/i.test(
              errMsg
            );
          const needsOppVariantOrColor = /\b(variant|color)\b/i.test(errMsg);
          const isReasonClosureErr = /sbl-aps-00802|reason.*closure/i.test(errMsg);

          // Fast local recovery for Force Close mode or Dealer Context Hint / learned session cache (works even with AI OFF!)
          if (
            (isOppRelatedErr || (forceClose && (isReasonClosureErr || /reason/i.test(errMsg)))) &&
            attempt < maxAttempts - 1 &&
            !isNonRecoverableError(errMsg)
          ) {
            await cancelAnyDirtyModes().catch(() => {});

            let localCount = 0;

            if (forceClose && (isReasonClosureErr || /reason.*closure|reason.*required/i.test(errMsg))) {
              if (!normalizeText(workingItem.reason)) workingItem.reason = 'Bought Competitor';
              if (!normalizeText(workingItem.subReason)) workingItem.subReason = 'Honda Shine';
              pendingForceBcSync.add('reason');
              pendingForceBcSync.add('subReason');
              aiFixes.push('Reason/SubReason: forced Siebel BusComp sync on closure');
              localCount++;
            }

            if (isOppRelatedErr || (forceClose && /SBL-EXL-00151/i.test(errMsg))) {
              const emptyOppNow = findEmptyRequiredOpportunityFields(needsOppVariantOrColor);
              for (const f of emptyOppNow) {
                if (!isModelDependentOppField(f.label)) {
                  sessionAliases.requiredOppFields.add(f.label.toLowerCase());
                }
              }

              for (const f of emptyOppNow) {
                const lowerLabel = f.label.toLowerCase();
                if (attemptedLocalOppKeys.has(lowerLabel)) continue;
                if (isNonClosureOppField(f.label) && !needsOppVariantOrColor) continue;

                // Priority: dealer hint -> session cache -> force close defaults
                let localVal = normalizeText(hintOpp[f.label] || sessionAliases.opportunity.get(lowerLabel));
                if (!localVal && forceClose) {
                  if (/^age/i.test(f.label)) localVal = options.oppAge || '26';
                  else if (/^gender$/i.test(f.label)) localVal = options.oppGender || 'M';
                  else if (/^state$/i.test(f.label)) localVal = options.oppState || 'UTTAR PRADESH';
                  else if (/^district$/i.test(f.label)) localVal = options.oppDistrict || 'LUCKNOW';
                  else if (/tehsil|taluka/i.test(f.label)) localVal = options.oppTehsil || 'MOHANLALGANJ';
                  else if (/city|town|village/i.test(f.label)) localVal = options.oppCity || 'LUCKNOW';
                  else if (/pin\s*code/i.test(f.label)) localVal = options.oppPin || '226001';
                  else if (/booking order type/i.test(f.label)) localVal = options.oppOrderType || 'Retail';
                  else if (/point of contact/i.test(f.label)) localVal = options.oppPointOfContact || 'Self';
                  else if (/existing vehicle/i.test(f.label)) localVal = options.oppExistingVehicle || 'No';
                }

                if (localVal) {
                  pendingOppUpdates[f.label] = localVal;
                  attemptedLocalOppKeys.add(lowerLabel);
                  aiFixes.push(
                    `${f.label}: "" -> "${localVal}" (${hintOpp[f.label] ? 'dealer hint' : forceClose ? 'force close default' : 'learned'})`
                  );
                  localCount++;
                }
              }

              // Also check if errMsg names a specific field in hintOpp even if Siebel didn't mark it icon_req in HTML
              for (const [hintLabel, hintVal] of Object.entries(hintOpp)) {
                const lowerLabel = hintLabel.toLowerCase();
                if (attemptedLocalOppKeys.has(lowerLabel)) continue;
                if (new RegExp(hintLabel.replace(/[^a-z0-9]+/gi, '|'), 'i').test(errMsg)) {
                  pendingOppUpdates[hintLabel] = hintVal;
                  attemptedLocalOppKeys.add(lowerLabel);
                  aiFixes.push(`${hintLabel}: "" -> "${hintVal}" (dealer hint)`);
                  localCount++;
                }
              }

              // If New button was disabled or hidden, or if an Open activity row exists, switch to editing existing Open activity
              if (/New button is disabled/i.test(errMsg) && findEditableOpenActivityRow()) {
                nextAction = 'EDIT_EXISTING_ACTIVITY';
                localCount++;
              }
            }

            if (localCount > 0) {
              if (Object.keys(pendingOppUpdates).length > 0) {
                await applyOpportunityUpdates(pendingOppUpdates, forceClose).catch(() => {});
                pendingOppUpdates = {};
                await queryEnquiryInDms(enquiryNo, stepDelayMs).catch(() => {});
              }
              continue;
            }
          }

          const canRetryWithAi =
            aiEnabled &&
            !sessionAliases.fatalAiError &&
            attempt < maxAttempts - 1 &&
            !isNonRecoverableError(errMsg);

          if (!canRetryWithAi) {
            const finalMsg =
              aiEnabled && sessionAliases.fatalAiError && attempt < maxAttempts - 1 && !isNonRecoverableError(errMsg)
                ? `${errMsg} (AI disabled: ${sessionAliases.fatalAiError})`
                : errMsg;
            const err = new Error(finalMsg);
            err.aiChanges = aiFixes.join('; ');
            err.aiDiagnosis = lastAiDiagnosis;
            throw err;
          }

          // Collect Activity DOM + Siebel BusComp/PM context before rolling back dirty Activity row
          const currentActivityRow = readCurrentActivityRowSnapshot(currentActRow);
          const parsedMismatch = parseMismatchErrorOptions(errMsg);
          const availableActivityOptions = currentActRow
            ? await collectAvailableActivityOptions(currentActRow, errMsg, workingItem, aiAutonomousFill).catch(() => ({}))
            : parsedMismatch
              ? { [parsedMismatch.key]: parsedMismatch.options }
              : {};
          const viewDiagnostics = await callBridge('GET_VIEW_DIAGNOSTICS', {}, 1200).catch(() => ({}));
          viewDiagnostics.hasEditableOpenActivity = Boolean(findEditableOpenActivityRow());

          attemptHistory.push({
            attempt: attempt + 1,
            stage,
            errorMessage: errMsg,
            currentActivityRow,
            actBusCompFields: viewDiagnostics.actBusCompFields || {}
          });

          await cancelAnyDirtyModes().catch(() => {});

          // Only scan Opportunity Form dropdowns when the failure actually involves Opportunity Form / Address / New button
          const opportunityFields = await inspectOpportunityFormState(
            isOppRelatedErr,
            needsOppVariantOrColor,
            errMsg
          ).catch(() => []);

          const aiRes = await chrome.runtime.sendMessage({
            type: 'AI_DIAGNOSE_FAILURE',
            context: {
              stage,
              errorMessage: errMsg,
              enquiryNo,
              dealerHint: aiDealerHint,
              currentItem: workingItem,
              currentActivityRow,
              opportunityFields,
              availableActivityOptions,
              viewDiagnostics,
              previousAiFixes: aiFixes,
              attemptHistory
            }
          });

          if (!aiRes?.ok || !aiRes.plan) {
            if (isFatalAiConfigError(aiRes?.error)) {
              sessionAliases.fatalAiError = aiRes.error;
            }
            const err = new Error(`${errMsg} (AI error: ${aiRes?.error || 'No plan returned'})`);
            err.aiChanges = aiFixes.join('; ');
            err.aiDiagnosis = lastAiDiagnosis;
            throw err;
          }

          const plan = aiRes.plan;
          lastAiDiagnosis = plan.diagnosis || '';
          if (!plan.retryable) {
            const err = new Error(`${errMsg} [AI: ${lastAiDiagnosis}]`);
            err.aiChanges = aiFixes.join('; ');
            err.aiDiagnosis = lastAiDiagnosis;
            throw err;
          }

          let appliedCount = 0;

          for (const forceKey of plan.forceBcSync || []) {
            pendingForceBcSync.add(forceKey);
            aiFixes.push(`${forceKey}: forced BusComp sync`);
            appliedCount++;
          }

          for (const clearKey of plan.clearFields || []) {
            if (normalizeText(workingItem[clearKey])) {
              aiFixes.push(`${clearKey}: "${workingItem[clearKey]}" -> "" (cleared)`);
              workingItem[clearKey] = '';
              appliedCount++;
            }
          }

          const isRequiredFieldDropErr = /SBL-APS-00802|SBL-EXL-00151|SBL-DAT-00498|required/i.test(errMsg);

          for (const [oppLabel, newVal] of Object.entries(plan.opportunityUpdates || {})) {
            if (isNonClosureOppField(oppLabel) && !needsOppVariantOrColor) continue;
            const curField = opportunityFields.find(
              (f) => f.label.toLowerCase() === oppLabel.toLowerCase()
            );
            const prevVal = curField ? curField.value : '';
            const normPrev = normalizeText(prevVal);
            const normNew = normalizeText(newVal);
            const isSameValReSync =
              normPrev === normNew &&
              isRequiredFieldDropErr &&
              (normNew !== '' && (!/^age/i.test(oppLabel) || normNew !== '0'));

            if (normPrev !== normNew || isSameValReSync) {
              pendingOppUpdates[oppLabel] = newVal;
              if (!isModelDependentOppField(oppLabel)) {
                sessionAliases.requiredOppFields.add(oppLabel.toLowerCase());
                if (!prevVal || (/^age/i.test(oppLabel) && prevVal === '0')) {
                  sessionAliases.opportunity.set(oppLabel.toLowerCase(), newVal);
                }
              }
              aiFixes.push(
                isSameValReSync
                  ? `${oppLabel}: forced Siebel sync "${newVal}"`
                  : `${oppLabel}: "${prevVal}" -> "${newVal}"`
              );
              appliedCount++;
            }
          }

          for (const [actKey, newVal] of Object.entries(plan.activityUpdates || {})) {
            const prevVal = normalizeText(workingItem[actKey]);
            const normNewVal = normalizeText(newVal);
            const colMeta = ACTIVITY_COLUMNS.find((c) => c.key === actKey);
            const label = colMeta ? colMeta.label : actKey;

            if (prevVal !== normNewVal) {
              if (colMeta?.type === 'combo' && prevVal) {
                learnSessionActivityAlias(actKey, prevVal, newVal);
              }
              workingItem[actKey] = newVal;
              pendingForceBcSync.add(actKey);
              aiFixes.push(`${label}: "${prevVal}" -> "${newVal}"`);
              appliedCount++;
            } else if (normNewVal) {
              const observedDomVal = normalizeText(currentActivityRow?.[actKey]?.value || '');
              const observedBcVal = normalizeText(viewDiagnostics?.actBusCompFields?.[actKey] || '');
              const notPersistedInSiebel =
                observedDomVal.toLowerCase() !== normNewVal.toLowerCase() ||
                (observedBcVal && observedBcVal.toLowerCase() !== normNewVal.toLowerCase());
              if (notPersistedInSiebel || isRequiredFieldDropErr) {
                pendingForceBcSync.add(actKey);
                aiFixes.push(`${label}: forced Siebel sync "${newVal}"`);
                appliedCount++;
              }
            }
          }

          if (plan.action && plan.action !== attemptAction) {
            nextAction = plan.action;
            appliedCount++;
          }

          if (appliedCount === 0) {
            const err = new Error(`${errMsg} [AI could not find actionable field fix: ${lastAiDiagnosis}]`);
            err.aiChanges = aiFixes.join('; ');
            err.aiDiagnosis = lastAiDiagnosis;
            throw err;
          }
        }
      }
    } catch (err) {
      await cancelAnyDirtyModes().catch(() => {});
      return {
        status: 'FAILED',
        previousStatus,
        newStatus: '',
        message: err?.message || String(err),
        aiRecovered: false,
        aiChanges: err?.aiChanges || '',
        aiDiagnosis: err?.aiDiagnosis || '',
        timestamp: new Date().toISOString()
      };
    } finally {
      await callBridge('SET_ALERT_CAPTURE', { enabled: false }).catch(() => {});
    }
  }

  async function scanDropdownOptions(fieldKey) {
    const colDef = ACTIVITY_COLUMNS.find((c) => c.key === fieldKey && c.type === 'combo');
    if (!colDef) {
      return { ok: false, error: `Unsupported dropdown field: ${fieldKey}` };
    }

    const pageCheck = await checkPageStatus();
    if (!pageCheck.ready) {
      return { ok: false, error: pageCheck.reason };
    }

    const actRow = findActiveActivityRow();
    if (!actRow) {
      return {
        ok: false,
        error: 'Select or click New on an Activity row in DMS first before scanning dropdown options.'
      };
    }

    const cell = findActivityCell(actRow, colDef);
    if (!cell) {
      return { ok: false, error: `Column "${colDef.label}" not found in Activities List.` };
    }

    try {
      const opened = await openCellDropdownMenu(cell, colDef.label);
      const options = opened.options.map((o) => o.label).filter(Boolean);
      if (opened.kind === 'autocomplete' && opened.editor) {
        dispatchKey(opened.editor, 'Escape', 27);
      }
      return { ok: true, fieldKey, label: colDef.label, options };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }

    (async () => {
      try {
        switch (message.type) {
          case 'CHECK_PAGE':
            sendResponse(await checkPageStatus());
            break;
          case 'PROCESS_ENQUIRY':
            sendResponse({
              ok: true,
              result: await processSingleEnquiry(message.item, message.options)
            });
            break;
          case 'SCAN_OPTIONS':
            sendResponse(await scanDropdownOptions(message.fieldKey));
            break;
          case 'RESET_AI_SESSION':
            if (!message.fatalOnly) {
              sessionAliases.activity.clear();
              sessionAliases.activityDefaults.clear();
              sessionAliases.opportunity.clear();
              sessionAliases.requiredOppFields.clear();
            }
            sessionAliases.fatalAiError = '';
            sendResponse({ ok: true });
            break;
          default:
            sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();

    return true;
  });
})();
