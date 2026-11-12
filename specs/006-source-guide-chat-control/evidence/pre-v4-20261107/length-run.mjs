import {writeFileSync} from 'node:fs';
import {createTestDatabase} from '../../../../packages/db/src/testing.ts';
import {createVertexClient,vertexConfigFromEnv,VertexEmbedder,NoOcrEngine} from '../../../../packages/cloud/src/index.ts';
import {AdkGroundedModel} from '../../../../apps/api/src/chat/model.ts';
import {createResponseLengthRunner} from '../../../../packages/evals/src/runner.ts';
import {runResponseLengthEval} from '../../../../packages/evals/src/response-length.ts';
import {buildGoldenDataset,releaseSample,datasetHash,corpusHash} from '../../../../packages/evals/src/dataset.ts';
const config=vertexConfigFromEnv();
const db=await createTestDatabase();
try {
 const runner=await createResponseLengthRunner({pool:db.pool,embedder:new VertexEmbedder({client:createVertexClient(config)}),model:new AdkGroundedModel({...config,model:'gemini-2.5-flash'}),ocr:new NoOcrEngine(),judge:null,concurrency:1,log:console.log});
 try {
  const dataset=buildGoldenDataset(); const sample=releaseSample(dataset);
  const result=await runResponseLengthEval({answer:async(c,length)=>{const answer=await runner.answer(c,length); console.log(c.id,length,answer); return answer;}},sample);
  writeFileSync(process.argv[2],JSON.stringify({datasetHash:datasetHash(dataset),corpusHash:corpusHash(),sample:sample.map(c=>c.id),result},null,2));
  console.log(JSON.stringify(result));
 } finally {await runner.close();}
} finally {await db.drop();}
