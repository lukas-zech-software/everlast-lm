#!/usr/bin/env node
/** NFR-PERF-01 / NFR-SEC-02: owner-only bridge operator. No HTTP endpoint or generic log transport. */
import { parseArgs } from 'node:util';
import { resolve,dirname,basename } from 'node:path';
import { sign,createPrivateKey } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrivateBenchmarkOperator,PrivateClockOperator,PRIVATE_BRIDGE_POLICY,OwnerPrivateDirectory,GcsPrivateBridgeObjects,LocalPrivateBridgeObjects } from '@everlast/cloud/private-benchmark';
const {values,positionals}=parseArgs({allowPositionals:true,options:{'identity-file':{type:'string'},'calibration-file':{type:'string'},'receipt-key-file':{type:'string'},'public-key-file':{type:'string'},'private-key-file':{type:'string'},'payload-file':{type:'string'},'signature-file':{type:'string'},directory:{type:'string'},bucket:{type:'string'},'local-root':{type:'string'},'duration-seconds':{type:'string',default:'60'}}});
function read(path,max=128000){if(!path)throw new Error('Required private file missing');const absolute=resolve(path),data=new OwnerPrivateDirectory(dirname(absolute)).read(basename(absolute),max);if(!data)throw new Error('Private input absent');return data.toString();}
async function main(){
 const command=positionals[0];if(!['discover','preflight','deliver','download','follow','sign','clock-discover','clock-acquire'].includes(command))throw new Error('Expected discover/preflight/deliver/download/follow/sign/clock-discover/clock-acquire');
 if(command==='sign'){const privateKey=createPrivateKey(read(values['private-key-file'],8192));if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('Only Ed25519 authorizations');const payload=read(values['payload-file']);const output=resolve(values['signature-file']??'');if(!values['signature-file'])throw new Error('Signature path required');new OwnerPrivateDirectory(dirname(output)).write(basename(output),sign(null,Buffer.from(payload),privateKey).toString('base64'));return;}
 if(Boolean(values.bucket)===Boolean(values['local-root']))throw new Error('Choose exactly one bucket or local test root');
 const objects=values['local-root']?new LocalPrivateBridgeObjects(resolve(values['local-root'])):new GcsPrivateBridgeObjects({bucket:values.bucket});
 const identity=JSON.parse(read(values['identity-file']));
 if(command==='clock-discover'||command==='clock-acquire'){
  const clock=new PrivateClockOperator({
   identity,objects,receiptPublicKey:read(values['receipt-key-file'],8192),
   ...(command==='clock-acquire'?{ownerPrivateKey:read(values['private-key-file'],8192)}:{}),
  });
  try{
   if(command==='clock-discover'){
    console.log(JSON.stringify({boots:await clock.discover(),release_eligible:false}));
    return;
   }
   if(!values.directory)throw new Error('Owner-private clock evidence directory required');
   const files=new OwnerPrivateDirectory(resolve(values.directory),true);
   const publicKey=read(values['public-key-file'],8192);
   const {proof,acknowledgment,assertClockCurrent}=await clock.acquire(measurement=>files.write('clock-proof.json',JSON.stringify(measurement)+'\n'));
   files.write('clock-installed.json',JSON.stringify(acknowledgment)+'\n');
   const confirmer=new PrivateBenchmarkOperator({
    identity,objects,publicKey,calibration:proof.calibration,
    policy:{...PRIVATE_BRIDGE_POLICY,max_duration_ms:5000},
   });
   try {
    const deadline=performance.now()+5000;
    for (;;) {
     assertClockCurrent();
     try { await confirmer.challenge(); break; }
     catch(error) {
      if(confirmer.stopped||performance.now()>=deadline)throw error;
      await delay(Math.min(100,Math.max(0,deadline-performance.now())));
     }
    }
    assertClockCurrent();
    files.write('calibration.json',JSON.stringify(proof.calibration)+'\n');
    console.log(JSON.stringify({result:'CLOCK_INSTALLED',release_eligible:false}));
    return;
   }finally{confirmer.close();}
  }finally{clock.close();}
 }
 const operator=new PrivateBenchmarkOperator({identity,publicKey:read(values['public-key-file'],8192),calibration:JSON.parse(read(values['calibration-file'])),objects});
 try{
  if(command==='discover'){console.log(JSON.stringify({boots:await operator.discover(),release_eligible:false}));return;}
  if(command==='preflight'||command==='deliver'){const payload=read(values['payload-file']),signature=read(values['signature-file'],1024).trim();if(command==='preflight')await operator.preflight(payload,signature);else await operator.deliver(payload,signature);console.log(JSON.stringify({result:command==='deliver'?'DELIVERED':'PREFLIGHT',release_eligible:false}));return;}
  if(!values.directory)throw new Error('Owner-private download directory required');const files=new OwnerPrivateDirectory(resolve(values.directory),true);
  const seconds=Number(values['duration-seconds']);if(!Number.isSafeInteger(seconds)||seconds<1||seconds>3600)throw new Error('Follow duration must be 1..3600 seconds');
  const until=Date.now()+(command==='follow'?seconds*1000:0);let previous='';
  do{const downloaded=await operator.download(),index=JSON.stringify(downloaded.index);if(index!==previous){
    // Each canonical collector file is one same-directory 0600 atomic replacement. Manifest last.
    for(const [kind,value] of Object.entries(downloaded.files)){const name=kind==='code'?'code-evidence.json':kind==='scale'?'scale-evidence.jsonl':kind+'.json';files.write(name,kind==='scale'?value.map(row=>JSON.stringify(row)).join('\n')+'\n':JSON.stringify(value)+'\n');}
    files.write('manifest.json',index+'\n');previous=index;
   }if(command!=='follow'||Date.now()>=until)break;await delay(Math.min(1000,until-Date.now()));
  }while(Date.now()<until);
  console.log(JSON.stringify({result:'DOWNLOADED',release_eligible:false}));
 }finally{operator.close();}
}
main().catch(()=>{console.error('Private benchmark operation unavailable; no qualification claimed.');process.exitCode=1;});
