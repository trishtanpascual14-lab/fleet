import { useEffect, useState } from 'react';

/**
 * Returns the greeting period based on the user's LOCAL browser time.
 * Uses `Date.getHours()` (local time) — never UTC, never hardcoded.
 *
 * - 05:00–11:59 → "Good morning"
 * - 12:00–17:59 → "Good afternoon"
 * - 18:00–23:59 → "Good evening"
 * - 00:00–04:59 → "Good night"
 */
export const getGreeting = (date = new Date()) => {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return 'Good morning';
  }

  if (hour >= 12 && hour < 18) {
    return 'Good afternoon';
  }

  if (hour >= 18 && hour < 24) {
    return 'Good evening';
  }

  return 'Good night';
};

/**
 * Reusable real-time greeting hook.
 * Re-evaluates every 30s so the banner flips automatically
 * (e.g. 11:59 AM → 12:00 PM) without a page refresh.
 * Cleans up the interval on unmount to prevent memory leaks.
 */
export const useGreeting = (intervalMs = 30000) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return `${getGreeting(now)}`;
};

export default getGreeting;
