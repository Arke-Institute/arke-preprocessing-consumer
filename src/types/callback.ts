/**
 * Callback payloads from Fly.io workers
 */

/**
 * TIFF conversion callback from Fly worker
 */
export interface TiffCallbackResult {
  task_id: string;
  batch_id: string;
  status: 'success' | 'error';

  // On success
  output_r2_key?: string;
  output_file_name?: string;
  output_file_size?: number;

  // Performance metrics (optional)
  performance?: {
    total_time_ms: number;
    download_time_ms: number;
    conversion_time_ms: number;
    upload_time_ms: number;
  };

  // On error
  error?: string;
}
