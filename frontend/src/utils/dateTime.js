/**
 * Centralized Date/Time Utility for Philippines (Asia/Manila) timezone
 * UTC+08:00
 * 
 * All reservation date/time operations must go through this utility
 * to ensure consistent timezone handling across the application.
 */

const PH_OFFSET_HOURS = 8; // UTC+08:00

/**
 * Get current date in Philippines timezone (YYYY-MM-DD)
 */
export function getCurrentDatePh() {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toISOString().slice(0, 10);
}

/**
 * Get current time in Philippines timezone (HH:mm)
 */
export function getCurrentTimePh() {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toTimeString().slice(0, 5);
}

/**
 * Get current date/time in Philippines timezone as separate components
 */
export function getCurrentDateTimeComponents() {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: phTime.toISOString().slice(0, 10),
    time: phTime.toTimeString().slice(0, 5),
    datetime: phTime.toISOString().slice(0, 19).replace('T', ' ')
  };
}

/**
 * Get current Philippines datetime as ISO string (YYYY-MM-DDTHH:mm:ss)
 */
export function getCurrentDateTimeISO() {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Get minimum pickup time for a given date
 * If date is today, return current time + 15 minutes lead time
 * If date is in future, return business hours start (06:00)
 */
export function getMinPickupTimeForDate(dateStr) {
  const today = getCurrentDatePh();
  if (dateStr === today) {
    // Today: current time + 15 minutes lead time
    const { time } = getCurrentDateTimeComponents();
    const [hours, minutes] = time.split(':').map(Number);
    let totalMinutes = hours * 60 + minutes + 15;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
  }
  // Future date: return business hours start (e.g., 06:00)
  return '06:00';
}

/**
 * Combine date and time strings into a datetime string for API
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timeStr - HH:mm or HH:mm:ss
 * @returns {string} YYYY-MM-DD HH:mm:ss
 */
export function combineDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  const time = timeStr.length === 5 ? timeStr + ':00' : timeStr;
  return `${dateStr} ${time}`;
}

/**
 * Format a datetime string for display (YYYY-MM-DD HH:mm:ss -> formatted)
 * @param {string} datetimeStr - "YYYY-MM-DD HH:mm:ss"
 * @returns {object} { date: "MMM DD, YYYY", time: "HH:MM AM/PM" }
 */
export function formatDateTimeForDisplay(datetimeStr) {
  if (!datetimeStr) return { date: '', time: '' };
  const date = new Date(datetimeStr.replace(' ', 'T'));
  if (isNaN(date.getTime())) return { date: '', time: '' };
  return {
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };
}

/**
 * Validate pickup datetime against current Philippine time
 * @param {string} pickupDatetime - "YYYY-MM-DD HH:mm:ss"
 * @returns {object} { valid: boolean, message: string }
 */
export function validatePickupDatetime(pickupDatetime) {
  if (!pickupDatetime) {
    return { valid: false, message: 'Pickup date and time is required' };
  }
  
  const formattedDt = pickupDatetime.includes('T') ? pickupDatetime : pickupDatetime.replace(' ', 'T');
  const pickupDate = new Date(formattedDt);
  if (isNaN(pickupDate.getTime())) {
    return { valid: false, message: 'Invalid pickup date/time format' };
  }
  
  const now = new Date();
  const bufferTime = new Date(now.getTime() - 5 * 60 * 1000);
  if (pickupDate < bufferTime) {
    return { 
      valid: false, 
      message: 'Pickup date and time cannot be in the past.' 
    };
  }
  
  return { valid: true };
}

/**
 * Validate drop-off date against pickup datetime
 * @param {string} pickupDatetime - "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD HH:mm:ss"
 * @param {string} dropoffDate - "YYYY-MM-DD"
 * @returns {object} { valid: boolean, message: string }
 */
export function validateDropoffDate(pickupDatetime, dropoffDate) {
  if (!dropoffDate) {
    return { valid: true };
  }
  
  if (!pickupDatetime) {
    return { valid: false, message: 'Pickup date and time is required' };
  }
  
  const pickupDateStr = pickupDatetime.slice(0, 10);
  if (dropoffDate < pickupDateStr) {
    return { 
      valid: false, 
      message: 'Drop-off date cannot be earlier than pickup date.' 
    };
  }
  
  return { valid: true };
}

/**
 * Legacy wrapper for validateDropoffDatetime
 */
export function validateDropoffDatetime(pickupDatetime, dropoffDatetime) {
  if (!dropoffDatetime) return { valid: true };
  const dropoffDateStr = dropoffDatetime.slice(0, 10);
  return validateDropoffDate(pickupDatetime, dropoffDateStr);
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDateToYMD(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}