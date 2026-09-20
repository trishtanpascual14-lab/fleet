-- AUDIT ACTIVITY-TRAIL COLUMNS (safe, idempotent)
-- Extends audit_logs so MODULE_VIEW / RECORD_VIEW and other user activity
-- carry WHO/WHAT/WHEN/WHERE data: resource, description, route, method,
-- metadata. Existing rows and queries are unaffected (new columns are NULL).
-- Run once against the live database; re-running is a no-op.
USE smart_fleet_db;

DROP PROCEDURE IF EXISTS add_audit_activity_columns;
DELIMITER $$
CREATE PROCEDURE add_audit_activity_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'resource') THEN
    ALTER TABLE audit_logs ADD COLUMN resource VARCHAR(100) NULL COMMENT 'e.g. Fuel Transaction, Reservation, Dashboard' AFTER module;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'description') THEN
    ALTER TABLE audit_logs ADD COLUMN description VARCHAR(500) NULL COMMENT 'human-readable activity summary' AFTER record_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'route') THEN
    ALTER TABLE audit_logs ADD COLUMN route VARCHAR(255) NULL COMMENT 'server request path, e.g. /api/fuel/9' AFTER description;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'method') THEN
    ALTER TABLE audit_logs ADD COLUMN method VARCHAR(10) NULL COMMENT 'HTTP method: GET, POST, ...' AFTER route;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'metadata') THEN
    ALTER TABLE audit_logs ADD COLUMN metadata JSON NULL COMMENT 'extra context (codes, filters, counts)' AFTER user_agent;
  END IF;
END$$
DELIMITER ;
CALL add_audit_activity_columns();
DROP PROCEDURE add_audit_activity_columns;

-- Verify:
SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs'
AND COLUMN_NAME IN ('resource','description','route','method','metadata');
