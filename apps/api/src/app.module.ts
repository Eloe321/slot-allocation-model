import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { createPool, PG_POOL } from './db/pool.js';
import { AllocationRepository } from './allocation/allocation.repository.js';
import { LedgerService } from './ledger/ledger.service.js';
import { ReservationService } from './reservation/reservation.service.js';
import { ExpiryService } from './reservation/expiry.service.js';
import { CutoffService } from './cutoff/cutoff.service.js';
import { AllocationController } from './http/allocation.controller.js';
import { ReservationController } from './http/reservation.controller.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AllocationController, ReservationController],
  providers: [
    { provide: PG_POOL, useFactory: createPool },
    AllocationRepository,
    LedgerService,
    ReservationService,
    ExpiryService,
    CutoffService,
  ],
})
export class AppModule {}
