/**
 * Centralized Date/Time Utility for Philippines (Asia/Manila) timezone
 * UTC+08:00
 * 
 * All reservation date/time operations must go through this utility
 * to ensure consistent timezone handling across the application.
 */

const PH_TIMEZONE = 'Asia/Manila';
const PH_OFFSET_HOURS = 8; // UTC+08:00

/**
 * Get current date/time in Philippines timezone (Asia/Manila)
 * Returns ISO string without timezone suffix (YYYY-MM-DDTHH:mm:ss)
 * This represents the actual Philippine local time
 */
function getCurrentDateTimePh() {
  const now = new Date();
  // Convert to Philippines timezone (UTC+8)
  const phTime = new Date(now.getTime() + PH_OFFSET_HOURS * 60 * 60 * 1000);
  return phTime.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Get current date in Philippines timezone (YYYY-MM-DD)
 */
function getCurrentDatePh() {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toISOString().slice(0, 10);
}

/**
 * Get current time in Philippines timezone (HH:mm)
 */
function getCurrentTimePh() {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toTimeString().slice(0, 5);
}

/**
 * Get current date/time in Philippines timezone as separate components
 */
function getCurrentDateTimeComponents() {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: phTime.toISOString().slice(0, 10),
    time: phTime.toTimeString().slice(0, 5),
    datetime: phTime.toISOString().slice(0, 19).replace('T', ' ')
  };
}

/**
 * Combine date and time strings into a PHP-compatible DATETIME string
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timeStr - HH:mm or HH:mm:ss
 * @returns {string} YYYY-MM-DD HH:mm:ss
 */
function combineDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const time = timeStr.length === 5 ? timeStr + ':00' : timeStr;
  return `${dateStr} ${time}`;
}

/**
 * Parse a datetime string and return a Date object in Philippines timezone
 * Input: "YYYY-MM-DD HH:mm:ss" (assumed to be Philippine local time)
 * Returns: Date object representing that Philippine local time
 */
function parsePhDateTime(datetimeStr) {
  if (!datetimeStr) return null;
  // Parse as Philippines local time (no timezone conversion)
  const [datePart, timePart] = datetimeStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = 0] = timePart.split(':').map(Number);
  // Create date in UTC, then adjust for PH timezone
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date;
}

/**
 * Format a Date object to Philippine datetime string (YYYY-MM-DD HH:mm:ss)
 * @param {Date} date - Date object
 * @returns {string} YYYY-MM-DD HH:mm:ss
 */
function formatPhDateTime(date) {
  if (!date || isNaN(date.getTime())) return null;
  // Convert to PH timezone
  const phTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Format a Date object to Philippine date string (YYYY-MM-DD)
 */
function formatPhDate(date) {
  if (!date || isNaN(date.getTime())) return null;
  const phTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toISOString().slice(0, 10);
}

/**
 * Format a Date object to Philippine time string (HH:mm)
 */
function formatPhTime(date) {
  if (!date || isNaN(date.getTime())) return null;
  const phTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toTimeString().slice(0, 5);
}

/**
 * Parse date string (YYYY-MM-DD) and time string (HH:mm or HH:mm:ss)
 * Returns a Date object in PH timezone
 */
function parsePhDateTimeFromParts(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const timeParts = timeStr.split(':').map(Number);
  const hour = timeParts[0] || 0;
  const minute = timeParts[1] || 0;
  const second = timeParts[2] || 0;
  // Create date in UTC, then it represents PH local time
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date;
}

/**
 * Get minimum pickup time for a given date
 * If date is today, return current time + 15 minutes lead time
 * If date is in future, return 00:00 (or business hours start)
 */
function getMinPickupTimeForDate(dateStr) {
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
 * Validate pickup datetime against current Philippine time
 * @param {string} pickupDatetime - "YYYY-MM-DD HH:mm:ss"
 * @returns {object} { valid: boolean, message: string }
 */
function validatePickupDatetime(pickupDatetime) {
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
 * @param {string} pickupDatetime - "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm"
 * @param {string} dropoffDate - "YYYY-MM-DD"
 * @returns {object} { valid: boolean, message: string }
 */
function validateDropoffDate(pickupDatetime, dropoffDate) {
  if (!dropoffDate) {
    return { valid: false, message: 'Drop-off date is required' };
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
function validateDropoffDatetime(pickupDatetime, dropoffDatetime) {
  if (!dropoffDatetime) return { valid: true };
  const dropoffDateStr = dropoffDatetime.slice(0, 10);
  return validateDropoffDate(pickupDatetime, dropoffDateStr);
}

module.exports = {
  PH_TIMEZONE,
  PH_OFFSET_HOURS,
  getCurrentDateTimePh,
  getCurrentDatePh,
  getCurrentTimePh,
  getCurrentDateTimeComponents,
  combineDateTime,
  parsePhDateTime,
  formatPhDateTime,
  formatPhDate,
  formatPhTime,
  parsePhDateTimeFromParts,
  getMinPickupTimeForDate,
  validatePickupDatetime,
  validateDropoffDate,
  validateDropoffDatetime,
};