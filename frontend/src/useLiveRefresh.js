import { useEffect, useRef } from 'react';

export default function useLiveRefresh(load, onError, { paused = false, interval = 5000 } = {}) {
  const current = useRef({load,onError,paused});
  current.current = {load,onError,paused};
  useEffect(() => {
    let stopped = false, running = false;
    async function refresh(force = false) {
      if (stopped || running || (!force && (current.current.paused || document.hidden))) return;
      running = true;
      try { await current.current.load(); } catch (error) { if (!stopped) current.current.onError(error); }
      finally { running = false; }
    }
    refresh(true);
    const timer = setInterval(() => refresh(), interval);
    const focus = () => refresh();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus',focus); document.removeEventListener('visibilitychange',focus); };
  }, [interval]);
}
