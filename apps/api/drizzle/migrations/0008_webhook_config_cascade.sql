ALTER TABLE crm_webhook_deliveries ADD COLUMN config_id bigint;
UPDATE crm_webhook_deliveries SET config_id = (payload->>'configId')::bigint;
DELETE FROM crm_webhook_deliveries d
 WHERE NOT EXISTS (SELECT 1 FROM allocation_configs c WHERE c.id = d.config_id);
ALTER TABLE crm_webhook_deliveries ALTER COLUMN config_id SET NOT NULL;
ALTER TABLE crm_webhook_deliveries
  ADD CONSTRAINT crm_webhook_config_fk
  FOREIGN KEY (config_id) REFERENCES allocation_configs(id) ON DELETE CASCADE;
