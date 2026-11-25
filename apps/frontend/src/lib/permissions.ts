import { useSelector } from 'react-redux';
import { RootState } from '../store/store';
import { Permission } from '../types/permissions';

/** Mirror the backend permission check so the UI never sends a call it will be rejected for. */
export function usePermission(permission: Permission): boolean {
  return useSelector((state: RootState) => {
    const permissions = state.auth.user?.permissions || [];
    return permissions.includes(permission);
  });
}

export function useAnyPermission(permissions: Permission[]): boolean {
  return useSelector((state: RootState) => {
    const held = new Set(state.auth.user?.permissions || []);
    return permissions.some((permission) => held.has(permission));
  });
}

export function useAllPermissions(permissions: Permission[]): boolean {
  return useSelector((state: RootState) => {
    const held = new Set(state.auth.user?.permissions || []);
    return permissions.every((permission) => held.has(permission));
  });
}
