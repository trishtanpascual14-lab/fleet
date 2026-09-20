-- Archive / Soft Delete Migration for Fleet Management System
-- Adds archived_at to all record-managed tables.
-- Run: mysql -u root fleet_db < database/archive_migration.sql
-- Or via phpMyAdmin > Import
-- Safe: only ADD COLUMN IF NOT EXISTS, no DROP/TRUNCATE/DELETE
-- Idempotent: can be run multiple times

USE fleet_db;

-- Helper: MySQL/MariaDB before 10.4 does not support ADD COLUMN IF NOT EXISTS,
-- so we use a procedure to add only if missing.

DELIMITER $$

CREATE PROCEDURE add_archived_at_if_missing(IN tbl VARCHAR(64))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = 'archived_at'
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN archived_at DATETIME NULL DEFAULT NULL AFTER updated_at, ADD INDEX idx_', tbl, '_archived (archived_at)');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL add_archived_at_if_missing('vehicles');
CALL add_archived_at_if_missing('drivers');
CALL add_archived_at_if_missing('users');
CALL add_archived_at_if_missing('reservations');
CALL add_archived_at_if_missing('trips');
CALL add_archived_at_if_missing('routes');
CALL add_archived_at_if_missing('fuel_records');
CALL add_archived_at_if_missing('transportation_costs');

DROP PROCEDURE add_archived_at_if_missing;

-- Verify
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'archived_at' ORDER BY TABLE_NAME;
