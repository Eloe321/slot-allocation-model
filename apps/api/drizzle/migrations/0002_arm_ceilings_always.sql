CREATE OR REPLACE FUNCTION assert_pool_ceilings() RETURNS trigger AS $$
DECLARE
  cfg_id           bigint;
  cabin_cap        integer;
  online_parent    integer;
  online_children  integer;
  online_committed integer;
  pool_parent      integer;
  pool_children    integer;
  pool_committed   integer;
  direct_total     integer;
BEGIN
  cfg_id := COALESCE(NEW.config_id, OLD.config_id);

  SELECT cabin_capacity INTO cabin_cap
    FROM allocation_configs WHERE id = cfg_id;

  -- The config may already be gone (ON DELETE CASCADE); nothing left to check.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(allocated_slots), 0) INTO online_parent
    FROM channel_allocations
   WHERE config_id = cfg_id
     AND channel = 'online' AND owner_id IS NULL AND allocation_type = 'direct';

  SELECT COALESCE(SUM(sold_slots + held_slots), 0) INTO online_committed
    FROM channel_allocations
   WHERE config_id = cfg_id
     AND channel = 'online' AND owner_id IS NULL AND allocation_type = 'direct';

  SELECT COALESCE(SUM(allocated_slots), 0) INTO online_children
    FROM channel_allocations
   WHERE config_id = cfg_id
     AND allocation_type IN ('flexible','guaranteed')
     AND funding_source <> 'partner_pool';

  -- A child whose parent row is absent belongs to no physical partition at all.
  -- Checked before the ceiling arithmetic below: with no parent row,
  -- online_parent is 0 by COALESCE, which would otherwise make every
  -- orphaned child look like a ceiling overflow instead of a missing parent.
  IF online_children > 0 AND NOT EXISTS (
    SELECT 1 FROM channel_allocations
     WHERE config_id = cfg_id
       AND channel = 'online' AND owner_id IS NULL AND allocation_type = 'direct'
  ) THEN
    RAISE EXCEPTION
      'online-funded children exist with no online parent row on config %', cfg_id;
  END IF;

  -- The parent's OWN committed seats draw on the same partition its children
  -- carve from, so they belong on the same side of the inequality. Comparing
  -- children against the parent's allocation alone admits a parent that has
  -- sold 60 of 100 while a child holds 50.
  IF online_children + online_committed > online_parent THEN
    RAISE EXCEPTION
      'online-funded children (%) plus parent committed (%) exceed online parent allocation (%) on config %',
      online_children, online_committed, online_parent, cfg_id;
  END IF;

  SELECT COALESCE(SUM(allocated_slots), 0) INTO pool_parent
    FROM channel_allocations
   WHERE config_id = cfg_id AND channel = 'partner_pool';

  SELECT COALESCE(SUM(sold_slots + held_slots), 0) INTO pool_committed
    FROM channel_allocations
   WHERE config_id = cfg_id AND channel = 'partner_pool';

  SELECT COALESCE(SUM(allocated_slots), 0) INTO pool_children
    FROM channel_allocations
   WHERE config_id = cfg_id
     AND allocation_type IN ('flexible','guaranteed')
     AND funding_source = 'partner_pool';

  -- Same ordering rationale as the online section above: check for the
  -- missing parent row before the ceiling arithmetic, which would otherwise
  -- misreport an orphaned child as exceeding a zero-sized pool.
  IF pool_children > 0 AND NOT EXISTS (
    SELECT 1 FROM channel_allocations
     WHERE config_id = cfg_id AND channel = 'partner_pool'
  ) THEN
    RAISE EXCEPTION
      'partner-funded children exist with no partner pool row on config %', cfg_id;
  END IF;

  IF pool_children + pool_committed > pool_parent THEN
    RAISE EXCEPTION
      'partner-funded children (%) plus pool committed (%) exceed partner pool allocation (%) on config %',
      pool_children, pool_committed, pool_parent, cfg_id;
  END IF;

  SELECT COALESCE(SUM(allocated_slots), 0) INTO direct_total
    FROM channel_allocations
   WHERE config_id = cfg_id AND allocation_type = 'direct';

  IF direct_total > cabin_cap THEN
    RAISE EXCEPTION
      'direct allocations (%) exceed cabin capacity (%) on config %',
      direct_total, cabin_cap, cfg_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
