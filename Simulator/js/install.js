// install.js - Add to Home Screen logic for Maneuver PWA
// This module registers listeners for PWA installation events and
// exposes an installation button when appropriate.

let deferredPrompt = null; // event saved for triggering later

// Element references
const installBtn = document.getElementById('btnInstall');
const iosTip     = document.getElementById('iosTip');

// Platform detection helpers
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       navigator.standalone === true;

// Hide promotional UI elements
function hidePromos() {
    installBtn?.classList.remove('show');
    iosTip?.remove();
}

// ----- Lifecycle -----
window.addEventListener('load', () => {
    // If the app is already installed, mark body and hide promos
    if (isInStandalone) {
        document.body.classList.add('installed');
        hidePromos();
    } else if (isIos && iosTip) {
        // iOS does not support beforeinstallprompt
        document.body.classList.add('no-install-ios');
    }
});

// Intercept default browser mini-infobar
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();              // Cancel the automatic banner
    deferredPrompt = e;              // Stash the event for later
    installBtn?.classList.add('show'); // Reveal install button
});

// Handle user-initiated install
installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('User response to install prompt:', outcome);
    deferredPrompt = null;
    installBtn.classList.remove('show');
});

// Cleanup when installation finishes
window.addEventListener('appinstalled', () => {
    document.body.classList.add('installed');
    hidePromos();
});
