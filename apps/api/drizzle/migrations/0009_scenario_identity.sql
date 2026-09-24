ALTER TABLE allocation_configs ADD COLUMN scenario_key text;

-- Existing seed rows can be identified by their seed ledger event. A manager
-- may create a vessel with the same display name, but it has no seed event.
UPDATE allocation_configs c SET scenario_key = names.key
  FROM voyages t JOIN vessels v ON v.id = t.vessel_id,
       (VALUES
         ('double-count-trap', 'The double-count trap'),
         ('counter-siloed', 'Counter is siloed'),
         ('three-way-split', 'One request, three rows'),
         ('managed-draws-pool', 'Managed owners draw the pool, ordinary ones do not'),
         ('hidden-owner-keeps-committed', 'A hidden owner keeps its committed seats'),
         ('free-for-all', 'Free-for-all')
       ) AS names(key, title)
 WHERE c.voyage_id = t.id AND v.name = 'MV ' || names.title
   AND EXISTS (SELECT 1 FROM slot_movements m WHERE m.config_id = c.id
               AND m.event_type = 'config_init' AND m.actor = 'seed');

CREATE INDEX allocation_configs_scenario_key_idx ON allocation_configs (scenario_key)
  WHERE scenario_key IS NOT NULL;
