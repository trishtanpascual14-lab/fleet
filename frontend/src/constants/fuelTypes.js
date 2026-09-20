// Single source of truth for fuel types across the Fleet Management System.
// Used by: Vehicles (Add/Edit), Fuel Management (desktop + mobile forms,
// filters), and fuel-transaction validation. Do NOT hardcode fuel type lists
// elsewhere — import from here so a new supported type automatically appears
// in every module. Keep in sync with backend/utils/fuelTypes.js and the
// fuel_type ENUMs in database/schema.sql.
export const FUEL_TYPES = ['Diesel', 'Gasoline', 'Premium', 'Unleaded', 'Biofuel'];

export const DEFAULT_FUEL_TYPE = 'Diesel';

export const isFuelType = (v) => FUEL_TYPES.includes(v);

// Dropdown options, tolerant of legacy records: an unknown stored value is
// appended so Edit forms still display the record's current fuel type.
export const fuelTypeOptions = (current) =>
  current && !FUEL_TYPES.includes(current) ? [...FUEL_TYPES, current] : FUEL_TYPES;
