const isLocalTeacherPortalOrigin =
  window.location.origin.includes("127.0.0.1:5500") ||
  window.location.origin.includes("localhost:5500") ||
  window.location.origin.includes("127.0.0.1:8787") ||
  window.location.origin.includes("localhost:8787");

const configuredTeacherPortalApiBase =
  window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
    ? window.HWF_APP_CONFIG.apiBase.trim()
    : "";

const TEACHER_PORTAL_API_BASE =
  configuredTeacherPortalApiBase || (isLocalTeacherPortalOrigin ? "http://127.0.0.1:8787" : "");

function byId(id) {
  return document.getElementById(id);
}

function required(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function setGateMessage(message, type = "success") {
  const node = byId("invite-gate-message");
  if (!node) {
    return;
  }
  node.textContent = message;
  node.className = `booking-feedback ${type}`;
  node.hidden = false;
}

function setRegisterFeedback(message, type) {
  const node = byId("invite-register-feedback");
  if (!node) {
    return;
  }
  node.textContent = message;
  node.className = `booking-feedback ${type}`;
  node.hidden = false;
}

function clearRegisterFeedback() {
  const node = byId("invite-register-feedback");
  if (!node) {
    return;
  }
  node.hidden = true;
  node.textContent = "";
}

function showManualSetupLink(link) {
  const wrap = byId("invite-manual-link-wrap");
  const input = byId("invite-manual-setup-link");
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

async function sendTeacherApiRequest(path, payload) {
  if (!TEACHER_PORTAL_API_BASE) {
    throw new Error("App backend is not configured for this page yet.");
  }

  const response = await fetch(`${TEACHER_PORTAL_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  const data = await response.json().catch(() => ({
    ok: false,
    error: "Invalid server response."
  }));

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}.`);
  }

  return data;
}

function bindTeacherPortalForm() {
  const form = byId("invite-register-form");
  const submit = byId("invite-register-submit");
  if (!form || !submit) {
    return;
  }

  form.hidden = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearRegisterFeedback();
    showManualSetupLink("");

    const payload = {
      name: (byId("invite-name")?.value || "").trim(),
      email: (byId("invite-email")?.value || "").trim().toLowerCase(),
      timezone: (byId("invite-timezone")?.value || "").trim(),
      hourlyRate: (byId("invite-hourly-rate")?.value || "").trim(),
      bio: (byId("invite-bio")?.value || "").trim()
    };

    if (!required(payload.name) || !required(payload.email)) {
      setRegisterFeedback("Please enter teacher name and email.", "error");
      return;
    }

    submit.disabled = true;
    try {
      const result = await sendTeacherApiRequest("/api/teacher/register", payload);
      setRegisterFeedback(result.message || "Teacher account updated.", "success");
      showManualSetupLink(result.accountSetupUrl || "");

      form.reset();
      const timezoneField = byId("invite-timezone");
      if (timezoneField) {
        timezoneField.value = "Europe/London";
      }
    } catch (error) {
      setRegisterFeedback(error.message || "Could not register teacher account.", "error");
    } finally {
      submit.disabled = false;
    }
  });
}

function initTeacherInviteRegister() {
  setGateMessage("Private teacher registration portal is ready.", "success");
  bindTeacherPortalForm();
}

initTeacherInviteRegister();
