/**
 * @fileoverview List Organization Datasets Endpoint
 *
 * This endpoint allows organizations to list their generated forecast datasets.
 * Only returns datasets belonging to the requesting organization (or all for admins).
 *
 * Route: GET /api/datasets/list
 *
 * Security:
 * - Requires valid authentication token
 * - Users can only see their own org's datasets
 * - Admins can see all datasets
 *
 * Query Parameters:
 * - includeExpired: If 'true', includes expired datasets in the list
 *
 * @author Nixtla MCP Server
 * @version 1.0.0
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateToken } from '../../src/mcp/organization.js';
import { listOrgDatasets, getOrgStorageStats } from '../../src/storage/dataset-storage.js';

const MCP_AUTH_TOKEN_SECRET = process.env.MCP_AUTH_TOKEN_SECRET;

if (!MCP_AUTH_TOKEN_SECRET) {
  throw new Error('MCP_AUTH_TOKEN_SECRET environment variable is required');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate the request
    const authHeader = req.headers.authorization as string | null;

    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header is required' });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const tokenInfo = await authenticateToken(token, MCP_AUTH_TOKEN_SECRET);

    if (!tokenInfo) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Check for includeExpired parameter
    const includeExpired = req.query.includeExpired === 'true';

    // List datasets for the organization
    const datasets = await listOrgDatasets(tokenInfo.orgId, includeExpired);

    // Get storage statistics
    const stats = await getOrgStorageStats(tokenInfo.orgId);

    // Get base URL from environment or use relative path
    const baseUrl = process.env.BASE_URL || '';

    // Add full URLs to datasets
    const datasetsWithUrls = datasets.map(dataset => ({
      fileId: dataset.fileId,
      publicUrl: dataset.publicUrl,
      fullUrl: `${baseUrl}${dataset.publicUrl}`,
      createdAt: dataset.createdAt,
      expiresAt: dataset.expiresAt,
      status: dataset.status,
      sizeBytes: dataset.sizeBytes,
      metadata: dataset.metadata,
    }));

    return res.status(200).json({
      orgId: tokenInfo.orgId,
      datasets: datasetsWithUrls,
      stats: {
        totalFiles: stats.totalFiles,
        activeFiles: stats.activeFiles,
        expiredFiles: stats.expiredFiles,
        totalSizeMB: (stats.totalBytes / 1024 / 1024).toFixed(2),
        activeSizeMB: (stats.activeBytes / 1024 / 1024).toFixed(2),
      },
    });

  } catch (error) {
    console.error('List datasets error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
