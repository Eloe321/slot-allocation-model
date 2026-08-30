import { describe, it, expect } from 'vitest';
import { toIdentity } from './identity.js';

describe('toIdentity', () => {
  it('maps unowned channels', () => {
    expect(toIdentity({ channel: 'online' })).toEqual({ kind: 'online' });
    expect(toIdentity({ channel: 'counter' })).toEqual({ kind: 'counter' });
    expect(toIdentity({ channel: 'marketplace' })).toEqual({ kind: 'marketplace' });
  });

  it('maps an owned channel with a resolved owner', () => {
    expect(toIdentity({ channel: 'agency', ownerId: 7, managed: true })).toEqual({
      kind: 'owner',
      channel: 'agency',
      ownerId: 7,
      managed: true,
    });
  });

  it('hard-fails an owned channel with no owner', () => {
    expect(() => toIdentity({ channel: 'agency' })).toThrow(
      'agency requests require a resolved owner',
    );
  });

  it('hard-fails an owned channel with a null owner', () => {
    expect(() => toIdentity({ channel: 'reseller', ownerId: null })).toThrow(
      'reseller requests require a resolved owner',
    );
  });

  it('refuses partner_pool as a requester channel', () => {
    expect(() => toIdentity({ channel: 'partner_pool' })).toThrow(
      'partner_pool is not a bookable channel',
    );
  });
});
