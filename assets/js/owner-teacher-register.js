const isLocalOwnerOrigin =
  window.location.origin.includes("127.0.0.1:5500") ||
  window.location.origin.includes("localhost:5500") ||
  window.location.origin.includes("127.0.0.1:8787") ||
  window.location.origin.includes("localhost:8787");

const configuredOwnerApiBase =
  window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
    ? window.HWF_APP_CONFIG.apiBase.trim()
    : "";

const OWNER_API_BASE = configuredOwnerApiBase || (isLocalOwnerOrigin ? "http://127.0.0.1:8787" : "");

function byId(id) {
  return document.getElementById(id);
}

function required(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getPasswordResetRedirect() {
  return `${window.location.origin}/set-password.html`;
}

function setAuthError(message) {
  const error = byId("owner-auth-error");
  if (!error) {
    return;
  }
  error.textContent = message;
  error.hidden = false;
}

function clearAuthError() {
  const error = byId("owner-auth-error");
  if (!error) {
    return;
  }
  error.hidden = true;
  error.textContent = "";
}

function setAuthFeedback(message, type) {
  const feedback = byId("owner-auth-feedback");
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function clearAuthFeedback() {
  const feedback = byId("owner-auth-feedback");
  if (!feedback) {
    return;
  }
  feedback.hidden = true;
  feedback.textContent = "";
}

function showOwnerResetLink(link) {
  const wrap = byId("owner-reset-link-wrap");
  const input = byId("owner-reset-link");
  if (!wrap || !input) {
    return;
  }

  if (!required(link)) {
    wrap.hidden = true;
    input.value = "";
    return;
  }

  input.value = link;
  wrap.hidden = false;
}

function setRegisterFeedback(message, type) {
  const feedback = byId("teacher-register-feedback");
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function hideRegisterFeedback() {
  const feedback = byId("teacher-register-feedback");
  if (!feedback) {
    return;
  }
  feedback.hidden = true;
  feedback.textContent = "";
}

function showManualSetupLink(link) {
  const wrap = byId("manual-link-wrap");
  const input = byId("manual-setup-link");
  if (!wrap || !input) {
    return;
  }

  if (!required(link)) {
    wrap.hidden = true;
    input.value = "";
    return;
  }

  input.value = link;
  wrap.hidden = false;
}

function toggleOwnerView(showRegisterCard) {
  const loginCard = byId("owner-login-card");
  const registerCard = byId("owner-register-card");

  if (loginCard) {
    loginCard.hidden = showRegisterCard;
  }

  if (registerCard) {
    registerCard.hidden = !showRegisterCard;
  }
}

async function sendOwnerApiRequest(path, { method = "GET", payload, token } = {}) {
  if (!OWNER_API_BASE) {
    throw new Error("App backend is not configured for this page yet.");
  }

  const headers = {};
  if (required(token || "")) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (payload) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${OWNER_API_BASE}${path}`, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined
  });

  const data = await response.json().catch(() => ({ ok: false, error: "Invalid server response." }));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}.`);
  }

  return data;
}

async function getAccessToken() {
  if (!window.supabaseClient) {
    throw new Error("Supabase auth is not configured.");
  }

  const {
    data: { session },
    error
  } = await window.supabaseClient.auth.getSession();

  if (error) {
    throw error;
  }

  return session?.access_token || "";
}

async function verifyOwnerAccess() {
  if (!window.supabaseClient) {
    throw new Error("Supabase auth is not configured.");
  }

  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  if (!user) {
    return {
      ok: false,
      reason: "not_signed_in"
    };
  }

  const token = await getAccessToken();
  if (!required(token)) {
    return {
      ok: false,
      reason: "missing_token",
      error: "Session token not found. Please sign in again."
    };
  }

  try {
    await sendOwnerApiRequest("/api/owner/access", { token });
    return {
      ok: true,
      token
    };
  } catch (error) {
    return {
      ok: false,
      reason: "owner_check_failed",
      error: error.message || "Owner access check failed."
    };
  }
}

async function syncOwnerView(showAuthError) {
  clearAuthError();
  clearAuthFeedback();
  showOwnerResetLink("");

  const access = await verifyOwnerAccess();
  if (!access.ok) {
    toggleOwnerView(false);

    if (showAuthError && access.reason !== "not_signed_in") {
      setAuthError(access.error || "Owner verification failed.");
    }

    if (access.reason === "owner_check_failed" && window.supabaseClient) {
      await window.supabaseClient.auth.signOut();
    }
    return null;
  }

  toggleOwnerView(true);
  return access;
}

function bindOwnerAuth() {
  const loginButton = byId("owner-login");
  const forgotButton = byId("owner-forgot-password");
  const logoutButton = byId("owner-logout");

  if (loginButton) {
    loginButton.addEventListener("click", async () => {
      clearAuthError();
      clearAuthFeedback();

      if (!window.supabaseClient) {
        setAuthError("Supabase auth is not configured.");
        return;
      }

      const email = (byId("owner-email")?.value || "").trim().toLowerCase();
      const password = byId("owner-password")?.value || "";

      if (!required(email) || !required(password)) {
        setAuthError("Enter your owner email and password.");
        return;
      }

      const { error } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        setAuthError(error.message);
        return;
      }

      const access = await syncOwnerView(true);
      if (access) {
        setAuthFeedback("Owner access verified.", "success");
      }
    });
  }

  if (forgotButton) {
    forgotButton.addEventListener("click", async () => {
      clearAuthError();
      clearAuthFeedback();
      showOwnerResetLink("");

      const email = (byId("owner-email")?.value || "").trim().toLowerCase();
      if (!required(email)) {
        setAuthFeedback("Enter your owner email first, then click Forgot password.", "error");
        return;
      }

      forgotButton.disabled = true;
      setAuthFeedback("Sending reset email...", "success");

      try {
        const result = await sendOwnerApiRequest("/api/owner/password-reset", {
          method: "POST",
          payload: {
            email,
            redirectTo: getPasswordResetRedirect()
          }
        });
        setAuthFeedback(
          result.message || "Password reset request completed.",
          "success"
        );
        showOwnerResetLink(result.resetUrl || "");
      } catch (error) {
        setAuthFeedback(error.message || "Could not send reset email right now. Please try again.", "error");
      } finally {
        forgotButton.disabled = false;
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      if (window.supabaseClient) {
        await window.supabaseClient.auth.signOut();
      }
      showManualSetupLink("");
      hideRegisterFeedback();
      await syncOwnerView(false);
    });
  }
}

function bindTeacherRegistration() {
  const form = byId("teacher-register-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideRegisterFeedback();
    showManualSetupLink("");

    const access = await syncOwnerView(true);
    if (!access) {
      setRegisterFeedback("Owner access required.", "error");
      return;
    }

    const payload = {
      name: (byId("teacher-name")?.value || "").trim(),
      email: (byId("teacher-email")?.value || "").trim().toLowerCase(),
      timezone: (byId("teacher-timezone")?.value || "").trim(),
      hourlyRate: (byId("teacher-hourly-rate")?.value || "").trim(),
      bio: (byId("teacher-bio")?.value || "").trim()
    };

    if (!required(payload.name) || !required(payload.email)) {
      setRegisterFeedback("Please enter teacher name and email.", "error");
      return;
    }

    try {
      const result = await sendOwnerApiRequest("/api/owner/teacher-register", {
        method: "POST",
        payload,
        token: access.token
      });

      setRegisterFeedback(result.message || "Teacher account updated.", "success");
      showManualSetupLink(result.accountSetupUrl || "");

      form.reset();
      const timezoneField = byId("teacher-timezone");
      if (timezoneField) {
        timezoneField.value = "Europe/London";
      }
    } catch (error) {
      setRegisterFeedback(error.message || "Could not register teacher account.", "error");
    }
  });
}

async function initOwnerTeacherRegister() {
  bindOwnerAuth();
  bindTeacherRegistration();
  await syncOwnerView(false);
}

initOwnerTeacherRegister();
