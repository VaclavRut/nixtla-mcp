import type { NixtlaSeries } from '../nixtla/types.js';

export interface DatasetValidationResult {
  valid: boolean;
  errors: string[];
  nSeries: number;
  yLen: number;
  nFeatures: number;
}

export function validateNixtlaSeries(
  series: NixtlaSeries
): DatasetValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(series.y)) {
    errors.push('series.y must be an array');
  }

  if (!Array.isArray(series.sizes)) {
    errors.push('series.sizes must be an array');
  }

  if (series.X !== undefined && !Array.isArray(series.X)) {
    errors.push('series.X must be an array if provided');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      nSeries: 0,
      yLen: 0,
      nFeatures: 0,
    };
  }

  const yLen = series.y.length;
  const nSeries = series.sizes.length;
  const sumSizes = series.sizes.reduce((sum, s) => sum + s, 0);

  if (sumSizes !== yLen) {
    errors.push(
      `Sum of sizes (${sumSizes}) must equal y.length (${yLen})`
    );
  }

  for (let i = 0; i < series.sizes.length; i++) {
    if (!Number.isFinite(series.sizes[i]) || series.sizes[i] <= 0) {
      errors.push(`sizes[${i}] must be a positive finite number`);
    }
  }

  for (let i = 0; i < series.y.length; i++) {
    if (!Number.isFinite(series.y[i])) {
      errors.push(`y[${i}] must be a finite number`);
    }
  }

  let nFeatures = 0;
  if (series.X) {
    // X should be [n_features, n_observations] format for Nixtla API
    nFeatures = series.X.length;
    
    if (nFeatures > 0) {
      for (let i = 0; i < series.X.length; i++) {
        if (!Array.isArray(series.X[i])) {
          errors.push(`X[${i}] must be an array`);
          continue;
        }
        // Each feature array should have length equal to y.length
        if (series.X[i].length !== yLen) {
          errors.push(
            `X[${i}].length (${series.X[i].length}) must equal y.length (${yLen})`
          );
        }
        for (let j = 0; j < series.X[i].length; j++) {
          if (!Number.isFinite(series.X[i][j])) {
            errors.push(`X[${i}][${j}] must be a finite number`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    nSeries,
    yLen,
    nFeatures,
  };
}
