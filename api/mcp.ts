import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MCPServer } from '../src/mcp/server.js';

const NIXTLA_API_KEY = process.env.NIXTLA_API_KEY;
const MCP_AUTH_TOKEN_SECRET = process.env.MCP_AUTH_TOKEN_SECRET;
const ADMIN_SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN;

if (!NIXTLA_API_KEY) {
  throw new Error('NIXTLA_API_KEY environment variable is required');
}

if (!MCP_AUTH_TOKEN_SECRET) {
  throw new Error('MCP_AUTH_TOKEN_SECRET environment variable is required');
}

if (!ADMIN_SETUP_TOKEN) {
  throw new Error('ADMIN_SETUP_TOKEN environment variable is required');
}

const server = new MCPServer({
  nixtlaApiKey: NIXTLA_API_KEY,
  authTokenSecret: MCP_AUTH_TOKEN_SECRET,
  adminSetupToken: ADMIN_SETUP_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization as string | null;
  const requestBody = req.body;

  if (!requestBody || typeof requestBody !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const response = await server.handleRequest(requestBody, authHeader);
    return res.status(200).json(response);
  } catch (error) {
    console.error('MCP request error:', error);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: requestBody.id || null,
      error: {
        code: -32603,
        message: 'Internal server error',
      },
    });
  }
}
