// Seed realistic demo data: users, vehicles, drivers, reservations, trips, fuel, costs, locations, notifications
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./config/db');
const { calculateRoute } = require('./utils/routeService');

const LOCS = [
  ['Warehouse A', 'SM Mall'], ['Port of Manila', 'Makati'], ['Quezon City', 'Taguig'],
  ['Manila', 'Cavite'], ['Pasig', 'Laguna'], ['Bulacan', 'Manila'],
  ['Pampanga', 'Quezon City'], ['Batangas', 'Makati'], ['Cebu', 'Mandaue'],
  ['Davao', 'Tagum']
];

async function run() {
  try {
    console.log('Seeding...');
    for (const t of ['notifications', 'vehicle_locations', 'transportation_costs', 'fuel_records', 'trips', 'route_stops', 'routes', 'reservations', 'drivers', 'users', 'vehicles']) {
      await db.query(`DELETE FROM ${t}`);
    }
    const hash = await bcrypt.hash('password123', 10);
    const users = [
      ['System Administrator', 'admin@fleet.com', 'admin', null],
      ['Fleet Manager', 'manager@fleet.com', 'fleet_manager', null],
      ['Dispatcher One', 'dispatcher@fleet.com', 'dispatcher', null]
    ];
    for (const [n, e, ro] of users) await db.query('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)', [n, e, hash, ro]);

    const types = ['Truck', 'Van', 'Truck', 'Pickup', 'Van', 'Truck', 'Van', 'Motorcycle', 'Truck', 'Van'];
    const fuels = ['Diesel', 'Gasoline', 'Diesel', 'Gasoline', 'Diesel', 'Diesel', 'Gasoline', 'Gasoline', 'Diesel', 'Diesel'];
    const plates = ['ABC-1001', 'ABC-1002', 'XYZ-2001', 'XYZ-2002', 'DEF-3001', 'DEF-3002', 'GHI-4001', 'GHI-4002', 'JKL-5001', 'JKL-5002'];
    const statuses = ['Available', 'Available', 'Available', 'Available', 'Available', 'Available', 'Maintenance', 'Available', 'Available', 'In Transit'];
    for (let i = 0; i < 10; i++) {
      await db.query(
        "INSERT INTO vehicles (vehicle_code,plate_number,vehicle_type,fuel_type,capacity,registration_number,registration_expiry,status,notes) VALUES (?,?,?,?,?,?,?,?,?)",
        [`VEH-2026-${1001 + i}`, plates[i], types[i], fuels[i], 1000 + i * 500, `REG-${7000 + i}`, i === 2 ? '2026-09-20' : '2027-06-30', statuses[i], types[i] + ' for SME deliveries']
      );
    }

    const names = ['Juan Dela Cruz', 'Maria Santos', 'Jose Rizal Jr', 'Ana Reyes', 'Mark Villanueva', 'Rosa Garcia', 'Paolo Aquino', 'Liza Moreno', 'Ken Torres', 'Irene Castro'];
    const dst = ['Available', 'Available', 'Available', 'Available', 'Available', 'Available', 'Off Duty', 'Available', 'Available', 'On Trip'];
    for (let i = 0; i < 10; i++) {
      await db.query(
        'INSERT INTO drivers (driver_code,full_name,contact_number,license_number,license_expiry,status,total_trips,completed_trips,performance_rating) VALUES (?,?,?,?,?,?,?,?,?)',
        [`DRV-2026-${2001 + i}`, names[i], `0917-100-00${10 + i}`, `LIC-${5000 + i}`, i === 3 ? '2026-09-25' : '2027-12-31', dst[i], 0, 0, 0]
      );
    }
    // driver login linked to driver 1 (two-way link: users.driver_id <-> drivers.user_id)
    await db.query("INSERT INTO users (name,email,password,role,driver_id) VALUES (?,?,?,'driver',1)", ['Juan Dela Cruz', 'driver@fleet.com', hash]);
    await db.query('UPDATE drivers SET user_id=(SELECT id FROM users WHERE driver_id=drivers.id LIMIT 1) WHERE id IN (SELECT driver_id FROM users WHERE driver_id IS NOT NULL)');

    const [vehs] = await db.query('SELECT id FROM vehicles ORDER BY id');
    const [drvs] = await db.query('SELECT id FROM drivers ORDER BY id');
    const today = new Date().toISOString().slice(0, 10);

    // 10 reservations
    const rstat = ['Pending', 'Pending', 'Approved', 'Reserved', 'Dispatched', 'Completed', 'Pending', 'Approved', 'Cancelled', 'Pending'];
    for (let i = 0; i < 10; i++) {
      const [o, dest] = LOCS[i];
      await db.query(
        "INSERT INTO reservations (reservation_code,vehicle_id,driver_id,requested_by,reservation_date,pickup_location,destination,status) VALUES (?,?,?,?,?,?,?,?)",
        [`RES-2026-${3001 + i}`, vehs[i % 10].id, drvs[i % 10].id, 3, today, o, dest, 'Pending']
      );
    }
    // approve some to exercise workflow states
    for (const [id, st] of [[3, 'Approved'], [4, 'Reserved'], [5, 'Dispatched'], [6, 'Completed'], [8, 'Approved'], [9, 'Cancelled']]) {
      await db.query('UPDATE reservations SET status=? WHERE id=?', [st, id]);
    }
    await db.query("UPDATE vehicles SET status='Reserved' WHERE id IN (3,4,8)");
    await db.query("UPDATE vehicles SET status='Dispatched' WHERE id=5");
    await db.query("UPDATE drivers SET status='Assigned' WHERE id IN (3,4,8)");
    await db.query("UPDATE drivers SET status='On Trip' WHERE id IN (5,10)");

    // 10 trips (mix of statuses) with auto route calc
    const tstat = ['Scheduled', 'Dispatched', 'In Transit', 'In Transit', 'Completed', 'Completed', 'Arrived', 'Scheduled', 'Cancelled', 'Completed'];
    const dstat = ['Pending', 'Out for Delivery', 'Out for Delivery', 'Out for Delivery', 'Delivered', 'Delivered', 'Delivered', 'Pending', 'Failed', 'Delivered'];
    for (let i = 0; i < 10; i++) {
      const [o, dest] = LOCS[i];
      const calc = await calculateRoute(o, dest, i % 3 === 0 ? ['Pasig'] : []);
      const dep = new Date(Date.now() - (10 - i) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      await db.query(
        `INSERT INTO trips (trip_code,reservation_id,vehicle_id,driver_id,pickup_location,destination,stops,distance_km,estimated_time_min,departure_datetime,arrival_datetime,trip_status,delivery_status,notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [`TRIP-2026-${4001 + i}`, i < 6 ? i + 1 : null, vehs[(i + 2) % 10].id, drvs[(i + 1) % 10].id, o, dest,
          i % 3 === 0 ? 'Pasig' : '', calc.distanceKm, calc.estimatedMin, dep,
          ['Completed', 'Cancelled'].includes(tstat[i]) ? dep : null, tstat[i], dstat[i], `Trip ${i + 1}`]
      );
    }
    // make completed-trip vehicles available again
    await db.query("UPDATE vehicles SET status='Available' WHERE id NOT IN (SELECT vehicle_id FROM trips WHERE trip_status IN ('Scheduled','Dispatched','In Transit')) AND status NOT IN ('Maintenance')");

    // fuel records
    const [trips] = await db.query('SELECT id, vehicle_id, driver_id FROM trips');
    for (let i = 0; i < 15; i++) {
      const t = trips[i % trips.length];
      const liters = +(20 + Math.random() * 60).toFixed(2);
      const price = 58 + (i % 5);
      await db.query(
        "INSERT INTO fuel_records (fuel_code,vehicle_id,driver_id,trip_id,record_date,fuel_type,liters,price_per_liter,total_cost,odometer_reading,fuel_station) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [`FUEL-2026-${5001 + i}`, t.vehicle_id, t.driver_id, t.id, today, 'Diesel', liters, price, +(liters * price).toFixed(2), 50000 + i * 350, `Station ${i % 4 + 1}`]
      );
    }
    // one high-cost outlier for wastage monitoring
    await db.query("INSERT INTO fuel_records (fuel_code,vehicle_id,driver_id,record_date,fuel_type,liters,price_per_liter,total_cost,fuel_station,notes) VALUES ('FUEL-2026-5999',1,1,?, 'Diesel',200,65,13000,'Station X','Outlier for wastage demo')", [today]);

    // transportation costs per trip
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      const fuel = +(1500 + Math.random() * 3000).toFixed(2);
      const driver = +(800 + Math.random() * 700).toFixed(2);
      const toll = +(100 + Math.random() * 400).toFixed(2);
      const maint = +(i % 4 === 0 ? 1200 : 0).toFixed(2);
      const other = +(i % 3 === 0 ? 300 : 0).toFixed(2);
      await db.query(
        'INSERT INTO transportation_costs (cost_code,trip_id,vehicle_id,driver_id,fuel_cost,driver_cost,toll_cost,maintenance_cost,other_costs,total_cost,cost_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [`COST-2026-${6001 + i}`, t.id, t.vehicle_id, t.driver_id, fuel, driver, toll, maint, other, +(fuel + driver + toll + maint + other).toFixed(2), today]
      );
    }

    // vehicle locations (mock IoT)
    for (const t of trips.slice(0, 8)) {
      for (let k = 0; k < 3; k++) {
        await db.query('INSERT INTO vehicle_locations (vehicle_id,trip_id,latitude,longitude,speed_kmh,status) VALUES (?,?,?,?,?,?)',
          [t.vehicle_id, t.id, (14.5 + Math.random() * 0.3).toFixed(6), (120.9 + Math.random() * 0.3).toFixed(6), (25 + Math.random() * 55).toFixed(1), 'moving']);
      }
    }

    // driver stats
    for (const d of drvs) {
      const [[a]] = await db.query('SELECT COUNT(*) c FROM trips WHERE driver_id=?', [d.id]);
      const [[b]] = await db.query("SELECT COUNT(*) c FROM trips WHERE driver_id=? AND trip_status='Completed'", [d.id]);
      await db.query('UPDATE drivers SET total_trips=?, completed_trips=?, performance_rating=? WHERE id=?', [a.c, b.c, a.c ? +((b.c / a.c) * 5).toFixed(2) : 0, d.id]);
    }

    // notifications
    const notifs = [
      ['fleet_manager', 'New reservation', 'New reservation Warehouse A → SM Mall needs approval', 'reservation', 1],
      ['dispatcher', 'Reservation approved', 'Reservation RES-2026-3003 approved — vehicle reserved', 'reservation', 3],
      ['driver', 'Trip assigned', 'Trip TRIP-2026-4002 has been assigned to you', 'trip', 2],
      ['fleet_manager', 'Vehicle maintenance', 'Vehicle GHI-4001 set to Maintenance', 'vehicle', 7],
      ['fleet_manager', 'Registration expiring', 'Vehicle XYZ-2001 registration expires soon', 'vehicle', 3],
      ['fleet_manager', 'License expiring', 'Driver Ana Reyes license expires soon', 'driver', 4],
      ['fleet_manager', 'High fuel consumption', 'Fuel record ₱13000 exceeds threshold', 'fuel', 16],
      ['all', 'Delivery completed', 'Trip TRIP-2026-4005 delivered', 'trip', 5]
    ];
    for (const [role, title, msg, lt, lid] of notifs) {
      await db.query('INSERT INTO notifications (target_role,title,message,link_type,link_id) VALUES (?,?,?,?,?)', [role, title, msg, lt, lid]);
    }
    console.log('Seed complete.');
    process.exit(0);
  } catch (e) { console.error('Seed failed:', e); process.exit(1); }
}
run();
