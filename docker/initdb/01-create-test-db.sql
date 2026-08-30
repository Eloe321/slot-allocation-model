-- The integration tests TRUNCATE between cases. Giving them their own database
-- means `pnpm test` cannot wipe the scenarios `pnpm setup` just seeded.
CREATE DATABASE slot_allocation_test OWNER slot;
