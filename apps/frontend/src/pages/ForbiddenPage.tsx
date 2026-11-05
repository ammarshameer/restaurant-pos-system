import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store/store';

export const ForbiddenPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);

  const getFirstPermittedRoute = (): string => {
    if (!user) return '/login';
    const perms = new Set(user.permissions || []);
    if (user.isOwnerRole === true || (!user.isOwnerRole && perms.has('pos.use'))) return '/pos';
    if (perms.has('kitchen.view')) return '/kitchen';
    if (perms.has('invoices.view') || perms.has('orders.view')) return '/invoices';
    if (perms.has('payments.view') || perms.has('payments.process')) return '/payments';
    if (perms.has('menu.view')) return '/menu';
    if (perms.has('deals.view')) return '/deals';
    if (perms.has('inventory.view')) return '/inventory';
    if (perms.has('employees.view')) return '/employees';
    if (perms.has('analytics.view')) return '/analytics';
    return '/pos';
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        textAlign: 'center',
        padding: '32px',
      }}
    >
      <div
        style={{
          width: '72px',
          height: '72px',
          borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.15)',
          color: '#ef4444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '36px',
          marginBottom: '20px',
        }}
      >
        🔒
      </div>
      <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '8px' }}>
        Access Restricted
      </h1>
      <p style={{ color: 'var(--text-muted)', maxWidth: '420px', marginBottom: '24px', lineHeight: 1.5 }}>
        Your staff role ({user?.roleName || user?.role || 'Staff'}) does not have permission to view or manage this area of the restaurant system.
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          className="btn btn-primary"
          onClick={() => navigate(getFirstPermittedRoute())}
        >
          Return to Permitted Area
        </button>
      </div>
    </div>
  );
};

export default ForbiddenPage;
