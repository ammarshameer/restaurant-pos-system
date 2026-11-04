import fs from 'fs';
import path from 'path';

export interface DevPlatformCredentials {
  superAdmin: {
    email: string;
    password: string;
  };
  support: {
    email: string;
    password: string;
  };
  createdAt: string;
}

const CREDENTIALS_FILE = path.resolve(__dirname, '../../.dev-platform-credentials.json');

/**
 * Returns development platform credentials.
 * If credentials already exist in .dev-platform-credentials.json, returns them.
 * Otherwise, generates random high-entropy passwords, saves them to the file, and returns them.
 * Never used in production.
 */
export function getDevPlatformCredentials(): DevPlatformCredentials {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const content = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.superAdmin?.password && parsed.support?.password) {
        return parsed;
      }
    } catch {
      // Regenerate if file cannot be parsed
    }
  }

  const generated: DevPlatformCredentials = {
    superAdmin: {
      email: process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() || 'superadmin@restaurantpos.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!',
    },
    support: {
      email: process.env.SUPPORT_EMAIL?.trim().toLowerCase() || 'support@restaurantpos.com',
      password: process.env.SUPPORT_PASSWORD || 'Support123!',
    },
    createdAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(generated, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    console.log(`ℹ️ [DEV] Generated one-time dev platform credentials stored at: ${CREDENTIALS_FILE}`);
  } catch (err) {
    console.warn('[DEV] Could not write .dev-platform-credentials.json:', err);
  }

  return generated;
}
