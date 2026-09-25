import { describe, expect, test } from 'vitest';
import { allowedOrigins, isLocalDevelopmentOrigin } from './origin.js';

describe('allowedOrigins', () => {
  test('normalizes a configured browser origin with a trailing slash', () => {
    expect(allowedOrigins('https://slot-allocation-model.pages.dev/')).toEqual([
      'https://slot-allocation-model.pages.dev',
    ]);
  });

  test('keeps local development origins enabled when no public origin is configured', () => {
    expect(allowedOrigins(undefined)).toBeUndefined();
  });

  test('supports more than one configured deployment origin', () => {
    expect(allowedOrigins('https://example.com/, https://preview.example.com')).toEqual([
      'https://example.com',
      'https://preview.example.com',
    ]);
  });
});

describe('isLocalDevelopmentOrigin', () => {
  test('allows a browserless request and local browser origins', () => {
    expect(isLocalDevelopmentOrigin(undefined)).toBe(true);
    expect(isLocalDevelopmentOrigin('http://localhost:3000')).toBe(true);
    expect(isLocalDevelopmentOrigin('https://127.0.0.1:3001')).toBe(true);
  });

  test('rejects a non-local browser origin when no public origin is configured', () => {
    expect(isLocalDevelopmentOrigin('https://slot-allocation-model.pages.dev')).toBe(false);
  });
});
