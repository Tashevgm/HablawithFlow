const REGISTER_STORAGE_KEY = "hwf_registrations";

function loadRegistrations() {
  const stored = localStorage.getItem(REGISTER_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveRegistrations(registrations) {
  localStorage.setItem(REGISTER_STORAGE_KEY, JSON.stringify(registrations));
}

function setRegisterFeedback(message, type) {
  const feedback = document.getElementById("register-feedback");
  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function preselectTimezone() {
  const timezoneSelect = document.getElementById("reg-timezone");

  try {
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const matchingOption = [...timezoneSelect.options].find((option) => option.value === detectedTimezone);

    if (matchingOption) {
      timezoneSelect.value = detectedTimezone;
    }
  } catch {
    // Ignore timezone detection failures and leave manual selection in place.
  }
}

function bindRegisterForm() {
  const form = document.getElementById("register-form");

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const registration = {
      name: document.getElementById("reg-name").value.trim(),
      email: document.getElementById("reg-email").value.trim(),
      level: document.getElementById("reg-level").value,
      track: document.getElementById("reg-track").value,
      timezone: document.getElementById("reg-timezone").value,
      goal: document.getElementById("reg-goal").value,
      message: document.getElementById("reg-message").value.trim(),
      submittedAt: new Date().toISOString()
    };

    if (!registration.name || !registration.email || !registration.track || !registration.goal) {
      setRegisterFeedback("Please complete your name, email, preferred track, and main goal.", "error");
      return;
    }

    const registrations = loadRegistrations();
    registrations.push(registration);
    saveRegistrations(registrations);

    form.reset();
    setRegisterFeedback(
      "Registration submitted. The next step is booking your first lesson or receiving portal access details.",
      "success"
    );
  });
}

preselectTimezone();
bindRegisterForm();
