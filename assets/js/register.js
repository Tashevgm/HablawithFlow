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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const registration = {
      name: document.getElementById("reg-name").value.trim(),
      email: document.getElementById("reg-email").value.trim(),
      password: document.getElementById("reg-password").value,
      confirmPassword: document.getElementById("reg-password-confirm").value,
      level: document.getElementById("reg-level").value,
      track: document.getElementById("reg-track").value,
      timezone: document.getElementById("reg-timezone").value,
      goal: document.getElementById("reg-goal").value,
      message: document.getElementById("reg-message").value.trim(),
      legalConsent: document.getElementById("reg-legal-consent").checked,
      marketingEmailOptIn: document.getElementById("reg-marketing-consent").checked,
      legalAcceptedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString()
    };

    if (!registration.name || !registration.email || !registration.track || !registration.goal) {
      setRegisterFeedback("Please complete your name, email, preferred track, and main goal.", "error");
      return;
    }

    if (!registration.password || registration.password.length < 8) {
      setRegisterFeedback("Please create a password with at least 8 characters.", "error");
      return;
    }

    if (registration.password !== registration.confirmPassword) {
      setRegisterFeedback("Your password confirmation does not match.", "error");
      return;
    }

    if (!registration.legalConsent) {
      setRegisterFeedback("Please accept the Privacy Policy and Terms before creating your account.", "error");
      return;
    }

    const { data, error } = await window.supabaseClient.auth.signUp({
      email: registration.email,
      password: registration.password,
      options: {
        data: {
          full_name: registration.name,
          level: registration.level || "Beginner",
          track: registration.track,
          timezone: registration.timezone || "other",
          goal: registration.goal,
          notes: registration.message,
          terms_accepted_at: registration.legalAcceptedAt,
          privacy_accepted_at: registration.legalAcceptedAt,
          marketing_email_opt_in: Boolean(registration.marketingEmailOptIn),
          marketing_email_opt_in_at: registration.marketingEmailOptIn ? registration.legalAcceptedAt : ""
        }
      }
    });

    if (error) {
      setRegisterFeedback(error.message, "error");
      return;
    }

    if (data.user && data.session) {
      await window.supabaseClient.from("profiles").upsert({
        id: data.user.id,
        full_name: registration.name,
        level: registration.level || "Beginner",
        track: registration.track,
        timezone: registration.timezone || "other",
        goal: registration.goal,
        notes: registration.message
      });
    }

    const localResult = window.HWFData.registerStudent(registration);
    if (!localResult.ok) {
      setRegisterFeedback(localResult.error, "error");
      return;
    }

    let emailMessage = "";

    try {
      await window.HWFEmailApi.sendRegistrationEmail({
        name: registration.name,
        email: registration.email,
        track: registration.track,
        goal: registration.goal,
        timezone: registration.timezone || "other"
      });
      emailMessage = " A welcome email has been sent.";
    } catch {
      emailMessage = " Your account was created, but the welcome email could not be sent yet.";
    }

    form.reset();
    preselectTimezone();
    setRegisterFeedback(
      data.session
        ? `Registration complete. You can now sign in to the student portal with your email and password.${emailMessage}`
        : `Registration submitted. Check your email to confirm your account, then sign in to the student portal.${emailMessage}`,
      "success"
    );
  });
}

window.HWFData.ensurePortalState();
preselectTimezone();
bindRegisterForm();
