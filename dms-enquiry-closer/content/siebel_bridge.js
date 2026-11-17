/**
 * MAIN-world bridge for Hero Connect DMS (Oracle Siebel Open UI).
 * Exposes read-only Siebel runtime state (uiStatus.IsBusy, active view/applets)
 * and run-scoped window.alert capture to the ISOLATED content script via window.postMessage.
 */
(() => {
  if (window.__heroDmsBridgeInstalled) return;
  window.__heroDmsBridgeInstalled = true;

  const REQ_CHANNEL = 'HERO_DMS_BRIDGE_REQ';
  const RES_CHANNEL = 'HERO_DMS_BRIDGE_RES';

  let origAlert = null;
  let alertCaptureActive = false;
  let capturedAlerts = [];

  function setAlertCapture(enabled) {
    if (enabled && !alertCaptureActive) {
      origAlert = window.alert;
      alertCaptureActive = true;
      window.alert = function patchedHeroDmsAlert(msg) {
        capturedAlerts.push({
          text: String(msg ?? '').trim(),
          timestamp: new Date().toISOString()
        });
      };
    } else if (!enabled && alertCaptureActive) {
      if (typeof origAlert === 'function') {
        window.alert = origAlert;
      }
      origAlert = null;
      alertCaptureActive = false;
    }
  }

  function getSiebelState() {
    const app = window.SiebelApp?.S_App || null;
    if (!app) {
      return {
        hasSiebel: false,
        isBusy: false,
        activeView: '',
        applets: [],
        jqueryActive: window.jQuery?.active ?? 0
      };
    }

    let isBusy = false;
    try {
      isBusy = Boolean(app.uiStatus?.IsBusy?.());
    } catch {
      isBusy = false;
    }

    let activeView = '';
    let applets = [];
    let oppRowStatus = '';

    try {
      const view = app.GetActiveView?.();
      activeView = view?.GetName?.() || '';
      const appletMap = view?.GetAppletMap?.() || {};
      applets = Object.keys(appletMap);

      const oppApplet = appletMap['Opportunity List Applet'];
      const oppPM = oppApplet?.GetPModel?.();
      if (oppPM && typeof oppPM.Get === 'function') {
        const recordSet = oppPM.Get('GetRecordSet');
        const selRow = oppPM.Get('GetSelection');
        if (Array.isArray(recordSet) && typeof selRow === 'number' && recordSet[selRow]) {
          oppRowStatus =
            recordSet[selRow]['HHML Enquiry Status'] ||
            recordSet[selRow]['Status'] ||
            '';
        }
      }
    } catch {
      // Non-fatal if Siebel view is still initializing
    }

    return {
      hasSiebel: true,
      isBusy,
      activeView,
      applets,
      oppRowStatus,
      dateFormat: (() => {
        try {
          return app.LocaleObject?.GetDateFormat?.() || '';
        } catch {
          return '';
        }
      })(),
      jqueryActive: window.jQuery?.active ?? 0
    };
  }

  function undoDirtyRecords() {
    const app = window.SiebelApp?.S_App;
    const view = app?.GetActiveView?.();
    if (!app || !view) return { undone: [] };

    const appletMap = view.GetAppletMap?.() || {};
    const entries = Object.entries(appletMap);
    // Roll back child Activities applet before parent applets
    entries.sort(([a], [b]) => {
      const aChild = a.toLowerCase().includes('activity') ? 0 : 1;
      const bChild = b.toLowerCase().includes('activity') ? 0 : 1;
      return aChild - bChild;
    });

    const undone = [];
    for (const [name, applet] of entries) {
      try {
        const pm = applet?.GetPModel?.();
        const bc = pm?.Get?.('GetBusComp') || applet?.GetBusComp?.();
        const pending = Boolean(bc?.IsCommitPending?.() || bc?.GetCommitPending?.());
        if (!pending) continue;

        const canUndo =
          typeof applet.CanInvokeMethod === 'function'
            ? applet.CanInvokeMethod('UndoRecord')
            : typeof pm?.ExecuteMethod === 'function'
              ? pm.ExecuteMethod('CanInvokeMethod', 'UndoRecord')
              : true;

        if (canUndo) {
          if (typeof applet.InvokeMethod === 'function') {
            applet.InvokeMethod('UndoRecord');
          } else if (pm && typeof pm.ExecuteMethod === 'function') {
            pm.ExecuteMethod('InvokeMethod', 'UndoRecord', app.NewPropertySet?.());
          }
          undone.push(name);
        }
      } catch {
        // Continue trying remaining applets
      }
    }
    return { undone };
  }

  function findOpportunityFormApplet(view, inputNames = []) {
    const appletMap = view?.GetAppletMap?.() || {};
    const entries = Object.entries(appletMap);
    for (const [, applet] of entries) {
      try {
        const pm = applet?.GetPModel?.();
        const controls = pm?.Get?.('GetControls') || {};
        for (const ctrl of Object.values(controls)) {
          const inpName = ctrl?.GetInputName?.();
          if (inpName && inputNames.includes(inpName)) {
            return applet;
          }
        }
      } catch {
        // Ignore control lookup errors
      }
    }
    const named = entries.find(([name]) => /opportunity\s*form/i.test(name));
    if (named) return named[1];
    const nonActivity = entries.find(([name]) => !name.toLowerCase().includes('activity') && !name.toLowerCase().includes('list'));
    return nonActivity ? nonActivity[1] : null;
  }

  const OPP_LABEL_TO_BC_FALLBACKS = {
    state: ['State'],
    district: ['District'],
    'tehsil/taluka': ['HHML Tehsil', 'Tehsil/Taluka'],
    'city/town/village': ['Key Contact City4', 'City/Town/Village'],
    'pin code': ['Pin Code', 'Postal Code'],
    'address line 1': ['Address Line 1'],
    'address line 2': ['Address Line 2'],
    'geo area': ['HHML Dealer Area', 'Geo Area'],
    'age(years)': ['HMCL Contact Age', 'Age(Years)', 'Age'],
    gender: ['HMCL MF', 'Gender'],
    'booking order type': ['HMCL Order Type', 'Booking Order Type'],
    'existing vehicle': ['HHML Existing Vehicle', 'Existing Vehicle'],
    'point of contact': ['HHML Point Of Contact', 'Point of Contact'],
    'expected date of purchase': ['HHML Date Of Purchase', 'Expected Date Of Purchase'],
    'exchange required': ['Exchange Required'],
    'finance required': ['Finance Required'],
    'loyalty required': ['Loyalty Required'],
    'model interested in': ['HMCL Sub Model', 'Model Interested In'],
    variant: ['HHML Variant Interested In', 'Variant'],
    color: ['HHML Color Interested In', 'Color']
  };

  function syncOpportunityFields({ fields = [], commit = true } = {}) {
    const $ = window.jQuery;
    const app = window.SiebelApp?.S_App;
    const view = app?.GetActiveView?.();
    const inputNames = fields.map((f) => f.inputName).filter(Boolean);
    const formApplet = view ? findOpportunityFormApplet(view, inputNames) : null;
    const pm = formApplet?.GetPModel?.();
    const bc = pm?.Get?.('GetBusComp') || formApplet?.GetBusComp?.();
    const controls = pm?.Get?.('GetControls') || {};

    const syncedFields = [];
    const controlsByInputName = new Map();
    for (const ctrl of Object.values(controls)) {
      try {
        const inp = ctrl?.GetInputName?.();
        if (inp) controlsByInputName.set(inp, ctrl);
      } catch {
        // Ignore
      }
    }

    for (const item of fields) {
      const val = String(item.value ?? '').trim();
      const inputName = String(item.inputName || '').trim();
      const label = String(item.label || '').trim();

      if (inputName && $ && !item.fromPick) {
        try {
          const $el = $(`#s_S_A2_div [name="${inputName}"], [name="${inputName}"]`).first();
          if ($el.length) {
            if (!item.fromCombo) {
              $el.trigger('focus');
              $el.val(val);
              $el.trigger('input').trigger('change').trigger('blur');
            } else {
              if ($el.val() !== val) $el.val(val);
              $el.trigger('change');
            }
          }
        } catch {
          // Non-fatal jQuery sync error
        }
      }

      const ctrl = inputName ? controlsByInputName.get(inputName) : null;
      if (ctrl && pm && !item.fromPick) {
        try {
          const blurEvt = window.SiebelApp?.Constants?.get?.('PHYEVENT_CONTROL_BLUR') || 'PHYEVENT_CONTROL_BLUR';
          if (typeof pm.OnControlEvent === 'function') {
            pm.OnControlEvent(blurEvt, ctrl, val);
          }
        } catch {
          // Non-fatal PM event error
        }
      }

      if (bc && val) {
        const ctrlField = ctrl?.GetFieldName?.();
        const fallbackFields = OPP_LABEL_TO_BC_FALLBACKS[label.toLowerCase()] || [];
        const candidates = [ctrlField, ...fallbackFields, label].filter(Boolean);
        const cur = readBcFieldValue(bc, null, candidates).value;
        if (!cur || (!item.isDate && cur.toLowerCase() !== val.toLowerCase())) {
          const written = writeBcFieldValue(bc, candidates, val);
          if (written) syncedFields.push(written);
        }
      }
    }

    let committed = false;
    if (commit) {
      const res = commitOpportunityRecord(syncedFields.length > 0);
      committed = res.committed.length > 0;
    }

    return {
      hasBusComp: Boolean(bc),
      syncedFields,
      committed
    };
  }

  function commitOpportunityRecord(forceIfAny = false) {
    const app = window.SiebelApp?.S_App;
    const view = app?.GetActiveView?.();
    if (!app || !view) return { committed: [] };

    const formApplet = findOpportunityFormApplet(view);
    if (!formApplet) return { committed: [] };

    const committed = [];
    try {
      const pm = formApplet.GetPModel?.();
      const bc = pm?.Get?.('GetBusComp') || formApplet.GetBusComp?.();
      const pending = Boolean(bc?.IsCommitPending?.() || bc?.GetCommitPending?.());
      if (pending || forceIfAny) {
        if (typeof formApplet.InvokeMethod === 'function') {
          formApplet.InvokeMethod('WriteRecord');
          committed.push(formApplet.GetName?.() || 'Opportunity Form Applet');
        } else if (pm && typeof pm.ExecuteMethod === 'function') {
          pm.ExecuteMethod('InvokeMethod', 'WriteRecord', app.NewPropertySet?.());
          committed.push(formApplet.GetName?.() || 'Opportunity Form Applet');
        }
      }
    } catch {
      // Ignore
    }
    return { committed };
  }

  function commitActivityRecord() {
    const app = window.SiebelApp?.S_App;
    const view = app?.GetActiveView?.();
    const actApplet = findActivityApplet(view);
    if (!app || !actApplet) return { committed: false };

    try {
      const pm = actApplet.GetPModel?.();
      const bc = pm?.Get?.('GetBusComp') || actApplet.GetBusComp?.();
      const pending = Boolean(bc?.IsCommitPending?.() || bc?.GetCommitPending?.());
      if (!pending) return { committed: false, pending: false };

      if (typeof actApplet.InvokeMethod === 'function') {
        actApplet.InvokeMethod('WriteRecord');
        return { committed: true, pending: true };
      }
      if (pm && typeof pm.ExecuteMethod === 'function') {
        pm.ExecuteMethod('InvokeMethod', 'WriteRecord', app.NewPropertySet?.());
        return { committed: true, pending: true };
      }
    } catch {
      // Non-fatal fallback
    }
    return { committed: false };
  }

  const ACTIVITY_BC_FIELD_MAP = [
    { key: 'followupDone', bcFields: ['HMCL Followup Done', 'Followup Done'] },
    { key: 'enquiryStatus', bcFields: ['Status', 'Enquiry Status'] },
    { key: 'reason', bcFields: ['HHML CloseOut Reason', 'Reason'] },
    { key: 'subReason', bcFields: ['HHML CloseOut Sub Reason', 'Close Out Sub Reason'] },
    { key: 'subReason2', bcFields: ['HHML CloseOut Sub Reason2', 'Close Out Sub Reason2'] },
    { key: 'makeBought', bcFields: ['HHML Make Bought', 'Make Bought'] },
    { key: 'model', bcFields: ['HHML Model', 'Model'] },
    { key: 'nextFollowupDate', bcFields: ['Due', 'Next Followup Date', 'Next Follow-Up Date'] },
    { key: 'expectedPurchaseDate', bcFields: ['HMCL Expected Purchase Date', 'Expected Purchase Date'] },
    { key: 'expectedVisitDate', bcFields: ['HMCL Expected Visit Date', 'Expected Visit Date'] },
    { key: 'followUpSource', bcFields: ['HMCL Follow Up Source', 'Follow Up Source'] },
    { key: 'remarks', bcFields: ['Comment', 'Remarks'] },
    { key: 'followupAction', bcFields: ['Description', 'Follow-Up Action'] }
  ];

  function findActivityApplet(view) {
    const appletMap = view?.GetAppletMap?.() || {};
    if (appletMap['eAuto Contact Opportunity Activity List Applet (SDW)']) {
      return appletMap['eAuto Contact Opportunity Activity List Applet (SDW)'];
    }
    const entry = Object.entries(appletMap).find(([name]) =>
      name.toLowerCase().includes('activity')
    );
    return entry ? entry[1] : null;
  }

  function readBcFieldValue(bc, actRec, candidates = []) {
    for (const fieldName of candidates) {
      if (!fieldName) continue;
      try {
        if (bc && typeof bc.GetFormattedFieldValue === 'function') {
          const v = bc.GetFormattedFieldValue(fieldName);
          if (v !== undefined && v !== null && String(v).trim() !== '') {
            return { fieldName, value: String(v).trim() };
          }
        }
        if (bc && typeof bc.GetFieldValue === 'function') {
          const v = bc.GetFieldValue(fieldName);
          if (v !== undefined && v !== null && String(v).trim() !== '') {
            return { fieldName, value: String(v).trim() };
          }
        }
      } catch {
        // Try next candidate
      }
      if (actRec && actRec[fieldName] !== undefined && String(actRec[fieldName]).trim() !== '') {
        return { fieldName, value: String(actRec[fieldName]).trim() };
      }
    }
    return { fieldName: candidates[0] || '', value: '' };
  }

  function writeBcFieldValue(bc, candidates = [], value = '') {
    const val = String(value ?? '').trim();
    for (const fieldName of candidates) {
      if (!fieldName) continue;
      try {
        if (typeof bc.SetFormattedValue === 'function') {
          bc.SetFormattedValue(fieldName, val);
          return fieldName;
        }
        if (typeof bc.SetFieldValue === 'function') {
          bc.SetFieldValue(fieldName, val);
          return fieldName;
        }
      } catch {
        // Try next field name candidate
      }
    }
    return '';
  }

  function syncGridCellWithJQuery({ gridSelector = '#s_3_l', cellId = '', value = '', commitCell = true } = {}) {
    const $ = window.jQuery;
    let saved = false;
    if (!$) return { saved: false, hasJQuery: false };

    try {
      if (cellId) {
        const $cell = $(document.getElementById(cellId));
        const $ed = $cell.find('input, select, textarea').first();
        if ($ed.length) {
          if (value !== undefined && value !== null && $ed.val() !== String(value)) {
            $ed.val(String(value));
          }
          $ed.trigger('input').trigger('change');
        }
      }

      if (commitCell) {
        const $grid = $(gridSelector);
        if ($grid.length && typeof $grid.jqGrid === 'function') {
          const savedRows = $grid.getGridParam?.('savedRow');
          if (Array.isArray(savedRows) && savedRows.length > 0) {
            // Save all pending edited cells in order so no cell skips GridBeforeSaveCell/InvokeColumnChange
            while (savedRows.length > 0) {
              const entry = savedRows[savedRows.length - 1];
              const prevLen = savedRows.length;
              $grid.jqGrid('saveCell', entry.id, entry.ic);
              saved = true;
              if (savedRows.length >= prevLen) break;
            }
          }
        }
      }
    } catch {
      // Non-fatal fallback if jqGrid cell save throws during navigation
    }

    return { saved, hasJQuery: true };
  }

  function setActivityBusCompFields({ updates = [], force = false } = {}) {
    const app = window.SiebelApp?.S_App;
    const view = app?.GetActiveView?.();
    const actApplet = findActivityApplet(view);
    if (!app || !actApplet) return { updated: [] };

    const pm = actApplet.GetPModel?.();
    const bc = pm?.Get?.('GetBusComp') || actApplet.GetBusComp?.();
    if (!bc) return { updated: [] };

    const updated = [];
    for (const item of updates) {
      const candidates = Array.isArray(item.bcFields) ? item.bcFields : [item.bcField];
      const val = String(item.value ?? '').trim();
      const existing = readBcFieldValue(bc, null, candidates).value;
      if (!force && existing && existing.toLowerCase() === val.toLowerCase()) {
        continue;
      }
      const written = writeBcFieldValue(bc, candidates, val);
      if (written) updated.push(written);
    }
    return { updated };
  }

  function verifyAndSyncActivityBc({ expectedFields = [], forceKeys = [] } = {}) {
    syncGridCellWithJQuery({ gridSelector: '#s_3_l', commitCell: true });

    const app = window.SiebelApp?.S_App;
    const view = app?.GetActiveView?.();
    const actApplet = findActivityApplet(view);
    if (!app || !actApplet) {
      return { hasBusComp: false, syncedFields: [], currentFields: {} };
    }

    const pm = actApplet.GetPModel?.();
    const bc = pm?.Get?.('GetBusComp') || actApplet.GetBusComp?.();
    const actRS = pm?.Get?.('GetRecordSet');
    const actSel = pm?.Get?.('GetSelection');
    const actRec = Array.isArray(actRS) && typeof actSel === 'number' ? actRS[actSel] : null;
    const canWriteBc = Boolean(bc && (typeof bc.SetFormattedValue === 'function' || typeof bc.SetFieldValue === 'function'));

    const forceSet = new Set(Array.isArray(forceKeys) ? forceKeys : []);
    const currentFields = {};
    const syncedFields = [];

    for (const item of expectedFields) {
      const key = item.key;
      const candidates = Array.isArray(item.bcFields) && item.bcFields.length > 0
        ? item.bcFields
        : ACTIVITY_BC_FIELD_MAP.find((m) => m.key === key)?.bcFields || [];
      const cur = readBcFieldValue(bc, actRec, candidates).value;
      currentFields[key] = cur;

      const wanted = String(item.value ?? '').trim();
      if (!wanted || !canWriteBc) continue;

      const mismatch = !cur || (!item.isDate && cur.toLowerCase() !== wanted.toLowerCase());
      if (mismatch || forceSet.has(key)) {
        const written = writeBcFieldValue(bc, candidates, wanted);
        if (written) {
          syncedFields.push(key);
          currentFields[key] = readBcFieldValue(bc, actRec, candidates).value || wanted;
        }
      }
    }

    return {
      hasBusComp: canWriteBc,
      isCommitPending: Boolean(bc?.IsCommitPending?.() || bc?.GetCommitPending?.()),
      currentFields,
      syncedFields
    };
  }

  function getViewDiagnostics() {
    const app = window.SiebelApp?.S_App;
    const view = app?.GetActiveView?.();
    if (!app || !view) return { hasSiebel: false };

    const appletMap = view.GetAppletMap?.() || {};
    let oppRecord = {};
    let actRecord = {};
    let actBusCompFields = {};
    let actRowCount = 0;
    let canNewActivity = null;
    let actIsCommitPending = false;

    try {
      const oppApplet = appletMap['Opportunity List Applet'];
      const oppPM = oppApplet?.GetPModel?.();
      const oppRS = oppPM?.Get?.('GetRecordSet');
      const oppSel = oppPM?.Get?.('GetSelection');
      if (Array.isArray(oppRS) && typeof oppSel === 'number' && oppRS[oppSel]) {
        const rec = oppRS[oppSel];
        oppRecord = {
          Enquiry: rec['Enquiry #'] || rec['Enquiry_'] || rec['Id'] || '',
          Status: rec['HHML Enquiry Status'] || rec['Status'] || '',
          BookingType: rec['HMCL Booking Type'] || '',
          PrimaryModel: rec['HHML Primary Model'] || '',
          Variant: rec['HHML Primary Vehicle Variant'] || '',
          Color: rec['HHML Primary Vehicle Color'] || '',
          ResponsibleDSE: rec['HHML Responsible DSE'] || ''
        };
      }
    } catch {
      // Ignore PM access errors
    }

    try {
      const actApplet = findActivityApplet(view);
      if (actApplet) {
        if (typeof actApplet.CanInvokeMethod === 'function') {
          canNewActivity = Boolean(actApplet.CanInvokeMethod('NewRecord'));
        }
        const actPM = actApplet.GetPModel?.();
        const bc = actPM?.Get?.('GetBusComp') || actApplet.GetBusComp?.();
        actIsCommitPending = Boolean(bc?.IsCommitPending?.() || bc?.GetCommitPending?.());
        const actRS = actPM?.Get?.('GetRecordSet');
        const actSel = actPM?.Get?.('GetSelection');
        if (Array.isArray(actRS)) {
          actRowCount = actRS.length;
          if (typeof actSel === 'number' && actRS[actSel]) {
            actRecord = { ...actRS[actSel] };
          }
        }
        for (const meta of ACTIVITY_BC_FIELD_MAP) {
          actBusCompFields[meta.key] = readBcFieldValue(bc, actRecord, meta.bcFields).value;
        }
      }
    } catch {
      // Ignore Activity PM errors
    }

    return {
      hasSiebel: true,
      oppRecord,
      actRowCount,
      actRecord,
      actBusCompFields,
      actIsCommitPending,
      canNewActivity
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== REQ_CHANNEL) return;

    const targetOrigin =
      window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '*';

    try {
      let data = null;
      switch (msg.action) {
        case 'GET_STATE':
          data = getSiebelState();
          break;
        case 'SET_ALERT_CAPTURE':
          setAlertCapture(Boolean(msg.payload?.enabled));
          data = { capturing: alertCaptureActive };
          break;
        case 'POP_ALERTS':
          data = capturedAlerts.slice();
          capturedAlerts = [];
          break;
        case 'UNDO_DIRTY_RECORDS':
          data = undoDirtyRecords();
          break;
        case 'COMMIT_OPPORTUNITY_FORM':
          data = commitOpportunityRecord(Boolean(msg.payload?.force));
          break;
        case 'SYNC_OPPORTUNITY_FIELDS':
          data = syncOpportunityFields(msg.payload || {});
          break;
        case 'COMMIT_ACTIVITY_RECORD':
          data = commitActivityRecord();
          break;
        case 'SYNC_GRID_CELL':
          data = syncGridCellWithJQuery(msg.payload || {});
          break;
        case 'SET_ACTIVITY_BC_FIELDS':
          data = setActivityBusCompFields(msg.payload || {});
          break;
        case 'VERIFY_AND_SYNC_ACTIVITY_BC':
          data = verifyAndSyncActivityBc(msg.payload || {});
          break;
        case 'GET_VIEW_DIAGNOSTICS':
          data = getViewDiagnostics();
          break;
        default:
          throw new Error(`Unknown bridge action: ${msg.action}`);
      }

      window.postMessage(
        { channel: RES_CHANNEL, id: msg.id, ok: true, data },
        targetOrigin
      );
    } catch (err) {
      window.postMessage(
        {
          channel: RES_CHANNEL,
          id: msg.id,
          ok: false,
          error: err?.message || String(err)
        },
        targetOrigin
      );
    }
  });
})();
