/**
 * cust*m Tab — Options Page Script
 *
 * Handles: loading/saving settings, URL validation, theme cycling,
 * onboarding banner, auto-save toggles, and status badge updates.
 *
 * No external dependencies. Runs as an inline script (no module exports).
 */

(async () => {
  'use strict';

  /* ----------------------------------------------------------
     DOM REFERENCES
  ---------------------------------------------------------- */

  const urlInput          = document.getElementById('url-input');
  const urlStatusIcon     = document.getElementById('url-status-icon');
  const urlHint           = document.getElementById('url-hint');
  const maskUrlToggle     = document.getElementById('toggle-mask-url');
  const preloadToggle     = document.getElementById('toggle-preload');
  const btnSave           = document.getElementById('btn-save');
  const saveFeedback      = document.getElementById('save-feedback');
  const statusBadge       = document.getElementById('status-badge');
  const themeToggle       = document.getElementById('theme-toggle');
  const onboardingBanner  = document.getElementById('onboarding-banner');
  const btnDismissOnboard = document.getElementById('btn-dismiss-onboarding');

  /* ----------------------------------------------------------
     STATE
  ---------------------------------------------------------- */

  /** Currently selected theme: 'auto' | 'light' | 'dark' */
  let currentTheme = 'auto';

  /** Timer handle for URL validation debounce */
  let validateDebounceTimer = null;

  /* ----------------------------------------------------------
     THEME MANAGEMENT
  ---------------------------------------------------------- */

  /**
   * Apply a theme to the document root and update the toggle button.
   * @param {'auto'|'light'|'dark'} theme
   */
  function applyTheme(theme) {
    currentTheme = theme;

    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeToggle.textContent = '☾';
      themeToggle.title = 'Theme: dark';
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      themeToggle.textContent = '☀';
      themeToggle.title = 'Theme: light';
    } else {
      // 'auto' — remove attribute and let the CSS media query take over
      document.documentElement.removeAttribute('data-theme');
      themeToggle.textContent = '◐';
      themeToggle.title = 'Theme: auto (follows system)';
    }
  }

  /**
   * Cycle through themes: auto → light → dark → auto
   */
  function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    const nextIndex = (order.indexOf(currentTheme) + 1) % order.length;
    applyTheme(order[nextIndex]);
    // Persist immediately so the preference survives page reloads
    chrome.storage.local.set({ theme: currentTheme });
  }

  /* ----------------------------------------------------------
     STATUS BADGE
  ---------------------------------------------------------- */

  /**
   * Update the header badge to reflect whether a URL is configured.
   * @param {boolean} isActive
   */
  function updateStatusBadge(isActive) {
    if (isActive) {
      statusBadge.textContent = '● Active';
      statusBadge.classList.remove('status-badge--inactive');
      statusBadge.classList.add('status-badge--active');
    } else {
      statusBadge.textContent = '● Unconfigured';
      statusBadge.classList.remove('status-badge--active');
      statusBadge.classList.add('status-badge--inactive');
    }
  }

  /* ----------------------------------------------------------
     URL VALIDATION
  ---------------------------------------------------------- */

  /**
   * Validation state values for internal use.
   * @typedef {'valid'|'invalid'|'warning'|'empty'} ValidationState
   */

  /**
   * Apply visual validation state to the URL input and hint paragraph.
   * @param {ValidationState} state
   * @param {string} hintText  - Human-readable message shown below the input.
   * @param {string} iconText  - Icon character shown inside the input field.
   */
  function setInputState(state, hintText, iconText) {
    // Remove all state classes first
    urlInput.classList.remove('url-input--valid', 'url-input--invalid', 'url-input--warning');
    urlHint.classList.remove('field__hint--success', 'field__hint--error', 'field__hint--warning');

    if (state === 'valid') {
      urlInput.classList.add('url-input--valid');
      urlHint.classList.add('field__hint--success');
    } else if (state === 'invalid') {
      urlInput.classList.add('url-input--invalid');
      urlHint.classList.add('field__hint--error');
    } else if (state === 'warning') {
      urlInput.classList.add('url-input--warning');
      urlHint.classList.add('field__hint--warning');
    }
    // 'empty' → no extra classes, just clear text

    urlHint.textContent = hintText;
    urlStatusIcon.textContent = iconText;
  }

  /**
   * Validate a URL string and update the input UI accordingly.
   * Handles: empty, file://, chrome-extension://, and generic URLs.
   * @param {string} value - The raw string from the input field.
   * @returns {ValidationState} The resolved validation state.
   */
  async function validateUrl(value) {
    const trimmed = value.trim();

    // Empty — clear all state
    if (!trimmed) {
      setInputState('empty', '', '');
      return 'empty';
    }

    // file:// — requires the "Allow access to file URLs" permission
    if (trimmed.startsWith('file://')) {
      let fileAccessAllowed = false;
      try {
        fileAccessAllowed = await new Promise((resolve) => {
          chrome.extension.isAllowedFileSchemeAccess(resolve);
        });
      } catch {
        // isAllowedFileSchemeAccess may not be available in all contexts
        fileAccessAllowed = false;
      }

      if (fileAccessAllowed) {
        setInputState('valid', 'Local file — access enabled ✓', '✓');
        return 'valid';
      } else {
        setInputState('warning', 'File access not enabled — see guide below', '⚠');
        return 'warning';
      }
    }

    // chrome-extension:// — internal extension URL, always treat as valid
    if (trimmed.startsWith('chrome-extension://')) {
      setInputState('valid', 'Extension URL ✓', '✓');
      return 'valid';
    }

    // Generic URL — attempt to parse
    try {
      new URL(trimmed); // throws if invalid
      setInputState('valid', 'Looks good ✓', '✓');
      return 'valid';
    } catch {
      setInputState('invalid', 'Not a valid URL', '✗');
      return 'invalid';
    }
  }

  /* ----------------------------------------------------------
     SAVE FEEDBACK
  ---------------------------------------------------------- */

  /** Timer handle for clearing the save feedback message */
  let saveFeedbackTimer = null;

  /**
   * Briefly show a "Saved ✓" confirmation next to the Save button.
   */
  function showSaveFeedback() {
    saveFeedback.textContent = 'Saved ✓';
    saveFeedback.classList.add('save-feedback--visible');

    // Clear any previous timer so repeated saves don't stack
    if (saveFeedbackTimer) clearTimeout(saveFeedbackTimer);

    saveFeedbackTimer = setTimeout(() => {
      saveFeedback.classList.remove('save-feedback--visible');
      // Wait for the CSS opacity transition to finish before clearing text
      saveFeedbackTimer = setTimeout(() => {
        saveFeedback.textContent = '';
      }, 200);
    }, 2000);
  }

  /* ----------------------------------------------------------
     INITIALISATION — Load settings and populate UI
  ---------------------------------------------------------- */

  const settings = await chrome.storage.local.get([
    'targetUrl', 'maskUrl', 'preload', 'theme', 'onboardingDone',
  ]);

  // Populate URL field
  urlInput.value = settings.targetUrl || '';

  // maskUrl defaults to true (iframe mode) if not explicitly set to false
  maskUrlToggle.checked = settings.maskUrl !== false;

  // preload defaults to false
  preloadToggle.checked = !!settings.preload;

  // Apply saved (or default) theme
  applyTheme(settings.theme || 'auto');

  // Reflect whether a URL is already configured
  updateStatusBadge(!!settings.targetUrl);

  // Run initial validation if a URL is already stored
  if (settings.targetUrl) {
    await validateUrl(settings.targetUrl);
  }

  /* ----------------------------------------------------------
     ONBOARDING BANNER
  ---------------------------------------------------------- */

  const params = new URLSearchParams(location.search);
  const isOnboarding = params.get('onboarding') === 'true';

  if (isOnboarding && !settings.onboardingDone) {
    onboardingBanner.removeAttribute('hidden');
  }

  btnDismissOnboard.addEventListener('click', () => {
    onboardingBanner.setAttribute('hidden', '');
    chrome.storage.local.set({ onboardingDone: true });
  });

  /* ----------------------------------------------------------
     URL INPUT — Live validation (debounced)
  ---------------------------------------------------------- */

  urlInput.addEventListener('input', () => {
    clearTimeout(validateDebounceTimer);
    validateDebounceTimer = setTimeout(async () => {
      await validateUrl(urlInput.value);
    }, 400);
  });

  /* ----------------------------------------------------------
     THEME TOGGLE
  ---------------------------------------------------------- */

  themeToggle.addEventListener('click', cycleTheme);

  /* ----------------------------------------------------------
     SAVE BUTTON
  ---------------------------------------------------------- */

  btnSave.addEventListener('click', async () => {
    const urlValue = urlInput.value;

    // Re-validate synchronously so we have the current state before saving
    const state = await validateUrl(urlValue);

    // Block save only when the field has content but is structurally invalid
    if (state === 'invalid') {
      // The validation UI already shows the error; nothing more to do here
      return;
    }

    await chrome.storage.local.set({
      targetUrl: urlValue.trim(),
      maskUrl: maskUrlToggle.checked,
      preload: preloadToggle.checked,
      theme: currentTheme,
    });

    updateStatusBadge(!!urlValue.trim());
    showSaveFeedback();
  });

  /* ----------------------------------------------------------
     AUTO-SAVE TOGGLES
     Persist toggle state immediately on change, without requiring
     the user to click Save (better UX for boolean preferences).
  ---------------------------------------------------------- */

  maskUrlToggle.addEventListener('change', () => {
    chrome.storage.local.set({ maskUrl: maskUrlToggle.checked });
  });

  preloadToggle.addEventListener('change', () => {
    chrome.storage.local.set({ preload: preloadToggle.checked });
  });

})();
