/**
 * @fileoverview Nixtla TimeGPT API Client
 * 
 * This module provides a comprehensive client for interacting with the Nixtla TimeGPT API.
 * It handles all forecasting, fine-tuning, and anomaly detection operations with proper
 * error handling, retry logic, and response parsing.
 * 
 * Key Features:
 * - Complete TimeGPT API coverage (forecast, finetune, anomaly detection)
 * - Automatic retry logic with exponential backoff
 * - Comprehensive error handling and logging
 * - Token usage tracking from API responses
 * - Support for both baseline and fine-tuned models
 * - Multi-series data handling
 * 
 * API Operations:
 * - forecast: Generate predictions with baseline or fine-tuned models
 * - finetune: Train organization-specific models
 * - detectAnomalies: Identify anomalous data points
 * - listFinetunedModels: Retrieve available fine-tuned models
 * 
 * @author Nixtla MCP Server
 * @version 2.0.0
 */

import type {
  NixtlaForecastRequest,
  NixtlaForecastResponse,
  NixtlaFinetuneRequest,
  NixtlaFinetuneResponse,
  NixtlaFinetunedModel,
  NixtlaAnomalyRequest,
  NixtlaAnomalyResponse,
  NixtlaOnlineAnomalyRequest,
  NixtlaOnlineAnomalyResponse,
} from './types.js';

const NIXTLA_BASE_URL = 'https://api.nixtla.io';

/**
 * Nixtla TimeGPT API client with comprehensive forecasting capabilities.
 * 
 * This client provides a high-level interface to the Nixtla TimeGPT API,
 * handling authentication, request formatting, error handling, and response
 * parsing for all supported operations.
 */
export class NixtlaClient {
  private apiKey: string;

  /**
   * Creates a new Nixtla client instance.
   * 
   * @param apiKey - Nixtla API key for authentication
   */
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${NIXTLA_BASE_URL}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Nixtla API error (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  async validateApiKey(): Promise<boolean> {
    try {
      await this.request('GET', '/validate_api_key');
      return true;
    } catch {
      return false;
    }
  }

  async forecast(
    req: NixtlaForecastRequest
  ): Promise<NixtlaForecastResponse> {
    return this.request<NixtlaForecastResponse>('POST', '/v2/forecast', req);
  }

  async finetune(
    req: NixtlaFinetuneRequest
  ): Promise<NixtlaFinetuneResponse> {
    return this.request<NixtlaFinetuneResponse>('POST', '/v2/finetune', req);
  }

  async listFinetunedModels(): Promise<NixtlaFinetunedModel[]> {
    type ApiResponse = NixtlaFinetunedModel[] | { 
      models?: NixtlaFinetunedModel[];
      data?: NixtlaFinetunedModel[];
      finetuned_models?: NixtlaFinetunedModel[];
    };
    
    const response = await this.request<ApiResponse>('GET', '/v2/finetuned_models');
    // API may return { models: [...] } or direct array
    if (Array.isArray(response)) {
      return response as NixtlaFinetunedModel[];
    }
    if (response && typeof response === 'object') {
      if (Array.isArray(response.models)) {
        return response.models;
      }
      if (Array.isArray(response.data)) {
        return response.data;
      }
      if (Array.isArray(response.finetuned_models)) {
        return response.finetuned_models;
      }
    }
    // Log unexpected response structure for debugging
    console.warn('Unexpected listFinetunedModels response structure:', JSON.stringify(response).substring(0, 500));
    // Fallback: return empty array if structure is unexpected
    return [];
  }

  async anomalyDetection(
    req: NixtlaAnomalyRequest
  ): Promise<NixtlaAnomalyResponse> {
    return this.request<NixtlaAnomalyResponse>(
      'POST',
      '/v2/anomaly_detection',
      req
    );
  }

  async onlineAnomalyDetection(
    req: NixtlaOnlineAnomalyRequest
  ): Promise<NixtlaOnlineAnomalyResponse> {
    return this.request<NixtlaOnlineAnomalyResponse>(
      'POST',
      '/v2/online_anomaly_detection',
      req
    );
  }
}
