-- FUEL RECEIPT ATTACHMENT + OCR SNAPSHOT COLUMNS (safe, idempotent)
-- The fuel API persists the uploaded receipt image metadata and the
-- structured OCR extraction (see backend/controllers/fuelController.js).
-- Run once against the live database; re-running is a no-op.
USE smart_fleet_db;

DROP PROCEDURE IF EXISTS add_fuel_receipt_columns;
DELIMITER $$
CREATE PROCEDURE add_fuel_receipt_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_records' AND COLUMN_NAME = 'receipt_path') THEN
    ALTER TABLE fuel_records ADD COLUMN receipt_path VARCHAR(255) NULL COMMENT 'relative receipt image path, e.g. receipts/receipt-<ts>-<rand>.jpg';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_records' AND COLUMN_NAME = 'receipt_original_name') THEN
    ALTER TABLE fuel_records ADD COLUMN receipt_original_name VARCHAR(255) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_records' AND COLUMN_NAME = 'receipt_mime') THEN
    ALTER TABLE fuel_records ADD COLUMN receipt_mime VARCHAR(100) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_records' AND COLUMN_NAME = 'receipt_size') THEN
    ALTER TABLE fuel_records ADD COLUMN receipt_size INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_records' AND COLUMN_NAME = 'receipt_uploaded_at') THEN
    ALTER TABLE fuel_records ADD COLUMN receipt_uploaded_at DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_records' AND COLUMN_NAME = 'ocr_snapshot') THEN
    ALTER TABLE fuel_records ADD COLUMN ocr_snapshot TEXT NULL COMMENT 'JSON: OCR-extracted receipt + tiers + validation at scan time';
  END IF;
END$$
DELIMITER ;
CALL add_fuel_receipt_columns();
DROP PROCEDURE add_fuel_receipt_columns;

-- Verify:
SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_records'
AND COLUMN_NAME IN ('receipt_path','receipt_original_name','receipt_mime','receipt_size','receipt_uploaded_at','ocr_snapshot');
