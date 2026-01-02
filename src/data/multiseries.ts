import type { NixtlaSeries } from '../nixtla/types.js';

export interface PerSeriesData {
  y: number[];
  X?: number[][];
}

export function reconstructPerSeries(series: NixtlaSeries): PerSeriesData[] {
  const result: PerSeriesData[] = [];
  let offset = 0;

  for (const size of series.sizes) {
    const y = series.y.slice(offset, offset + size);
    
    // Handle X format: series.X is [n_features, n_observations], need to slice and transpose
    let X: number[][] | undefined;
    if (series.X) {
      X = [];
      for (let i = 0; i < size; i++) {
        const observation: number[] = [];
        for (let j = 0; j < series.X.length; j++) {
          observation.push(series.X[j][offset + i]);
        }
        X.push(observation);
      }
    }
    
    result.push({ y, X });
    offset += size;
  }

  return result;
}

export function concatenateSeries(perSeries: PerSeriesData[]): NixtlaSeries {
  const y: number[] = [];
  const sizes: number[] = [];
  let X: number[][] | undefined;

  const hasX = perSeries.some(s => s.X !== undefined);
  const totalLen = perSeries.reduce((sum, s) => sum + s.y.length, 0);
  
  // Determine number of features
  let nFeatures = 0;
  for (const series of perSeries) {
    if (series.X && series.X.length > 0) {
      nFeatures = series.X[0].length;
      break;
    }
  }

  if (hasX && nFeatures > 0) {
    // Initialize X as [n_features, n_observations] format
    X = Array(nFeatures).fill(null).map(() => Array(totalLen));
    
    let offset = 0;
    for (const series of perSeries) {
      y.push(...series.y);
      sizes.push(series.y.length);
      
      // Fill X data, transposing from [n_observations, n_features] to [n_features, n_observations]
      for (let i = 0; i < series.y.length; i++) {
        for (let j = 0; j < nFeatures; j++) {
          X[j][offset + i] = series.X?.[i]?.[j] ?? 0;
        }
      }
      offset += series.y.length;
    }
  } else {
    // No X data, just concatenate y
    for (const series of perSeries) {
      y.push(...series.y);
      sizes.push(series.y.length);
    }
  }

  return { y, sizes, X };
}

export function trimSeriesAtIndex(
  series: NixtlaSeries,
  maxIndex: number
): NixtlaSeries {
  const perSeries = reconstructPerSeries(series);
  const trimmed: PerSeriesData[] = [];

  for (const s of perSeries) {
    const len = Math.min(s.y.length, maxIndex);
    if (len <= 0) {
      continue;
    }
    trimmed.push({
      y: s.y.slice(0, len),
      X: s.X ? s.X.slice(0, len) : undefined,
    });
  }

  return concatenateSeries(trimmed);
}

export function sliceSeriesRange(
  series: NixtlaSeries,
  startIndex: number,
  endIndex: number
): NixtlaSeries {
  const perSeries = reconstructPerSeries(series);
  const sliced: PerSeriesData[] = [];

  for (const s of perSeries) {
    const start = Math.max(0, Math.min(startIndex, s.y.length));
    const end = Math.max(start, Math.min(endIndex, s.y.length));
    
    if (end <= start) {
      continue;
    }

    sliced.push({
      y: s.y.slice(start, end),
      X: s.X ? s.X.slice(start, end) : undefined,
    });
  }

  return concatenateSeries(sliced);
}
