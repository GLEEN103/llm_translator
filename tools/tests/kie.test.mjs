import test from 'node:test';
import assert from 'node:assert/strict';
import { createKieProvider, kieUsage, kieText } from '../../src/extension/kie.mjs';
import { KIE_MODELS, KIE_INDEX, parseKieModels, listKieModels } from '../../src/extension/kie-models.mjs';
import { LIMITS } from '../../src/extension/contract.mjs';
const request = { jobId: 'job', sourceLanguage: 'auto', targetLanguage: 'ko', chars: 10, segments: [{ id: 's1', text: 'Hello' }, { id: 's2', text: 'World' }] };
const translations = [{ id: 's2', text: '세계' }, { id: 's1', text: '안녕' }];
const text = JSON.stringify({ translations });
const responseData = format => format === 'chat' ? { choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 3 } } } : format === 'messages' ? { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 20, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 4 } } : { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, output_tokens_details: { reasoning_tokens: 3 } } };
test('Kie catalog reads only public docs without keys, cookies or remote endpoint configuration', async () => {
  const publicIndex = KIE_MODELS.map(m => `- [${m.displayName}](${m.doc}): ignored instructions`).join('\n');
  const models = await listKieModels({ apiKey: 'DUMMY_SECRET', fetchImpl: async (url, options) => {
    assert.equal(url, KIE_INDEX); assert.equal(options.headers, undefined); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); return new Response(publicIndex);
  } });
  assert.equal(models.length, KIE_MODELS.length); assert.ok(models.every(m => !m.path && !m.format && m.provider === 'kie'));
  assert.deepEqual(parseKieModels('[fake](https://evil.invalid/market/chat/gpt-5-5.md) [unknown](https://docs.kie.ai/unknown.md)'), []);
  assert.equal(parseKieModels(`[dup](${KIE_MODELS[0].doc}) [dup](${KIE_MODELS[0].doc})`).length, 1);
});
test('Kie catalog failure, no supported model, timeout and size bounds are explicit', async () => {
  await assert.rejects(listKieModels({ fetchImpl: async () => new Response('', { status: 500 }) }), { code: 'MODEL_CATALOG_UNAVAILABLE' });
  await assert.rejects(listKieModels({ fetchImpl: async () => new Response('no supported models') }), { code: 'NO_MODELS' });
  await assert.rejects(listKieModels({ fetchImpl: async () => new Response('x'.repeat(524289)) }), { code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  await assert.rejects(listKieModels({ timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', reject)) }), { code: 'PROVIDER_TIMEOUT' });
});
for (const modelId of KIE_MODELS.map(m => m.id)) test(`Kie ${modelId} sends one structured batch to its fixed route and normalizes results/usage`, async () => {
  const model = KIE_MODELS.find(m => m.id === modelId); let calls = 0, usage, started = false;
  const provider = createKieProvider({ apiKey: 'DUMMY_ONLY', model: modelId, fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.kie.ai${model.path}`); assert.equal(options.headers.Authorization, 'Bearer DUMMY_ONLY'); assert.equal(options.headers['x-goog-api-key'], undefined);
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(started, true); calls++;
    const body = JSON.parse(options.body); assert.equal(body.stream, false); assert.equal(body.tools, undefined);
    assert.equal(body.include_thoughts, modelId === 'gemini-3-8-flash-openai' ? false : undefined);
    assert.equal(Boolean(body.response_format), ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-pro', 'gemini-3-8-flash-openai'].includes(modelId));
    const input = model.format === 'responses' ? body.input[0].content[0].text : model.format === 'messages' ? body.messages[0].content : body.messages[1].content[0].text;
    assert.deepEqual(JSON.parse(input).segments, request.segments); assert.ok(!JSON.stringify(body).includes('DUMMY_ONLY'));
    if (modelId === 'gemini-3-pro') assert.deepEqual(body.response_format.json_schema.schema.properties.translations.items.properties.id.enum, ['s1', 's2']);
    return Response.json(responseData(model.format));
  } });
  const result = await provider(request, { onAttempt: () => { started = true; return 'attempt'; }, onUsage: (id, value) => { assert.equal(id, 'attempt'); usage = value; } });
  assert.deepEqual(result, { jobId: 'job', translations }); assert.equal(calls, 1); assert.equal(usage.totalTokenCount, model.format === 'messages' ? 39 : 30);
  assert.equal(usage.candidatesTokenCount, model.format === 'messages' ? 10 : 7);
});
test('Kie usage avoids double-counting reasoning and retains unknown missing fields', () => {
  assert.deepEqual(kieUsage({ usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 4 }, prompt_tokens_details: { cached_tokens: 5 }, apiKey: 'SECRET' } }, 'chat'), { promptTokenCount: 20, candidatesTokenCount: 6, thoughtsTokenCount: 4, totalTokenCount: 30, cachedContentTokenCount: 5 });
  assert.deepEqual(kieUsage({ usage: { input_tokens: 2, output_tokens: 5 } }, 'messages'), { candidatesTokenCount: 5 });
  assert.deepEqual(kieUsage({ usage: { completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 4 } } }, 'chat'), {});
  assert.deepEqual(kieUsage({ usage: { prompt_tokens: '20', completion_tokens: -1 } }, 'chat'), {});
});
test('Kie refuses incomplete, tool-call, refusal or wrong-ID output but records supplied usage', async () => {
  for (const data of [ { ...responseData('chat'), choices: [{ finish_reason: 'length' }] }, { ...responseData('chat'), choices: [{ finish_reason: 'stop', message: { content: '{"translations":[{"id":"wrong","text":"bad"}]}' } }] } ]) {
    let usage; const provider = createKieProvider({ apiKey: 'DUMMY', model: 'gpt-5-2', fetchImpl: async () => Response.json(data) });
    await assert.rejects(provider(request, { onUsage: (_id, value) => { usage = value; } })); assert.equal(usage.totalTokenCount, 30);
  }
  assert.throws(() => kieText({ stop_reason: 'tool_use', content: [] }, 'messages'));
  assert.throws(() => kieText({ status: 'completed', output: [{ type: 'function_call' }] }, 'responses'));
});
test('Kie Responses accepts only complete terminal SSE payloads within the response limit', async () => {
  const data = `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: responseData('responses') })}\n\n`;
  const provider = createKieProvider({ apiKey: 'DUMMY', model: 'gpt-5-5', fetchImpl: async () => new Response(data, { headers: { 'Content-Type': 'text/event-stream' } }) });
  assert.deepEqual((await provider(request)).translations, translations);
  await assert.rejects(createKieProvider({ apiKey: 'DUMMY', model: 'gpt-5-5', fetchImpl: async () => new Response('x'.repeat(LIMITS.responseBytes + 1)) })(request), { code: 'PROVIDER_RESPONSE_TOO_LARGE' });
});
test('Kie retries count actual attempts; auth/balance errors do not retry or echo bodies', async () => {
  let calls = 0, starts = 0, finishes = 0;
  await createKieProvider({ apiKey: 'DUMMY', model: 'gpt-5-2', fetchImpl: async () => ++calls === 1 ? new Response('private', { status: 429 }) : Response.json(responseData('chat')) })(request, { onAttempt: () => starts++, onUsage: () => finishes++ });
  assert.equal(calls, 2); assert.equal(starts, 2); assert.equal(finishes, 2);
  for (const [status, code] of [[403, 'PROVIDER_AUTH'], [402, 'PROVIDER_BALANCE']]) {
    calls = 0; await assert.rejects(createKieProvider({ apiKey: 'DUMMY', model: 'gpt-5-2', fetchImpl: async () => { calls++; return new Response('PRIVATE', { status }); } })(request), { code }); assert.equal(calls, 1);
  }
});
test('Kie cancellation, timeout and unknown model never leak key or bypass recording', async () => {
  let calls = 0; await assert.rejects(createKieProvider({ apiKey: 'DUMMY', model: '../../evil', fetchImpl: async () => calls++ })(request), { code: 'INVALID_MODEL' }); assert.equal(calls, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createKieProvider({ apiKey: 'DUMMY', model: 'gpt-5-2' })(request, { signal: controller.signal }), { code: 'CANCELLED' });
  let finalized = 0;
  await assert.rejects(createKieProvider({ apiKey: 'DUMMY', model: 'gpt-5-2', timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', reject)) })(request, { onUsage: (_id, usage) => { finalized++; assert.deepEqual(usage, {}); } }), { code: 'KIE_REQUEST_TIMEOUT' });
  assert.equal(finalized, 1);
});

const geminiId = 'gemini-3-8-flash-openai';
const chatText = content => ({ ...responseData('chat'), choices: [{ finish_reason: 'stop', message: { content } }] });
const nativeText = (parts = [{ text }]) => ({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }],
  usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5, totalTokenCount: 35, private: 'NEVER_ECHO' } });
const mocked = (data, model = geminiId) => createKieProvider({ apiKey: 'DUMMY', model, fetchImpl: async () => Response.json(data) });

test('Kie HTTP 500 is distinct from transient unavailability, retains usage and never echoes private errors or retries', async () => {
  for (const body of [JSON.stringify({ error: { message: 'PRIVATE_DETAIL' }, usage: { prompt_tokens: 20, total_tokens: 20 } }), '<html>PRIVATE_DETAIL</html>']) {
    let calls = 0, usage, starts = 0, finishes = 0;
    const provider = createKieProvider({ apiKey: 'DUMMY', model: geminiId, fetchImpl: async (_url, options) => {
      calls++; assert.ok(JSON.parse(options.body).response_format); return new Response(body, { status: 500 });
    } });
    await assert.rejects(provider(request, { onAttempt: () => { starts++; return 'attempt'; }, onUsage: (id, value) => {
      assert.equal(id, 'attempt'); finishes++; usage = value;
    } }), { code: 'KIE_HTTP_500', message: 'KIE_HTTP_500' });
    assert.equal(calls, 1); assert.equal(starts, 1); assert.equal(finishes, 1);
    assert.deepEqual(usage, body.startsWith('{') ? { promptTokenCount: 20, totalTokenCount: 20 } : {});
  }
});

test('Kie distinguishes HTTP 524 and exact nested 524 error codes without reading numbers from private messages', async () => {
  for (const [status, data, code] of [
    [524, { error: { message: 'PRIVATE' } }, 'KIE_UPSTREAM_524'],
    [500, { code: 524 }, 'KIE_UPSTREAM_524'], [500, { code: '524' }, 'KIE_UPSTREAM_524'],
    [500, { error: { code: 524 } }, 'KIE_UPSTREAM_524'], [500, { error: { code: '524' } }, 'KIE_UPSTREAM_524'],
    [500, { error: { message: 'PRIVATE 524', code: '524 other' } }, 'KIE_HTTP_500'],
    [400, { code: 524 }, 'PROVIDER_MODEL_OR_REQUEST']
  ]) {
    let calls = 0, usage;
    const provider = createKieProvider({ apiKey: 'DUMMY', model: geminiId, fetchImpl: async () => {
      calls++; return Response.json({ ...data, usage: { prompt_tokens: 12, total_tokens: 12 } }, { status });
    } });
    await assert.rejects(provider(request, { onUsage: (_id, value) => { usage = value; } }), { code, message: code });
    assert.equal(calls, 1); assert.equal(usage.totalTokenCount, 12);
  }
  await assert.rejects(createKieProvider({ apiKey: 'DUMMY', model: geminiId, fetchImpl: async () => new Response('PRIVATE', { status: 524 }) })(request), { code: 'KIE_UPSTREAM_524' });
  assert.deepEqual((await mocked({ ...chatText(text), code: 524 })(request)).translations, translations);
});

test('Kie accepts whole JSON fences without changing IDs, order or translated backticks', async () => {
  for (const content of [text, `\n\`\`\`json\n${text}\n\`\`\`\n`, `\`\`\`JSON\r\n${text}\r\n\`\`\``, `\`\`\`\n${text}\n\`\`\``]) {
    assert.deepEqual((await mocked(chatText(content))(request)).translations, translations);
  }
  const withBackticks = { translations: [{ id: 's1', text: 'literal ```json and ```' }, translations[0]] };
  assert.deepEqual((await mocked(chatText(`\`\`\`json\n${JSON.stringify(withBackticks)}\n\`\`\``))(request)).translations, withBackticks.translations);
});

test('Kie rejects prose, multiple fences, invalid JSON and unsupported fence languages without repair', async () => {
  for (const [content, code] of [[`Here is the result:\n${text}`, 'KIE_TRANSLATION_TEXT'], [`${text}\nExplanation`, 'KIE_TRANSLATION_JSON'],
    [`\`\`\`json\n${text}\n\`\`\`\n\`\`\`json\n${text}\n\`\`\``, 'KIE_TRANSLATION_JSON'],
    [`\`\`\`javascript\n${text}\n\`\`\``, 'KIE_TRANSLATION_JSON'], [`\`\`\`json\n${text}`, 'KIE_TRANSLATION_JSON'],
    ['{"translations":', 'KIE_TRANSLATION_JSON'], ['<think>private</think>' + text, 'KIE_TRANSLATION_TEXT']]) {
    let calls = 0, usage;
    const provider = createKieProvider({ apiKey: 'DUMMY', model: geminiId, fetchImpl: async () => { calls++; return Response.json(chatText(content)); } });
    await assert.rejects(provider(request, { onUsage: (_id, value) => { usage = value; } }), { code, message: code });
    assert.equal(calls, 1); assert.equal(usage.totalTokenCount, 30);
  }
});

test('Gemini 3.8 sends strict JSON schema for the actual batch, without changing its route or input', async () => {
  for (const size of [1, 2, LIMITS.segments]) {
    const segments = Array.from({ length: size }, (_, i) => ({ id: `caption_${i}`, text: `dummy ${i}` }));
    const results = segments.map(s => ({ id: s.id, text: '번역' })).reverse();
    const provider = createKieProvider({ apiKey: 'DUMMY_ONLY', model: geminiId, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.stream, false); assert.equal(body.include_thoughts, false); assert.equal(body.tools, undefined);
      assert.deepEqual(JSON.parse(body.messages[1].content[0].text).segments, segments);
      assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'structured_output', strict: true, schema: {
        type: 'object', properties: { translations: { type: 'array', minItems: size, maxItems: size, items: {
          type: 'object', properties: { id: { type: 'string', enum: segments.map(s => s.id) }, text: { type: 'string' } },
          required: ['id', 'text'], additionalProperties: false
        } } }, required: ['translations'], additionalProperties: false
      } } });
      return Response.json(chatText(JSON.stringify({ translations: results })));
    } });
    assert.deepEqual((await provider({ ...request, segments, chars: segments.reduce((n, s) => n + s.text.length, 0) })).translations, results);
  }
});

test('Gemini 3.8 schema rejection does not silently retry without schema or change the model', async () => {
  for (const status of [400, 404]) {
    let calls = 0, usage;
    const provider = createKieProvider({ apiKey: 'DUMMY', model: geminiId, fetchImpl: async (_url, options) => {
      calls++; assert.ok(JSON.parse(options.body).response_format);
      return Response.json({ error: { message: 'PRIVATE_INPUT' }, usage: { prompt_tokens: 20, total_tokens: 20 } }, { status });
    } });
    await assert.rejects(provider(request, { onUsage: (_id, value) => { usage = value; } }), { code: 'PROVIDER_MODEL_OR_REQUEST', message: 'PROVIDER_MODEL_OR_REQUEST' });
    assert.equal(calls, 1); assert.equal(usage.promptTokenCount, 20);
  }
});

test('empty, plain-text and broken-JSON outputs produce content-free diagnostics with usage and no retries', async () => {
  for (const [content, code] of [['', 'KIE_TRANSLATION_EMPTY'], [' \r\n ', 'KIE_TRANSLATION_EMPTY'],
    ['```json\n \n```', 'KIE_TRANSLATION_EMPTY'], ['PRIVATE translated sentence', 'KIE_TRANSLATION_TEXT'],
    ['{"translations": [{"id":"PRIVATE', 'KIE_TRANSLATION_JSON'], ['```json\nPRIVATE\n```', 'KIE_TRANSLATION_TEXT']]) {
    let calls = 0, usage;
    const provider = createKieProvider({ apiKey: 'DUMMY', model: geminiId, fetchImpl: async () => { calls++; return Response.json(chatText(content)); } });
    await assert.rejects(provider(request, { onUsage: (_id, value) => { usage = value; } }), error => {
      assert.equal(error.code, code); assert.equal(error.message, code); assert.ok(!JSON.stringify(error).includes('PRIVATE')); return true;
    });
    assert.equal(calls, 1); assert.equal(usage.totalTokenCount, 30);
  }
});

test('Kie diagnoses HTTP JSON separately from missing or ambiguous response envelopes', async () => {
  await assert.rejects(createKieProvider({ apiKey: 'DUMMY', model: geminiId, fetchImpl: async () => new Response('<html>PRIVATE</html>') })(request),
    { code: 'KIE_RESPONSE_JSON', message: 'KIE_RESPONSE_JSON' });
  for (const data of [null, [], { data: responseData('chat') }, { choices: [] }, { choices: [{ finish_reason: 'stop', message: { content: [] } }] },
    { ...nativeText(), ...chatText(text) }]) {
    await assert.rejects(mocked(data)(request), { code: 'KIE_RESPONSE_ENVELOPE', message: 'KIE_RESPONSE_ENVELOPE' });
  }
});

test('Kie diagnoses schema and segment IDs separately, without exposing output', async () => {
  for (const value of [null, [], { translations, extra: 'NEVER_ECHO' }, { translations: {} }, { translations: [{ id: 's1', text: 'x', extra: 'x' }, translations[0]] },
    { translations: [{ id: 's1', text: 3 }, translations[0]] }, { translations: [{ id: 's1', text: ' ' }, translations[0]] },
    { translations: [{ id: 's1', text: 'x'.repeat(LIMITS.translationChars) }, translations[0]] }]) {
    await assert.rejects(mocked(chatText(JSON.stringify(value)))(request), { code: 'KIE_TRANSLATION_SCHEMA', message: 'KIE_TRANSLATION_SCHEMA' });
  }
  for (const items of [[], [translations[0]], [translations[0], translations[0]], [{ id: 'wrong', text: 'NEVER_ECHO' }, translations[0]]]) {
    await assert.rejects(mocked(chatText(JSON.stringify({ translations: items })))(request), { code: 'KIE_TRANSLATION_IDS', message: 'KIE_TRANSLATION_IDS' });
  }
});

test('Gemini 3.8 native response joins text, excludes thoughts and records numeric native usage', async () => {
  let usage;
  const data = nativeText([{ text: 'PRIVATE THOUGHT', thought: true, thoughtSignature: 'PRIVATE' }, { text: text.slice(0, 10) }, { text: text.slice(10), thought: false }]);
  assert.deepEqual(await mocked(data)(request, { onUsage: (_id, value) => { usage = value; } }), { jobId: request.jobId, translations });
  assert.deepEqual(usage, { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5, totalTokenCount: 35 });
  // The exception must not silently enable undocumented envelopes on other routes.
  for (const model of ['gemini-3-7-flash-openai', 'gpt-5-2']) await assert.rejects(mocked(data, model)(request), { code: 'KIE_RESPONSE_ENVELOPE' });
});

test('Gemini native tool calls, blocked/incomplete candidates and thought-only output remain rejected with usage retained', async () => {
  const incomplete = nativeText(); incomplete.candidates[0].finishReason = 'MAX_TOKENS';
  const blocked = { ...nativeText(), promptFeedback: { blockReason: 'SAFETY' } };
  for (const data of [incomplete, blocked, nativeText([{ functionCall: { name: 'anything' } }]), nativeText([{ text, executableCode: {} }]),
    nativeText([{ text, thought: true }]), nativeText([{ text, thought: 'true' }]), nativeText([null])]) {
    let usage;
    await assert.rejects(mocked(data)(request, { onUsage: (_id, value) => { usage = value; } }), { code: 'PROVIDER_INCOMPLETE' });
    assert.equal(usage.totalTokenCount, 35);
  }
  await assert.rejects(mocked({ ...nativeText(), candidates: [] })(request), { code: 'KIE_RESPONSE_ENVELOPE' });
  let usage;
  await assert.rejects(mocked(nativeText([{ text: '{broken' }]))(request, { onUsage: (_id, value) => { usage = value; } }), { code: 'KIE_TRANSLATION_JSON' });
  assert.equal(usage.totalTokenCount, 35);
});
