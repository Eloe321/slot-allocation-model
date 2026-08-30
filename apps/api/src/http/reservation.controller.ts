import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ReservationService } from '../reservation/reservation.service.js';
import { ConfirmDto, ReserveDto } from './dto.js';
import { toIdentity } from './identity.js';

@Controller()
export class ReservationController {
  constructor(private readonly reservations: ReservationService) {}

  @Post('configs/:id/reservations')
  reserve(@Param('id', ParseIntPipe) id: number, @Body() body: ReserveDto) {
    return this.reservations.reserve({
      configId: id,
      identity: toIdentity(body),
      quantity: body.quantity,
      actor: 'api',
    });
  }

  @Post('reservations/:token/confirm')
  confirm(@Param('token') token: string, @Body() body: ConfirmDto) {
    return this.reservations.confirm(token, body.bookingRef, 'api');
  }

  @Post('reservations/:token/release')
  async release(@Param('token') token: string) {
    await this.reservations.release(token, 'api');
    return { ok: true };
  }
}
