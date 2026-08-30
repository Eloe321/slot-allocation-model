import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { InsufficientCapacityError } from './reservation/errors.js';
import { BadRequestException } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Any localhost port, because this runs only on a developer's own machine and
  // pinning one port breaks anyone whose 3000 is already taken. WEB_ORIGIN
  // overrides it if a specific origin is ever needed.
  const allowed = process.env.WEB_ORIGIN;
  app.enableCors({
    origin: allowed
      ? allowed
      : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) =>
          callback(null, !origin || /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)),
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // A shortfall is a 409 with numbers, not a 500. The inspector renders these.
  app.useGlobalFilters({
    catch(error: unknown, host) {
      const res = host.switchToHttp().getResponse();
      if (error instanceof InsufficientCapacityError) {
        return res.status(409).json({
          error: 'insufficient_capacity',
          requested: error.requested,
          available: error.available,
          shortfall: error.shortfall,
        });
      }
      if (error instanceof BadRequestException) {
        return res.status(400).json(error.getResponse());
      }
      const name = error instanceof Error ? error.name : 'Error';
      const message = error instanceof Error ? error.message : 'unexpected error';
      const status = name === 'ReservationNotFoundError' ? 404 : name === 'ReservationNotOpenError' ? 409 : 500;
      return res.status(status).json({ error: name, message });
    },
  });

  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
