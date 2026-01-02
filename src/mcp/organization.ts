/**
 * @fileoverview Unified Organization Management System
 * 
 * This module provides a centralized approach to managing organizations, authentication tokens,
 * and fine-tuned models. It replaces the previous scattered collection approach with a single
 * unified organization document that contains all related data.
 * 
 * Key Features:
 * - Unified data model with embedded tokens and models
 * - Rich model metadata and performance tracking
 * - Token-based authentication with HMAC security
 * - Automatic performance metrics collection
 * - Backward compatibility with legacy interfaces
 * 
 * Collections:
 * - organizations: Main unified collection containing all org data
 * 
 * @author Nixtla MCP Server
 * @version 2.0.0
 */

import { getDatabase } from '../utils/mongodb.js';
import { computeTokenHash } from '../utils/base64url.js';

/**
 * Fine-tuned model with comprehensive metadata and performance tracking.
 * Stores both training details and runtime performance metrics.
 */
export interface FinetunedModel {
  /** Unique identifier for the model from Nixtla API */
  modelId: string;
  /** Optional human-readable name for the model */
  name?: string;
  /** Current status of the model */
  status: 'active' | 'inactive' | 'training' | 'failed';
  /** When the model was added to the organization */
  createdAt: Date;
  /** Last time model metadata was updated */
  updatedAt: Date;
  
  /** Training metadata and configuration details */
  metadata: {
    /** Source dataset used for training (URL or 'inline-data') */
    trainingDataset?: string;
    /** When training process started */
    trainingStarted?: Date;
    /** When training process completed */
    trainingCompleted?: Date;
    /** Number of training epochs/steps */
    totalEpochs?: number;
    /** Final training loss value */
    finalLoss?: number;
    /** Validation accuracy if available */
    validationAccuracy?: number;
    /** Total training duration in milliseconds */
    trainingDurationMs?: number;
    /** Base model used for finetuning (e.g., 'timegpt-1' or 'timegpt-1-long-horizon') */
    baseModel?: string;
  };
  
}

/**
 * Authentication token associated with an organization.
 * Tokens are stored as HMAC hashes for security.
 */
export interface OrganizationToken {
  /** HMAC hash of the original token for secure storage */
  tokenHash: string;
  /** Current status of the token */
  status: 'active' | 'disabled';
  /** When the token was created */
  createdAt: Date;
  /** Last time this token was used for authentication */
  lastUsed?: Date;
  /** List of permissions granted to this token (e.g., 'read', 'execute') */
  permissions: string[];
  /** Whether this token has administrative privileges */
  isAdmin: boolean;
}


/**
 * Organization configuration settings and preferences.
 */
export interface OrganizationConfig {
  /** Custom API settings and parameters */
  apiSettings?: Record<string, unknown>;
}

/**
 * Complete organization document containing all related data.
 * This is the main document stored in the 'organizations' collection.
 */
export interface Organization {
  /** MongoDB document ID */
  _id?: import('mongodb').ObjectId;
  /** Unique organization identifier */
  orgId: string;
  /** Optional human-readable organization name */
  name?: string;
  /** Current organization status */
  status: 'active' | 'disabled' | 'suspended';
  /** When the organization was created */
  createdAt: Date;
  /** Last time organization data was updated */
  updatedAt: Date;
  
  /** All authentication tokens for this organization */
  tokens: OrganizationToken[];
  
  /** All fine-tuned models owned by this organization */
  models: FinetunedModel[];
  /** Currently active model ID for forecasting operations */
  activeModelId?: string;
  
  /** Organization configuration and settings */
  config: OrganizationConfig;
  
  /** Cached current usage summary for performance */
  currentUsage?: {
    /** Current month in YYYY-MM format */
    month: string;
    /** Total API calls this month */
    callCount: number;
    /** Total tokens consumed this month */
    tokenCount: number;
    /** Total errors this month */
    errorCount: number;
    /** When this cache was last updated */
    lastUpdated: Date;
  };
}

/**
 * Token information returned after successful authentication.
 */
export interface TokenInfo {
  /** Organization ID this token belongs to */
  orgId: string;
  /** Token status */
  status: 'active' | 'disabled';
  /** Whether this token has admin privileges */
  isAdmin: boolean;
  /** List of permissions granted to this token */
  permissions: string[];
  /** When the token was created */
  createdAt: Date;
}

/**
 * Authenticates a token against the organization database.
 * 
 * This function:
 * 1. Computes HMAC hash of the provided token
 * 2. Searches for an organization with a matching token hash
 * 3. Validates token status and organization status
 * 4. Updates the token's last used timestamp
 * 
 * @param token - Raw token string provided by the client
 * @param hmacSecret - HMAC secret key for token hashing
 * @returns Token information if authentication succeeds, null otherwise
 * 
 * @example
 * ```typescript
 * const tokenInfo = await authenticateToken('abc123...', 'secret_key');
 * if (tokenInfo && tokenInfo.isAdmin) {
 *   // User has admin privileges
 * }
 * ```
 */
export async function authenticateToken(
  token: string,
  hmacSecret: string
): Promise<TokenInfo | null> {
  const db = await getDatabase();
  const tokenHash = computeTokenHash(token, hmacSecret);
  
  const organizations = db.collection('organizations');
  const org = await organizations.findOne({
    'tokens.tokenHash': tokenHash,
    status: 'active'
  });

  if (!org) {
    return null;
  }

  const tokenData = org.tokens.find((t: OrganizationToken) => t.tokenHash === tokenHash);
  if (!tokenData || tokenData.status !== 'active') {
    return null;
  }

  // Update last used timestamp
  await organizations.updateOne(
    { orgId: org.orgId, 'tokens.tokenHash': tokenHash },
    { 
      $set: { 
        'tokens.$.lastUsed': new Date(),
        updatedAt: new Date()
      }
    }
  );

  return {
    orgId: org.orgId,
    status: tokenData.status,
    isAdmin: tokenData.isAdmin,
    permissions: tokenData.permissions,
    createdAt: tokenData.createdAt
  };
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const db = await getDatabase();
  const organizations = db.collection('organizations');
  const org = await organizations.findOne({ orgId });
  return org ? org as Organization : null;
}

export async function createOrganization(
  orgId: string,
  name?: string,
  config?: Partial<OrganizationConfig>
): Promise<Organization> {
  const db = await getDatabase();
  const organizations = db.collection('organizations');
  
  const org: Organization = {
    orgId,
    name,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    tokens: [],
    models: [],
    config: {
      ...config
    }
  };
  
  await organizations.insertOne(org);
  
  // Create indexes for efficient querying
  await organizations.createIndex({ orgId: 1 }, { unique: true });
  await organizations.createIndex({ 'tokens.tokenHash': 1 });
  await organizations.createIndex({ status: 1 });
  
  return org;
}

export async function addTokenToOrg(
  orgId: string, 
  tokenHash: string, 
  isAdmin: boolean = false,
  permissions: string[] = ['read', 'execute']
): Promise<void> {
  const db = await getDatabase();
  const organizations = db.collection('organizations');
  
  const newToken: OrganizationToken = {
    tokenHash,
    status: 'active',
    createdAt: new Date(),
    permissions,
    isAdmin
  };
  
  await organizations.updateOne(
    { orgId },
    { 
      $push: { tokens: newToken } as unknown as import('mongodb').PushOperator<import('mongodb').Document>,
      $set: { updatedAt: new Date() }
    }
  );
}

export async function getOrgModels(orgId: string): Promise<FinetunedModel[]> {
  const org = await getOrganization(orgId);
  return org?.models || [];
}

export async function addFinetunedModel(
  orgId: string,
  modelId: string,
  name?: string,
  metadata?: Partial<FinetunedModel['metadata']>
): Promise<void> {
  const db = await getDatabase();
  const organizations = db.collection('organizations');

  // Check if model already exists
  const org = await getOrganization(orgId);
  if (!org) {
    throw new Error('Organization not found');
  }

  const existingModelIndex = org.models.findIndex(m => m.modelId === modelId);

  if (existingModelIndex >= 0) {
    // Model exists - update it (retrain scenario)
    const updatedModel: FinetunedModel = {
      modelId,
      name: name || org.models[existingModelIndex].name,
      status: 'active',
      createdAt: org.models[existingModelIndex].createdAt, // Preserve original creation date
      updatedAt: new Date(),
      metadata: {
        ...org.models[existingModelIndex].metadata,
        ...metadata, // Merge new metadata
      }
    };

    await organizations.updateOne(
      { orgId, 'models.modelId': modelId },
      {
        $set: {
          [`models.${existingModelIndex}`]: updatedModel,
          updatedAt: new Date()
        }
      }
    );
  } else {
    // Model doesn't exist - add new
    const newModel: FinetunedModel = {
      modelId,
      name,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: metadata || {}
    };

    await organizations.updateOne(
      { orgId },
      {
        $push: { models: newModel } as unknown as import('mongodb').PushOperator<import('mongodb').Document>,
        $set: { updatedAt: new Date() }
      }
    );
  }
}

export async function updateModelMetadata(
  orgId: string,
  modelId: string,
  metadata: Partial<FinetunedModel['metadata']>
): Promise<void> {
  const db = await getDatabase();
  const organizations = db.collection('organizations');
  
  await organizations.updateOne(
    { orgId, 'models.modelId': modelId },
    { 
      $set: { 
        'models.$.metadata': { $mergeObjects: ['$$ROOT.models.metadata', metadata] },
        'models.$.updatedAt': new Date(),
        updatedAt: new Date()
      }
    }
  );
}


export async function setActiveModel(orgId: string, modelId: string): Promise<void> {
  const org = await getOrganization(orgId);
  if (!org) {
    throw new Error('Organization not found');
  }

  const model = org.models.find(m => m.modelId === modelId);
  if (!model) {
    throw new Error('Model not found in organization');
  }

  if (model.status !== 'active') {
    throw new Error('Cannot set inactive model as active');
  }

  const db = await getDatabase();
  const organizations = db.collection('organizations');
  
  await organizations.updateOne(
    { orgId },
    { 
      $set: { 
        activeModelId: modelId,
        updatedAt: new Date()
      }
    }
  );
}

export async function getActiveModel(orgId: string): Promise<FinetunedModel | null> {
  const org = await getOrganization(orgId);
  if (!org || !org.activeModelId) {
    return null;
  }
  
  return org.models.find(m => m.modelId === org.activeModelId) || null;
}

export async function updateModelStatus(
  orgId: string,
  modelId: string,
  status: FinetunedModel['status']
): Promise<void> {
  const db = await getDatabase();
  const organizations = db.collection('organizations');
  
  await organizations.updateOne(
    { orgId, 'models.modelId': modelId },
    { 
      $set: { 
        'models.$.status': status,
        'models.$.updatedAt': new Date(),
        updatedAt: new Date()
      }
    }
  );

  // If we're deactivating the active model, clear it
  if (status !== 'active') {
    const org = await getOrganization(orgId);
    if (org?.activeModelId === modelId) {
      await organizations.updateOne(
        { orgId },
        { 
          $unset: { activeModelId: 1 },
          $set: { updatedAt: new Date() }
        }
      );
    }
  }
}

export async function removeModel(orgId: string, modelId: string): Promise<void> {
  const db = await getDatabase();
  const organizations = db.collection('organizations');
  
  // Remove model from array
  await organizations.updateOne(
    { orgId },
    { 
      $pull: { models: { modelId } } as unknown as import('mongodb').PullOperator<import('mongodb').Document>,
      $set: { updatedAt: new Date() }
    }
  );

  // Clear active model if it was the one being removed
  const org = await getOrganization(orgId);
  if (org?.activeModelId === modelId) {
    await organizations.updateOne(
      { orgId },
      { 
        $unset: { activeModelId: 1 },
        $set: { updatedAt: new Date() }
      }
    );
  }
}

export async function updateOrganizationConfig(
  orgId: string,
  config: Partial<OrganizationConfig>
): Promise<void> {
  const db = await getDatabase();
  const organizations = db.collection('organizations');
  
  await organizations.updateOne(
    { orgId },
    { 
      $set: { 
        config: { $mergeObjects: ['$config', config] },
        updatedAt: new Date()
      }
    }
  );
}

// Legacy compatibility functions - these maintain backward compatibility
export async function getOrgConfig(orgId: string): Promise<{ orgId: string; activeFinetunedModelId?: string } | null> {
  const org = await getOrganization(orgId);
  if (!org) return null;
  
  return {
    orgId: org.orgId,
    activeFinetunedModelId: org.activeModelId
  };
}

export async function setOrgConfig(config: { orgId: string; activeFinetunedModelId?: string }): Promise<void> {
  if (config.activeFinetunedModelId) {
    await setActiveModel(config.orgId, config.activeFinetunedModelId);
  }
}

export async function addOrgModel(orgId: string, modelId: string): Promise<void> {
  await addFinetunedModel(orgId, modelId);
}