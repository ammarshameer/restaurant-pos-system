/**
 * Centralized helpers for the persisted auth session.
 *
 * The access token is short-lived (24h). We also persist the refresh token so
 * the POS can silently renew its session (even after a long offline period)
 * instead of forcing the cashier to log in again.
 */

export interface StoredSession {
  accessToken: string;
  refreshToken?: string;
  user?: any;
}

export const ACCESS_TOKEN_KEY = 'auth_token';
export const REFRESH_TOKEN_KEY = 'auth_refresh_token';
export const USER_KEY = 'auth_user';

const hasStorage = (): boolean => typeof localStorage !== 'undefined';

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
 * The restaurant id of the signed-in user. Used to scope the local offline
 * cache (IndexedDB) to the current tenant. Falls back to null when unknown.
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
}
