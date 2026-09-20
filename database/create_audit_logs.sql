-- Audit Logs Table for Fleet Management System
-- Database: fleet_db (MySQL / MariaDB)
-- Run: mysql -u root fleet_db < database/create_audit_logs.sql

USE fleet_db;

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL COMMENT 'FK to users.id - NULL for system actions',
  action VARCHAR(100) NOT NULL COMMENT 'Action type: LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, USER_CREATED, etc.',
  module VARCHAR(50) NOT NULL COMMENT 'Module: auth, users, vehicles, drivers, reservations, trips, routes, fuel, costs, tracking, sos',
  resource VARCHAR(100) NULL COMMENT 'e.g. Fuel Transaction, Reservation, Dashboard',
  record_id INT NULL COMMENT 'ID of the affected record (if applicable)',
  description VARCHAR(500) NULL COMMENT 'human-readable activity summary',
  route VARCHAR(255) NULL COMMENT 'server request path, e.g. /api/fuel/9',
  method VARCHAR(10) NULL COMMENT 'HTTP method: GET, POST, ...',
  old_values JSON NULL COMMENT 'Previous values before change',
  new_values JSON NULL COMMENT 'New values after change',
  ip_address VARCHAR(45) NULL COMMENT 'IPv4 or IPv6 address',
  user_agent TEXT NULL COMMENT 'Browser/client user agent',
  metadata JSON NULL COMMENT 'extra context (codes, filters, counts)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_module (module),
  INDEX idx_audit_record (record_id),
  INDEX idx_audit_created (created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verify table creation
DESCRIBE audit_logs;

-- Show indexes
SHOW INDEX FROM audit_logs;