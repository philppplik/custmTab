// newtab.js — cust*m Tab new tab page logic
// No external dependencies. Chrome MV3 compatible.

// ─── P1 FIX: Steal focus from Chrome's address bar ───────────────────────────
// Chrome auto-focuses the address bar on every new tab. By calling .focus() on
// a page element as the very first synchronous line of JS, we reclaim focus
// before the browser can finalize its address bar selection.
document.getElementById('focus-trap').focus();

// ─── Main async init ─────────────────────────────────────────────────────────
(async function init() {
  // Update lastSeen timestamp — fire and forget, no need to block on this.
  chrome.storage.local.set({ lastSeen: Date.now() });

  // Load persisted settings.
  const { targetUrl, maskUrl } = await chrome.storage.local.get([
    'targetUrl',
    'maskUrl',
  ]);

  // ── No URL configured yet ────────────────────────────────────────────────
  if (!targetUrl) {
    hideLoading();
    showSetupCard();
    document
      .getElementById('btn-open-options')
      .addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  // ─── P2 FIX: file:// URL without file scheme access permission ───────────
  // Chrome extensions cannot load file:// URLs in iframes (or via redirect)
  // unless the user has explicitly enabled "Allow access to file URLs" in the
  // extension's Details page. Detect this early and show clear instructions.
  if (targetUrl.startsWith('file://')) {
    const isAllowed = await new Promise((resolve) =>
      chrome.extension.isAllowedFileSchemeAccess(resolve)
    );

    if (!isAllowed) {
      showErrorCard(
        'File access not enabled',
        'To use a local file as your new tab:\n' +
          '1. Go to chrome://extensions\n' +
          '2. Click Details on cust*m Tab\n' +
          '3. Enable "Allow access to file URLs"\n' +
          '4. Open a new tab to retry'
      );
      return;
    }
  }

  // ─── P5 FIX: Hide the target URL from the address bar ────────────────────
  // maskUrl defaults to true. When enabled, the target is loaded in an iframe
  // so the address bar continues to show the chrome-extension:// URL instead
  // of the target URL — keeping the destination private.
  //
  // ─── P6 FIX: chrome-extension:// URLs load fine inside iframes ───────────
  const useMask = maskUrl !== false;

  if (useMask) {
    const frame = document.getElementById('content-frame');

    // Make sure the frame is visible (CSS sets display:block, but be explicit).
    frame.style.display = 'block';

    // Reinforce the extension URL in the address bar (no-op, but documents intent).
    try {
      history.replaceState(null, document.title, location.href);
    } catch (_) {
      // Ignore — replaceState to the same URL is always a no-op in extensions.
    }

    // Wire up iframe lifecycle events before setting src to avoid race conditions.
    frame.addEventListener('load', () => {
      hideLoading();
      refocusTrap(); // Re-steal focus after the iframe finishes loading.
    }, { once: true });

    frame.addEventListener('error', () => {
      hideLoading();
      showErrorCard(
        'Failed to load page',
        targetUrl +
          '\n\nNote: Some pages block embedding (X-Frame-Options). ' +
          'Try disabling "Hide URL" in Settings.'
      );
    }, { once: true });

    // Setting src after attaching listeners.
    frame.src = targetUrl;

    // Secondary focus steal: after the iframe has had time to settle, try to
    // focus its content window so keyboard input goes straight to the page.
    // Wrapped in try/catch because cross-origin frames will throw on .focus().
    setTimeout(() => {
      try {
        document.getElementById('content-frame').contentWindow?.focus();
      } catch (_) {
        // Cross-origin frame — focus stays on the extension page. That's fine.
      }
    }, 150);

  } else {
    // Direct redirect mode — address bar will show the target URL (P5 not needed).
    hideLoading();
    window.location.replace(targetUrl);
  }
})().catch((err) => showErrorCard('Extension error', err.message));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

function refocusTrap() {
  document.getElementById('focus-trap').focus();
}

function showSetupCard() {
  document.getElementById('setup-card').removeAttribute('hidden');
}

function showErrorCard(message, detail) {
  document.getElementById('loading-overlay').style.display = 'none';
  document.getElementById('error-message').textContent = message;
  document.getElementById('error-detail').textContent = detail || '';
  document.getElementById('error-card').removeAttribute('hidden');
  document
    .getElementById('btn-open-options-error')
    .addEventListener('click', () => chrome.runtime.openOptionsPage());
}
