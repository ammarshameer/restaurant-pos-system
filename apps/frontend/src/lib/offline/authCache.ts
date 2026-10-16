import { offlineDB } from './db';

/**
 * Offline credential cache.
 *
 * Lets staff unlock the POS while the device has no internet, without ever
 * storing the raw password/PIN. Only a salted PBKDF2 verifier is kept in
 * IndexedDB, produced with the Web Crypto API. If `crypto.subtle` is not
 * available (e.g. non-secure context), offline login is simply disabled rather
 * than falling back to an insecure scheme.
 *
 * These verifiers are used ONLY for local validation. They can never be
 * replayed to the server, so an offline sign-in still needs connectivity to
 * obtain a fresh token for syncing.
 */

type Kind = 'password' | 'pin';

interface Verifier {
  salt: string;
  hash: string;
  iterations: number;
}

interface CachedUser {
  user: any;
  password?: Verifier;
  pin?: Verifier;
  updatedAt: number;
}

const USER_KEY = (userId: string) => `offlineauth:user:${userId}`;
const INDEX_KEY = 'offlineauth:index';
const PBKDF2_ITERATIONS = 100_000;

const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;

export function offlineAuthSupported(): boolean {
  return Boolean(subtle);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

async function derive(secret: string, saltB64: string, iterations: number): Promise<string> {
  const salt = base64ToBytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

async function makeVerifier(secret: string): Promise<Verifier | null> {
  if (!subtle) return null;
  const salt = randomSalt();
  const hash = await derive(secret, salt, PBKDF2_ITERATIONS);
  return { salt, hash, iterations: PBKDF2_ITERATIONS };
}

async function verify(secret: string, verifier: Verifier): Promise<boolean> {
  if (!subtle) return false;
  try {
    const hash = await derive(secret, verifier.salt, verifier.iterations);
    // Constant-ish comparison; verifiers are not high-value secrets but avoid
    // the most obvious timing shortcuts.
    if (hash.length !== verifier.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ verifier.hash.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

async function readIndex(): Promise<string[]> {
  try {
    const entry = await offlineDB.kv.get(INDEX_KEY);
    return Array.isArray(entry?.value) ? (entry.value as string[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  await offlineDB.kv.put({ key: INDEX_KEY, value: ids, updatedAt: Date.now() });
}

async function readUser(userId: string): Promise<CachedUser | null> {
  try {
    const entry = await offlineDB.kv.get(USER_KEY(userId));
    return (entry?.value as CachedUser) || null;
  } catch {
    return null;
  }
}

async function upsertUser(user: any, patch: Partial<CachedUser>): Promise<void> {
  if (!user?.id) return;
  const existing = (await readUser(user.id)) || { user, updatedAt: Date.now() };
  const next: CachedUser = { ...existing, user, ...patch, updatedAt: Date.now() };
  await offlineDB.kv.put({ key: USER_KEY(user.id), value: next, updatedAt: Date.now() });

  const index = await readIndex();
  if (!index.includes(user.id)) {
    index.push(user.id);
    await writeIndex(index);
  }
}

/** Remember the verifier for a user's password after a successful login. */
export async function cachePasswordCredential(user: any, password: string): Promise<void> {
  try {
    const verifier = await makeVerifier(password);
    if (!verifier) return;
    await upsertUser(user, { password: verifier });
  } catch {
    // Offline credential caching is best-effort.
  }
}

/** Remember the verifier for a user's PIN after a successful login. */
export async function cachePinCredential(user: any, pin: string): Promise<void> {
  try {
    const verifier = await makeVerifier(pin);
    if (!verifier) return;
    await upsertUser(user, { pin: verifier });
  } catch {
    // Best-effort.
  }
}

/** Validate an email/password pair against locally cached verifiers. */
export async function verifyOfflinePassword(email: string, password: string): Promise<any | null> {
  if (!subtle) return null;
  const normalized = (email || '').trim().toLowerCase();
  const ids = await readIndex();
  for (const id of ids) {
    const record = await readUser(id);
    if (!record?.password) continue;
    if ((record.user?.email || '').toLowerCase() !== normalized) continue;
    if (await verify(password, record.password)) {
      return record.user;
    }
  }
  return null;
}

/** Validate a PIN against locally cached verifiers. */
export async function verifyOfflinePin(pin: string): Promise<any | null> {
  if (!subtle) return null;
  const ids = await readIndex();
  for (const id of ids) {
    const record = await readUser(id);
    if (!record?.pin) continue;
    if (await verify(pin, record.pin)) {
      return record.user;
    }
  }
  return null;
}
