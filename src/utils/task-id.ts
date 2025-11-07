/**
 * Task ID generation utilities
 */

/**
 * Generate unique task ID
 * Format: {batch_id}_tiff_{index}
 */
export function generateTaskId(batchId: string, r2Key: string): string {
  // Use hash of r2_key to ensure uniqueness and idempotency
  const hash = simpleHash(r2Key);
  return `${batchId}_tiff_${hash}`;
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
