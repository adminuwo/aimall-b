const BRAND = require('../utils/brandIdentity.js');

const getFullSystemInstruction = () => {
  return `${BRAND.BRAND_SYSTEM_RULES}\n\n${BRAND.AISA_CONVERSATIONAL_RULES}`;
};

const getConfig = () => {
  return {}; // Placeholder for MongoDB config if needed
};

module.exports = {
  getFullSystemInstruction,
  getConfig
};
