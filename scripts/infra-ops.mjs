#!/usr/bin/env node
// =============================================================================
// Everlast LM — FinOps & Demo Operations Controller
// Controls start/pause of Cloud SQL and pre-demo warm-up / cooldown of Cloud Run
// Traceability: D4, NFR-PERF-01/02, §5.4–§5.5
// =============================================================================

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const action = process.argv[2];
const env = process.argv[3] || 'dev';
const tfvarsPath = path.join(repoRoot, 'infra', 'environments', env, 'opentofu.auto.tfvars');

function run(cmd) {
  console.log(`> ${cmd}`);
  return execSync(cmd, {
    cwd: repoRoot,
    stdio: 'inherit',
    encoding: 'utf-8',
    env: process.env,
  });
}

function updateTfvars(key, value) {
  if (!fs.existsSync(tfvarsPath)) return;
  let content = fs.readFileSync(tfvarsPath, 'utf-8');
  const regex = new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, 'm');
  const formattedValue = typeof value === 'string' ? `"${value}"` : value;
  if (regex.test(content)) {
    content = content.replace(regex, `$1${formattedValue}`);
  } else {
    content += `\n${key} = ${formattedValue}\n`;
  }
  fs.writeFileSync(tfvarsPath, content, 'utf-8');
  console.log(`Updated ${key} = ${formattedValue} in ${tfvarsPath}`);
}

const sqlInstance = `everlast-${env}-pg`;
const apiService = `everlast-${env}-api`;
const region = 'europe-west4';

switch (action) {
  case 'pause':
    console.log(`\nPausing Cloud SQL instance ${sqlInstance} to stop idle compute billing (D4, §5.4)...`);
    updateTfvars('db_activation_policy', 'NEVER');
    run(`gcloud sql instances patch ${sqlInstance} --activation-policy=NEVER --quiet`);
    console.log(`\n✓ Cloud SQL paused (activation-policy=NEVER). Compute billing stopped (~$3.40/month SSD preserved).`);
    break;

  case 'start':
  case 'resume':
    console.log(`\nResuming Cloud SQL instance ${sqlInstance} for active work (D4, §5.4)...`);
    updateTfvars('db_activation_policy', 'ALWAYS');
    run(`gcloud sql instances patch ${sqlInstance} --activation-policy=ALWAYS --quiet`);
    console.log(`\n✓ Cloud SQL resumed (activation-policy=ALWAYS). Compute ready for queries.`);
    break;

  case 'warmup':
    console.log(`\nWarming up everlast-api to min-instances=1 to eliminate cold-start latency (§5.5, NFR-PERF-01/02)...`);
    updateTfvars('api_min_instances', 1);
    updateTfvars('db_activation_policy', 'ALWAYS');
    run(`gcloud run services update ${apiService} --region=${region} --min-instances=1 --quiet`);
    run(`gcloud sql instances patch ${sqlInstance} --activation-policy=ALWAYS --quiet`);
    console.log(`\n✓ Pre-demo warm-up complete: everlast-api min-instances=1, Cloud SQL ALWAYS active.`);
    break;

  case 'cooldown':
    console.log(`\nResetting everlast-api to min-instances=0 for scale-to-zero / $0 idle (§5.5, D4)...`);
    updateTfvars('api_min_instances', 0);
    run(`gcloud run services update ${apiService} --region=${region} --min-instances=0 --quiet`);
    console.log(`\n✓ Cooldown complete: everlast-api returned to scale-to-zero (min-instances=0).`);
    break;

  default:
    console.log(`Usage: node scripts/infra-ops.mjs <start|pause|warmup|cooldown> [environment]`);
    process.exit(1);
}
