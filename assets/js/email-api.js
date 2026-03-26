const isLocalOrigin =
  window.location.origin.includes("127.0.0.1:5500") ||
  window.location.origin.includes("localhost:5500") ||
  window.location.origin.includes("127.0.0.1:8787") ||
  window.location.origin.includes("localhost:8787");

const configuredApiBase =
  window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
    ? window.HWF_APP_CONFIG.apiBase.trim()
    : "";

const EMAIL_API_BASE = configuredApiBase || (isLocalOrigin ? "http://127.0.0.1:8787" : "");

async function sendEmailRequest(path, payload) {
  if (!EMAIL_API_BASE) {
    throw new Error("Email backend is not configured for this site yet.");
  }

  const response = await fetch(`${EMAIL_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({ ok: false, error: "Invalid email server response." }));

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Email request failed with status ${response.status}.`);
  }

  return data;
}

window.HWFEmailApi = {
  sendRegistrationEmail(payload) {
    return sendEmailRequest("/api/email/register", payload);
  },
  sendBookingEmail(payload) {
    return sendEmailRequest("/api/email/booking", payload);
  }
};
