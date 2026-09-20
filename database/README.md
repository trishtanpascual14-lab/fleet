# Fleet Management System — Database `fleet_db`

Clean, normalized MySQL database for the existing Fleet System at `C:\xamppppp\htdocs\fleet`.
Replaces the messy `smart_fleet_db` / legacy `fleet` DB without modifying or deleting the old data.

Old DB (`fleet` on this XAMPP, originally `smart_fleet_db`) is **kept as backup** until the new DB is fully tested:
```sql
-- NEVER run these until verified:
-- DROP DATABASE fleet;
-- DROP DATABASE fleet_db;
```

---

## 1. Database Name

| DB | Purpose |
|---|---|
| `fleet` (old, was `smart_fleet_db`) | Backup / reference — do not modify |
| `fleet_db` (new) | **Active** clean database |

Create / re-import:
```
mysql -u root < database/fleet_db.sql
```
or phpMyAdmin → select `fleet_db` → Import → `fleet_db.sql`.

XAMPP MySQL 10.4.32-MariaDB is utf8mb4 compatible. All tables use `ENGINE=InnoDB` with `utf8mb4_unicode_ci`.

---

## 2. Tables (15)

Every table exists because backend code queries it (grep of `backend/controllers/*.js`, `backend/utils/*.js`, `backend/config/db.js`):

| # | Table | Purpose | PK | Key FKs |
|---|---|---|---|---|
| 1 | `vehicles` | Fleet inventory | `id` | — |
| 2 | `users` | Accounts + auth, JWT, OTP target | `id` | `driver_id` → `drivers.id` (SET NULL) |
| 3 | `drivers` | Driver profiles, one-to-one with `users` when `role='driver'` | `id` | `user_id` → `users.id`, `assigned_vehicle_id` → `vehicles.id` |
| 4 | `places` | Known warehouses/depots/ports for location autocomplete | `id` | — |
| 5 | `routes` | Planned/optimized routes (origin→destination + stops), used by reservations & trips | `id` | `vehicle_id`, `driver_id`, `created_by` → `users`, `reservation_id` → `reservations` |
| 6 | `reservations` | Booking requests (route-derived pickup/destination) | `id` | `vehicle_id`, `driver_id`, `requested_by` → `users`, `route_id` → `routes` |
| 7 | `route_stops` | Ordered stops per route | `id` | `route_id` → `routes` (CASCADE) |
| 8 | `trips` | Dispatched trips (vehicle+driver+route), auto cost row on completion | `id` | `vehicle_id`, `driver_id` (RESTRICT), `route_id`, `reservation_id` |
| 9 | `fuel_records` | Fuel purchases / consumption | `id` | `vehicle_id` (RESTRICT), `driver_id`, `trip_id`, `created_by` |
| 10 | `transportation_costs` | Cost breakdown per trip | `id` | `trip_id`, `vehicle_id`, `driver_id` |
| 11 | `vehicle_locations` | GPS/IoT tracking history | `id` | `vehicle_id` (CASCADE), `driver_id`, `trip_id` |
| 12 | `notifications` | In-app notifications (role or user-targeted) | `id` | `user_id` → `users` |
| 13 | `settings` | Key-value config (fuel thresholds, expiry warnings, company name) | `id` | — |
| 14 | `otp_verifications` | Email OTP (6-digit, bcrypt, 5-min expiry, 5 attempts, single-use) | `id` | `user_id` → `users` (CASCADE) |
| 15 | `sos_alerts` | **NEW** — Emergency SOS from drivers (was missing from old schema) | `id` | `driver_id`, `vehicle_id`, `trip_id`, `resolved_by` → `users` |

### What changed vs old `smart_fleet_db`

* **`vehicle_locations`** now has `driver_id INT NULL` + `heading_deg DECIMAL(5,2) NULL` — both expected by `backend/controllers/trackingController.js:ingest` (`INSERT ... heading_deg ...`, auto-fills `driver_id` from JWT/trip). Old backup lacked both columns, causing silent data loss.
* **`sos_alerts`** is new — `backend/controllers/sosController.js` and `trackingController.js` live-sync (`update sos_alerts set latitude/longitude where status='ACTIVE'`) query this table, but neither `database/schema.sql` nor `database/backup.sql` ever created it. Without this table the SOS endpoints return 500.
* Circular FKs (`users.driver_id` ↔ `drivers.user_id`, `routes.reservation_id` ↔ `reservations.route_id`) are now created via deferred `ALTER TABLE` after both tables exist, so the SQL imports cleanly even with `FOREIGN_KEY_CHECKS=1`.
* All indexes are explicit and non-duplicate (e.g. `uq_users_email`, `idx_vehicles_status`, `idx_otp_expires`).

No tables were invented beyond what the code uses. No duplicate tables.

---

## 3. Role System

`users.role ENUM('admin','fleet_manager','dispatcher','driver')` — these are the only values checked by `backend/middleware/auth.js` `authorize()` and `backend/routes/api.js`:

* `admin` — full access, user management
* `fleet_manager` — fleet + vehicle/driver write access (`M = ['admin','fleet_manager']` in `api.js`)
* `dispatcher` — reservations/trips/routes/fuel write (`MD = ['admin','fleet_manager','dispatcher']`)
* `driver` — own trips/vehicles/locations/SOS only

Email is `UNIQUE`. Passwords are bcrypt hashes (cost 10) — see `backend/controllers/authController.js` (`bcrypt.compare`) and `backend/controllers/userController.js` (`bcrypt.hash`).

Two-way driver link:
```
users.driver_id  → drivers.id   (ON DELETE SET NULL)
drivers.user_id  → users.id     (ON DELETE SET NULL, UNIQUE)
```
`drivers.user_id` is the canonical link; `users.driver_id` is kept in sync so `jwt.driver_id` is populated at login. See `backend/controllers/driverController.js:create/update` and `backend/seed.js`.

---

## 4. OTP Authentication

Flow matches `backend/controllers/authController.js` → `backend/utils/otp.js` → `backend/controllers/otpController.js`:

```
Email + Password → credentials verified → createOtp() → sendOtpEmail() → preAuth JWT (10m)
→ POST /api/auth/verify-otp (preAuth JWT) → single-use → full JWT (8h) → role dashboards
```

Table `otp_verifications` — see `backend/utils/otp.js:ensureOtpTable`:

| Column | Type | Purpose |
|---|---|---|
| `id` | INT PK | |
| `user_id` | INT FK → users | |
| `otp_hash` | VARCHAR(255) | `bcrypt.hash(6-digit OTP, 10)` — never plaintext |
| `expires_at` | DATETIME | `NOW() + 5 minutes` |
| `attempts` | INT | incremented on each wrong guess |
| `max_attempts` | INT | 5 |
| `verified_at` | DATETIME NULL | set on success — enforces single-use (`verified_at IS NULL AND expires_at > NOW()` in `getActiveOtp`) |
| `created_at` / `updated_at` | TIMESTAMP | |

Constants from `backend/utils/otp.js`:
```js
OTP_EXPIRES_MINUTES = 5
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SEC = 60
```

Behavior enforced in code (not DB triggers, so schema must allow it):
* `createOtp` calls `invalidatePreviousOtps` → `UPDATE ... SET expires_at=NOW() WHERE verified_at IS NULL AND expires_at > NOW()`
* `resendOtp` checks `canResend` (60s cooldown via `created_at`)
* `verifyOtp` checks `attempts >= max_attempts`, `expires_at <= NOW()`, then `bcrypt.compare` and `verified_at=NOW()` + invalidates remaining

Seed does **not** pre-create OTP rows — they are generated on login.

---

## 5. Vehicle / Driver / Trip / Route Relationships

```
vehicles 1──∞ drivers.assigned_vehicle_id
vehicles 1──∞ trips.vehicle_id
drivers  1──∞ trips.driver_id
routes   1──∞ route_stops.route_id
routes   1──∞ trips.route_id  (nullable)
reservations 1──∞ trips.reservation_id (nullable)
places   (lookup only, joined by routeService string matching)
```

Vehicle `plate_number` and `vehicle_code` are `UNIQUE`. Driver `license_number` and `driver_code` are `UNIQUE`. `drivers.user_id` is `UNIQUE` (one driver profile per user).

`vehicle_locations` and `sos_alerts` reference both vehicle and driver so GPS history survives vehicle reassignment.

---

## 6. Foreign Keys and Delete Behavior

| FK | ON UPDATE | ON DELETE | Rationale |
|---|---|---|---|
| `users.driver_id` | CASCADE | SET NULL | Deleting driver unlinks user, does not delete user |
| `drivers.user_id` | CASCADE | SET NULL | Deleting user unlinks driver, preserves driver history |
| `drivers.assigned_vehicle_id` | CASCADE | SET NULL | Vehicle deleted → driver becomes unassigned |
| `reservations.*`, `routes.*`, `fuel_records.driver_id/trip_id`, `transportation_costs.*`, `notifications.user_id` | CASCADE | SET NULL | Optional links cleared, historical header preserved |
| `trips.vehicle_id`, `trips.driver_id`, `fuel_records.vehicle_id`, `sos_alerts.driver_id/vehicle_id` | CASCADE | RESTRICT | Block deleting a vehicle/driver with trip/fuel/SOS history |
| `vehicle_locations.vehicle_id` | CASCADE | CASCADE | Locations are ephemeral IoT data tied to vehicle |
| `route_stops.route_id` | CASCADE | CASCADE | Stops have no meaning without parent route |
| `otp_verifications.user_id`, `sos_alerts.resolved_by` | CASCADE | CASCADE / SET NULL | OTPs deleted with user; SOS resolver cleared |

All snake_case: `user_id`, `driver_id`, `vehicle_id`, `trip_id`, `route_id`, `created_at`, `expires_at`, etc.

---

## 7. Indexes

Beyond PK/UNIQUE, B-tree indexes on every column used in `WHERE/JOIN/ORDER BY` in controllers:

```
users:          (role), (driver_id)
drivers:        (status), (user_id) UNIQUE
vehicles:       (status)
reservations:   (status), (reservation_date)
routes:         (status)
route_stops:    (route_id)
trips:          (trip_status), (vehicle_id), (driver_id), (route_id)
fuel_records:   (vehicle_id), (record_date)
transportation_costs: (cost_date)
vehicle_locations: (vehicle_id), (driver_id), (trip_id), (recorded_at)
notifications:  (user_id), (target_role), (is_read)
otp_verifications: (user_id), (expires_at)
sos_alerts:     (driver_id), (vehicle_id), (status)
places:         (name)
```

No duplicate indexes (e.g. `email` is UNIQUE, so no separate `idx_users_email` beyond the unique key — but kept for clarity as in original).

---

## 8. Seed Data

Inserted by `fleet_db.sql` (idempotent via `ON DUPLICATE KEY UPDATE`):

| Email | Role | Name | Password |
|---|---|---|---|
| `admin@fleet.com` | `admin` | System Administrator | `password123` |
| `manager@fleet.com` | `fleet_manager` | Fleet Manager | `password123` |
| `dispatcher@fleet.com` | `dispatcher` | Dispatcher One | `password123` |
| `driver@fleet.com` | `driver` | Juan Dela Cruz | `password123` |

All use the same bcrypt hash `$2a$10$/uWBQdnuGx0F5/cMXyMzyeFEEVZM3eDvKEA9rvX4ZkVRNKYCSnB7e` (hash of `password123` with cost 10, matching `backend/seed.js`). For any additional test accounts, use the API:

```
POST /api/users  { name, email, password, role, driver_id?, phone? }  (admin only)
```
or hash manually: `node -e "console.log(require('bcryptjs').hashSync('password123',10))"` and insert.

Places (7) and settings (5) are also seeded for location autocomplete and dashboard thresholds.

For full demo dataset (10 vehicles/drivers/reservations/trips etc.) run the existing seeder **after** pointing it at `fleet_db`:
```
cd backend
node seed.js
```

---

## 9. Environment

`backend/.env` must point at the new DB:

```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=fleet_db
JWT_SECRET=smartfleet_capstone_secret_2026
JWT_EXPIRES_IN=8h
JWT_PRE_AUTH_EXPIRES_IN=10m
MAIL_HOST=
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_FROM_ADDRESS=
MAIL_FROM_NAME=Financial Management System
OTP_EXPIRES_MINUTES=5
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_SEC=60
```

`backend/config/db.js:7` reads `process.env.DB_NAME || 'smart_fleet_db'` — after the `.env` change it will log `MySQL connected: fleet_db`.

No backend SQL needs changing — all `SELECT/INSERT/UPDATE` table and column names are preserved.

---

## 10. Import & Verify

```bash
# 1. Import (keeps old `fleet` DB untouched)
mysql -u root < database/fleet_db.sql

# 2. Verify tables
mysql -u root -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='fleet_db';"

# 3. Verify FKs
mysql -u root -e "SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='fleet_db' AND REFERENCED_TABLE_NAME IS NOT NULL;"

# 4. Start backend
cd backend
npm install
node server.js
# expect: MySQL connected: fleet_db

# 5. Test OTP flow
# POST /api/auth/login {email:"admin@fleet.com",password:"password123"} → preAuthToken
# POST /api/auth/verify-otp {otp:"<from console or email>"} (with preAuth Bearer) → full token
```

---

## 11. Files Changed

* New: `database/fleet_db.sql` — full clean schema + seed
* New: `database/README.md` — this file
* Modified: `backend/.env` — `DB_NAME=fleet_db`
* Unchanged: `backend/config/db.js`, all controllers, `backend/utils/otp.js`, `backend/seed.js`
* Preserved: `database/schema.sql`, `database/backup.sql` (old DB dump, UTF-16), old `fleet` database
