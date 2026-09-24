-- Existing configurations may have created a fresh owner for the same partner.
-- Keep the oldest visible ID so existing demo sessions continue to work.
WITH canonical AS (
  SELECT id, min(id) OVER (PARTITION BY lower(btrim(name))) AS keep_id
  FROM owners WHERE is_hidden = false
)
UPDATE channel_allocations a SET owner_id = c.keep_id
FROM canonical c WHERE a.owner_id = c.id AND c.id <> c.keep_id;

WITH canonical AS (
  SELECT id, min(id) OVER (PARTITION BY lower(btrim(name))) AS keep_id
  FROM owners WHERE is_hidden = false
)
UPDATE demo_sessions s SET owner_id = c.keep_id
FROM canonical c WHERE s.owner_id = c.id AND c.id <> c.keep_id;

WITH canonical AS (
  SELECT id, min(id) OVER (PARTITION BY lower(btrim(name))) AS keep_id
  FROM owners WHERE is_hidden = false
)
UPDATE reservation_refusals r SET owner_id = c.keep_id
FROM canonical c WHERE r.owner_id = c.id AND c.id <> c.keep_id;

DELETE FROM owners o
WHERE o.is_hidden = false AND NOT EXISTS (
  SELECT 1 FROM channel_allocations a WHERE a.owner_id = o.id
) AND NOT EXISTS (
  SELECT 1 FROM demo_sessions s WHERE s.owner_id = o.id
) AND EXISTS (
  SELECT 1 FROM owners older
  WHERE older.is_hidden = false AND lower(btrim(older.name)) = lower(btrim(o.name)) AND older.id < o.id
);

CREATE UNIQUE INDEX one_visible_owner_per_name
  ON owners (lower(btrim(name))) WHERE is_hidden = false;
