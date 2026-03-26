const EMAIL_API_BASE = "http://127.0.0.1:8787";

async function sendEmailRequest(path, payload) {
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
