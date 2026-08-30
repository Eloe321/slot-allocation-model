/** A shortfall is an expected outcome, not a crash: it carries the numbers. */
export class InsufficientCapacityError extends Error {
  constructor(
    readonly requested: number,
    readonly available: number,
    readonly shortfall: number,
  ) {
    super(`requested ${requested} seats but only ${available} are available`);
    this.name = 'InsufficientCapacityError';
  }
}

export class ReservationNotFoundError extends Error {
  constructor(token: string) {
    super(`reservation ${token} not found`);
    this.name = 'ReservationNotFoundError';
  }
}

export class ReservationNotOpenError extends Error {
  constructor(
    token: string,
    readonly status: string,
  ) {
    super(`reservation ${token} is ${status} and can no longer be modified`);
    this.name = 'ReservationNotOpenError';
  }
}
