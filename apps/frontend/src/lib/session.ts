/**
 * Centralized helpers for persisted auth sessions (Tenant and Platform).
 */

export interface StoredSession {
  accessToken: string;
  refreshToken?: string;
  user?: any;
}

export const ACCESS_TOKEN_KEY = 'auth_token';
export const REFRESH_TOKEN_KEY = 'auth_refresh_token';
export const USER_KEY = 'auth_user';
export const SUPPORT_MODE_KEY = 'support_mode';

export const PLATFORM_ACCESS_TOKEN_KEY = 'platform_auth_token';
export const PLATFORM_REFRESH_TOKEN_KEY = 'platform_refresh_token';
export const PLATFORM_USER_KEY = 'platform_user';

const hasStorage = (): boolean => typeof localStorage !== 'undefined';

// ============================================
// TENANT SESSION
// ============================================

export function getAccessToken(): string | null {
  if (!hasStorage()) return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (!hasStorage()) return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser(): any | null {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The restaurant id of the signed-in user.
 * Strictly returns string if present, or null. NEVER falls back to default tenant id.
 */
export function getCurrentRestaurantId(): string | null {
  const user = getStoredUser();
  return user?.restaurantId || null;
}

export function storeSession({ accessToken, refreshToken, user }: StoredSession): void {
  if (!hasStorage()) return;
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  if (!hasStorage()) return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SUPPORT_MODE_KEY);
}

// ============================================
// SUPPORT IMPERSONATION MODE
// ============================================

export function isSupportMode(): boolean {
  if (!hasStorage()) return false;
  return localStorage.getItem(SUPPORT_MODE_KEY) === 'true';
}

export function enterSupportMode({ accessToken, user }: { accessToken: string; user: any }): void {
  if (!hasStorage()) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.removeItem(REFRESH_TOKEN_KEY); // Impersonation has no refresh token
  localStorage.setItem(USER_KEY, JSON.stringify({ ...user, supportMode: true }));
  localStorage.setItem(SUPPORT_MODE_KEY, 'true');
}

export function exitSupportMode(): void {
  if (!hasStorage()) return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SUPPORT_MODE_KEY);
}

// ============================================
// PLATFORM SESSION
// ============================================

export function getPlatformAccessToken(): string | null {
  if (!hasStorage()) return null;
  return localStorage.getItem(PLATFORM_ACCESS_TOKEN_KEY);
}

export function getPlatformRefreshToken(): string | null {
  if (!hasStorage()) return null;
  return localStorage.getItem(PLATFORM_REFRESH_TOKEN_KEY);
}

export function getPlatformUser(): any | null {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(PLATFORM_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storePlatformSession({
  accessToken,
  refreshToken,
  user,
}: StoredSession): void {
  if (!hasStorage()) return;
  if (accessToken) localStorage.setItem(PLATFORM_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(PLATFORM_REFRESH_TOKEN_KEY, refreshToken);
  if (user) localStorage.setItem(PLATFORM_USER_KEY, JSON.stringify(user));
}

export function clearPlatformSession(): void {
  if (!hasStorage()) return;
  localStorage.removeItem(PLATFORM_ACCESS_TOKEN_KEY);
  localStorage.removeItem(PLATFORM_REFRESH_TOKEN_KEY);
  localStorage.removeItem(PLATFORM_USER_KEY);
}
