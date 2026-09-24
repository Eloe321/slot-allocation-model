import {
  BadRequestException, Body, Controller, Get, Inject, Param, ParseIntPipe, Post, Req,
} from '@nestjs/common';
import { DemoRoles, type DemoRequest } from '../demo/demo-access.js';
import { DemoRateLimiter } from '../demo/demo-rate-limiter.js';
import { previewConfiguration } from './configuration.preview.js';
import { ConfigurationService } from './configuration.service.js';

@Controller('configuration-requests')
@DemoRoles('operator', 'administrator')
export class ConfigurationController {
  constructor(
    @Inject(ConfigurationService) private readonly configurations: ConfigurationService,
    @Inject(DemoRateLimiter) private readonly limiter: DemoRateLimiter,
  ) {}

  @Get()
  list() {
    return this.configurations.list();
  }

  @Post('preview')
  preview(@Body() body: unknown) {
    try {
      return previewConfiguration(body);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid configuration');
    }
  }

  @Post()
  async submit(@Body() body: unknown, @Req() request: DemoRequest) {
    const preview = this.preview(body);
    if (preview.violations.length > 0) {
      throw new BadRequestException({ error: 'invalid_configuration', violations: preview.violations });
    }
    this.limiter.consume('proposal', request.ip ?? 'unknown');
    return this.configurations.submit(preview.input, request.demoPrincipal.role);
  }

  @Post(':id/approve')
  @DemoRoles('administrator')
  approve(@Param('id', ParseIntPipe) id: number, @Req() request: DemoRequest) {
    return this.configurations.approve(id, request.demoPrincipal.role);
  }

  @Post(':id/reject')
  @DemoRoles('administrator')
  reject(@Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string }, @Req() request: DemoRequest) {
    if (!body?.reason?.trim()) throw new BadRequestException('A review reason is required');
    return this.configurations.reject(id, request.demoPrincipal.role, body.reason).then(() => ({ ok: true }));
  }
}
