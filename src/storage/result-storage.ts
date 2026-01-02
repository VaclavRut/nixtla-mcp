/**
 * @fileoverview Forecast and Anomaly Result Storage (Vercel Blob)
 *
 * This module manages the storage of forecast and anomaly detection results
 * to Vercel Blob storage, providing public URLs for download and access.
 *
 * Storage Strategy:
 * - Stores forecast/anomaly results as JSON files in Vercel Blob
 * - Generates public URLs for download
 * - Organization-based file naming for security
 * - 30-day TTL on blob objects
 *
 * Key Features:
 * - Automatic public URL generation
 * - Support for forecast, finetuned forecast, and anomaly results
 * - Metadata tracking in MongoDB for organization association
 * - Download-friendly file naming
 *
 * @author Nixtla MCP Server
 * @version 1.0.0
 */

import { put } from '@vercel/blob';
import { getDatabase } from '../utils/mongodb.js';

/**
 * Result types that can be stored
 */
export type ResultType = 'forecast_baseline' | 'forecast_finetuned' | 'detect_anomaly';

/**
 * Metadata for stored results
 */
export interface StoredResultMetadata {
  /** MongoDB document ID */
  _id?: import('mongodb').ObjectId;
  /** Unique result identifier */
  resultId: string;
  /** Organization that owns this result */
  orgId: string;
  /** Type of result */
  resultType: ResultType;
  /** Public blob URL for download */
  downloadUrl: string;
  /** When the result was created */
  createdAt: Date;
  /** When the result expires (30 days from creation) */
  expiresAt: Date;
  /** Result size in bytes */
  sizeBytes: number;
  /** Additional metadata */
  metadata: {
    horizon?: number;
    modelId?: string;
    anomalyCount?: number;
    seriesCount?: number;
    forecastHorizon?: number;
    frequency?: string;
    generatedAt?: string;
    forecastStartDate?: string;
    forecastEndDate?: string;
  };
}

/**
 * TTL configuration (30 days)
 */
const RESULT_TTL_DAYS = 30;
const RESULT_TTL_SECONDS = RESULT_TTL_DAYS * 24 * 60 * 60;

/**
 * Generate unique result ID
 */
function generateResultId(type: ResultType): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${type}-${timestamp}-${random}`;
}

/**
 * Get Vercel Blob token from environment
 */
function getBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN environment variable is required');
  }
  return token;
}

/**
 * Store forecast or anomaly result to Vercel Blob
 *
 * @param orgId - Organization ID
 * @param resultType - Type of result (forecast_baseline, forecast_finetuned, detect_anomaly)
 * @param data - Result data to store
 * @param metadata - Additional metadata
 * @returns Stored result metadata including download URL
 */
export async function storeResult(
  orgId: string,
  resultType: ResultType,
  data: unknown,
  metadata: {
    horizon?: number;
    modelId?: string;
    anomalyCount?: number;
    seriesCount?: number;
    forecastHorizon?: number;
    frequency?: string;
    generatedAt?: string;
    forecastStartDate?: string;
    forecastEndDate?: string;
  } = {}
): Promise<StoredResultMetadata> {
  const resultId = generateResultId(resultType);
  const fileName = `${orgId}/${resultId}.json`;

  // Convert data to JSON string
  const jsonData = JSON.stringify(data, null, 2);
  const sizeBytes = Buffer.byteLength(jsonData, 'utf-8');

  // Upload to Vercel Blob
  const blob = await put(fileName, jsonData, {
    access: 'public',
    token: getBlobToken(),
    addRandomSuffix: false,
    cacheControlMaxAge: RESULT_TTL_SECONDS,
  });

  // Store metadata in MongoDB for tracking
  const db = await getDatabase();
  const resultsCollection = db.collection('result_metadata');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESULT_TTL_SECONDS * 1000);

  const resultMetadata: StoredResultMetadata = {
    resultId,
    orgId,
    resultType,
    downloadUrl: blob.url,
    createdAt: now,
    expiresAt,
    sizeBytes,
    metadata,
  };

  await resultsCollection.insertOne(resultMetadata);

  // Create indexes for efficient querying
  await resultsCollection.createIndex({ resultId: 1 }, { unique: true });
  await resultsCollection.createIndex({ orgId: 1 });
  await resultsCollection.createIndex({ expiresAt: 1 });

  return resultMetadata;
}

/**
 * Get result metadata by result ID
 *
 * @param resultId - Unique result identifier
 * @returns Result metadata or null if not found
 */
export async function getResultMetadata(resultId: string): Promise<StoredResultMetadata | null> {
  const db = await getDatabase();
  const resultsCollection = db.collection('result_metadata');
  const result = await resultsCollection.findOne({ resultId });
  return result ? (result as StoredResultMetadata) : null;
}

/**
 * List all results for an organization
 *
 * @param orgId - Organization ID
 * @param resultType - Optional filter by result type
 * @param includeExpired - Whether to include expired results
 * @returns Array of result metadata
 */
export async function listOrgResults(
  orgId: string,
  resultType?: ResultType,
  includeExpired: boolean = false
): Promise<StoredResultMetadata[]> {
  const db = await getDatabase();
  const resultsCollection = db.collection('result_metadata');

  const query: Record<string, unknown> = { orgId };

  if (resultType) {
    query.resultType = resultType;
  }

  if (!includeExpired) {
    query.expiresAt = { $gt: new Date() };
  }

  const results = await resultsCollection
    .find(query)
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  return results as StoredResultMetadata[];
}

/**
 * Store a CSV file to Vercel Blob
 *
 * @param orgId - Organization ID
 * @param csvContent - CSV file content as string
 * @param resultType - Type of result (forecast_baseline, forecast_finetuned, etc.)
 * @param metadata - Additional metadata
 * @returns Download URL for the CSV file
 */
export async function storeCSV(
  orgId: string,
  csvContent: string,
  resultType: ResultType,
  _metadata: {
    horizon?: number;
    modelId?: string;
    seriesCount?: number;
  } = {}
): Promise<string> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const fileName = `${orgId}/${resultType}-${timestamp}-${random}.csv`;

  // Upload CSV to Vercel Blob
  const blob = await put(fileName, csvContent, {
    access: 'public',
    token: getBlobToken(),
    addRandomSuffix: false,
    cacheControlMaxAge: RESULT_TTL_SECONDS,
    contentType: 'text/csv',
  });

  return blob.url;
}
