import { describe, it, expect } from 'vitest';
import { computeSMAPE, computeMAPE, computeRMSE, aggregateMetrics } from '../metrics/metrics.js';

describe('metrics', () => {
  describe('sMAPE', () => {
    it('should compute sMAPE correctly', () => {
      const actual = [100, 200, 300];
      const predicted = [110, 190, 310];
      
      const smape = computeSMAPE(actual, predicted);
      
      expect(smape).toBeGreaterThan(0);
      expect(smape).toBeLessThan(100);
    });

    it('should handle zero values gracefully', () => {
      const actual = [0, 100, 200];
      const predicted = [10, 110, 190];
      
      const smape = computeSMAPE(actual, predicted);
      
      expect(Number.isFinite(smape)).toBe(true);
    });

    it('should return 0 for perfect predictions', () => {
      const actual = [100, 200, 300];
      const predicted = [100, 200, 300];
      
      const smape = computeSMAPE(actual, predicted);
      
      expect(smape).toBe(0);
    });
  });

  describe('MAPE', () => {
    it('should compute MAPE correctly', () => {
      const actual = [100, 200, 300];
      const predicted = [110, 190, 310];
      
      const mape = computeMAPE(actual, predicted);
      
      expect(mape).toBeGreaterThan(0);
      expect(mape).toBeLessThan(100);
    });

    it('should skip zero actual values', () => {
      const actual = [0, 100, 200];
      const predicted = [10, 110, 190];
      
      const mape = computeMAPE(actual, predicted);
      
      expect(Number.isFinite(mape)).toBe(true);
    });
  });

  describe('RMSE', () => {
    it('should compute RMSE correctly', () => {
      const actual = [100, 200, 300];
      const predicted = [110, 190, 310];
      
      const rmse = computeRMSE(actual, predicted);
      
      expect(rmse).toBeGreaterThan(0);
      expect(rmse).toBeCloseTo(10, 0);
    });

    it('should return 0 for perfect predictions', () => {
      const actual = [100, 200, 300];
      const predicted = [100, 200, 300];
      
      const rmse = computeRMSE(actual, predicted);
      
      expect(rmse).toBe(0);
    });
  });

  describe('aggregateMetrics', () => {
    it('should compute mean, median, and std correctly', () => {
      const values = [10, 20, 30, 40, 50];
      
      const agg = aggregateMetrics(values);
      
      expect(agg.mean).toBe(30);
      expect(agg.median).toBe(30);
      expect(agg.std).toBeGreaterThan(0);
    });

    it('should handle even number of values for median', () => {
      const values = [10, 20, 30, 40];
      
      const agg = aggregateMetrics(values);
      
      expect(agg.median).toBe(25);
    });

    it('should handle single value', () => {
      const values = [42];
      
      const agg = aggregateMetrics(values);
      
      expect(agg.mean).toBe(42);
      expect(agg.median).toBe(42);
      expect(agg.std).toBe(0);
    });
  });
});
