/**
 * Centralized helpers for persisted auth sessions (Tenant, Platform, Support).
 *
 * Tenant and platform sessions live in localStorage so they survive a tab
 * close. Support impersonation is tab-scoped (sessionStorage) on purpose:
 * entering a tenant as support must never overwrite the owner session in a
 * different tab of the same browser.
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

export const SUPPORT_ACCESS_TOKEN_KEY = 'support_auth_token';
export const SUPPORT_USER_KEY = 'support_auth_user';

export const PLATFORM_ACCESS_TOKEN_KEY = 'platform_auth_token';
export const PLATFORM_REFRESH_TOKEN_KEY = 'platform_refresh_token';
export const PLATFORM_USER_KEY = 'platform_user';

const hasStorage = (): boolean => typeof localStorage !== 'undefined';
const hasSessionStorage = (): boolean => typeof sessionStorage !== 'undefined';

// ============================================
// ACTIVE TENANT SESSION (tenant owner/staff OR support impersonation)
// ============================================

export function isSupportMode(): boolean {
  if (!hasSessionStorage()) return false;
  return (
    sessionStorage.getItem(SUPPORT_MODE_KEY) === 'true' ||
    Boolean(sessionStorage.getItem(SUPPORT_ACCESS_TOKEN_KEY))
  );
}

export function getAccessToken(): string | null {
  if (isSupportMode()) {
    return hasSessionStorage() ? sessionStorage.getItem(SUPPORT_ACCESS_TOKEN_KEY) : null;
  }
  if (!hasStorage()) return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  // Support impersonation tokens are short-lived and intentionally have no
  // refresh token. Never let a support tab refresh the owner's localStorage
  // session by mistake.
  if (isSupportMode()) return null;
  if (!hasStorage()) return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser(): any | null {
  const raw = isSupportMode()
    ? hasSessionStorage()
      ? sessionStorage.getItem(SUPPORT_USER_KEY)
      : null
    : hasStorage()
    ? localStorage.getItem(USER_KEY)
    : null;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The restaurant id of the active signed-in user. */
export function getCurrentRestaurantId(): string | null {
  return getStoredUser()?.restaurantId || null;
}

export function storeSession({ accessToken, refreshToken, user }: StoredSession): void {
  if (isSupportMode()) {
    if (!hasSessionStorage()) return;
    if (accessToken) sessionStorage.setItem(SUPPORT_ACCESS_TOKEN_KEY, accessToken);
    if (user) sessionStorage.setItem(SUPPORT_USER_KEY, JSON.stringify(user));
    return;
  }
  if (!hasStorage()) return;
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Persist a mutated user object into whichever store owns the active session. */
export function storeActiveUser(user: any): void {
  if (isSupportMode()) {
    if (hasSessionStorage()) sessionStorage.setItem(SUPPORT_USER_KEY, JSON.stringify(user));
    return;
  }
  if (hasStorage()) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearTenantSession(): void {
  if (!hasStorage()) return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function clearSupportSession(): void {
  if (hasSessionStorage()) {
    sessionStorage.removeItem(SUPPORT_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(SUPPORT_USER_KEY);
    sessionStorage.removeItem(SUPPORT_MODE_KEY);
  }
  // Legacy support sessions also wrote this marker to localStorage.
  if (hasStorage()) localStorage.removeItem(SUPPORT_MODE_KEY);
}

/**
 * Clear only the active session. A support tab that receives a 401 must not
 * delete the owner's localStorage session in another tab.
 */
export function clearSession(): void {
  if (isSupportMode()) {
    clearSupportSession();
    return;
  }
  clearTenantSession();
  clearSupportSession();
}

// ============================================
// SUPPORT IMPERSONATION MODE (TAB-SCOPED)
// ============================================

export function enterSupportMode({ accessToken, user }: { accessToken: string; user: any }): void {
  if (!hasSessionStorage()) return;
  sessionStorage.setItem(SUPPORT_ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(SUPPORT_USER_KEY, JSON.stringify({ ...user, supportMode: true }));
  sessionStorage.setItem(SUPPORT_MODE_KEY, 'true');
  // Do not touch the tenant's localStorage session in another tab.
  if (hasStorage()) localStorage.removeItem(SUPPORT_MODE_KEY);
}

export function exitSupportMode(): void {
  clearSupportSession();
}

/**
 * Older builds stored support impersonation in the same localStorage keys as
 * the tenant session, which silently replaced an owner in another tab. Clear
 * that legacy state once so a stale support marker can never be read as a
 * normal owner session.
 */
export function migrateLegacySupportSession(): void {
  if (!hasStorage()) return;
  if (localStorage.getItem(SUPPORT_MODE_KEY) !== 'true') return;
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

migrateLegacySupportSession();
