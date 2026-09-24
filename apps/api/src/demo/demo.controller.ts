import { BadRequestException, Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { DemoPublic } from './demo-access.js';
import { DemoRateLimiter } from './demo-rate-limiter.js';
import { DemoSessionService } from './demo-session.service.js';

@Controller('demo')
@DemoPublic()
export class DemoController {
  constructor(
    @Inject(DemoSessionService) private readonly sessions: DemoSessionService,
    @Inject(DemoRateLimiter) private readonly limiter: DemoRateLimiter,
  ) {}

  @Get('identities')
  identities() {
    return this.sessions.identities();
  }

  @Post('sessions')
  async issue(@Body() body: { role?: string; ownerId?: number }, @Req() request: { ip?: string }) {
    this.limiter.consume('session', request.ip ?? 'unknown');
    try {
      return await this.sessions.issue(body?.role ?? '', body?.ownerId);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid demo identity');
    }
  }
}
