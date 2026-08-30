-- The previous index keyed on (config_id, channel, owner_id, funding_source),
-- which permits one owner to hold both an online-funded and a partner-funded
-- row on the same channel.
--
-- That strands capacity. An owner is either managed or it is not, and the
-- waterfall's primary matcher filters on funding source accordingly, so exactly
-- one of those two rows can ever be matched by any identity — while both are
-- netted out of their parents. The unmatched row's seats are carved away and
-- reachable by nobody.
--
-- Drop funding source from the key so the constraint matches the engine's
-- `duplicate_owner_row` invariant.
DROP INDEX IF EXISTS one_row_per_owner_channel_funding;

CREATE UNIQUE INDEX one_row_per_owner_channel
  ON channel_allocations (config_id, channel, owner_id)
  WHERE owner_id IS NOT NULL;
