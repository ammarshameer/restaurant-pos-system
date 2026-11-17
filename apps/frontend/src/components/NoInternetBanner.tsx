import React, { useEffect } from 'react';
import { useOnlineStatus } from '../lib/connectivity';

/**
 * Blocks writes when the browser has no connection. Requests that were already
 * sent are retried by the API client with their idempotency key, so nothing is
 * saved twice and no failed write is silently dropped.
 */
export const NoInternetBanner: React.FC = () => {
  const online = useOnlineStatus();

  useEffect(() => {
    document.body.classList.toggle('no-internet', !online);
    return () => document.body.classList.remove('no-internet');
  }, [online]);

  if (online) return null;

  return (
    <div className="no-internet-banner" role="alert">
      ⚠️ No internet connection. Saving is disabled until you are back online.
    </div>
  );
};

export default NoInternetBanner;
