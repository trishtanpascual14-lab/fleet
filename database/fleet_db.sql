-- ============================================================================
-- FLEET MANAGEMENT SYSTEM - CLEAN DATABASE
-- Database: fleet_db  (MySQL / MariaDB - XAMPP compatible)
-- Source of truth: existing backend code in C:\xamppppp\htdocs\fleet\backend
--   controllers, utils/otp.js, utils/routeService.js, config/db.js, seed.js
-- ============================================================================
-- DESIGN NOTES:
--   * 15 tables covering ALL modules found in code (no guessing)
--   * Fixes 2 bugs from old smart_fleet_db:
--       1. vehicle_locations missing driver_id + heading_deg (trackingController expects both)
--       2. sos_alerts table missing entirely (sosController + tracking live-sync)
--   * Circular FKs (users↔drivers, reservations↔routes) handled via deferred ALTER
--   * ON DELETE: SET NULL for optional links, RESTRICT for trip vehicle/driver to preserve history
--   * utf8mb4 + snake_case + indexes on all FK / filter columns
-- ============================================================================

CREATE DATABASE IF NOT EXISTS fleet_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fleet_db;

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ----------------------------------------------------------------------------
-- 1. vehicles (no dependencies)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_code VARCHAR(30) NOT NULL,
  plate_number VARCHAR(30) NOT NULL,
  vehicle_type VARCHAR(50) NOT NULL,
  fuel_type ENUM('Diesel','Gasoline','Premium','Unleaded','Biofuel') NOT NULL DEFAULT 'Diesel',
  capacity DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'capacity in kg',
  registration_number VARCHAR(60) NULL,
  registration_expiry DATE NULL,
  status ENUM('Available','Reserved','Dispatched','In Transit','Maintenance','Inactive') NOT NULL DEFAULT 'Available',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vehicles_code (vehicle_code),
  UNIQUE KEY uq_vehicles_plate (plate_number),
  INDEX idx_vehicles_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. users (without FK to drivers yet - deferred to avoid circular dep)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  password VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
  role ENUM('admin','fleet_manager','dispatcher','driver') NOT NULL DEFAULT 'dispatcher',
  driver_id INT NULL COMMENT 'FK to drivers.id - deferred',
  phone VARCHAR(30) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  INDEX idx_users_role (role),
  INDEX idx_users_driver (driver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. drivers (depends on vehicles + users)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_code VARCHAR(30) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  contact_number VARCHAR(30) NULL,
  license_number VARCHAR(60) NOT NULL,
  license_expiry DATE NULL,
  status ENUM('Available','Assigned','On Trip','Off Duty','Inactive') NOT NULL DEFAULT 'Available',
  assigned_vehicle_id INT NULL,
  total_trips INT NOT NULL DEFAULT 0,
  completed_trips INT NOT NULL DEFAULT 0,
  performance_rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  user_id INT NULL COMMENT 'one-to-one link to users.id',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_drivers_code (driver_code),
  UNIQUE KEY uq_drivers_license (license_number),
  UNIQUE KEY uq_drivers_user (user_id),
  INDEX idx_drivers_status (status),
  CONSTRAINT fk_drivers_vehicle FOREIGN KEY (assigned_vehicle_id) REFERENCES vehicles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_drivers_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- deferred FK for users.driver_id -> drivers.id
ALTER TABLE users ADD CONSTRAINT fk_users_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 4. places (warehouses/depots - independent, used by routeService)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NULL,
  latitude DECIMAL(10,6) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  category ENUM('warehouse','depot','port','mall','supplier','customer','other') NOT NULL DEFAULT 'other',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_places_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. routes (without reservation_id FK initially - circular with reservations)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_code VARCHAR(30) NOT NULL,
  route_name VARCHAR(150) NULL,
  origin VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  origin_lat DECIMAL(10,6) NULL,
  origin_lng DECIMAL(10,6) NULL,
  destination_lat DECIMAL(10,6) NULL,
  destination_lng DECIMAL(10,6) NULL,
  vehicle_id INT NULL,
  driver_id INT NULL,
  reservation_id INT NULL COMMENT 'FK deferred',
  departure_date DATE NULL,
  departure_time TIME NULL,
  priority ENUM('Low','Normal','High','Urgent') NOT NULL DEFAULT 'Normal',
  total_distance_km DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  estimated_time_min INT NOT NULL DEFAULT 0,
  estimated_fuel_liters DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  estimated_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  route_info TEXT NULL,
  status ENUM('Planned','Optimized','Assigned','In Transit','Completed','Cancelled') NOT NULL DEFAULT 'Planned',
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_routes_code (route_code),
  INDEX idx_routes_status (status),
  CONSTRAINT fk_routes_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_routes_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_routes_user FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. reservations (without route_id FK initially - circular with routes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_code VARCHAR(30) NOT NULL,
  vehicle_id INT NULL,
  driver_id INT NULL,
  route_id INT NULL COMMENT 'FK deferred',
  requested_by INT NULL,
  reservation_date DATE NOT NULL,
  pickup_location VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  purpose TEXT NULL,
  status ENUM('Pending','Approved','Rejected','Reserved','Dispatched','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reservations_code (reservation_code),
  INDEX idx_res_status (status),
  INDEX idx_res_date (reservation_date),
  CONSTRAINT fk_res_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_res_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_res_user FOREIGN KEY (requested_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- resolve circular FKs between routes and reservations
ALTER TABLE routes ADD CONSTRAINT fk_routes_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE reservations ADD CONSTRAINT fk_res_route FOREIGN KEY (route_id) REFERENCES routes(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 7. route_stops (depends on routes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  stop_order INT NOT NULL DEFAULT 0,
  location VARCHAR(255) NOT NULL,
  latitude DECIMAL(10,6) NULL,
  longitude DECIMAL(10,6) NULL,
  INDEX idx_stop_route (route_id),
  CONSTRAINT fk_stop_route FOREIGN KEY (route_id) REFERENCES routes(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 8. trips (depends on reservations, vehicles, drivers, routes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trip_code VARCHAR(30) NOT NULL,
  reservation_id INT NULL,
  vehicle_id INT NOT NULL,
  driver_id INT NOT NULL,
  route_id INT NULL,
  pickup_location VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  stops TEXT NULL,
  distance_km DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  estimated_time_min INT NOT NULL DEFAULT 0,
  departure_datetime DATETIME NULL,
  arrival_datetime DATETIME NULL,
  trip_status ENUM('Scheduled','Dispatched','In Transit','Arrived','Completed','Cancelled') NOT NULL DEFAULT 'Scheduled',
  delivery_status ENUM('Pending','Out for Delivery','Delivered','Failed') NOT NULL DEFAULT 'Pending',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trips_code (trip_code),
  INDEX idx_trip_status (trip_status),
  INDEX idx_trip_vehicle (vehicle_id),
  INDEX idx_trip_driver (driver_id),
  INDEX idx_trip_route (route_id),
  CONSTRAINT fk_trip_res FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_trip_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_trip_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_trip_route FOREIGN KEY (route_id) REFERENCES routes(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 9. fuel_records (depends on vehicles, drivers, trips, users)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fuel_code VARCHAR(30) NOT NULL,
  vehicle_id INT NOT NULL,
  driver_id INT NULL,
  trip_id INT NULL,
  record_date DATE NOT NULL,
  fuel_type ENUM('Diesel','Gasoline','Premium','Unleaded','Biofuel') NOT NULL DEFAULT 'Diesel',
  liters DECIMAL(10,2) NOT NULL,
  price_per_liter DECIMAL(10,2) NOT NULL,
  total_cost DECIMAL(12,2) NOT NULL,
  odometer_reading INT NULL,
  fuel_station VARCHAR(150) NULL,
  receipt_reference VARCHAR(100) NULL,
  notes TEXT NULL,
  receipt_path VARCHAR(255) NULL,
  receipt_original_name VARCHAR(255) NULL,
  receipt_mime VARCHAR(100) NULL,
  receipt_size INT NULL,
  receipt_uploaded_at DATETIME NULL,
  ocr_snapshot TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fuel_code (fuel_code),
  INDEX idx_fuel_vehicle (vehicle_id),
  INDEX idx_fuel_date (record_date),
  CONSTRAINT fk_fuel_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_fuel_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_fuel_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_fuel_user FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 10. transportation_costs (depends on trips, vehicles, drivers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transportation_costs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cost_code VARCHAR(30) NOT NULL,
  trip_id INT NULL,
  vehicle_id INT NULL,
  driver_id INT NULL,
  fuel_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  driver_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  toll_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  maintenance_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  other_costs DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cost_date DATE NOT NULL,
  remarks TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cost_code (cost_code),
  INDEX idx_cost_date (cost_date),
  CONSTRAINT fk_cost_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cost_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cost_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 11. vehicle_locations (IoT tracking) - FIXED: added driver_id + heading_deg
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_locations (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'tracking_id',
  vehicle_id INT NOT NULL,
  driver_id INT NULL,
  trip_id INT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  speed_kmh DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  heading_deg DECIMAL(5,2) NULL COMMENT 'compass heading 0-360, from trackingController',
  status VARCHAR(50) NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_loc_vehicle (vehicle_id),
  INDEX idx_loc_driver (driver_id),
  INDEX idx_loc_trip (trip_id),
  INDEX idx_loc_recorded (recorded_at),
  CONSTRAINT fk_loc_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_loc_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_loc_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 12. notifications (depends on users optional)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL COMMENT 'NULL = broadcast to role',
  target_role ENUM('admin','fleet_manager','dispatcher','driver','all') NOT NULL DEFAULT 'all',
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  link_type VARCHAR(50) NULL COMMENT 'trip,reservation,vehicle,driver,fuel,cost,sos,none',
  link_id INT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id),
  INDEX idx_notif_role (target_role),
  INDEX idx_notif_read (is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 13. settings (key-value)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL,
  setting_value VARCHAR(500) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 14. otp_verifications (Email OTP - 6 digit, 5min expiry, single-use)
--     Matches backend/utils/otp.js: bcrypt hash, invalidate previous, 5 attempts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  otp_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt hash of 6-digit OTP',
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  verified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_otp_user (user_id),
  INDEX idx_otp_expires (expires_at),
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 15. sos_alerts (NEW - missing from old DB, required by sosController.js)
--     Inferred from: sosController list/get/create/resolve/cancel + tracking live-sync
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sos_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  trip_id INT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  status ENUM('ACTIVE','RESOLVED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  triggered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  resolved_by INT NULL COMMENT 'FK to users.id who resolved/cancelled',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sos_driver (driver_id),
  INDEX idx_sos_vehicle (vehicle_id),
  INDEX idx_sos_status (status),
  CONSTRAINT fk_sos_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_sos_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_sos_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_sos_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- SEED DATA (safe for development/testing)
-- Password for all accounts: password123 (bcrypt hash via backend seed.js)
-- Hash below is bcrypt(10) for 'password123' - same as old DB backup
-- ============================================================================
INSERT INTO settings (setting_key, setting_value) VALUES
  ('company_name','SME Smart Fleet Distribution'),
  ('fuel_wastage_threshold_l_per_100km','15'),
  ('fuel_high_cost_threshold','5000'),
  ('registration_expiry_warning_days','30'),
  ('license_expiry_warning_days','30')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- Places for autocomplete (used by routeService searchPlaces)
INSERT INTO places (name, address, latitude, longitude, category) VALUES
  ('Warehouse A','KM 14 West Service Road, Parañaque City, Metro Manila',14.600000,120.980000,'warehouse'),
  ('Warehouse B','Industrial Park, Calamba, Laguna',14.550000,121.020000,'warehouse'),
  ('Central Depot','Commonwealth Ave, Quezon City, Metro Manila',14.676000,121.043700,'depot'),
  ('Port of Manila','South Harbor, Port Area, Manila',14.585000,120.970000,'port'),
  ('SM Mall of Asia','Seaside Blvd, Pasay City, Metro Manila',14.535000,121.000000,'mall'),
  ('Pasig Hub','Ortigas Ave, Pasig City, Metro Manila',14.576400,121.085100,'other'),
  ('Taguig Hub','C-5, Taguig City, Metro Manila',14.517600,121.050900,'other')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Users: 1 admin, 1 fleet_manager, 1 dispatcher, 1 driver (password123)
-- The 4 roles match backend/middleware/auth.js authorize checks
INSERT INTO users (name, email, password, role, is_active) VALUES
  ('System Administrator','admin@fleet.com','$2a$10$/uWBQdnuGx0F5/cMXyMzyeFEEVZM3eDvKEA9rvX4ZkVRNKYCSnB7e','admin',1),
  ('Fleet Manager','manager@fleet.com','$2a$10$/uWBQdnuGx0F5/cMXyMzyeFEEVZM3eDvKEA9rvX4ZkVRNKYCSnB7e','fleet_manager',1),
  ('Dispatcher One','dispatcher@fleet.com','$2a$10$/uWBQdnuGx0F5/cMXyMzyeFEEVZM3eDvKEA9rvX4ZkVRNKYCSnB7e','dispatcher',1),
  ('Juan Dela Cruz','driver@fleet.com','$2a$10$/uWBQdnuGx0F5/cMXyMzyeFEEVZM3eDvKEA9rvX4ZkVRNKYCSnB7e','driver',1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Link driver profile for driver@fleet.com (two-way link users.driver_id <-> drivers.user_id)
-- Minimal driver profile for the seeded driver account
INSERT INTO drivers (driver_code, full_name, contact_number, license_number, license_expiry, status, user_id)
  SELECT 'DRV-2026-2001','Juan Dela Cruz','0917-100-0010','LIC-5000','2027-12-31','Available', u.id
  FROM users u WHERE u.email='driver@fleet.com'
  ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

-- Complete the reverse link so JWT driver_id is populated on login
UPDATE users u
  JOIN drivers d ON d.user_id = u.id
  SET u.driver_id = d.id
  WHERE u.email='driver@fleet.com' AND u.driver_id IS NULL;
