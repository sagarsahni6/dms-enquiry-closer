/**
 * Background service worker for Hero DMS Enquiry Closer.
 * Enables side panel toggle on toolbar icon click and ensures content scripts
 * are injected into already-open Hero Connect tabs when needed.
 */

import {
  diagnoseAndPlanRecovery,
  fetchAvailableNimModels,
  testNimConnection
} from './lib/nim_client.js';

const HERO_DMS_ORIGIN = 'https://connect.heromotocorp.biz/';
const STORAGE_KEY = 'heroDmsCloserConfig_v1';

async function configureSidePanel() {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.warn('[DMS Closer] Failed setting sidePanel behavior:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  configureSidePanel();
});

/**
 * Ensures both MAIN-world Siebel bridge and ISOLATED runner scripts are active in tabId.
 */
async function ensureScriptsInjected(tabId) {
  try {
    const pingRes = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pingRes?.ok) {
      return { ok: true, injectedNow: false };
    }
  } catch {
    // Expected when tab was already open prior to extension installation/reload.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/siebel_bridge.js'],
    world: 'MAIN'
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/content_runner.js'],
    world: 'ISOLATED'
  });

  return { ok: true, injectedNow: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ENSURE_TAB_READY') {
    (async () => {
      const { tabId, tabUrl } = message;
      if (!tabId) {
        sendResponse({ ok: false, error: 'No active tab selected.' });
        return;
      }
      if (tabUrl && !tabUrl.startsWith(HERO_DMS_ORIGIN)) {
        sendResponse({ ok: false, error: 'Active tab is not Hero Connect DMS.' });
        return;
      }
      try {
        const result = await ensureScriptsInjected(tabId);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === 'FETCH_NIM_MODELS') {
    (async () => {
      try {
        const stored = (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY] || {};
        const nimConfig = { ...stored, ...(message.nimConfig || {}) };
        const result = await fetchAvailableNimModels({
          apiKey: nimConfig.nimApiKey,
          baseUrl: nimConfig.nimBaseUrl
        });
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === 'TEST_NIM_CONNECTION') {
    (async () => {
      try {
        const stored = (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY] || {};
        const nimConfig = { ...stored, ...(message.nimConfig || {}) };
        const result = await testNimConnection(nimConfig);
        if (result.ok && result.switchedFrom && result.model) {
          await chrome.storage.local.set({
            [STORAGE_KEY]: { ...stored, ...nimConfig, nimModel: result.model }
          });
        }
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === 'AI_DIAGNOSE_FAILURE') {
    (async () => {
      try {
        const stored = (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY] || {};
        if (!String(stored.nimApiKey || '').trim()) {
          sendResponse({
            ok: false,
            error: 'NVIDIA NIM API key is not configured in Side Panel settings.'
          });
          return;
        }
        const plan = await diagnoseAndPlanRecovery(message.context, {
          ...stored,
          onModelResolved: async (resolvedModel) => {
            try {
              await chrome.storage.local.set({
                [STORAGE_KEY]: { ...stored, nimModel: resolvedModel }
              });
            } catch {
              // Ignore storage update errors
            }
          }
        });
        sendResponse({ ok: true, plan });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  return false;
});
