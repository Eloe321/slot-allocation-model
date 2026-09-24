CREATE TABLE demo_sessions (
  token_hash text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('administrator', 'operator', 'partner')),
  owner_id bigint REFERENCES owners(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_owner_scope CHECK (
    (role = 'partner' AND owner_id IS NOT NULL) OR
    (role <> 'partner' AND owner_id IS NULL)
  )
);

CREATE INDEX demo_sessions_expiry_idx ON demo_sessions (expires_at);
