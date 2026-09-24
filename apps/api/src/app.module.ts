import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { createPool, PG_POOL } from './db/pool.js';
import { AllocationRepository } from './allocation/allocation.repository.js';
import { LedgerService } from './ledger/ledger.service.js';
import { ReservationService } from './reservation/reservation.service.js';
import { ExpiryService } from './reservation/expiry.service.js';
import { CutoffService } from './cutoff/cutoff.service.js';
import { AllocationController } from './http/allocation.controller.js';
import { ReservationController } from './http/reservation.controller.js';
import { ScenarioController } from './http/scenario.controller.js';
import { ConfigurationController } from './configuration/configuration.controller.js';
import { ConfigurationService } from './configuration/configuration.service.js';
import { DemoController } from './demo/demo.controller.js';
import { PartnerController } from './demo/partner.controller.js';
import { DemoGuard } from './demo/demo-access.js';
import { DemoSessionService } from './demo/demo-session.service.js';
import { DemoRateLimiter } from './demo/demo-rate-limiter.js';
import { ReportService } from './report/report.service.js';
import { ReportController } from './report/report.controller.js';
import { CrmWebhookService } from './integration/crm-webhook.service.js';
import { CrmWebhookController } from './integration/crm-webhook.controller.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    AllocationController, ReservationController, ScenarioController,
    ConfigurationController, DemoController, PartnerController, ReportController, CrmWebhookController,
  ],
  providers: [
    { provide: PG_POOL, useFactory: createPool },
    AllocationRepository,
    LedgerService,
    ReservationService,
    ExpiryService,
    CutoffService,
    ConfigurationService,
    DemoSessionService,
    DemoRateLimiter,
    ReportService,
    CrmWebhookService,
    { provide: APP_GUARD, useClass: DemoGuard },
  ],
})
export class AppModule {}
