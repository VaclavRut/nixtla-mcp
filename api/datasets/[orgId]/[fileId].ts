/**
 * @fileoverview Secure Dataset Access Endpoint (Serverless-Compatible)
 *
 * This endpoint serves generated forecast datasets from MongoDB with authentication and access control.
 * Only the organization that created the dataset or admins can access it.
 *
 * Route: GET /api/datasets/{orgId}/{fileId}
 *
 * Security:
 * - Requires Authorization header with valid token
 * - Validates org ownership or admin privileges
 * - Checks dataset expiration
 * - Returns 403 Forbidden for unauthorized access
 *
 * @author Nixtla MCP Server
 * @version 2.0.0 (Serverless)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateToken } from '../../../src/mcp/organization.js';
import { getDatasetFile, canAccessDataset } from '../../../src/storage/dataset-storage.js';

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
    // Extract fileId from URL (format: /api/datasets/{orgId}/{fileId}.json or {fileId})
    const { fileId: rawFileId } = req.query;

    if (!rawFileId || typeof rawFileId !== 'string') {
      return res.status(400).json({ error: 'File ID is required' });
    }

    // Remove .json extension if present
    const fileId = rawFileId.replace(/\.json$/, '');

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

    // Check access permissions
    const hasAccess = await canAccessDataset(fileId, tokenInfo.orgId, tokenInfo.isAdmin);

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied. You do not have permission to access this dataset.',
        details: 'This dataset belongs to another organization or has expired.'
      });
    }

    // Get file metadata
    const datasetFile = await getDatasetFile(fileId);

    if (!datasetFile) {
      return res.status(404).json({ error: 'Dataset file not found' });
    }

    // Check if dataset is expired
    if (datasetFile.expiresAt < new Date()) {
      return res.status(410).json({
        error: 'Dataset has expired',
        expiresAt: datasetFile.expiresAt.toISOString()
      });
    }

    // Get dataset content from database
    const datasetContent = datasetFile.datasetContent;

    // Set headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour
    res.setHeader('X-Dataset-FileId', datasetFile.fileId);
    res.setHeader('X-Dataset-OrgId', datasetFile.orgId);
    res.setHeader('X-Dataset-ExpiresAt', datasetFile.expiresAt.toISOString());

    // Return dataset content
    return res.status(200).json(datasetContent);

  } catch (error) {
    console.error('Dataset file access error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
