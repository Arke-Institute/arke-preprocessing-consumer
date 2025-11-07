/**
 * Base phase interface
 * All preprocessing phases implement this interface
 */

import type { QueueMessage } from '../types/queue.js';
import type { BatchState, BatchStatus, Task } from '../types/state.js';
import type { Config } from '../types/config.js';
import type { Env } from '../config.js';

/**
 * Phase interface
 * Each phase is self-contained with discovery, execution, and callback handling
 */
export interface Phase {
  /**
   * Phase name (matches BatchStatus)
   */
  name: BatchStatus;

  /**
   * Discover tasks for this phase
   * Analyzes queue message and creates tasks
   */
  discover(queueMessage: QueueMessage): Promise<Task[]>;

  /**
   * Execute a batch of tasks
   * Spawns Fly machines for pending tasks
   * @returns true if more work remains, false if phase is complete
   */
  executeBatch(
    state: BatchState,
    config: Config,
    env: Env
  ): Promise<boolean>;

  /**
   * Handle callback from Fly worker
   */
  handleCallback(
    task: Task,
    callbackResult: any,
    state: BatchState
  ): void;

  /**
   * Get next phase status after this phase completes
   * @returns Next phase status, or null if no more phases (goes to DONE)
   */
  getNextPhase(): BatchStatus | null;
}
