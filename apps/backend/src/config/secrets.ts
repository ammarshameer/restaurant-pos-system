import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
let jwtPlatformSecret = process.env.JWT_PLATFORM_SECRET;
let jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

if (isProduction) {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      'FATAL: JWT_SECRET must be configured and at least 32 characters long in production.'
    );
  }
  if (!jwtPlatformSecret || jwtPlatformSecret.length < 32) {
    throw new Error(
      'FATAL: JWT_PLATFORM_SECRET must be configured and at least 32 characters long in production.'
    );
  }
  if (jwtSecret === jwtPlatformSecret) {
    throw new Error(
      'FATAL: JWT_SECRET and JWT_PLATFORM_SECRET must be distinct, separate secrets in production.'
    );
  }
  if (!jwtRefreshSecret || jwtRefreshSecret.length < 32) {
    throw new Error(
      'FATAL: JWT_REFRESH_SECRET must be configured and at least 32 characters long in production.'
    );
  }
} else {
  if (!jwtSecret || jwtSecret.length < 16) {
    console.warn('⚠️ [DEV WARNING] JWT_SECRET is missing or short! Using development fallback secret.');
    jwtSecret = 'dev_jwt_tenant_secret_minimum_32_characters_long_tenant_key_12345';
  }
  if (!jwtPlatformSecret || jwtPlatformSecret.length < 16) {
    console.warn('⚠️ [DEV WARNING] JWT_PLATFORM_SECRET is missing or short! Using development fallback secret.');
    jwtPlatformSecret = 'dev_jwt_platform_secret_minimum_32_characters_long_platform_key_67890';
  }
  if (jwtSecret === jwtPlatformSecret) {
    console.warn('⚠️ [DEV WARNING] JWT_SECRET and JWT_PLATFORM_SECRET are identical! Using distinct fallback for platform.');
    jwtPlatformSecret = jwtSecret + '_platform_distinct_dev_secret_32chars';
  }
  if (!jwtRefreshSecret || jwtRefreshSecret.length < 16) {
    jwtRefreshSecret = 'dev_jwt_refresh_secret_minimum_32_characters_long_refresh_key_99999';
  }
}

export const JWT_SECRET: string = jwtSecret;
export const JWT_PLATFORM_SECRET: string = jwtPlatformSecret;
export const JWT_REFRESH_SECRET: string = jwtRefreshSecret;

