CREATE TABLE configuration_requests (
  id            bigserial PRIMARY KEY,
  status        text NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'approved', 'rejected')),
  proposed      jsonb NOT NULL,
  submitted_by  text NOT NULL,
  reviewed_by   text,
  review_reason text,
  config_id     bigint REFERENCES allocation_configs(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz
);

CREATE INDEX configuration_requests_status_idx
  ON configuration_requests (status, created_at DESC);
