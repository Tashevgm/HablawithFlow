(function () {
  const STORAGE_KEY = "hwf_cookie_consent_v1";
  const COOKIE_NAME = "hwf_cookie_consent";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;
  const DEFAULT_CONSENT = {
    necessary: true,
    analytics: false,
    marketing: false,
    updatedAt: "",
    version: 1
  };

  function safeParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function readCookie(name) {
    const match = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`));

    if (!match) {
      return "";
    }

    return decodeURIComponent(match.split("=").slice(1).join("="));
  }

  function writeCookie(value) {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  }

  function normalizeConsent(value) {
    const next = {
      ...DEFAULT_CONSENT,
      ...(value || {})
    };

    next.necessary = true;
    next.analytics = Boolean(next.analytics);
    next.marketing = Boolean(next.marketing);
    next.updatedAt = next.updatedAt || "";
    next.version = 1;

    return next;
  }

  function loadConsent() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY) || "") || safeParse(readCookie(COOKIE_NAME));
    return normalizeConsent(stored);
  }

  let currentConsent = loadConsent();

  function hasStoredConsent() {
    return Boolean(localStorage.getItem(STORAGE_KEY) || readCookie(COOKIE_NAME));
  }

  function dispatchConsentUpdated() {
    window.dispatchEvent(
      new CustomEvent("hwf:cookie-consent-updated", {
        detail: { ...currentConsent }
      })
    );
  }

  function saveConsent(next) {
    currentConsent = normalizeConsent({
      ...currentConsent,
      ...next,
      updatedAt: new Date().toISOString()
    });

    const serialized = JSON.stringify(currentConsent);
    localStorage.setItem(STORAGE_KEY, serialized);
    writeCookie(serialized);
    hideBanner();
    hideModal();
    dispatchConsentUpdated();
  }

  function ensureFooterLegalLinks() {
    document.querySelectorAll(".site-footer .footer-grid").forEach((grid) => {
      if (grid.querySelector(".footer-col.legal-links")) {
        return;
      }

      const legalColumn = document.createElement("div");
      legalColumn.className = "footer-col legal-links";
      legalColumn.innerHTML = `
        <h4>Legal</h4>
        <a href="privacy-policy.html">Privacy Policy</a>
        <a href="terms.html">Terms of Service</a>
        <a href="cookie-policy.html">Cookie Policy</a>
        <button class="footer-inline-action" type="button" data-open-cookie-settings>Cookie Settings</button>
      `;
      grid.appendChild(legalColumn);
    });
  }

  function ensureBanner() {
    if (document.getElementById("cookie-consent-banner")) {
      return;
    }

    const banner = document.createElement("section");
    banner.id = "cookie-consent-banner";
    banner.className = "cookie-banner";
    banner.hidden = true;
    banner.innerHTML = `
      <h3>Cookie Preferences</h3>
      <p>
        We only use non-essential analytics or marketing cookies if you opt in. Necessary cookies stay on so login,
        security, and booking flows work properly.
      </p>
      <div class="cookie-banner-actions">
        <button class="cookie-btn primary" type="button" data-cookie-accept-all>Accept all</button>
        <button class="cookie-btn secondary" type="button" data-cookie-reject>Reject optional</button>
        <button class="cookie-btn secondary" type="button" data-open-cookie-settings>Manage preferences</button>
      </div>
    `;
    document.body.appendChild(banner);
  }

  function ensureModal() {
    if (document.getElementById("cookie-consent-modal")) {
      return;
    }

    const modal = document.createElement("section");
    modal.id = "cookie-consent-modal";
    modal.className = "cookie-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="cookie-modal-backdrop" data-close-cookie-settings></div>
      <div class="cookie-modal-panel" role="dialog" aria-modal="true" aria-labelledby="cookie-consent-title">
        <h3 id="cookie-consent-title">Manage Cookie Preferences</h3>
        <p>
          Necessary cookies are always active because the site cannot operate without them. Analytics and marketing cookies
          stay off until you choose otherwise.
        </p>
        <div class="cookie-toggle-list">
          <div class="cookie-toggle-row">
            <div>
              <strong>Necessary cookies</strong>
              <p>Required for account login, security, booking state, and core website operation.</p>
            </div>
            <label>
              <input type="checkbox" checked disabled>
              Always on
            </label>
          </div>
          <div class="cookie-toggle-row">
            <div>
              <strong>Analytics cookies</strong>
              <p>Used only if you allow measurement of page performance and usage patterns.</p>
            </div>
            <label>
              <input type="checkbox" id="cookie-analytics-toggle">
              Allow
            </label>
          </div>
          <div class="cookie-toggle-row">
            <div>
              <strong>Marketing cookies</strong>
              <p>Used only if you allow marketing or remarketing technologies from Hablawithflow or its ad partners.</p>
            </div>
            <label>
              <input type="checkbox" id="cookie-marketing-toggle">
              Allow
            </label>
          </div>
        </div>
        <div class="cookie-modal-actions">
          <button class="cookie-btn primary" type="button" data-save-cookie-settings>Save preferences</button>
          <button class="cookie-btn secondary" type="button" data-cookie-reject>Reject optional</button>
          <button class="cookie-btn secondary" type="button" data-close-cookie-settings>Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function syncModalToggles() {
    const analyticsToggle = document.getElementById("cookie-analytics-toggle");
    const marketingToggle = document.getElementById("cookie-marketing-toggle");

    if (analyticsToggle) {
      analyticsToggle.checked = Boolean(currentConsent.analytics);
    }

    if (marketingToggle) {
      marketingToggle.checked = Boolean(currentConsent.marketing);
    }
  }

  function showBanner() {
    ensureBanner();
    document.getElementById("cookie-consent-banner").hidden = false;
  }

  function hideBanner() {
    const banner = document.getElementById("cookie-consent-banner");
    if (banner) {
      banner.hidden = true;
    }
  }

  function openModal() {
    ensureModal();
    syncModalToggles();
    document.getElementById("cookie-consent-modal").hidden = false;
  }

  function hideModal() {
    const modal = document.getElementById("cookie-consent-modal");
    if (modal) {
      modal.hidden = true;
    }
  }

  function init() {
    ensureFooterLegalLinks();
    ensureBanner();
    ensureModal();

    if (!hasStoredConsent()) {
      showBanner();
    }

    document.body.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest("[data-open-cookie-settings]")) {
        openModal();
        return;
      }

      if (target.closest("[data-cookie-accept-all]")) {
        saveConsent({
          analytics: true,
          marketing: true
        });
        return;
      }

      if (target.closest("[data-cookie-reject]")) {
        saveConsent({
          analytics: false,
          marketing: false
        });
        return;
      }

      if (target.closest("[data-save-cookie-settings]")) {
        saveConsent({
          analytics: Boolean(document.getElementById("cookie-analytics-toggle")?.checked),
          marketing: Boolean(document.getElementById("cookie-marketing-toggle")?.checked)
        });
        return;
      }

      if (target.closest("[data-close-cookie-settings]")) {
        hideModal();
      }
    });

    dispatchConsentUpdated();
  }

  window.HWFCookieConsent = {
    getConsent() {
      return { ...currentConsent };
    },
    hasConsent(category) {
      if (category === "necessary") {
        return true;
      }

      return Boolean(currentConsent[category]);
    },
    openSettings: openModal
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
