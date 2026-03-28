const SEED_REVIEWS = [
  {
    name: "Sarah Johnson",
    role: "Marketing Executive",
    lesson: "1-on-1",
    rating: 5,
    color: "teal",
    text: "Vlad made learning feel like a conversation with a friend. The focus on rhythm and flow changed everything for me."
  },
  {
    name: "Michael Chen",
    role: "Travel Enthusiast",
    lesson: "1-on-1",
    rating: 5,
    color: "gold",
    text: "I finally felt confident on my trip to Mexico. We practiced real scenarios that I actually used every day."
  }
];

const REVIEW_STORAGE_KEY = "hwf_reviews";
const AVATAR_COLORS = ["teal", "gold", "red", "blue", "purple", "green"];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let bookingMonth = null;
let selectedBookingDate = "";
let selectedBookingTime = "";

async function getAuthenticatedBookingUser(email) {
  if (!window.supabaseClient) {
    return null;
  }

  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  if (!user || !user.email || user.email.toLowerCase() !== email.toLowerCase()) {
    return null;
  }

  return user;
}

function isAlreadyRegisteredAuthError(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("already exists")
  );
}

async function ensureBookingAccount({ studentName, email, password, lessonType, message, date, time }) {
  if (!window.supabaseClient) {
    return {
      ok: false,
      error: "Account signup is not configured yet."
    };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";

  const {
    data: { user: currentUser }
  } = await window.supabaseClient.auth.getUser();

  if (currentUser?.email && currentUser.email.toLowerCase() === normalizedEmail) {
    return {
      ok: true,
      created: false,
      existingAccount: true,
      sessionActive: true
    };
  }

  const pendingTrialBooking = {
    student_name: studentName,
    email: normalizedEmail,
    date,
    time,
    lesson_type: lessonType,
    message: message || "",
    timezone,
    source: "landing_free_lesson",
    created_at: new Date().toISOString()
  };

  const { data, error } = await window.supabaseClient.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/set-password.html?flow=booking-confirmation`,
      data: {
        full_name: studentName,
        level: "Beginner",
        track: lessonType,
        timezone,
        goal: "Free trial lesson",
        notes: message,
        pending_trial_booking: pendingTrialBooking
      }
    }
  });

  if (error) {
    if (isAlreadyRegisteredAuthError(error.message)) {
      return {
        ok: true,
        created: false,
        existingAccount: true,
        sessionActive: false
      };
    }

    return {
      ok: false,
      error: error.message || "Could not create your student account."
    };
  }

  const sessionActive = Boolean(data?.session);
  const isLikelyExistingMaskedUser =
    !sessionActive && Array.isArray(data?.user?.identities) && data.user.identities.length === 0;

  if (isLikelyExistingMaskedUser) {
    return {
      ok: true,
      created: false,
      existingAccount: true,
      sessionActive: false,
      confirmationPending: false
    };
  }

  if (data?.user && sessionActive) {
    await window.supabaseClient.from("profiles").upsert({
      id: data.user.id,
      full_name: studentName,
      level: "Beginner",
      track: lessonType,
      timezone,
      goal: "Free trial lesson",
      notes: message
    });
  }

  return {
    ok: true,
    created: true,
    existingAccount: false,
    sessionActive,
    confirmationPending: Boolean(data?.user && !sessionActive)
  };
}

async function saveServerBookingIfAuthenticated({ studentName, email, date, time, lessonType, message }) {
  const user = await getAuthenticatedBookingUser(email);

  if (!user) {
    return { ok: false, skipped: true };
  }

  const { error } = await window.supabaseClient.from("bookings").insert({
    student_id: user.id,
    student_email: email,
    student_name: studentName,
    lesson_type: lessonType,
    lesson_date: date,
    lesson_time: time,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London",
    message,
    status: "pending_payment"
  });

  if (error) {
    return { ok: false, skipped: false, error: error.message };
  }

  return { ok: true, skipped: false };
}

function isSlotStillAvailable(date, time) {
  return window.HWFData.listAvailability().some((slot) => slot.date === date && slot.time === time);
}

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function starsHtml(rating) {
  return Array.from({ length: 5 }, (_, index) => {
    return `<span class="star${index < rating ? "" : " empty"}">&#9733;</span>`;
  }).join("");
}

function loadReviews() {
  const stored = localStorage.getItem(REVIEW_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveReviews(reviews) {
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviews));
}

function allReviews() {
  return [...SEED_REVIEWS, ...loadReviews()];
}

function renderCard(review) {
  const initials = getInitials(review.name);
  const color =
    review.color ||
    AVATAR_COLORS[Math.abs(review.name.charCodeAt(0) - 65) % AVATAR_COLORS.length];

  return `
    <article class="testi-card">
      <div class="testi-card-top">
        <div class="testi-quote">"</div>
        <div class="testi-stars">${starsHtml(review.rating)}</div>
      </div>
      <p>${review.text}</p>
      <div class="testi-author">
        <div class="testi-avatar ${color}">${initials}</div>
        <div>
          <div class="testi-name">${review.name}</div>
          <div class="testi-role">${review.role || "Student"}</div>
          ${review.lesson ? `<span class="testi-lesson-tag">${review.lesson}</span>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderSummary(reviews) {
  const total = reviews.length;
  const average = total
    ? (reviews.reduce((sum, review) => sum + review.rating, 0) / total).toFixed(1)
    : "0.0";

  document.getElementById("avg-score").textContent = average;
  document.getElementById("review-count").textContent = `${total} review${total === 1 ? "" : "s"}`;

  const bars = [5, 4, 3, 2, 1]
    .map((rating) => {
      const count = reviews.filter((review) => review.rating === rating).length;
      const percentage = total ? Math.round((count / total) * 100) : 0;

      return `
        <div class="bar-row">
          <span class="bar-label">${rating}&#9733;</span>
          <div class="bar-track"><div class="bar-fill" style="width:${percentage}%"></div></div>
          <span class="bar-count">${count}</span>
        </div>
      `;
    })
    .join("");

  document.getElementById("summary-bars").innerHTML = bars;
}

function renderAllReviews() {
  const reviews = allReviews();
  document.getElementById("reviews-grid").innerHTML = reviews.map(renderCard).join("");
  renderSummary(reviews);
}

function bindPlanSelectionButtons() {
  const buttons = [...document.querySelectorAll(".plan-select-flow")];

  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const lessonType = button.dataset.lesson;
      const lessonSelect = document.getElementById("booking-lesson");
      const bookingSection = document.getElementById("booking");

      if (!lessonType || !lessonSelect || !bookingSection) {
        return;
      }

      lessonSelect.value = lessonType;
      bookingSection.scrollIntoView({ behavior: "smooth", block: "start" });

      window.requestAnimationFrame(() => {
        document.getElementById("booking-name")?.focus();
      });
    });
  });
}

function formatDate(dateString) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatDateLong(dateString) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function prefillBookingFormFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name");
  const email = params.get("email");
  const lesson = params.get("lesson");

  if (name) {
    document.getElementById("booking-name").value = name;
  }

  if (email) {
    document.getElementById("booking-email").value = email;
  }

  if (lesson) {
    const lessonSelect = document.getElementById("booking-lesson");
    const matchingOption = [...lessonSelect.options].find((option) => option.value === lesson);

    if (matchingOption) {
      lessonSelect.value = lesson;
    }
  }
}

function getAvailability() {
  return window.HWFData.listAvailability();
}

function uniqueDates(slots) {
  return [...new Set(slots.map((slot) => slot.date))];
}

function dateParts(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return { year, month, day };
}

function toMonthKey(dateString) {
  const { year, month } = dateParts(dateString);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthStart(dateString) {
  const { year, month } = dateParts(dateString);
  return new Date(year, month - 1, 1);
}

function shiftMonth(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toIsoDateFromDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getMonthAvailabilityDates(date) {
  const monthKey = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return uniqueDates(getAvailability()).filter((item) => item.startsWith(monthKey));
}

function getTimesForDate(dateString) {
  return getAvailability()
    .filter((slot) => slot.date === dateString)
    .map((slot) => slot.time)
    .sort();
}

function ensureBookingDefaults() {
  const dates = uniqueDates(getAvailability()).sort();

  if (!dates.length) {
    selectedBookingDate = "";
    selectedBookingTime = "";
    bookingMonth = new Date();
    return;
  }

  if (!selectedBookingDate || !dates.includes(selectedBookingDate)) {
    selectedBookingDate = dates[0];
  }

  const times = getTimesForDate(selectedBookingDate);
  if (!selectedBookingTime || !times.includes(selectedBookingTime)) {
    selectedBookingTime = times[0] || "";
  }

  if (!bookingMonth) {
    bookingMonth = monthStart(selectedBookingDate);
  }
}

function updateBookingSelectionUI() {
  const selection = document.getElementById("booking-selection");
  const dateInput = document.getElementById("booking-date");
  const timeInput = document.getElementById("booking-time");
  const trigger = document.getElementById("booking-calendar-trigger");
  const slots = getAvailability();
  const dates = uniqueDates(slots);

  dateInput.value = selectedBookingDate;
  timeInput.value = selectedBookingTime;

  if (!dates.length) {
    selection.textContent = "No lesson slots are open right now.";
    trigger.textContent = "No availability yet";
    trigger.disabled = true;
    return;
  }

  trigger.disabled = false;
  trigger.textContent = "Pick a slot";

  if (!selectedBookingDate || !selectedBookingTime) {
    selection.textContent = "Choose a highlighted date and time from the availability calendar.";
  } else {
    selection.textContent = `Selected: ${formatDateLong(selectedBookingDate)} at ${selectedBookingTime}.`;
  }
}

function renderBookingMonth() {
  const grid = document.getElementById("booking-month-grid");
  const monthLabel = document.getElementById("booking-month-label");
  const availableDates = new Set(uniqueDates(getAvailability()));
  const currentYear = bookingMonth.getFullYear();
  const currentMonth = bookingMonth.getMonth();
  const firstDay = new Date(currentYear, currentMonth, 1);
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstWeekday = (firstDay.getDay() + 6) % 7;

  monthLabel.textContent = bookingMonth.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric"
  });

  grid.innerHTML = WEEKDAY_LABELS.map((label) => {
    return `<div class="booking-day-name">${label}</div>`;
  }).join("");

  for (let index = 0; index < firstWeekday; index += 1) {
    grid.innerHTML += '<div class="booking-day-cell empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(currentYear, currentMonth, day);
    const isoDate = toIsoDateFromDate(date);
    const times = getTimesForDate(isoDate);
    const isAvailable = availableDates.has(isoDate);
    const isSelected = selectedBookingDate === isoDate;

    grid.innerHTML += `
      <button
        class="booking-day-cell ${isAvailable ? "available" : "closed"} ${isSelected ? "selected" : ""}"
        type="button"
        data-date="${isoDate}"
        ${isAvailable ? "" : "disabled"}
        >
          <strong>${day}</strong>
          <span>${isAvailable ? `${times.length} slot${times.length === 1 ? "" : "s"}` : "No slots"}</span>
        </button>
      `;
    }

  grid.querySelectorAll(".booking-day-cell.available").forEach((button) => {
    button.addEventListener("click", () => {
      selectedBookingDate = button.dataset.date;
      const times = getTimesForDate(selectedBookingDate);
      if (!times.includes(selectedBookingTime)) {
        selectedBookingTime = times[0] || "";
      }
      renderBookingMonth();
      renderBookingTimes();
      updateBookingSelectionUI();
    });
  });
}

function renderBookingTimes() {
  const container = document.getElementById("booking-time-list");
  const caption = document.getElementById("booking-times-caption");

  if (!selectedBookingDate) {
    caption.textContent = "Select a highlighted day to view times.";
    container.innerHTML = '<p class="booking-empty-state">No availability loaded yet.</p>';
    updateBookingConfirmButton();
    return;
  }

  const times = getTimesForDate(selectedBookingDate);
  caption.textContent = `${formatDateLong(selectedBookingDate)} has ${times.length} available time${times.length === 1 ? "" : "s"}.`;

  if (!times.length) {
    container.innerHTML = '<p class="booking-empty-state">No open times remain on that day.</p>';
    updateBookingConfirmButton();
    return;
  }

  container.innerHTML = times
    .map((time) => {
      return `
        <button class="booking-time-chip ${selectedBookingTime === time ? "active" : ""}" type="button" data-time="${time}">
          <strong>${time}</strong>
          <span>${selectedBookingTime === time ? "Selected" : "Choose this time"}</span>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll(".booking-time-chip").forEach((button) => {
    button.addEventListener("click", () => {
      selectedBookingTime = button.dataset.time;
      updateBookingSelectionUI();
      renderBookingTimes();
    });
  });

  updateBookingConfirmButton();
}

function openBookingModal() {
  ensureBookingDefaults();
  renderBookingMonth();
  renderBookingTimes();
  updateBookingConfirmButton();
  document.getElementById("booking-modal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeBookingModal() {
  document.getElementById("booking-modal").hidden = true;
  document.body.style.overflow = "";
}

function updateBookingConfirmButton() {
  const button = document.getElementById("booking-confirm-btn");
  const hasSelection = Boolean(selectedBookingDate && selectedBookingTime);

  if (!button) {
    return;
  }

  button.disabled = !hasSelection;
  button.textContent = hasSelection ? `Book Now: ${selectedBookingTime}` : "Book Now";
}

function setBookingFeedback(message, type) {
  const feedback = document.getElementById("booking-feedback");
  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function bindBookingModal() {
  document.getElementById("booking-calendar-trigger").addEventListener("click", openBookingModal);
  document.getElementById("booking-modal-close").addEventListener("click", closeBookingModal);
  document.getElementById("booking-modal-backdrop").addEventListener("click", closeBookingModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("booking-modal").hidden) {
      closeBookingModal();
    }
  });

  document.getElementById("booking-month-prev").addEventListener("click", () => {
    bookingMonth = shiftMonth(bookingMonth, -1);
    renderBookingMonth();
  });

  document.getElementById("booking-month-next").addEventListener("click", () => {
    bookingMonth = shiftMonth(bookingMonth, 1);
    renderBookingMonth();
  });

  document.getElementById("booking-confirm-btn").addEventListener("click", () => {
    if (!selectedBookingDate || !selectedBookingTime) {
      return;
    }

    updateBookingSelectionUI();
    closeBookingModal();
    document.getElementById("booking-name").focus();
  });
}

function bindBookingForm() {
  const bookingForm = document.querySelector(".booking-form");

  ensureBookingDefaults();
  prefillBookingFormFromQuery();
  updateBookingSelectionUI();
  bindBookingModal();

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const studentName = document.getElementById("booking-name").value.trim();
    const email = document.getElementById("booking-email").value.trim();
    const password = document.getElementById("booking-password").value;
    const confirmPassword = document.getElementById("booking-password-confirm").value;
    const date = document.getElementById("booking-date").value;
    const time = document.getElementById("booking-time").value;
    const lessonType = document.getElementById("booking-lesson").value;
    const message = document.getElementById("booking-message").value.trim();

    if (!studentName || !email || !password || !confirmPassword || !date || !time) {
      setBookingFeedback("Please complete your name, email, password, and choose an available lesson slot.", "error");
      return;
    }

    if (password.length < 8) {
      setBookingFeedback("Please create a password with at least 8 characters.", "error");
      return;
    }

    if (password !== confirmPassword) {
      setBookingFeedback("Password confirmation does not match.", "error");
      return;
    }

    if (!isSlotStillAvailable(date, time)) {
      setBookingFeedback("That time slot is no longer available. Please pick another slot.", "error");
      ensureBookingDefaults();
      updateBookingSelectionUI();
      renderBookingMonth();
      renderBookingTimes();
      return;
    }

    const accountResult = await ensureBookingAccount({
      studentName,
      email,
      password,
      lessonType,
      message,
      date,
      time
    });

    if (!accountResult.ok) {
      setBookingFeedback(accountResult.error, "error");
      return;
    }

    const result = window.HWFData.createBooking({
      studentName,
      email,
      date,
      time,
      lessonType,
      message
    });

    if (!result.ok) {
      setBookingFeedback(result.error, "error");
      ensureBookingDefaults();
      updateBookingSelectionUI();
      renderBookingMonth();
      renderBookingTimes();
      return;
    }

    bookingForm.reset();
    selectedBookingDate = "";
    selectedBookingTime = "";
    ensureBookingDefaults();
    updateBookingSelectionUI();
    renderBookingMonth();
    renderBookingTimes();

    let accountMessage = "";
    let emailMessage = "";
    let serverMessage = "";

    if (accountResult.created && accountResult.confirmationPending) {
      accountMessage = " Your student account was created. Check your inbox to confirm your email before logging in.";
    } else if (accountResult.created) {
      accountMessage = " Your student account was created with this password.";
    } else {
      accountMessage = " This email already has a student account, so use your existing password to log in.";
    }

    const serverResult = await saveServerBookingIfAuthenticated({
      studentName,
      email,
      date: result.booking.date,
      time: result.booking.time,
      lessonType,
      message
    });

    if (serverResult.ok) {
      serverMessage = " The class was also saved to your server-side student record and is awaiting payment confirmation.";
    } else if (!serverResult.skipped) {
      serverMessage = " The booking saved locally, but the server copy could not be created yet.";
    }

    if (accountResult.confirmationPending) {
      emailMessage = " Please confirm your signup email first. Once confirmed, your lesson confirmation email will be sent automatically.";
    } else {
      try {
        const emailResult = await window.HWFEmailApi.sendTrialBookingEmail({
          studentName,
          email,
          date: result.booking.date,
          time: result.booking.time,
          lessonType,
          message,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London"
        });

        if (emailResult.accountSetupSent) {
          emailMessage = " We also emailed you a secure link to set your student portal password.";
        } else if (emailResult.existingAccount) {
          emailMessage = " A confirmation email has been sent, and you can log in with your existing student portal password.";
        } else {
          emailMessage = " A confirmation email has been sent.";
        }
      } catch {
        emailMessage = " The booking saved, but the confirmation email could not be sent yet.";
      }
    }

    setBookingFeedback(
      result.registration.created
        ? `Booked for ${formatDate(result.booking.date)} at ${result.booking.time}. This lesson is reserved and awaiting payment.${accountMessage}${serverMessage}${emailMessage}`
        : `Booked for ${formatDate(result.booking.date)} at ${result.booking.time}. This lesson is reserved and awaiting payment. If you already registered, you can manage your lessons from the student portal.${accountMessage}${serverMessage}${emailMessage}`,
      "success"
    );
  });
}

function init() {
  if (window.HWFData) {
    window.HWFData.ensurePortalState();
  }

  renderAllReviews();
  bindPlanSelectionButtons();

  if (window.HWFData) {
    bindBookingForm();
  }
}

init();
