import { getDatabase } from '../utils/mongodb.js';
import { computeTokenHash } from '../utils/base64url.js';

export interface TokenInfo {
  orgId: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

export interface OrgConfig {
  orgId: string;
  activeFinetunedModelId?: string;
}

export async function authenticateToken(
  token: string,
  hmacSecret: string
): Promise<TokenInfo | null> {
  const db = await getDatabase();
  const tokenHash = computeTokenHash(token, hmacSecret);
  
  const tokens = db.collection('tokens');
  const doc = await tokens.findOne({ tokenHash });

  if (!doc) {
    return null;
  }

  const info: TokenInfo = {
    orgId: doc.orgId,
    status: doc.status,
    createdAt: doc.createdAt
  };
  
  if (info.status !== 'active') {
    return null;
  }

  return info;
}

export async function getOrgConfig(orgId: string): Promise<OrgConfig | null> {
  const db = await getDatabase();
  const configs = db.collection('orgConfigs');
  const doc = await configs.findOne({ orgId });
  return doc ? doc as unknown as OrgConfig : null;
}

export async function setOrgConfig(config: OrgConfig): Promise<void> {
  const db = await getDatabase();
  const configs = db.collection('orgConfigs');
  await configs.updateOne(
    { orgId: config.orgId },
    { $set: config },
    { upsert: true }
  );
}

export async function getOrgModels(orgId: string): Promise<string[]> {
  const db = await getDatabase();
  const models = db.collection('orgModels');
  const doc = await models.findOne({ orgId });
  return doc?.modelIds || [];
}

export async function addOrgModel(orgId: string, modelId: string): Promise<void> {
  const db = await getDatabase();
  const models = db.collection('orgModels');
  await models.updateOne(
    { orgId },
    { $addToSet: { modelIds: modelId } },
    { upsert: true }
  );
}

export async function setActiveModel(
  orgId: string,
  modelId: string
): Promise<void> {
  const config = await getOrgConfig(orgId);
  if (!config) {
    throw new Error('Org config not found');
  }

  const models = await getOrgModels(orgId);
  if (!models.includes(modelId)) {
    // Auto-register the model if setting it as active
    await addOrgModel(orgId, modelId);
  }

  config.activeFinetunedModelId = modelId;
  await setOrgConfig(config);
}
