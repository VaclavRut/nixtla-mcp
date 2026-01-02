/**
 * @fileoverview Dataset Cleanup Utilities (Serverless-Compatible)
 *
 * This module provides utilities for cleaning up expired datasets from MongoDB.
 * It should be run periodically (e.g., daily via cron job) to remove
 * expired datasets from the database.
 *
 * Usage:
 * - Run as a scheduled cron job (recommended)
 * - Call via admin endpoint
 * - Run manually for maintenance
 *
 * @author Nixtla MCP Server
 * @version 2.0.0 (Serverless)
 */

import {
  markExpiredDatasets,
  getExpiredDatasets,
  markDatasetDeleted,
} from './dataset-storage.js';

export interface CleanupResult {
  /** Number of datasets marked as expired */
  markedExpired: number;
  /** Number of files successfully deleted */
  filesDeleted: number;
  /** Number of files that failed to delete */
  filesFailed: number;
  /** Errors encountered during cleanup */
  errors: Array<{ fileId: string; error: string }>;
  /** Total bytes freed */
  bytesFreed: number;
}

/**
 * Clean up expired datasets
 *
 * This function:
 * 1. Marks expired datasets in the database
 * 2. Retrieves all expired datasets
 * 3. Marks them as deleted (soft delete)
 * 4. Calculates freed storage space
 *
 * Note: In a future version, datasets marked as 'deleted' could be
 * permanently removed from MongoDB to free up database space.
 *
 * @returns Cleanup statistics
 */
export async function cleanupExpiredDatasets(): Promise<CleanupResult> {
  const result: CleanupResult = {
    markedExpired: 0,
    filesDeleted: 0,
    filesFailed: 0,
    errors: [],
    bytesFreed: 0,
  };

  // Step 1: Mark expired datasets
  result.markedExpired = await markExpiredDatasets();

  // Step 2: Get all expired datasets
  const expiredDatasets = await getExpiredDatasets();

  // Step 3: Mark each dataset as deleted
  for (const dataset of expiredDatasets) {
    try {
      // Mark as deleted in database (soft delete)
      await markDatasetDeleted(dataset.fileId);

      result.filesDeleted++;
      result.bytesFreed += dataset.sizeBytes;
    } catch (error) {
      result.filesFailed++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push({
        fileId: dataset.fileId,
        error: errorMessage,
      });
    }
  }

  return result;
}

/**
 * Get cleanup statistics without performing cleanup
 *
 * @returns Information about what would be cleaned up
 */
export async function getCleanupStats(): Promise<{
  expiredCount: number;
  totalExpiredBytes: number;
  oldestExpiration: Date | null;
}> {
  const expiredDatasets = await getExpiredDatasets();

  if (expiredDatasets.length === 0) {
    return {
      expiredCount: 0,
      totalExpiredBytes: 0,
      oldestExpiration: null,
    };
  }

  const totalExpiredBytes = expiredDatasets.reduce(
    (sum, dataset) => sum + dataset.sizeBytes,
    0
  );

  const oldestExpiration = expiredDatasets.reduce(
    (oldest, dataset) =>
      !oldest || dataset.expiresAt < oldest ? dataset.expiresAt : oldest,
    null as Date | null
  );

  return {
    expiredCount: expiredDatasets.length,
    totalExpiredBytes,
    oldestExpiration,
  };
}
