import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store/store';
import { isSupportMode, exitSupportMode } from '../lib/session';
import { logout } from '../store/slices/authSlice';
import { formatPersonName } from '../utils/format';

export const SupportBanner: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);

  if (!isSupportMode() && !user?.supportMode) {
    return null;
  }

  const handleExit = () => {
    exitSupportMode();
    dispatch(logout());
    navigate('/platform');
  };

  const businessName = user?.restaurantName || 'Tenant Restaurant';
  const ownerName = user?.firstName
    ? `${formatPersonName(user.firstName)} ${formatPersonName(user.lastName)}`
    : 'Owner';

  return (
    <div
      style={{
        background: 'linear-gradient(90deg, #d97706, #b45309)',
        color: '#ffffff',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
        position: 'relative',
        zIndex: 9999,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px' }}>🛡️</span>
        <span>
          <strong>Support Mode Active:</strong> You are viewing <u>{businessName}</u> as{' '}
          <u>{ownerName}</u>.
        </span>
      </div>
      <button
        type="button"
        onClick={handleExit}
        style={{
          background: '#ffffff',
          color: '#92400e',
          border: 'none',
          padding: '4px 12px',
          borderRadius: '4px',
          fontWeight: 700,
          cursor: 'pointer',
          fontSize: '12px',
          transition: 'opacity 0.15s ease',
        }}
        onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
        onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
      >
        Exit Support Mode ✕
      </button>
    </div>
  );
};

export default SupportBanner;
