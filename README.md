# Arke Preprocessing Consumer

Lightweight Cloudflare Worker that bridges the preprocessing queue to Cloud Run.

## Architecture

```
PREPROCESS_QUEUE → arke-preprocessing-consumer → Cloud Run Service
                    (this worker)                 (arke-preprocessor)
```

## Purpose

This worker is a **pass-through proxy** with one job:
- Receive messages from `preprocess-queue`
- Forward them to Cloud Run's `/preprocess` endpoint
- Handle retries and errors

It **doesn't care** about message structure - types are maintained in:
1. Ingest worker (sender)
2. Cloud Run service (receiver)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Cloud Run URL

Edit `wrangler.jsonc` and set your Cloud Run service URL:

```jsonc
"vars": {
  "CLOUD_RUN_URL": "https://arke-preprocessor-<your-project>.run.app"
}
```

### 3. Deploy

```bash
# Deploy to Cloudflare
npm run deploy
```

## Configuration

### wrangler.jsonc

- **queue**: `preprocess-queue` - Consumes from this queue
- **max_batch_size**: `1` - Process one message at a time
- **max_retries**: `3` - Retry failed messages 3 times
- **dead_letter_queue**: `preprocess-dlq` - Failed messages go here
- **CLOUD_RUN_URL**: Cloud Run service endpoint

## Error Handling

- **Cloud Run down?** → Message retries automatically (up to 3 times)
- **Timeout?** → Message retries automatically
- **All retries failed?** → Message moves to `preprocess-dlq`

## Monitoring

### View Live Logs

```bash
npm run tail
```

### View Queue Metrics

Check Cloudflare dashboard for:
- Messages processed
- Messages in dead letter queue
- Processing duration
- Error rate

## Testing

### Send Test Message

```bash
wrangler queues send preprocess-queue --body '{
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

## Maintenance

### When to Update This Worker

**Only update for:**
- Cloud Run URL changes
- Queue configuration changes
- Timeout adjustments
- Retry logic changes

**Never update for:**
- Message format changes (handled by ingest worker & Cloud Run)
- New fields in messages
- Processing logic changes

## Development

```bash
# Local development
npm run dev

# Deploy to production
npm run deploy

# View logs
npm run tail
```

## Dependencies

- `@cloudflare/workers-types` - TypeScript types for Cloudflare Workers
- `wrangler` - Cloudflare Workers CLI
- `typescript` - TypeScript compiler

## License

Part of the Arke Institute ingest pipeline.
