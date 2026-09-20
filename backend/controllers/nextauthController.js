// NextAuth-compatible endpoints built on existing JWT auth.
// Exposes: GET /providers, GET /session, GET /csrf, POST /signin, POST /signout
// so frontend `next-auth`-style clients work without migrating to Next.js.
const jwt = require('jsonwebtoken');
const authC = require('./authController');

const JWT_SECRET = process.env.JWT_SECRET || 'smartfleet_capstone_secret_2026';

function fromBearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

module.exports = {
  providers(req, res) {
    res.json({
      credentials: { id: 'credentials', name: 'Credentials', type: 'credentials' },
    });
  },
  csrf(req, res) {
    res.json({ csrfToken: 'fleet-csrf-passthrough' });
  },
  session(req, res) {
    const token = fromBearer(req);
    if (!token) return res.json({});
    try {
      const user = jwt.verify(token, JWT_SECRET);
      return res.json({ user, expires: new Date(Date.now() + 8 * 3600 * 1000).toISOString() });
    } catch {
      return res.json({});
    }
  },
  // POST /signin { email, password } -> same as existing login controller
  signin(req, res, next) {
    return authC.login(req, res, next);
  },
  signout(req, res) {
    return authC.logout(req, res);
  },
};
