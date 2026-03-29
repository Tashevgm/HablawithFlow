const STUDENT_REVIEW_STORAGE_KEY = "hwf_reviews";
const STUDENT_BOOKING_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let currentStudent = null;
let currentSupabaseUserId = "";
let selectedStudentRating = 0;
let studentBookingMonth = null;
let selectedStudentBookingDate = "";
let selectedStudentBookingTime = "";

function getPasswordResetRedirect() {
  return `${window.location.origin}/set-password.html`;
}

function getBookingStatusMeta(status) {
  if (window.HWFData && typeof window.HWFData.getBookingStatusMeta === "function") {
    return window.HWFData.getBookingStatusMeta(status);
  }

  return {
    value: String(status || "pending_payment"),
    label: "Awaiting payment",
    tone: "pending",
    active: true,
    canStudentCancel: false
  };
}

function formatStudentDate(date, time) {
  return new Date(`${date}T${time}`).toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatStudentLongDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function dateParts(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return { year, month, day };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toIsoDateFromDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthStart(dateString) {
  const { year, month } = dateParts(dateString);
  return new Date(year, month - 1, 1);
}

function shiftMonth(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function loadStoredReviews() {
  const stored = localStorage.getItem(STUDENT_REVIEW_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveStoredReviews(reviews) {
  localStorage.setItem(STUDENT_REVIEW_STORAGE_KEY, JSON.stringify(reviews));
}

async function loadSupabaseProfile(user) {
  const metadata = user.user_metadata || {};
  let profile = null;

  const { data, error } = await window.supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!error && data) {
    profile = data;
  }

  const profilePayload = {
    id: user.id,
    full_name:
      (profile && (profile.full_name || profile.name)) ||
      metadata.full_name ||
      metadata.name ||
      user.email.split("@")[0],
    level: (profile && profile.level) || metadata.level || "Beginner",
    track: (profile && profile.track) || metadata.track || "1-on-1",
    timezone: (profile && profile.timezone) || metadata.timezone || "other",
    goal: (profile && profile.goal) || metadata.goal || "Conversation",
    notes: (profile && profile.notes) || metadata.notes || ""
  };

  if (profile) {
    await window.supabaseClient
      .from("profiles")
      .update({
        full_name: profilePayload.full_name,
        level: profilePayload.level,
        track: profilePayload.track,
        timezone: profilePayload.timezone,
        goal: profilePayload.goal,
        notes: profilePayload.notes
      })
      .eq("id", user.id);
  } else {
    await window.supabaseClient.from("profiles").upsert(profilePayload);
  }

  return {
    id: user.id,
    name: profilePayload.full_name,
    email: user.email,
    level: profilePayload.level,
    track: profilePayload.track,
    timezone: profilePayload.timezone,
    goal: profilePayload.goal,
    notes: profilePayload.notes
  };
}

async function getPortalRoleForUser(user) {
  const metadataRole = String(user.user_metadata?.role || "").toLowerCase();

  const { data, error } = await window.supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return metadataRole;
  }

  return String(data?.role || metadataRole || "student").toLowerCase();
}

async function openStudentDashboardFromSession() {
  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  if (!user) {
    return;
  }

  const role = await getPortalRoleForUser(user);
  if (role === "teacher" || role === "admin") {
    currentStudent = null;
    currentSupabaseUserId = "";
    await window.supabaseClient.auth.signOut();
    document.getElementById("student-dashboard").hidden = true;
    document.getElementById("student-login-card").hidden = false;
    document.getElementById("student-password").value = "";
    document.getElementById("student-error").hidden = true;
    setStudentLoginFeedback("Teacher accounts must sign in from the Teacher Login page.", "error");
    return;
  }

  const profile = await loadSupabaseProfile(user);
  currentSupabaseUserId = user.id;
  const student = window.HWFData.ensureStudentFromProfile(profile);
  const hydratedStudent = await hydrateStudentFromServer(student);

  document.getElementById("student-error").hidden = true;
  document.getElementById("student-login-card").hidden = true;
  document.getElementById("student-dashboard").hidden = false;
  renderStudentDashboard(hydratedStudent);
  handleStripeCheckoutReturn();
}

async function listServerBookingsForCurrentStudent() {
  if (!currentSupabaseUserId) {
    return [];
  }

  const { data, error } = await window.supabaseClient
    .from("bookings")
    .select("*")
    .eq("student_id", currentSupabaseUserId)
    .order("lesson_date", { ascending: true })
    .order("lesson_time", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data;
}

async function hydrateStudentFromServer(student) {
  const serverBookings = await listServerBookingsForCurrentStudent();
  const firstFreeLessonBookingId = getFirstFreeLessonBookingId(serverBookings, student);

  if (!serverBookings.length) {
    return {
      ...student,
      upcomingLessons: []
    };
  }

  return {
    ...student,
    upcomingLessons: serverBookings
      .map((booking) => {
        const statusMeta = getBookingStatusMeta(booking.status);
        const isFreeFirstLesson = String(booking.id) === firstFreeLessonBookingId;
        return {
          id: booking.id,
          date: booking.lesson_date,
          time: booking.lesson_time.slice(0, 5),
          topic: booking.lesson_type,
          status: isFreeFirstLesson ? "free_first_lesson" : statusMeta.value,
          statusLabel: isFreeFirstLesson ? "Free first lesson" : statusMeta.label,
          statusTone: isFreeFirstLesson ? "free" : statusMeta.tone,
          canCancel: isFreeFirstLesson ? true : statusMeta.canStudentCancel,
          canPayNow: !isFreeFirstLesson && statusMeta.value === "pending_payment",
          isFreeFirstLesson,
          statusNote: isFreeFirstLesson
            ? "Congratulations. Your free first lesson is booked. No payment is required for this session."
            : statusMeta.value === "payment_submitted"
              ? "Checkout submitted. Your teacher will confirm the payment shortly."
            : statusMeta.canStudentCancel
              ? "If you cancel this paid lesson, the payment stays applied and is not refunded."
              : "Use Pay Now to complete Stripe checkout. Cancellation unlocks after the payment is confirmed."
        };
      })
      .filter((booking) => getBookingStatusMeta(booking.status).active)
  };
}

async function saveServerBooking({ studentName, email, date, time, lessonType, message }) {
  if (!currentSupabaseUserId) {
    return { ok: false, error: "You must be signed in to save a booking." };
  }

  const { data, error } = await window.supabaseClient
    .from("bookings")
    .insert({
      student_id: currentSupabaseUserId,
      student_email: email,
      student_name: studentName,
      lesson_type: lessonType,
      lesson_date: date,
      lesson_time: time,
      timezone: currentStudent && currentStudent.timezone ? currentStudent.timezone : "Europe/London",
      message,
      status: "pending_payment"
    })
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, booking: data };
}

async function cancelServerBooking(bookingId) {
  if (!currentSupabaseUserId) {
    return { ok: false, error: "You must be signed in to cancel a lesson." };
  }

  const { data: existingBooking, error: existingError } = await window.supabaseClient
    .from("bookings")
    .select("id, status")
    .eq("id", bookingId)
    .eq("student_id", currentSupabaseUserId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, error: existingError.message };
  }

  if (!existingBooking) {
    return { ok: false, error: "This booking could not be found." };
  }

  const statusMeta = getBookingStatusMeta(existingBooking.status);
  const studentBookings = await listServerBookingsForCurrentStudent();
  const isFreeFirstLesson = String(existingBooking.id) === getFirstFreeLessonBookingId(studentBookings, currentStudent);

  if (!statusMeta.canStudentCancel && !isFreeFirstLesson) {
    return { ok: false, error: "Only paid lessons can be cancelled." };
  }

  const { data, error } = await window.supabaseClient
    .from("bookings")
    .update({ status: "cancelled_paid" })
    .eq("id", bookingId)
    .eq("student_id", currentSupabaseUserId)
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, booking: data };
}

function setStudentStarPreview(rating) {
  document.querySelectorAll(".student-sp-star").forEach((star) => {
    star.classList.toggle("lit", Number(star.dataset.val) <= rating);
  });
}

function findStudentReview(student) {
  return loadStoredReviews().find((review) => {
    return review.email && review.email.toLowerCase() === student.email.toLowerCase();
  }) || null;
}

function setStudentReviewFeedback(message, type) {
  const feedback = document.getElementById("student-review-feedback");
  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function getStudentAvailabilityDates() {
  return [...new Set(window.HWFData.listAvailability().map((slot) => slot.date))].sort();
}

function getStudentTimesForDate(date) {
  return window.HWFData.listAvailability()
    .filter((slot) => slot.date === date)
    .map((slot) => slot.time)
    .sort();
}

function ensureStudentBookingDefaults() {
  const dates = getStudentAvailabilityDates();

  if (!dates.length) {
    selectedStudentBookingDate = "";
    selectedStudentBookingTime = "";
    studentBookingMonth = new Date();
    return;
  }

  if (!selectedStudentBookingDate || !dates.includes(selectedStudentBookingDate)) {
    selectedStudentBookingDate = dates[0];
  }

  const times = getStudentTimesForDate(selectedStudentBookingDate);
  if (!selectedStudentBookingTime || !times.includes(selectedStudentBookingTime)) {
    selectedStudentBookingTime = times[0] || "";
  }

  if (!studentBookingMonth) {
    studentBookingMonth = monthStart(selectedStudentBookingDate);
  }
}

function updateStudentBookingButton() {
  const button = document.getElementById("student-booking-confirm");
  const hasSelection = Boolean(currentStudent && selectedStudentBookingDate && selectedStudentBookingTime);

  button.disabled = !hasSelection;
  button.textContent = hasSelection
    ? `Book Next Lesson: ${selectedStudentBookingTime}`
    : "Book Next Lesson";
}

function setStudentBookingFeedback(message, type) {
  const feedback = document.getElementById("student-booking-feedback");
  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function setStudentLoginFeedback(message, type) {
  const feedback = document.getElementById("student-login-feedback");
  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function getFunctionsBaseUrl() {
  const supabaseBase =
    typeof window.supabaseClient?.supabaseUrl === "string" && window.supabaseClient.supabaseUrl
      ? window.supabaseClient.supabaseUrl
      : "https://ubetwjpyookwdgtfppim.supabase.co";

  return `${supabaseBase.replace(/\/+$/, "")}/functions/v1`;
}

async function createStripeCheckoutSession(bookingId) {
  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Your session expired. Please sign in again.");
  }

  const response = await fetch(`${getFunctionsBaseUrl()}/create-checkout-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      booking_id: bookingId
    })
  });

  const data = await response.json().catch(() => ({
    ok: false,
    error: `Stripe checkout failed with status ${response.status}.`
  }));

  if (!response.ok || !data?.ok || !data?.url) {
    throw new Error(data?.error || `Stripe checkout failed with status ${response.status}.`);
  }

  return data.url;
}

function handleStripeCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkoutState = params.get("checkout");

  if (!checkoutState) {
    return;
  }

  if (checkoutState === "success") {
    setStudentBookingFeedback(
      "Stripe checkout completed. If the lesson status still looks unchanged, wait a few seconds for the webhook and refresh.",
      "success"
    );
  } else if (checkoutState === "cancelled") {
    setStudentBookingFeedback("Stripe checkout was cancelled. Your lesson is still waiting for payment.", "error");
  }

  params.delete("checkout");
  params.delete("session_id");
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function getFirstFreeLessonBookingId(bookings, student) {
  if (Number(student?.completedLessons || 0) > 0) {
    return "";
  }

  const activeBookings = bookings.filter((booking) => getBookingStatusMeta(booking.status).active);
  return activeBookings.length ? String(activeBookings[0].id) : "";
}

function buildStudentCoachNote(student, nextLesson) {
  const note = String(student.coachNote || "").trim();
  const hasCompletedLesson = Number(student.completedLessons || 0) > 0;
  const hasBookedLesson = Boolean(nextLesson);
  const lowerNote = note.toLowerCase();
  const isDefaultWelcomeNote =
    !note ||
    lowerNote.includes("your learning plan will start once you book your first lesson") ||
    lowerNote.includes("your first lesson is booked and your learning plan will start from there");

  if (!hasCompletedLesson && !hasBookedLesson) {
    return "Your free first lesson is still available. Book your free lesson below so we can set your level and build your learning plan.";
  }

  if (!hasCompletedLesson && hasBookedLesson && isDefaultWelcomeNote) {
    return "Congratulations. Your free first lesson is booked. Once you attend it, your teacher will set your level, focus areas, and personal learning plan.";
  }

  if (isDefaultWelcomeNote && hasCompletedLesson) {
    return "Your teacher will keep updating your learning plan here as you complete more lessons.";
  }

  return note;
}

function renderStudentBookingCalendar() {
  const grid = document.getElementById("student-booking-month-grid");
  const monthLabel = document.getElementById("student-booking-month-label");
  const availableDates = new Set(getStudentAvailabilityDates());
  const year = studentBookingMonth.getFullYear();
  const month = studentBookingMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (firstDay.getDay() + 6) % 7;

  monthLabel.textContent = studentBookingMonth.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric"
  });

  grid.innerHTML = STUDENT_BOOKING_WEEKDAYS.map((label) => `<div class="booking-day-name">${label}</div>`).join("");

  for (let index = 0; index < firstWeekday; index += 1) {
    grid.innerHTML += '<div class="booking-day-cell empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const isoDate = toIsoDateFromDate(date);
    const times = getStudentTimesForDate(isoDate);
    const isAvailable = availableDates.has(isoDate);
    const isSelected = selectedStudentBookingDate === isoDate;

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
      selectedStudentBookingDate = button.dataset.date;
      const times = getStudentTimesForDate(selectedStudentBookingDate);
      if (!times.includes(selectedStudentBookingTime)) {
        selectedStudentBookingTime = times[0] || "";
      }
      renderStudentBookingCalendar();
      renderStudentBookingTimes();
    });
  });
}

function renderStudentBookingTimes() {
  const container = document.getElementById("student-booking-time-list");
  const caption = document.getElementById("student-booking-times-caption");

  if (!selectedStudentBookingDate) {
    caption.textContent = "Select a highlighted day to view times.";
    container.innerHTML = '<p class="booking-empty-state">No lesson slots are open right now.</p>';
    updateStudentBookingButton();
    return;
  }

  const times = getStudentTimesForDate(selectedStudentBookingDate);
  caption.textContent = `${formatStudentLongDate(selectedStudentBookingDate)} has ${times.length} available time${times.length === 1 ? "" : "s"}.`;

  if (!times.length) {
    container.innerHTML = '<p class="booking-empty-state">No open times remain on that day.</p>';
    updateStudentBookingButton();
    return;
  }

  container.innerHTML = times
    .map((time) => {
      return `
        <button class="booking-time-chip ${selectedStudentBookingTime === time ? "active" : ""}" type="button" data-time="${time}">
          <strong>${time}</strong>
          <span>${selectedStudentBookingTime === time ? "Selected" : "Choose this time"}</span>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll(".booking-time-chip").forEach((button) => {
    button.addEventListener("click", () => {
      selectedStudentBookingTime = button.dataset.time;
      renderStudentBookingTimes();
    });
  });

  updateStudentBookingButton();
}

function renderStudentBookingSection() {
  ensureStudentBookingDefaults();
  renderStudentBookingCalendar();
  renderStudentBookingTimes();
}

function populateStudentReviewForm(student) {
  const existingReview = findStudentReview(student);

  document.getElementById("student-review-name").value = student.name;
  document.getElementById("student-review-track").value = student.track;
  document.getElementById("student-review-role").value = existingReview ? existingReview.role || "" : "";
  document.getElementById("student-review-text").value = existingReview ? existingReview.text : "";
  document.getElementById("student-review-submit").textContent = existingReview ? "Update Review" : "Submit Review";

  selectedStudentRating = existingReview ? existingReview.rating : 0;
  setStudentStarPreview(selectedStudentRating);

  const feedback = document.getElementById("student-review-feedback");
  feedback.hidden = true;
}

function renderStudentDashboard(student) {
  currentStudent = student;

  const progressPercent = Math.round((student.completedLessons / student.totalLessons) * 100);
  const nextLesson = student.upcomingLessons.length ? student.upcomingLessons[0] : null;
  const primaryFocus = student.focusAreas.length ? student.focusAreas[0] : student.track;
  const summaryCaption = nextLesson
    ? nextLesson.isFreeFirstLesson
      ? `Congratulations. Your free first lesson is booked for ${formatStudentDate(nextLesson.date, nextLesson.time)} at ${nextLesson.time}.`
      : `Your next lesson is ${formatStudentDate(nextLesson.date, nextLesson.time)} at ${nextLesson.time}.`
    : "No lesson is booked yet. Choose your free first lesson below and get started.";
  const paymentSummary = nextLesson
    ? nextLesson.isFreeFirstLesson
      ? "Free first lesson booked"
      : nextLesson.statusLabel === "Paid"
        ? "Paid and ready to attend"
        : nextLesson.statusLabel === "Payment sent"
          ? "Payment submitted for confirmation"
          : "Ready to pay"
    : "Your free first lesson is still available";
  const nextLessonSummary = nextLesson
    ? `${formatStudentDate(nextLesson.date, nextLesson.time)} at ${nextLesson.time}`
    : "No lesson booked yet";

  document.getElementById("student-dashboard-title").textContent = `Welcome back, ${student.name}`;
  document.getElementById("student-summary-caption").textContent = summaryCaption;
  document.getElementById("student-next-lesson-summary").textContent = nextLessonSummary;
  document.getElementById("student-payment-summary").textContent = paymentSummary;
  document.getElementById("student-focus-summary").textContent = primaryFocus;
  document.getElementById("student-name-heading").textContent = "Progress Snapshot";
  document.getElementById("student-track-label").textContent = student.track;
  document.getElementById("student-level-label").textContent = `Level ${student.level}`;
  document.getElementById("student-progress-count").textContent = student.completedLessons;
  document.getElementById("student-progress-caption").textContent = `out of ${student.totalLessons} planned lessons`;
  document.getElementById("student-streak-label").textContent = student.streak;
  document.getElementById("student-progress-percent").textContent = `${progressPercent}%`;
  document.getElementById("student-progress-bar").style.width = `${progressPercent}%`;
  document.getElementById("student-milestone").textContent = student.nextMilestone;
  document.getElementById("student-note").textContent = buildStudentCoachNote(student, nextLesson);
  document.getElementById("student-book-link").href = "#student-booking-section";

  document.getElementById("student-focus").innerHTML = student.focusAreas
    .map((area) => `<span class="focus-chip">${area}</span>`)
    .join("");

  const upcomingContainer = document.getElementById("student-upcoming");
  if (!student.upcomingLessons.length) {
    upcomingContainer.innerHTML = '<p class="empty-copy">No upcoming lessons are booked yet.</p>';
  } else {
    upcomingContainer.innerHTML = student.upcomingLessons
      .map((lesson) => {
        return `
          <article class="list-card">
            <div class="list-card-top">
              <strong>${lesson.topic}</strong>
              <span class="status-pill ${lesson.statusTone}">${lesson.statusLabel}</span>
            </div>
            <p>${formatStudentDate(lesson.date, lesson.time)} at ${lesson.time}</p>
            <p class="list-card-note ${lesson.canCancel || lesson.canPayNow ? "" : "warning"}">${lesson.statusNote}</p>
            ${lesson.canCancel || lesson.canPayNow
              ? `<div class="list-card-actions">
                  ${
                    lesson.canPayNow
                      ? `<button class="list-action pay student-pay-booking" type="button" data-booking-id="${lesson.id}">
                          Pay Now
                        </button>`
                      : ""
                  }
                  ${
                    lesson.canCancel
                      ? `<button class="list-action danger student-cancel-booking" type="button" data-booking-id="${lesson.id}">
                          Cancel Lesson
                        </button>`
                      : ""
                  }
                </div>`
              : ""}
          </article>
        `;
      })
      .join("");

    upcomingContainer.onclick = async (event) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (!eventTarget) {
        return;
      }

      const payButton = eventTarget.closest(".student-pay-booking");
      if (payButton) {
        const bookingId = String(payButton.dataset.bookingId || "").trim();
        if (!bookingId) {
          setStudentBookingFeedback("This lesson is missing its payment reference. Refresh the page and try again.", "error");
          return;
        }

        payButton.disabled = true;
        payButton.textContent = "Opening...";
        setStudentBookingFeedback("Opening Stripe checkout...", "success");

        try {
          const checkoutUrl = await createStripeCheckoutSession(bookingId);
          window.location.assign(checkoutUrl);
        } catch (error) {
          payButton.disabled = false;
          payButton.textContent = "Pay Now";
          setStudentBookingFeedback(error instanceof Error ? error.message : "Could not open Stripe checkout.", "error");
        }
        return;
      }

      const cancelButton = eventTarget.closest(".student-cancel-booking");
      if (!cancelButton) {
        return;
      }

      cancelButton.disabled = true;
      const bookingId = cancelButton.dataset.bookingId;
      const lesson = currentStudent && Array.isArray(currentStudent.upcomingLessons)
        ? currentStudent.upcomingLessons.find((entry) => String(entry.id) === String(bookingId))
        : null;

      const result = await cancelServerBooking(bookingId);
      if (!result.ok) {
        cancelButton.disabled = false;
        setStudentBookingFeedback(result.error, "error");
        return;
      }

      setStudentBookingFeedback(
        lesson && lesson.isFreeFirstLesson
          ? "Free first lesson cancelled."
          : "Lesson cancelled. The payment remains applied and is not refunded.",
        "success"
      );

      const refreshedStudent = await hydrateStudentFromServer(currentStudent);
      renderStudentDashboard(refreshedStudent);
    };
  }

  document.getElementById("student-history").innerHTML = student.lessonHistory
    .map((lesson) => {
      return `
        <article class="list-card">
          <div class="list-card-top">
            <strong>${lesson.topic}</strong>
            <span class="status-pill muted">${lesson.status}</span>
          </div>
          <p>${new Date(`${lesson.date}T00:00:00`).toLocaleDateString("en-GB", {
            month: "short",
            day: "numeric",
            year: "numeric"
          })}</p>
        </article>
      `;
    })
    .join("");

  renderStudentBookingSection();
  populateStudentReviewForm(student);
}

function bindStudentBookingSection() {
  document.getElementById("student-booking-prev").addEventListener("click", () => {
    studentBookingMonth = shiftMonth(studentBookingMonth, -1);
    renderStudentBookingCalendar();
  });

  document.getElementById("student-booking-next").addEventListener("click", () => {
    studentBookingMonth = shiftMonth(studentBookingMonth, 1);
    renderStudentBookingCalendar();
  });

  document.getElementById("student-booking-confirm").addEventListener("click", async () => {
    if (!currentStudent || !selectedStudentBookingDate || !selectedStudentBookingTime) {
      setStudentBookingFeedback("Please choose an available lesson slot first.", "error");
      return;
    }

    const bookingPayload = {
      studentName: currentStudent.name,
      email: currentStudent.email,
      date: selectedStudentBookingDate,
      time: selectedStudentBookingTime,
      lessonType: currentStudent.track,
      message: document.getElementById("student-booking-message").value.trim()
    };

    const serverResult = await saveServerBooking(bookingPayload);
    if (!serverResult.ok) {
      setStudentBookingFeedback(serverResult.error, "error");
      return;
    }

    const matchingSlot = window.HWFData
      .listAvailability()
      .find((slot) => slot.date === bookingPayload.date && slot.time === bookingPayload.time);

    if (matchingSlot) {
      window.HWFData.removeAvailabilitySlot(matchingSlot.id);
    }

    try {
      await window.HWFEmailApi.sendBookingEmail({
        studentName: bookingPayload.studentName,
        email: bookingPayload.email,
        date: bookingPayload.date,
        time: bookingPayload.time,
        lessonType: bookingPayload.lessonType,
        message: bookingPayload.message
      });
    } catch {
      // Keep the booking if the email fails.
    }

    document.getElementById("student-booking-message").value = "";
    const refreshedStudent = await hydrateStudentFromServer(currentStudent);
    renderStudentDashboard(refreshedStudent);
    const bookedLesson = refreshedStudent.upcomingLessons.find((lesson) => {
      return String(lesson.id) === String(serverResult.booking.id);
    });

    setStudentBookingFeedback(
      bookedLesson && bookedLesson.isFreeFirstLesson
        ? `Congratulations. Your free first lesson is booked for ${formatStudentDate(serverResult.booking.lesson_date, serverResult.booking.lesson_time)} at ${serverResult.booking.lesson_time.slice(0, 5)}.`
        : `Booked for ${formatStudentDate(serverResult.booking.lesson_date, serverResult.booking.lesson_time)} at ${serverResult.booking.lesson_time.slice(0, 5)}. Use Pay Now in your upcoming lessons to open Stripe checkout.`,
      "success"
    );
  });
}

function bindStudentReviewForm() {
  document.querySelectorAll(".student-sp-star").forEach((star) => {
    star.addEventListener("mouseover", () => setStudentStarPreview(Number(star.dataset.val)));
    star.addEventListener("focus", () => setStudentStarPreview(Number(star.dataset.val)));
    star.addEventListener("mouseout", () => setStudentStarPreview(selectedStudentRating));
    star.addEventListener("blur", () => setStudentStarPreview(selectedStudentRating));
    star.addEventListener("click", () => {
      selectedStudentRating = Number(star.dataset.val);
      setStudentStarPreview(selectedStudentRating);
      document.getElementById("student-review-feedback").hidden = true;
    });
  });

  document.getElementById("student-review-submit").addEventListener("click", () => {
    if (!currentStudent) {
      return;
    }

    const role = document.getElementById("student-review-role").value.trim();
    const text = document.getElementById("student-review-text").value.trim();

    if (!selectedStudentRating) {
      setStudentReviewFeedback("Please choose a star rating.", "error");
      return;
    }

    if (!text) {
      setStudentReviewFeedback("Please write a short review.", "error");
      return;
    }

    const reviews = loadStoredReviews();
    const existingIndex = reviews.findIndex((review) => {
      return review.email && review.email.toLowerCase() === currentStudent.email.toLowerCase();
    });

    const reviewPayload = {
      name: currentStudent.name,
      email: currentStudent.email,
      role: role || "Student",
      lesson: currentStudent.track,
      rating: selectedStudentRating,
      text
    };

    if (existingIndex >= 0) {
      reviews[existingIndex] = { ...reviews[existingIndex], ...reviewPayload };
    } else {
      reviews.push(reviewPayload);
    }

    saveStoredReviews(reviews);
    populateStudentReviewForm(currentStudent);
    setStudentReviewFeedback("Your review is live on the public site now.", "success");
  });
}

function bindStudentLogin() {
  document.getElementById("student-login").addEventListener("click", async () => {
    const email = document.getElementById("student-email").value;
    const password = document.getElementById("student-password").value;
    const error = document.getElementById("student-error");
    const loginFeedback = document.getElementById("student-login-feedback");

    error.hidden = true;
    loginFeedback.hidden = true;

    const { error: signInError } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      error.textContent = signInError.message;
      error.hidden = false;
      return;
    }

    await openStudentDashboardFromSession();
  });

  const forgotButton = document.getElementById("student-forgot-password");

  forgotButton.addEventListener("click", async () => {
    const email = document.getElementById("student-email").value.trim();
    const error = document.getElementById("student-error");
    error.hidden = true;

    if (!email) {
      setStudentLoginFeedback("Enter your email first, then click Forgot password.", "error");
      return;
    }

    if (!window.supabaseClient) {
      setStudentLoginFeedback("Password reset is not configured yet.", "error");
      return;
    }

    forgotButton.disabled = true;
    setStudentLoginFeedback("Sending reset email...", "success");

    try {
      const { error: resetError } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: getPasswordResetRedirect()
      });

      if (resetError) {
        setStudentLoginFeedback(resetError.message, "error");
        return;
      }

      setStudentLoginFeedback("Password reset email sent. Check your inbox and open the link to set a new password.", "success");
    } catch {
      setStudentLoginFeedback("Could not send reset email right now. Please try again.", "error");
    } finally {
      forgotButton.disabled = false;
    }
  });

  document.getElementById("student-logout").addEventListener("click", async () => {
    currentStudent = null;
    currentSupabaseUserId = "";
    selectedStudentRating = 0;
    selectedStudentBookingDate = "";
    selectedStudentBookingTime = "";
    await window.supabaseClient.auth.signOut();
    document.getElementById("student-login-card").hidden = false;
    document.getElementById("student-dashboard").hidden = true;
    document.getElementById("student-email").value = "";
    document.getElementById("student-password").value = "";
    document.getElementById("student-review-feedback").hidden = true;
    document.getElementById("student-booking-feedback").hidden = true;
    document.getElementById("student-login-feedback").hidden = true;
    document.getElementById("student-booking-message").value = "";
    setStudentStarPreview(0);
  });
}

function initStudentPortal() {
  window.HWFData.ensurePortalState();
  bindStudentLogin();
  bindStudentBookingSection();
  bindStudentReviewForm();
  openStudentDashboardFromSession();
}

initStudentPortal();
