import { Controller, Get, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { DemoRoles } from '../demo/demo-access.js';
import { CrmWebhookService } from './crm-webhook.service.js';

@Controller('integrations/crm/deliveries')
@DemoRoles('administrator')
export class CrmWebhookController {
  constructor(private readonly webhooks: CrmWebhookService) {}

  @Get('status')
  status() { return { configured: Boolean(process.env.CRM_WEBHOOK_URL && process.env.CRM_WEBHOOK_SECRET) }; }

  @Get()
  list() { return this.webhooks.list(); }

  @Get(':id/attempts')
  attempts(@Param('id', ParseIntPipe) id: number) { return this.webhooks.attempts(id); }

  @Post(':id/retry')
  async retry(@Param('id', ParseIntPipe) id: number) {
    if (!await this.webhooks.retry(id)) throw new NotFoundException('Failed delivery not found');
    return { queued: true };
  }
}
