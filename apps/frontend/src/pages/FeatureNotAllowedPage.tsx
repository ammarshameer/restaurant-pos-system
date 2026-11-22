import React from 'react';
import { useNavigate } from 'react-router-dom';

export const FeatureNotAllowedPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        padding: '32px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'var(--bg-card, #1e293b)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          borderRadius: '16px',
          padding: '32px',
          textAlign: 'center',
          boxShadow: '0 20px 45px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ fontSize: '42px', marginBottom: '12px' }}>🚫</div>
        <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 10px 0' }}>
          Feature Not Allowed
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5, margin: '0 0 24px 0' }}>
          This feature is not allowed for your business. Please contact your platform administrator if you need it enabled.
        </p>
        <button className="btn btn-primary" onClick={() => navigate(-1)}>
          Go Back
        </button>
      </div>
    </div>
  );
};

export default FeatureNotAllowedPage;
