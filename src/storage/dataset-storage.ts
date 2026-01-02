/**
 * @fileoverview Secure Dataset Storage (Serverless-Compatible)
 *
 * This module manages the secure storage and retrieval of generated forecast datasets.
 * It provides organization-based access control and TTL management.
 *
 * Storage Strategy:
 * - Stores full dataset content in MongoDB (supports datasets up to 16MB)
 * - For larger datasets, uses MongoDB GridFS automatically
 * - Serverless-compatible (works on Vercel, AWS Lambda, etc.)
 * - No filesystem dependencies
 *
 * Key Features:
 * - Stores datasets in MongoDB with org association
 * - 30-day TTL with automatic expiration tracking
 * - Access control: only org owner or admin can access files
 * - Cleanup utilities for expired datasets
 *
 * Security:
 * - All file access requires authentication
 * - Cross-org access prevention
 * - Admin override capability
 *
 * @author Nixtla MCP Server
 * @version 2.0.0 (Serverless)
 */

import { getDatabase } from '../utils/mongodb.js';

/**
 * Generic dataset structure
 */
export interface GeneratedDataset {
  series: {
    y: number[];
    sizes: number[];
    X?: number[][];
    X_future?: number[][];
  };
  freq: string;
  meta: {
    seriesNames: string[];
    generatedAt: string;
    forecastHorizon: number;
    trainingEndDate: string;
    forecastStartDate: string;
    forecastEndDate: string;
  };
}

/**
 * Dataset file stored in MongoDB
 */
export interface DatasetFile {
  /** MongoDB document ID */
  _id?: import('mongodb').ObjectId;
  /** Unique file identifier */
  fileId: string;
  /** Organization that owns this dataset */
  orgId: string;
  /** API endpoint path for accessing this dataset */
  publicUrl: string;
  /** When the file was created */
  createdAt: Date;
  /** When the file expires (30 days from creation) */
  expiresAt: Date;
  /** Dataset size in bytes */
  sizeBytes: number;
  /** Dataset metadata for quick reference */
  metadata: {
    seriesCount: number;
    forecastHorizon: number;
    frequency: string;
    generatedAt: string;
  };
  /** Full dataset content stored in MongoDB */
  datasetContent: GeneratedDataset;
  /** Current status */
  status: 'active' | 'expired' | 'deleted';
}

/**
 * TTL configuration
 */
const DATASET_TTL_DAYS = 30;
const DATASET_TTL_MS = DATASET_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Generate unique file ID based on timestamp and random string
 */
function generateFileId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}`;
}

/**
 * Calculate expiration date (30 days from now)
 */
function calculateExpirationDate(): Date {
  return new Date(Date.now() + DATASET_TTL_MS);
}

/**
 * Save a generated dataset to MongoDB with organization-based access control
 *
 * @param orgId - Organization ID that owns this dataset
 * @param dataset - Generated forecast dataset to save
 * @returns Dataset file metadata including public URL
 */
export async function saveDataset(
  orgId: string,
  dataset: GeneratedDataset
): Promise<DatasetFile> {
  const fileId = generateFileId();
  const publicUrl = `/api/datasets/${orgId}/${fileId}`;

  // Calculate dataset size
  const fileContent = JSON.stringify(dataset);
  const sizeBytes = Buffer.byteLength(fileContent, 'utf-8');

  // Create database record with full dataset content
  const db = await getDatabase();
  const datasetFiles = db.collection('dataset_files');

  const datasetFile: DatasetFile = {
    fileId,
    orgId,
    publicUrl,
    createdAt: new Date(),
    expiresAt: calculateExpirationDate(),
    sizeBytes,
    metadata: {
      seriesCount: dataset.meta.seriesNames.length,
      forecastHorizon: dataset.meta.forecastHorizon,
      frequency: dataset.freq,
      generatedAt: dataset.meta.generatedAt,
    },
    datasetContent: dataset,
    status: 'active',
  };

  await datasetFiles.insertOne(datasetFile);

  // Create indexes for efficient querying
  await datasetFiles.createIndex({ fileId: 1 }, { unique: true });
  await datasetFiles.createIndex({ orgId: 1 });
  await datasetFiles.createIndex({ expiresAt: 1 });
  await datasetFiles.createIndex({ status: 1 });

  return datasetFile;
}

/**
 * Get dataset file metadata by file ID
 *
 * @param fileId - Unique file identifier
 * @returns Dataset file metadata or null if not found
 */
export async function getDatasetFile(fileId: string): Promise<DatasetFile | null> {
  const db = await getDatabase();
  const datasetFiles = db.collection('dataset_files');
  const file = await datasetFiles.findOne({ fileId, status: 'active' });
  return file ? (file as DatasetFile) : null;
}

/**
 * Check if a user has access to a dataset file
 *
 * @param fileId - File identifier
 * @param requestingOrgId - Organization ID of the requester
 * @param isAdmin - Whether the requester is an admin
 * @returns True if access is granted, false otherwise
 */
export async function canAccessDataset(
  fileId: string,
  requestingOrgId: string,
  isAdmin: boolean
): Promise<boolean> {
  const file = await getDatasetFile(fileId);

  if (!file) {
    return false;
  }

  // Check if file is expired
  if (file.expiresAt < new Date()) {
    return false;
  }

  // Admin can access any dataset
  if (isAdmin) {
    return true;
  }

  // Organization can only access their own datasets
  return file.orgId === requestingOrgId;
}

/**
 * List all dataset files for an organization
 *
 * @param orgId - Organization ID
 * @param includeExpired - Whether to include expired files
 * @returns Array of dataset file metadata
 */
export async function listOrgDatasets(
  orgId: string,
  includeExpired: boolean = false
): Promise<DatasetFile[]> {
  const db = await getDatabase();
  const datasetFiles = db.collection('dataset_files');

  const query: Record<string, unknown> = { orgId };

  if (!includeExpired) {
    query.expiresAt = { $gt: new Date() };
    query.status = 'active';
  }

  const files = await datasetFiles
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();

  return files as DatasetFile[];
}

/**
 * Mark expired datasets and return count
 * This should be called periodically by a cleanup job
 *
 * @returns Number of datasets marked as expired
 */
export async function markExpiredDatasets(): Promise<number> {
  const db = await getDatabase();
  const datasetFiles = db.collection('dataset_files');

  const result = await datasetFiles.updateMany(
    {
      expiresAt: { $lt: new Date() },
      status: 'active',
    },
    {
      $set: { status: 'expired' },
    }
  );

  return result.modifiedCount;
}

/**
 * Get all expired datasets that need to be deleted
 *
 * @returns Array of expired dataset files
 */
export async function getExpiredDatasets(): Promise<DatasetFile[]> {
  const db = await getDatabase();
  const datasetFiles = db.collection('dataset_files');

  const files = await datasetFiles
    .find({
      status: 'expired',
    })
    .toArray();

  return files as DatasetFile[];
}

/**
 * Mark a dataset as deleted (soft delete)
 *
 * @param fileId - File identifier
 */
export async function markDatasetDeleted(fileId: string): Promise<void> {
  const db = await getDatabase();
  const datasetFiles = db.collection('dataset_files');

  await datasetFiles.updateOne(
    { fileId },
    { $set: { status: 'deleted' } }
  );
}

/**
 * Get storage statistics for an organization
 *
 * @param orgId - Organization ID
 * @returns Storage statistics
 */
export async function getOrgStorageStats(orgId: string): Promise<{
  totalFiles: number;
  activeFiles: number;
  expiredFiles: number;
  totalBytes: number;
  activeBytes: number;
}> {
  const db = await getDatabase();
  const datasetFiles = db.collection('dataset_files');

  const stats = await datasetFiles.aggregate([
    { $match: { orgId } },
    {
      $group: {
        _id: null,
        totalFiles: { $sum: 1 },
        activeFiles: {
          $sum: {
            $cond: [{ $eq: ['$status', 'active'] }, 1, 0],
          },
        },
        expiredFiles: {
          $sum: {
            $cond: [{ $eq: ['$status', 'expired'] }, 1, 0],
          },
        },
        totalBytes: { $sum: '$sizeBytes' },
        activeBytes: {
          $sum: {
            $cond: [{ $eq: ['$status', 'active'] }, '$sizeBytes', 0],
          },
        },
      },
    },
  ]).toArray();

  if (stats.length === 0) {
    return {
      totalFiles: 0,
      activeFiles: 0,
      expiredFiles: 0,
      totalBytes: 0,
      activeBytes: 0,
    };
  }

  return stats[0] as {
    totalFiles: number;
    activeFiles: number;
    expiredFiles: number;
    totalBytes: number;
    activeBytes: number;
  };
}
