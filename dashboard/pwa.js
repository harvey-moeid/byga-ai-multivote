let deferredInstallPrompt = null;
const installButton = document.getElementById('install-app');

function setInstallVisible(visible) {
  if (!installButton) return;
  installButton.hidden = !visible;
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  setInstallVisible(true);
});

installButton?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  try { await deferredInstallPrompt.userChoice; } catch {}
  deferredInstallPrompt = null;
  setInstallVisible(false);
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  setInstallVisible(false);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope:'/' });
      void registration.update();
      if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
    } catch (error) {
      console.warn('PWA service worker tidak aktif:', error);
    }
  }, { once:true });
}

window.bygaPWA = {
  get installed() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  },
  async storage() {
    return navigator.storage?.estimate ? navigator.storage.estimate() : null;
  }
};
