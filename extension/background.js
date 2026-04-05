/**
 * @file background.js
 * @description MV3 service worker for the "cust*m Tab" Chrome extension.
 *
 * Storage schema (chrome.storage.local):
 * @typedef {Object} StorageSchema
 * @property {string}               targetUrl          - URL to load in the new tab
 * @property {boolean}              maskUrl            - true = iframe mode; false = redirect mode
 * @property {boolean}              preload            - Preload target every 10 min (stub for v1.1)
 * @property {'auto'|'light'|'dark'} theme             - Options page theme preference
 * @property {boolean}              onboardingDone     - Set true after first-install onboarding
 * @property {number}               lastSeen           - Date.now() set on every new tab open
 * @property {number}               browserLastStartup - Date.now() set on chrome.runtime.onStartup
 * @property {number}               lastNotified       - Date.now() of last persistence notification
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Alarm name used for the hourly persistence check. */
const ALARM_PERSISTENCE = 'persistenceCheck';

/** Notification ID for the "override may be disabled" alert. */
const NOTIFICATION_ID = 'custmtab-persistence';

/** How long after browser startup with no new-tab activity triggers a notification (2 hours). */
const STARTUP_GRACE_MS = 2 * 60 * 60 * 1000;

/** Minimum interval between persistence notifications (24 hours). */
const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// chrome.runtime.onInstalled
// ---------------------------------------------------------------------------

/**
 * Handles extension installation and update events.
 *
 * On first install:
 *  - Opens the options page in onboarding mode.
 *  - Marks onboarding as not yet completed in storage.
 *
 * On every install/update:
 *  - (Re-)creates the hourly persistence-check alarm so it always exists.
 *
 * @param {chrome.runtime.InstalledDetails} details
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Open the options page with the onboarding query parameter so the UI
    // can present the first-run walkthrough to the user.
    await chrome.tabs.create({
      url: chrome.runtime.getURL('options.html') + '?onboarding=true',
    });

    // Record that onboarding has not been completed yet.
    await chrome.storage.local.set({ onboardingDone: false });
  }

  // Always ensure the persistence alarm exists (also recreated after updates,
  // since alarms are cleared when the service worker is updated).
  await chrome.alarms.create(ALARM_PERSISTENCE, { periodInMinutes: 60 });
});

// ---------------------------------------------------------------------------
// chrome.runtime.onStartup
// ---------------------------------------------------------------------------

/**
 * Fires once per browser session startup (not on every service-worker wake).
 * Records the startup timestamp so the persistence check can detect sessions
 * where the user never opened a new tab through the extension.
 */
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ browserLastStartup: Date.now() });
});

// ---------------------------------------------------------------------------
// Persistence check logic
// ---------------------------------------------------------------------------

/**
 * Checks whether the extension's new-tab override appears to still be active.
 *
 * Logic:
 *  1. Reads relevant timestamps from storage.
 *  2. Skips the check if no targetUrl has been configured.
 *  3. If the browser started 2+ hours ago AND no new tab has been opened
 *     through the extension since that startup, the override may have been
 *     disabled (e.g. by another extension or a Chrome reset).
 *  4. If the above condition holds and no notification was sent in the last
 *     24 hours, shows a notification prompting the user to verify.
 *
 * @returns {Promise<void>}
 */
async function checkPersistence() {
  const { targetUrl, lastSeen, browserLastStartup, lastNotified } =
    await chrome.storage.local.get([
      'targetUrl',
      'lastSeen',
      'browserLastStartup',
      'lastNotified',
    ]);

  const now = Date.now();

  // Nothing to check if no URL has been configured yet.
  if (!targetUrl) return;

  const startupTooLongAgo =
    browserLastStartup &&
    now - browserLastStartup > STARTUP_GRACE_MS;

  const noNewTabSinceStartup =
    !lastSeen || lastSeen < browserLastStartup;

  if (startupTooLongAgo && noNewTabSinceStartup) {
    const cooldownExpired =
      !lastNotified || now - lastNotified > NOTIFY_COOLDOWN_MS;

    if (cooldownExpired) {
      // Show a non-intrusive notification asking the user to verify the override.
      await chrome.notifications.create(NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'cust*m Tab \u2014 Check required',
        message:
          'Your new tab override may have been disabled. Open a new tab to verify.',
      });

      // Record when we last notified so we respect the 24-hour cooldown.
      await chrome.storage.local.set({ lastNotified: now });
    }
  }
}

// ---------------------------------------------------------------------------
// chrome.alarms.onAlarm
// ---------------------------------------------------------------------------

/**
 * Alarm listener. Routes the 'persistenceCheck' alarm to checkPersistence().
 *
 * @param {chrome.alarms.Alarm} alarm
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_PERSISTENCE) {
    await checkPersistence();
  }
});

// ---------------------------------------------------------------------------
// chrome.notifications.onClicked
// ---------------------------------------------------------------------------

/**
 * Handles clicks on extension notifications.
 *
 * When the user clicks the persistence-check notification:
 *  - Opens the options page so they can inspect/fix their settings.
 *  - Clears the notification to avoid clutter.
 *
 * @param {string} notificationId
 */
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId === NOTIFICATION_ID) {
    await chrome.runtime.openOptionsPage();
    await chrome.notifications.clear(NOTIFICATION_ID);
  }
});

// ---------------------------------------------------------------------------
// chrome.action.onClicked
// ---------------------------------------------------------------------------

/**
 * Handles clicks on the extension's toolbar icon.
 * Opens the options page directly.
 */
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
