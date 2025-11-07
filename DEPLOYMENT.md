# Arke Preprocessing Orchestrator - Deployment Guide

## Overview

This service orchestrates TIFF conversion (and future preprocessing tasks) by spawning ephemeral Fly.io machines in parallel. It uses Cloudflare Durable Objects for stateful, resumable processing.

---

## Prerequisites

1. **Cloudflare Account** with Workers plan
2. **Fly.io Account** with API token
3. **Fly.io Worker Image** deployed (see Worker Contract below)
4. **R2 Credentials** for accessing storage
5. **Wrangler CLI** installed (`npm install -g wrangler`)

---

## Setup Secrets

Store sensitive credentials as Wrangler secrets:

```bash
# Fly.io API token
wrangler secret put FLY_API_TOKEN

# R2 credentials
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

To get your Fly.io API token:
```bash
fly auth token
```

---

## Configuration

Update `wrangler.jsonc` with your settings:

```jsonc
{
  "vars": {
    // Fly.io app name (must match deployed worker app)
    "FLY_APP_NAME": "arke-tiff-worker",

    // Fly.io Docker image
    "FLY_WORKER_IMAGE": "registry.fly.io/arke-tiff-worker:latest",

    // Fly.io region (ord=Chicago, recommended for Cloudflare R2)
    "FLY_REGION": "ord",

    // This worker's URL (update after first deployment)
    "ORCHESTRATOR_URL": "https://arke-preprocessing.YOUR-SUBDOMAIN.workers.dev",

    // Ingest worker callback URL
    "WORKER_URL": "https://ingest.arke.institute",

    // R2 bucket
    "R2_BUCKET": "arke-staging",

    // Batch size (max Fly machines spawned per alarm)
    "BATCH_SIZE_TIFF_CONVERSION": "1000",

    // Alarm delays (ms)
    "ALARM_DELAY_TIFF_CONVERSION": "5000",
    "ALARM_DELAY_ERROR_RETRY": "30000",

    // Max retry attempts
    "MAX_RETRY_ATTEMPTS": "5"
  }
}
```

---

## Deploy

```bash
# Type check
npm run typecheck

# Deploy to Cloudflare
wrangler deploy

# View logs
wrangler tail
```

**After first deployment**, update `ORCHESTRATOR_URL` in `wrangler.jsonc` with your actual worker URL.

---

## Fly.io Worker Contract

### What the Orchestrator Provides

**Environment Variables:**
```bash
TASK_ID="batch_abc_tiff_12345"
BATCH_ID="batch_abc"
INPUT_R2_KEY="staging/batch_abc/folder/image.tiff"
R2_ACCOUNT_ID="your_account_id"
R2_ACCESS_KEY_ID="your_access_key"
R2_SECRET_ACCESS_KEY="your_secret_key"
R2_BUCKET="arke-staging"
CALLBACK_URL="https://arke-preprocessing.workers.dev/callback/batch_abc/batch_abc_tiff_12345"
```

### What the Worker Must Do

1. **Download TIFF from R2** using `INPUT_R2_KEY`
2. **Convert to JPEG** using Sharp (quality: 95, mozjpeg: true)
3. **Upload JPEG to R2** (replace `.tif`/`.tiff` with `.jpg`)
4. **Send HTTP callback** to `CALLBACK_URL`

**Success Callback:**
```json
POST {CALLBACK_URL}
{
  "task_id": "batch_abc_tiff_12345",
  "batch_id": "batch_abc",
  "status": "success",
  "output_r2_key": "staging/batch_abc/folder/image.jpg",
  "output_file_name": "image.jpg",
  "output_file_size": 524288,
  "performance": {
    "total_time_ms": 1234,
    "download_time_ms": 456,
    "conversion_time_ms": 678,
    "upload_time_ms": 100
  }
}
```

**Error Callback:**
```json
POST {CALLBACK_URL}
{
  "task_id": "batch_abc_tiff_12345",
  "batch_id": "batch_abc",
  "status": "error",
  "error": "Failed to download TIFF: 404 Not Found"
}
```

**Worker Configuration:**
- `auto_destroy: true` - Machine destroys itself after exit
- `restart: no` - Don't restart on failure
- `memory: 1024 MB`
- `cpus: 2`
- `region: ord` (Chicago, close to Cloudflare)

---

## API Endpoints

### Health Check
```bash
GET https://arke-preprocessing.workers.dev/health
```

**Response:**
```json
{
  "status": "ok",
  "service": "arke-preprocessing-orchestrator",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Status Polling
```bash
GET https://arke-preprocessing.workers.dev/status/{batchId}
```

**Response:**
```json
{
  "batch_id": "batch_abc123",
  "status": "TIFF_CONVERSION",
  "progress": {
    "tasks_total": 50,
    "tasks_completed": 23,
    "tasks_failed": 1
  },
  "started_at": "2025-01-15T10:30:00.000Z",
  "updated_at": "2025-01-15T10:32:15.000Z",
  "completed_at": null,
  "error": null
}
```

**Status Values:**
- `TIFF_CONVERSION` - Converting TIFFs via Fly machines
- `DONE` - All processing complete
- `ERROR` - Permanent failure

### Admin Reset
```bash
POST https://arke-preprocessing.workers.dev/admin/reset/{batchId}
```

Force-stops a batch and marks it as ERROR. Use for debugging stuck batches.

---

## Testing Locally

```bash
# Start dev server
npm run dev

# In another terminal, send test queue message
curl -X POST http://localhost:8787/test \
  -H "Content-Type: application/json" \
  -d @test-batch.json
```

**Note:** Fly.io machines won't work in local dev (requires production API token). Use production deployment for end-to-end testing.

---

## Monitoring

### View Logs
```bash
wrangler tail
```

### Log Prefixes
- `[Queue]` - Queue consumer processing
- `[DO]` - Durable Object orchestrator
- `[TiffConversion]` - TIFF conversion phase
- `[Callback]` - Fly worker callbacks
- `[HTTP]` - HTTP request errors

### Key Metrics
- **Tasks spawned per alarm**: Should match `BATCH_SIZE_TIFF_CONVERSION`
- **Callback latency**: Time from spawn to callback
- **Success rate**: `tasks_completed / tasks_total`

---

## Troubleshooting

### Batch stuck in TIFF_CONVERSION
**Symptom:** Progress counters not advancing

**Debug:**
```bash
# Check status
curl https://arke-preprocessing.workers.dev/status/batch_abc

# View logs
wrangler tail

# Check Fly machine status
fly machines list --app arke-tiff-worker
```

**Solution:**
- Verify Fly.io API token is valid
- Check if Fly worker image exists
- Ensure callback URL is reachable
- Reset batch: `POST /admin/reset/batch_abc`

### Callbacks not received
**Symptom:** Tasks stay in "processing" state

**Debug:**
- Check Fly worker logs: `fly logs --app arke-tiff-worker`
- Verify `ORCHESTRATOR_URL` is correct in wrangler.jsonc
- Test callback endpoint manually

**Solution:**
- Update `ORCHESTRATOR_URL` to production URL
- Ensure Fly worker can reach the internet
- Check for CORS issues (should allow POST)

### High failure rate
**Symptom:** Many tasks failed

**Debug:**
```bash
# View failed task errors in DO state
curl https://arke-preprocessing.workers.dev/status/batch_abc

# Check Fly worker logs
fly logs --app arke-tiff-worker --instance <machine-id>
```

**Common causes:**
- Invalid R2 credentials
- Missing files in R2
- Out of memory in Fly worker
- Sharp conversion errors (unsupported TIFF format)

---

## Adding New Phases

To add a new preprocessing phase (e.g., PDF splitting):

1. **Create phase class** (`src/phases/pdf-splitting.ts`):
```typescript
export class PdfSplittingPhase implements Phase {
  name: BatchStatus = 'PDF_SPLITTING';

  async discover(queueMessage: QueueMessage): Promise<Task[]> {
    // Find all PDFs
  }

  async executeBatch(state, config, env): Promise<boolean> {
    // Spawn Fly machines for PDFs
  }

  handleCallback(task, result, state): void {
    // Handle multi-page results
  }

  getNextPhase(): BatchStatus | null {
    return 'DONE'; // Or next phase
  }
}
```

2. **Register in orchestrator** (`src/batch-do.ts`):
```typescript
private phases = new Map([
  ['TIFF_CONVERSION', new TiffConversionPhase()],
  ['PDF_SPLITTING', new PdfSplittingPhase()],
]);
```

3. **Update phase transition** in previous phase's `getNextPhase()`:
```typescript
getNextPhase(): BatchStatus | null {
  return 'PDF_SPLITTING'; // Instead of null/DONE
}
```

4. **Add to BatchStatus** type (`src/types/state.ts`):
```typescript
export type BatchStatus =
  | 'TIFF_CONVERSION'
  | 'PDF_SPLITTING'  // New!
  | 'DONE'
  | 'ERROR';
```

5. **Deploy updated worker**

---

## Architecture

```
Queue Message → Worker (src/index.ts)
                    ↓
         Durable Object (src/batch-do.ts)
                    ↓
      Phase: TIFF Conversion (src/phases/tiff-conversion.ts)
          ↓                      ↓                    ↓
    Fly Machine 1          Fly Machine 2        Fly Machine N
          ↓                      ↓                    ↓
      Callback               Callback             Callback
          ↓                      ↓                    ↓
         Durable Object (updates state)
                    ↓
      All tasks done? → Finalize → Worker Callback
```

**Key Features:**
- ✅ Self-contained phases (discovery + execution)
- ✅ Maximum parallelism (1000 machines per alarm)
- ✅ Resumable via Durable Objects
- ✅ HTTP callbacks from Fly workers
- ✅ Exponential backoff retry
- ✅ Progress tracking
- ✅ Extensible for future phases

---

## Production Checklist

- [ ] Fly.io API token configured
- [ ] R2 credentials configured
- [ ] Fly worker image deployed and tested
- [ ] `ORCHESTRATOR_URL` updated in wrangler.jsonc
- [ ] `WORKER_URL` points to production ingest worker
- [ ] Queue binding exists (`arke-preprocess-jobs`)
- [ ] Dead letter queue exists (`preprocess-dlq`)
- [ ] Logs monitoring set up
- [ ] Test with single-TIFF batch
- [ ] Test with 100+ TIFF batch
- [ ] Verify worker callback succeeds

---

## Support

For issues or questions:
1. Check logs: `wrangler tail`
2. Check Fly logs: `fly logs --app arke-tiff-worker`
3. Review Durable Object state: `GET /status/{batchId}`
4. Reset stuck batches: `POST /admin/reset/{batchId}`
