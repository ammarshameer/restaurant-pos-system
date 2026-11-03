import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store/store';
import { Permission } from '../types/permissions';

interface RequirePermissionProps {
  permissions: Permission[];
  requireAll?: boolean;
  children: React.ReactNode;
}

export const RequirePermission: React.FC<RequirePermissionProps> = ({
  permissions,
  requireAll = false,
  children,
}) => {
  const { user } = useSelector((state: RootState) => state.auth);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Owner unconditionally bypasses permission checks
  const isOwner =
    user.role === 'OWNER' ||
    user.role === 'ADMIN' ||
    (user as any).isOwner === true;

  if (isOwner) {
    return <>{children}</>;
  }

  const userPerms = new Set(user.permissions || []);

  const hasAccess = requireAll
    ? permissions.every((p) => userPerms.has(p))
    : permissions.some((p) => userPerms.has(p));

  if (!hasAccess) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
};

export default RequirePermission;

