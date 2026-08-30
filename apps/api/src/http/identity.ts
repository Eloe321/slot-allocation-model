import { BadRequestException } from '@nestjs/common';
import type { RequesterIdentity } from '@slot/engine';

export interface IdentityInput {
  channel: string;
  ownerId?: number | null;
  managed?: boolean;
}

/**
 * Turn untrusted request fields into a `RequesterIdentity`, or reject them.
 *
 * An owned channel with no resolved owner MUST fail here. A null owner matches
 * the unowned online row, so letting it through would silently drain the
 * operator's pool under an agency's name — a data-integrity bug that looks
 * exactly like ordinary traffic in the logs.
 *
 * `partner_pool` is not a requester: it is a pool that eligible requesters draw
 * from. Accepting it as a channel would let a caller claim a privileged
 * topology by sending a string.
 */
export function toIdentity(input: IdentityInput): RequesterIdentity {
  const channel = input.channel.trim().toLowerCase();

  if (channel === 'partner_pool') {
    throw new BadRequestException('partner_pool is not a bookable channel');
  }
  if (channel === 'counter') return { kind: 'counter' };
  if (channel === 'online') return { kind: 'online' };
  if (channel === 'marketplace') return { kind: 'marketplace' };

  if (channel === 'agency' || channel === 'reseller') {
    if (input.ownerId === undefined || input.ownerId === null) {
      throw new BadRequestException(`${channel} requests require a resolved owner`);
    }
    return {
      kind: 'owner',
      channel,
      ownerId: input.ownerId,
      managed: input.managed === true,
    };
  }

  throw new BadRequestException(`unknown channel: ${input.channel}`);
}
