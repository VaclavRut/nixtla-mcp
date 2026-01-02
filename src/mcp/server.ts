/**
 * @fileoverview MCP Server Implementation
 * 
 * This module implements the core Model Context Protocol (MCP) server that handles
 * JSON-RPC 2.0 requests and manages the complete request lifecycle from authentication
 * to tool execution and response formatting.
 * 
 * Key Features:
 * - JSON-RPC 2.0 protocol implementation
 * - Token-based authentication with organization isolation
 * - Comprehensive tool discovery and execution
 * - Automatic usage tracking and performance monitoring
 * - Detailed error handling and logging
 * - Request ID generation for idempotency
 * 
 * Supported MCP Methods:
 * - initialize: Server capability negotiation
 * - tools/list: Discover available tools
 * - tools/call: Execute specific tools
 * 
 * @author Nixtla MCP Server
 * @version 2.0.0
 */

import { NixtlaClient } from '../nixtla/client.js';
import { authenticateToken } from './organization.js';
import { MCPToolsHandler, MCP_TOOLS } from './tools.js';
import { generateSecureToken } from '../utils/base64url.js';

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPContext {
  nixtlaApiKey: string;
  authTokenSecret: string;
  adminSetupToken: string;
}

/**
 * Main MCP server class that handles all protocol operations.
 * 
 * This server implements the complete MCP protocol including authentication,
 * tool discovery, execution, and response formatting. It provides a secure
 * multi-tenant environment with organization isolation and comprehensive
 * usage tracking.
 * 
 * Request Flow:
 * 1. Parse and validate JSON-RPC 2.0 request
 * 2. Authenticate token and resolve organization
 * 3. Route to appropriate method handler
 * 4. Execute tools with usage tracking
 * 5. Format and return JSON-RPC response
 */
export class MCPServer {
  /**
   * Creates a new MCP server instance.
   * 
   * @param context - Server configuration including API keys and secrets
   */
  constructor(private context: MCPContext) {}

  async handleRequest(
    request: MCPRequest,
    authHeader: string | null
  ): Promise<MCPResponse> {
    try {
      if (request.method === 'initialize') {
        return this.handleInitialize(request.id);
      }

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return this.errorResponse(request.id, -32001, 'Missing or invalid authorization header');
      }

      const token = authHeader.substring(7);
      const isAdmin = token === this.context.adminSetupToken;

      const tokenInfo = !isAdmin
        ? await authenticateToken(token, this.context.authTokenSecret)
        : null;

      if (!isAdmin && !tokenInfo) {
        return this.errorResponse(request.id, -32002, 'Invalid or disabled token');
      }

      const orgId = isAdmin ? 'admin' : tokenInfo!.orgId;

      switch (request.method) {
        case 'tools/list':
          return this.listTools(request.id, isAdmin);
        case 'tools/call':
          return await this.callTool(request, orgId, isAdmin);
        case 'resources/list':
          return this.listResources(request.id);
        default:
          return this.errorResponse(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      return this.errorResponse(request.id, -32603, message);
    }
  }

  private handleInitialize(id: string | number): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {
            listChanged: false
          },
          resources: {
            subscribe: false,
            listChanged: false
          }
        },
        serverInfo: {
          name: 'nixtla-mcp-server',
          version: '1.0.0'
        }
      }
    };
  }

  private listTools(id: string | number, isAdmin: boolean): MCPResponse {
    const tools = isAdmin 
      ? MCP_TOOLS 
      : MCP_TOOLS.filter(tool => !(tool as { adminOnly?: boolean }).adminOnly);
    
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools,
      },
    };
  }

  private async callTool(
    request: MCPRequest,
    orgId: string,
    isAdmin: boolean
  ): Promise<MCPResponse> {
    const params = request.params as { name: string; arguments: Record<string, unknown> };

    if (!params || !params.name) {
      return this.errorResponse(request.id, -32602, 'Invalid params: name is required');
    }

    const requestId = (request.params as { requestId?: string })?.requestId || generateSecureToken(16);
    const client = new NixtlaClient(this.context.nixtlaApiKey);
    const handler = new MCPToolsHandler(client, orgId, requestId, isAdmin);

    try {
      const result = await handler.executeTool({
        name: params.name,
        arguments: params.arguments || {},
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      return this.errorResponse(request.id, -32000, message);
    }
  }

  private listResources(id: string | number): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        resources: [],
      },
    };
  }

  private errorResponse(
    id: string | number,
    code: number,
    message: string
  ): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    };
  }
}
