-- A direct channel can have only one reachable row per configuration.
CREATE UNIQUE INDEX one_counter_direct_per_config
  ON channel_allocations (config_id)
  WHERE channel = 'counter' AND allocation_type = 'direct';

CREATE UNIQUE INDEX one_marketplace_direct_per_config
  ON channel_allocations (config_id)
  WHERE channel = 'marketplace' AND allocation_type = 'direct';
