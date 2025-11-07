# Fly.io Worker Contract

## What You Need to Build

A **single-task Node.js worker** that runs on Fly.io to convert one TIFF to JPEG.

---

## Environment Variables (Provided by Orchestrator)

```bash
TASK_ID="batch_abc_tiff_12345"              # Unique task identifier
BATCH_ID="batch_abc"                         # Batch identifier
INPUT_R2_KEY="staging/batch_abc/folder/image.tiff"  # TIFF file to convert
R2_ACCOUNT_ID="your_account_id"              # R2 credentials
R2_ACCESS_KEY_ID="your_access_key"
R2_SECRET_ACCESS_KEY="your_secret_key"
R2_BUCKET="arke-staging"                     # R2 bucket name
CALLBACK_URL="https://arke-preprocessing.workers.dev/callback/batch_abc/batch_abc_tiff_12345"
```

---

## Processing Steps

### 1. Download TIFF from R2
```javascript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const response = await s3Client.send(new GetObjectCommand({
  Bucket: process.env.R2_BUCKET,
  Key: process.env.INPUT_R2_KEY,
}));

const tiffBuffer = await response.Body.transformToByteArray();
```

### 2. Convert to JPEG
```javascript
import sharp from 'sharp';

const jpegBuffer = await sharp(tiffBuffer)
  .jpeg({
    quality: 95,        // High quality
    mozjpeg: true,      // Better compression
  })
  .toBuffer();
```

### 3. Upload JPEG to R2
```javascript
import { PutObjectCommand } from '@aws-sdk/client-s3';

// Replace .tif/.tiff with .jpg
const jpegKey = process.env.INPUT_R2_KEY.replace(/\.tiff?$/i, '.jpg');

await s3Client.send(new PutObjectCommand({
  Bucket: process.env.R2_BUCKET,
  Key: jpegKey,
  Body: jpegBuffer,
  ContentType: 'image/jpeg',
}));
```

### 4. Send Success Callback
```javascript
await fetch(process.env.CALLBACK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    task_id: process.env.TASK_ID,
    batch_id: process.env.BATCH_ID,
    status: 'success',
    output_r2_key: jpegKey,
    output_file_name: jpegKey.split('/').pop(),
    output_file_size: jpegBuffer.length,
    performance: {
      total_time_ms: Date.now() - startTime,
      download_time_ms: downloadTime,
      conversion_time_ms: conversionTime,
      upload_time_ms: uploadTime,
    }
  }),
});

process.exit(0); // Exit with success
```

### 5. Error Handling
```javascript
try {
  // ... processing ...
} catch (error) {
  console.error('Error:', error);

  // Send error callback
  await fetch(process.env.CALLBACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: process.env.TASK_ID,
      batch_id: process.env.BATCH_ID,
      status: 'error',
      error: error.message,
    }),
  });

  process.exit(1); // Exit with failure
}
```

---

## Callback Payload Schema

### Success
```typescript
{
  task_id: string;              // Must match TASK_ID env var
  batch_id: string;             // Must match BATCH_ID env var
  status: 'success';
  output_r2_key: string;        // Where JPEG was uploaded
  output_file_name: string;     // Just the filename (e.g., "image.jpg")
  output_file_size: number;     // Bytes
  performance?: {               // Optional performance metrics
    total_time_ms: number;
    download_time_ms: number;
    conversion_time_ms: number;
    upload_time_ms: number;
  };
}
```

### Error
```typescript
{
  task_id: string;
  batch_id: string;
  status: 'error';
  error: string;                // Error message
}
```

---

## Docker Configuration

```dockerfile
FROM node:20-slim

# Install Sharp dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

USER node

CMD ["node", "index.js"]
```

---

## Fly.io Configuration (`fly.toml`)

```toml
app = "arke-tiff-worker"
primary_region = "ord"

[build]
  dockerfile = "Dockerfile"

# Note: Machines are spawned by orchestrator, not via fly.toml
# This is just for building/deploying the image
```

---

## Deployment

### 1. Create Fly App
```bash
fly apps create arke-tiff-worker
```

### 2. Build & Deploy Image
```bash
fly deploy --app arke-tiff-worker
```

### 3. Get Image Tag
```bash
fly releases --app arke-tiff-worker
```

Example output:
```
VERSION  STABLE  TYPE    STATUS   DESCRIPTION
v1       true    deploy  complete Deploy image registry.fly.io/arke-tiff-worker:deployment-01XXXXXX
```

### 4. Update Orchestrator Config
In `wrangler.jsonc`:
```jsonc
{
  "vars": {
    "FLY_APP_NAME": "arke-tiff-worker",
    "FLY_WORKER_IMAGE": "registry.fly.io/arke-tiff-worker:deployment-01XXXXXX"
  }
}
```

---

## Machine Configuration (Set by Orchestrator)

The orchestrator will spawn machines with these settings:

```javascript
{
  name: "tiff-{task_id}",
  config: {
    image: "registry.fly.io/arke-tiff-worker:latest",
    env: { /* env vars listed above */ },
    auto_destroy: true,        // Machine destroys itself after exit
    restart: { policy: 'no' }, // Don't restart on failure
    guest: {
      memory_mb: 1024,         // 1GB RAM
      cpus: 2,                 // 2 shared CPUs
      cpu_kind: 'shared',
    }
  },
  region: "ord"                // Chicago (close to Cloudflare)
}
```

---

## Testing Locally

```bash
# Set env vars
export TASK_ID="test_task_1"
export BATCH_ID="test_batch"
export INPUT_R2_KEY="staging/test/image.tiff"
export R2_ACCOUNT_ID="your_account_id"
export R2_ACCESS_KEY_ID="your_access_key"
export R2_SECRET_ACCESS_KEY="your_secret_key"
export R2_BUCKET="arke-staging"
export CALLBACK_URL="http://localhost:8787/callback/test_batch/test_task_1"

# Run worker
node index.js
```

---

## Performance Expectations

- **Download**: ~200-500ms for typical TIFF (5-10MB)
- **Conversion**: ~500-2000ms depending on TIFF size/complexity
- **Upload**: ~100-300ms for JPEG (typically 50-80% smaller)
- **Total**: ~1-3 seconds per TIFF

For 1000 TIFFs in parallel:
- **Wall time**: ~3-5 seconds (limited by slowest machine)
- **Speedup**: ~1000x vs sequential

---

## Error Scenarios to Handle

1. **TIFF not found in R2**: Send error callback with "404 Not Found"
2. **Invalid TIFF format**: Send error callback with Sharp error message
3. **Out of memory**: Increase `memory_mb` in orchestrator config
4. **Callback URL unreachable**: Log error, exit with code 1
5. **Network timeout**: Add retry logic or increase timeout

---

## Dependencies

### package.json
```json
{
  "name": "arke-tiff-worker",
  "type": "module",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.709.0",
    "sharp": "^0.33.5"
  }
}
```

---

## Complete Example (index.js)

```javascript
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const startTime = Date.now();

// Config
const TASK_ID = process.env.TASK_ID;
const BATCH_ID = process.env.BATCH_ID;
const INPUT_R2_KEY = process.env.INPUT_R2_KEY;
const CALLBACK_URL = process.env.CALLBACK_URL;

if (!TASK_ID || !BATCH_ID || !INPUT_R2_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

// R2 Client
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function processTiff() {
  try {
    console.log(`[${TASK_ID}] Starting TIFF conversion: ${INPUT_R2_KEY}`);

    // 1. Download TIFF
    const downloadStart = Date.now();
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: INPUT_R2_KEY,
    }));
    const tiffBuffer = await response.Body.transformToByteArray();
    const downloadTime = Date.now() - downloadStart;

    console.log(`[${TASK_ID}] Downloaded ${(tiffBuffer.length / 1024 / 1024).toFixed(2)} MB in ${downloadTime}ms`);

    // 2. Convert to JPEG
    const conversionStart = Date.now();
    const jpegBuffer = await sharp(tiffBuffer)
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();
    const conversionTime = Date.now() - conversionStart;

    console.log(`[${TASK_ID}] Converted to ${(jpegBuffer.length / 1024 / 1024).toFixed(2)} MB in ${conversionTime}ms`);

    // 3. Upload JPEG
    const uploadStart = Date.now();
    const jpegKey = INPUT_R2_KEY.replace(/\.tiff?$/i, '.jpg');
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: jpegKey,
      Body: jpegBuffer,
      ContentType: 'image/jpeg',
    }));
    const uploadTime = Date.now() - uploadStart;

    console.log(`[${TASK_ID}] Uploaded to ${jpegKey} in ${uploadTime}ms`);

    // 4. Send success callback
    const totalTime = Date.now() - startTime;
    await fetch(CALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: TASK_ID,
        batch_id: BATCH_ID,
        status: 'success',
        output_r2_key: jpegKey,
        output_file_name: jpegKey.split('/').pop(),
        output_file_size: jpegBuffer.length,
        performance: {
          total_time_ms: totalTime,
          download_time_ms: downloadTime,
          conversion_time_ms: conversionTime,
          upload_time_ms: uploadTime,
        }
      }),
    });

    console.log(`[${TASK_ID}] ✓ Success in ${totalTime}ms`);
    process.exit(0);

  } catch (error) {
    console.error(`[${TASK_ID}] ✗ Error:`, error);

    // Send error callback
    await fetch(CALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: TASK_ID,
        batch_id: BATCH_ID,
        status: 'error',
        error: error.message,
      }),
    });

    process.exit(1);
  }
}

processTiff();
```

---

## Checklist

- [ ] Dockerfile builds successfully
- [ ] Sharp can convert sample TIFF locally
- [ ] R2 download/upload works
- [ ] Callback sends to localhost orchestrator
- [ ] Deployed to Fly.io
- [ ] Image tag updated in orchestrator config
- [ ] Test with single TIFF via orchestrator
- [ ] Monitor Fly logs: `fly logs --app arke-tiff-worker`

---

That's it! The worker is simple, stateless, and ephemeral. It does one job and exits. 🚀
