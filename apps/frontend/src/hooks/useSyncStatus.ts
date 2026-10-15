import { useEffect, useState } from 'react';
import { syncEngine, SyncStatus } from '../lib/offline/syncEngine';

/** Subscribes a component to live offline/sync state. */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => syncEngine.getStatus());

  useEffect(() => {
    const unsubscribe = syncEngine.subscribe(setStatus);
    return () => unsubscribe();
  }, []);

  return status;
}
