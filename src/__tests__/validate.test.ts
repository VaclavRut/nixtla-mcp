import { describe, it, expect } from 'vitest';
import { validateNixtlaSeries } from '../data/validate.js';
import type { NixtlaSeries } from '../nixtla/types.js';

describe('validateNixtlaSeries', () => {
  it('should validate a correct single series', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3, 4, 5],
      sizes: [5],
    };
    
    const result = validateNixtlaSeries(series);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.nSeries).toBe(1);
    expect(result.yLen).toBe(5);
    expect(result.nFeatures).toBe(0);
  });

  it('should validate multiple series', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3, 4, 5, 6],
      sizes: [3, 3],
    };
    
    const result = validateNixtlaSeries(series);
    
    expect(result.valid).toBe(true);
    expect(result.nSeries).toBe(2);
    expect(result.yLen).toBe(6);
  });

  it('should validate series with exogenous variables', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3],
      sizes: [3],
      X: [[1.1, 1.2, 1.3], [2.1, 2.2, 2.3]],
    };
    
    const result = validateNixtlaSeries(series);
    
    expect(result.valid).toBe(true);
    expect(result.nFeatures).toBe(2);
  });

  it('should reject mismatched sizes', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3, 4, 5],
      sizes: [3, 3],
    };
    
    const result = validateNixtlaSeries(series);
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject non-finite values', () => {
    const series: NixtlaSeries = {
      y: [1, 2, NaN, 4, 5],
      sizes: [5],
    };
    
    const result = validateNixtlaSeries(series);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('finite'))).toBe(true);
  });

  it('should reject mismatched X length', () => {
    const series: NixtlaSeries = {
      y: [1, 2, 3],
      sizes: [3],
      X: [[1.1, 1.2], [2.1, 2.2]],
    };
    
    const result = validateNixtlaSeries(series);
    
    expect(result.valid).toBe(false);
  });
});
