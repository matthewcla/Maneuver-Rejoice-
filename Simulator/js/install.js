// install.js - Add to Home Screen logic for Maneuver PWA
// This module registers listeners for PWA installation events and
// exposes an installation button when appropriate.

let deferredPrompt = null; // event saved for triggering later

// Element references
const installBtn = document.getElementById('btnInstall');
const iosTip     = document.getElementById('iosTip');
const iosShareBtn = document.getElementById('ios-share');
const iosWebBtn   = document.getElementById('ios-web');

// Track whether the user has opted out of share prompts
const skipSharePrompt = localStorage.getItem('skipSharePrompt') === 'true';

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
        localStorage.setItem('skipSharePrompt', 'true');
    } else if (isIos && iosTip && !skipSharePrompt) {
        // iOS does not support beforeinstallprompt
        document.body.classList.add('no-install-ios');
    }
});

iosShareBtn?.addEventListener('click', () => {
    iosTip?.remove();
    localStorage.setItem('skipSharePrompt', 'true');
});

iosWebBtn?.addEventListener('click', () => {
    iosTip?.remove();
    localStorage.setItem('skipSharePrompt', 'true');
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
    if (outcome === 'accepted') {
        localStorage.setItem('skipSharePrompt', 'true');
    }
});

// Cleanup when installation finishes
window.addEventListener('appinstalled', () => {
    document.body.classList.add('installed');
    hidePromos();
    localStorage.setItem('skipSharePrompt', 'true');
});
