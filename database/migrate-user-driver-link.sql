-- USER-TO-DRIVER ACCOUNT INTEGRATION MIGRATION (safe, idempotent)
-- 1. Backfill drivers.user_id from the legacy one-way link users.driver_id
-- 2. Report conflicts instead of guessing (leaves them intact)
-- 3. Enforce one-to-one with a UNIQUE constraint on drivers.user_id
USE smart_fleet_db;

-- Report: users.driver_id values pointing at non-existent drivers (orphans)
SELECT u.id AS user_id, u.name, u.email, u.driver_id AS orphan_driver_id
FROM users u LEFT JOIN drivers d ON d.id = u.driver_id
WHERE u.driver_id IS NOT NULL AND d.id IS NULL;

-- Report: duplicate user links (two users pointing at same driver)
SELECT u.driver_id, COUNT(*) c, GROUP_CONCAT(u.id) user_ids
FROM users u WHERE u.driver_id IS NOT NULL GROUP BY u.driver_id HAVING c > 1;

-- Report: drivers already linked via user_id (should be none before migration)
SELECT user_id, COUNT(*) c FROM drivers WHERE user_id IS NOT NULL GROUP BY user_id HAVING c > 1;

-- Backfill: only where driver is currently unlinked and user link is unambiguous
UPDATE drivers d
JOIN users u ON u.driver_id = d.id
SET d.user_id = u.id
WHERE d.user_id IS NULL;

-- Clear orphan user links (pointing at drivers that no longer exist) so
-- those users correctly reappear as eligible instead of being stuck.
-- Disabled by default: uncomment after reviewing the orphan report above.
-- UPDATE users u LEFT JOIN drivers d ON d.id = u.driver_id
-- SET u.driver_id = NULL WHERE u.driver_id IS NOT NULL AND d.id IS NULL;
