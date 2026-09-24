CREATE TABLE reservation_refusals (
  id          bigserial PRIMARY KEY,
  config_id   bigint NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  channel     channel NOT NULL,
  owner_id    bigint REFERENCES owners(id) ON DELETE SET NULL,
  requested   integer NOT NULL CHECK (requested > 0),
  available   integer NOT NULL CHECK (available >= 0),
  shortfall   integer NOT NULL CHECK (shortfall > 0),
  actor       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reservation_refusals_config_idx ON reservation_refusals (config_id, id);
