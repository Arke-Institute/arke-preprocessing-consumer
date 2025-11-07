/**
 * Queue message types (from ingest worker via PREPROCESS_QUEUE)
 */

/**
 * Message received from PREPROCESS_QUEUE
 */
export interface QueueMessage {
  batch_id: string;
  r2_prefix: string;
  uploader: string;
  root_path: string;
  parent_pi?: string;
  total_files: number;
  total_bytes: number;
  uploaded_at: string;
  finalized_at: string;
  metadata: Record<string, any>;
  directories: DirectoryGroup[];
}

/**
 * Directory group from queue message
 */
export interface DirectoryGroup {
  directory_path: string;
  processing_config: ProcessingConfig;
  file_count: number;
  total_bytes: number;
  files: QueueFileInfo[];
}

/**
 * File info from queue message
 */
export interface QueueFileInfo {
  r2_key: string;
  logical_path: string;
  file_name: string;
  file_size: number;
  content_type: string;
  cid?: string;
}

/**
 * Processing configuration
 */
export interface ProcessingConfig {
  ocr: boolean;
  describe: boolean;
  pinax: boolean;
}
