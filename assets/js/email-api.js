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

async function sendEmailRequest(path, payload, options = {}) {
  if (!EMAIL_API_BASE) {
    throw new Error("Email backend is not configured for this site yet.");
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(`${EMAIL_API_BASE}${path}`, {
    method: options.method || "POST",
    headers,
    body: payload ? JSON.stringify(payload) : undefined
  });

  const data = await response.json().catch(() => ({ ok: false, error: "Invalid email server response." }));

  if (!response.ok) {
    const error = new Error(data.error || `Email request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  if (!data.ok) {
    throw new Error(data.error || "Email request failed.");
  }

  return data;
}

window.HWFEmailApi = {
  sendRegistrationEmail(payload) {
    return sendEmailRequest("/api/email/register", payload);
  },
  sendBookingEmail(payload) {
    return sendEmailRequest("/api/email/booking", payload);
  },
  sendPaymentPendingEmail(payload) {
    return sendEmailRequest("/api/email/payment-pending", payload).catch((error) => {
      if (Number(error?.status) === 404) {
        return sendEmailRequest("/api/email/booking", {
          ...payload,
          message: "Payment pending reminder fallback."
        });
      }

      throw error;
    });
  },
  sendTrialBookingEmail(payload) {
    return sendEmailRequest("/api/email/trial-booking", payload);
  },
  sendTeacherInterestEmail(payload) {
    return sendEmailRequest("/api/email/teacher-interest", payload);
  },
  completeConfirmedTrialBooking(accessToken) {
    return sendEmailRequest(
      "/api/booking/confirm-email-complete",
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );
  }
};
