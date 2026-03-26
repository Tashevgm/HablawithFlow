function setPasswordFeedback(message, type) {
  const feedback = document.getElementById("set-password-feedback");
  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function setFormEnabled(enabled) {
  document.getElementById("set-password-value").disabled = !enabled;
  document.getElementById("set-password-confirm").disabled = !enabled;
  document.getElementById("set-password-submit").disabled = !enabled;
}

async function refreshPasswordSetupState() {
  const status = document.getElementById("set-password-status");
  const emailInput = document.getElementById("set-password-email");
  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();

  if (!session || !session.user) {
    status.textContent = "This setup link is missing or expired. Open the latest email link and try again.";
    emailInput.value = "";
    setFormEnabled(false);
    return null;
  }

  const email = session.user.email || "";
  status.textContent = "Your secure session is active. Set your password below.";
  emailInput.value = email;
  setFormEnabled(true);
  return session.user;
}

function bindSetPasswordForm() {
  const form = document.getElementById("set-password-form");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = document.getElementById("set-password-value").value;
    const confirmPassword = document.getElementById("set-password-confirm").value;

    if (!password || password.length < 8) {
      setPasswordFeedback("Please create a password with at least 8 characters.", "error");
      return;
    }

    if (password !== confirmPassword) {
      setPasswordFeedback("Your password confirmation does not match.", "error");
      return;
    }

    const { error } = await window.supabaseClient.auth.updateUser({
      password
    });

    if (error) {
      setPasswordFeedback(error.message, "error");
      return;
    }

    form.reset();
    const emailInput = document.getElementById("set-password-email");
    emailInput.value = (await window.supabaseClient.auth.getUser()).data.user?.email || emailInput.value;
    setPasswordFeedback("Your password is set. You can now sign in to the student portal.", "success");
    document.getElementById("set-password-status").textContent = "Account active. Your student portal is ready.";
  });
}

window.supabaseClient.auth.onAuthStateChange(async (event) => {
  if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY" || event === "INITIAL_SESSION") {
    await refreshPasswordSetupState();
  }
});

bindSetPasswordForm();
refreshPasswordSetupState();
