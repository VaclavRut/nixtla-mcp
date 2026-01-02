/**
 * @fileoverview CSV Generator for Forecast Results
 *
 * This module converts forecast results into CSV format for easy use in
 * Excel, Google Sheets, and other spreadsheet applications.
 *
 * @author Nixtla MCP Server
 * @version 1.0.0
 */

import type { NixtlaForecastResponse } from '../nixtla/types.js';

export interface ForecastCSVOptions {
  /** Forecast horizon (number of periods) */
  horizon: number;
  /** Series names in order */
  seriesNames: string[];
  /** Start date for the forecast period */
  forecastStartDate: string;
  /** Data frequency */
  freq: 'D' | 'H' | 'W' | 'M' | 'MS';
  /** Include confidence intervals in the CSV */
  includeIntervals?: boolean;
  /** Forecast response from Nixtla API */
  forecastResponse: NixtlaForecastResponse;
}

/**
 * Add days to a date string (YYYY-MM-DD format)
 */
function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Add hours to a date string
 */
function addHours(dateStr: string, hours: number): string {
  const date = new Date(dateStr);
  date.setHours(date.getHours() + hours);
  return date.toISOString().slice(0, 13) + ':00';
}

/**
 * Add weeks to a date string
 */
function addWeeks(dateStr: string, weeks: number): string {
  return addDays(dateStr, weeks * 7);
}

/**
 * Add months to a date string
 */
function addMonths(dateStr: string, months: number): string {
  const date = new Date(dateStr);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split('T')[0];
}

/**
 * Generate date for a given period index based on frequency
 */
function generateDate(startDate: string, periodIndex: number, freq: 'D' | 'H' | 'W' | 'M' | 'MS'): string {
  switch (freq) {
    case 'D':
      return addDays(startDate, periodIndex);
    case 'H':
      return addHours(startDate, periodIndex);
    case 'W':
      return addWeeks(startDate, periodIndex);
    case 'M':
    case 'MS':
      return addMonths(startDate, periodIndex);
  }
}

/**
 * Convert forecast results to CSV format
 *
 * The forecast mean array is organized as: [Series1: all periods, Series2: all periods, ...]
 * We need to pivot this to: rows = periods, columns = series
 *
 * @param options - Forecast metadata and response
 * @returns CSV string with headers and data
 */
export function generateForecastCSV(options: ForecastCSVOptions): string {
  const { horizon, seriesNames, forecastStartDate, freq, includeIntervals, forecastResponse } = options;
  const { mean, intervals } = forecastResponse;

  const rows: string[] = [];

  // Build header row
  const headers = ['Date'];

  if (includeIntervals && intervals) {
    // Headers: Date, Series1, Series1_Lower_80, Series1_Upper_80, Series1_Lower_95, Series1_Upper_95, ...
    for (const seriesName of seriesNames) {
      headers.push(seriesName);
      if (intervals['80']) {
        headers.push(`${seriesName}_Lower_80`);
        headers.push(`${seriesName}_Upper_80`);
      }
      if (intervals['95']) {
        headers.push(`${seriesName}_Lower_95`);
        headers.push(`${seriesName}_Upper_95`);
      }
    }
  } else {
    // Headers: Date, Series1, Series2, ...
    headers.push(...seriesNames);
  }

  rows.push(headers.join(','));

  // Build data rows (one row per period)
  for (let dayIndex = 0; dayIndex < horizon; dayIndex++) {
    const date = generateDate(forecastStartDate, dayIndex, freq);
    const row = [date];

    for (let seriesIndex = 0; seriesIndex < seriesNames.length; seriesIndex++) {
      // Calculate index in the mean array: seriesIndex * horizon + dayIndex
      const dataIndex = seriesIndex * horizon + dayIndex;
      const forecastValue = mean[dataIndex];

      row.push(forecastValue.toFixed(2));

      if (includeIntervals && intervals) {
        if (intervals['80']) {
          row.push(intervals['80'].lower[dataIndex].toFixed(2));
          row.push(intervals['80'].upper[dataIndex].toFixed(2));
        }
        if (intervals['95']) {
          row.push(intervals['95'].lower[dataIndex].toFixed(2));
          row.push(intervals['95'].upper[dataIndex].toFixed(2));
        }
      }
    }

    rows.push(row.join(','));
  }

  return rows.join('\n');
}

/**
 * Generate a simple summary CSV with just mean forecasts (no intervals)
 * This is the most common format users want
 */
export function generateSimpleForecastCSV(options: ForecastCSVOptions): string {
  return generateForecastCSV({ ...options, includeIntervals: false });
}

/**
 * Generate a detailed CSV with confidence intervals
 */
export function generateDetailedForecastCSV(options: ForecastCSVOptions): string {
  return generateForecastCSV({ ...options, includeIntervals: true });
}
