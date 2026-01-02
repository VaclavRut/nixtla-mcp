/**
 * @fileoverview Granular Consumption Tracking System
 * 
 * This module provides detailed tracking of API usage and consumption patterns.
 * It stores individual records for every API call with comprehensive metadata,
 * enabling detailed analytics, billing, and performance monitoring.
 * 
 * Key Features:
 * - Individual call record storage with full context
 * - Real-time aggregation for usage summaries
 * - Idempotency protection against duplicate tracking
 * - Performance metrics and execution time tracking
 * - Token consumption monitoring (input/output/finetune)
 * - Error tracking and operation details
 * 
 * Collections:
 * - consumption_records: Individual API call records
 * - idempotency: Request deduplication (TTL: 35 days)
 * 
 * @author Nixtla MCP Server
 * @version 2.0.0
 */

import { getDatabase } from '../utils/mongodb.js';
import { getCurrentMonthKey, parseMonthKey } from '../utils/time.js';

/**
 * Context information for tracking API consumption.
 * This interface defines all the metadata that can be tracked for an API call.
 */
export interface ConsumptionContext {
  /** Organization ID making the request */
  orgId: string;
  /** Unique request ID for idempotency */
  requestId: string;
  /** Name of the MCP tool being called */
  toolName: string;
  /** Specific operation within the tool (e.g., 'forecast', 'train') */
  operation?: string;
  /** Optional user ID if user-level tracking is needed */
  userId?: string;
  /** When the request was made (defaults to current time) */
  timestamp?: Date;
  /** How long the operation took in milliseconds */
  executionTimeMs?: number;
  /** Nixtla API input tokens consumed */
  inputTokens?: number;
  /** Nixtla API output tokens consumed */
  outputTokens?: number;
  /** Nixtla API finetune tokens consumed */
  finetuneTokens?: number;
  /** Estimated cost of the operation */
  estimatedCost?: number;
  /** Error code if the operation failed */
  errorCode?: string;
  /** Error message if the operation failed */
  errorMessage?: string;
}

export interface ConsumptionRecord {
  _id?: import('mongodb').ObjectId;
  orgId: string;
  userId?: string;
  requestId: string;
  toolName: string;
  operation?: string;
  timestamp: Date;
  success: boolean;
  executionTimeMs: number;
  inputTokens?: number;
  outputTokens?: number;
  finetuneTokens?: number;
  estimatedCost?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface UsageSummary {
  orgId: string;
  month: string;
  calls_total: number;
  calls_success: number;
  calls_failed: number;
  calls_by_tool: Record<string, number>;
  errors_by_tool: Record<string, number>;
  tokens_input_total: number;
  tokens_output_total: number;
  tokens_finetune_total: number;
  avg_execution_time_ms: number;
  estimated_cost_total: number;
}

export async function checkIdempotency(
  orgId: string,
  requestId: string
): Promise<boolean> {
  const db = await getDatabase();
  const idempotency = db.collection('idempotency');
  const doc = await idempotency.findOne({ orgId, requestId });
  return doc !== null;
}

export async function markRequestSeen(
  orgId: string,
  requestId: string
): Promise<void> {
  const db = await getDatabase();
  const idempotency = db.collection('idempotency');
  const expireAt = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
  await idempotency.insertOne({ orgId, requestId, expireAt });
  // Create TTL index if not exists
  await idempotency.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
}

/**
 * Tracks consumption for an API call with full idempotency protection.
 * 
 * This function:
 * 1. Checks if this request was already processed (idempotency)
 * 2. Marks the request as seen to prevent future duplicates
 * 3. Creates a detailed consumption record with all metadata
 * 4. Stores the record in the consumption_records collection
 * 5. Creates optimized indexes for querying
 * 
 * @param ctx - Complete context information for the API call
 * @param success - Whether the operation completed successfully
 * 
 * @example
 * ```typescript
 * await trackConsumption({
 *   orgId: 'acme-corp',
 *   requestId: 'req-123',
 *   toolName: 'forecast_finetuned',
 *   operation: 'forecast',
 *   executionTimeMs: 1500,
 *   inputTokens: 100,
 *   outputTokens: 50
 * }, true);
 * ```
 */
export async function trackConsumption(
  ctx: ConsumptionContext,
  success: boolean
): Promise<void> {
  const alreadySeen = await checkIdempotency(ctx.orgId, ctx.requestId);
  if (alreadySeen) {
    return;
  }

  await markRequestSeen(ctx.orgId, ctx.requestId);

  const db = await getDatabase();
  const timestamp = ctx.timestamp || new Date();

  // Store individual consumption record
  const record: ConsumptionRecord = {
    orgId: ctx.orgId,
    userId: ctx.userId,
    requestId: ctx.requestId,
    toolName: ctx.toolName,
    operation: ctx.operation,
    timestamp,
    success,
    executionTimeMs: ctx.executionTimeMs || 0,
    inputTokens: ctx.inputTokens,
    outputTokens: ctx.outputTokens,
    finetuneTokens: ctx.finetuneTokens,
    estimatedCost: ctx.estimatedCost,
    errorCode: success ? undefined : ctx.errorCode,
    errorMessage: success ? undefined : ctx.errorMessage,
  };

  const records = db.collection('consumption_records');
  await records.insertOne(record);

  // Create indexes for efficient querying
  await records.createIndex({ orgId: 1, timestamp: -1 });
  await records.createIndex({ orgId: 1, toolName: 1 });
}

export async function getUsageSummary(
  orgId: string,
  month?: string
): Promise<UsageSummary> {
  const db = await getDatabase();
  const monthKey = month ? parseMonthKey(month) : getCurrentMonthKey();
  
  // Calculate start and end dates for the month
  const [year, monthNum] = monthKey.split('-').map(Number);
  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0, 23, 59, 59, 999);
  
  const records = db.collection('consumption_records');
  
  // Aggregate data from consumption_records for the specified month
  const pipeline = [
    {
      $match: {
        orgId,
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        calls_total: { $sum: 1 },
        calls_success: { $sum: { $cond: ['$success', 1, 0] } },
        calls_failed: { $sum: { $cond: ['$success', 0, 1] } },
        tokens_input_total: { $sum: { $ifNull: ['$inputTokens', 0] } },
        tokens_output_total: { $sum: { $ifNull: ['$outputTokens', 0] } },
        tokens_finetune_total: { $sum: { $ifNull: ['$finetuneTokens', 0] } },
        total_execution_time_ms: { $sum: { $ifNull: ['$executionTimeMs', 0] } },
        estimated_cost_total: { $sum: { $ifNull: ['$estimatedCost', 0] } },
        tools: { $push: '$toolName' },
        errors: { $push: { $cond: ['$success', null, '$toolName'] } }
      }
    }
  ];
  
  const result = await records.aggregate(pipeline).toArray();
  
  if (result.length === 0) {
    return {
      orgId,
      month: monthKey,
      calls_total: 0,
      calls_success: 0,
      calls_failed: 0,
      calls_by_tool: {},
      errors_by_tool: {},
      tokens_input_total: 0,
      tokens_output_total: 0,
      tokens_finetune_total: 0,
      avg_execution_time_ms: 0,
      estimated_cost_total: 0,
    };
  }
  
  const data = result[0];
  
  // Count calls by tool
  const calls_by_tool: Record<string, number> = {};
  data.tools.forEach((tool: string) => {
    calls_by_tool[tool] = (calls_by_tool[tool] || 0) + 1;
  });
  
  // Count errors by tool
  const errors_by_tool: Record<string, number> = {};
  data.errors.forEach((tool: string) => {
    if (tool) {
      errors_by_tool[tool] = (errors_by_tool[tool] || 0) + 1;
    }
  });
  
  return {
    orgId,
    month: monthKey,
    calls_total: data.calls_total,
    calls_success: data.calls_success,
    calls_failed: data.calls_failed,
    calls_by_tool,
    errors_by_tool,
    tokens_input_total: data.tokens_input_total,
    tokens_output_total: data.tokens_output_total,
    tokens_finetune_total: data.tokens_finetune_total,
    avg_execution_time_ms: data.calls_total > 0 ? data.total_execution_time_ms / data.calls_total : 0,
    estimated_cost_total: data.estimated_cost_total,
  };
}

export async function getConsumptionRecords(
  orgId: string,
  filters?: {
    startDate?: Date;
    endDate?: Date;
    toolName?: string;
    operation?: string;
    userId?: string;
    success?: boolean;
    limit?: number;
    skip?: number;
  }
): Promise<ConsumptionRecord[]> {
  const db = await getDatabase();
  const records = db.collection('consumption_records');
  
  const query: Record<string, unknown> = { orgId };
  
  if (filters) {
    if (filters.startDate || filters.endDate) {
      query.timestamp = {};
      if (filters.startDate) (query.timestamp as Record<string, Date>).$gte = filters.startDate;
      if (filters.endDate) (query.timestamp as Record<string, Date>).$lte = filters.endDate;
    }
    if (filters.toolName) query.toolName = filters.toolName;
    if (filters.operation) query.operation = filters.operation;
    if (filters.userId) query.userId = filters.userId;
    if (filters.success !== undefined) query.success = filters.success;
  }
  
  let cursor = records.find(query).sort({ timestamp: -1 });
  
  if (filters?.skip) cursor = cursor.skip(filters.skip);
  if (filters?.limit) cursor = cursor.limit(filters.limit);
  
  return cursor.toArray() as Promise<ConsumptionRecord[]>;
}
