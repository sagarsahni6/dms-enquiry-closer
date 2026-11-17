/**
 * Pure ES module for calling NVIDIA NIM OpenAI-compatible Chat Completions API
 * to diagnose Hero DMS (Siebel Open UI) enquiry closing failures and propose
 * grounded, validated field repairs.
 */

export const DEFAULT_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_NIM_MODEL = 'nvidia/nemotron-3-nano-30b-a3b';

export const RETIRED_NIM_MODELS = new Set([
  'meta/llama-3.3-70b-instruct',
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'nvidia/nemotron-4-340b-instruct'
]);

export const RECOMMENDED_NIM_MODELS = [
  'nvidia/nemotron-3-nano-30b-a3b',
  'qwen/qwen3-32b',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/nemotron-3.5-super-vl-120b-a12b'
];

const NON_CHAT_MODEL_RE =
  /embed|rerank|guard|shield|parse|ocr|reward|asr|tts|whisper|diffusion|flux|sdxl|riva|streampetr|trellis|cosmos|molmim|protein|esm|bionemo|neva|deplot|paligemma|vila/i;

export const ACTIVITY_FIELD_ALIASES = {
  followupdone: 'followupDone',
  'followup done': 'followupDone',
  hmcl_followup_done: 'followupDone',
  enquirystatus: 'enquiryStatus',
  'enquiry status': 'enquiryStatus',
  status: 'enquiryStatus',
  reason: 'reason',
  hhml_closeout_reason: 'reason',
  subreason: 'subReason',
  'close out sub reason': 'subReason',
  hhml_closeout_sub_reason: 'subReason',
  subreason2: 'subReason2',
  'close out sub reason2': 'subReason2',
  hhml_closeout_sub_reason2: 'subReason2',
  makebought: 'makeBought',
  'make bought': 'makeBought',
  hhml_make_bought: 'makeBought',
  model: 'model',
  hhml_model: 'model',
  nextfollowupdate: 'nextFollowupDate',
  'next follow-up date': 'nextFollowupDate',
  due: 'nextFollowupDate',
  expectedpurchasedate: 'expectedPurchaseDate',
  'expected purchase date': 'expectedPurchaseDate',
  hmcl_expected_purchase_date: 'expectedPurchaseDate',
  expectedvisitdate: 'expectedVisitDate',
  'expected visit date': 'expectedVisitDate',
  hmcl_expected_visit_date: 'expectedVisitDate',
  followupsource: 'followUpSource',
  'follow up source': 'followUpSource',
  hmcl_follow_up_source: 'followUpSource',
  remarks: 'remarks',
  comment: 'remarks',
  followupaction: 'followupAction',
  'follow-up action': 'followupAction',
  description: 'followupAction'
};

function normalizeStr(val) {
  return String(val ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a NVIDIA NIM base URL into a full /chat/completions endpoint.
 */
export function buildNimEndpoint(baseUrl = DEFAULT_NIM_BASE_URL) {
  const clean = normalizeStr(baseUrl || DEFAULT_NIM_BASE_URL).replace(/\/+$/, '');
  if (!clean) return `${DEFAULT_NIM_BASE_URL}/chat/completions`;
  if (/\/chat\/completions$/i.test(clean)) return clean;
  if (/\/v1$/i.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/chat/completions`;
}

/**
 * Normalizes a NVIDIA NIM base URL into a /models discovery endpoint.
 */
export function buildNimModelsEndpoint(baseUrl = DEFAULT_NIM_BASE_URL) {
  const clean = normalizeStr(baseUrl || DEFAULT_NIM_BASE_URL)
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/+$/, '');
  if (!clean) return `${DEFAULT_NIM_BASE_URL}/models`;
  return `${clean}/models`;
}

function scoreChatModelId(id) {
  const lower = id.toLowerCase();
  if (RETIRED_NIM_MODELS.has(id) || RETIRED_NIM_MODELS.has(lower)) return -1000;
  let score = 0;
  if (/nemotron-3\.5|nemotron-3|qwen3|llama-4|deepseek-v3|gpt-oss/i.test(lower)) score += 45;
  if (/instruct|chat|super|nano/i.test(lower)) score += 20;
  if (/nemotron|qwen|llama|deepseek|mistral|gemma/i.test(lower)) score += 15;
  if (/llama-3\.1|mixtral-8x22b/i.test(lower)) score -= 25;
  if (/vision|vl/i.test(lower)) score -= 10;
  if (/405b|480b|671b/i.test(lower)) score -= 5;
  return score;
}

function pickDiverseCandidates(models, excludeModel, limit = 8) {
  const filtered = models.filter((m) => m !== excludeModel && !RETIRED_NIM_MODELS.has(m));
  const picked = [];
  const seenVendors = new Set();

  // Pass 1: pick top model from each distinct vendor family for maximum resilience
  for (const id of filtered) {
    const vendor = id.includes('/') ? id.split('/')[0] : id;
    if (!seenVendors.has(vendor)) {
      seenVendors.add(vendor);
      picked.push(id);
      if (picked.length >= limit) return picked;
    }
  }

  // Pass 2: fill remaining slots in priority order
  for (const id of filtered) {
    if (!picked.includes(id)) {
      picked.push(id);
      if (picked.length >= limit) return picked;
    }
  }
  return picked;
}

/**
 * Queries NVIDIA NIM's /models endpoint to list currently active chat/instruct models.
 */
export async function fetchAvailableNimModels(
  { apiKey, nimApiKey, baseUrl, nimBaseUrl, timeoutMs = 15000 } = {},
  fetchImpl = fetch
) {
  const cleanKey = normalizeStr(apiKey || nimApiKey);
  if (!cleanKey) {
    throw new Error('NVIDIA NIM API key is missing.');
  }

  const endpoint = buildNimModelsEndpoint(baseUrl || nimBaseUrl || DEFAULT_NIM_BASE_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cleanKey}`
      },
      signal: controller.signal
    });
    const rawBody = await res.text();
    if (!res.ok) {
      throw new Error(formatNimHttpError(res.status, rawBody));
    }
    const parsed = JSON.parse(rawBody);
    const allIds = Array.isArray(parsed?.data)
      ? parsed.data.map((m) => normalizeStr(m?.id)).filter(Boolean)
      : [];

    const chatIds = allIds
      .filter((id) => !NON_CHAT_MODEL_RE.test(id) && !RETIRED_NIM_MODELS.has(id))
      .sort((a, b) => scoreChatModelId(b) - scoreChatModelId(a));

    return {
      models: chatIds.length > 0 ? chatIds : allIds,
      totalCount: allIds.length
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`NVIDIA NIM model list request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts and parses a JSON object from model output, handling <think> blocks
 * and markdown code fences.
 */
export function extractJsonFromModelText(rawText) {
  let text = String(rawText ?? '').trim();
  if (!text) {
    throw new Error('NVIDIA NIM returned an empty response.');
  }

  // Strip reasoning blocks if a thinking model is selected
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip ```json ... ``` or ``` ... ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    text = fenced[1].trim();
  }

  try {
    return JSON.parse(text);
  } catch {
    // Fallback: locate outermost JSON object braces
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error(`NVIDIA NIM response was not valid JSON: ${text.slice(0, 180)}`);
  }
}

export const INDIAN_STATE_ABBREVS = {
  AP: 'ANDHRA PRADESH',
  AR: 'ARUNACHAL PRADESH',
  AS: 'ASSAM',
  BR: 'BIHAR',
  CG: 'CHHATTISGARH',
  CH: 'CHANDIGARH',
  DD: 'DAMAN AND DIU',
  DL: 'DELHI',
  DN: 'DADRA AND NAGAR HAVELI',
  GA: 'GOA',
  GJ: 'GUJARAT',
  HP: 'HIMACHAL PRADESH',
  HR: 'HARYANA',
  JH: 'JHARKHAND',
  JK: 'JAMMU AND KASHMIR',
  KA: 'KARNATAKA',
  KL: 'KERALA',
  LA: 'LADAKH',
  LD: 'LAKSHADWEEP',
  MH: 'MAHARASHTRA',
  ML: 'MEGHALAYA',
  MN: 'MANIPUR',
  MP: 'MADHYA PRADESH',
  MZ: 'MIZORAM',
  NL: 'NAGALAND',
  OD: 'ODISHA',
  OR: 'ODISHA',
  PB: 'PUNJAB',
  PY: 'PUDUCHERRY',
  RJ: 'RAJASTHAN',
  SK: 'SIKKIM',
  TG: 'TELANGANA',
  TN: 'TAMIL NADU',
  TR: 'TRIPURA',
  TS: 'TELANGANA',
  UA: 'UTTARAKHAND',
  UK: 'UTTARAKHAND',
  UP: 'UTTAR PRADESH',
  WB: 'WEST BENGAL'
};

const DEALER_HINT_KEY_DEFS = [
  { pattern: 'tehsil\\s*\\/\\s*taluka|tehsil|taluka|taluk|sub\\s*-?district', target: 'opp', label: 'Tehsil/Taluka' },
  { pattern: 'city\\s*\\/\\s*town\\s*\\/\\s*village|city|town|village', target: 'opp', label: 'City/Town/Village' },
  { pattern: 'pin\\s*code|pincode|postal\\s*code|pin\\b', target: 'opp', label: 'Pin Code' },
  { pattern: 'address\\s*line\\s*1|address\\s*1|address1', target: 'opp', label: 'Address Line 1' },
  { pattern: 'address\\s*line\\s*2|address\\s*2|address2', target: 'opp', label: 'Address Line 2' },
  { pattern: 'geo\\s*area', target: 'opp', label: 'Geo Area' },
  { pattern: 'district|dist\\b', target: 'opp', label: 'District' },
  { pattern: 'state', target: 'opp', label: 'State' },
  { pattern: 'age\\s*\\(\\s*years\\s*\\)|age', target: 'opp', label: 'Age(Years)' },
  { pattern: 'gender|sex', target: 'opp', label: 'Gender' },
  { pattern: 'booking\\s*order\\s*type|order\\s*type', target: 'opp', label: 'Booking Order Type' },
  { pattern: 'existing\\s*vehicle', target: 'opp', label: 'Existing Vehicle' },
  { pattern: 'point\\s*of\\s*contact|poc\\b', target: 'opp', label: 'Point of Contact' },
  { pattern: 'expected\\s*date\\s*of\\s*purchase|purchase\\s*date', target: 'opp', label: 'Expected Date Of Purchase' },
  { pattern: 'exchange\\s*required|exchange', target: 'opp', label: 'Exchange Required' },
  { pattern: 'finance\\s*required|finance', target: 'opp', label: 'Finance Required' },
  { pattern: 'loyalty\\s*required|loyalty', target: 'opp', label: 'Loyalty Required' },
  { pattern: 'follow-?\\s*up\\s*done', target: 'act', label: 'followupDone' },
  { pattern: 'enquiry\\s*status', target: 'act', label: 'enquiryStatus' },
  { pattern: 'close\\s*out\\s*sub\\s*reason\\s*2|sub\\s*-?reason\\s*2|subreason2', target: 'act', label: 'subReason2' },
  { pattern: 'close\\s*out\\s*sub\\s*reason|sub\\s*-?reason|subreason', target: 'act', label: 'subReason' },
  { pattern: 'reason', target: 'act', label: 'reason' },
  { pattern: 'next\\s*follow-?\\s*up\\s*date|followup\\s*date|due\\s*date', target: 'act', label: 'nextFollowupDate' },
  { pattern: 'remarks?', target: 'act', label: 'remarks' },
  { pattern: 'follow-?\\s*up\\s*action', target: 'act', label: 'followupAction' }
];

/**
 * Extracts structured Opportunity Form and Activity defaults from a Dealer Context Hint string.
 * Supports comma/semicolon/newline lists or inline keyword phrases such as:
 * "State: UP, District: Lucknow, Tehsil: Mohanlalganj, City: Lucknow, Pin: 226001, Age 28, Gender Male"
 */
export function parseDealerHint(hintText) {
  const opp = {};
  const act = {};
  const raw = String(hintText ?? '').replace(/\r\n/g, '\n').trim();
  if (!raw) return { opp, act };

  const keyGroup = DEALER_HINT_KEY_DEFS.map((d) => `(?:${d.pattern})`).join('|');
  const matcher = new RegExp(
    `(?:^|[,;\\n|\\s])(?:default|use|set|always)?\\s*(${keyGroup})\\s*(?:[:=\\-]|\\s)\\s*([^,;\\n|]+?)(?=(?:\\s*[,;\\n|]|\\s+(?:default|use|set|always)?\\s*(?:${keyGroup})\\s*(?:[:=\\-]|\\s)|$))`,
    'gi'
  );

  let match;
  while ((match = matcher.exec(raw)) !== null) {
    const rawKey = normalizeStr(match[1]).toLowerCase();
    let val = normalizeStr(match[2]).replace(/^["']|["']$/g, '').trim();
    if (!val) continue;

    for (const def of DEALER_HINT_KEY_DEFS) {
      if (new RegExp(`^(?:${def.pattern})$`, 'i').test(rawKey)) {
        if (def.target === 'opp') {
          if (!opp[def.label]) opp[def.label] = val;
        } else {
          if (!act[def.label]) act[def.label] = val;
        }
        break;
      }
    }
  }

  return { opp, act };
}

function matchAllowedOption(proposedValue, allowedOptions, fieldLabel = '') {
  const wanted = normalizeStr(proposedValue).toLowerCase();
  if (!wanted || !Array.isArray(allowedOptions) || allowedOptions.length === 0) return null;

  const exact = allowedOptions.find((opt) => normalizeStr(opt).toLowerCase() === wanted);
  if (exact) return normalizeStr(exact);

  const normWanted = wanted.replace(/[^a-z0-9]/g, '');
  if (normWanted) {
    const normMatch = allowedOptions.find(
      (opt) => normalizeStr(opt).toLowerCase().replace(/[^a-z0-9]/g, '') === normWanted
    );
    if (normMatch) return normalizeStr(normMatch);
  }

  const lowerLabel = normalizeStr(fieldLabel).toLowerCase();
  if (lowerLabel === 'state') {
    const expanded = INDIAN_STATE_ABBREVS[wanted.toUpperCase()];
    if (expanded) {
      const stateMatch = allowedOptions.find(
        (opt) => normalizeStr(opt).toLowerCase() === expanded.toLowerCase()
      );
      if (stateMatch) return normalizeStr(stateMatch);
    }
    const revEntry = Object.entries(INDIAN_STATE_ABBREVS).find(
      ([, full]) => full.toLowerCase() === wanted
    );
    if (revEntry) {
      const abbrMatch = allowedOptions.find(
        (opt) => normalizeStr(opt).toUpperCase() === revEntry[0]
      );
      if (abbrMatch) return normalizeStr(abbrMatch);
    }
  }

  if (lowerLabel === 'gender') {
    const genderAliases = { m: 'male', male: 'm', f: 'female', female: 'f' };
    const alt = genderAliases[wanted];
    if (alt) {
      const gMatch = allowedOptions.find((opt) => normalizeStr(opt).toLowerCase() === alt);
      if (gMatch) return normalizeStr(gMatch);
    }
  }

  if (wanted.length >= 3) {
    const wordMatches = allowedOptions.filter((opt) => {
      const lowerOpt = normalizeStr(opt).toLowerCase();
      return lowerOpt.startsWith(wanted) || lowerOpt.includes(` ${wanted}`) || lowerOpt.includes(`${wanted} `);
    });
    if (wordMatches.length === 1) return normalizeStr(wordMatches[0]);
  }

  return null;
}

/**
 * Validates and canonicalizes an AI recovery plan against live DMS fields and LOV options
 * so no hallucinated dropdown labels or unknown fields can be applied.
 */
export function validateRecoveryPlan(rawPlan, failureContext = {}) {
  const plan = rawPlan && typeof rawPlan === 'object' ? rawPlan : {};
  const retryable = Boolean(plan.retryable);
  const diagnosis = normalizeStr(plan.diagnosis || 'No diagnosis provided.');

  const availableActivityOptions = failureContext.availableActivityOptions || {};
  const activityUpdates = {};

  if (plan.activityUpdates && typeof plan.activityUpdates === 'object') {
    for (const [rawKey, rawVal] of Object.entries(plan.activityUpdates)) {
      const canonicalKey = ACTIVITY_FIELD_ALIASES[normalizeStr(rawKey).toLowerCase()];
      if (!canonicalKey) continue;

      const val = normalizeStr(rawVal);
      if (!val) continue;

      const allowed = availableActivityOptions[canonicalKey];
      if (Array.isArray(allowed) && allowed.length > 0) {
        const matched = matchAllowedOption(val, allowed);
        if (matched) {
          activityUpdates[canonicalKey] = matched;
        }
      } else {
        activityUpdates[canonicalKey] = val;
      }
    }
  }

  const oppFields = Array.isArray(failureContext.opportunityFields)
    ? failureContext.opportunityFields
    : [];
  const oppByLowerLabel = new Map(
    oppFields.map((f) => [normalizeStr(f.label).toLowerCase(), f])
  );
  const oppByNormLabel = new Map(
    oppFields.map((f) => [normalizeStr(f.label).toLowerCase().replace(/[^a-z0-9]/g, ''), f])
  );
  const resolveOppFieldMeta = (rawLabel) => {
    const lower = normalizeStr(rawLabel).toLowerCase();
    if (oppByLowerLabel.has(lower)) return oppByLowerLabel.get(lower);
    const norm = lower.replace(/[^a-z0-9]/g, '');
    if (oppByNormLabel.has(norm)) return oppByNormLabel.get(norm);
    if (norm === 'age' || norm === 'ageyears' || norm === 'hmclcontactage') {
      return oppFields.find((f) => /^age/i.test(normalizeStr(f.label))) || null;
    }
    if (/^(tehsil|taluka|taluk|subdistrict)$/.test(norm)) {
      return oppFields.find((f) => /tehsil|taluka/i.test(normalizeStr(f.label))) || null;
    }
    if (/^(city|town|village|citytownvillage)$/.test(norm)) {
      return oppFields.find((f) => /city|town|village/i.test(normalizeStr(f.label))) || null;
    }
    if (/^(pin|pincode|postalcode)$/.test(norm)) {
      return oppFields.find((f) => /pin\s*code/i.test(normalizeStr(f.label))) || null;
    }
    if (norm === 'dist' || norm === 'district') {
      return oppFields.find((f) => /^district$/i.test(normalizeStr(f.label))) || null;
    }
    return null;
  };
  const opportunityUpdates = {};

  if (plan.opportunityUpdates && typeof plan.opportunityUpdates === 'object') {
    for (const [rawLabel, rawVal] of Object.entries(plan.opportunityUpdates)) {
      const fieldMeta = resolveOppFieldMeta(rawLabel);
      if (!fieldMeta) continue;

      const val = normalizeStr(rawVal);
      if (!val) continue;

      if (Array.isArray(fieldMeta.availableOptions) && fieldMeta.availableOptions.length > 0) {
        const matched = matchAllowedOption(val, fieldMeta.availableOptions, fieldMeta.label);
        if (matched) {
          opportunityUpdates[fieldMeta.label] = matched;
        }
      } else {
        opportunityUpdates[fieldMeta.label] = val;
      }
    }
  }

  const clearFields = Array.isArray(plan.clearFields)
    ? [...new Set(plan.clearFields.map((k) => ACTIVITY_FIELD_ALIASES[normalizeStr(k).toLowerCase()]).filter(Boolean))]
    : [];

  const forceBcSync = Array.isArray(plan.forceBcSync)
    ? [...new Set(plan.forceBcSync.map((k) => ACTIVITY_FIELD_ALIASES[normalizeStr(k).toLowerCase()]).filter(Boolean))]
    : [];

  const isRecordModified = /SBL-DAT-00523|modified by another user/i.test(failureContext?.errorMessage || '');
  if (isRecordModified) {
    return {
      retryable: true,
      action: failureContext?.viewDiagnostics?.hasEditableOpenActivity ? 'EDIT_EXISTING_ACTIVITY' : 'RETRY_NEW_ACTIVITY',
      diagnosis: 'Requerying enquiry to refresh database rowstamp after SBL-DAT-00523.',
      activityUpdates,
      opportunityUpdates,
      clearFields,
      forceBcSync
    };
  }

  const rawAction = normalizeStr(plan.action || '').toUpperCase();
  const action = ['RETRY_NEW_ACTIVITY', 'EDIT_EXISTING_ACTIVITY', 'FILL_OPPORTUNITY_ONLY'].includes(
    rawAction
  )
    ? rawAction
    : 'RETRY_NEW_ACTIVITY';

  return {
    retryable,
    action,
    diagnosis,
    activityUpdates,
    opportunityUpdates,
    clearFields,
    forceBcSync
  };
}

function formatNimHttpError(status, bodyText) {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.detail || parsed?.message || '';
  } catch {
    detail = normalizeStr(bodyText).slice(0, 200);
  }

  if (status === 401 || status === 403) {
    return `NVIDIA NIM authentication failed (${status}). Check your API key.${detail ? ` (${detail})` : ''}`;
  }
  if (status === 404) {
    return `NVIDIA NIM endpoint or model not found (404).${detail ? ` ${detail}` : ''}`;
  }
  if (status === 410) {
    return `NVIDIA NIM model is retired/EOL (410).${detail ? ` ${detail}` : ''}`;
  }
  if (status === 429) {
    return `NVIDIA NIM rate limit exceeded (429). Retry shortly.${detail ? ` ${detail}` : ''}`;
  }
  return `NVIDIA NIM request failed (${status})${detail ? `: ${detail}` : '.'}`;
}

/**
 * Sends a Chat Completions request to NVIDIA NIM (OpenAI-compatible endpoint).
 * Automatically discovers and switches to an active model if the configured model returns 410/404.
 */
export async function requestNimChatCompletion(
  {
    apiKey,
    baseUrl = DEFAULT_NIM_BASE_URL,
    model = DEFAULT_NIM_MODEL,
    messages,
    temperature = 0.1,
    maxTokens = 2048,
    timeoutMs = 28000,
    jsonMode = true,
    disableThinking = true,
    autoFallbackOnGone = true
  },
  fetchImpl = fetch
) {
  const cleanKey = normalizeStr(apiKey);
  if (!cleanKey) {
    throw new Error('NVIDIA NIM API key is missing. Enter your key in AI Auto-Recovery settings.');
  }

  const endpoint = buildNimEndpoint(baseUrl);
  let chosenModel = normalizeStr(model) || DEFAULT_NIM_MODEL;
  if (RETIRED_NIM_MODELS.has(chosenModel)) {
    chosenModel = DEFAULT_NIM_MODEL;
  }

  const sendOnce = async (targetModel, useJsonMode, useThinkingOff, reqTimeoutMs = timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), reqTimeoutMs);
    try {
      const payload = {
        model: targetModel,
        messages,
        temperature,
        max_tokens: maxTokens
      };
      if (useJsonMode) {
        payload.response_format = { type: 'json_object' };
      }
      if (useThinkingOff) {
        payload.chat_template_kwargs = { thinking: false };
      }

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const rawBody = await res.text();
      return { ok: res.ok, status: res.status, rawBody };
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(`NVIDIA NIM request timed out after ${Math.round(reqTimeoutMs / 1000)}s.`);
      }
      throw new Error(`NVIDIA NIM network error: ${err?.message || String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  };

  const sendWithJsonFallback = async (targetModel, reqTimeoutMs = timeoutMs) => {
    let useJson = Boolean(jsonMode);
    let useNoThink = Boolean(disableThinking);
    let res = await sendOnce(targetModel, useJson, useNoThink, reqTimeoutMs);

    for (let i = 0; i < 2 && !res.ok && res.status === 400; i++) {
      let changed = false;
      if (useNoThink && /chat_template_kwargs|thinking|extra|unexpected|unknown/i.test(res.rawBody)) {
        useNoThink = false;
        changed = true;
      }
      if (useJson && /response_format/i.test(res.rawBody)) {
        useJson = false;
        changed = true;
      }
      if (!changed) break;
      res = await sendOnce(targetModel, useJson, useNoThink, reqTimeoutMs);
    }
    return res;
  };

  let activeModel = chosenModel;
  let switchedFrom = '';
  let availableModels = [];
  let response = await sendWithJsonFallback(activeModel, timeoutMs);
  let triedModelsCount = 1;

  if (!response.ok && autoFallbackOnGone && (response.status === 410 || response.status === 404)) {
    try {
      const listed = await fetchAvailableNimModels({ apiKey: cleanKey, baseUrl, timeoutMs: 10000 }, fetchImpl);
      availableModels = listed.models;
      const candidates = pickDiverseCandidates(listed.models, activeModel, 4);
      const probeTimeout = Math.min(timeoutMs, 15000);
      for (const candidate of candidates) {
        triedModelsCount++;
        try {
          const retryRes = await sendWithJsonFallback(candidate, probeTimeout);
          if (retryRes.ok) {
            switchedFrom = activeModel;
            activeModel = candidate;
            response = retryRes;
            break;
          }
        } catch {
          // Continue probing remaining fallback models if one candidate times out
        }
      }
    } catch {
      // Preserve original 410/404 error if model discovery fails
    }
  }

  if (!response.ok) {
    const baseErr = formatNimHttpError(response.status, response.rawBody);
    if (
      (response.status === 404 || response.status === 410) &&
      /not found for account/i.test(baseErr) &&
      triedModelsCount > 1
    ) {
      throw new Error(
        `NVIDIA NIM returned 404 "Not found for account" across ${triedModelsCount} models. Your API key can list /v1/models, but serverless inference is not enabled for this account/key — try regenerating your key at build.nvidia.com, enabling Public API Endpoints on your NVIDIA org, or using a custom API Base URL.`
      );
    }
    throw new Error(baseErr);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.rawBody);
  } catch {
    throw new Error('NVIDIA NIM returned a non-JSON HTTP response.');
  }

  const msgObj = parsed?.choices?.[0]?.message || {};
  let content = normalizeStr(msgObj.content || '');
  if (!content && msgObj.reasoning_content) {
    const rc = String(msgObj.reasoning_content);
    if (!jsonMode || (rc.includes('{') && rc.includes('}'))) {
      content = rc;
    }
  }
  if (!content) {
    throw new Error('NVIDIA NIM returned empty content (model may still be reasoning — try disabling thinking or using a non-thinking instruct model).');
  }
  return {
    content,
    model: parsed?.model || activeModel,
    switchedFrom,
    availableModels,
    usage: parsed?.usage || null
  };
}

/**
 * Diagnoses a failed Hero DMS enquiry closing attempt and returns a validated recovery plan.
 */
export async function diagnoseAndPlanRecovery(failureContext, nimConfig, fetchImpl = fetch) {
  const autonomousMode = nimConfig?.aiAutonomousFill !== false;
  const systemPrompt = [
    '/no_think',
    'You are an autonomous Siebel Open UI enquiry-closing agent for Hero MotoCorp eDealer DMS.',
    'Analyze the DMS state, BusComp field values, attemptHistory, and error, and return ONLY a raw JSON object (no markdown, no explanation, start with { and end with }) matching this exact schema:',
    '{',
    '  "retryable": boolean,',
    '  "action": "RETRY_NEW_ACTIVITY" | "EDIT_EXISTING_ACTIVITY" | "FILL_OPPORTUNITY_ONLY",',
    '  "diagnosis": "short 1-sentence root cause explanation",',
    '  "opportunityUpdates": { "<Exact Opportunity Field Label>": "<value>" },',
    '  "activityUpdates": { "<activityFieldKey>": "<value>" },',
    '  "clearFields": ["<activityFieldKey>"],',
    '  "forceBcSync": ["<activityFieldKey>"]',
    '}',
    'Rules:',
    '1. Valid activityUpdates / forceBcSync keys ONLY: followupDone, enquiryStatus, reason, subReason, subReason2, makeBought, model, nextFollowupDate, expectedPurchaseDate, expectedVisitDate, followUpSource, remarks, followupAction.',
    '2. Valid opportunityUpdates keys ONLY: exact labels present in opportunityFields from context.',
    '3. Whenever availableOptions (or availableActivityOptions) is provided for a field, you MUST choose an EXACT string from that list (e.g., if currentItem has "CONNECTED" and available options are ["not_contacted","contacted","Customer_VIsit"], choose "contacted"). Never invent dropdown labels.',
    '4. Date fields (nextFollowupDate, expectedPurchaseDate, expectedVisitDate, Expected Date Of Purchase): use "TODAY", "+1d", or DD/MM/YYYY.',
    '5a. DEALER CONTEXT HINT (HIGHEST PRIORITY): If dealerHint is non-empty, ALWAYS follow the values specified in dealerHint for any matching empty/missing Opportunity Form fields (e.g. State, District, Tehsil/Taluka, City/Town/Village, Pin Code, Age(Years), Gender) or Activity fields (matching availableOptions when provided).',
    '5b. ADDRESS CASCADING: When filling missing address fields on Opportunity Form, include State -> District -> Tehsil/Taluka -> City/Town/Village -> Pin Code in parent-to-child order using dealerHint (or context).',
    autonomousMode
      ? '5c. AUTONOMOUS FILL IS ENABLED: You are authorized and expected to fill ONLY the missing, blank, or invalid Opportunity Form OR Activity fields actually needed to close the enquiry (e.g., Age(Years)="28", Gender, State, District, Tehsil/Taluka, City/Town/Village, Followup Done, Enquiry Status="Closed", Reason, Close Out Sub Reason, Close Out Sub Reason2, Make Bought, Model, Next Follow-Up Date="TODAY", Remarks="Customer contacted and enquiry closed"). NEVER fill "Variant" or "Color" on the Opportunity Form unless the Siebel error explicitly names Variant or Color as required — they are model-specific and NOT required to close an enquiry.'
      : '5c. Populate missing required opportunityFields (never Variant or Color unless explicitly required by the error) or activityUpdates using dealerHint, context, or safe defaults.',
    '6. If Activities List:New button is disabled/hidden AND viewDiagnostics.hasEditableOpenActivity is true, set action="EDIT_EXISTING_ACTIVITY" and provide the activityUpdates to close the existing Open activity row.',
    '7. If SBL-EXL-00151, SBL-DAT-00498, or SBL-APS-00802 occurred (missing required field like Reason, Next Follow-Up Date, or Followup Done), check currentActivityRow AND viewDiagnostics.actBusCompFields: even if currentItem already had a value, if Siebel failed to persist it or left it blank/mismatched, set retryable=true, include that field in activityUpdates AND list its key in forceBcSync so the bridge writes it directly to the BusComp before commit.',
    '8. Set retryable=false ONLY if the enquiry is genuinely impossible to update (e.g., server down, permission error, or permanently read-only with no editable activity/opportunity fields).',
    '9. If SBL-DAT-00523 occurs ("The selected record has been modified by another user since it was retrieved"), set retryable=true, action="RETRY_NEW_ACTIVITY" (or "EDIT_EXISTING_ACTIVITY" if hasEditableOpenActivity is true), diagnosis="Concurrent rowstamp conflict; requerying refreshes database rowstamp for clean retry.", opportunityUpdates={}, activityUpdates={}.',
    '10. Output ONLY valid JSON. No prose before or after the JSON object.'
  ].join('\n');

  const rawDealerHint = normalizeStr(failureContext?.dealerHint || nimConfig?.aiDealerHint || '');
  const compactContext = {
    stage: failureContext?.stage || 'UNKNOWN',
    errorMessage: failureContext?.errorMessage || '',
    enquiryNo: failureContext?.enquiryNo || '',
    dealerHint: rawDealerHint,
    parsedDealerHint: rawDealerHint ? parseDealerHint(rawDealerHint) : undefined,
    currentItem: failureContext?.currentItem || {},
    currentActivityRow: failureContext?.currentActivityRow || {},
    availableActivityOptions: failureContext?.availableActivityOptions || {},
    opportunityFields: failureContext?.opportunityFields || [],
    viewDiagnostics: failureContext?.viewDiagnostics || {},
    previousAiFixes: failureContext?.previousAiFixes || [],
    attemptHistory: failureContext?.attemptHistory || []
  };

  const baseReq = {
    apiKey: nimConfig?.nimApiKey,
    baseUrl: nimConfig?.nimBaseUrl || DEFAULT_NIM_BASE_URL,
    model: nimConfig?.nimModel || DEFAULT_NIM_MODEL,
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: 28000,
    disableThinking: true
  };

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(compactContext) }
  ];

  let completion = await requestNimChatCompletion(
    { ...baseReq, messages, jsonMode: true },
    fetchImpl
  );

  if (completion.switchedFrom && typeof nimConfig?.onModelResolved === 'function') {
    nimConfig.onModelResolved(completion.model, completion.switchedFrom);
  }

  let rawPlan;
  try {
    rawPlan = extractJsonFromModelText(completion.content);
  } catch {
    // Retry once with strict JSON conversion nudge and jsonMode=false
    const retryCompletion = await requestNimChatCompletion(
      {
        ...baseReq,
        model: completion.model,
        temperature: 0,
        jsonMode: false,
        messages: [
          ...messages,
          { role: 'assistant', content: String(completion.content).slice(0, 800) },
          {
            role: 'user',
            content:
              'Output ONLY the valid raw JSON object matching the schema. Start immediately with { and end with }. No words outside JSON.'
          }
        ]
      },
      fetchImpl
    );
    rawPlan = extractJsonFromModelText(retryCompletion.content);
  }

  return validateRecoveryPlan(rawPlan, compactContext);
}

/**
 * Verifies NVIDIA NIM connectivity, API key validity, and model availability.
 */
export async function testNimConnection(nimConfig, fetchImpl = fetch) {
  const started = Date.now();
  try {
    const res = await requestNimChatCompletion(
      {
        apiKey: nimConfig?.nimApiKey,
        baseUrl: nimConfig?.nimBaseUrl || DEFAULT_NIM_BASE_URL,
        model: nimConfig?.nimModel || DEFAULT_NIM_MODEL,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'ping' }
        ],
        temperature: 0,
        maxTokens: 128,
        timeoutMs: 15000,
        jsonMode: false
      },
      fetchImpl
    );

    let availableModels = res.availableModels || [];
    if (availableModels.length === 0) {
      try {
        const listed = await fetchAvailableNimModels(
          {
            apiKey: nimConfig?.nimApiKey,
            baseUrl: nimConfig?.nimBaseUrl || DEFAULT_NIM_BASE_URL,
            timeoutMs: 8000
          },
          fetchImpl
        );
        availableModels = listed.models;
      } catch {
        // Non-fatal if /models listing isn't supported by custom proxy
      }
    }

    return {
      ok: true,
      model: res.model,
      switchedFrom: res.switchedFrom || '',
      availableModels,
      latencyMs: Date.now() - started
    };
  } catch (err) {
    return {
      ok: false,
      model: normalizeStr(nimConfig?.nimModel) || DEFAULT_NIM_MODEL,
      latencyMs: Date.now() - started,
      error: err?.message || String(err)
    };
  }
}
