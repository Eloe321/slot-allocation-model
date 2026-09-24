CREATE TABLE crm_webhook_deliveries (
  id              bigserial PRIMARY KEY,
  event_key       text NOT NULL UNIQUE,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until     timestamptz,
  last_http_status integer,
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crm_webhook_due_idx ON crm_webhook_deliveries (status, next_attempt_at);

CREATE TABLE crm_webhook_attempts (
  id          bigserial PRIMARY KEY,
  delivery_id bigint NOT NULL REFERENCES crm_webhook_deliveries(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  http_status integer,
  error       text
);
