import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type Action = 'session' | 'proposal';

const limits: Record<Action, { count: number; windowMs: number }> = {
  session: { count: 20, windowMs: 2 * 60 * 60 * 1000 },
  proposal: { count: 5, windowMs: 24 * 60 * 60 * 1000 },
};

/** One-process throttle for the disposable public demo; keyed by trusted client IP. */
@Injectable()
export class DemoRateLimiter {
  private readonly events = new Map<string, number[]>();
  private calls = 0;

  consume(action: Action, source: string): void {
    const now = Date.now();
    const limit = limits[action];
    const key = `${action}:${source || 'unknown'}`;
    const recent = (this.events.get(key) ?? []).filter((time) => time > now - limit.windowMs);
    if (recent.length >= limit.count) {
      throw new HttpException(`Demo ${action} rate limit reached; try again later`, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.events.set(key, recent);
    if (++this.calls % 100 === 0) this.prune(now);
  }

  private prune(now: number): void {
    for (const [key, times] of this.events) {
      const action = key.startsWith('session:') ? 'session' : 'proposal';
      const recent = times.filter((time) => time > now - limits[action].windowMs);
      if (recent.length) this.events.set(key, recent);
      else this.events.delete(key);
    }
  }
}
