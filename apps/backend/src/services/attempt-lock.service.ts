interface AttemptRecord {
  failures: number;
  lockedUntil: number | null;
  lastAttemptAt: number;
}

class AttemptLockService {
  private attempts = new Map<string, AttemptRecord>();
  private readonly MAX_FAILURES = 5;
  private readonly LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  private makeKey(businessIdentifier: string, ip: string): string {
    const cleanBusiness = (businessIdentifier || 'global').trim().toLowerCase();
    const cleanIp = (ip || '0.0.0.0').trim().toLowerCase();
    return `${cleanBusiness}::${cleanIp}`;
  }

  assertNotLocked(businessIdentifier: string, ip: string): void {
    const key = this.makeKey(businessIdentifier, ip);
    const record = this.attempts.get(key);
    if (!record) return;

    if (record.lockedUntil) {
      const now = Date.now();
      if (now < record.lockedUntil) {
        const remainingMinutes = Math.ceil((record.lockedUntil - now) / 60000);
        const error = new Error(`Too many failed attempts. Locked for ${remainingMinutes} minute(s).`);
        (error as any).statusCode = 429;
        throw error;
      } else {
        // Lock expired
        this.attempts.delete(key);
      }
    }
  }

  recordFailure(businessIdentifier: string, ip: string): void {
    const key = this.makeKey(businessIdentifier, ip);
    const now = Date.now();
    const record = this.attempts.get(key) || { failures: 0, lockedUntil: null, lastAttemptAt: now };

    // Reset if last attempt was over 15 minutes ago and wasn't locked
    if (!record.lockedUntil && now - record.lastAttemptAt > this.LOCK_DURATION_MS) {
      record.failures = 0;
    }

    record.failures += 1;
    record.lastAttemptAt = now;

    if (record.failures >= this.MAX_FAILURES) {
      record.lockedUntil = now + this.LOCK_DURATION_MS;
    }

    this.attempts.set(key, record);
  }

  recordSuccess(businessIdentifier: string, ip: string): void {
    const key = this.makeKey(businessIdentifier, ip);
    this.attempts.delete(key);
  }

  clearAll(): void {
    this.attempts.clear();
  }
}

export const attemptLockService = new AttemptLockService();

