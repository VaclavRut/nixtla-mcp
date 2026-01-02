import type { NixtlaSeries } from '../nixtla/types.js';
import type { NixtlaClient } from '../nixtla/client.js';
import { reconstructPerSeries, concatenateSeries } from '../data/multiseries.js';
import { computeMetric, aggregateMetrics, type MetricType } from '../metrics/metrics.js';
import { selectModel } from '../mcp/tools.js';

export interface RollingBacktestConfig {
  horizon: number;
  n_windows: number;
  step: number;
  metric: MetricType;
  level?: number[];
  feature_contributions?: boolean;
  useCache?: boolean;
  perSeries?: boolean;
}

export interface WindowResult {
  windowIndex: number;
  baselineMetric: number;
  finetunedMetric: number;
  trainEndIndex: number;
}

export interface RollingBacktestResult {
  configUsed: {
    orgId: string;
    horizon: number;
    n_windows: number;
    step: number;
    metric: MetricType;
    modelId?: string;
  };
  baseline: {
    mean: number;
    median: number;
    std: number;
    perWindow: number[];
  };
  finetuned: {
    mean: number;
    median: number;
    std: number;
    perWindow: number[];
  };
  improvement: {
    abs: number;
    pct: number;
  };
  notes: string[];
}

export async function rollingBacktestCompare(
  client: NixtlaClient,
  dataset: NixtlaSeries,
  freq: 'D' | 'H' | 'W' | 'M' | 'MS',
  config: RollingBacktestConfig,
  finetunedModelId: string | undefined,
  orgId: string,
  finetunedBaseModel?: string
): Promise<RollingBacktestResult> {
  const { horizon, n_windows, step, metric } = config;
  const yLen = dataset.y.length;

  if (yLen < horizon) {
    throw new Error(`Dataset too short: ${yLen} < horizon ${horizon}`);
  }

  const perSeries = reconstructPerSeries(dataset);
  const minSeriesLength = Math.min(...perSeries.map(s => s.y.length));

  // Calculate minimum required length for at least one window
  // First window needs: horizon (training) + horizon (testing) = 2 * horizon
  const minRequiredLength = 2 * horizon;
  
  if (minSeriesLength < minRequiredLength) {
    throw new Error(
      `Shortest series (${minSeriesLength}) is too short for rolling backtest. ` +
      `Requires at least ${minRequiredLength} observations (2x horizon of ${horizon}) ` +
      `to run validation windows.`
    );
  }

  // Determine base model IDs
  let baselineModelId = selectModel(horizon, freq);
  let finetunedBaseModelId = baselineModelId;

  if (finetunedModelId) {
    // If finetunedBaseModel was provided (e.g., from finetune operation), use it directly
    if (finetunedBaseModel) {
      finetunedBaseModelId = finetunedBaseModel;
    } else {
      // Otherwise, fetch from Nixtla API and fall back to auto-select if needed
      const allModels = await client.listFinetunedModels();
      const finetunedModel = allModels.find(m => m.id === finetunedModelId);

      if (!finetunedModel) {
        throw new Error(`Finetuned model ${finetunedModelId} not found in Nixtla API`);
      }

      // Use base_model_id if available, otherwise fall back to baseline model
      finetunedBaseModelId = finetunedModel.base_model_id || baselineModelId;
    }
  }

  const baselineMetrics: number[] = [];
  const finetunedMetrics: number[] = [];
  const windowResults: WindowResult[] = [];

  // Rolling window moves FORWARD in time (standard time series cross-validation)
  // Window 0: train on earliest data, test on next horizon
  // Window 1: train on more data (expanding window), test on next horizon
  // etc.
  for (let i = 0; i < n_windows; i++) {
    // Start from minimum training size (horizon) and expand forward
    const trainEndT = horizon + (i * step);

    // Stop when we don't have enough data for both training and testing
    if (trainEndT + horizon > minSeriesLength) {
      break;
    }

    const trainSeries: typeof perSeries = [];
    const holdoutActuals: number[] = [];

    // Collect X_future for exogenous forecasting (if applicable)
    const futureXData: number[][][] = [];

    for (const series of perSeries) {
      const trainY = series.y.slice(0, trainEndT);
      const trainX = series.X ? series.X.slice(0, trainEndT) : undefined;

      // Extract future exogenous features for the forecast horizon
      const X_future = series.X ? series.X.slice(trainEndT, trainEndT + horizon) : undefined;

      trainSeries.push({ y: trainY, X: trainX });
      if (X_future) {
        futureXData.push(X_future);
      }

      const holdoutY = series.y.slice(trainEndT, trainEndT + horizon);
      holdoutActuals.push(...holdoutY);
    }

    const trainPayload = concatenateSeries(trainSeries);

    // Prepare X_future in the correct format if available
    // X_future must be inside the series object per SeriesWithFutureExogenous schema
    let X_future: number[][] | undefined;
    if (futureXData.length > 0 && futureXData[0].length > 0) {
      const nFeatures = futureXData[0][0].length;

      // Convert from per-series format to concatenated [n_features, n_observations] format
      X_future = Array(nFeatures).fill(null).map(() => []);
      for (const seriesFuture of futureXData) {
        for (let t = 0; t < seriesFuture.length; t++) {
          for (let f = 0; f < nFeatures; f++) {
            (X_future[f] as number[]).push(seriesFuture[t][f]);
          }
        }
      }
    }

    // Build series object with X_future inside (if available)
    const seriesWithFuture = {
      ...trainPayload,
      ...(X_future && { X_future }),
    };

    const baselineReq = {
      series: seriesWithFuture,
      freq,
      h: horizon,
      model: baselineModelId,
      level: config.level,
      feature_contributions: config.feature_contributions,
    };

    const baselineRes = await client.forecast(baselineReq);
    const baselineMetric = computeMetric(
      holdoutActuals,
      baselineRes.mean,
      metric
    );
    baselineMetrics.push(baselineMetric);

    let finetunedMetric = baselineMetric;
    if (finetunedModelId) {
      const finetunedReq = {
        series: seriesWithFuture,
        freq,
        h: horizon,
        model: finetunedBaseModelId,
        level: config.level,
        feature_contributions: config.feature_contributions,
        finetuned_model_id: finetunedModelId,
      };
      const finetunedRes = await client.forecast(finetunedReq);
      finetunedMetric = computeMetric(
        holdoutActuals,
        finetunedRes.mean,
        metric
      );
      finetunedMetrics.push(finetunedMetric);
    } else {
      finetunedMetrics.push(baselineMetric);
    }

    windowResults.push({
      windowIndex: i,
      baselineMetric,
      finetunedMetric,
      trainEndIndex: trainEndT,
    });
  }

  const baselineAgg = aggregateMetrics(baselineMetrics);
  const finetunedAgg = aggregateMetrics(finetunedMetrics);

  const improvement = {
    abs: baselineAgg.mean - finetunedAgg.mean,
    pct:
      baselineAgg.mean > 0
        ? ((baselineAgg.mean - finetunedAgg.mean) / baselineAgg.mean) * 100
        : 0,
  };

  return {
    configUsed: {
      orgId,
      horizon,
      n_windows: windowResults.length,
      step,
      metric,
      modelId: finetunedModelId,
    },
    baseline: {
      mean: baselineAgg.mean,
      median: baselineAgg.median,
      std: baselineAgg.std,
      perWindow: baselineMetrics,
    },
    finetuned: {
      mean: finetunedAgg.mean,
      median: finetunedAgg.median,
      std: finetunedAgg.std,
      perWindow: finetunedMetrics,
    },
    improvement,
    notes: [
      'Lower is better for all metrics',
      `Metric computed on holdout targets across ${windowResults.length} windows`,
      `${metric.toUpperCase()} used for evaluation`,
      'Rolling windows move forward in time (expanding window approach)',
      'Each window trains on progressively more historical data',
    ],
  };
}
