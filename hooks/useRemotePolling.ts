import { useEffect } from 'react';

export function useRemotePolling({
  enabled,
  intervalMs = 1200,
  poll,
  onError,
}: {
  enabled: boolean;
  intervalMs?: number;
  poll: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      poll().catch(onError);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, onError, poll]);
}
