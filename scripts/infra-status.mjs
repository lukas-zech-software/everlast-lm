#!/usr/bin/env node
// =============================================================================
// Everlast LM — Infrastructure Status Dashboard
// Inspects and displays the live status of all GCP resources managed by OpenTofu
// Traceability: D1, D3, D4, NFR-PERF-01/02, §5.4–§5.5
// =============================================================================

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const env = process.argv[2] || 'dev';
const envDir = path.join(repoRoot, 'infra', 'environments', env);

function run(cmd, options = {}) {
  try {
    return execSync(cmd, {
      cwd: options.cwd || repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    }).trim();
  } catch (err) {
    if (options.allowError) return null;
    throw err;
  }
}

function getAccessToken() {
  return run('gcloud auth print-access-token');
}

console.log(`\n=================================================================`);
console.log(` Everlast LM — Infrastructure Status Dashboard [Environment: ${env.toUpperCase()}]`);
console.log(`=================================================================\n`);

let token;
try {
  token = getAccessToken();
} catch {
  console.error('Error: Could not retrieve gcloud access token. Please run `gcloud auth login`.');
  process.exit(1);
}

// 1. Fetch OpenTofu Outputs
console.log('Fetching OpenTofu state outputs...');
let outputs = {};
try {
  const outputRaw = run(`tofu -chdir=${envDir} output -json`, {
    env: { GOOGLE_OAUTH_ACCESS_TOKEN: token },
  });
  outputs = JSON.parse(outputRaw);
} catch (err) {
  console.warn('Warning: Could not read OpenTofu outputs directly from state backend. Will inspect GCP directly.');
}

const sqlConnName = outputs.cloud_sql_connection_name?.value;
const apiUri = outputs.api_service_uri?.value;
const workerUri = outputs.worker_service_uri?.value;
const workspaceBucket = outputs.workspace_bucket_name?.value;
const ingestionQueue = outputs.ingestion_queue_name?.value || `everlast-${env}-ingestion-queue`;
const studioQueue = outputs.studio_queue_name?.value || `everlast-${env}-studio-queue`;
const docAiProcessor = outputs.document_ai_layout_processor_name?.value;
const registryUrl = outputs.artifact_registry_url?.value;

// 2. Cloud SQL Database Status
console.log('\n--- Cloud SQL PostgreSQL 16 (D1, D4) ---');
try {
  const sqlInstance = `everlast-${env}-pg`;
  const rawSql = run(`gcloud sql instances describe ${sqlInstance} --format="json" --quiet`, { allowError: true });
  if (rawSql) {
    const data = JSON.parse(rawSql);
    const primaryIp = data.ipAddresses?.find((ip) => ip.type === 'PRIMARY')?.ipAddress || 'N/A';
    const activation = data.settings?.activationPolicy || 'UNKNOWN';
    const state = data.state || 'UNKNOWN';
    const tier = data.settings?.tier || 'UNKNOWN';
    const isPaused = activation === 'NEVER' || state === 'STOPPED';

    console.log(` Instance Name:       ${data.name}`);
    console.log(` State:               ${isPaused ? '\x1b[33mPAUSED / STOPPED\x1b[0m' : '\x1b[32mRUNNING\x1b[0m'} (${state})`);
    console.log(` Activation Policy:   ${activation} (${isPaused ? 'Compute stopped, SSD only' : 'Compute billing active'})`);
    console.log(` Machine Tier:        ${tier} (PostgreSQL 16 Enterprise)`);
    console.log(` Primary IPv4:        ${primaryIp}`);
    console.log(` IAM Database Auth:   ${data.settings?.databaseFlags?.some((f) => f.name === 'cloudsql.iam_authentication' && f.value === 'on') ? 'ON (Keyless)' : 'OFF'}`);
  } else {
    console.log(' Instance not found or inaccessible.');
  }
} catch (e) {
  console.log(` Error checking Cloud SQL: ${e.message}`);
}

// 3. Cloud Run Services (Scale-to-Zero Compute)
console.log('\n--- Cloud Run v2 Services (D3, D4) ---');
const services = [`everlast-${env}-api`, `everlast-${env}-worker`];
for (const svcName of services) {
  try {
    const rawSvc = run(`gcloud run services describe ${svcName} --region=europe-west4 --format="json" --quiet`, { allowError: true });
    if (rawSvc) {
      const data = JSON.parse(rawSvc);
      const isReady = data.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True';
      const url = data.status?.url || 'N/A';
      const minInstances = data.spec?.template?.metadata?.annotations?.['run.googleapis.com/minScale'] || '0';
      const maxInstances = data.spec?.template?.metadata?.annotations?.['run.googleapis.com/maxScale'] || 'unlimited';
      const ingress = data.spec?.template?.metadata?.annotations?.['run.googleapis.com/ingress'] || 'all';

      console.log(` Service:             ${svcName}`);
      console.log(`   Status:            ${isReady ? '\x1b[32mREADY\x1b[0m' : '\x1b[31mNOT READY\x1b[0m'}`);
      console.log(`   URL:               ${url}`);
      console.log(`   Min Instances:     ${minInstances} (${minInstances === '0' ? 'Scale-to-Zero / $0 idle' : '\x1b[33mWarmed Up / Idle active\x1b[0m'})`);
      console.log(`   Max Instances:     ${maxInstances}`);
      console.log(`   Ingress:           ${ingress}`);
    } else {
      console.log(` Service ${svcName}: Not found.`);
    }
  } catch (e) {
    console.log(` Error checking ${svcName}: ${e.message}`);
  }
}

// 4. Cloud Tasks Queues (europe-west1)
console.log('\n--- Cloud Tasks Queues (D3, D4, §3.3) ---');
const queues = [ingestionQueue, studioQueue];
for (const qName of queues) {
  try {
    const rawQ = run(`gcloud tasks queues describe ${qName} --location=europe-west1 --format="json" --quiet`, { allowError: true });
    if (rawQ) {
      const data = JSON.parse(rawQ);
      console.log(` Queue:               ${qName} (${data.state === 'RUNNING' ? '\x1b[32mRUNNING\x1b[0m' : data.state})`);
      console.log(`   Dispatch Rate:     ${data.rateLimits?.maxDispatchesPerSecond}/sec (Concurrency: ${data.rateLimits?.maxConcurrentDispatches})`);
    } else {
      console.log(` Queue ${qName}: Not found.`);
    }
  } catch (e) {
    console.log(` Error checking ${qName}: ${e.message}`);
  }
}

// 5. Cloud Storage Buckets
console.log('\n--- Cloud Storage Buckets (D3, FR-WM-04, FR-SI-01) ---');
const buckets = [workspaceBucket, `everlast-lm-${env}-tfstate`].filter(Boolean);
for (const bName of buckets) {
  try {
    const rawB = run(`gcloud storage buckets describe gs://${bName} --format="json" --quiet`, { allowError: true });
    if (rawB) {
      const data = JSON.parse(rawB);
      console.log(` Bucket:              gs://${bName}`);
      console.log(`   Location:          ${data.location} (${data.storage_class})`);
      console.log(`   Versioning:        ${data.versioning_enabled ? 'Enabled' : 'Disabled'}`);
      console.log(`   Access Prevention: ${data.public_access_prevention}`);
    }
  } catch (e) {
    console.log(` Bucket gs://${bName}: Not accessible or not found.`);
  }
}

// 6. Secret Manager (Regional)
console.log('\n--- Secret Manager (Regional europe-west4, D3, NFR-SEC-01) ---');
const secrets = [`everlast-${env}-app-session-secret`, `everlast-${env}-oidc-client-config`];
for (const sName of secrets) {
  try {
    const rawS = run(`gcloud secrets describe ${sName} --format="json" --quiet`, { allowError: true });
    if (rawS) {
      const data = JSON.parse(rawS);
      const locations = data.replication?.userManaged?.replicas?.map((r) => r.location).join(', ') || 'N/A';
      console.log(` Secret:              ${sName} (Replication: ${locations})`);
    }
  } catch {
    console.log(` Secret ${sName}: Not found.`);
  }
}

// 7. Document AI & Artifact Registry
console.log('\n--- Specialized Endpoints (D3, FR-SI-01 Subset A) ---');
if (docAiProcessor) {
  console.log(` Document AI Parser:  Processor ID: ${docAiProcessor} (Location: eu)`);
}
if (registryUrl) {
  console.log(` Artifact Registry:   ${registryUrl}`);
}

console.log(`\n=================================================================\n`);
