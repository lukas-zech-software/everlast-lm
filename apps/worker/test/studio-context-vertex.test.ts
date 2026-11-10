import { randomUUID } from 'node:crypto';
import { describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({countTokens:vi.fn(),create:vi.fn(),delete:vi.fn()}));
vi.mock('@google/genai',()=>({GoogleGenAI:class{models={countTokens:mocks.countTokens};caches={create:mocks.create,delete:mocks.delete};}}));
import { createVertexStudioContextFromEnv } from '../src/studio/reports/vertex-model.ts';
/** NFR-PERF-01 NFR-SEC-01: local SDK double verifies exact original transfer/count and provider expiry, no cloud calls. */
describe('NFR-PERF-01 enterprise context adapter mechanics',()=>{
 it('counts actual original text and the serialized model envelope separately, with an explicit provider TTL',async()=>{
  mocks.countTokens.mockResolvedValue({totalTokens:1000000});mocks.create.mockResolvedValue({name:'private-handle',expireTime:new Date(Date.now()+60000).toISOString()});
  const runtime=createVertexStudioContextFromEnv({VERTEX_PROJECT:'approved-test-project',VERTEX_LOCATION:'europe-west4'});
  expect(await runtime.tokenizer.count('original source')).toBe(1000000);expect(mocks.countTokens.mock.calls[0]?.[0].contents).toBe('original source');
  const chunk={chunk_id:randomUUID(),source_id:randomUUID(),revision:1,text:'original source',token_count:2,locator:{page_number:1,start_offset:0,end_offset:15}};
  const created=await runtime.provider.create({chunks:(async function*(){yield [chunk];})(),model:runtime.model,ttlSeconds:60,signal:new AbortController().signal});
  expect(created.handle).toBe('private-handle');expect(mocks.create.mock.calls[0]?.[0].config.ttl).toBe('60s');expect(JSON.stringify(mocks.create.mock.calls[0])).toContain('original source');
  mocks.countTokens.mockResolvedValue({totalTokens:1048576});
  await expect(runtime.provider.create({chunks:(async function*(){yield [chunk];})(),model:runtime.model,ttlSeconds:60,signal:new AbortController().signal})).rejects.toThrow(/envelope/);
 });
});
