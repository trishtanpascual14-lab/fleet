-- SMART FLEET DISTRIBUTION MANAGEMENT SYSTEM
-- Database: smart_fleet_db (MySQL / MariaDB)

CREATE DATABASE IF NOT EXISTS smart_fleet_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_fleet_db;

-- USERS (role-based: admin, fleet_manager, dispatcher, driver)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin','fleet_manager','dispatcher','driver') NOT NULL DEFAULT 'dispatcher',
  driver_id INT NULL,
  phone VARCHAR(30) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_email (email)
) ENGINE=InnoDB;

-- VEHICLES
CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_code VARCHAR(30) NOT NULL UNIQUE,
  plate_number VARCHAR(30) NOT NULL UNIQUE,
  vehicle_type VARCHAR(50) NOT NULL,
  fuel_type ENUM('Diesel','Gasoline','Premium','Unleaded','Biofuel') NOT NULL DEFAULT 'Diesel',
  capacity DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'capacity in kg',
  registration_number VARCHAR(60) NULL,
  registration_expiry DATE NULL,
  status ENUM('Available','Reserved','Dispatched','In Transit','Maintenance','Inactive') NOT NULL DEFAULT 'Available',
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vehicles_status (status),
  INDEX idx_vehicles_plate (plate_number)
) ENGINE=InnoDB;

-- DRIVERS
CREATE TABLE IF NOT EXISTS drivers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_code VARCHAR(30) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  contact_number VARCHAR(30) NULL,
  license_number VARCHAR(60) NOT NULL UNIQUE,
  license_expiry DATE NULL,
  status ENUM('Available','Assigned','On Trip','Off Duty','Inactive') NOT NULL DEFAULT 'Available',
  assigned_vehicle_id INT NULL,
  total_trips INT NOT NULL DEFAULT 0,
  completed_trips INT NOT NULL DEFAULT 0,
  performance_rating DECIMAL(3,2) NOT NULL DEFAULT 0,
  user_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_drivers_vehicle FOREIGN KEY (assigned_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  CONSTRAINT fk_drivers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_drivers_user_id (user_id),
  INDEX idx_drivers_status (status)
) ENGINE=InnoDB;

-- link users.driver_id after drivers exists
ALTER TABLE users ADD CONSTRAINT fk_users_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;

-- RESERVATIONS
CREATE TABLE IF NOT EXISTS reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_code VARCHAR(30) NOT NULL UNIQUE,
  vehicle_id INT NULL,
  driver_id INT NULL,
  route_id INT NULL,
  requested_by INT NULL,
  reservation_date DATE NOT NULL,
  pickup_location VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  purpose TEXT NULL,
  status ENUM('Pending','Approved','Rejected','Reserved','Dispatched','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_res_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  CONSTRAINT fk_res_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL,
  CONSTRAINT fk_res_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL,
  CONSTRAINT fk_res_user FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_res_status (status),
  INDEX idx_res_date (reservation_date)
) ENGINE=InnoDB;

-- ROUTES
CREATE TABLE IF NOT EXISTS routes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_code VARCHAR(30) NOT NULL UNIQUE,
  route_name VARCHAR(150) NULL,
  origin VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  origin_lat DECIMAL(10,6) NULL,
  origin_lng DECIMAL(10,6) NULL,
  destination_lat DECIMAL(10,6) NULL,
  destination_lng DECIMAL(10,6) NULL,
  vehicle_id INT NULL,
  driver_id INT NULL,
  reservation_id INT NULL,
  departure_date DATE NULL,
  departure_time TIME NULL,
  priority ENUM('Low','Normal','High','Urgent') NOT NULL DEFAULT 'Normal',
  total_distance_km DECIMAL(10,2) NOT NULL DEFAULT 0,
  estimated_time_min INT NOT NULL DEFAULT 0,
  estimated_fuel_liters DECIMAL(10,2) NOT NULL DEFAULT 0,
  estimated_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  route_info TEXT NULL,
  status ENUM('Planned','Optimized','Assigned','In Transit','Completed','Cancelled') NOT NULL DEFAULT 'Planned',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_routes_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_routes_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  CONSTRAINT fk_routes_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL,
  CONSTRAINT fk_routes_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS route_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  stop_order INT NOT NULL DEFAULT 0,
  location VARCHAR(255) NOT NULL,
  latitude DECIMAL(10,6) NULL,
  longitude DECIMAL(10,6) NULL,
  CONSTRAINT fk_stop_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
  INDEX idx_stop_route (route_id)
) ENGINE=InnoDB;

-- KNOWN PLACES (warehouses, depots, hubs for location autocomplete)
CREATE TABLE IF NOT EXISTS places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NULL,
  latitude DECIMAL(10,6) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  category ENUM('warehouse','depot','port','mall','supplier','customer','other') NOT NULL DEFAULT 'other',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_places_name (name)
) ENGINE=InnoDB;

-- TRIPS
CREATE TABLE IF NOT EXISTS trips (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trip_code VARCHAR(30) NOT NULL UNIQUE,
  reservation_id INT NULL,
  vehicle_id INT NOT NULL,
  driver_id INT NOT NULL,
  route_id INT NULL,
  pickup_location VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  stops TEXT NULL,
  distance_km DECIMAL(10,2) NOT NULL DEFAULT 0,
  estimated_time_min INT NOT NULL DEFAULT 0,
  departure_datetime DATETIME NULL,
  arrival_datetime DATETIME NULL,
  trip_status ENUM('Scheduled','Dispatched','In Transit','Arrived','Completed','Cancelled') NOT NULL DEFAULT 'Scheduled',
  delivery_status ENUM('Pending','Out for Delivery','Delivered','Failed') NOT NULL DEFAULT 'Pending',
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_trip_res FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL,
  CONSTRAINT fk_trip_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_trip_driver FOREIGN KEY (driver_id) REFERENCES drivers(id),
  CONSTRAINT fk_trip_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL,
  INDEX idx_trip_status (trip_status),
  INDEX idx_trip_vehicle (vehicle_id),
  INDEX idx_trip_driver (driver_id)
) ENGINE=InnoDB;

-- FUEL RECORDS
CREATE TABLE IF NOT EXISTS fuel_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fuel_code VARCHAR(30) NOT NULL UNIQUE,
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fuel_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_fuel_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL,
  CONSTRAINT fk_fuel_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL,
  CONSTRAINT fk_fuel_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_fuel_vehicle (vehicle_id),
  INDEX idx_fuel_date (record_date)
) ENGINE=InnoDB;

-- TRANSPORTATION COSTS
CREATE TABLE IF NOT EXISTS transportation_costs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cost_code VARCHAR(30) NOT NULL UNIQUE,
  trip_id INT NULL,
  vehicle_id INT NULL,
  driver_id INT NULL,
  fuel_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  driver_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  toll_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  maintenance_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_costs DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost_date DATE NOT NULL,
  remarks TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cost_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL,
  CONSTRAINT fk_cost_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  CONSTRAINT fk_cost_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL,
  INDEX idx_cost_date (cost_date)
) ENGINE=InnoDB;

-- VEHICLE LOCATIONS (IoT tracking)
CREATE TABLE IF NOT EXISTS vehicle_locations (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'tracking_id',
  vehicle_id INT NOT NULL,
  driver_id INT NULL,
  trip_id INT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  speed_kmh DECIMAL(6,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_loc_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  CONSTRAINT fk_loc_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL,
  CONSTRAINT fk_loc_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL,
  INDEX idx_loc_vehicle (vehicle_id),
  INDEX idx_loc_recorded (recorded_at)
) ENGINE=InnoDB;

-- NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL COMMENT 'NULL = broadcast to role',
  target_role ENUM('admin','fleet_manager','dispatcher','driver','all') NOT NULL DEFAULT 'all',
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  link_type VARCHAR(50) NULL COMMENT 'trip,reservation,vehicle,driver,fuel,cost,none',
  link_id INT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id),
  INDEX idx_notif_role (target_role),
  INDEX idx_notif_read (is_read)
) ENGINE=InnoDB;

-- SETTINGS
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value VARCHAR(500) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- OTP VERIFICATIONS (Email OTP - 6 digit, 5min expiry, single-use)
CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  verified_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_otp_user (user_id),
  INDEX idx_otp_expires (expires_at)
) ENGINE=InnoDB;

INSERT INTO settings (setting_key, setting_value) VALUES
('company_name','SME Smart Fleet Distribution'),
('fuel_wastage_threshold_l_per_100km','15'),
('fuel_high_cost_threshold','5000'),
('registration_expiry_warning_days','30'),
('license_expiry_warning_days','30')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);
