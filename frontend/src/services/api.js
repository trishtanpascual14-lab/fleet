import axios from 'axios';

// Prod-ready: set VITE_API_URL=https://api.mo-domain.com sa Vercel.
// Pag walang env (local), fallback sa '/api' para gumana pa rin Vite proxy.
const baseURL = import.meta.env?.VITE_API_URL || '/api';

const api = axios.create({ baseURL, timeout: 12000 });

api.interceptors.request.use((cfg) => {
  if (!cfg.headers.Authorization) {
    const t = localStorage.getItem('fleet_token');
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
  }
  if (import.meta.env?.DEV && cfg.url?.includes('/reservations')) {
    console.log('Reservations API request:', {
      method: cfg.method?.toUpperCase(),
      url: cfg.url,
      params: cfg.params,
      body: cfg.data
    });
  }
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (e) => {
    const status = e.response?.status;
    // OTP temporarily disabled - no OTP_REQUIRED handling
    if (status === 401 && !location.pathname.includes('/login') && !location.pathname.includes('/driver/login')) {
      localStorage.removeItem('fleet_token');
      localStorage.removeItem('fleet_user');
      location.href = '/login';
    }
    return Promise.reject(e);
  }
);

export default api;
