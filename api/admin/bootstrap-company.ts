import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDatabase } from '../../src/utils/mongodb.js';
import { generateSecureToken, computeTokenHash } from '../../src/utils/base64url.js';
import { getISOTimestamp } from '../../src/utils/time.js';
import {
  createOrganization,
  addTokenToOrg,
  getOrganization,
  type Organization
} from '../../src/mcp/organization.js';

const ADMIN_SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN;
const MCP_AUTH_TOKEN_SECRET = process.env.MCP_AUTH_TOKEN_SECRET;

if (!ADMIN_SETUP_TOKEN) {
  throw new Error('ADMIN_SETUP_TOKEN environment variable is required');
}

if (!MCP_AUTH_TOKEN_SECRET) {
  throw new Error('MCP_AUTH_TOKEN_SECRET environment variable is required');
}

interface BootstrapRequest {
  orgId: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization as string | null;

  if (!authHeader || authHeader !== `Bearer ${ADMIN_SETUP_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body as BootstrapRequest;

  if (!body || !body.orgId) {
    return res.status(400).json({
      error: 'Missing required field: orgId',
    });
  }

  try {
    // Check if organization already exists
    const existingOrg = await getOrganization(body.orgId);
    if (existingOrg) {
      return res.status(409).json({
        error: 'Organization already exists',
        orgId: body.orgId,
        message: `Organization with ID "${body.orgId}" already exists. Use a different orgId or manage the existing organization.`,
      });
    }

    const authToken = generateSecureToken(32);
    const tokenHash = computeTokenHash(authToken, MCP_AUTH_TOKEN_SECRET!);

    // Create organization with unified structure
    const org = await createOrganization(body.orgId, body.orgId);

    // Add token to organization
    await addTokenToOrg(body.orgId, tokenHash, false, ['read', 'execute']);

    return res.status(200).json({
      orgId: body.orgId,
      authToken,
      message: 'Organization bootstrapped successfully. Store the authToken securely - it will not be shown again.',
    });
  } catch (error) {
    console.error('Bootstrap error:', error);

    // Check if it's a duplicate key error from MongoDB (in case the check above failed)
    const isDuplicateError = error instanceof Error &&
      (error.message.includes('E11000') || error.message.includes('duplicate key'));

    if (isDuplicateError) {
      return res.status(409).json({
        error: 'Organization already exists',
        orgId: body.orgId,
        message: `Organization with ID "${body.orgId}" already exists.`,
      });
    }

    return res.status(500).json({
      error: 'Failed to bootstrap organization',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
