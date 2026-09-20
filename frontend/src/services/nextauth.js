// NextAuth-style client wrapper for Vite + React.
// Uses existing JWT REST endpoints (/api/auth/signin, /session, /signout)
// so docs can reference NextAuth.js flows without migrating to Next.js.
import api from './api';

export async function signIn(email, password) {
  const { data } = await api.post('/auth/signin', { email, password });
  const token = data?.token;
  const user = data?.user;
  if (token) localStorage.setItem('fleet_token', token);
  if (user) localStorage.setItem('fleet_user', JSON.stringify(user));
  return { user, token, raw: data };
}

export async function signOut() {
  try {
    await api.post('/auth/signout');
  } catch {}
  localStorage.removeItem('fleet_token');
  localStorage.removeItem('fleet_user');
}

export async function getSession() {
  const { data } = await api.get('/auth/session');
  return data?.user ? data : null;
}

export async function getProviders() {
  const { data } = await api.get('/auth/providers');
  return data;
}
