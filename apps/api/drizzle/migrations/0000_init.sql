CREATE TABLE owners (
  id          bigserial PRIMARY KEY,
  name        text        NOT NULL,
  is_hidden   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vessels (
  id    bigserial PRIMARY KEY,
  name  text NOT NULL
);

CREATE TABLE cabins (
  id         bigserial PRIMARY KEY,
  vessel_id  bigint NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  name       text   NOT NULL,
  capacity   integer NOT NULL CHECK (capacity > 0)
);

CREATE TABLE voyages (
  id                bigserial PRIMARY KEY,
  vessel_id         bigint      NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  departure_port    text        NOT NULL,
  departs_at        timestamptz NOT NULL,
  booking_cutoff_at timestamptz NOT NULL
);

CREATE TABLE allocation_configs (
  id                bigserial PRIMARY KEY,
  voyage_id         bigint  NOT NULL REFERENCES voyages(id) ON DELETE CASCADE,
  cabin_id          bigint  NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
  cabin_capacity    integer NOT NULL CHECK (cabin_capacity > 0),
  cutoff_enabled    boolean NOT NULL DEFAULT true,
  cutoff_applied_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, cabin_id)
);

CREATE TYPE channel AS ENUM
  ('counter','online','marketplace','partner_pool','agency','reseller');
CREATE TYPE allocation_type AS ENUM ('direct','flexible','guaranteed');
CREATE TYPE funding_source AS ENUM ('online','partner_pool');

CREATE TABLE channel_allocations (
  id               bigserial PRIMARY KEY,
  config_id        bigint          NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  channel          channel         NOT NULL,
  owner_id         bigint          REFERENCES owners(id) ON DELETE RESTRICT,
  allocation_type  allocation_type NOT NULL,
  funding_source   funding_source  NOT NULL DEFAULT 'online',
  allocated_slots  integer         NOT NULL CHECK (allocated_slots >= 0),
  sold_slots       integer         NOT NULL DEFAULT 0 CHECK (sold_slots  >= 0),
  held_slots       integer         NOT NULL DEFAULT 0 CHECK (held_slots  >= 0),
  created_at       timestamptz     NOT NULL DEFAULT now(),

  -- Layer three. Even a future code path that forgets to check cannot oversell
  -- a single row past its allocation.
  CONSTRAINT row_not_overcommitted
    CHECK (sold_slots + held_slots <= allocated_slots),

  -- Owned channels must carry an owner; unowned channels must not.
  CONSTRAINT owner_matches_channel CHECK (
    (channel IN ('agency','reseller') AND owner_id IS NOT NULL) OR
    (channel NOT IN ('agency','reseller') AND owner_id IS NULL)
  ),

  -- Direct rows are top-level partitions and are never carved from the pool.
  CONSTRAINT direct_is_online_funded CHECK (
    allocation_type <> 'direct' OR funding_source = 'online'
  )
);

CREATE INDEX channel_allocations_config_idx ON channel_allocations (config_id, id);

CREATE TYPE hold_status AS ENUM ('open','confirmed','released','expired');

CREATE TABLE slot_holds (
  id             bigserial PRIMARY KEY,
  token          uuid        NOT NULL,
  config_id      bigint      NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  allocation_id  bigint      NOT NULL REFERENCES channel_allocations(id) ON DELETE CASCADE,
  quantity       integer     NOT NULL CHECK (quantity > 0),
  status         hold_status NOT NULL DEFAULT 'open',
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX slot_holds_token_idx  ON slot_holds (token);
CREATE INDEX slot_holds_sweep_idx  ON slot_holds (status, expires_at);

CREATE TABLE booking_slot_links (
  id             bigserial PRIMARY KEY,
  booking_ref    text        NOT NULL,
  config_id      bigint      NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  allocation_id  bigint      NOT NULL REFERENCES channel_allocations(id) ON DELETE RESTRICT,
  quantity       integer     NOT NULL CHECK (quantity > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booking_slot_links_ref_idx ON booking_slot_links (booking_ref);

CREATE TABLE slot_movements (
  id                        bigserial PRIMARY KEY,
  config_id                 bigint      NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  allocation_id             bigint      REFERENCES channel_allocations(id) ON DELETE SET NULL,
  source_allocation_id      bigint      REFERENCES channel_allocations(id) ON DELETE SET NULL,
  destination_allocation_id bigint      REFERENCES channel_allocations(id) ON DELETE SET NULL,
  event_type                text        NOT NULL,
  quantity                  integer     NOT NULL,
  actor                     text        NOT NULL,
  reason                    text,
  token                     uuid,
  metadata                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX slot_movements_config_idx ON slot_movements (config_id, id);
