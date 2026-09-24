# Demo API guide

The API runs at `http://localhost:4001` after `pnpm bootstrap && pnpm dev`. It is a **disposable portfolio demo**: anyone can select any seeded role. Demo sessions are opaque bearer tokens, stored as hashes, and expire after two hours. This is not customer authentication or tenant isolation.

## Start a session

`GET /demo/identities` lists the administrator, operator, and partners with allocations. `POST /demo/sessions` accepts `{"role":"operator"}` or `{"role":"partner","ownerId":7}` and returns `{"token":"…"}`. Send `Authorization: Bearer <token>` on subsequent requests. Administrator and operator can inspect bookings and reports; only the administrator approves configuration requests and sees CRM deliveries; partners see only their own inventory and activity. Expired sessions are pruned, and the public demo is capped at 500 active sessions. A source can select a role 20 times per two hours before receiving 429.

## Plan an allocation

`POST /configuration-requests/preview` validates a proposal without saving it. For example:

```json
{
  "vesselName": "MV North Star",
  "cabinName": "Economy",
  "departurePort": "Manila",
  "departsAt": "2026-10-02T08:00:00Z",
  "bookingCutoffAt": "2026-10-02T06:00:00Z",
  "capacity": 100,
  "rows": [
    {"channel":"counter","allocationType":"direct","fundingSource":"online","allocatedSlots":20,"ownerName":null},
    {"channel":"online","allocationType":"direct","fundingSource":"online","allocatedSlots":80,"ownerName":null},
    {"channel":"agency","allocationType":"guaranteed","fundingSource":"online","allocatedSlots":10,"ownerName":"Harbour Travel"}
  ]
}
```

The response contains `violations`, `directAllocated`, `unallocated`, and each row's raw and netted availability. `POST /configuration-requests` submits a valid proposal. `GET /configuration-requests` lists its audit state. `POST /configuration-requests/:id/approve` materializes a bookable configuration in one transaction; repeated approval returns the same `configId` with `alreadyApproved: true`. `POST /configuration-requests/:id/reject` requires `{"reason":"…"}`. Invalid proposals return 400 with invariant violations. Missing requests return 404; closed requests return 409. The demo stores at most 100 proposals; submissions return 409 at the limit. A source can submit 5 proposals per day before receiving 429. An hourly cleanup removes proposals older than 24 hours and their approved custom sailings.

## Booking lifecycle

`GET /configs/:id` returns the capacity tree and invariant findings. `POST /configs/:id/waterfall` previews the rows an identity can reach, for example `{"channel":"online"}` or `{"channel":"agency","ownerId":7,"managed":false}`.

`POST /configs/:id/reservations` accepts the identity plus `"quantity":5`. It returns a `token`, `expiresAt`, and the allocation splits. Reservation is atomic under a configuration lock. If capacity is insufficient, the response is **409**:

```json
{"error":"insufficient_capacity","requested":25,"available":20,"shortfall":5}
```

That refusal is stored for the report. `POST /reservations/:token/confirm` accepts `{"bookingRef":"BK-123"}` and returns `alreadyConfirmed` and splits; replaying the same token is idempotent. `POST /reservations/:token/release` returns an open hold to its source rows. `POST /reservations/:token/expire` advances an open hold to expiry for the guided demo; the normal expiry sweeper runs every ten seconds. Closed holds cannot be modified and return 409. `POST /configs/:id/cutoff` returns eligible flexible capacity to the counter. `GET /configs/:id/ledger` explains movements. `GET /configs/:id/report` and `/csv` provide the business report; CSV requires the same bearer token.

`GET /scenarios` lists seeded examples. `POST /scenarios/:key/reset` rebuilds one seeded scenario. Reset is intended only for disposable demo data.

## CRM booking confirmation webhook

Set `CRM_WEBHOOK_URL` to an HTTPS receiver (localhost HTTP is accepted for development) and `CRM_WEBHOOK_SECRET` to a shared secret. Confirmation inserts a `booking.confirmed` event into an outbox **inside the same database transaction** as the sale. The worker sends up to 20 due events every 30 seconds. If no target is configured, events remain queued and visible to administrators.

The POST body contains `event`, `bookingRef`, `configId`, `token`, `quantity`, and allocation `splits`. The receiver gets:

- `Idempotency-Key: booking.confirmed:<reservation-token>` — stable across retries.
- `X-Slot-Event-Id` and `X-Slot-Event-Type`.
- `X-Slot-Signature: sha256=<hex HMAC-SHA256 of the exact raw request body>`.

Verify the signature against the **raw body**, compare digests in constant time, and store the idempotency key before applying the event. A receiver can return any 2xx response to acknowledge it. Redirects are not followed. Non-2xx responses and network failures are audited and retried with increasing delay, up to five attempts. A crash after the receiver accepts a request may cause another delivery with the same key; the receiver must deduplicate it.

Administrators can inspect `GET /integrations/crm/deliveries`, `GET /integrations/crm/deliveries/:id/attempts`, and use `POST /integrations/crm/deliveries/:id/retry` for a failed delivery. The retry starts a new five-attempt cycle. `GET /integrations/crm/deliveries/status` reports whether a target is configured without exposing the secret.

## Retry and error rules

Read requests are safe to retry. Configuration approval, booking confirmation, cutoff, and webhook delivery have explicit idempotency behavior. **Reservation creation is not idempotent**: a retry can create another hold. Clients should retain the returned token and query their own booking state before retrying after an uncertain response. A reservation shortfall is a business refusal (409), not a transport failure. The public demo role chooser must be replaced by real authentication and authorization before customer data is used.
