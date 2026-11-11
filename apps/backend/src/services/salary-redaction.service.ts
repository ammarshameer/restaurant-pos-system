import { hasFeature } from './feature.service';

const SALARY_FIELDS = new Set([
  'salaryType',
  'monthlySalary',
  'dailyRate',
  'hourlyRate',
  'overtimeEligible',
]);

export function redactSalary<T>(payload: T): T {
  const redact = (value: any): any => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    const result: any = {};
    for (const [key, child] of Object.entries(value)) {
      if (!SALARY_FIELDS.has(key)) {
        result[key] = redact(child);
      }
    }
    return result;
  };
  return redact(payload);
}

export function canUserViewPayroll(
  user?: { isOwnerRole?: boolean; role?: string; permissions?: string[] } | null
): boolean {
  if (!user) return false;
  // If owner, still verify effective permissions (which are stripped if payroll feature is disabled)
  return Array.isArray(user.permissions) && user.permissions.includes('payroll.view');
}

export async function redactSalaryIfUnauthorized<T>(
  restaurantId: string,
  payload: T,
  user?: { isOwnerRole?: boolean; role?: string; permissions?: string[] } | null
): Promise<T> {
  if (!canUserViewPayroll(user)) {
    return redactSalary(payload);
  }
  const enabled = await hasFeature(restaurantId, 'payroll');
  return enabled ? payload : redactSalary(payload);
}

