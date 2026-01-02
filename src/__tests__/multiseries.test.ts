import { describe, it, expect } from 'vitest';
import {
  reconstructPerSeries,
  concatenateSeries,
  trimSeriesAtIndex,
  sliceSeriesRange,
} from '../data/multiseries.js';
import type { NixtlaSeries } from '../nixtla/types.js';

describe('multiseries operations', () => {
  it('should reconstruct per-series data correctly', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3, 4, 5, 6],
      sizes: [2, 4],
    };
    
    const perSeries = reconstructPerSeries(series);
    
    expect(perSeries).toHaveLength(2);
    expect(perSeries[0].y).toEqual([1, 2]);
    expect(perSeries[1].y).toEqual([3, 4, 5, 6]);
  });

  it('should concatenate per-series data correctly', () => {
    const perSeries = [
      { y: [1, 2, 3] },
      { y: [4, 5] },
    ];
    
    const series = concatenateSeries(perSeries);
    
    expect(series.y).toEqual([1, 2, 3, 4, 5]);
    expect(series.sizes).toEqual([3, 2]);
  });

  it('should handle exogenous variables in reconstruction', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3, 4],
      sizes: [2, 2],
      X: [[1.1, 1.2, 1.3, 1.4], [2.1, 2.2, 2.3, 2.4]],
    };
    
    const perSeries = reconstructPerSeries(series);
    
    expect(perSeries[0].X).toEqual([[1.1, 2.1], [1.2, 2.2]]);
    expect(perSeries[1].X).toEqual([[1.3, 2.3], [1.4, 2.4]]);
  });

  it('should trim series at specified index', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3, 4, 5, 6, 7, 8],
      sizes: [4, 4],
    };
    
    const trimmed = trimSeriesAtIndex(series, 3);
    
    expect(trimmed.y).toEqual([1, 2, 3, 5, 6, 7]);
    expect(trimmed.sizes).toEqual([3, 3]);
  });

  it('should slice series range correctly', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3, 4, 5, 6],
      sizes: [3, 3],
    };
    
    const sliced = sliceSeriesRange(series, 1, 3);
    
    expect(sliced.y).toEqual([2, 3, 5, 6]);
    expect(sliced.sizes).toEqual([2, 2]);
  });
});
