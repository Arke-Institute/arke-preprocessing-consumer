/**
 * File types for preprocessing pipeline
 */

import type { ProcessingConfig } from './queue.js';

/**
 * File in the processing pipeline
 * This is what we send back to the worker in enqueue-processed
 */
export interface ProcessableFile {
  // Required fields
  r2_key: string;
  logical_path: string;
  file_name: string;
  file_size: number;
  content_type: string;
  processing_config: ProcessingConfig;

  // Optional fields
  cid?: string;

  // Preprocessing metadata
  source_file?: string;          // Original filename if converted
  preprocessor_tags?: string[];  // Preprocessors that touched this file
}
