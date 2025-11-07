/**
 * Arke Preprocessing Orchestrator
 * Queue consumer + HTTP endpoints
 */

import type { Env } from './config.js';
import type { QueueMessage } from './types/queue.js';
import type { PreprocessingDurableObject } from './batch-do.js';

/**
 * Durable Object stub interface
 */
interface PreprocessingDOStub {
  startBatch(queueMessage: QueueMessage): Promise<void>;
  handleCallback(taskId: string, result: any): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

export { PreprocessingDurableObject } from './batch-do.js';

export default {
  /**
   * Queue consumer
   * Receives messages from arke-preprocess-jobs queue
   */
  async queue(
    batch: MessageBatch,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`[Queue] Received ${batch.messages.length} message(s)`);

    for (const message of batch.messages) {
      const queueMessage = message.body as QueueMessage;
      const batchId = queueMessage.batch_id || 'unknown';

      try {
        console.log(`[Queue] Processing batch ${batchId}`);

        // Get Durable Object for this batch
        const doId = env.PREPROCESSING_DO.idFromName(batchId);
        const stub = env.PREPROCESSING_DO.get(doId) as unknown as PreprocessingDOStub;

        // Start batch processing
        await stub.startBatch(queueMessage);

        console.log(`[Queue] ✓ Batch ${batchId} started`);

        // Acknowledge message
        message.ack();
      } catch (error: any) {
        console.error(`[Queue] ✗ Failed to start batch ${batchId}:`, error.message);
        console.error(error.stack);

        // Retry message
        message.retry();
      }
    }
  },

  /**
   * HTTP fetch handler
   * Handles status polling, callbacks, and admin endpoints
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle OPTIONS for CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check
      if (url.pathname === '/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'arke-preprocessing-orchestrator',
            timestamp: new Date().toISOString(),
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Status endpoint: GET /status/:batchId
      if (url.pathname.startsWith('/status/')) {
        const batchId = url.pathname.split('/')[2];

        if (!batchId) {
          return new Response(
            JSON.stringify({ error: 'Missing batch ID' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        const doId = env.PREPROCESSING_DO.idFromName(batchId);
        const stub = env.PREPROCESSING_DO.get(doId) as unknown as PreprocessingDOStub;

        const response = await stub.fetch(
          new Request(`https://internal/status`, { method: 'GET' })
        );

        // Add CORS headers to DO response
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Callback endpoint: POST /callback/:batchId/:taskId
      if (url.pathname.startsWith('/callback/') && request.method === 'POST') {
        const parts = url.pathname.split('/');
        const batchId = parts[2];
        const taskId = parts[3];

        if (!batchId || !taskId) {
          return new Response(
            JSON.stringify({ error: 'Missing batch ID or task ID' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        const callbackResult = await request.json();

        console.log(`[Callback] Received callback for batch ${batchId}, task ${taskId}`);

        const doId = env.PREPROCESSING_DO.idFromName(batchId);
        const stub = env.PREPROCESSING_DO.get(doId) as unknown as PreprocessingDOStub;

        await stub.handleCallback(taskId, callbackResult);

        return new Response(
          JSON.stringify({ ok: true }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Admin reset endpoint: POST /admin/reset/:batchId
      if (url.pathname.startsWith('/admin/reset/') && request.method === 'POST') {
        const batchId = url.pathname.split('/')[3];

        if (!batchId) {
          return new Response(
            JSON.stringify({ error: 'Missing batch ID' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        console.log(`[Admin] Resetting batch ${batchId}`);

        const doId = env.PREPROCESSING_DO.idFromName(batchId);
        const stub = env.PREPROCESSING_DO.get(doId) as unknown as PreprocessingDOStub;

        await stub.fetch(
          new Request(`https://internal/reset`, { method: 'POST' })
        );

        return new Response(
          JSON.stringify({ ok: true, message: 'Batch reset' }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Not found
      return new Response('Not Found', {
        status: 404,
        headers: corsHeaders,
      });
    } catch (error: any) {
      console.error('[HTTP] Error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  },
};
