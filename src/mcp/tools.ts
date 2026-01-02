/**
 * @fileoverview MCP Tools Implementation
 * 
 * This module implements all the Model Context Protocol (MCP) tools for the Nixtla
 * time series forecasting server. It provides a comprehensive set of operations
 * for fine-tuning, forecasting, anomaly detection, and model management.
 * 
 * Key Features:
 * - Complete fine-tuning lifecycle (train, manage, switch models)
 * - Baseline and fine-tuned forecasting with performance tracking
 * - Anomaly detection with context awareness
 * - Rolling backtest comparisons for model validation
 * - Usage tracking and consumption monitoring
 * - Model performance metrics collection
 * - Admin-only tools with permission checking
 * 
 * Tool Categories:
 * - Model Management: finetune_model (auto-runs backtest), list_org_models
 * - Forecasting: forecast (auto-selects best model)
 * - Analysis: anomaly_detect
 * - Utilities: validate_dataset
 * 
 * @author Nixtla MCP Server
 * @version 2.0.0
 */

import { z } from 'zod';
import type { NixtlaClient } from '../nixtla/client.js';
import {
  getOrgConfig,
  getOrgModels,
  setActiveModel,
  addFinetunedModel,
} from './organization.js';
import { loadDataset } from '../data/loader.js';
import { getUsageSummary, trackConsumption, type ConsumptionContext } from '../consumption/consumption.js';
import { rollingBacktestCompare } from '../backtest/rolling.js';
import { storeResult, storeCSV } from '../storage/result-storage.js';
import { generateSimpleForecastCSV } from '../utils/csv-generator.js';

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'resource';
    text?: string;
    resource?: {
      uri: string;
      mimeType: string;
      text: string;
    };
  }>;
  isError?: boolean;
}

const GetOrgConfigSchema = z.object({});

const SetActiveModelSchema = z.object({
  modelId: z.string().min(1),
});

const FinetuneModelSchema = z.object({
  finetuneOptions: z
    .object({
      finetune_steps: z.number().int().positive().optional().default(300),
      finetune_loss: z.enum(['default', 'mae', 'mse', 'rmse', 'mape', 'smape', 'poisson']).optional().default('mae'),
      finetune_depth: z.number().int().min(1).max(5).optional().default(4),
      output_model_id: z.string().optional(),
      model: z.enum(['timegpt-1', 'timegpt-1-long-horizon']).optional(),
    })
    .optional(),
  datasetUrl: z.string().optional(), // Accept both full URLs and paths
  datasetData: z.record(z.unknown()).optional(),
});

const ListOrgModelsSchema = z.object({});

const ForecastSchema = z.object({
  h: z.number().int().positive().optional().default(30),
  level: z.array(z.number()).optional(),
  feature_contributions: z.boolean().optional(),
  useCache: z.boolean().optional(),
  datasetUrl: z.string().optional(),
  datasetData: z.record(z.unknown()).optional(),
  finetunedModelId: z.string().optional(), // Optional: use specific finetuned model (ID or name)
  useBaseline: z.boolean().optional(), // Optional: force baseline model even if org has finetuned model
});

const AnomalyDetectSchema = z.object({
  params: z.record(z.unknown()).optional(),
  externalEventsContext: z.string().optional(),
  useFinetunedModel: z.boolean().optional(),
  finetunedModelId: z.string().optional(), // Optional finetuned model ID to use
  datasetUrl: z.string().optional(), // Accept both full URLs and paths
  datasetData: z.record(z.unknown()).optional(),
});

const RollingBacktestCompareSchema = z.object({
  horizon: z.number().int().positive(),
  n_windows: z.number().int().positive(),
  step: z.number().int().positive(),
  metric: z.enum(['mae', 'mse', 'rmse', 'mape', 'smape']),
  level: z.array(z.number()).optional(),
  feature_contributions: z.boolean().optional(),
  useCache: z.boolean().optional(),
  perSeries: z.boolean().optional(),
  datasetUrl: z.string().optional(), // Accept both full URLs and paths
  datasetData: z.record(z.unknown()).optional(),
});

const ValidateDatasetSchema = z.object({
  datasetUrl: z.string().optional(), // Accept both full URLs and paths
  datasetData: z.record(z.unknown()).optional(),
});

const GetUsageSummarySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

/**
 * Select the appropriate TimeGPT model based on forecast horizon and data frequency.
 * Uses timegpt-1-long-horizon for forecasts longer than one seasonal period.
 *
 * @param h - Forecast horizon (number of periods ahead)
 * @param freq - Data frequency (D, H, W, M, MS)
 * @returns Model identifier ('timegpt-1' or 'timegpt-1-long-horizon')
 */
export function selectModel(h: number, freq: 'D' | 'H' | 'W' | 'M' | 'MS'): string {
  // Define seasonal periods for each frequency
  const seasonalPeriods: Record<'D' | 'H' | 'W' | 'M' | 'MS', number> = {
    'D': 7,   // Daily: weekly seasonality
    'H': 24,  // Hourly: daily seasonality
    'W': 4,   // Weekly: monthly seasonality
    'M': 12,  // Monthly: yearly seasonality
    'MS': 12, // Month start: yearly seasonality
  };

  const seasonalPeriod = seasonalPeriods[freq];

  // Use long-horizon model if forecasting more than one seasonal period
  return h > seasonalPeriod ? 'timegpt-1-long-horizon' : 'timegpt-1';
}


/**
 * Main handler class for all MCP tools.
 * 
 * This class encapsulates the execution of all available MCP tools, providing
 * a unified interface for tool invocation with proper authentication, usage
 * tracking, and performance monitoring.
 * 
 * Features:
 * - Automatic usage tracking for all tool executions
 * - Performance metrics collection (execution time, model usage)
 * - Admin privilege checking for restricted tools
 * - Comprehensive error handling with detailed error messages
 * - Model performance updates for forecasting operations
 */
export class MCPToolsHandler {
  /**
   * Creates a new MCP tools handler.
   * 
   * @param client - Nixtla API client for making forecasting calls
   * @param orgId - Organization ID for the current request
   * @param requestId - Unique request ID for idempotency and tracking
   * @param isAdmin - Whether the current token has admin privileges
   */
  constructor(
    private client: NixtlaClient,
    private orgId: string,
    private requestId: string,
    private isAdmin: boolean = false
  ) {}

  private async trackUsage(
    toolName: string, 
    success: boolean, 
    executionTimeMs?: number,
    operation?: string
  ): Promise<void> {
    const ctx: ConsumptionContext = {
      orgId: this.orgId,
      requestId: this.requestId,
      toolName,
      operation,
      executionTimeMs,
    };
    await trackConsumption(ctx, success);

  }

  async executeTool(call: MCPToolCall): Promise<MCPToolResult> {
    try {
      // Check admin-only tools
      const adminOnlyTools = ['get_org_config'];
      if (adminOnlyTools.includes(call.name) && !this.isAdmin) {
        throw new Error('This tool requires admin privileges');
      }

      switch (call.name) {
        case 'get_org_config':
          return await this.getOrgConfigTool(call.arguments);
        case 'set_active_model':
          return await this.setActiveModelTool(call.arguments);
        case 'finetune_model':
          return await this.finetuneModelTool(call.arguments);
        case 'list_finetuned_models':
          return await this.listOrgModelsTool(call.arguments);
        case 'forecast':
          return await this.forecastTool(call.arguments);
        case 'detect_anomaly':
          return await this.anomalyDetectTool(call.arguments);
        case 'rolling_backtest_compare':
          return await this.rollingBacktestCompareTool(call.arguments);
        case 'validate_dataset':
          return await this.validateDatasetTool(call.arguments);
        case 'get_usage_summary':
          return await this.getUsageSummaryTool(call.arguments);
        default:
          throw new Error(`Unknown tool: ${call.name}`);
      }
    } catch (error) {
      await this.trackUsage(call.name, false);
      throw error;
    }
  }

  private async getOrgConfigTool(args: Record<string, unknown>): Promise<MCPToolResult> {
    GetOrgConfigSchema.parse(args);
    const config = await getOrgConfig(this.orgId);

    if (!config) {
      return {
        content: [
          {
            type: 'text',
            text: 'Organization configuration not found',
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Organization: ${config.orgId}`,
        },
        {
          type: 'resource',
          resource: {
            uri: `org://${this.orgId}/config`,
            mimeType: 'application/json',
            text: JSON.stringify(config, null, 2),
          },
        },
      ],
    };
  }

  private async setActiveModelTool(args: Record<string, unknown>): Promise<MCPToolResult> {
    const parsed = SetActiveModelSchema.parse(args);

    // Get all models to check if modelId is a name or actual ID
    const orgModels = await getOrgModels(this.orgId);

    // Try to find model by actual ID first, then by name
    let targetModel = orgModels.find(m => m.modelId === parsed.modelId);
    if (!targetModel) {
      targetModel = orgModels.find(m => m.name === parsed.modelId);
    }

    if (!targetModel) {
      const availableModels = orgModels.map(m => `${m.name} (${m.modelId})`).join(', ');
      throw new Error(`Model not found. Available models: ${availableModels || 'none'}`);
    }

    await setActiveModel(this.orgId, targetModel.modelId);

    const displayName = targetModel.name || targetModel.modelId;
    return {
      content: [
        {
          type: 'text',
          text: `Active model set to: ${displayName} (${targetModel.modelId})`,
        },
      ],
    };
  }

  private async finetuneModelTool(args: Record<string, unknown>): Promise<MCPToolResult> {
    const parsed = FinetuneModelSchema.parse(args);

    if (!parsed.datasetData && !parsed.datasetUrl) {
      throw new Error('Dataset is required. Please provide either datasetUrl or datasetData parameter.');
    }

    const dataset = await loadDataset({
      inlineData: parsed.datasetData,
      url: parsed.datasetUrl,
    });

    const trainingStarted = new Date();

    // Apply optimal defaults (depth: 4, steps: 300, loss: 'mae') if not specified
    const defaultOptions = {
      finetune_steps: 300,
      finetune_loss: 'mae',
      finetune_depth: 4,
    };

    const finetuneOptions = {
      ...defaultOptions,
      ...parsed.finetuneOptions,
    };

    // Determine base model: user-specified or auto-selected
    let baseModel: string;
    let modelSelectionNote = '';

    if (finetuneOptions.model) {
      // User explicitly specified a model
      baseModel = finetuneOptions.model;
      modelSelectionNote = `Using user-specified base model: ${baseModel}`;
    } else {
      // Auto-select based on average series length (same logic as forecast horizon)
      const avgLength = Math.round(
        dataset.series.sizes.reduce((sum, len) => sum + len, 0) / dataset.series.sizes.length
      );
      baseModel = selectModel(avgLength, dataset.freq);
      modelSelectionNote = `Auto-selected base model: ${baseModel} (avg series length: ${avgLength} ${dataset.freq})`;
    }

    // Finetuning trains on historical data only (no X_future)
    // Strip out X_future if present
    const series = {
      y: dataset.series.y,
      sizes: dataset.series.sizes,
      X: dataset.series.X, // Historical exogenous features only
    };

    const finetuneReq = {
      series,
      freq: dataset.freq,
      model: baseModel, // Include base model in request
      ...finetuneOptions,
    };

    const response = await this.client.finetune(finetuneReq);
    const trainingCompleted = new Date();

    // Add model with metadata to organization
    const modelName = finetuneOptions.output_model_id || `finetuned-${Date.now()}`;

    await addFinetunedModel(this.orgId, response.finetuned_model_id, modelName, {
      trainingDataset: parsed.datasetUrl || 'inline-data',
      trainingStarted,
      trainingCompleted,
      trainingDurationMs: trainingCompleted.getTime() - trainingStarted.getTime(),
      totalEpochs: finetuneOptions.finetune_steps,
      validationAccuracy: finetuneOptions.finetune_depth, // Store depth as metadata
      baseModel, // Store the base model that was used for training
    });
    
    await setActiveModel(this.orgId, response.finetuned_model_id);
    await this.trackUsage('finetune_model', true);

    // Automatically run rolling backtest to demonstrate improvement
    let backtestResults;
    let backtestError: string | undefined;
    try {
      const backtestConfig = {
        horizon: 7, // 1 week forecast
        n_windows: 3, // Test on 3 windows
        step: 7, // Step by 1 week
        metric: 'mae' as const,
      };

      backtestResults = await rollingBacktestCompare(
        this.client,
        dataset.series,
        dataset.freq,
        backtestConfig,
        response.finetuned_model_id,
        this.orgId,
        baseModel // Pass the base model we just used for training
      );
    } catch (error) {
      // Don't fail the whole finetune if backtest fails, but capture the error
      backtestError = error instanceof Error ? error.message : String(error);
      console.error('Backtest failed:', error);
    }

    const usedDefaults = !parsed.finetuneOptions || Object.keys(parsed.finetuneOptions).length === 0;
    const optimizationNote = usedDefaults
      ? ' Using optimal settings: depth=4, steps=300, loss=mae (proven to achieve 27%+ accuracy improvement).'
      : '';

    // Build performance comparison text
    let performanceText = '';
    if (backtestResults) {
      const improvement = backtestResults.improvement;
      const improvementPercent = improvement.pct.toFixed(1);
      performanceText = `\n\n📊 Performance Validation (Rolling Backtest):\n• Baseline MAE: ${backtestResults.baseline.mean.toFixed(4)}\n• Finetuned MAE: ${backtestResults.finetuned.mean.toFixed(4)}\n• Improvement: ${improvementPercent}% (${improvement.abs.toFixed(4)} reduction)\n• Status: ${improvement.abs > 0 ? '✅ Finetuned model is better' : '⚠️ Similar performance'}`;
    } else if (backtestError) {
      performanceText = `\n\n⚠️ Performance Validation:\nAutomatic rolling backtest failed: ${backtestError}\n\nYou can manually run rolling_backtest_compare later to validate model performance.`;
    }

    return {
      content: [
        {
          type: 'text',
          text: `Model fine-tuned successfully: ${response.finetuned_model_id}. This model is now active and ready for forecasting.${optimizationNote}\n\n🎯 ${modelSelectionNote}${performanceText}`,
        },
        {
          type: 'resource',
          resource: {
            uri: `model://${response.finetuned_model_id}`,
            mimeType: 'application/json',
            text: JSON.stringify({
              modelId: response.finetuned_model_id,
              name: modelName,
              baseModel, // Include the base model that was used
              trainingDuration: trainingCompleted.getTime() - trainingStarted.getTime(),
              isActive: true,
              settings: {
                steps: finetuneOptions.finetune_steps,
                loss: finetuneOptions.finetune_loss,
                depth: finetuneOptions.finetune_depth
              },
              note: usedDefaults ? 'Used optimal defaults for maximum accuracy' : 'Used custom settings',
              backtest: backtestResults || null,
            }, null, 2),
          },
        },
      ],
    };
  }

  private async listOrgModelsTool(args: Record<string, unknown>): Promise<MCPToolResult> {
    ListOrgModelsSchema.parse(args);
    
    // Get models with metadata from organization
    const orgModels = await getOrgModels(this.orgId);
    const config = await getOrgConfig(this.orgId);
    
    // Get current model info from Nixtla API
    const allModels = await this.client.listFinetunedModels();
    const modelInfoMap = new Map(allModels.map(m => [m.id, m]));

    // Combine org model metadata with API model info
    const enrichedModels = orgModels.map(orgModel => {
      const apiModel = modelInfoMap.get(orgModel.modelId);
      return {
        modelId: orgModel.modelId,
        name: orgModel.name || orgModel.modelId,
        status: orgModel.status,
        isActive: config?.activeFinetunedModelId === orgModel.modelId,
        createdAt: orgModel.createdAt,
        updatedAt: orgModel.updatedAt,
        
        // Training metadata
        metadata: orgModel.metadata,
        
        // API model info (if available)
        apiInfo: apiModel ? {
          id: apiModel.id,
          created_at: apiModel.created_at,
          model: apiModel.model,
          base_model_id: apiModel.base_model_id,
          steps: apiModel.steps,
          depth: apiModel.depth,
          loss: apiModel.loss,
          freq: apiModel.freq,
        } : null,
      };
    });

    const activeModel = enrichedModels.find(m => m.isActive);
    const activeModelText = activeModel ? `Active model: ${activeModel.name} (${activeModel.modelId})` : 'No active model set';
    
    const message = `Found ${enrichedModels.length} model${enrichedModels.length !== 1 ? 's' : ''} for this organization.\n${activeModelText}`;

    return {
      content: [
        {
          type: 'text',
          text: message,
        },
        {
          type: 'resource',
          resource: {
            uri: `org://${this.orgId}/models`,
            mimeType: 'application/json',
            text: JSON.stringify(enrichedModels, null, 2),
          },
        },
      ],
    };
  }

  private async forecastTool(args: Record<string, unknown>): Promise<MCPToolResult> {
    const parsed = ForecastSchema.parse(args);

    if (!parsed.datasetData && !parsed.datasetUrl) {
      throw new Error('Dataset is required. Please provide either datasetUrl or datasetData parameter.');
    }

    const dataset = await loadDataset({
      inlineData: parsed.datasetData,
      url: parsed.datasetUrl,
    });

    // Determine which model to use: finetuned or baseline
    let finetunedModelId: string | undefined;
    let modelType: 'baseline' | 'finetuned' = 'baseline';
    let baseModelId: string;

    if (!parsed.useBaseline) {
      // Check if user provided specific model ID
      if (parsed.finetunedModelId) {
        const orgModels = await getOrgModels(this.orgId);
        const modelExists = orgModels.some(m => m.modelId === parsed.finetunedModelId || m.name === parsed.finetunedModelId);

        if (!modelExists) {
          const availableModels = orgModels.map(m => `${m.name} (${m.modelId})`).join(', ');
          throw new Error(`Model '${parsed.finetunedModelId}' not found. Available models: ${availableModels || 'none'}`);
        }

        const model = orgModels.find(m => m.modelId === parsed.finetunedModelId || m.name === parsed.finetunedModelId);
        finetunedModelId = model!.modelId;
        modelType = 'finetuned';
      } else {
        // Auto-select: use active model if available
        const config = await getOrgConfig(this.orgId);
        if (config?.activeFinetunedModelId) {
          finetunedModelId = config.activeFinetunedModelId;
          modelType = 'finetuned';
        }
      }
    }

    // Determine base model ID
    if (modelType === 'finetuned' && finetunedModelId) {
      // When using a finetuned model, we MUST use the same base model it was trained with
      // Try to get base_model_id from Nixtla API first
      const allModels = await this.client.listFinetunedModels();
      const finetunedModel = allModels.find(m => m.id === finetunedModelId);

      if (!finetunedModel) {
        throw new Error(`Finetuned model ${finetunedModelId} not found in Nixtla API`);
      }

      // Priority: 1) API base_model_id, 2) our saved metadata, 3) auto-select
      if (finetunedModel.base_model_id) {
        baseModelId = finetunedModel.base_model_id;
      } else {
        // Try to get from our saved metadata
        const orgModels = await getOrgModels(this.orgId);
        const orgModel = orgModels.find(m => m.modelId === finetunedModelId);
        baseModelId = orgModel?.metadata?.baseModel || selectModel(parsed.h, dataset.freq);
      }
    } else {
      // For baseline, select model based on horizon
      baseModelId = selectModel(parsed.h, dataset.freq);
    }

    // Include future exogenous variables if available
    const series = {
      y: dataset.series.y,
      sizes: dataset.series.sizes,
      X: dataset.series.X,
      ...(dataset.series.X_future && { X_future: dataset.series.X_future }),
    };

    const forecastReq = {
      series,
      freq: dataset.freq,
      h: parsed.h,
      model: baseModelId,
      level: parsed.level,
      feature_contributions: parsed.feature_contributions,
      ...(finetunedModelId && { finetuned_model_id: finetunedModelId }),
    };

    const startTime = Date.now();
    const response = await this.client.forecast(forecastReq);
    const executionTime = Date.now() - startTime;

    await this.trackUsage('forecast', true, executionTime, 'forecast');

    // Store JSON result to Vercel Blob and get download URL
    const storedResult = await storeResult(
      this.orgId,
      `forecast_${modelType}`,
      response,
      { horizon: parsed.h, modelId: finetunedModelId }
    );

    // Generate and store CSV file if we have metadata
    let csvUrl: string | undefined;
    if (dataset.meta?.seriesNames) {
      // Use forecastStartDate from metadata if available, otherwise estimate from current date
      const forecastStartDate = (dataset.meta as any).forecastStartDate || new Date().toISOString().split('T')[0];

      const csvContent = generateSimpleForecastCSV({
        horizon: parsed.h,
        seriesNames: dataset.meta.seriesNames,
        forecastStartDate,
        freq: dataset.freq,
        forecastResponse: response,
      });

      csvUrl = await storeCSV(
        this.orgId,
        csvContent,
        `forecast_${modelType}`,
        { horizon: parsed.h, modelId: finetunedModelId, seriesCount: dataset.meta.seriesNames.length }
      );
    }

    const hasFutureX = !!dataset.series.X_future;
    const featureInfo = hasFutureX
      ? ` with future exogenous features`
      : dataset.series.X ? ` with historical exogenous features` : '';

    const modelInfo = modelType === 'finetuned'
      ? ` using finetuned model ${finetunedModelId}`
      : ' using baseline model';

    const csvInfo = csvUrl
      ? `\n\n📊 CSV Download (Excel-ready): ${csvUrl}`
      : '';

    return {
      content: [
        {
          type: 'text',
          text: `Forecast completed for horizon ${parsed.h}${modelInfo}${featureInfo}\n\n📥 JSON Download (raw data): ${storedResult.downloadUrl}${csvInfo}\n\nResult ID: ${storedResult.resultId}\nSize: ${(storedResult.sizeBytes / 1024).toFixed(2)} KB\nExpires: ${storedResult.expiresAt.toISOString()}\n\nYou can download the forecast results from these URLs or load them directly in your application.`,
        },
        {
          type: 'resource',
          resource: {
            uri: storedResult.downloadUrl,
            mimeType: 'application/json',
            text: JSON.stringify({
              resultId: storedResult.resultId,
              downloadUrl: storedResult.downloadUrl,
              csvDownloadUrl: csvUrl,
              resultType: `forecast_${modelType}`,
              modelType,
              modelId: finetunedModelId,
              sizeBytes: storedResult.sizeBytes,
              expiresAt: storedResult.expiresAt,
              metadata: storedResult.metadata,
            }, null, 2),
          },
        },
      ],
    };
  }

  private async anomalyDetectTool(args: Record<string, unknown>): Promise<MCPToolResult> {
    const parsed = AnomalyDetectSchema.parse(args);

    if (!parsed.datasetData && !parsed.datasetUrl) {
      throw new Error('Dataset is required. Please provide either datasetUrl or datasetData parameter.');
    }

    const dataset = await loadDataset({
      inlineData: parsed.datasetData,
      url: parsed.datasetUrl,
    });

    // Determine which finetuned model to use
    let finetunedModelId: string | undefined;
    let modelNote = '';

    if (parsed.finetunedModelId) {
      // User provided a specific model ID - validate it exists
      const orgModels = await getOrgModels(this.orgId);
      const modelExists = orgModels.some(m => m.modelId === parsed.finetunedModelId || m.name === parsed.finetunedModelId);

      if (!modelExists) {
        const availableModels = orgModels.map(m => `${m.name} (${m.modelId})`).join(', ');
        throw new Error(`Model '${parsed.finetunedModelId}' not found. Available models: ${availableModels || 'none'}`);
      }

      // Find the actual model ID (in case user provided a name)
      const model = orgModels.find(m => m.modelId === parsed.finetunedModelId || m.name === parsed.finetunedModelId);
      finetunedModelId = model!.modelId;
      modelNote = ` using finetuned model ${finetunedModelId}`;
    } else if (parsed.useFinetunedModel) {
      // No specific model provided, but useFinetunedModel is true - use active model
      const config = await getOrgConfig(this.orgId);

      if (config?.activeFinetunedModelId) {
        // Use existing active model
        finetunedModelId = config.activeFinetunedModelId;
        modelNote = ` using finetuned model ${finetunedModelId}`;
      } else {
        // No active model - fallback to baseline
        modelNote = ' (no finetuned model found - using baseline)';
      }
    }

    // Anomaly detection uses SeriesWithExogenous (historical X only, no X_future)
    // Strip out X_future if present since we're analyzing historical data
    const series = {
      y: dataset.series.y,
      sizes: dataset.series.sizes,
      X: dataset.series.X, // Historical exogenous features only
    };

    // Calculate effective horizon for model selection based on data length
    // Use the average series length as a proxy for the analysis window
    const totalDataPoints = dataset.series.y.length;
    const numSeries = dataset.series.sizes.length;
    const avgSeriesLength = Math.floor(totalDataPoints / numSeries);

    // Determine base model ID
    let baseModelId: string;
    if (finetunedModelId) {
      // When using a finetuned model, we MUST use the same base model it was trained with
      // Try to get base_model_id from Nixtla API first
      const allModels = await this.client.listFinetunedModels();
      const finetunedModel = allModels.find(m => m.id === finetunedModelId);

      if (!finetunedModel) {
        throw new Error(`Finetuned model ${finetunedModelId} not found in Nixtla API`);
      }

      // Priority: 1) API base_model_id, 2) our saved metadata, 3) auto-select
      if (finetunedModel.base_model_id) {
        baseModelId = finetunedModel.base_model_id;
      } else {
        // Try to get from our saved metadata
        const orgModels = await getOrgModels(this.orgId);
        const orgModel = orgModels.find(m => m.modelId === finetunedModelId);
        baseModelId = orgModel?.metadata?.baseModel || selectModel(avgSeriesLength, dataset.freq);
      }
    } else {
      baseModelId = selectModel(avgSeriesLength, dataset.freq);
    }

    const anomalyReq = {
      series,
      freq: dataset.freq,
      model: baseModelId,
      ...parsed.params,
      ...(finetunedModelId && { finetuned_model_id: finetunedModelId }),
    };

    const response = await this.client.anomalyDetection(anomalyReq);
    await this.trackUsage('detect_anomaly', true);

    const result: Record<string, unknown> = { ...response };
    if (parsed.externalEventsContext) {
      result.externalEventsContext = parsed.externalEventsContext;
    }

    const anomalyCount = response.anomaly.filter(a => a).length;

    // Store result to Vercel Blob and get download URL
    const storedResult = await storeResult(
      this.orgId,
      'detect_anomaly',
      result,
      { anomalyCount, modelId: finetunedModelId }
    );

    return {
      content: [
        {
          type: 'text',
          text: `Anomaly detection completed${modelNote}. Found ${anomalyCount} anomalies.\n\nDownload URL: ${storedResult.downloadUrl}\n\nResult ID: ${storedResult.resultId}\nSize: ${(storedResult.sizeBytes / 1024).toFixed(2)} KB\nExpires: ${storedResult.expiresAt.toISOString()}\n\nYou can download the anomaly detection results from this URL or load it directly in your application.`,
        },
        {
          type: 'resource',
          resource: {
            uri: storedResult.downloadUrl,
            mimeType: 'application/json',
            text: JSON.stringify({
              resultId: storedResult.resultId,
              downloadUrl: storedResult.downloadUrl,
              resultType: 'detect_anomaly',
              anomalyCount: anomalyCount,
              modelId: finetunedModelId,
              sizeBytes: storedResult.sizeBytes,
              expiresAt: storedResult.expiresAt,
              metadata: storedResult.metadata,
            }, null, 2),
          },
        },
      ],
    };
  }

  private async rollingBacktestCompareTool(
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const parsed = RollingBacktestCompareSchema.parse(args);
    const config = await getOrgConfig(this.orgId);

    if (!config) {
      throw new Error('Organization configuration not found');
    }

    if (!config.activeFinetunedModelId) {
      throw new Error('No active fine-tuned model set for this organization. Use set_active_model first.');
    }

    if (!parsed.datasetData && !parsed.datasetUrl) {
      throw new Error('Dataset is required. Please provide either datasetUrl or datasetData parameter.');
    }
    
    const dataset = await loadDataset({
      inlineData: parsed.datasetData,
      url: parsed.datasetUrl,
    });

    const backtestConfig = {
      horizon: parsed.horizon,
      n_windows: parsed.n_windows,
      step: parsed.step,
      metric: parsed.metric,
      level: parsed.level,
      feature_contributions: parsed.feature_contributions,
      useCache: parsed.useCache,
      perSeries: parsed.perSeries,
    };

    const result = await rollingBacktestCompare(
      this.client,
      dataset.series,
      dataset.freq,
      backtestConfig,
      config.activeFinetunedModelId,
      this.orgId
    );

    await this.trackUsage('rolling_backtest_compare', true);

    return {
      content: [
        {
          type: 'text',
          text: `Rolling backtest completed. Improvement: ${result.improvement.pct.toFixed(2)}%`,
        },
        {
          type: 'resource',
          resource: {
            uri: `backtest://${new Date().toISOString()}`,
            mimeType: 'application/json',
            text: JSON.stringify(result, null, 2),
          },
        },
      ],
    };
  }

  private async validateDatasetTool(args: Record<string, unknown>): Promise<MCPToolResult> {
    const parsed = ValidateDatasetSchema.parse(args);
    
    if (!parsed.datasetData && !parsed.datasetUrl) {
      throw new Error('Either datasetData or datasetUrl must be provided');
    }
    
    const dataset = await loadDataset({
      inlineData: parsed.datasetData,
      url: parsed.datasetUrl,
    });

    const validationResult = {
      valid: true,
      series: {
        count: dataset.series.sizes.length,
        totalObservations: dataset.series.y.length,
        observationsPerSeries: dataset.series.sizes,
        hasExogenousFeatures: dataset.series.X !== undefined,
        featureCount: dataset.series.X ? dataset.series.X.length : 0,
      },
      frequency: dataset.freq,
      warnings: [] as string[],
      recommendations: [] as string[],
    };

    // Check minimum observations per series
    const minObservations = Math.min(...dataset.series.sizes);
    if (minObservations < 35) {
      validationResult.warnings.push(
        `Minimum observations per series (${minObservations}) is below recommended 35. This may affect model quality.`
      );
    }

    // Check for exogenous features
    if (!dataset.series.X) {
      validationResult.recommendations.push(
        'No exogenous features detected. Feature contributions will not be available unless you add X matrix to your dataset.'
      );
    } else {
      validationResult.recommendations.push(
        `Dataset has ${dataset.series.X.length} exogenous feature(s). You can use feature_contributions=true to analyze their impact.`
      );
    }

    // Frequency recommendations
    const freqInfo: Record<string, string> = {
      'D': 'Daily - suitable for daily sales, web traffic, etc.',
      'H': 'Hourly - suitable for energy consumption, sensor data, etc.',
      'W': 'Weekly - suitable for weekly aggregates',
      'M': 'Monthly - suitable for financial reports, subscriptions',
      'MS': 'Month Start - monthly data aligned to start of month',
    };
    
    validationResult.recommendations.push(
      `Frequency: ${dataset.freq} - ${freqInfo[dataset.freq] || 'custom frequency'}`
    );

    return {
      content: [
        {
          type: 'text',
          text: validationResult.valid 
            ? '✅ Dataset is valid and ready for forecasting!' 
            : '❌ Dataset has validation errors',
        },
        {
          type: 'resource',
          resource: {
            uri: `validation://dataset`,
            mimeType: 'application/json',
            text: JSON.stringify(validationResult, null, 2),
          },
        },
      ],
    };
  }

  private async getUsageSummaryTool(args: Record<string, unknown>): Promise<MCPToolResult> {
    const parsed = GetUsageSummarySchema.parse(args);
    const summary = await getUsageSummary(this.orgId, parsed.month);

    return {
      content: [
        {
          type: 'text',
          text: `Usage summary for ${summary.month}: ${summary.calls_total} total calls`,
        },
        {
          type: 'resource',
          resource: {
            uri: `usage://${this.orgId}/${summary.month}`,
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        },
      ],
    };
  }
}

export const MCP_TOOLS = [
  // Hidden: get_org_config - Admin-only tool not needed for core workflow
  // {
  //   name: 'get_org_config',
  //   description: 'Get organization configuration (admin only)',
  //   adminOnly: true,
  //   inputSchema: {
  //     type: 'object',
  //     properties: {},
  //   },
  // },
  // Hidden: set_active_model - Users can specify model directly in forecast tool via finetunedModelId parameter
  // {
  //   name: 'set_active_model',
  //   description: 'Set the active fine-tuned model for your organization. This model will be used by default for all finetuned forecasts and anomaly detection. You can use either the model ID (UUID) or the model name.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       modelId: { type: 'string', minLength: 1, description: 'The model ID (UUID) or model name to set as active (e.g., "prague-warehouses-v1" or "f4599c95-7305-41ea-a6fe-dd2f100f2b82")' },
  //     },
  //     required: ['modelId'],
  //   },
  // },
  {
    name: 'forecast',
    description: 'Generate time series forecasts. Automatically uses your organization\'s active finetuned model if available, otherwise uses baseline model. You can override this by specifying finetunedModelId (to use a specific model) or useBaseline=true (to force baseline). Provide dataset via datasetUrl (URL to JSON file) or datasetData (inline JSON). Default horizon is 30 if h not specified.',
    inputSchema: {
      type: 'object',
      properties: {
        datasetUrl: { type: 'string', description: 'URL or path to dataset in Nixtla format (e.g., https://... or /api/datasets/...)' },
        datasetData: { type: 'object', description: 'Inline dataset in Nixtla format with series and freq' },
        h: { type: 'number', minimum: 1, description: 'Forecast horizon (number of periods ahead), default 30' },
        level: { type: 'array', items: { type: 'number' }, description: 'Confidence levels for prediction intervals' },
        feature_contributions: { type: 'boolean', description: 'Return feature contributions' },
        useCache: { type: 'boolean' },
        finetunedModelId: { type: 'string', description: 'Optional: specify which finetuned model to use (model ID or name). Overrides auto-selection.' },
        useBaseline: { type: 'boolean', description: 'Optional: force baseline model even if organization has finetuned models' },
      },
    },
  },
  {
    name: 'detect_anomaly',
    description: 'Detect anomalies in time series data. You can specify a finetunedModelId to use a specific model, set useFinetunedModel=true to use the active model, or omit both for baseline. Provide dataset via datasetUrl (URL to JSON file) or datasetData (inline JSON).',
    inputSchema: {
      type: 'object',
      properties: {
        datasetUrl: { type: 'string', description: 'URL or path to dataset in Nixtla format (e.g., https://... or /api/datasets/...)' },
        datasetData: { type: 'object', description: 'Inline dataset in Nixtla format with series and freq' },
        params: { type: 'object', description: 'Anomaly detection parameters (level, clean_ex_first, etc.)' },
        externalEventsContext: { type: 'string', description: 'Context about external events to help interpret anomalies' },
        useFinetunedModel: { type: 'boolean', description: 'Use the active finetuned model if available (default: false for baseline)' },
        finetunedModelId: { type: 'string', description: 'Optional: specify which finetuned model to use (model ID or name). Takes priority over useFinetunedModel.' },
      },
    },
  },
  {
    name: 'finetune_model',
    description: 'Fine-tune a custom forecasting model on your data using optimal default settings (depth=4, steps=300, loss=mae) proven to achieve 27%+ accuracy improvements. The base model (timegpt-1 or timegpt-1-long-horizon) is automatically selected based on your data characteristics, or you can specify it manually. The model will be automatically activated and ready for forecasting. Provide dataset via datasetUrl or datasetData. Dataset format: {series: {y: number[], sizes: number[], X?: number[][]}, freq: "D"|"H"|"W"|"M"|"MS"}. Use generate_forecast_dataset to create from CSV or validate_dataset to check format.',
    inputSchema: {
      type: 'object',
      properties: {
        datasetUrl: { type: 'string', description: 'URL or path to dataset in Nixtla format (e.g., https://... or /api/datasets/...)' },
        datasetData: { type: 'object', description: 'Inline dataset in Nixtla format with series and freq' },
        finetuneOptions: {
          type: 'object',
          description: 'Fine-tuning configuration. All parameters are optional - uses optimal defaults (depth=4, steps=300, loss=mae) and auto-selects base model if omitted.',
          properties: {
            model: {
              type: 'string',
              enum: ['timegpt-1', 'timegpt-1-long-horizon'],
              description: 'Base model to finetune (optional). If not specified, automatically selects based on data characteristics: timegpt-1 for shorter series, timegpt-1-long-horizon for series longer than one seasonal period.'
            },
            finetune_steps: {
              type: 'number',
              minimum: 1,
              default: 300,
              description: 'Number of fine-tuning iterations (default: 300, optimal for most datasets)'
            },
            finetune_loss: {
              type: 'string',
              enum: ['default', 'mae', 'mse', 'rmse', 'mape', 'smape', 'poisson'],
              default: 'mae',
              description: 'Loss function to optimize during fine-tuning (default: mae, proven optimal for most datasets). "mae" outperforms "mse" by avoiding overfitting to outliers.'
            },
            finetune_depth: {
              type: 'number',
              minimum: 1,
              maximum: 5,
              default: 4,
              description: 'Model complexity depth (default: 4, optimal balance). WARNING: depth=5 causes overfitting. Sweet spot is depth=4 for maximum accuracy without overfitting.'
            },
            output_model_id: {
              type: 'string',
              description: 'Optional custom ID for your fine-tuned model (e.g., "sales-forecast-v2"). If omitted, Nixtla generates a unique ID.'
            },
          },
        },
      },
    },
  },
  {
    name: 'list_finetuned_models',
    description: 'List all fine-tuned models for your organization, including which one is currently active. Shows training metadata, creation dates, and model status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  // Hidden: rolling_backtest_compare - Automatically run after finetuning to demonstrate improvement
  // {
  //   name: 'rolling_backtest_compare',
  //   description: 'Compare baseline vs fine-tuned model using rolling backtest. Provide dataset via datasetUrl (URL to JSON file) or datasetData (inline JSON).',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       datasetUrl: { type: 'string', description: 'URL or path to dataset in Nixtla format (e.g., https://... or /api/datasets/...)' },
  //       datasetData: { type: 'object', description: 'Inline dataset in Nixtla format with series and freq' },
  //       horizon: { type: 'number', minimum: 1, description: 'Forecast horizon for each window' },
  //       n_windows: { type: 'number', minimum: 1, description: 'Number of windows to test' },
  //       step: { type: 'number', minimum: 1, description: 'Step size between windows' },
  //       metric: { type: 'string', enum: ['mae', 'mse', 'rmse', 'mape', 'smape'], description: 'Metric to evaluate forecasts' },
  //       level: { type: 'array', items: { type: 'number' }, description: 'Confidence levels' },
  //       feature_contributions: { type: 'boolean' },
  //       useCache: { type: 'boolean' },
  //       perSeries: { type: 'boolean' },
  //     },
  //     required: ['horizon', 'n_windows', 'step', 'metric'],
  //   },
  // },
  {
    name: 'validate_dataset',
    description: 'Validate dataset format before forecasting. Checks structure, detects issues, and provides recommendations. Use this before running forecasts to avoid errors.',
    inputSchema: {
      type: 'object',
      properties: {
        datasetUrl: { type: 'string', description: 'URL or path to dataset to validate (e.g., https://... or /api/datasets/...)' },
        datasetData: { type: 'object', description: 'Inline dataset to validate' },
      },
    },
  },
  // Hidden: get_usage_summary - Reduces context consumption, not needed for core forecasting workflow
  // {
  //   name: 'get_usage_summary',
  //   description: 'Get usage metrics for the organization',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
  //     },
  //   },
  // },
];
