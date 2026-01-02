const EPSILON = 1e-10;

export type MetricType = 'mae' | 'mse' | 'rmse' | 'mape' | 'smape';

export function computeMetric(
  actual: number[],
  predicted: number[],
  metric: MetricType
): number {
  if (actual.length !== predicted.length) {
    throw new Error('Actual and predicted arrays must have the same length');
  }

  if (actual.length === 0) {
    return 0;
  }

  switch (metric) {
    case 'mae':
      return computeMAE(actual, predicted);
    case 'mse':
      return computeMSE(actual, predicted);
    case 'rmse':
      return computeRMSE(actual, predicted);
    case 'mape':
      return computeMAPE(actual, predicted);
    case 'smape':
      return computeSMAPE(actual, predicted);
    default:
      throw new Error(`Unknown metric: ${metric}`);
  }
}

export function computeMAE(actual: number[], predicted: number[]): number {
  let sum = 0;

  for (let i = 0; i < actual.length; i++) {
    sum += Math.abs(actual[i] - predicted[i]);
  }

  return sum / actual.length;
}

export function computeMSE(actual: number[], predicted: number[]): number {
  let sum = 0;

  for (let i = 0; i < actual.length; i++) {
    const diff = actual[i] - predicted[i];
    sum += diff * diff;
  }

  return sum / actual.length;
}

export function computeSMAPE(actual: number[], predicted: number[]): number {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const p = predicted[i];
    const numerator = Math.abs(p - a);
    const denominator = (Math.abs(a) + Math.abs(p)) / 2;

    if (denominator > EPSILON) {
      sum += numerator / denominator;
      count++;
    }
  }

  return count > 0 ? (sum / count) * 100 : 0;
}

export function computeMAPE(actual: number[], predicted: number[]): number {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const p = predicted[i];

    if (Math.abs(a) > EPSILON) {
      sum += Math.abs((a - p) / a);
      count++;
    }
  }

  return count > 0 ? (sum / count) * 100 : 0;
}

export function computeRMSE(actual: number[], predicted: number[]): number {
  let sum = 0;

  for (let i = 0; i < actual.length; i++) {
    const diff = actual[i] - predicted[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum / actual.length);
}

export function aggregateMetrics(values: number[]): {
  mean: number;
  median: number;
  std: number;
} {
  if (values.length === 0) {
    return { mean: 0, median: 0, std: 0 };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  const sorted = [...values].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    values.length;
  const std = Math.sqrt(variance);

  return { mean, median, std };
}
