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

async function createTeacherProfile(userId, payload) {
  const profilePayload = {
    id: userId,
    full_name: payload.name,
    role: "teacher",
    timezone: payload.timezone || "Europe/London",
    notes: payload.bio || "",
    track: "Teacher",
    goal: "Teach on Hablawithflow"
  };

  const teacherProfilePayload = {
    id: userId,
    bio: payload.bio || null,
    hourly_rate: payload.hourlyRate || null,
    timezone: payload.timezone || "Europe/London"
  };

  const profileResult = await window.supabaseClient.from("profiles").upsert(profilePayload);
  if (profileResult.error) {
    throw profileResult.error;
  }

  const teacherProfileResult = await window.supabaseClient
    .from("teacher_profiles")
    .upsert(teacherProfilePayload);
  if (teacherProfileResult.error) {
    throw teacherProfileResult.error;
  }
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

    if (!window.supabaseClient) {
      setRegisterFeedback("Supabase auth is not configured.", "error");
      return;
    }

    const payload = {
      name: (byId("invite-name")?.value || "").trim(),
      email: (byId("invite-email")?.value || "").trim().toLowerCase(),
      timezone: (byId("invite-timezone")?.value || "").trim(),
      hourlyRate: (byId("invite-hourly-rate")?.value || "").trim(),
      bio: (byId("invite-bio")?.value || "").trim(),
      password: byId("invite-password")?.value || "",
      confirmPassword: byId("invite-password-confirm")?.value || ""
    };

    if (!required(payload.name) || !required(payload.email)) {
      setRegisterFeedback("Please enter teacher name and email.", "error");
      return;
    }

    if (!payload.password || payload.password.length < 8) {
      setRegisterFeedback("Please create a password with at least 8 characters.", "error");
      return;
    }

    if (payload.password !== payload.confirmPassword) {
      setRegisterFeedback("Your password confirmation does not match.", "error");
      return;
    }

    submit.disabled = true;

    try {
      const { data, error } = await window.supabaseClient.auth.signUp({
        email: payload.email,
        password: payload.password,
        options: {
          emailRedirectTo: `${window.location.origin}/set-password.html`,
          data: {
            full_name: payload.name,
            role: "teacher",
            timezone: payload.timezone || "Europe/London",
            notes: payload.bio || "",
            hourly_rate: payload.hourlyRate || "",
            source: "teacher_private_portal"
          }
        }
      });

      if (error) {
        setRegisterFeedback(error.message, "error");
        return;
      }

      if (data.user && data.session) {
        await createTeacherProfile(data.user.id, payload);
      }

      form.reset();
      byId("invite-timezone").value = "Europe/London";

      setRegisterFeedback(
        data.session
          ? "Registration complete. You can now sign in to the teacher portal with your email and password."
          : "Registration submitted. Check your email to confirm your account, then sign in to the teacher portal.",
        "success"
      );
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
