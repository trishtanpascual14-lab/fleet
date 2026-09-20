const express = require('express');
const { auth, authorize, requireFullAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const authC = require('../controllers/authController');
const nextauthC = require('../controllers/nextauthController');
// OTP temporarily disabled
// const otpC = require('../controllers/otpController');
const userC = require('../controllers/userController');
const vehC = require('../controllers/vehicleController');
const drvC = require('../controllers/driverController');
const resC = require('../controllers/reservationController');
const tripC = require('../controllers/tripController');
const routeC = require('../controllers/routeController');
const fuelC = require('../controllers/fuelController');
const costC = require('../controllers/costController');
const trackC = require('../controllers/trackingController');
const sosC = require('../controllers/sosController');
const notifC = require('../controllers/notificationController');
const dashC = require('../controllers/dashboardController');
const repC = require('../controllers/reportController');
const auditC = require('../controllers/auditController');
const { uploadReceiptSingle } = require('../utils/receiptUpload');

const r = express.Router();
const M = ['admin', 'fleet_manager'];
const MD = ['admin', 'fleet_manager', 'dispatcher'];

// rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, please try again later',
  keyGenerator: (req) => `login:${req.ip}:${(req.body && req.body.email) || 'unknown'}`,
});
// OTP limiters temporarily disabled
// const otpVerifyLimiter = rateLimit({...});
// const otpResendLimiter = rateLimit({...});

// auth - OTP temporarily disabled, direct login
r.post('/auth/login', loginLimiter, authC.login);
r.post('/auth/logout', authC.logout);
r.get('/auth/me', auth, authC.me);
// NextAuth-compatible (Auth.js style) — same JWT backend
r.get('/auth/providers', nextauthC.providers);
r.get('/auth/csrf', nextauthC.csrf);
r.get('/auth/session', nextauthC.session);
r.post('/auth/signin', loginLimiter, nextauthC.signin);
r.post('/auth/signout', nextauthC.signout);
// OTP routes temporarily disabled - kept for future re-enable
// r.post('/auth/verify-otp', auth, requirePreAuth, otpVerifyLimiter, otpC.verifyOtp);
// r.post('/auth/resend-otp', auth, requirePreAuth, otpResendLimiter, otpC.resendOtp);
// r.get('/auth/otp-status', auth, requirePreAuth, otpC.otpStatus);

// users (admin only)
r.get('/users', auth, requireFullAuth, authorize('admin'), userC.list);
r.get('/users/:id', auth, requireFullAuth, userC.get);
r.post('/users', auth, requireFullAuth, authorize('admin'), userC.create);
r.put('/users/:id', auth, requireFullAuth, authorize('admin'), userC.update);
r.delete('/users/:id', auth, requireFullAuth, authorize('admin'), userC.remove);
r.patch('/users/:id/archive', auth, requireFullAuth, authorize('admin'), userC.archive);
r.patch('/users/:id/restore', auth, requireFullAuth, authorize('admin'), userC.restore);

// vehicles
r.get('/vehicles', auth, requireFullAuth, vehC.list);
r.get('/vehicles/available', auth, requireFullAuth, vehC.available);
r.get('/vehicles/:id', auth, requireFullAuth, vehC.get);
r.post('/vehicles/:id/report', auth, requireFullAuth, vehC.report);
r.post('/vehicles', auth, requireFullAuth, authorize(...M), vehC.create);
r.put('/vehicles/:id', auth, requireFullAuth, authorize(...M), vehC.update);
r.delete('/vehicles/:id', auth, requireFullAuth, authorize(...M), vehC.remove);
r.patch('/vehicles/:id/archive', auth, requireFullAuth, authorize(...M), vehC.archive);
r.patch('/vehicles/:id/restore', auth, requireFullAuth, authorize(...M), vehC.restore);

// drivers
r.get('/drivers', auth, requireFullAuth, drvC.list);
r.get('/drivers/available', auth, requireFullAuth, drvC.available);
r.get('/drivers/eligible-users', auth, requireFullAuth, authorize(...M), drvC.eligibleUsers);
r.get('/drivers/me', auth, requireFullAuth, drvC.me);
r.get('/drivers/:id', auth, requireFullAuth, drvC.get);
r.post('/drivers', auth, requireFullAuth, authorize(...M), drvC.create);
r.put('/drivers/:id', auth, requireFullAuth, authorize(...M), drvC.update);
r.delete('/drivers/:id', auth, requireFullAuth, authorize(...M), drvC.remove);
r.patch('/drivers/:id/archive', auth, requireFullAuth, authorize(...M), drvC.archive);
r.patch('/drivers/:id/restore', auth, requireFullAuth, authorize(...M), drvC.restore);

// reservations
r.get('/reservations', auth, requireFullAuth, resC.list);
r.get('/reservations/:id', auth, requireFullAuth, resC.get);
r.post('/reservations', auth, requireFullAuth, authorize(...MD), resC.create);
r.put('/reservations/:id', auth, requireFullAuth, authorize(...MD), resC.update);
r.patch('/reservations/:id/status', auth, requireFullAuth, authorize(...MD), resC.setStatus);
r.patch('/reservations/:id/reject', auth, requireFullAuth, authorize(...MD), resC.reject);
r.delete('/reservations/:id', auth, requireFullAuth, authorize(...M), resC.remove);
r.patch('/reservations/:id/archive', auth, requireFullAuth, authorize(...M), resC.archive);
r.patch('/reservations/:id/restore', auth, requireFullAuth, authorize(...M), resC.restore);

// trips
r.get('/trips', auth, requireFullAuth, tripC.list);
r.get('/trips/mine', auth, requireFullAuth, tripC.myTrips);
r.get('/trips/:id', auth, requireFullAuth, tripC.get);
r.post('/trips', auth, requireFullAuth, authorize(...MD), tripC.create);
r.put('/trips/:id', auth, requireFullAuth, authorize(...MD), tripC.update);
r.patch('/trips/:id/status', auth, requireFullAuth, tripC.setStatus);
r.delete('/trips/:id', auth, requireFullAuth, authorize(...M), tripC.remove);
r.patch('/trips/:id/archive', auth, requireFullAuth, authorize(...M), tripC.archive);
r.patch('/trips/:id/restore', auth, requireFullAuth, authorize(...M), tripC.restore);

// routes
r.get('/routes/places', auth, requireFullAuth, routeC.places);
r.get('/routes/resolve', auth, requireFullAuth, routeC.resolve);
r.get('/routes/by-reservation/:reservationId', auth, requireFullAuth, routeC.byReservation);
r.post('/routes/calculate', auth, requireFullAuth, routeC.calculate);
r.post('/routes/navigate', auth, requireFullAuth, routeC.navigate);
r.get('/routes', auth, requireFullAuth, routeC.list);
r.get('/routes/:id', auth, requireFullAuth, routeC.get);
r.post('/routes', auth, requireFullAuth, authorize(...MD), routeC.create);
r.put('/routes/:id', auth, requireFullAuth, authorize(...MD), routeC.update);
r.patch('/routes/:id/status', auth, requireFullAuth, authorize(...MD), routeC.setStatus);
r.post('/routes/:id/recalculate', auth, requireFullAuth, authorize(...MD), routeC.recalculate);
r.delete('/routes/:id', auth, requireFullAuth, authorize(...M), routeC.remove);
r.patch('/routes/:id/archive', auth, requireFullAuth, authorize(...M), routeC.archive);
r.patch('/routes/:id/restore', auth, requireFullAuth, authorize(...M), routeC.restore);

// fuel
r.get('/fuel', auth, requireFullAuth, fuelC.list);
r.get('/fuel/summary', auth, requireFullAuth, fuelC.summary);
r.get('/fuel/:id/receipt', auth, requireFullAuth, fuelC.receipt);
r.get('/fuel/:id', auth, requireFullAuth, fuelC.get);
r.post('/fuel', auth, requireFullAuth, authorize(...MD, 'driver'), uploadReceiptSingle, fuelC.create);
r.put('/fuel/:id', auth, requireFullAuth, authorize(...MD), fuelC.update);
r.delete('/fuel/:id', auth, requireFullAuth, authorize(...M), fuelC.remove);
r.patch('/fuel/:id/archive', auth, requireFullAuth, authorize(...M), fuelC.archive);
r.patch('/fuel/:id/restore', auth, requireFullAuth, authorize(...M), fuelC.restore);

// costs
r.get('/costs', auth, requireFullAuth, costC.list);
r.get('/costs/summary', auth, requireFullAuth, costC.summary);
r.post('/costs', auth, requireFullAuth, authorize(...M), costC.create);
r.put('/costs/:id', auth, requireFullAuth, authorize(...M), costC.update);
r.delete('/costs/:id', auth, requireFullAuth, authorize(...M), costC.remove);
r.patch('/costs/:id/archive', auth, requireFullAuth, authorize(...M), costC.archive);
r.patch('/costs/:id/restore', auth, requireFullAuth, authorize(...M), costC.restore);

// tracking (ingest open for IoT devices)
r.post('/tracking/location', trackC.ingest);
r.get('/tracking/vehicles', auth, requireFullAuth, trackC.vehicles);
r.get('/tracking/vehicle/:id', auth, requireFullAuth, trackC.history);
r.post('/tracking/simulate', auth, requireFullAuth, authorize(...M), trackC.simulate);

 // sos emergency alerts
r.get('/sos', auth, requireFullAuth, sosC.list);
r.get('/sos/:id', auth, requireFullAuth, sosC.get);
r.post('/sos', auth, requireFullAuth, sosC.create);
r.patch('/sos/:id/resolve', auth, requireFullAuth, sosC.resolve);
r.patch('/sos/:id/cancel', auth, requireFullAuth, sosC.cancel);

 // notifications
r.get('/notifications', auth, requireFullAuth, notifC.list);
r.put('/notifications/:id/read', auth, requireFullAuth, notifC.markRead);
r.put('/notifications/read-all', auth, requireFullAuth, notifC.markAll);

// dashboard + reports + settings
r.get('/dashboard', auth, requireFullAuth, dashC.stats);
r.get('/reports/:type', auth, requireFullAuth, repC.generate);
r.get('/settings', auth, requireFullAuth, authorize(...M), repC.getSettings);
r.put('/settings', auth, requireFullAuth, authorize(...M), repC.saveSettings);

// audit logs (listing/detail admin only; module-view open to all auth roles)
r.get('/audit-logs', auth, requireFullAuth, authorize('admin'), auditC.list);
r.get('/audit-logs/stats', auth, requireFullAuth, authorize('admin'), auditC.getStats);
r.get('/audit-logs/actions', auth, requireFullAuth, authorize('admin'), auditC.getActions);
r.get('/audit-logs/modules', auth, requireFullAuth, authorize('admin'), auditC.getModules);
r.post('/audit-logs/module-view', auth, requireFullAuth, auditC.moduleView);
r.get('/audit-logs/:id', auth, requireFullAuth, authorize('admin'), auditC.get);

module.exports = r;
