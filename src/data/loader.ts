import { sha256 } from '../utils/base64url.js';
import type { NixtlaSeries } from '../nixtla/types.js';
import { validateNixtlaSeries } from './validate.js';
import { getDatasetFile } from '../storage/dataset-storage.js';

const MAX_DATASET_SIZE = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;

export interface LoadedDataset {
  series: NixtlaSeries & { X_future?: number[][] };
  freq: 'D' | 'H' | 'W' | 'M' | 'MS';
  datasetHash: string;
  meta?: {
    seriesNames?: string[];
    timestamps?: string[];
  };
}

export async function loadDatasetFromUrl(
  url: string | undefined
): Promise<LoadedDataset> {
  if (!url) {
    throw new Error('Dataset URL not configured for this organization. Please set datasetUrl using set_org_config tool.');
  }

  // Check if this is an internal dataset path (e.g., /api/datasets/{orgId}/{fileId})
  if (url.startsWith('/api/datasets/')) {
    // Extract fileId from path: /api/datasets/{orgId}/{fileId}
    const parts = url.split('/');
    const fileId = parts[parts.length - 1];

    // Load dataset directly from MongoDB
    const datasetFile = await getDatasetFile(fileId);

    if (!datasetFile || datasetFile.status !== 'active') {
      throw new Error('Dataset not found or has expired');
    }

    const data = datasetFile.datasetContent;

    if (!data.series || !data.freq) {
      throw new Error('Dataset must contain series and freq fields');
    }

    const validation = validateNixtlaSeries(data.series);
    if (!validation.valid) {
      throw new Error(
        `Invalid dataset: ${validation.errors.join(', ')}`
      );
    }

    const dataStr = JSON.stringify(data);
    const datasetHash = sha256(dataStr).toString('hex');

    return {
      series: data.series,
      freq: data.freq as 'D' | 'H' | 'W' | 'M' | 'MS',
      datasetHash,
      meta: data.meta,
    };
  }

  // Handle external URLs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Nixtla-MCP-Server/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch dataset: ${response.status} ${response.statusText}`
      );
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_DATASET_SIZE) {
      throw new Error(
        `Dataset too large: ${contentLength} bytes (max ${MAX_DATASET_SIZE})`
      );
    }

    const text = await response.text();

    if (text.length > MAX_DATASET_SIZE) {
      throw new Error(
        `Dataset too large: ${text.length} bytes (max ${MAX_DATASET_SIZE})`
      );
    }

    const data = JSON.parse(text);

    if (!data.series || !data.freq) {
      throw new Error('Dataset must contain series and freq fields');
    }

    const validation = validateNixtlaSeries(data.series);
    if (!validation.valid) {
      throw new Error(
        `Invalid dataset: ${validation.errors.join(', ')}`
      );
    }

    const datasetHash = sha256(text).toString('hex');

    return {
      series: data.series,
      freq: data.freq,
      datasetHash,
      meta: data.meta,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Dataset fetch timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function loadDatasetFromObject(data: Record<string, unknown>): LoadedDataset {
  if (!data || typeof data !== 'object') {
    throw new Error('Dataset data must be an object');
  }

  if (!data.series || !data.freq) {
    throw new Error('Dataset must contain series and freq fields');
  }

  const validation = validateNixtlaSeries(data.series as import('../nixtla/types.js').NixtlaSeries);
  if (!validation.valid) {
    throw new Error(`Invalid dataset: ${validation.errors.join(', ')}`);
  }

  const dataStr = JSON.stringify(data);
  const datasetHash = sha256(dataStr).toString('hex');

  return {
    series: data.series as import('../nixtla/types.js').NixtlaSeries,
    freq: data.freq as 'D' | 'H' | 'W' | 'M' | 'MS',
    datasetHash,
    meta: data.meta as { seriesNames?: string[]; timestamps?: string[] },
  };
}

export async function loadDataset(options: {
  inlineData?: Record<string, unknown>;
  url?: string;
  fallbackUrl?: string;
}): Promise<LoadedDataset> {
  if (options.inlineData) {
    return loadDatasetFromObject(options.inlineData);
  }

  const urlToUse = options.url || options.fallbackUrl;
  return loadDatasetFromUrl(urlToUse);
}

export function computeDatasetStats(series: NixtlaSeries) {
  const nSeries = series.sizes.length;
  const yLen = series.y.length;
  const nFeatures = series.X?.[0]?.length ?? 0;

  return { nSeries, yLen, nFeatures };
}
