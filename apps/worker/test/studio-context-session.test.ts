import { randomUUID } from 'node:crypto';
import { describe,expect,it,vi } from 'vitest';
import type { ScopedCorpusManifest } from '@everlast/contracts';
import { StudioContextSessions } from '../src/studio/context-cache.ts';
/** NFR-PERF-01 C-02/C-03 provider expiry, reauthorization, cleanup and complete envelope. */
describe('NFR-PERF-01 private Studio context sessions',()=>{
 it('does not attach cache after revocation, failed provider expiry or cleanup errors',async()=>{
  const notebook=randomUUID(),source=randomUUID();let allowed=true;
  const ledger={notebook_id:notebook,principal_subject:'owner',sources:[{source_id:source,revision:1}],source_token_total:999999,manifest_hash:'a'.repeat(64),effective_authorization_fingerprint:'b'.repeat(64),pages:[{digest:'c'.repeat(64)}],chunks:[]} as unknown as ScopedCorpusManifest;
  const create=vi.fn(async()=>({handle:'private',expiresAt:Date.now()+60000})),cleanup=vi.fn(async()=>{throw new Error('cleanup unavailable');});
  const session=new StudioContextSessions({model:'local',modelVersion:'1',inputLimit:1100000,outputReserve:4096,instructionTokens:1000,ttlSeconds:60,tokenizer:{model:'local',version:'1',count:async()=>0},provider:{create,delete:cleanup}});
  const input={ledger,language:'en',parameters:{},chunks:async function*(){},verify:async()=>{if(!allowed)throw new Error('revoked');},signal:new AbortController().signal};
  const acquired=await session.acquire(input);expect(acquired.handle).toBe('private');
  allowed=false;await expect(acquired.beforeCall()).rejects.toThrow('revoked');expect(cleanup).toHaveBeenCalled();
  allowed=true;await session.acquire(input);expect(create).toHaveBeenCalledTimes(2);
  const invalid=new StudioContextSessions({model:'local',modelVersion:'1',inputLimit:1100000,outputReserve:4096,instructionTokens:1000,ttlSeconds:60,tokenizer:{model:'local',version:'1',count:async()=>0},provider:{create:async()=>({handle:'orphan',expiresAt:NaN}),delete:cleanup}});
  expect((await invalid.acquire(input)).handle).toBeUndefined();
 });
});
