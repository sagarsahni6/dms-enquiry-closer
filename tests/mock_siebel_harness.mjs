import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import * as XLSX from 'xlsx';

const ROOT_DIR = process.cwd();
const EXT_DIR = path.join(ROOT_DIR, 'dms-enquiry-closer');

function findBrowserExecutable() {
  // Microsoft Edge and Chromium support CLI --load-extension in automated tests;
  // branded Google Chrome 137+ restricts --load-extension from CLI (Load Unpacked in UI still works).
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Could not find Edge or Chrome executable on this machine.');
}

const MOCK_SIEBEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Calls: Mock Siebel DMS</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; margin: 16px; }
    .applet { border: 1px solid #ccc; padding: 10px; margin-bottom: 12px; }
    .hidden, .siebui-no-display { display: none !important; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
    tr.ui-state-highlight { background: #e8f0fe; }
    .siebui-icon-dropdown { display: inline-block; cursor: pointer; padding: 0 5px; background: #eee; border: 1px solid #aaa; margin-left: 4px; }
    ul.ui-autocomplete { position: fixed; list-style: none; margin: 0; padding: 4px 0; background: #fff; border: 1px solid #888; z-index: 9999; min-width: 180px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    ul.ui-autocomplete li { padding: 4px 10px; cursor: pointer; }
    ul.ui-autocomplete li:hover { background: #e6f2ff; }
    .siebui-error { color: #b91c1c; background: #fee2e2; padding: 6px; margin-bottom: 6px; }
  </style>
</head>
<body>
  <div id="s_S_A1_div" class="applet" title="Opportunities List">
    <h3>Opportunities List</h3>
    <span id="1_c_err" style="display:none;"><div class="siebui-error"></div></span>
    <div>
      <button id="s_1_1_24_0_Ctrl" type="button" title="Opportunities List:Query">Query</button>
      <button id="s_1_1_21_0_Ctrl" type="button" title="Opportunities List:Go" class="siebui-no-display hidden">Go</button>
      <button id="s_1_1_17_0_Ctrl" type="button" title="Opportunities List:Cancel" class="siebui-no-display hidden" disabled>Cancel</button>
    </div>
    <table id="s_1_l">
      <thead>
        <tr>
          <th id="s_1_l_Enquiry_">Enquiry#</th>
          <th id="s_1_l_HHML_Enquiry_Status">Enquiry Status</th>
          <th id="s_1_l_Comments">Comments</th>
        </tr>
      </thead>
      <tbody id="s_1_l_body"></tbody>
    </table>
  </div>

  <div id="S_A2">
    <div id="s_S_A2_div" class="applet" title="Opportunity Form">
      <h3>Opportunity Form</h3>
      <span id="2_c_err" style="display:none;"><div class="siebui-error"></div></span>
      <div class="siebui-applet-content">
        <div>
          <div id="commit_zone" style="padding: 8px; background: #f8fafc;">
            <label>Variant:
              <input type="text" name="s_2_1_145_0" value="Drum" aria-label="Variant&lt;IMG SRC=./images/icon_req.gif&gt;&lt;/IMG&gt;" class="siebui-ctrl-select ui-autocomplete-input" aria-readonly="false" />
              <span class="siebui-icon-dropdown" id="s_2_1_145_0_icon">v</span>
            </label>
            <label>Color:
              <input type="text" name="s_2_1_144_0" value="" aria-label="Color&lt;IMG SRC=./images/icon_req.gif&gt;&lt;/IMG&gt;" class="siebui-ctrl-select ui-autocomplete-input" aria-readonly="false" />
              <span class="siebui-icon-dropdown" id="s_2_1_144_0_icon">v</span>
            </label>
            <label>Age(Years):
              <input type="text" name="s_2_1_167_0" value="26" aria-label="Age(Years)&lt;IMG SRC=./images/icon_req.gif&gt;&lt;/IMG&gt;" class="siebui-ctrl-calc" aria-readonly="false" />
            </label>
            <label>Gender:
              <input type="text" name="s_2_1_168_0" value="M" aria-label="Gender&lt;IMG SRC=./images/icon_req.gif&gt;&lt;/IMG&gt;" class="siebui-ctrl-select ui-autocomplete-input" aria-readonly="false" />
              <span class="siebui-icon-dropdown" id="s_2_1_168_0_icon">v</span>
            </label>
            <label>State:
              <input type="text" name="s_2_1_133_0" value="UTTAR PRADESH" aria-required="true" aria-label="State" class="siebui-ctrl-select ui-autocomplete-input" aria-readonly="false" />
              <span class="siebui-icon-dropdown" id="s_2_1_133_0_icon">v</span>
            </label>
            <label>District:
              <input type="text" name="s_2_1_132_0" value="LUCKNOW" aria-required="true" aria-label="District" class="siebui-ctrl-select ui-autocomplete-input" aria-readonly="false" />
              <span class="siebui-icon-dropdown" id="s_2_1_132_0_icon">v</span>
            </label>
            <label>Tehsil/Taluka:
              <input type="text" name="s_2_1_131_0" value="MOHANLALGANJ" aria-label="Tehsil/Taluka&lt;IMG SRC=./images/icon_req.gif&gt;&lt;/IMG&gt;" class="siebui-ctrl-select ui-autocomplete-input" aria-readonly="false" />
              <span class="siebui-icon-dropdown" id="s_2_1_131_0_icon">v</span>
            </label>
            <label>City/Town/Village:
              <input type="text" name="s_2_1_32_0" value="LUCKNOW" aria-required="true" aria-label="City/Town/Village" class="siebui-ctrl-pick" aria-readonly="false" />
              <span class="siebui-icon-pick" id="s_2_1_32_0_icon">...</span>
            </label>
            <label>Pin Code:
              <input type="text" name="s_2_1_134_0" value="226001" aria-label="Pin Code" class="siebui-ctrl-input" aria-readonly="false" />
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="s_S_A3_div" class="applet" title="Activities List">
    <h3>Activities List</h3>
    <span id="3_c_err" style="display:none;"><div class="siebui-error"></div></span>
    <div>
      <button id="s_3_1_18_0_Ctrl" type="button" title="Activities List:New">New</button>
      <button id="s_3_1_7_0_Ctrl" type="button" title="Activities List:Cancel" disabled style="display:none;">Cancel</button>
    </div>
    <table id="s_3_l">
      <thead>
        <tr>
          <th id="s_3_l_Status">Enquiry Status</th>
          <th id="s_3_l_HMCL_Followup_Done">Followup Done</th>
          <th id="s_3_l_Due">Next Follow-Up Date</th>
          <th id="s_3_l_HHML_CloseOut_Reason">Reason</th>
          <th id="s_3_l_HHML_CloseOut_Sub_Reason">Close Out Sub Reason</th>
          <th id="s_3_l_Comment">Remarks</th>
        </tr>
      </thead>
      <tbody id="s_3_l_body"></tbody>
    </table>
  </div>

  <script>
    (() => {
      const DB = {
        '11365-01-SENQ-0526-1486': { status: 'Open', variant: '', color: '', age: '26', gender: 'M', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', slowQueryMs: 1450, activities: [{ Status: 'Open', HMCL_Followup_Done: 'contacted', HHML_CloseOut_Reason: '', HHML_CloseOut_Sub_Reason: '', Comment: 'Busy' }] },
        '11365-01-SENQ-0526-1487': { status: 'Closed', variant: 'Disc', color: 'MSG', age: '31', gender: 'M', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', activities: [{ Status: 'Closed', HMCL_Followup_Done: 'CONNECTED', HHML_CloseOut_Reason: 'Not Interested', HHML_CloseOut_Sub_Reason: 'Budget Issue', Comment: 'Done' }] },
        '11365-01-SENQ-0526-1489': { status: 'Open', variant: '', color: '', age: '25', gender: 'M', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', activities: [] },
        '11365-01-SENQ-1126-6327': { status: 'Open', variant: '', color: '', age: '0', gender: '', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', activities: [] },
        '11365-01-SENQ-2222-0001': { status: 'Open', variant: '', color: '', age: '', gender: '', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', activities: [] },
        '11365-01-SENQ-2222-0002': { status: 'Open', variant: '', color: '', age: '30', gender: 'M', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', activities: [] },
        '11365-01-SENQ-2222-0003': { status: 'Open', variant: '', color: '', age: '32', gender: 'M', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', disableNewBtn: true, activities: [{ Status: 'Open', HMCL_Followup_Done: 'contacted', Due: '', HHML_CloseOut_Reason: '', HHML_CloseOut_Sub_Reason: '', Comment: '' }] },
        '11365-01-SENQ-2222-0004': { status: 'Open', variant: '', color: '', age: '28', gender: 'M', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', simulate802Once: true, activities: [] },
        '11365-01-SENQ-2222-0005': { status: 'Open', variant: '', color: '', age: '29', gender: 'M', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', activities: [] },
        '11365-01-SENQ-2222-0006': { status: 'Open', variant: '', color: '', age: '33', gender: 'M', state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001', activities: [] },
        '11365-01-SENQ-3333-0001': { status: 'Open', variant: '', color: '', age: '', gender: 'M', state: '', district: '', tehsil: '', city: '', pin: '', activities: [] },
        '11365-01-SENQ-3333-0002': { status: 'Open', variant: '', color: '', age: '', gender: 'M', state: 'UTTAR PRADESH', district: '', tehsil: '', city: '', pin: '', activities: [] }
      };

      const LOVS = {
        s_2_1_145_0: ['Drum', 'Disc'],
        s_2_1_144_0: ['MSG'],
        s_2_1_168_0: ['M', 'F'],
        s_2_1_133_0: ['DELHI', 'MAHARASHTRA', 'UTTAR PRADESH'],
        s_2_1_132_0: (rec) => (rec?.state === 'UTTAR PRADESH' ? ['AGRA', 'LUCKNOW'] : []),
        s_2_1_131_0: (rec) => (rec?.district === 'LUCKNOW' ? ['MOHANLALGANJ', 'MALIHABAD'] : []),
        HMCL_Followup_Done: ['CONNECTED', 'Not Contacted', 'Call Later'],
        Status: ['Open', 'Closed', 'Lost'],
        HHML_CloseOut_Reason: ['Not Interested', 'Bought Competitor', 'Plan Postponed'],
        HHML_CloseOut_Sub_Reason: (draft) => {
          if (draft.HHML_CloseOut_Reason === 'Bought Competitor') {
            return ['Honda Shine', 'TVS Raider'];
          }
          if (draft.HHML_CloseOut_Reason === 'Not Interested') {
            return ['Budget Issue', 'No Response'];
          }
          return ['Next Month'];
        }
      };

      let busy = false;
      let queryMode = false;
      let activeEnquiry = '11365-01-SENQ-0526-1486';
      let draftActivity = null;
      let uiIdCounter = 950;
      let activeMenu = null;

      window.__MOCK_SAVED_LOG = [];
      window.__MOCK_UNDO_COUNT = 0;

      const bcFieldMap = {
        'HMCL Followup Done': 'HMCL_Followup_Done',
        Status: 'Status',
        Due: 'Due',
        'HHML CloseOut Reason': 'HHML_CloseOut_Reason',
        'HHML CloseOut Sub Reason': 'HHML_CloseOut_Sub_Reason',
        Comment: 'Comment'
      };
      const activityBcMock = {
        IsCommitPending: () => Boolean(draftActivity),
        GetFormattedFieldValue: (fld) => {
          const prop = bcFieldMap[fld] || fld;
          return draftActivity ? String(draftActivity[prop] || '') : '';
        },
        SetFormattedValue: (fld, val) => {
          if (!draftActivity) return;
          const prop = bcFieldMap[fld] || fld;
          draftActivity[prop] = val;
        }
      };

      const activityAppletMock = {
        GetPModel: () => ({
          Get: (prop) => {
            if (prop === 'GetBusComp') return activityBcMock;
            if (prop === 'GetRecordSet') return draftActivity ? [draftActivity] : [];
            if (prop === 'GetSelection') return draftActivity ? 0 : -1;
            return null;
          }
        }),
        CanInvokeMethod: (m) => m === 'UndoRecord' && Boolean(draftActivity),
        InvokeMethod: (m) => {
          if (m === 'UndoRecord' && draftActivity) {
            window.__MOCK_UNDO_COUNT++;
            draftActivity = null;
            document.getElementById('s_3_1_18_0_Ctrl').disabled = false;
            renderActTable();
          }
        }
      };

      window.SiebelApp = {
        S_App: {
          uiStatus: {
            IsBusy: () => busy
          },
          LocaleObject: {
            GetDateFormat: () => 'DD/MM/YYYY'
          },
          GetActiveView: () => ({
            GetName: () => 'HHML eAuto Contact Opportunity Activities View (SDW)',
            GetAppletMap: () => ({
              'Opportunity List Applet': {},
              'eAuto Contact Opportunity Activity List Applet (SDW)': activityAppletMock
            })
          })
        }
      };

      function withBusy(delayMs, fn) {
        busy = true;
        setTimeout(() => {
          try {
            fn();
          } finally {
            busy = false;
          }
        }, delayMs);
      }

      function closeActiveMenu() {
        if (activeMenu) {
          activeMenu.remove();
          activeMenu = null;
        }
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeActiveMenu();
      });

      function setInlineError(spanId, msg) {
        const span = document.getElementById(spanId);
        span.querySelector('.siebui-error').textContent = msg || '';
        span.style.display = msg ? 'block' : 'none';
      }

      function renderOppTable(filterId = null) {
        const tbody = document.getElementById('s_1_l_body');
        tbody.innerHTML = '';

        if (queryMode) {
          const tr = document.createElement('tr');
          tr.id = '1';
          tr.className = 'jqgrow';
          tr.innerHTML = '<td id="1_s_1_l_Enquiry_"><input id="1_Enquiry_" name="Enquiry_" type="text" /></td><td></td><td></td>';
          tbody.appendChild(tr);
          const inp = document.getElementById('1_Enquiry_');
          inp.focus();
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') executeQuery();
          });
          return;
        }

        const keys = filterId === null ? [activeEnquiry] : (DB[filterId] ? [filterId] : []);
        activeEnquiry = keys[0] || '';
        const vInput = document.querySelector('input[name="s_2_1_145_0"]');
        const cInput = document.querySelector('input[name="s_2_1_144_0"]');
        const aInput = document.querySelector('input[name="s_2_1_167_0"]');
        const gInput = document.querySelector('input[name="s_2_1_168_0"]');
        const sInput = document.querySelector('input[name="s_2_1_133_0"]');
        const dInput = document.querySelector('input[name="s_2_1_132_0"]');
        const tInput = document.querySelector('input[name="s_2_1_131_0"]');
        const cityInput = document.querySelector('input[name="s_2_1_32_0"]');
        const pinInput = document.querySelector('input[name="s_2_1_134_0"]');
        if (activeEnquiry && DB[activeEnquiry]) {
          vInput.value = DB[activeEnquiry].variant || '';
          cInput.value = DB[activeEnquiry].color || '';
          aInput.value = DB[activeEnquiry].age || '';
          gInput.value = DB[activeEnquiry].gender || '';
          sInput.value = DB[activeEnquiry].state || '';
          dInput.value = DB[activeEnquiry].district || '';
          tInput.value = DB[activeEnquiry].tehsil || '';
          cityInput.value = DB[activeEnquiry].city || '';
          pinInput.value = DB[activeEnquiry].pin || '';
          document.getElementById('s_3_1_18_0_Ctrl').disabled = Boolean(DB[activeEnquiry].disableNewBtn);
        } else {
          vInput.value = '';
          cInput.value = '';
          aInput.value = '';
          gInput.value = '';
          sInput.value = '';
          dInput.value = '';
          tInput.value = '';
          cityInput.value = '';
          pinInput.value = '';
        }
        for (const k of keys) {
          const rec = DB[k];
          const tr = document.createElement('tr');
          tr.id = '1';
          tr.className = 'jqgrow ui-state-highlight';
          tr.setAttribute('aria-selected', 'true');
          tr.innerHTML =
            '<td id="1_s_1_l_Enquiry_" title="' + k + '"><a>' + k + '</a></td>' +
            '<td id="1_s_1_l_HHML_Enquiry_Status" title="' + rec.status + '">' + rec.status + '</td>' +
            '<td id="1_s_1_l_Comments"></td>';
          tbody.appendChild(tr);
        }
      }

      function renderActTable() {
        const tbody = document.getElementById('s_3_l_body');
        tbody.innerHTML = '';
        const list = activeEnquiry && DB[activeEnquiry] ? DB[activeEnquiry].activities : [];
        const rows = draftActivity ? [draftActivity, ...list] : list;

        rows.forEach((act, idx) => {
          const rowNum = idx + 1;
          const isDraft = Boolean(draftActivity && idx === 0);
          const tr = document.createElement('tr');
          tr.id = String(rowNum);
          tr.className = 'jqgrow' + (idx === 0 ? ' ui-state-highlight' : '');
          if (idx === 0) tr.setAttribute('aria-selected', 'true');

          const cols = ['Status', 'HMCL_Followup_Done', 'Due', 'HHML_CloseOut_Reason', 'HHML_CloseOut_Sub_Reason', 'Comment'];
          for (const col of cols) {
            const td = document.createElement('td');
            td.id = rowNum + '_s_3_l_' + col;
            td.setAttribute('aria-describedby', 's_3_l_' + col);
            td.textContent = act[col] || '';
            if (isDraft || (idx === 0 && activeEnquiry && DB[activeEnquiry]?.disableNewBtn)) {
              td.addEventListener('click', () => {
                if (!draftActivity && activeEnquiry && DB[activeEnquiry]?.disableNewBtn) {
                  draftActivity = act;
                }
                activateCellEditor(td, col);
              });
            }
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        });
      }

      function activateCellEditor(td, col) {
        if (!draftActivity) return;
        if (td.querySelector('input')) return;
        td.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = draftActivity[col] || '';
        input.addEventListener('input', () => {
          draftActivity[col] = input.value;
        });
        input.addEventListener('change', () => {
          draftActivity[col] = input.value;
        });
        if (col === 'Due') {
          input.addEventListener('blur', () => {
            draftActivity[col] = input.value;
          });
        }
        td.appendChild(input);

        if (LOVS[col]) {
          const icon = document.createElement('span');
          icon.className = 'siebui-icon-dropdown';
          icon.id = 's_3_2_' + (++uiIdCounter) + '_0_icon';
          icon.textContent = 'v';
          icon.addEventListener('click', (e) => {
            e.stopPropagation();
            closeActiveMenu();
            withBusy(35, () => {
              const opts = typeof LOVS[col] === 'function' ? LOVS[col](draftActivity) : LOVS[col];
              const ul = document.createElement('ul');
              ul.className = 'ui-autocomplete ui-menu';
              const rect = icon.getBoundingClientRect();
              ul.style.left = rect.left + 'px';
              ul.style.top = (rect.bottom + 2) + 'px';
              for (const optText of opts) {
                const li = document.createElement('li');
                li.className = 'ui-menu-item';
                li.id = 'ui-id-' + (++uiIdCounter);
                const a = document.createElement('a');
                a.textContent = optText;
                li.appendChild(a);
                li.addEventListener('click', (ev) => {
                  ev.stopPropagation();
                  draftActivity[col] = optText;
                  input.value = optText;
                  closeActiveMenu();
                });
                ul.appendChild(li);
              }
              document.body.appendChild(ul);
              activeMenu = ul;
            });
          });
          td.appendChild(icon);
        }
      }

      function setQueryButtons(inQuery) {
        document.getElementById('s_1_1_21_0_Ctrl').classList.toggle('hidden', !inQuery);
        document.getElementById('s_1_1_21_0_Ctrl').classList.toggle('siebui-no-display', !inQuery);
        const cancelBtn = document.getElementById('s_1_1_17_0_Ctrl');
        cancelBtn.classList.toggle('hidden', !inQuery);
        cancelBtn.classList.toggle('siebui-no-display', !inQuery);
        cancelBtn.disabled = !inQuery;
      }

      let queryInFlight = false;
      function executeQuery() {
        if (queryInFlight) {
          window.alert('We are unable to process your request. This is most likely because you used the browser BACK or REFRESH button to get to this point.(SBL-UIF-00335)');
          return;
        }
        const val = (document.getElementById('1_Enquiry_')?.value || '').trim();
        const delayMs = DB[val]?.slowQueryMs || 40;
        setInlineError('1_c_err', '');
        queryInFlight = true;
        withBusy(delayMs, () => {
          queryInFlight = false;
          queryMode = false;
          setQueryButtons(false);
          renderOppTable(val);
          renderActTable();
        });
      }

      document.getElementById('s_1_1_24_0_Ctrl').addEventListener('click', () => {
        setInlineError('3_c_err', '');
        withBusy(35, () => {
          queryMode = true;
          setQueryButtons(true);
          renderOppTable();
        });
      });

      document.getElementById('s_1_1_21_0_Ctrl').addEventListener('click', executeQuery);

      document.getElementById('s_1_1_17_0_Ctrl').addEventListener('click', () => {
        withBusy(25, () => {
          queryMode = false;
          setQueryButtons(false);
          renderOppTable(activeEnquiry);
        });
      });

      // Wire Opportunity Form inputs + dropdown icons
      window.__MOCK_DB = DB;
      const oppVariantInput = document.querySelector('input[name="s_2_1_145_0"]');
      const oppColorInput = document.querySelector('input[name="s_2_1_144_0"]');
      const oppAgeInput = document.querySelector('input[name="s_2_1_167_0"]');
      const oppGenderInput = document.querySelector('input[name="s_2_1_168_0"]');
      const oppStateInput = document.querySelector('input[name="s_2_1_133_0"]');
      const oppDistrictInput = document.querySelector('input[name="s_2_1_132_0"]');
      const oppTehsilInput = document.querySelector('input[name="s_2_1_131_0"]');
      const oppCityInput = document.querySelector('input[name="s_2_1_32_0"]');
      const oppPinInput = document.querySelector('input[name="s_2_1_134_0"]');

      function wireOppCombo(input, iconId, dbField, lovKey) {
        const icon = document.getElementById(iconId);
        input.addEventListener('change', () => {
          if (activeEnquiry && DB[activeEnquiry]) DB[activeEnquiry][dbField] = input.value;
        });
        icon.addEventListener('click', (e) => {
          e.stopPropagation();
          closeActiveMenu();
          withBusy(30, () => {
            const opts = typeof LOVS[lovKey] === 'function' ? LOVS[lovKey](DB[activeEnquiry]) : LOVS[lovKey];
            const ul = document.createElement('ul');
            ul.className = 'ui-autocomplete ui-menu';
            const rect = icon.getBoundingClientRect();
            ul.style.left = rect.left + 'px';
            ul.style.top = (rect.bottom + 2) + 'px';
            for (const optText of opts) {
              const li = document.createElement('li');
              li.className = 'ui-menu-item';
              li.id = 'ui-id-' + (++uiIdCounter);
              const a = document.createElement('a');
              a.textContent = optText;
              li.appendChild(a);
              li.addEventListener('click', (ev) => {
                ev.stopPropagation();
                input.value = optText;
                if (activeEnquiry && DB[activeEnquiry]) DB[activeEnquiry][dbField] = optText;
                closeActiveMenu();
              });
              ul.appendChild(li);
            }
            document.body.appendChild(ul);
            activeMenu = ul;
          });
        });
      }

      wireOppCombo(oppVariantInput, 's_2_1_145_0_icon', 'variant', 's_2_1_145_0');
      wireOppCombo(oppColorInput, 's_2_1_144_0_icon', 'color', 's_2_1_144_0');
      wireOppCombo(oppGenderInput, 's_2_1_168_0_icon', 'gender', 's_2_1_168_0');
      wireOppCombo(oppStateInput, 's_2_1_133_0_icon', 'state', 's_2_1_133_0');
      wireOppCombo(oppDistrictInput, 's_2_1_132_0_icon', 'district', 's_2_1_132_0');
      wireOppCombo(oppTehsilInput, 's_2_1_131_0_icon', 'tehsil', 's_2_1_131_0');

      document.getElementById('s_2_1_32_0_icon').addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = document.getElementById('mock-city-pick-dialog');
        if (existing) existing.remove();
        const dlg = document.createElement('div');
        dlg.id = 'mock-city-pick-dialog';
        dlg.className = 'ui-dialog';
        dlg.style.cssText = 'position:fixed;top:120px;left:180px;background:#fff;border:2px solid #555;padding:12px;z-index:10000;';
        let selectedCity = '';
        dlg.innerHTML =
          '<div class="ui-dialog-title">Pick City/Town/Village</div>' +
          '<div class="ui-dialog-content"><table class="ui-jqgrid-btable"><tbody>' +
          '<tr class="jqgrow" id="city_1"><td>AGRA</td></tr>' +
          '<tr class="jqgrow" id="city_2"><td>LUCKNOW</td></tr>' +
          '</tbody></table></div>' +
          '<div><button type="button" id="mockPickOkBtn">OK</button><button type="button" id="mockPickCancelBtn">Cancel</button></div>';
        document.body.appendChild(dlg);
        dlg.querySelectorAll('tr.jqgrow').forEach((tr) => {
          tr.addEventListener('click', () => {
            selectedCity = tr.textContent.trim();
            dlg.querySelectorAll('tr.jqgrow').forEach((r) => r.classList.remove('ui-state-highlight'));
            tr.classList.add('ui-state-highlight');
          });
        });
        dlg.querySelector('#mockPickOkBtn').addEventListener('click', () => {
          if (selectedCity) {
            oppCityInput.value = selectedCity;
            if (activeEnquiry && DB[activeEnquiry]) DB[activeEnquiry].city = selectedCity;
          }
          dlg.remove();
        });
        dlg.querySelector('#mockPickCancelBtn').addEventListener('click', () => dlg.remove());
      });

      oppPinInput.addEventListener('change', () => {
        if (activeEnquiry && DB[activeEnquiry]) DB[activeEnquiry].pin = oppPinInput.value;
      });
      oppPinInput.addEventListener('blur', () => {
        if (activeEnquiry && DB[activeEnquiry]) DB[activeEnquiry].pin = oppPinInput.value;
      });

      oppAgeInput.addEventListener('change', () => {
        if (activeEnquiry && DB[activeEnquiry]) DB[activeEnquiry].age = oppAgeInput.value;
      });
      oppAgeInput.addEventListener('blur', () => {
        if (activeEnquiry && DB[activeEnquiry]) DB[activeEnquiry].age = oppAgeInput.value;
      });

      document.getElementById('s_3_1_18_0_Ctrl').addEventListener('click', () => {
        setInlineError('3_c_err', '');
        const rec = DB[activeEnquiry];
        if (rec && (!rec.age || rec.age === '0')) {
          window.alert('Age is required Field(SBL-EXL-00151)');
          return;
        }
        if (rec && (!rec.gender || !rec.state || !rec.district || !rec.tehsil || !rec.city)) {
          window.alert('Please fill all Required fields at Enquiry before creating Follow-Up Record. (SBL-EXL-00151)');
          return;
        }
        withBusy(40, () => {
          draftActivity = {
            Status: 'Open',
            HMCL_Followup_Done: 'contacted',
            Due: '',
            HHML_CloseOut_Reason: '',
            HHML_CloseOut_Sub_Reason: '',
            Comment: ''
          };
          // Siebel disables New while an uncommitted New row is active
          document.getElementById('s_3_1_18_0_Ctrl').disabled = true;
          renderActTable();
        });
      });

      document.getElementById('s_3_1_7_0_Ctrl').addEventListener('click', () => {
        closeActiveMenu();
        withBusy(25, () => {
          draftActivity = null;
          document.getElementById('s_3_1_18_0_Ctrl').disabled = false;
          const cancelBtn = document.getElementById('s_3_1_7_0_Ctrl');
          cancelBtn.disabled = true;
          cancelBtn.style.display = 'none';
          renderActTable();
        });
      });

      document.getElementById('s_S_A2_div').addEventListener('click', () => {
        if (!draftActivity || !activeEnquiry) return;
        closeActiveMenu();
        if (!draftActivity.Due) {
          window.alert('Next Followup Date should Not be NULL(SBL-EXL-00151)');
          return;
        }
        if (draftActivity.Comment === 'TRIGGER_ALERT') {
          window.alert('Simulated Siebel validation alert on Remarks!');
          return;
        }
        if (DB[activeEnquiry]?.simulate523Once) {
          DB[activeEnquiry].simulate523Once = false;
          window.alert('The selected record has been modified by another user since it was retrieved. Please continue.(SBL-DAT-00523)');
          return;
        }
        if (DB[activeEnquiry]?.simulate802Once) {
          DB[activeEnquiry].simulate802Once = false;
          window.alert("Please enter 'Reason' for Closure. (SBL-APS-00802)");
          return;
        }
        if (!draftActivity.HHML_CloseOut_Reason) {
          setInlineError('3_c_err', 'Reason is required when closing an enquiry.');
          return;
        }
        withBusy(45, () => {
          DB[activeEnquiry].activities.unshift({ ...draftActivity });
          DB[activeEnquiry].status = draftActivity.Status;
          window.__MOCK_SAVED_LOG.push({ enquiryNo: activeEnquiry, ...draftActivity });
          draftActivity = null;
          document.getElementById('s_3_1_18_0_Ctrl').disabled = false;
          const cancelBtn = document.getElementById('s_3_1_7_0_Ctrl');
          cancelBtn.disabled = true;
          cancelBtn.style.display = 'none';
          renderOppTable(activeEnquiry);
          renderActTable();
        });
      });

      renderOppTable(activeEnquiry);
      renderActTable();
    })();
  </script>
</body>
</html>`;

async function runE2E() {
  const browserPath = findBrowserExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-dms-ext-test-'));
  const xlsxPath = path.join(userDataDir, 'test_batch.xlsx');

  // Create real .xlsx input workbook covering:
  // 1) Normal open enquiry (using defaults)
  // 2) Already-closed enquiry (SKIPPED)
  // 3) Missing enquiry (FAILED)
  // 4) Open enquiry with TRIGGER_ALERT (FAILED via captured window.alert + clean recovery)
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Enquiry#', 'Reason', 'Close Out Sub Reason', 'Remarks'],
    ['11365-01-SENQ-0526-1486', '', '', 'Closed by automation'],
    ['11365-01-SENQ-0526-1487', '', '', 'Should skip'],
    ['11365-01-SENQ-9999-0000', '', '', 'Should fail missing'],
    ['11365-01-SENQ-0526-1489', '', '', 'TRIGGER_ALERT'],
    ['11365-01-SENQ-1126-6327', '', '', 'Closed after fallback fill']
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Batch');
  XLSX.writeFile(wb, xlsxPath);

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: browserPath,
    headless: false,
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`
    ]
  });

  try {
    // Route exact production Hero DMS URL to our local Siebel mock
    await context.route('https://connect.heromotocorp.biz/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: MOCK_SIEBEL_HTML
      });
    });

    const dmsPage = await context.newPage();
    await dmsPage.goto('https://connect.heromotocorp.biz/siebel/app/edealerHMCL/enu/');
    await dmsPage.waitForSelector('#s_1_1_24_0_Ctrl');

    // Resolve extension ID from background service worker
    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extId = new URL(sw.url()).host;
    assert.ok(extId, 'Extension ID should resolve from service worker URL');

    // Open extension Side Panel UI page
    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extId}/sidepanel.html`);

    // Wait for Side Panel to connect to the open Mock Hero DMS tab
    await panelPage.waitForFunction(() => {
      const banner = document.getElementById('connectionText')?.textContent || '';
      return banner.includes('Connected: Hero DMS Enquiry Calls view ready.');
    }, { timeout: 10000 });

    // Upload the .xlsx file
    await panelPage.setInputFiles('#fileInput', xlsxPath);
    await panelPage.waitForFunction(
      () => document.getElementById('statTotal')?.textContent === '5',
      { timeout: 5000 }
    );

    // Fill default closing values (Followup Done is already prefilled with CONNECTED)
    const followupDefault = await panelPage.inputValue('#defFollowupDone');
    assert.equal(followupDefault, 'CONNECTED');
    await panelPage.fill('#defEnquiryStatus', 'Closed');
    await panelPage.fill('#defReason', 'Bought Competitor');
    await panelPage.fill('#defSubReason', 'Honda Shine');
    await panelPage.click('summary:has-text("Optional Fields")');
    await panelPage.fill('#stepDelayMs', '30');
    await panelPage.locator('#stepDelayMs').dispatchEvent('change');

    // 1) Run Dry Run first (checked by default)
    console.log('--- SCENARIO 1: Dry Run ---');
    assert.equal(await panelPage.isChecked('#dryRun'), true);
    await panelPage.click('#startBtn');

    await panelPage.waitForFunction(() => {
      const done = Number(document.getElementById('statDone')?.textContent || 0);
      const skip = Number(document.getElementById('statSkipped')?.textContent || 0);
      const fail = Number(document.getElementById('statFailed')?.textContent || 0);
      return done + skip + fail === 5;
    }, { timeout: 25000 });

    assert.equal(await panelPage.textContent('#statDone'), '3'); // 1486 + 1489 + 6327 verified
    assert.equal(await panelPage.textContent('#statSkipped'), '1'); // 1487 already Closed
    assert.equal(await panelPage.textContent('#statFailed'), '1'); // 9999 not found

    const dryRowTexts = await panelPage.locator('#queueBody tr').allInnerTexts();
    assert.ok(
      dryRowTexts.some(
        (t) =>
          t.includes('11365-01-SENQ-1126-6327') &&
          t.includes('Warning: empty Opportunity Form fields [Age(Years), Gender]')
      ),
      'Dry Run should warn about missing closure-required Opportunity Form fields (excluding Variant/Color)'
    );

    // Confirm Dry Run did NOT save anything to Siebel
    const savedAfterDry = await dmsPage.evaluate(() => window.__MOCK_SAVED_LOG.length);
    assert.equal(savedAfterDry, 0, 'Dry Run must not commit any Activity rows');

    // 2) Uncheck Dry Run directly after Dry Run and run Live Close (without re-uploading, forceClose unchecked to test manual fallbacks)
    console.log('--- SCENARIO 2: Live Close ---');
    await panelPage.uncheck('#dryRun');
    await panelPage.uncheck('#forceClose');
    await panelPage.click('#startBtn');

    await panelPage.waitForFunction(() => {
      const startDisabled = document.getElementById('startBtn')?.disabled;
      const done = Number(document.getElementById('statDone')?.textContent || 0);
      const skip = Number(document.getElementById('statSkipped')?.textContent || 0);
      const fail = Number(document.getElementById('statFailed')?.textContent || 0);
      return !startDisabled && done === 1 && done + skip + fail === 5;
    }, { timeout: 25000 });

    assert.equal(await panelPage.textContent('#statDone'), '1'); // 1486 closed (even with 1450ms slow query!)
    assert.equal(await panelPage.textContent('#statSkipped'), '1'); // 1487 skipped
    assert.equal(await panelPage.textContent('#statFailed'), '3'); // 9999 missing + 1489 alert + 6327 missing Opportunity fields

    const savedLog = await dmsPage.evaluate(() => window.__MOCK_SAVED_LOG);
    const undoCount = await dmsPage.evaluate(() => window.__MOCK_UNDO_COUNT);
    const now = new Date();
    const expectedToday = [
      String(now.getDate()).padStart(2, '0'),
      String(now.getMonth() + 1).padStart(2, '0'),
      now.getFullYear()
    ].join('/');
    assert.equal(savedLog.length, 1);
    assert.deepEqual(savedLog[0], {
      enquiryNo: '11365-01-SENQ-0526-1486',
      Status: 'Closed',
      HMCL_Followup_Done: 'CONNECTED',
      Due: expectedToday,
      HHML_CloseOut_Reason: 'Bought Competitor',
      HHML_CloseOut_Sub_Reason: 'Honda Shine',
      Comment: 'Closed by automation'
    });
    assert.ok(undoCount >= 1, 'UndoRecord should cleanly undo failed dirty Activity row');

    // Verify captured window.alert message and diagnostic Opportunity Form missing field list
    const rowTexts = await panelPage.locator('#queueBody tr').allInnerTexts();
    assert.ok(
      rowTexts.some((t) => t.includes('11365-01-SENQ-0526-1489') && t.includes('Simulated Siebel validation alert')),
      'Alert validation message should be captured in row details'
    );
    assert.ok(
      rowTexts.some(
        (t) =>
          t.includes('11365-01-SENQ-1126-6327') &&
          t.includes('Age is required Field(SBL-EXL-00151)') &&
          t.includes('[Empty on Opportunity Form: Age(Years), Gender]')
      ),
      'SBL-EXL-00151 error should report missing Opportunity Form field names (excluding Variant/Color)'
    );

    // 2b) Configure Missing Enquiry Form Fallbacks and Retry Failed -> 6327 should now close cleanly!
    console.log('--- SCENARIO 2b: Retry Failed with Manual Fallbacks ---');
    await panelPage.click('summary:has-text("Missing Enquiry Form Fallbacks")');
    await panelPage.fill('#oppAge', '28');
    await panelPage.check('#autoPickEmptyOppCombos');
    await panelPage.click('#retryFailedBtn');

    await panelPage.waitForFunction(() => {
      const startDisabled = document.getElementById('startBtn')?.disabled;
      const done = Number(document.getElementById('statDone')?.textContent || 0);
      return !startDisabled && done === 2;
    }, { timeout: 25000 });

    assert.equal(await panelPage.textContent('#statDone'), '2'); // 1486 + 6327 closed!
    assert.equal(await panelPage.textContent('#statFailed'), '2'); // 9999 + 1489 remain failed
    const dbAfterFallback = await dmsPage.evaluate(() => ({
      e1486: window.__MOCK_DB['11365-01-SENQ-0526-1486'],
      e6327: window.__MOCK_DB['11365-01-SENQ-1126-6327']
    }));
    assert.equal(dbAfterFallback.e1486.variant, '', 'Variant must remain untouched when closing enquiry');
    assert.equal(dbAfterFallback.e1486.color, '', 'Color must remain untouched when closing enquiry');
    assert.equal(dbAfterFallback.e6327.variant, '', 'Variant must not be auto-picked when closing enquiry');
    assert.equal(dbAfterFallback.e6327.color, '', 'Color must not be auto-picked when closing enquiry');

    // 3) Verify Export CSV works
    console.log('--- SCENARIO 3: Export CSV ---');
    const [download] = await Promise.all([
      panelPage.waitForEvent('download'),
      panelPage.click('#exportCsvBtn')
    ]);
    assert.ok(download.suggestedFilename().startsWith('dms_enquiry_results_'), 'CSV export filename should match');

    // 4) Verify Scan Options works when an Activity row is active
    console.log('--- SCENARIO 4: Scan Options ---');
    await dmsPage.click('#s_1_1_24_0_Ctrl');
    await dmsPage.waitForSelector('[id="1_Enquiry_"]');
    await dmsPage.fill('[id="1_Enquiry_"]', '11365-01-SENQ-0526-1489');
    await dmsPage.press('[id="1_Enquiry_"]', 'Enter');
    await dmsPage.waitForTimeout(100);
    await dmsPage.click('#s_3_1_18_0_Ctrl');
    await dmsPage.waitForTimeout(100);

    await panelPage.click('button[data-scan="followupDone"]');
    await panelPage.waitForSelector('#scanResultsBox:not([hidden])', { timeout: 5000 });
    const chipsText = await panelPage.locator('#scanChips').innerText();
    assert.ok(chipsText.includes('CONNECTED'), 'Scanned dropdown chips should contain CONNECTED');

    // 5) AI Auto-Recovery (NVIDIA NIM mock)
    console.log('--- SCENARIO 5: AI Auto-Recovery (NVIDIA NIM) ---');
    let nimDiagnoseCalls = 0;
    await context.route('https://integrate.api.nvidia.com/**', async (route) => {
      if (route.request().url().endsWith('/models')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              { id: 'nvidia/nemotron-3-nano-30b-a3b' },
              { id: 'qwen/qwen3-32b' }
            ]
          })
        });
        return;
      }

      const reqBody = JSON.parse(route.request().postData() || '{}');
      const userMsg = reqBody?.messages?.find((m) => m.role === 'user')?.content || '';

      if (userMsg === 'ping') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            model: reqBody.model || 'nvidia/nemotron-3-nano-30b-a3b',
            choices: [{ message: { content: '{"ok":true}' } }]
          })
        });
        return;
      }

      nimDiagnoseCalls++;
      const ctx = JSON.parse(userMsg);
      let plan;
      if (/Wrong Sub Reason/i.test(ctx.errorMessage)) {
        assert.ok(
          Array.isArray(ctx.availableActivityOptions?.subReason) &&
          ctx.availableActivityOptions.subReason.includes('Honda Shine'),
          'AI context should include scanned dependent subReason options'
        );
        plan = {
          retryable: true,
          diagnosis: 'Selected valid dependent Close Out Sub Reason.',
          opportunityUpdates: {},
          activityUpdates: { subReason: 'Honda Shine' }
        };
      } else if (/SBL-EXL-00151|Required fields at Enquiry/i.test(ctx.errorMessage)) {
        const hasVariant = (ctx.opportunityFields || []).some((f) => f.label === 'Variant');
        const hasColor = (ctx.opportunityFields || []).some((f) => f.label === 'Color');
        assert.equal(hasVariant, false, 'AI context must NOT ask to fill Variant');
        assert.equal(hasColor, false, 'AI context must NOT ask to fill Color');
        const genderField = (ctx.opportunityFields || []).find((f) => f.label === 'Gender');
        assert.ok(
          genderField && Array.isArray(genderField.availableOptions) && genderField.availableOptions.includes('M'),
          'AI context should include empty required Opportunity Form Gender options'
        );
        plan = {
          retryable: true,
          diagnosis: 'Filled missing required Opportunity Form fields.',
          opportunityUpdates: { 'Age(Years)': '29', Gender: 'M' },
          activityUpdates: {}
        };
      } else if (/Simulated Siebel validation alert/i.test(ctx.errorMessage)) {
        plan = {
          retryable: true,
          diagnosis: 'Rewrote Remarks that triggered Siebel validation alert.',
          opportunityUpdates: {},
          activityUpdates: { remarks: 'Closed after AI fix' }
        };
      } else if (/SBL-APS-00802|Please enter 'Reason' for Closure/i.test(ctx.errorMessage)) {
        plan = {
          retryable: true,
          diagnosis: 'Ensure Reason is synced to Siebel BusComp on closure.',
          opportunityUpdates: {},
          activityUpdates: { reason: ctx.currentItem?.reason || 'Bought Competitor' },
          forceBcSync: ['reason']
        };
      } else if (/Reason is required when closing an enquiry/i.test(ctx.errorMessage)) {
        plan = {
          retryable: true,
          diagnosis: 'Supplied missing Reason and Sub Reason autonomously.',
          opportunityUpdates: {},
          activityUpdates: { reason: 'Not Interested', subReason: 'Budget Issue' }
        };
      } else {
        plan = {
          retryable: false,
          diagnosis: 'Unrecoverable error.',
          opportunityUpdates: {},
          activityUpdates: {}
        };
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: reqBody.model || 'meta/llama-3.3-70b-instruct',
          choices: [{ message: { content: JSON.stringify(plan) } }]
        })
      });
    });

    // Clear manual Opportunity fallbacks and forceClose so AI must solve 2222-0001 on its own
    await panelPage.fill('#oppAge', '');
    await panelPage.uncheck('#autoPickEmptyOppCombos');
    await panelPage.uncheck('#forceClose');

    // Configure & test NVIDIA NIM AI
    await panelPage.check('#aiEnabled');
    await panelPage.fill('#nimApiKey', 'nvapi-mock-e2e-key');
    await panelPage.click('#testNimBtn');
    await panelPage.waitForFunction(
      () => (document.getElementById('nimTestStatus')?.textContent || '').includes('Connected'),
      { timeout: 8000 }
    );

    const aiXlsxPath = path.join(userDataDir, 'ai_recovery_batch.xlsx');
    const aiWb = XLSX.utils.book_new();
    const aiWs = XLSX.utils.aoa_to_sheet([
      ['Enquiry#', 'Reason', 'Close Out Sub Reason', 'Remarks'],
      ['11365-01-SENQ-2222-0002', 'Bought Competitor', 'Wrong Sub Reason', 'Test dropdown mismatch'],
      ['11365-01-SENQ-2222-0001', 'Bought Competitor', 'Honda Shine', 'Test missing Opp fields'],
      ['11365-01-SENQ-0526-1489', 'Bought Competitor', 'Honda Shine', 'TRIGGER_ALERT'],
      ['11365-01-SENQ-2222-0003', 'Bought Competitor', 'Honda Shine', 'Test disabled New button open row'],
      ['11365-01-SENQ-9999-0000', 'Bought Competitor', 'Honda Shine', 'Should fail without NIM']
    ]);
    XLSX.utils.book_append_sheet(aiWb, aiWs, 'AI_Batch');
    XLSX.writeFile(aiWb, aiXlsxPath);

    await panelPage.setInputFiles('#fileInput', aiXlsxPath);
    await panelPage.waitForFunction(
      () => document.getElementById('statTotal')?.textContent === '5',
      { timeout: 5000 }
    );
    await panelPage.click('#startBtn');

    await panelPage.waitForFunction(() => {
      const startDisabled = document.getElementById('startBtn')?.disabled;
      const done = Number(document.getElementById('statDone')?.textContent || 0);
      const fail = Number(document.getElementById('statFailed')?.textContent || 0);
      return !startDisabled && done + fail === 5;
    }, { timeout: 30000 });

    const actualDone = await panelPage.textContent('#statDone');
    if (actualDone !== '4') {
      console.error('AI batch rows:', await panelPage.locator('#queueBody tr').allInnerTexts());
    }
    assert.equal(actualDone, '4', 'All 4 recoverable enquiries should close via AI');
    assert.equal(await panelPage.textContent('#statFailed'), '1', 'Only non-existent enquiry should fail');
    assert.equal(nimDiagnoseCalls, 3, 'NIM should be called 3 times (2222-0003 handled via existing Open row, 9999-0000 fast-failed)');

    const aiBadgesCount = await panelPage.locator('.badge-ai').count();
    assert.equal(aiBadgesCount, 4, 'Four rows should display the AI FIXED badge');

    // 6) Advanced AI verification: same-value SBL-APS-00802 retry + batch default learning across rows
    console.log('--- SCENARIO 6: Advanced AI Recovery ---');
    await panelPage.fill('#defReason', '');
    await panelPage.fill('#defSubReason', '');
    nimDiagnoseCalls = 0;

    const advXlsxPath = path.join(userDataDir, 'ai_advanced_batch.xlsx');
    const advWb = XLSX.utils.book_new();
    const advWs = XLSX.utils.aoa_to_sheet([
      ['Enquiry#', 'Reason', 'Close Out Sub Reason', 'Remarks'],
      ['11365-01-SENQ-2222-0004', 'Bought Competitor', 'Honda Shine', 'Test same-value 802 retry'],
      ['11365-01-SENQ-2222-0005', '', '', 'Test blank Reason autonomous fill'],
      ['11365-01-SENQ-2222-0006', '', '', 'Test learned default from row 5']
    ]);
    XLSX.utils.book_append_sheet(advWb, advWs, 'Adv_Batch');
    XLSX.writeFile(advWb, advXlsxPath);

    await panelPage.setInputFiles('#fileInput', advXlsxPath);
    await panelPage.waitForFunction(
      () => document.getElementById('statTotal')?.textContent === '3',
      { timeout: 5000 }
    );
    await panelPage.click('#startBtn');

    await panelPage.waitForFunction(() => {
      const startDisabled = document.getElementById('startBtn')?.disabled;
      const done = Number(document.getElementById('statDone')?.textContent || 0);
      const fail = Number(document.getElementById('statFailed')?.textContent || 0);
      return !startDisabled && done + fail === 3;
    }, { timeout: 30000 });

    const advDone = await panelPage.textContent('#statDone');
    if (advDone !== '3') {
      console.error('Advanced AI batch rows:', await panelPage.locator('#queueBody tr').allInnerTexts());
    }
    assert.equal(advDone, '3', 'Same-value SBL-APS-00802 recovery and learned defaults should close all 3 enquiries');
    assert.equal(nimDiagnoseCalls, 2, 'NIM should only be called twice (row 1 802 forceBcSync + row 2 missing Reason; row 3 auto-heals from session memory)');

    // 7) Dealer Context Hint + Cascading Address Details (State -> District -> Tehsil/Taluka -> City Pick Applet -> Pin Code)
    // Verify it works fast and reliably even with AI turned OFF!
    console.log('--- SCENARIO 7: Dealer Context Hint (AI OFF) ---');
    await panelPage.uncheck('#aiEnabled');
    await panelPage.fill('#defReason', 'Bought Competitor');
    await panelPage.fill('#defSubReason', 'Honda Shine');
    await panelPage.click('summary:has-text("AI Advanced Settings")');
    await panelPage.fill(
      '#aiDealerHint',
      'State: UP, District: Lucknow, Tehsil: Mohanlalganj, City: Lucknow, Pin: 226301, Age: 28'
    );
    nimDiagnoseCalls = 0;

    const hintXlsxPath = path.join(userDataDir, 'dealer_hint_address_batch.xlsx');
    const hintWb = XLSX.utils.book_new();
    const hintWs = XLSX.utils.aoa_to_sheet([
      ['Enquiry#', 'Remarks'],
      ['11365-01-SENQ-3333-0001', 'Missing full address + age'],
      ['11365-01-SENQ-3333-0002', 'Missing district + tehsil + city + age']
    ]);
    XLSX.utils.book_append_sheet(hintWb, hintWs, 'Hint_Batch');
    XLSX.writeFile(hintWb, hintXlsxPath);

    await panelPage.setInputFiles('#fileInput', hintXlsxPath);
    await panelPage.waitForFunction(
      () => document.getElementById('statTotal')?.textContent === '2',
      { timeout: 5000 }
    );
    await panelPage.click('#startBtn');

    await panelPage.waitForFunction(() => {
      const startDisabled = document.getElementById('startBtn')?.disabled;
      const done = Number(document.getElementById('statDone')?.textContent || 0);
      const fail = Number(document.getElementById('statFailed')?.textContent || 0);
      return !startDisabled && done + fail === 2;
    }, { timeout: 30000 });

    const hintDone = await panelPage.textContent('#statDone');
    if (hintDone !== '2') {
      console.error('Dealer Hint batch rows:', await panelPage.locator('#queueBody tr').allInnerTexts());
    }
    assert.equal(hintDone, '2', 'Both address-deficient enquiries should close using Dealer Context Hint');
    assert.equal(nimDiagnoseCalls, 0, 'Dealer Context Hint should resolve address & age locally with 0 NIM calls');

    const dbAfterHint = await dmsPage.evaluate(() => ({
      e1: window.__MOCK_DB['11365-01-SENQ-3333-0001'],
      e2: window.__MOCK_DB['11365-01-SENQ-3333-0002']
    }));
    assert.equal(dbAfterHint.e1.state, 'UTTAR PRADESH');
    assert.equal(dbAfterHint.e1.district, 'LUCKNOW');
    assert.equal(dbAfterHint.e1.tehsil, 'MOHANLALGANJ');
    assert.equal(dbAfterHint.e1.city, 'LUCKNOW');
    assert.equal(dbAfterHint.e1.age, '28');
    assert.equal(dbAfterHint.e1.variant, '');
    assert.equal(dbAfterHint.e1.color, '');
    assert.equal(dbAfterHint.e2.district, 'LUCKNOW');
    assert.equal(dbAfterHint.e2.tehsil, 'MOHANLALGANJ');
    assert.equal(dbAfterHint.e2.city, 'LUCKNOW');

    // 8) Dedicated Force Close Mode verification (Guaranteed closure with AI completely OFF)
    console.log('--- SCENARIO 8: Dedicated Force Close Mode (AI OFF) ---');
    // Resets mock database for:
    // - 2222-0003 (New button disabled, has open activity row)
    // - 2222-0004 (Simulates 802 once)
    // - 2222-0001 (Missing age & gender)
    // - 3333-0001 (Missing full address & age, no dealer hint provided)
    // - 2222-0005 (Blank reason & subReason in file and UI)
    await panelPage.uncheck('#aiEnabled');
    await panelPage.check('#forceClose');
    await panelPage.fill('#aiDealerHint', '');
    await panelPage.locator('#aiDealerHint').dispatchEvent('input');
    await panelPage.locator('#aiDealerHint').dispatchEvent('change');
    await panelPage.fill('#defReason', '');
    await panelPage.locator('#defReason').dispatchEvent('input');
    await panelPage.locator('#defReason').dispatchEvent('change');
    await panelPage.fill('#defSubReason', '');
    await panelPage.locator('#defSubReason').dispatchEvent('input');
    await panelPage.locator('#defSubReason').dispatchEvent('change');
    nimDiagnoseCalls = 0;

    await dmsPage.evaluate(() => {
      window.__MOCK_DB['11365-01-SENQ-2222-0003'] = {
        status: 'Open', variant: '', color: '', age: '32', gender: 'M',
        state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001',
        disableNewBtn: true,
        activities: [{ Status: 'Open', HMCL_Followup_Done: 'contacted', Due: '', HHML_CloseOut_Reason: '', HHML_CloseOut_Sub_Reason: '', Comment: '' }]
      };
      window.__MOCK_DB['11365-01-SENQ-2222-0004'] = {
        status: 'Open', variant: '', color: '', age: '28', gender: 'M',
        state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001',
        simulate802Once: true, activities: []
      };
      window.__MOCK_DB['11365-01-SENQ-2222-0001'] = {
        status: 'Open', variant: '', color: '', age: '', gender: '',
        state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001',
        activities: []
      };
      window.__MOCK_DB['11365-01-SENQ-3333-0001'] = {
        status: 'Open', variant: '', color: '', age: '', gender: 'M',
        state: '', district: '', tehsil: '', city: '', pin: '',
        activities: []
      };
      window.__MOCK_DB['11365-01-SENQ-2222-0005'] = {
        status: 'Open', variant: '', color: '', age: '29', gender: 'M',
        state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001',
        activities: []
      };
      window.__MOCK_DB['11365-01-SENQ-2222-0523'] = {
        status: 'Open', variant: '', color: '', age: '30', gender: 'M',
        state: 'UTTAR PRADESH', district: 'LUCKNOW', tehsil: 'MOHANLALGANJ', city: 'LUCKNOW', pin: '226001',
        simulate523Once: true, activities: []
      };
    });

    const forceXlsxPath = path.join(userDataDir, 'force_close_batch.xlsx');
    const forceWb = XLSX.utils.book_new();
    const forceWs = XLSX.utils.aoa_to_sheet([
      ['Enquiry#', 'Reason', 'Close Out Sub Reason', 'Remarks'],
      ['11365-01-SENQ-2222-0003', 'Bought Competitor', 'Honda Shine', 'Force close disabled New btn'],
      ['11365-01-SENQ-2222-0004', 'Bought Competitor', 'Honda Shine', 'Force close 802 error'],
      ['11365-01-SENQ-2222-0001', 'Bought Competitor', 'Honda Shine', 'Force close missing Opp fields'],
      ['11365-01-SENQ-3333-0001', 'Bought Competitor', 'Honda Shine', 'Force close missing address cascades'],
      ['11365-01-SENQ-2222-0005', '', '', 'Force close blank reason & sub-reason'],
      ['11365-01-SENQ-2222-0523', 'Bought Competitor', 'Honda Shine', 'Force close SBL-DAT-00523 rowstamp error']
    ]);
    XLSX.utils.book_append_sheet(forceWb, forceWs, 'ForceClose_Batch');
    XLSX.writeFile(forceWb, forceXlsxPath);

    await panelPage.setInputFiles('#fileInput', forceXlsxPath);
    await panelPage.waitForFunction(
      () => document.getElementById('statTotal')?.textContent === '6',
      { timeout: 5000 }
    );
    await panelPage.click('#startBtn');

    try {
      await panelPage.waitForFunction(() => {
        const startDisabled = document.getElementById('startBtn')?.disabled;
        const done = Number(document.getElementById('statDone')?.textContent || 0);
        const fail = Number(document.getElementById('statFailed')?.textContent || 0);
        return !startDisabled && done + fail === 6;
      }, null, { timeout: 60000 });
    } catch (e) {
      console.error('TIMED OUT IN SCENARIO 8!');
      console.error('statDone:', await panelPage.textContent('#statDone'));
      console.error('statFailed:', await panelPage.textContent('#statFailed'));
      console.error('statSkipped:', await panelPage.textContent('#statSkipped'));
      console.error('Rows:', await panelPage.locator('#queueBody tr').allInnerTexts());
      throw e;
    }

    const forceDone = await panelPage.textContent('#statDone');
    if (forceDone !== '6') {
      console.error('Force Close batch rows:', await panelPage.locator('#queueBody tr').allInnerTexts());
    }
    assert.equal(forceDone, '6', 'All 6 challenging enquiries must be successfully force-closed with AI OFF');
    assert.equal(await panelPage.textContent('#statFailed'), '0', 'Zero enquiries should fail in Force Close mode');
    assert.equal(nimDiagnoseCalls, 0, 'Zero NIM AI calls should be made in Force Close mode with AI OFF');

    const dbAfterForce = await dmsPage.evaluate(() => ({
      e2003: window.__MOCK_DB['11365-01-SENQ-2222-0003'],
      e2004: window.__MOCK_DB['11365-01-SENQ-2222-0004'],
      e2001: window.__MOCK_DB['11365-01-SENQ-2222-0001'],
      e3001: window.__MOCK_DB['11365-01-SENQ-3333-0001'],
      e2005: window.__MOCK_DB['11365-01-SENQ-2222-0005'],
      e0523: window.__MOCK_DB['11365-01-SENQ-2222-0523']
    }));
    assert.equal(dbAfterForce.e2003.status, 'Closed');
    assert.equal(dbAfterForce.e2004.status, 'Closed');
    assert.equal(dbAfterForce.e2001.status, 'Closed');
    assert.equal(dbAfterForce.e2001.age, '26');
    assert.equal(dbAfterForce.e2001.gender, 'M');
    assert.equal(dbAfterForce.e3001.status, 'Closed');
    assert.equal(dbAfterForce.e3001.state, 'UTTAR PRADESH');
    assert.equal(dbAfterForce.e3001.district, 'LUCKNOW');
    assert.equal(dbAfterForce.e3001.city, 'LUCKNOW');
    assert.equal(dbAfterForce.e2005.status, 'Closed');
    assert.ok(dbAfterForce.e2005.activities[0].HHML_CloseOut_Reason, 'Reason must be populated on closed activity');
    assert.equal(dbAfterForce.e0523.status, 'Closed', 'Enquiry with SBL-DAT-00523 must recover and close');

    console.log('E2E Extension + Mock Siebel + NVIDIA NIM AI tests PASSED!');
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

runE2E().catch((err) => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
