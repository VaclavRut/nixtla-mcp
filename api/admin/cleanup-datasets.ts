/**
 * @fileoverview Admin Endpoint for Dataset Cleanup
 *
 * This endpoint allows admins to manually trigger cleanup of expired datasets.
 * It can also be called by a cron job for scheduled cleanup.
 *
 * Route: POST /api/admin/cleanup-datasets
 *
 * Security:
 * - Requires admin token in Authorization header
 * - Only accessible to administrators
 *
 * Query Parameters:
 * - dryRun: If 'true', only returns stats without performing cleanup
 *
 * @author Nixtla MCP Server
 * @version 1.0.0
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateToken } from '../../src/mcp/organization.js';
import { cleanupExpiredDatasets, getCleanupStats } from '../../src/storage/cleanup.js';

const MCP_AUTH_TOKEN_SECRET = process.env.MCP_AUTH_TOKEN_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

if (!MCP_AUTH_TOKEN_SECRET) {
  throw new Error('MCP_AUTH_TOKEN_SECRET environment variable is required');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if this is a cron job request (from Vercel)
    const cronAuthHeader = req.headers['x-vercel-cron-secret'] as string | null;
    const isCronJob = cronAuthHeader && CRON_SECRET && cronAuthHeader === CRON_SECRET;

    if (!isCronJob) {
      // Regular authenticated request - require admin token
      const authHeader = req.headers.authorization as string | null;

      if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header is required' });
      }

      const token = authHeader.replace(/^Bearer\s+/i, '');
      const tokenInfo = await authenticateToken(token, MCP_AUTH_TOKEN_SECRET!);

      if (!tokenInfo) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      // Check admin privileges
      if (!tokenInfo.isAdmin) {
        return res.status(403).json({
          error: 'Access denied. Admin privileges required.',
        });
      }
    }

    // Check for dry run mode
    const dryRun = req.query.dryRun === 'true';

    if (dryRun) {
      // Only get statistics without performing cleanup
      const stats = await getCleanupStats();

      return res.status(200).json({
        dryRun: true,
        stats,
        message: `Would delete ${stats.expiredCount} expired datasets (${(stats.totalExpiredBytes / 1024 / 1024).toFixed(2)} MB)`,
      });
    }

    // Perform actual cleanup
    const result = await cleanupExpiredDatasets();

    return res.status(200).json({
      success: true,
      result,
      message: `Cleanup completed: ${result.filesDeleted} files deleted, ${result.filesFailed} failed, ${(result.bytesFreed / 1024 / 1024).toFixed(2)} MB freed`,
    });

  } catch (error) {
    console.error('Dataset cleanup error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
