'use strict';

const HELPER_APP_ID = 'restaurant-pos-print-helper';
const HELPER_VERSION = '1.0.0';
const DEFAULT_PORT = 17777;
const DEFAULT_TOKEN = 'rpos-print-2026-9f4c7b1e';

// Exact-match allow-list. No wildcards, no localhost, no other sites.
const ALLOWED_ORIGINS = Object.freeze(['https://pos.gsmpilot.com']);

const DEFAULT_COLUMNS = 48; // 80 mm roll, Font A (approx. 72 mm printable)

module.exports = {
  HELPER_APP_ID,
  HELPER_VERSION,
  DEFAULT_PORT,
  DEFAULT_TOKEN,
  ALLOWED_ORIGINS,
  DEFAULT_COLUMNS,
};
