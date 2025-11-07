# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Cloudflare Worker that acts as a lightweight bridge between a Cloudflare Queue and a Google Cloud Run service. It's part of the Arke Institute ingest pipeline.

**Architecture:**
```
PREPROCESS_QUEUE → arke-preprocessing-consumer → Cloud Run Service
                    (this worker)                 (arke-preprocessor)
```

The worker is intentionally minimal - it's a pass-through proxy that forwards messages without understanding their structure. Message types are maintained in:
1. The ingest worker (sender)
2. The Cloud Run service (receiver)

## Development Commands

### Local Development
```bash
npm install          # Install dependencies
npm run dev          # Start local development server with Wrangler
npm run deploy       # Deploy to Cloudflare
npm run tail         # View live logs from deployed worker
```

### Testing
```bash
# Send a test message to the queue (requires wrangler CLI)
wrangler queues send arke-preprocess-jobs --body '{
  "batch_id": "test-123",
  "r2_prefix": "staging/test-123/",
  "uploader": "test-user",
  "root_path": "/test",
  "total_files": 1,
  "total_bytes": 1000,
  "uploaded_at": "2025-01-06T00:00:00Z",
  "finalized_at": "2025-01-06T00:00:00Z",
  "directories": []
}'
```

## Architecture & Code Structure

### Queue Consumer Pattern
The worker implements Cloudflare's Queue Consumer API:
- **Entry point:** `src/index.ts` exports a `queue()` handler function
- **Queue name:** `arke-preprocess-jobs` (configured in `wrangler.jsonc`)
- **Processing mode:** One message at a time (`max_batch_size: 1`)
- **Retry logic:** Up to 3 retries, then moves to dead letter queue `preprocess-dlq`

### Message Handling Flow
1. Worker receives message from `arke-preprocess-jobs` queue
2. Extracts entire message body (structure is opaque to this worker)
3. Makes HTTP POST to Cloud Run URL at `/preprocess` endpoint
4. On success: Calls `message.ack()` to acknowledge processing
5. On failure: Calls `message.retry()` to trigger retry (up to 3 times)
6. After max retries: Message automatically moves to dead letter queue

### Error Handling Strategy
- **60-second timeout** on Cloud Run requests (`AbortSignal.timeout(60000)`)
- Automatic retry on any failure (network, timeout, HTTP error)
- Detailed logging with batch IDs for debugging
- Dead letter queue captures permanently failed messages

## Configuration

### wrangler.jsonc
Key configuration:
- `queue`: Queue name to consume from (`arke-preprocess-jobs`)
- `max_batch_size`: 1 (process messages individually)
- `max_retries`: 3 attempts before DLQ
- `dead_letter_queue`: `preprocess-dlq`
- `CLOUD_RUN_URL`: Target Cloud Run service URL (environment variable)

### Environment Variables
- `CLOUD_RUN_URL`: The Google Cloud Run service endpoint (currently: `https://arke-preprocessor-237450041725.us-west1.run.app`)

## When to Update This Worker

**DO update for:**
- Cloud Run URL changes (update `wrangler.jsonc`)
- Queue configuration changes (batch size, retries, DLQ)
- Timeout adjustments
- Retry logic changes

**DON'T update for:**
- Message format changes (this worker doesn't parse messages)
- New fields in messages
- Processing logic changes (handled by Cloud Run service)

## Dependencies

- `@cloudflare/workers-types`: TypeScript definitions for Cloudflare Workers API
- `wrangler`: Cloudflare Workers CLI tool for development and deployment
- `typescript`: TypeScript compiler
