import test from 'node:test';
import assert from 'node:assert/strict';
import { listOpenAIModels, OPENAI_MODELS } from '../../src/extension/openai-models.mjs';
import { createOpenAIProvider, openaiText, openaiUsage } from '../../src/extension/openai.mjs';

const request = { jobId: 'test', chars: 10, sourceLanguage: 'auto', targetLanguage: 'ko', segments: [{ id: 's1', text: 'Hello' }, { id: 's2', text: 'World' }] };
const answer = { translations: [{ id: 's2', text: '세계' }, { id: 's1', text: '안녕' }] };
const envelope = (value = answer) => ({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 10, output_tokens: 12, output_tokens_details: { reasoning_tokens: 2 }, input_tokens_details: { cached_tokens: 3 }, total_tokens: 22 } });
const provider = fetchImpl => createOpenAIProvider({ apiKey: 'DUMMY_OPENAI_KEY', model: 'gpt-5.6-luna', fetchImpl });

test('OpenAI catalog intersects audited models, deduplicates and sorts release dates, excluding expired and specialized models', async () => {
  const models = await listOpenAIModels({ apiKey: 'DUMMY', now: () => Date.UTC(2026,8,7), fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models'); assert.deepEqual(options.headers, { Authorization: 'Bearer DUMMY' });
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return Response.json({ object: 'list', data: ['gpt-4o-mini', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-6-astra', 'gpt-image-1', 'gpt-future', 'gpt-4o-mini-audio', 'embedding', '../outside'].map(id => ({ id, object: 'model', created: 9999999999 }))
      .concat([{id:'gpt-5.5',object:'model',shutdown_date:'2026-09-06'}]) });
  } });
  assert.deepEqual(models.map(m => m.id), ['gpt-6-astra', 'gpt-5.6-luna', 'gpt-4o-mini']);
  assert.equal(OPENAI_MODELS.length, 12); assert.ok(models.every(m => m.images));
});
test('OpenAI catalog errors sanitize upstream text and respect cancellation', async () => {
  await assert.rejects(listOpenAIModels({ fetchImpl: async () => Response.json({error:'SECRET'}, {status:401}) }),{code:'PROVIDER_AUTH'});
  await assert.rejects(listOpenAIModels({ fetchImpl: async () => Response.json({data:{}}) }),{code:'INVALID_MODEL_LIST'});
  const controller=new AbortController();controller.abort();
  await assert.rejects(listOpenAIModels({signal:controller.signal,fetchImpl:()=>assert.fail('must not call')}),{code:'CANCELLED'});
});
test('OpenAI direct translation uses strict Responses schema, no storage/tools, preserves segment ids and accounts for reasoning separately', async () => {
  let calls=0, quota, usage;
  const result=await provider(async(url,options)=>{
    calls++; assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer DUMMY_OPENAI_KEY');
    assert.equal(options.headers['x-goog-api-key'],undefined);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.stream,false);assert.equal(body.max_output_tokens,16384);
    assert.equal(body.tools,undefined);assert.equal(body.temperature,undefined);assert.equal(body.reasoning.effort,'low');assert.equal(body.text.format.strict,true);
    assert.deepEqual(JSON.parse(body.input[0].content[0].text).segments,request.segments);
    assert.deepEqual(body.text.format.schema.properties.translations.items.properties.id.enum,['s1','s2']);
    return Response.json(envelope());
  })(request,{beforeAttempt:n=>{quota=n;},onAttempt:()=> 'attempt',onUsage:(id,n)=>{assert.equal(id,'attempt');usage=n;}});
  assert.deepEqual(result.translations,answer.translations);assert.equal(calls,1);assert.equal(quota,10);
  assert.deepEqual(usage,{promptTokenCount:10,candidatesTokenCount:10,thoughtsTokenCount:2,totalTokenCount:22,cachedContentTokenCount:3});
});
test('OpenAI image request uses validated inline pixels and preserves no-text result without reasoning options for GPT-4', async()=>{
  const bytes=Buffer.alloc(24);Buffer.from('\x89PNG\r\n\x1a\n','binary').copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(1,16);bytes.writeUInt32BE(1,20);
  const image={mimeType:'image/png',data:bytes.toString('base64')}, good={noText:true,recognizedText:'',translation:''};
  const translate=createOpenAIProvider({apiKey:'DUMMY',model:'gpt-4.1-mini',imageMode:true,fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.reasoning,undefined);
    assert.equal(body.input[0].content[1].image_url,'data:image/png;base64,'+image.data);
    assert.equal(body.text.format.name,'image_translation');assert.equal(body.store,false);
    return Response.json(envelope(good));
  }});
  assert.deepEqual(await translate({jobId:'image',targetLanguage:'ko',image}),{jobId:'image',...good});
  await assert.rejects(translate({jobId:'image',targetLanguage:'ko',image:{mimeType:'image/svg+xml',data:'BAD'}}),{code:'INVALID_IMAGE'});
});
test('OpenAI refuses incomplete, refusal, tool output, malformed JSON and altered IDs; reported usage remains available',async()=>{
  const fixtures=[
    [{...envelope(),status:'incomplete'},'OPENAI_INCOMPLETE'],
    [{...envelope(),output:[{type:'function_call'}]},'OPENAI_RESPONSE_FORMAT'],
    [{...envelope(),output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'PRIVATE'}]}]},'OPENAI_REFUSAL'],
    [envelope({translations:[{id:'s1',text:'안녕'},{id:'s1',text:'dup'}]}),'INVALID_PROVIDER_RESPONSE']
  ];
  const malformed=envelope();malformed.output[1].content[0].text='not JSON';fixtures.push([malformed,'OPENAI_RESPONSE_JSON']);
  for(const [data,code] of fixtures){let usage;await assert.rejects(provider(async()=>Response.json(data))(request,{onUsage:(_id,u)=>{usage=u;}}),{code});assert.equal(usage.totalTokenCount,22);}
  assert.throws(()=>openaiText({...envelope(),output:[]}),{code:'OPENAI_RESPONSE_FORMAT'});
});
test('OpenAI does not retry failed, rate-limited or ambiguous requests',async()=>{
  for(const [status,code] of [[401,'PROVIDER_AUTH'],[400,'PROVIDER_MODEL_OR_REQUEST'],[429,'OPENAI_RATE_LIMIT'],[500,'OPENAI_UNAVAILABLE'],[503,'OPENAI_UNAVAILABLE']]){
    let calls=0;await assert.rejects(provider(async()=>{calls++;return Response.json({error:{message:'PRIVATE'}},{status});})(request),{code});assert.equal(calls,1);
  }
  await assert.rejects(provider(async()=>{throw Error('PRIVATE');})(request),{code:'OPENAI_NETWORK'});
  await assert.rejects(provider(async()=>Response.json({error:{code:'insufficient_quota'}},{status:429}))(request),{code:'PROVIDER_BALANCE'});
});
test('OpenAI usage does not invent missing counts or double-count reasoning',()=>{
  assert.deepEqual(openaiUsage({}),{});assert.deepEqual(openaiUsage({usage:{output_tokens:10,output_tokens_details:{reasoning_tokens:11}}}),{});
  assert.deepEqual(openaiUsage({usage:{input_tokens:2,output_tokens:5}}),{promptTokenCount:2,candidatesTokenCount:5});
});
