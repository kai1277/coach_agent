import { worker } from './browser';
(async () => {
  if (import.meta.env.DEV) {
    await worker.start({ onUnhandledRequest: 'bypass' });
    console.log('[MSW] worker started');
  }
})();
