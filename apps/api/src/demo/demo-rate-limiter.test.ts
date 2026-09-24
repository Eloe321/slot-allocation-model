import { describe, expect, it } from 'vitest';
import { DemoRateLimiter } from './demo-rate-limiter.js';

describe('public demo throttles', () => {
  it('limits one source without blocking a different visitor', () => {
    const limiter = new DemoRateLimiter();
    for (let i = 0; i < 20; i++) limiter.consume('session', '192.0.2.1');
    expect(() => limiter.consume('session', '192.0.2.1')).toThrow('rate limit reached');
    expect(() => limiter.consume('session', '192.0.2.2')).not.toThrow();

    for (let i = 0; i < 5; i++) limiter.consume('proposal', '192.0.2.1');
    expect(() => limiter.consume('proposal', '192.0.2.1')).toThrow('rate limit reached');
    expect(() => limiter.consume('proposal', '192.0.2.2')).not.toThrow();
  });
});
