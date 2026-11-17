import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NIM_BASE_URL,
  DEFAULT_NIM_MODEL,
  buildNimEndpoint,
  buildNimModelsEndpoint,
  extractJsonFromModelText,
  fetchAvailableNimModels,
  parseDealerHint,
  validateRecoveryPlan,
  diagnoseAndPlanRecovery,
  testNimConnection
} from '../dms-enquiry-closer/lib/nim_client.js';

test('buildNimEndpoint normalizes base URLs cleanly', () => {
  assert.equal(buildNimEndpoint(), `${DEFAULT_NIM_BASE_URL}/chat/completions`);
  assert.equal(
    buildNimEndpoint('https://integrate.api.nvidia.com/v1/'),
    'https://integrate.api.nvidia.com/v1/chat/completions'
  );
  assert.equal(
    buildNimEndpoint('http://127.0.0.1:8080/v1/chat/completions'),
    'http://127.0.0.1:8080/v1/chat/completions'
  );
  assert.equal(
    buildNimEndpoint('https://proxy.example.com/nim'),
    'https://proxy.example.com/nim/chat/completions'
  );
});

test('extractJsonFromModelText handles plain JSON, markdown fences, and <think> tags', () => {
  const plain = '{"retryable":true,"diagnosis":"ok"}';
  assert.deepEqual(extractJsonFromModelText(plain), { retryable: true, diagnosis: 'ok' });

  const withThinkAndFence = `<think>Reasoning about Siebel...</think>\n\`\`\`json\n{"retryable":false,"diagnosis":"Locked"}\n\`\`\``;
  assert.deepEqual(extractJsonFromModelText(withThinkAndFence), {
    retryable: false,
    diagnosis: 'Locked'
  });

  assert.throws(() => extractJsonFromModelText('not json at all'), /not valid JSON/);
});

test('validateRecoveryPlan enforces live LOV options and canonicalizes labels', () => {
  const context = {
    availableActivityOptions: {
      subReason: ['Honda Shine', 'TVS Raider'],
      reason: ['Bought Competitor', 'Not Interested']
    },
    opportunityFields: [
      { label: 'Variant', availableOptions: ['Drum', 'Disc'] },
      { label: 'Age(Years)' }
    ]
  };

  const plan = validateRecoveryPlan(
    {
      retryable: true,
      action: 'EDIT_EXISTING_ACTIVITY',
      diagnosis: 'Mapped sub-reason and filled required fields.',
      activityUpdates: {
        'Close Out Sub Reason': 'honda shine',
        reason: 'Hallucinated Option',
        remarks: 'Customer bought Shine',
        'Expected Purchase Date': '+7d',
        unknownField: 'bad'
      },
      opportunityUpdates: {
        variant: 'disc',
        'Age(Years)': '28',
        FakeField: '123'
      },
      clearFields: ['subReason2']
    },
    context
  );

  assert.equal(plan.retryable, true);
  assert.equal(plan.action, 'EDIT_EXISTING_ACTIVITY');
  assert.deepEqual(plan.clearFields, ['subReason2']);
  assert.deepEqual(plan.activityUpdates, {
    subReason: 'Honda Shine',
    remarks: 'Customer bought Shine',
    expectedPurchaseDate: '+7d'
  });
  assert.deepEqual(plan.opportunityUpdates, {
    Variant: 'Disc',
    'Age(Years)': '28'
  });

  const ageAliasPlan = validateRecoveryPlan(
    {
      retryable: true,
      diagnosis: 'Filled Age.',
      opportunityUpdates: { Age: '30' }
    },
    { opportunityFields: [{ label: 'Age(Years)' }] }
  );
  assert.deepEqual(ageAliasPlan.opportunityUpdates, { 'Age(Years)': '30' });
});

test('diagnoseAndPlanRecovery strips unsupported chat_template_kwargs/response_format and retries prose responses', async () => {
  let callCount = 0;
  const mockFetch = async (_url, init) => {
    callCount++;
    const body = JSON.parse(init.body);
    assert.equal(init.headers.Authorization, 'Bearer nvapi-test-123');
    if (callCount === 1) {
      assert.ok(body.chat_template_kwargs);
      return new Response(
        JSON.stringify({ error: { message: 'unknown field chat_template_kwargs and response_format' } }),
        { status: 400 }
      );
    }
    if (callCount === 2) {
      // Simulate model still returning prose on first completion, triggering strict JSON nudge retry
      return new Response(
        JSON.stringify({
          model: DEFAULT_NIM_MODEL,
          choices: [{ message: { content: 'We need to analyze why closing failed.' } }]
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        model: DEFAULT_NIM_MODEL,
        choices: [
          {
            message: {
              content: JSON.stringify({
                retryable: true,
                diagnosis: 'Pick valid Sub Reason from list.',
                opportunityUpdates: {},
                activityUpdates: { subReason: 'Honda Shine' }
              })
            }
          }
        ]
      }),
      { status: 200 }
    );
  };

  const plan = await diagnoseAndPlanRecovery(
    {
      stage: 'ACTIVITY_FILL',
      errorMessage: 'Option "Bad" not found in "Close Out Sub Reason".',
      availableActivityOptions: { subReason: ['Honda Shine', 'TVS Raider'] }
    },
    { nimApiKey: 'nvapi-test-123' },
    mockFetch
  );

  assert.equal(callCount, 3);
  assert.equal(plan.retryable, true);
  assert.deepEqual(plan.activityUpdates, { subReason: 'Honda Shine' });
});

test('testNimConnection reports auth errors, auto-recovers from 410 EOL, and lists models', async () => {
  const errRes = await testNimConnection(
    { nimApiKey: 'nvapi-bad' },
    async () => new Response('{"error":{"message":"Invalid key"}}', { status: 401 })
  );
  assert.equal(errRes.ok, false);
  assert.match(errRes.error, /authentication failed \(401\)/i);

  assert.equal(
    buildNimModelsEndpoint('https://integrate.api.nvidia.com/v1/chat/completions'),
    'https://integrate.api.nvidia.com/v1/models'
  );

  const mockFetchWith410 = async (url, init) => {
    if (String(url).endsWith('/models')) {
      return new Response(
        JSON.stringify({
          data: [
            { id: 'nvidia/nv-embedqa-e5-v5' },
            { id: 'qwen/qwen3-32b' },
            { id: 'nvidia/nemotron-3-nano-30b-a3b' }
          ]
        }),
        { status: 200 }
      );
    }
    const body = JSON.parse(init.body);
    if (body.model === 'some/retired-model') {
      return new Response('{"detail":"Gone"}', { status: 410 });
    }
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: '{"ok":true}' } }]
      }),
      { status: 200 }
    );
  };

  const listed = await fetchAvailableNimModels({ nimApiKey: 'nvapi-good' }, mockFetchWith410);
  assert.ok(!listed.models.includes('nvidia/nv-embedqa-e5-v5'), 'Embedding models should be filtered out');
  assert.equal(listed.models[0], 'nvidia/nemotron-3-nano-30b-a3b');

  const okRes = await testNimConnection(
    { nimApiKey: 'nvapi-good', nimModel: 'some/retired-model' },
    mockFetchWith410
  );
  assert.equal(okRes.ok, true);
  assert.equal(okRes.switchedFrom, 'some/retired-model');
  assert.equal(okRes.model, 'nvidia/nemotron-3-nano-30b-a3b');

  const noAccountAccessRes = await testNimConnection(
    { nimApiKey: 'nvapi-no-endpoints', nimModel: 'qwen/qwen3-32b' },
    async (url) => {
      if (String(url).endsWith('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'qwen/qwen3-32b' }, { id: 'nvidia/nemotron-3-nano-30b-a3b' }] }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ detail: "Function 'abc': Not found for account 'xyz'" }),
        { status: 404 }
      );
    }
  );
  assert.equal(noAccountAccessRes.ok, false);
  assert.match(noAccountAccessRes.error, /serverless inference is not enabled/i);
});

test('validateRecoveryPlan and diagnoseAndPlanRecovery support forceBcSync and attemptHistory', async () => {
  const plan = validateRecoveryPlan({
    retryable: true,
    diagnosis: 'Reason dropped before commit.',
    activityUpdates: { reason: 'Not Interested' },
    forceBcSync: ['HHML_CloseOut_Reason', 'Due', 'Reason', 'unknown_col']
  });
  assert.deepEqual(plan.forceBcSync, ['reason', 'nextFollowupDate']);

  let seenContext = null;
  const result = await diagnoseAndPlanRecovery(
    {
      stage: 'ACTIVITY_COMMIT',
      errorMessage: "Please enter 'Reason' for Closure. (SBL-APS-00802)",
      attemptHistory: [{ attempt: 1, stage: 'ACTIVITY_COMMIT', errorMessage: 'SBL-APS-00802' }],
      viewDiagnostics: { actBusCompFields: { reason: '', enquiryStatus: 'Closed' } }
    },
    { nimApiKey: 'nvapi-test-sync' },
    async (_url, init) => {
      const body = JSON.parse(init.body);
      seenContext = JSON.parse(body.messages.find((m) => m.role === 'user').content);
      return new Response(
        JSON.stringify({
          model: DEFAULT_NIM_MODEL,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  retryable: true,
                  diagnosis: 'Force Reason commit to Siebel BusComp.',
                  activityUpdates: { reason: 'Not Interested' },
                  forceBcSync: ['reason'],
                  opportunityUpdates: {}
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    }
  );

  assert.equal(seenContext.attemptHistory.length, 1);
  assert.equal(seenContext.viewDiagnostics.actBusCompFields.enquiryStatus, 'Closed');
  assert.deepEqual(result.forceBcSync, ['reason']);
});

test('parseDealerHint and validateRecoveryPlan resolve address details and state abbreviations', () => {
  const parsed = parseDealerHint(
    'State: UP, District: Lucknow, Tehsil: Mohanlalganj, City: Lucknow, Pin: 226301, Default Age 28, Gender M'
  );
  assert.deepEqual(parsed.opp, {
    State: 'UP',
    District: 'Lucknow',
    'Tehsil/Taluka': 'Mohanlalganj',
    'City/Town/Village': 'Lucknow',
    'Pin Code': '226301',
    'Age(Years)': '28',
    Gender: 'M'
  });

  const plan = validateRecoveryPlan(
    {
      retryable: true,
      diagnosis: 'Filled address fields from Dealer Context Hint.',
      opportunityUpdates: {
        State: 'UP',
        Tehsil: 'Mohanlalganj',
        City: 'Lucknow',
        Pin: '226301'
      }
    },
    {
      opportunityFields: [
        { label: 'State', availableOptions: ['DELHI', 'UTTAR PRADESH'] },
        { label: 'Tehsil/Taluka', availableOptions: ['SADAR', 'MOHANLALGANJ'] },
        { label: 'City/Town/Village' },
        { label: 'Pin Code' }
      ]
    }
  );
  assert.deepEqual(plan.opportunityUpdates, {
    State: 'UTTAR PRADESH',
    'Tehsil/Taluka': 'MOHANLALGANJ',
    'City/Town/Village': 'Lucknow',
    'Pin Code': '226301'
  });
});
