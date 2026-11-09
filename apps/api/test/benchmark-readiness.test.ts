import { describe,expect,it } from 'vitest';
import { classifyReadiness, PrivateBenchmarkRecorder } from '../src/observability/benchmark.ts';
const evidence={instance_boot_id:'boot',revision:'rev',ready_at_ms:90,dependencies:{sql:true,model:true,retrieval:true,cache:true,migrations:true,recovery:true}};
describe('NFR-PERF-01 D17 prospective serving-instance readiness',()=>{
 it('requires same boot/revision and every dependency before submission, including uncertainty',()=>{
  const request={instance_boot_id:'boot',revision:'rev',client_submission_epoch_ms:100,clock_uncertainty_ms:5};
  expect(classifyReadiness(evidence,request)).toBe('warm');
  expect(classifyReadiness({...evidence,ready_at_ms:110},request)).toBe('wake');
  expect(classifyReadiness({...evidence,ready_at_ms:98},request)).toBe('invalid_environment');
  expect(classifyReadiness(evidence,{...request,instance_boot_id:'other'})).toBe('invalid_environment');
  expect(classifyReadiness(evidence,{...request,clock_uncertainty_ms:NaN})).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,dependencies:{...evidence.dependencies,model:false}},request)).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,dependencies:{...evidence.dependencies,migrations:false}},request)).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,dependencies:{...evidence.dependencies,recovery:false}},request)).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,dependencies:{...evidence.dependencies,retrieval:false,cache:false}},request)).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,ready_at_ms:null},request)).toBe('invalid_environment');
  expect(classifyReadiness(evidence,{...request,clock_uncertainty_ms:-1})).toBe('invalid_environment');
 });
 it('records identifiers/stages only for approved synthetic scopes; never raw content or secrets',()=>{
  const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:['approved'],revision:'rev',sink:()=>{}});
  expect(recorder.begin('private','request')).toBeUndefined();
  const span=recorder.begin('approved','request');
  expect(span).toBeDefined();
  expect(recorder.readiness()).toMatchObject({revision:'rev',ready_at_ms:null});
 });
});
