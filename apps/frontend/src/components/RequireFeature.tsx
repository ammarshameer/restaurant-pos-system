import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store/store';
import { FeatureKey } from '../types/permissions';

interface RequireFeatureProps {
  feature: FeatureKey;
  children: React.ReactNode;
}

export const RequireFeature: React.FC<RequireFeatureProps> = ({ feature, children }) => {
  const { user } = useSelector((state: RootState) => state.auth);
  if (!user) return <Navigate to="/login" replace />;
  if (!user.features?.includes(feature)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
};

export default RequireFeature;
