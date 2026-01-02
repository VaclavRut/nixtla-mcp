import { describe, it, expect } from 'vitest';
import { computeTokenHash, sha256, base64urlEncode } from '../utils/base64url.js';
import { getCurrentMonthKey, parseMonthKey } from '../utils/time.js';

describe('base64url', () => {
  it('should compute consistent token hashes', () => {
    const token = 'test-token-123';
    const secret = 'my-secret-key';
    
    const hash1 = computeTokenHash(token, secret);
    const hash2 = computeTokenHash(token, secret);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should produce different hashes for different tokens', () => {
    const secret = 'my-secret-key';
    const hash1 = computeTokenHash('token1', secret);
    const hash2 = computeTokenHash('token2', secret);
    
    expect(hash1).not.toBe(hash2);
  });

  it('should encode base64url without padding', () => {
    const buffer = Buffer.from('hello world');
    const encoded = base64urlEncode(buffer);
    
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });
});

describe('time', () => {
  it('should return current month in YYYY-MM format', () => {
    const monthKey = getCurrentMonthKey();
    expect(monthKey).toMatch(/^\d{4}-\d{2}$/);
  });

  it('should parse valid month keys', () => {
    expect(parseMonthKey('2024-01')).toBe('2024-01');
    expect(parseMonthKey('2024-12')).toBe('2024-12');
  });

  it('should reject invalid month keys', () => {
    expect(() => parseMonthKey('2024-1')).toThrow();
    expect(() => parseMonthKey('24-01')).toThrow();
    expect(() => parseMonthKey('invalid')).toThrow();
  });
});
