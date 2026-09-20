-- VEHICLE FUEL TYPE EXPANSION (safe, re-runnable)
-- The vehicles.fuel_type ENUM previously allowed only ('Gasoline','Diesel')
-- while fuel_records supports Diesel, Gasoline, Premium, Unleaded, Biofuel.
-- This aligns vehicles with the shared fuel type source
-- (backend/utils/fuelTypes.js + frontend/src/constants/fuelTypes.js) so Add
-- Vehicle, Edit Vehicle and Fuel Transactions all use exactly the same set.
-- Run once against the live database; re-running is a harmless no-op.
USE smart_fleet_db;

ALTER TABLE vehicles
  MODIFY COLUMN fuel_type ENUM('Diesel','Gasoline','Premium','Unleaded','Biofuel') NOT NULL DEFAULT 'Diesel';

-- Verify:
SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicles' AND COLUMN_NAME = 'fuel_type';
