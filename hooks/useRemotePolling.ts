import { useEffect } from 'react';

export type RemoteConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export function useRemotePolling({
  enabled,
  intervalMs = 1200,
  heartbeat,
  heartbeatMs = 15_000,
  poll,
  onError,
  onConnectionChange,
}: {
  enabled: boolean;
  intervalMs?: number;
  heartbeat?: () => Promise<void>;
  heartbeatMs?: number;
  poll: () => Promise<unknown>;
  onError: (error: unknown) => void;
  onConnectionChange: (status: RemoteConnectionStatus) => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let requestInFlight = false;
    let runAfterCurrentRequest = false;
    let retryCount = 0;
    let timer: number | undefined;
    let heartbeatTimer: number | undefined;

    const setStatus = (status: RemoteConnectionStatus) => onConnectionChange(status);
    const schedule = (delay: number) => {
      if (disposed) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(runPoll, delay);
    };
    const runPoll = async () => {
      if (disposed) return;
      if (!navigator.onLine) {
        setStatus('offline');
        schedule(Math.max(intervalMs, 5000));
        return;
      }
      if (requestInFlight) {
        runAfterCurrentRequest = true;
        return;
      }

      requestInFlight = true;
      let nextDelay = intervalMs;
      try {
        await poll();
        retryCount = 0;
        setStatus('connected');
      } catch (error) {
        retryCount += 1;
        nextDelay = Math.min(intervalMs * 2 ** Math.min(retryCount, 4), 15_000);
        setStatus('reconnecting');
        onError(error);
      } finally {
        requestInFlight = false;
        const shouldRunNow = runAfterCurrentRequest;
        runAfterCurrentRequest = false;
        schedule(shouldRunNow ? 0 : nextDelay);
      }
    };
    const runHeartbeat = async () => {
      if (disposed || !heartbeat) return;
      try {
        if (navigator.onLine) await heartbeat();
      } catch (error) {
        setStatus(navigator.onLine ? 'reconnecting' : 'offline');
        onError(error);
      } finally {
        if (!disposed) heartbeatTimer = window.setTimeout(runHeartbeat, heartbeatMs);
      }
    };
    const wakeAndPoll = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (heartbeatTimer !== undefined) window.clearTimeout(heartbeatTimer);
      setStatus('connecting');
      void runPoll();
      void runHeartbeat();
    };
    const onOnline = () => wakeAndPoll();
    const onOffline = () => setStatus('offline');
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') wakeAndPoll();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', wakeAndPoll);
    document.addEventListener('visibilitychange', onVisibilityChange);
    setStatus('connecting');
    void runPoll();
    void runHeartbeat();

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (heartbeatTimer !== undefined) window.clearTimeout(heartbeatTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', wakeAndPoll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, heartbeat, heartbeatMs, intervalMs, onConnectionChange, onError, poll]);
}
