const STUDENT_REVIEW_STORAGE_KEY = "hwf_reviews";
const STUDENT_BOOKING_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let currentStudent = null;
let currentSupabaseUserId = "";
let currentSupabaseUser = null;
let selectedStudentRating = 0;
let studentBookingMonth = null;
let selectedStudentBookingDate = "";
let selectedStudentBookingTime = "";
let studentProfileEditorBound = false;
let studentSectionNavBound = false;
let studentSetupModalBound = false;
let activeStudentPortalSection = "book";
let studentMeetingJoinLink = "";
let studentMeetingEnableMinutesBefore = 15;
let studentMeetingTickerId = 0;
let studentMeetingConfigured = false;
let studentMeetingDynamicPerBooking = false;
const TEACHER_PORTAL_ROLES = new Set(["teacher", "admin"]);
const DEFAULT_PROFILE_AVATAR =
  "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=400&q=80";

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeIsoDateValue(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const prefixedDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (prefixedDate) {
    return prefixedDate[1];
  }

  return raw;
}

function normalizeIsoTimeValue(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const timeMatch = raw.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    return `${pad(Number(timeMatch[1]))}:${timeMatch[2]}`;
  }

  return raw.slice(0, 5);
}

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

function normalizeBookingInsertError(message) {
  const raw = String(message || "").trim();
  const normalized = raw.toLowerCase();

  if (
    normalized.includes("bookings_student_id_lesson_date_lesson_time_key") ||
    normalized.includes("duplicate key value")
  ) {
    return "You already have this lesson booked at that time. Please choose a different slot.";
  }

  return raw || "Could not save this booking right now.";
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

function parseLessonStart(date, time) {
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getMeetingJoinState(date, time) {
  const start = parseLessonStart(date, time);
  if (!start) {
    return {
      enabled: false,
      label: "Join Meeting"
    };
  }

  const now = new Date();
  const enableAt = new Date(start.getTime() - studentMeetingEnableMinutesBefore * 60 * 1000);
  const closeAt = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const enabled = now >= enableAt && now <= closeAt;

  if (enabled) {
    return {
      enabled: true,
      label: "Join Meeting"
    };
  }

  return {
    enabled: false,
    label: `Join in ${studentMeetingEnableMinutesBefore} min`
  };
}

function updateStudentMeetingButtons() {
  const buttons = document.querySelectorAll(".student-join-meeting");
  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    const date = String(button.getAttribute("data-lesson-date") || "");
    const time = String(button.getAttribute("data-lesson-time") || "");
    const state = getMeetingJoinState(date, time);
    button.disabled = !state.enabled;
    button.textContent = state.label;
  });
}

function startStudentMeetingTicker() {
  if (studentMeetingTickerId) {
    window.clearInterval(studentMeetingTickerId);
  }

  studentMeetingTickerId = window.setInterval(() => {
    updateStudentMeetingButtons();
  }, 30000);
}

async function loadStudentMeetingJoinConfig() {
  studentMeetingConfigured = false;
  studentMeetingDynamicPerBooking = false;
  studentMeetingJoinLink = "";

  if (!window.supabaseClient) {
    return;
  }

  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();
  const accessToken = session?.access_token || "";
  if (!accessToken) {
    return;
  }

  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";
  const apiBase = configuredApiBase || window.location.origin;

  try {
    const response = await fetch(`${apiBase}/api/meeting/join-link`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!payload || payload.ok !== true || !payload.configured) {
      return;
    }

    studentMeetingConfigured = true;
    studentMeetingDynamicPerBooking = Boolean(payload.dynamicPerBooking);
    studentMeetingJoinLink = hasText(payload.joinLink) ? String(payload.joinLink).trim() : "";
    studentMeetingEnableMinutesBefore = Math.max(1, Number(payload.enableMinutesBefore || 15));
  } catch {
    // Keep meeting link disabled when API fails.
  }
}

async function fetchStudentMeetingJoinLinkForBooking(bookingId) {
  if (!window.supabaseClient) {
    return "";
  }

  const normalizedBookingId = String(bookingId || "").trim();
  if (!normalizedBookingId) {
    return "";
  }

  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();
  const accessToken = session?.access_token || "";
  if (!accessToken) {
    return "";
  }

  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";
  const apiBase = configuredApiBase || window.location.origin;

  try {
    const response = await fetch(
      `${apiBase}/api/meeting/join-link?bookingId=${encodeURIComponent(normalizedBookingId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      return "";
    }

    const payload = await response.json();
    if (!payload || payload.ok !== true || !payload.configured || !hasText(payload.joinLink)) {
      return "";
    }

    return String(payload.joinLink).trim();
  } catch {
    return "";
  }
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
  const metadataRole = String(user.user_metadata?.role || user.app_metadata?.role || "").toLowerCase();
  if (TEACHER_PORTAL_ROLES.has(metadataRole)) {
    return metadataRole;
  }

  const [profileResult, teacherProfileResult] = await Promise.all([
    window.supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle(),
    window.supabaseClient
      .from("teacher_profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle()
  ]);

  const profileRole = profileResult.error ? "" : String(profileResult.data?.role || "").toLowerCase();
  if (TEACHER_PORTAL_ROLES.has(profileRole)) {
    return profileRole;
  }

  if (!teacherProfileResult.error && teacherProfileResult.data?.id) {
    return "teacher";
  }

  return profileRole || metadataRole || "student";
}

async function openStudentDashboardFromSession() {
  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  if (!user) {
    return;
  }

  const role = await getPortalRoleForUser(user);
  if (TEACHER_PORTAL_ROLES.has(role)) {
    currentStudent = null;
    currentSupabaseUserId = "";
    currentSupabaseUser = null;
    studentMeetingConfigured = false;
    studentMeetingDynamicPerBooking = false;
    studentMeetingJoinLink = "";
    await window.supabaseClient.auth.signOut();
    closeStudentSetupModal();
    document.getElementById("student-dashboard").hidden = true;
    document.getElementById("student-login-card").hidden = false;
    document.getElementById("student-password").value = "";
    document.getElementById("student-error").hidden = true;
    setStudentLoginFeedback("Teacher/admin accounts must sign in from the Teacher Login page.", "error");
    return;
  }

  const profile = await loadSupabaseProfile(user);
  currentSupabaseUserId = user.id;
  currentSupabaseUser = user;
  await loadStudentMeetingJoinConfig();
  await loadActiveServerBookingsForAvailability();
  const student = window.HWFData.ensureStudentFromProfile(profile);
  const hydratedStudent = await hydrateStudentFromServer(student);

  document.getElementById("student-error").hidden = true;
  document.getElementById("student-login-card").hidden = true;
  document.getElementById("student-dashboard").hidden = false;
  activeStudentPortalSection = "book";
  renderStudentDashboard(hydratedStudent);
  maybeOpenStudentSetupModal(hydratedStudent);
  await handleStripeCheckoutReturn();
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

async function loadActiveServerBookingsForAvailability() {
  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();
  const accessToken = session?.access_token || "";

  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";
  const apiBase = configuredApiBase || window.location.origin;

  if (hasText(accessToken)) {
    try {
      const response = await fetch(`${apiBase}/api/availability/blocked-slots`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (response.ok) {
        const payload = await response.json();
        if (payload && payload.ok === true && Array.isArray(payload.blockedSlots)) {
          window.HWFServerBookings = payload.blockedSlots.map((slot) => ({
            lesson_date: slot.date,
            lesson_time: slot.time,
            status: slot.status || "pending_payment"
          }));
          return true;
        }
      }
    } catch {
      // fallback to direct query below
    }
  }

  const activeStatuses = ["pending_payment", "payment_submitted", "confirmed_paid"];
  const { data, error } = await window.supabaseClient
    .from("bookings")
    .select("id, lesson_date, lesson_time, status, student_id")
    .in("status", activeStatuses)
    .order("lesson_date", { ascending: true })
    .order("lesson_time", { ascending: true });

  if (error) {
    return false;
  }

  window.HWFServerBookings = Array.isArray(data) ? data : [];
  return true;
}

function isAvailabilityBlockedByBooking(date, time) {
  const bookings = Array.isArray(window.HWFServerBookings) ? window.HWFServerBookings : [];
  return bookings.some((booking) => {
    const bookingDate = normalizeIsoDateValue(booking.lesson_date || booking.date || "");
    const bookingTime = normalizeIsoTimeValue(booking.lesson_time || booking.time || "");
    const statusMeta = getBookingStatusMeta(booking.status);
    return bookingDate === date && bookingTime === time && statusMeta.active;
  });
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
          date: normalizeIsoDateValue(booking.lesson_date),
          time: normalizeIsoTimeValue(booking.lesson_time),
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

  const existingStudentBookings = await listServerBookingsForCurrentStudent();
  const hasActiveExistingBooking = existingStudentBookings.some((booking) => {
    return getBookingStatusMeta(booking.status).active;
  });
  const isFreeFirstLessonBooking = Number(currentStudent?.completedLessons || 0) <= 0 && !hasActiveExistingBooking;

  const activeStatuses = ["pending_payment", "payment_submitted", "confirmed_paid"];
  const { data: existingAtTime, error: existingAtTimeError } = await window.supabaseClient
    .from("bookings")
    .select("id, student_id, status")
    .eq("lesson_date", date)
    .eq("lesson_time", time)
    .in("status", activeStatuses)
    .limit(1);

  if (existingAtTimeError) {
    return { ok: false, error: existingAtTimeError.message };
  }

  if (Array.isArray(existingAtTime) && existingAtTime.length > 0) {
    const alreadyMine = existingAtTime.some((entry) => String(entry.student_id || "") === String(currentSupabaseUserId));
    return {
      ok: false,
      error: alreadyMine
        ? "You already have this lesson booked at that time."
        : "This lesson time has already been reserved. Please choose another time."
    };
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
      status: isFreeFirstLessonBooking ? "confirmed_paid" : "pending_payment"
    })
    .select()
    .single();

  if (error) {
    return { ok: false, error: normalizeBookingInsertError(error.message) };
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
  return [...new Set(
    window.HWFData
      .listAvailability()
      .filter((slot) => !isAvailabilityBlockedByBooking(slot.date, slot.time))
      .map((slot) => slot.date)
  )].sort();
}

function getStudentTimesForDate(date) {
  return window.HWFData.listAvailability()
    .filter((slot) => !isAvailabilityBlockedByBooking(slot.date, slot.time))
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

function parseBooleanLike(value) {
  if (value === true) {
    return true;
  }

  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function isStudentSetupComplete(user, student) {
  const metadata = user?.user_metadata || {};
  if (parseBooleanLike(metadata.profile_completed)) {
    return true;
  }

  const hasMetadataCore =
    hasText(metadata.full_name || metadata.name) &&
    hasText(metadata.track) &&
    hasText(metadata.goal) &&
    hasText(metadata.timezone);
  if (hasMetadataCore) {
    return true;
  }

  const profileLooksComplete =
    hasText(student?.name) &&
    hasText(student?.track) &&
    hasText(student?.goal) &&
    hasText(student?.timezone) &&
    String(student?.timezone || "").trim().toLowerCase() !== "other";
  return profileLooksComplete;
}

function setSelectValue(select, value) {
  if (!select) {
    return;
  }

  const nextValue = String(value || "").trim();
  if (!nextValue) {
    select.value = "";
    return;
  }

  const hasOption = [...select.options].some((option) => option.value === nextValue);
  if (!hasOption) {
    const option = document.createElement("option");
    option.value = nextValue;
    option.textContent = nextValue;
    select.appendChild(option);
  }

  select.value = nextValue;
}

function setStudentPortalSection(section) {
  const normalized = String(section || "").trim().toLowerCase();
  const allowed = new Set(["book", "progress", "community"]);
  const nextSection = allowed.has(normalized) ? normalized : "book";
  activeStudentPortalSection = nextSection;

  document.querySelectorAll("[data-student-section]").forEach((button) => {
    const isActive = String(button.getAttribute("data-student-section")) === nextSection;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll(".student-portal-section").forEach((sectionNode) => {
    const sectionId = String(sectionNode.id || "");
    const isActive = sectionId === `student-section-${nextSection}`;
    sectionNode.hidden = !isActive;
    sectionNode.classList.toggle("active", isActive);
  });
}

function bindStudentSectionNav() {
  if (studentSectionNavBound) {
    return;
  }

  const nav = document.getElementById("student-portal-nav");
  if (!nav) {
    return;
  }

  nav.querySelectorAll("[data-student-section]").forEach((button) => {
    button.addEventListener("click", () => {
      setStudentPortalSection(button.getAttribute("data-student-section"));
    });
  });

  const quickBookLink = document.getElementById("student-book-link");
  if (quickBookLink) {
    quickBookLink.addEventListener("click", () => {
      setStudentPortalSection("book");
    });
  }

  studentSectionNavBound = true;
}

function setStudentSetupFeedback(message, type) {
  const feedback = document.getElementById("student-setup-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function openStudentSetupModal(student) {
  const modal = document.getElementById("student-setup-modal");
  const nameInput = document.getElementById("student-setup-name");
  const timezoneSelect = document.getElementById("student-setup-timezone");
  const trackInput = document.getElementById("student-setup-track");
  const goalSelect = document.getElementById("student-setup-goal");
  const feedback = document.getElementById("student-setup-feedback");

  if (!modal || !nameInput || !timezoneSelect || !trackInput || !goalSelect || !feedback) {
    return;
  }

  const metadata = currentSupabaseUser?.user_metadata || {};
  const fallbackTimezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
    } catch {
      return "Europe/London";
    }
  })();

  const seededName =
    String(student?.name || metadata.full_name || metadata.name || currentSupabaseUser?.email?.split("@")[0] || "").trim();
  const seededTimezone = String(student?.timezone || metadata.timezone || fallbackTimezone).trim();
  const seededTrack = String(student?.track || metadata.track || "1-on-1").trim();
  const seededGoal = String(student?.goal || metadata.goal || "Free trial lesson").trim();

  nameInput.value = seededName;
  trackInput.value = seededTrack;
  setSelectValue(timezoneSelect, seededTimezone);
  setSelectValue(goalSelect, seededGoal);
  feedback.hidden = true;
  modal.hidden = false;
}

function closeStudentSetupModal() {
  const modal = document.getElementById("student-setup-modal");
  if (modal) {
    modal.hidden = true;
  }
}

function maybeOpenStudentSetupModal(student) {
  if (!currentSupabaseUser) {
    return;
  }

  if (isStudentSetupComplete(currentSupabaseUser, student)) {
    closeStudentSetupModal();
    return;
  }

  openStudentSetupModal(student);
}

function setStudentProfileFeedback(message, type) {
  const feedback = document.getElementById("student-profile-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function updateStudentProfileAvatarPreview() {
  const input = document.getElementById("student-profile-avatar-url");
  const preview = document.getElementById("student-profile-avatar-preview");
  if (!input || !preview) {
    return;
  }

  const avatarUrl = String(input.value || "").trim();
  preview.src = avatarUrl || DEFAULT_PROFILE_AVATAR;
}

function renderStudentProfileEditor(student) {
  const nameInput = document.getElementById("student-profile-name-input");
  const timezoneInput = document.getElementById("student-profile-timezone-input");
  const trackInput = document.getElementById("student-profile-track-input");
  const goalInput = document.getElementById("student-profile-goal-input");
  const notesInput = document.getElementById("student-profile-notes-input");
  const avatarInput = document.getElementById("student-profile-avatar-url");
  const preview = document.getElementById("student-profile-avatar-preview");

  if (!nameInput || !timezoneInput || !trackInput || !goalInput || !notesInput || !avatarInput || !preview) {
    return;
  }

  const metadata = currentSupabaseUser?.user_metadata || {};
  const avatarUrl = String(metadata.avatar_url || "").trim();

  nameInput.value = student.name || "";
  timezoneInput.value = student.timezone || "";
  trackInput.value = student.track || "";
  goalInput.value = student.goal || "";
  notesInput.value = student.notes || student.coachNote || "";
  avatarInput.value = avatarUrl;
  preview.src = avatarUrl || DEFAULT_PROFILE_AVATAR;
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

async function confirmStripeCheckoutSession(sessionId) {
  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Your session expired before payment confirmation. Please sign in again.");
  }

  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";
  const apiBase = configuredApiBase || window.location.origin;

  const response = await fetch(`${apiBase}/api/booking/stripe/confirm-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      sessionId
    })
  });

  const payload = await response.json().catch(() => ({
    ok: false,
    error: `Payment confirmation failed with status ${response.status}.`
  }));

  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || `Payment confirmation failed with status ${response.status}.`));
  }

  return payload;
}

async function handleStripeCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkoutState = params.get("checkout");
  const sessionId = params.get("session_id");

  if (!checkoutState) {
    return;
  }

  if (checkoutState === "success") {
    if (hasText(sessionId)) {
      try {
        const result = await confirmStripeCheckoutSession(sessionId);
        if (result.paid) {
          setStudentBookingFeedback("Payment confirmed. Your lesson is now marked as paid.", "success");
        } else {
          setStudentBookingFeedback("Checkout completed, but payment is still processing. Please refresh in a moment.", "error");
        }

        if (currentStudent) {
          await loadActiveServerBookingsForAvailability();
          const refreshedStudent = await hydrateStudentFromServer(currentStudent);
          renderStudentDashboard(refreshedStudent);
        }
      } catch (error) {
        setStudentBookingFeedback(
          error instanceof Error
            ? `Checkout completed, but automatic payment confirmation failed: ${error.message}`
            : "Checkout completed, but automatic payment confirmation failed.",
          "error"
        );
      }
    } else {
      setStudentBookingFeedback(
        "Stripe checkout completed, but no session id was returned. Please refresh to check payment status.",
        "error"
      );
    }
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
        const isJoinEligibleLesson = lesson.status === "free_first_lesson" || lesson.status === "confirmed_paid";
        const hasMeetingLink = studentMeetingConfigured && isJoinEligibleLesson;
        const meetingJoinState = hasMeetingLink
          ? getMeetingJoinState(lesson.date, lesson.time)
          : { enabled: false, label: "Join Meeting" };
        return `
          <article class="list-card">
            <div class="list-card-top">
              <strong>${lesson.topic}</strong>
              <span class="status-pill ${lesson.statusTone}">${lesson.statusLabel}</span>
            </div>
            <p>${formatStudentDate(lesson.date, lesson.time)} at ${lesson.time}</p>
            <p class="list-card-note ${lesson.canCancel || lesson.canPayNow ? "" : "warning"}">${lesson.statusNote}</p>
            ${lesson.canCancel || lesson.canPayNow || hasMeetingLink
              ? `<div class="list-card-actions">
                  ${
                    hasMeetingLink
                      ? `<button
                          class="list-action meet student-join-meeting"
                          type="button"
                          data-booking-id="${lesson.id}"
                          data-lesson-date="${lesson.date}"
                          data-lesson-time="${lesson.time}"
                          ${meetingJoinState.enabled ? "" : "disabled"}
                        >
                          ${meetingJoinState.label}
                        </button>`
                      : ""
                  }
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

      const meetingButton = eventTarget.closest(".student-join-meeting");
      if (meetingButton) {
        if (!studentMeetingConfigured) {
          setStudentBookingFeedback("Meeting link is not configured yet.", "error");
          return;
        }

        const bookingId = String(meetingButton.getAttribute("data-booking-id") || "").trim();
        const date = String(meetingButton.getAttribute("data-lesson-date") || "");
        const time = String(meetingButton.getAttribute("data-lesson-time") || "");
        const state = getMeetingJoinState(date, time);
        if (!state.enabled) {
          setStudentBookingFeedback(
            `Join button unlocks ${studentMeetingEnableMinutesBefore} minutes before the lesson.`,
            "error"
          );
          return;
        }

        meetingButton.disabled = true;
        const originalLabel = meetingButton.textContent;
        meetingButton.textContent = "Opening...";

        const resolvedMeetingLink = studentMeetingDynamicPerBooking
          ? await fetchStudentMeetingJoinLinkForBooking(bookingId)
          : studentMeetingJoinLink;

        meetingButton.disabled = false;
        meetingButton.textContent = originalLabel || "Join Meeting";

        if (!hasText(resolvedMeetingLink)) {
          setStudentBookingFeedback("Could not open meeting link right now. Please try again.", "error");
          return;
        }

        window.open(resolvedMeetingLink, "_blank", "noopener,noreferrer");
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

      const reopenedDate = result.booking && result.booking.lesson_date ? result.booking.lesson_date : "";
      const reopenedTime = result.booking && result.booking.lesson_time
        ? String(result.booking.lesson_time).slice(0, 5)
        : "";
      if (reopenedDate && reopenedTime && window.HWFData && typeof window.HWFData.addAvailabilitySlot === "function") {
        window.HWFData.addAvailabilitySlot({
          date: reopenedDate,
          time: reopenedTime
        });
      }

      await loadActiveServerBookingsForAvailability();
      const refreshedStudent = await hydrateStudentFromServer(currentStudent);
      renderStudentDashboard(refreshedStudent);
    };

    updateStudentMeetingButtons();
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

  renderStudentProfileEditor(student);
  renderStudentBookingSection();
  populateStudentReviewForm(student);
  setStudentPortalSection(activeStudentPortalSection);
}

function bindStudentProfileEditor() {
  if (studentProfileEditorBound) {
    return;
  }

  const saveButton = document.getElementById("student-profile-save");
  const avatarInput = document.getElementById("student-profile-avatar-url");
  if (!saveButton || !avatarInput) {
    return;
  }

  avatarInput.addEventListener("input", updateStudentProfileAvatarPreview);

  saveButton.addEventListener("click", async () => {
    if (!currentSupabaseUserId || !currentStudent) {
      setStudentProfileFeedback("Sign in first to update your profile.", "error");
      return;
    }

    const fullName = document.getElementById("student-profile-name-input").value.trim();
    const timezone = document.getElementById("student-profile-timezone-input").value.trim();
    const track = document.getElementById("student-profile-track-input").value.trim();
    const goal = document.getElementById("student-profile-goal-input").value.trim();
    const notes = document.getElementById("student-profile-notes-input").value.trim();
    const avatarUrl = document.getElementById("student-profile-avatar-url").value.trim();

    if (!fullName) {
      setStudentProfileFeedback("Full name is required.", "error");
      return;
    }

    saveButton.disabled = true;
    try {
      const { error: profileError } = await window.supabaseClient
        .from("profiles")
        .update({
          full_name: fullName,
          timezone: timezone || "other",
          track: track || "1-on-1",
          goal: goal || "Conversation",
          notes
        })
        .eq("id", currentSupabaseUserId);

      if (profileError) {
        setStudentProfileFeedback(profileError.message || "Could not save profile details.", "error");
        return;
      }

      const metadataPayload = {
        full_name: fullName,
        timezone: timezone || "other",
        track: track || "1-on-1",
        goal: goal || "Conversation",
        notes,
        avatar_url: avatarUrl || ""
      };

      const { error: authError } = await window.supabaseClient.auth.updateUser({
        data: metadataPayload
      });

      if (!authError && currentSupabaseUser) {
        currentSupabaseUser = {
          ...currentSupabaseUser,
          user_metadata: {
            ...(currentSupabaseUser.user_metadata || {}),
            ...metadataPayload
          }
        };
      }

      const updatedStudent = window.HWFData.ensureStudentFromProfile({
        id: currentSupabaseUserId,
        email: currentStudent.email,
        full_name: fullName,
        name: fullName,
        level: currentStudent.level || "Beginner",
        track: track || "1-on-1",
        timezone: timezone || "other",
        goal: goal || "Conversation",
        notes
      });

      const hydratedStudent = await hydrateStudentFromServer({
        ...currentStudent,
        ...updatedStudent,
        name: fullName,
        track: track || "1-on-1",
        timezone: timezone || "other",
        goal: goal || "Conversation",
        notes
      });
      renderStudentDashboard(hydratedStudent);

      if (authError) {
        setStudentProfileFeedback(
          `Profile saved, but auth metadata update failed: ${authError.message || "Unknown error"}`,
          "error"
        );
        return;
      }

      setStudentProfileFeedback("Profile updated.", "success");
    } finally {
      saveButton.disabled = false;
    }
  });

  studentProfileEditorBound = true;
}

function bindStudentSetupModal() {
  if (studentSetupModalBound) {
    return;
  }

  const saveButton = document.getElementById("student-setup-save");
  if (!saveButton) {
    return;
  }

  saveButton.addEventListener("click", async () => {
    if (!currentSupabaseUserId || !currentStudent || !currentSupabaseUser) {
      setStudentSetupFeedback("Sign in again to complete setup.", "error");
      return;
    }

    const fullName = String(document.getElementById("student-setup-name")?.value || "").trim();
    const timezone = String(document.getElementById("student-setup-timezone")?.value || "").trim();
    const track = String(document.getElementById("student-setup-track")?.value || "").trim();
    const goal = String(document.getElementById("student-setup-goal")?.value || "").trim();

    if (!fullName || !timezone || !track || !goal) {
      setStudentSetupFeedback("Please complete all fields.", "error");
      return;
    }

    saveButton.disabled = true;
    try {
      const { error: profileError } = await window.supabaseClient
        .from("profiles")
        .update({
          full_name: fullName,
          timezone,
          track,
          goal
        })
        .eq("id", currentSupabaseUserId);

      if (profileError) {
        setStudentSetupFeedback(profileError.message || "Could not save setup.", "error");
        return;
      }

      const metadataPayload = {
        full_name: fullName,
        timezone,
        track,
        goal,
        profile_completed: true,
        profile_completed_at: new Date().toISOString()
      };

      const { error: authError } = await window.supabaseClient.auth.updateUser({
        data: metadataPayload
      });

      if (authError) {
        setStudentSetupFeedback(authError.message || "Could not finish setup.", "error");
        return;
      }

      currentSupabaseUser = {
        ...currentSupabaseUser,
        user_metadata: {
          ...(currentSupabaseUser.user_metadata || {}),
          ...metadataPayload
        }
      };

      const refreshedStudent = await hydrateStudentFromServer({
        ...currentStudent,
        name: fullName,
        timezone,
        track,
        goal
      });
      renderStudentDashboard(refreshedStudent);
      closeStudentSetupModal();
      setStudentBookingFeedback("Profile setup saved. You can edit details later in My Profile.", "success");
    } finally {
      saveButton.disabled = false;
    }
  });

  studentSetupModalBound = true;
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

    document.getElementById("student-booking-message").value = "";
    await loadActiveServerBookingsForAvailability();
    const refreshedStudent = await hydrateStudentFromServer(currentStudent);
    renderStudentDashboard(refreshedStudent);
    const bookedLesson = refreshedStudent.upcomingLessons.find((lesson) => {
      return String(lesson.id) === String(serverResult.booking.id);
    });

    let emailErrorMessage = "";

    if (bookedLesson) {
      try {
        if (bookedLesson.isFreeFirstLesson) {
          await window.HWFEmailApi.sendBookingEmail({
            studentName: bookingPayload.studentName,
            email: bookingPayload.email,
            date: bookingPayload.date,
            time: bookingPayload.time,
            lessonType: bookingPayload.lessonType,
            message: bookingPayload.message
          });
        } else {
          await window.HWFEmailApi.sendPaymentPendingEmail({
            studentName: bookingPayload.studentName,
            email: bookingPayload.email,
            date: bookingPayload.date,
            time: bookingPayload.time,
            lessonType: bookingPayload.lessonType
          });
        }
      } catch (emailError) {
        emailErrorMessage = String(emailError?.message || "").trim() || "Unknown email error.";
      }
    }

    const baseMessage =
      bookedLesson && bookedLesson.isFreeFirstLesson
        ? `Congratulations. Your free first lesson is booked for ${formatStudentDate(serverResult.booking.lesson_date, serverResult.booking.lesson_time)} at ${serverResult.booking.lesson_time.slice(0, 5)}.`
        : `Reserved for ${formatStudentDate(serverResult.booking.lesson_date, serverResult.booking.lesson_time)} at ${serverResult.booking.lesson_time.slice(0, 5)}. Please complete payment from your upcoming lessons (Pay Now).`;

    if (emailErrorMessage) {
      setStudentBookingFeedback(`${baseMessage} Booking saved, but email failed: ${emailErrorMessage}`, "error");
      return;
    }

    setStudentBookingFeedback(baseMessage, "success");
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
    currentSupabaseUser = null;
    studentMeetingConfigured = false;
    studentMeetingDynamicPerBooking = false;
    studentMeetingJoinLink = "";
    if (studentMeetingTickerId) {
      window.clearInterval(studentMeetingTickerId);
      studentMeetingTickerId = 0;
    }
    activeStudentPortalSection = "book";
    selectedStudentRating = 0;
    selectedStudentBookingDate = "";
    selectedStudentBookingTime = "";
    await window.supabaseClient.auth.signOut();
    closeStudentSetupModal();
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
  startStudentMeetingTicker();
  bindStudentSectionNav();
  bindStudentLogin();
  bindStudentProfileEditor();
  bindStudentSetupModal();
  bindStudentBookingSection();
  bindStudentReviewForm();
  openStudentDashboardFromSession();
}

initStudentPortal();
