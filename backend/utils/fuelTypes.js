// Single source of truth for fuel types (backend).
// Keep in sync with frontend/src/constants/fuelTypes.js and the fuel_type
// ENUMs in database/schema.sql. Used by fuel + vehicle validation so both
// modules accept exactly the same set of fuel types.
const FUEL_TYPES = ['Diesel', 'Gasoline', 'Premium', 'Unleaded', 'Biofuel'];

const DEFAULT_FUEL_TYPE = 'Diesel';

function isFuelType(v) {
  return FUEL_TYPES.includes(v);
}

module.exports = { FUEL_TYPES, DEFAULT_FUEL_TYPE, isFuelType };
