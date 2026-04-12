const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 20;
const CALENDAR_STEP_MINUTES = 30;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const IS_TEACHER_LOGIN_PAGE = window.location.pathname.endsWith("/teacher-login.html") || window.location.pathname.endsWith("teacher-login.html");
const IS_TEACHER_DASHBOARD_PAGE = window.location.pathname.endsWith("/admin.html") || window.location.pathname.endsWith("admin.html");
const IS_TEACHER_CALENDAR_PAGE =
  window.location.pathname.endsWith("/teacher-calendar.html") || window.location.pathname.endsWith("teacher-calendar.html");
const IS_TEACHER_STUDENTS_PAGE = window.location.pathname.endsWith("/teacher-students.html") || window.location.pathname.endsWith("teacher-students.html");
const IS_TEACHER_MESSAGES_PAGE = window.location.pathname.endsWith("/messages.html") || window.location.pathname.endsWith("messages.html");
const IS_TEACHER_PROFILE_PAGE =
  window.location.pathname.endsWith("/teacher-profile.html") || window.location.pathname.endsWith("teacher-profile.html");
const IS_TEACHER_WALLET_PAGE =
  window.location.pathname.endsWith("/teacher-wallet.html") || window.location.pathname.endsWith("teacher-wallet.html");
const IS_TEACHER_SETTINGS_PAGE =
  window.location.pathname.endsWith("/teacher-settings.html") || window.location.pathname.endsWith("teacher-settings.html");
const IS_TEACHER_PROTECTED_PAGE =
  IS_TEACHER_DASHBOARD_PAGE ||
  IS_TEACHER_CALENDAR_PAGE ||
  IS_TEACHER_STUDENTS_PAGE ||
  IS_TEACHER_MESSAGES_PAGE ||
  IS_TEACHER_PROFILE_PAGE ||
  IS_TEACHER_WALLET_PAGE ||
  IS_TEACHER_SETTINGS_PAGE;
const TEACHER_ROLES = new Set(["teacher", "admin"]);

let currentWeekStart = getStartOfWeek(new Date());
let currentView = "week";
let focusMonth = new Date();
let focusedDate = "";
let currentTeacherUser = null;
let currentTeacherRole = "";
let teacherProfileEditorBound = false;
let teacherMeetingJoinLink = "";
let teacherMeetingEnableMinutesBefore = 15;
let teacherMeetingTickerId = 0;
let teacherBookingsRefreshTickerId = 0;
let teacherMeetingConfigured = false;
let teacherMeetingDynamicPerBooking = false;
let teacherBookingsLoadError = "";
let teacherServerStudents = [];
let teacherPortalTabsBound = false;
let teacherProfileDrawerBound = false;
let teacherSidebarToggleBound = false;
let teacherSidebarWasMobileMode = false;
let currentTeacherPortalTab = "home";
let teacherProfileState = null;
let teacherSettingsBound = false;
let teacherStudentPersonalizationBound = false;
let teacherStudentProfileModalBound = false;
let teacherStudentProfileModalStudentKey = "";
let teacherCalendarViewportInitialized = false;
const teacherStudentInsightsCache = new Map();
const DEFAULT_PROFILE_AVATAR =
  "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=400&q=80";
window.HWFServerBookings = window.HWFServerBookings || [];

function getPasswordResetRedirect() {
  return `${window.location.origin}/set-password.html`;
}

function byId(id) {
  return document.getElementById(id);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function splitCsvText(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function joinCsvText(values) {
  return Array.isArray(values) ? values.filter((entry) => hasText(String(entry || ""))).join(", ") : "";
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }

  return splitCsvText(value);
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };

  return String(text || "").replace(/[&<>"']/g, (character) => map[character]);
}

function formatCurrency(amount) {
  const currency =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.currency === "string"
      ? window.HWF_APP_CONFIG.currency
      : "GBP";

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency
  }).format(Number(amount || 0));
}

function getTeacherRoleLabel(role) {
  const normalizedRole = String(role || currentTeacherRole || "teacher").trim().toLowerCase();

  if (normalizedRole === "admin") {
    return "Portal Admin";
  }

  if (normalizedRole === "teacher") {
    return "Spanish Teacher";
  }

  return normalizedRole
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildTeacherLoginUrl() {
  const currentPath = window.location.pathname.split("/").pop() || "admin.html";
  const targetPath = currentPath === "teacher-login.html" ? "admin.html" : currentPath;
  return `teacher-login.html?next=${encodeURIComponent(targetPath)}`;
}

async function getTeacherAccessToken() {
  if (!window.supabaseClient) {
    return "";
  }

  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();

  return session?.access_token || "";
}

function getTeacherApiBaseUrl() {
  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";

  return configuredApiBase || window.location.origin;
}

function looksLikeAuthUserId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function redirectToTeacherLogin() {
  window.location.href = buildTeacherLoginUrl();
}

function getTeacherLoginNextTarget() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (!next || next.includes("://") || next.startsWith("/")) {
    return "admin.html";
  }

  return next;
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
    canMarkPaid: false
  };
}

function getStartOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function shiftMonth(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateParts(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return { year, month, day };
}

function toDateFromIso(dateString) {
  const { year, month, day } = parseDateParts(dateString);
  return new Date(year, month - 1, day);
}

function formatPortalDate(date, time) {
  const timestamp = new Date(`${date}T${time}`);
  return timestamp.toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatLongDate(dateString) {
  return toDateFromIso(dateString).toLocaleDateString("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function getTeacherDisplayName() {
  if (!currentTeacherUser) {
    return "Teacher";
  }

  const metadata = currentTeacherUser.user_metadata || {};
  const fullName = String(metadata.full_name || metadata.name || "").trim();
  if (fullName) {
    return fullName.split(" ")[0];
  }

  return String(currentTeacherUser.email || "Teacher").split("@")[0];
}

function getLessonTimestamp(date, time) {
  const parsed = new Date(`${String(date || "")}T${String(time || "")}`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getSortedActiveBookings() {
  return getBookings()
    .filter((booking) => getBookingStatusMeta(booking.status).active)
    .sort((left, right) => getLessonTimestamp(left.date, left.time) - getLessonTimestamp(right.date, right.time));
}

function formatLessonTimeLabel(time) {
  const parts = String(time || "").split(":");
  if (parts.length < 2) {
    return String(time || "");
  }

  const hourValue = Number(parts[0]);
  const minuteValue = Number(parts[1]);
  if (Number.isNaN(hourValue) || Number.isNaN(minuteValue)) {
    return String(time || "");
  }

  const suffix = hourValue >= 12 ? "PM" : "AM";
  const normalizedHour = hourValue % 12 === 0 ? 12 : hourValue % 12;
  return `${normalizedHour}:${String(minuteValue).padStart(2, "0")} ${suffix}`;
}

function isPendingPaymentStatus(statusMeta) {
  if (!statusMeta) {
    return false;
  }

  const normalized = String(statusMeta.value || "").toLowerCase();
  return statusMeta.canMarkPaid || normalized === "pending_payment" || normalized === "payment_submitted";
}

function getPendingPaymentBookings() {
  return getBookings().filter((booking) => isPendingPaymentStatus(getBookingStatusMeta(booking.status)));
}

function parseLessonStart(date, time) {
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTeacherMeetingJoinState(date, time) {
  const start = parseLessonStart(date, time);
  if (!start) {
    return {
      enabled: false,
      label: "Join Meeting"
    };
  }

  const now = new Date();
  const enableAt = new Date(start.getTime() - teacherMeetingEnableMinutesBefore * 60 * 1000);
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
    label: `Join in ${teacherMeetingEnableMinutesBefore} min`
  };
}

function updateTeacherMeetingButtons() {
  const buttons = document.querySelectorAll(".teacher-join-meeting");
  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    const date = String(button.getAttribute("data-lesson-date") || "");
    const time = String(button.getAttribute("data-lesson-time") || "");
    const state = getTeacherMeetingJoinState(date, time);
    button.disabled = !state.enabled;
    button.textContent = state.label;
  });
}

function startTeacherMeetingTicker() {
  if (teacherMeetingTickerId) {
    window.clearInterval(teacherMeetingTickerId);
  }

  teacherMeetingTickerId = window.setInterval(() => {
    updateTeacherMeetingButtons();
  }, 30000);
}

function stopTeacherLiveSync() {
  if (teacherBookingsRefreshTickerId) {
    window.clearInterval(teacherBookingsRefreshTickerId);
    teacherBookingsRefreshTickerId = 0;
  }
}

function startTeacherLiveSync() {
  stopTeacherLiveSync();
  teacherBookingsRefreshTickerId = window.setInterval(async () => {
    if (!currentTeacherUser) {
      return;
    }

    const dashboard = byId("admin-dashboard");
    if (!dashboard || dashboard.hidden) {
      return;
    }

    const loaded = await loadServerBookings();
    if (!loaded) {
      return;
    }

    renderAdminDashboard();
  }, 15000);
}

function formatRangeLabel(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const startLabel = weekStart.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric"
  });
  const endLabel = weekEnd.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

  return `${startLabel} - ${endLabel}`;
}

function getTimeSlots() {
  const slots = [];

  for (let hour = CALENDAR_START_HOUR; hour <= CALENDAR_END_HOUR; hour += 1) {
    for (let minutes = 0; minutes < 60; minutes += CALENDAR_STEP_MINUTES) {
      if (hour === CALENDAR_END_HOUR && minutes > 0) {
        continue;
      }

      slots.push(`${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
    }
  }

  return slots;
}

function getAvailability() {
  return window.HWFData.listAvailability();
}

function getBookings() {
  return window.HWFData.listBookings();
}

function normalizeTeacherStudentRecord(student) {
  const normalizedGoal = String(student?.goal || "Conversation").trim() || "Conversation";
  const normalizedName = String(student?.name || student?.full_name || "").trim();
  const normalizedEmail = normalizeEmail(student?.email || "");
  const normalizedLanguages = normalizeStringList(student?.languages);

  return {
    id: String(student?.id || "").trim(),
    email: normalizedEmail,
    name: normalizedName || (normalizedEmail ? normalizedEmail.split("@")[0] : "Student"),
    full_name: normalizedName || (normalizedEmail ? normalizedEmail.split("@")[0] : "Student"),
    level: String(student?.level || "Beginner").trim() || "Beginner",
    track: String(student?.track || "1-on-1").trim() || "1-on-1",
    timezone: String(student?.timezone || "").trim(),
    languages: normalizedLanguages,
    goal: normalizedGoal,
    notes: String(student?.notes || "").trim(),
    completedLessons: Number(student?.completedLessons || student?.completed_lessons || 0) || 0,
    totalLessons: Number(student?.totalLessons || student?.total_lessons || 0) || 0,
    streak: Number(student?.streak || 0) || 0,
    nextMilestone: String(student?.nextMilestone || student?.next_milestone || "").trim(),
    focusAreas: Array.isArray(student?.focusAreas)
      ? student.focusAreas.filter((value) => hasText(String(value || "")))
      : [normalizedGoal],
    coachNote: String(student?.coachNote || student?.coach_note || student?.notes || "").trim(),
    upcomingLessons: [],
    lessonHistory: []
  };
}

function getServerStudentsWithUpcomingLessons() {
  const students = Array.isArray(teacherServerStudents) ? teacherServerStudents : [];
  const activeBookings = getBookings().filter((booking) => getBookingStatusMeta(booking.status).active);
  const nowTimestamp = Date.now();
  const studentsByPrimaryKey = new Map();
  const studentPrimaryByLookupKey = new Map();

  students.forEach((student) => {
    const normalized = normalizeTeacherStudentRecord(student);
    const normalizedId = String(normalized.id || "").trim();
    const normalizedEmail = normalizeEmail(normalized.email || "");
    const primaryKey = normalizedId ? `id:${normalizedId}` : normalizedEmail ? `email:${normalizedEmail}` : "";
    if (!primaryKey) {
      return;
    }

    studentsByPrimaryKey.set(primaryKey, {
      ...normalized,
      completedLessons: 0,
      upcomingLessons: []
    });

    if (normalizedId) {
      studentPrimaryByLookupKey.set(`id:${normalizedId}`, primaryKey);
    }
    if (normalizedEmail) {
      studentPrimaryByLookupKey.set(`email:${normalizedEmail}`, primaryKey);
    }
  });

  activeBookings.forEach((booking) => {
    const bookingStudentId = String(booking.student_id || booking.studentId || "").trim();
    const bookingEmail = normalizeEmail(booking.email || booking.student_email || "");
    const idLookupKey = bookingStudentId ? `id:${bookingStudentId}` : "";
    const emailLookupKey = bookingEmail ? `email:${bookingEmail}` : "";
    let primaryKey =
      (idLookupKey && studentPrimaryByLookupKey.get(idLookupKey)) ||
      (emailLookupKey && studentPrimaryByLookupKey.get(emailLookupKey)) ||
      "";

    if (!primaryKey) {
      const fallbackName = hasText(booking.student_name)
        ? String(booking.student_name).trim()
        : bookingEmail
          ? bookingEmail.split("@")[0]
          : "Student";
      const fallbackStudent = normalizeTeacherStudentRecord({
        id: bookingStudentId || bookingEmail,
        email: bookingEmail,
        name: fallbackName,
        full_name: fallbackName,
        track: booking.lessonType || booking.lesson_type || "1-on-1",
        goal: "Conversation"
      });
      const fallbackId = String(fallbackStudent.id || "").trim();
      const fallbackEmail = normalizeEmail(fallbackStudent.email || "");
      primaryKey = fallbackId ? `id:${fallbackId}` : fallbackEmail ? `email:${fallbackEmail}` : "";

      if (!primaryKey) {
        return;
      }

      studentsByPrimaryKey.set(primaryKey, {
        ...fallbackStudent,
        completedLessons: 0,
        upcomingLessons: []
      });
      if (fallbackId) {
        studentPrimaryByLookupKey.set(`id:${fallbackId}`, primaryKey);
      }
      if (fallbackEmail) {
        studentPrimaryByLookupKey.set(`email:${fallbackEmail}`, primaryKey);
      }
    }

    const student = studentsByPrimaryKey.get(primaryKey);
    if (!student) {
      return;
    }

    const lessonTimestamp = getLessonTimestamp(booking.date, booking.time);
    if (lessonTimestamp && lessonTimestamp < nowTimestamp) {
      student.completedLessons += 1;
      return;
    }

    student.upcomingLessons.push({
      id: booking.id,
      date: booking.date,
      time: booking.time,
      topic: booking.lessonType || booking.lesson_type || student.track,
      status: getBookingStatusMeta(booking.status).label || "Booked"
    });
  });

  return Array.from(studentsByPrimaryKey.values())
    .map((student) => ({
      ...student,
      upcomingLessons: Array.isArray(student.upcomingLessons)
        ? student.upcomingLessons.sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`))
        : []
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getStudents() {
  return getServerStudentsWithUpcomingLessons();
}

function clearLocalStudentCache() {
  if (window.HWFData && typeof window.HWFData.pruneStudentsByEmails === "function") {
    window.HWFData.pruneStudentsByEmails([]);
  }
}

function getStudentGroups() {
  if (!window.HWFData || typeof window.HWFData.listStudentGroups !== "function") {
    return [];
  }

  return window.HWFData.listStudentGroups();
}

function getGroupsForStudent(studentId) {
  if (!window.HWFData || typeof window.HWFData.getStudentGroupsForStudent !== "function") {
    return [];
  }

  return window.HWFData.getStudentGroupsForStudent(studentId);
}

function formatStudentSummaryDate(date, time) {
  if (!date || !time) {
    return "No date set";
  }

  return `${formatPortalDate(date, time)} at ${time}`;
}

function formatTeacherStudentHistoryDate(date) {
  if (!hasText(String(date || ""))) {
    return "Date not recorded";
  }

  const parsed = new Date(`${String(date).trim()}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "Date not recorded";
  }

  return parsed.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function getOpenSlot(date, time) {
  return getAvailability().find((slot) => slot.date === date && slot.time === time) || null;
}

function getBooking(date, time) {
  return (
    getBookings().find((entry) => {
      return entry.date === date && entry.time === time && getBookingStatusMeta(entry.status).active;
    }) || null
  );
}

function getBookingCalendarVariant(booking) {
  const statusMeta = getBookingStatusMeta(booking?.status);
  return statusMeta.value === "confirmed_paid" ? "paid" : "reserved";
}

function getOpenDates() {
  return [...new Set(getAvailability().map((slot) => slot.date))].sort();
}

function getFocusableDates() {
  return [...new Set([
    ...getOpenDates(),
    ...getBookings().map((booking) => booking.date)
  ])].sort();
}

function getPreferredCalendarDate() {
  const today = toIsoDate(new Date());
  const focusableDates = getFocusableDates();
  if (!focusableDates.length) {
    return today;
  }

  const upcomingDate = focusableDates.find((date) => date >= today);
  return upcomingDate || today;
}

function initializeTeacherCalendarViewport() {
  if (teacherCalendarViewportInitialized) {
    return;
  }

  const preferredDate = getPreferredCalendarDate();
  const preferredDateObject = toDateFromIso(preferredDate);
  currentWeekStart = getStartOfWeek(preferredDateObject);
  focusedDate = preferredDate;
  focusMonth = new Date(preferredDateObject.getFullYear(), preferredDateObject.getMonth(), 1);
  teacherCalendarViewportInitialized = true;
}

function showTeacherError(message) {
  const error = byId("admin-error");
  if (!error) {
    return;
  }

  error.textContent = message;
  error.hidden = false;
}

function clearTeacherError() {
  const error = byId("admin-error");
  if (!error) {
    return;
  }

  error.hidden = true;
  error.textContent = "";
}

function setTeacherLoginFeedback(message, type) {
  const feedback = byId("admin-login-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function clearTeacherLoginFeedback() {
  const feedback = byId("admin-login-feedback");
  if (!feedback) {
    return;
  }

  feedback.hidden = true;
  feedback.textContent = "";
}

function setTeacherProfileFeedback(message, type) {
  const feedback = byId("teacher-profile-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function buildTeacherProfileFromInputs() {
  return {
    fullName: String(byId("teacher-profile-name")?.value || "").trim(),
    email: String(byId("teacher-profile-email")?.value || "").trim(),
    timezone: String(byId("teacher-profile-timezone")?.value || "").trim() || "Europe/London",
    role: String(byId("teacher-profile-role")?.value || currentTeacherRole || "teacher").trim(),
    avatarUrl: String(byId("teacher-profile-avatar-url")?.value || "").trim(),
    bio: String(byId("teacher-profile-bio")?.value || "").trim(),
    headline: String(byId("teacher-profile-headline")?.value || "").trim(),
    location: String(byId("teacher-profile-location")?.value || "").trim(),
    languages: splitCsvText(byId("teacher-profile-languages")?.value || ""),
    specialties: splitCsvText(byId("teacher-profile-specialties")?.value || ""),
    teachingStyle: String(byId("teacher-profile-teaching-style")?.value || "").trim(),
    certifications: String(byId("teacher-profile-certifications")?.value || "").trim(),
    funFacts: String(byId("teacher-profile-fun-facts")?.value || "").trim(),
    availabilityNotes: String(byId("teacher-profile-availability-notes")?.value || "").trim(),
    videoUrl: String(byId("teacher-profile-video-url")?.value || "").trim(),
    hourlyRate: Number(byId("teacher-profile-hourly-rate")?.value || 0) || null
  };
}

function updateTeacherProfileAvatarPreview() {
  const preview = byId("teacher-profile-avatar-preview");
  const avatarTargets = [...document.querySelectorAll("[data-teacher-avatar]")];
  if (!preview && !avatarTargets.length) {
    return;
  }

  const avatarUrl = String(byId("teacher-profile-avatar-url")?.value || "").trim();
  const nextAvatar = avatarUrl || DEFAULT_PROFILE_AVATAR;
  if (preview) {
    preview.src = nextAvatar;
  }
  avatarTargets.forEach((image) => {
    image.src = nextAvatar;
  });
}

function updateTeacherProfileSummary(profile) {
  const summaryName = byId("teacher-profile-summary-name");
  const summaryEmail = byId("teacher-profile-summary-email");
  const summaryMeta = byId("teacher-profile-summary-meta");
  const summaryHeadline = byId("teacher-profile-preview-headline");
  const summaryBio = byId("teacher-profile-preview-bio");
  const summaryTags = byId("teacher-profile-preview-tags");
  const avatarTargets = [...document.querySelectorAll("[data-teacher-avatar]")];
  const nextName = String(profile?.fullName || "").trim() || "Teacher profile";
  const nextEmail = String(profile?.email || "").trim() || "No email loaded";
  const nextTimezone = String(profile?.timezone || "").trim();
  const nextRole = String(profile?.role || "").trim();

  if (summaryName) {
    summaryName.textContent = nextName;
  }
  if (summaryEmail) {
    summaryEmail.textContent = nextEmail;
  }
  if (summaryMeta) {
    summaryMeta.textContent = nextTimezone
      ? `${nextTimezone}${nextRole ? ` - ${nextRole}` : ""}`
      : nextRole || "Timezone not set yet";
  }
  if (summaryHeadline) {
    summaryHeadline.textContent = String(profile?.headline || "").trim() || "Modern, personal Spanish teaching.";
  }
  if (summaryBio) {
    summaryBio.textContent =
      String(profile?.bio || "").trim() ||
      "Add a rich introduction so students understand your style, background, and what lessons with you feel like.";
  }
  if (summaryTags) {
    const tags = [
      ...splitCsvText(joinCsvText(profile?.languages || [])),
      ...splitCsvText(joinCsvText(profile?.specialties || []))
    ].slice(0, 6);

    summaryTags.innerHTML = (tags.length ? tags : ["Teacher intro", "Lesson style", "Languages"]).map((tag) => {
      return `<span class="teacher-profile-preview-tag">${tag}</span>`;
    }).join("");
  }
  avatarTargets.forEach((image) => {
    image.src = String(profile?.avatarUrl || "").trim() || DEFAULT_PROFILE_AVATAR;
  });
}

function renderTeacherProfileEditor(profile) {
  const nameInput = byId("teacher-profile-name");
  const emailInput = byId("teacher-profile-email");
  const timezoneInput = byId("teacher-profile-timezone");
  const roleInput = byId("teacher-profile-role");
  const bioInput = byId("teacher-profile-bio");
  const avatarInput = byId("teacher-profile-avatar-url");
  const hourlyRateInput = byId("teacher-profile-hourly-rate");
  const headlineInput = byId("teacher-profile-headline");
  const locationInput = byId("teacher-profile-location");
  const languagesInput = byId("teacher-profile-languages");
  const specialtiesInput = byId("teacher-profile-specialties");
  const teachingStyleInput = byId("teacher-profile-teaching-style");
  const certificationsInput = byId("teacher-profile-certifications");
  const funFactsInput = byId("teacher-profile-fun-facts");
  const availabilityNotesInput = byId("teacher-profile-availability-notes");
  const videoUrlInput = byId("teacher-profile-video-url");
  const preview = byId("teacher-profile-avatar-preview");

  if (!nameInput || !emailInput || !timezoneInput || !roleInput || !bioInput || !avatarInput || !preview) {
    return;
  }

  nameInput.value = profile.fullName;
  emailInput.value = profile.email;
  timezoneInput.value = profile.timezone;
  roleInput.value = profile.role;
  bioInput.value = profile.bio;
  avatarInput.value = profile.avatarUrl;
  if (hourlyRateInput) {
    hourlyRateInput.value = profile.hourlyRate == null ? "" : String(profile.hourlyRate);
  }
  if (headlineInput) {
    headlineInput.value = profile.headline || "";
  }
  if (locationInput) {
    locationInput.value = profile.location || "";
  }
  if (languagesInput) {
    languagesInput.value = joinCsvText(profile.languages || []);
  }
  if (specialtiesInput) {
    specialtiesInput.value = joinCsvText(profile.specialties || []);
  }
  if (teachingStyleInput) {
    teachingStyleInput.value = profile.teachingStyle || "";
  }
  if (certificationsInput) {
    certificationsInput.value = profile.certifications || "";
  }
  if (funFactsInput) {
    funFactsInput.value = profile.funFacts || "";
  }
  if (availabilityNotesInput) {
    availabilityNotesInput.value = profile.availabilityNotes || "";
  }
  if (videoUrlInput) {
    videoUrlInput.value = profile.videoUrl || "";
  }
  preview.src = profile.avatarUrl || DEFAULT_PROFILE_AVATAR;
  updateTeacherProfileSummary(profile);
}

async function loadTeacherProfileEditor() {
  if (!currentTeacherUser) {
    return;
  }

  const [profileResult, teacherProfileResult] = await Promise.all([
    window.supabaseClient
      .from("profiles")
      .select("full_name, timezone, notes")
      .eq("id", currentTeacherUser.id)
      .maybeSingle(),
    window.supabaseClient
      .from("teacher_profiles")
      .select("bio, timezone, hourly_rate")
      .eq("id", currentTeacherUser.id)
      .maybeSingle()
  ]);

  const metadata = currentTeacherUser.user_metadata || {};
  const profileDetails =
    metadata.teacher_profile_details && typeof metadata.teacher_profile_details === "object"
      ? metadata.teacher_profile_details
      : {};
  const fullName = String(
    profileResult.data?.full_name || metadata.full_name || metadata.name || currentTeacherUser.email.split("@")[0]
  ).trim();
  const timezone = String(
    profileResult.data?.timezone || teacherProfileResult.data?.timezone || metadata.timezone || "Europe/London"
  ).trim();
  const bio = String(
    teacherProfileResult.data?.bio || profileResult.data?.notes || metadata.notes || ""
  ).trim();
  const avatarUrl = String(metadata.avatar_url || "").trim();

  teacherProfileState = {
    fullName,
    email: currentTeacherUser.email || "",
    timezone,
    role: currentTeacherRole || "teacher",
    bio,
    avatarUrl,
    hourlyRate: teacherProfileResult.data?.hourly_rate ?? metadata.hourly_rate ?? null,
    headline: String(profileDetails.headline || "").trim(),
    location: String(profileDetails.location || "").trim(),
    languages: Array.isArray(profileDetails.languages) ? profileDetails.languages : [],
    specialties: Array.isArray(profileDetails.specialties) ? profileDetails.specialties : [],
    teachingStyle: String(profileDetails.teachingStyle || "").trim(),
    certifications: String(profileDetails.certifications || "").trim(),
    funFacts: String(profileDetails.funFacts || "").trim(),
    availabilityNotes: String(profileDetails.availabilityNotes || "").trim(),
    videoUrl: String(profileDetails.videoUrl || "").trim()
  };

  if (byId("teacher-profile-name")) {
    renderTeacherProfileEditor(teacherProfileState);
  } else {
    updateTeacherProfileSummary(teacherProfileState);
  }
  renderTeacherSettingsPage();
}

function bindTeacherProfileEditor() {
  if (teacherProfileEditorBound) {
    return;
  }

  const saveButton = byId("teacher-profile-save");
  if (!saveButton) {
    return;
  }

  [
    "teacher-profile-name",
    "teacher-profile-timezone",
    "teacher-profile-avatar-url",
    "teacher-profile-bio",
    "teacher-profile-headline",
    "teacher-profile-languages",
    "teacher-profile-specialties"
  ].forEach((id) => {
    const input = byId(id);
    if (!input) {
      return;
    }

    input.addEventListener("input", () => {
      updateTeacherProfileAvatarPreview();
      updateTeacherProfileSummary(buildTeacherProfileFromInputs());
    });
  });

  saveButton.addEventListener("click", async () => {
    if (!currentTeacherUser) {
      setTeacherProfileFeedback("Sign in again to update profile.", "error");
      return;
    }

    const profile = buildTeacherProfileFromInputs();

    if (!profile.fullName) {
      setTeacherProfileFeedback("Full name is required.", "error");
      return;
    }

    saveButton.disabled = true;
    try {
      const { error: profileError } = await window.supabaseClient.from("profiles").upsert({
        id: currentTeacherUser.id,
        full_name: profile.fullName,
        role: currentTeacherRole || "teacher",
        timezone: profile.timezone,
        notes: profile.bio,
        track: "Teacher",
        goal: "Teach on Hablawithflow"
      });

      if (profileError) {
        setTeacherProfileFeedback(profileError.message || "Could not save teacher profile.", "error");
        return;
      }

      const { error: teacherProfileError } = await window.supabaseClient.from("teacher_profiles").upsert({
        id: currentTeacherUser.id,
        bio: profile.bio || null,
        timezone: profile.timezone,
        hourly_rate: profile.hourlyRate
      });

      if (teacherProfileError) {
        setTeacherProfileFeedback(teacherProfileError.message || "Could not save teacher profile.", "error");
        return;
      }

      const metadataPayload = {
        full_name: profile.fullName,
        timezone: profile.timezone,
        notes: profile.bio,
        avatar_url: profile.avatarUrl || "",
        hourly_rate: profile.hourlyRate,
        teacher_profile_details: {
          headline: profile.headline,
          location: profile.location,
          languages: profile.languages,
          specialties: profile.specialties,
          teachingStyle: profile.teachingStyle,
          certifications: profile.certifications,
          funFacts: profile.funFacts,
          availabilityNotes: profile.availabilityNotes,
          videoUrl: profile.videoUrl
        }
      };

      const { error: authError } = await window.supabaseClient.auth.updateUser({
        data: metadataPayload
      });

      if (!authError) {
        currentTeacherUser = {
          ...currentTeacherUser,
          user_metadata: {
            ...(currentTeacherUser.user_metadata || {}),
            ...metadataPayload
          }
        };
      }

      await loadTeacherProfileEditor();

      if (authError) {
        setTeacherProfileFeedback(
          `Profile saved, but auth metadata update failed: ${authError.message || "Unknown error"}`,
          "error"
        );
        return;
      }

      setTeacherProfileFeedback("Teacher profile updated.", "success");
    } finally {
      saveButton.disabled = false;
    }
  });

  teacherProfileEditorBound = true;
}

function ensureFocusedDate() {
  const preferredDate = getPreferredCalendarDate();
  const hasFocusedDate = hasText(focusedDate);

  if (!hasFocusedDate) {
    focusedDate = preferredDate;
  }

  if (!(focusMonth instanceof Date) || Number.isNaN(focusMonth.getTime())) {
    const date = toDateFromIso(focusedDate);
    focusMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  }
}

function syncFocusedDateToFocusMonth() {
  const monthStart = new Date(focusMonth.getFullYear(), focusMonth.getMonth(), 1);
  const monthKey = toIsoDate(monthStart).slice(0, 7);
  const monthDates = getFocusableDates().filter((date) => date.startsWith(monthKey));

  focusedDate = monthDates.length ? monthDates[0] : toIsoDate(monthStart);
}

async function loadServerBookings() {
  teacherBookingsLoadError = "";
  const previousBookings = Array.isArray(window.HWFServerBookings) ? window.HWFServerBookings : [];
  const fromApi = await fetchTeacherBookingsFromServer();
  if (Array.isArray(fromApi)) {
    window.HWFServerBookings = fromApi;
    return true;
  }

  const { data, error } = await window.supabaseClient
    .from("bookings")
    .select("*")
    .order("lesson_date", { ascending: true })
    .order("lesson_time", { ascending: true });

  if (error) {
    if (!teacherBookingsLoadError) {
      teacherBookingsLoadError = error.message || "Could not load bookings from Supabase.";
    }
    return false;
  }

  if (!Array.isArray(data)) {
    if (!teacherBookingsLoadError) {
      teacherBookingsLoadError = "Bookings response is invalid.";
    }
    return false;
  }

  if (!data.length && previousBookings.length) {
    if (!teacherBookingsLoadError) {
      teacherBookingsLoadError = "Bookings API returned empty data while existing bookings were already loaded.";
    }
    return false;
  }

  window.HWFServerBookings = data;
  return true;
}

async function ensureFreshBookingsForAvailabilityUpdate() {
  const loaded = await loadServerBookings();
  if (!loaded) {
    setDashboardActionError(
      "Could not verify reserved lessons from the server. Refresh and try again before changing availability."
    );
    return false;
  }

  clearDashboardActionError();
  return true;
}

async function fetchTeacherStudentsFromServer() {
  if (!window.supabaseClient) {
    return null;
  }

  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();
  const accessToken = session?.access_token || "";
  if (!accessToken) {
    return null;
  }

  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";
  const apiBase = configuredApiBase || window.location.origin;

  try {
    const result = await fetch(`${apiBase}/api/teacher/students`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!result.ok) {
      return null;
    }

    const payload = await result.json();
    if (!payload || payload.ok !== true || !Array.isArray(payload.students)) {
      return null;
    }

    return payload.students;
  } catch {
    return null;
  }
}

async function fetchTeacherBookingsFromServer() {
  if (!window.supabaseClient) {
    return null;
  }

  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();
  const accessToken = session?.access_token || "";
  if (!accessToken) {
    return null;
  }

  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";
  const apiBase = configuredApiBase || window.location.origin;

  try {
    const result = await fetch(`${apiBase}/api/teacher/bookings`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!result.ok) {
      try {
        const errorPayload = await result.json();
        teacherBookingsLoadError = String(errorPayload?.error || "").trim() || `Teacher bookings API failed (${result.status}).`;
      } catch {
        teacherBookingsLoadError = `Teacher bookings API failed (${result.status}).`;
      }
      return null;
    }

    const payload = await result.json();
    if (!payload || payload.ok !== true || !Array.isArray(payload.bookings)) {
      teacherBookingsLoadError = "Teacher bookings API returned an invalid payload.";
      return null;
    }

    teacherBookingsLoadError = "";
    return payload.bookings;
  } catch {
    if (!teacherBookingsLoadError) {
      teacherBookingsLoadError = "Could not reach the teacher bookings API.";
    }
    return null;
  }
}

async function loadTeacherMeetingJoinConfig() {
  teacherMeetingConfigured = false;
  teacherMeetingDynamicPerBooking = false;
  teacherMeetingJoinLink = "";

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

    teacherMeetingConfigured = true;
    teacherMeetingDynamicPerBooking = Boolean(payload.dynamicPerBooking);
    teacherMeetingJoinLink = hasText(payload.joinLink) ? String(payload.joinLink).trim() : "";
    teacherMeetingEnableMinutesBefore = Math.max(1, Number(payload.enableMinutesBefore || 15));
  } catch {
    // Keep disabled if API fails.
  }
}

async function fetchTeacherMeetingJoinLinkForBooking(bookingId) {
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

async function syncStudentsFromServerProfiles() {
  const serverStudents = await fetchTeacherStudentsFromServer();
  if (!Array.isArray(serverStudents)) {
    teacherServerStudents = [];
    return false;
  }

  teacherServerStudents = serverStudents.map(normalizeTeacherStudentRecord);
  return true;
}

function setDashboardActionError(message) {
  const error = byId("slot-error");
  if (!error) {
    return;
  }

  error.dataset.tone = "error";
  error.textContent = message;
  error.hidden = false;
}

function setDashboardActionSuccess(message) {
  const error = byId("slot-error");
  if (!error) {
    return;
  }

  error.dataset.tone = "success";
  error.textContent = message;
  error.hidden = false;
}

function clearDashboardActionError() {
  const error = byId("slot-error");
  if (!error) {
    return;
  }

  delete error.dataset.tone;
  error.textContent = "";
  error.hidden = true;
}

function setTeacherPortalTab(nextTab) {
  const normalizedTab = nextTab === "calendar" ? "calendar" : "home";
  currentTeacherPortalTab = normalizedTab;

  document.querySelectorAll("[data-teacher-tab-panel]").forEach((panel) => {
    const panelTab = String(panel.getAttribute("data-teacher-tab-panel") || "");
    const isActive = panelTab === normalizedTab;
    panel.hidden = !isActive;
  });

  document.querySelectorAll("[data-teacher-tab-target]").forEach((tabButton) => {
    const tabValue = String(tabButton.getAttribute("data-teacher-tab-target") || "");
    const isActive = tabValue === normalizedTab;
    tabButton.classList.toggle("active", isActive);
    if (tabButton.getAttribute("role") === "tab") {
      tabButton.setAttribute("aria-selected", String(isActive));
    }
    if (tabButton.classList.contains("teacher-app-nav-link")) {
      tabButton.setAttribute("aria-current", isActive ? "page" : "false");
    }
  });
}

function bindTeacherPortalTabs() {
  if (teacherPortalTabsBound) {
    return;
  }

  const navTabs = document.querySelectorAll("[data-teacher-tab-target]");
  if (!navTabs.length) {
    return;
  }

  navTabs.forEach((tabButton) => {
    tabButton.addEventListener("click", () => {
      setTeacherPortalTab(String(tabButton.getAttribute("data-teacher-tab-target") || "home"));
    });
  });

  document.querySelectorAll(".teacher-tab-trigger").forEach((button) => {
    button.addEventListener("click", () => {
      setTeacherPortalTab(String(button.getAttribute("data-target-tab") || "home"));
    });
  });

  teacherPortalTabsBound = true;
}

function focusBookingSection(emphasizePayments) {
  const bookingList = byId("booking-list");
  if (!bookingList) {
    return;
  }

  bookingList.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!emphasizePayments) {
    return;
  }

  bookingList.classList.add("teacher-payments-focus");
  window.setTimeout(() => {
    bookingList.classList.remove("teacher-payments-focus");
  }, 1400);
}

function handleDashboardJump(action) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!normalizedAction) {
    return;
  }

  if (normalizedAction === "home") {
    setTeacherPortalTab("home");
    return;
  }

  if (normalizedAction === "calendar") {
    setTeacherPortalTab("calendar");
    byId("calendar-view-week")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (normalizedAction === "bookings") {
    setTeacherPortalTab("calendar");
    window.setTimeout(() => {
      focusBookingSection(false);
    }, 120);
    return;
  }

  if (normalizedAction === "payments") {
    setTeacherPortalTab("calendar");
    window.setTimeout(() => {
      focusBookingSection(true);
    }, 120);
    return;
  }

  if (normalizedAction === "profile" || normalizedAction === "settings") {
    openTeacherProfileDrawer();
  }
}

function bindDashboardShortcuts() {
  document.querySelectorAll("[data-dashboard-jump]").forEach((trigger) => {
    if (trigger.dataset.dashboardBound === "1") {
      return;
    }

    trigger.dataset.dashboardBound = "1";
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      handleDashboardJump(trigger.getAttribute("data-dashboard-jump"));
    });
  });
}

function isTeacherSidebarMobileMode() {
  return window.matchMedia("(max-width: 1024px)").matches;
}

function getTeacherSidebarIconMarkup(iconName) {
  const iconMap = {
    dashboard:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4z"></path><path d="M13 4h7v4h-7z"></path><path d="M13 10h7v10h-7z"></path><path d="M4 13h7v7H4z"></path></svg>',
    calendar:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4"></path><path d="M16 2v4"></path><path d="M3 10h18"></path><rect x="3" y="4" width="18" height="17" rx="2"></rect></svg>',
    students:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path><circle cx="9.5" cy="7" r="3"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 4.13a4 4 0 0 1 0 7.75"></path></svg>',
    messages:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-8.5 8.5H7l-4 2 1.5-4A8.5 8.5 0 1 1 21 12z"></path></svg>',
    wallet:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"></path><path d="M3 8h15"></path><path d="M16 14h3"></path></svg>',
    profile:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M5 20a7 7 0 0 1 14 0"></path></svg>',
    settings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.54V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.54 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.54-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.63 8a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.54 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.37 8a1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"></path></svg>',
    logout:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path></svg>'
  };

  return iconMap[iconName] || "";
}

function getTeacherMenuToggleIconMarkup() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>';
}

function getTeacherSidebarIconName(label) {
  const normalizedLabel = String(label || "").trim().toLowerCase();

  if (normalizedLabel.includes("dashboard")) {
    return "dashboard";
  }
  if (normalizedLabel.includes("calendar")) {
    return "calendar";
  }
  if (normalizedLabel.includes("student")) {
    return "students";
  }
  if (normalizedLabel.includes("message")) {
    return "messages";
  }
  if (normalizedLabel.includes("wallet")) {
    return "wallet";
  }
  if (normalizedLabel.includes("profile")) {
    return "profile";
  }
  if (normalizedLabel.includes("setting")) {
    return "settings";
  }
  if (normalizedLabel.includes("log out") || normalizedLabel.includes("logout")) {
    return "logout";
  }

  return "";
}

function hydrateTeacherSidebarIcons() {
  document.querySelectorAll(".teacher-nav-icon").forEach((iconElement) => {
    if (iconElement.dataset.iconHydrated === "1") {
      return;
    }

    const navItem = iconElement.closest(".teacher-app-nav-link");
    const labelElement = navItem?.querySelector("span:last-child");
    const iconName = getTeacherSidebarIconName(labelElement?.textContent || navItem?.textContent);
    const iconMarkup = getTeacherSidebarIconMarkup(iconName);

    if (!iconMarkup) {
      return;
    }

    iconElement.innerHTML = iconMarkup;
    iconElement.dataset.iconHydrated = "1";
  });
}

function prepareTeacherTopbarButtons() {
  document.querySelectorAll(".teacher-avatar-toggle").forEach((button) => {
    if (button.dataset.teacherProfileTriggerPrepared !== "1") {
      button.classList.add("teacher-open-profile");
      button.removeAttribute("data-sidebar-toggle");
      button.removeAttribute("aria-controls");
      button.removeAttribute("aria-expanded");
      button.setAttribute("aria-label", "Open teacher profile preview");
      button.dataset.teacherProfileTriggerPrepared = "1";
    }

    const tools = button.closest(".teacher-topbar-tools");
    if (!tools || tools.querySelector(".teacher-menu-toggle")) {
      return;
    }

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "teacher-menu-toggle";
    menuButton.setAttribute("data-sidebar-toggle", "");
    menuButton.setAttribute("aria-controls", "teacher-dashboard-sidebar");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    menuButton.innerHTML = getTeacherMenuToggleIconMarkup();
    tools.insertBefore(menuButton, button);
  });
}

function updateTeacherSidebarToggleState() {
  const toggleButtons = [...document.querySelectorAll("[data-sidebar-toggle]")];
  if (!toggleButtons.length) {
    return;
  }

  const isExpanded = document.body.classList.contains("teacher-sidebar-open");

  toggleButtons.forEach((button) => {
    button.setAttribute("aria-expanded", String(isExpanded));
  });

  document.querySelectorAll(".teacher-sidebar-edge-toggle").forEach((button) => {
    button.textContent = isExpanded ? "<" : ">";
    button.setAttribute("aria-label", isExpanded ? "Fold sidebar" : "Open sidebar");
  });

  document.querySelectorAll(".teacher-sidebar-brand-toggle").forEach((button) => {
    button.textContent = isExpanded ? "<" : ">";
    button.setAttribute("aria-label", isExpanded ? "Fold sidebar" : "Open sidebar");
  });
}

function closeTeacherSidebarMobile() {
  document.body.classList.remove("teacher-sidebar-open");
  updateTeacherSidebarToggleState();
}

function bindTeacherSidebarToggle() {
  if (teacherSidebarToggleBound) {
    return;
  }

  const toggleButtons = [...document.querySelectorAll("[data-sidebar-toggle]")];
  const sidebar = byId("teacher-dashboard-sidebar");
  const backdrop = byId("teacher-sidebar-backdrop");
  if (!toggleButtons.length || !sidebar) {
    return;
  }

  hydrateTeacherSidebarIcons();

  teacherSidebarWasMobileMode = isTeacherSidebarMobileMode();
  if (teacherSidebarWasMobileMode) {
    document.body.classList.remove("teacher-sidebar-open");
  }

  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      document.body.classList.toggle("teacher-sidebar-open");
      updateTeacherSidebarToggleState();
    });
  });

  if (backdrop) {
    backdrop.addEventListener("click", () => {
      closeTeacherSidebarMobile();
    });
  }

  document.querySelectorAll(".teacher-app-nav-link, .teacher-sidebar-logo").forEach((element) => {
    element.addEventListener("click", () => {
      if (isTeacherSidebarMobileMode()) {
        closeTeacherSidebarMobile();
      }
    });
  });

  window.addEventListener("resize", () => {
    const isMobile = isTeacherSidebarMobileMode();
    if (isMobile !== teacherSidebarWasMobileMode) {
      if (isMobile) {
        document.body.classList.remove("teacher-sidebar-open");
      }
      teacherSidebarWasMobileMode = isMobile;
    }
    updateTeacherSidebarToggleState();
  });

  updateTeacherSidebarToggleState();
  teacherSidebarToggleBound = true;
}

function getTeacherProfileSnapshot() {
  const metadata = currentTeacherUser?.user_metadata || {};
  const metadataDetails =
    metadata.teacher_profile_details && typeof metadata.teacher_profile_details === "object"
      ? metadata.teacher_profile_details
      : {};
  const sourceProfile = byId("teacher-profile-name") ? buildTeacherProfileFromInputs() : teacherProfileState || {};
  const fallbackName = String(
    metadata.full_name || metadata.name || currentTeacherUser?.email?.split("@")[0] || "Teacher profile"
  ).trim();
  const hourlyRateValue = sourceProfile.hourlyRate ?? metadata.hourly_rate ?? null;

  return {
    fullName: String(sourceProfile.fullName || fallbackName || "Teacher profile").trim(),
    email: String(sourceProfile.email || currentTeacherUser?.email || "").trim(),
    timezone: String(sourceProfile.timezone || metadata.timezone || "Europe/London").trim(),
    role: String(sourceProfile.role || currentTeacherRole || metadata.role || "teacher").trim(),
    avatarUrl: String(sourceProfile.avatarUrl || metadata.avatar_url || DEFAULT_PROFILE_AVATAR).trim() || DEFAULT_PROFILE_AVATAR,
    bio: String(sourceProfile.bio || metadata.notes || "").trim(),
    headline: String(sourceProfile.headline || metadataDetails.headline || "").trim(),
    location: String(sourceProfile.location || metadataDetails.location || "").trim(),
    languages: normalizeStringList(sourceProfile.languages || metadataDetails.languages || []),
    specialties: normalizeStringList(sourceProfile.specialties || metadataDetails.specialties || []),
    teachingStyle: String(sourceProfile.teachingStyle || metadataDetails.teachingStyle || "").trim(),
    certifications: String(sourceProfile.certifications || metadataDetails.certifications || "").trim(),
    funFacts: String(sourceProfile.funFacts || metadataDetails.funFacts || "").trim(),
    availabilityNotes: String(sourceProfile.availabilityNotes || metadataDetails.availabilityNotes || "").trim(),
    videoUrl: String(sourceProfile.videoUrl || metadataDetails.videoUrl || "").trim(),
    hourlyRate: hourlyRateValue == null || hourlyRateValue === "" ? null : Number(hourlyRateValue)
  };
}

function buildTeacherProfileDrawerChipMarkup(values, fallback) {
  const items = normalizeStringList(values);

  if (!items.length) {
    return `<span class="teacher-profile-drawer-empty">${escapeHtml(fallback)}</span>`;
  }

  return items
    .map((value) => `<span class="teacher-profile-preview-tag">${escapeHtml(value)}</span>`)
    .join("");
}

function buildTeacherProfileDrawerTextMarkup(value, fallback) {
  if (!hasText(value)) {
    return `<span class="teacher-profile-drawer-empty">${escapeHtml(fallback)}</span>`;
  }

  return escapeHtml(String(value || "")).replace(/\n/g, "<br>");
}

function ensureTeacherProfileDrawerMarkup() {
  if (byId("teacher-profile-drawer-layer")) {
    return;
  }

  const layer = document.createElement("div");
  layer.id = "teacher-profile-drawer-layer";
  layer.className = "teacher-profile-drawer-layer";
  layer.hidden = true;
  layer.innerHTML = `
    <button
      class="teacher-profile-drawer-backdrop"
      id="teacher-profile-close-overlay"
      type="button"
      aria-label="Close teacher profile preview"
    ></button>
    <aside class="teacher-profile-drawer" role="dialog" aria-modal="true" aria-labelledby="teacher-profile-drawer-title">
      <div class="teacher-profile-drawer-top">
        <div class="teacher-profile-summary-main">
          <img
            id="teacher-profile-drawer-avatar"
            class="teacher-profile-summary-avatar"
            data-teacher-avatar
            src="${DEFAULT_PROFILE_AVATAR}"
            alt="Teacher profile avatar"
          >
          <div class="teacher-profile-summary-copy">
            <strong id="teacher-profile-drawer-title">Teacher profile</strong>
            <span id="teacher-profile-drawer-subtitle">Student-facing preview</span>
          </div>
        </div>
        <button class="btn-outline teacher-profile-close" id="teacher-profile-close" type="button">Close</button>
      </div>

      <div class="teacher-profile-drawer-body">
        <section class="teacher-profile-drawer-hero">
          <div class="portal-profile-avatar-wrap">
            <span class="teacher-profile-drawer-label">Student-facing preview</span>
            <img
              id="teacher-profile-drawer-avatar-large"
              class="portal-profile-avatar"
              data-teacher-avatar
              src="${DEFAULT_PROFILE_AVATAR}"
              alt="Teacher profile avatar"
            >
          </div>

          <div class="teacher-profile-drawer-hero-copy">
            <p class="teacher-profile-drawer-eyebrow">How students see your profile</p>
            <h2 class="teacher-profile-drawer-name" id="teacher-profile-drawer-name">Teacher profile</h2>
            <p class="teacher-profile-drawer-headline" id="teacher-profile-drawer-headline">Modern, personal Spanish teaching.</p>
            <p class="teacher-profile-drawer-bio" id="teacher-profile-drawer-bio">
              Add a rich introduction so students understand your style, background, and what lessons with you feel like.
            </p>

            <div class="teacher-profile-drawer-tag-cluster">
              <div>
                <span class="teacher-profile-drawer-label">Languages</span>
                <div class="teacher-profile-drawer-tag-list" id="teacher-profile-drawer-languages"></div>
              </div>
              <div>
                <span class="teacher-profile-drawer-label">Specialties</span>
                <div class="teacher-profile-drawer-tag-list" id="teacher-profile-drawer-specialties"></div>
              </div>
            </div>

            <div class="teacher-profile-drawer-video-row" id="teacher-profile-drawer-video-row" hidden>
              <a
                class="btn-outline teacher-profile-drawer-link"
                id="teacher-profile-drawer-video-link"
                href="#"
                target="_blank"
                rel="noreferrer noopener"
              >Watch intro video</a>
            </div>
          </div>
        </section>

        <section class="teacher-profile-drawer-fact-grid">
          <article class="teacher-profile-drawer-fact">
            <span class="teacher-profile-drawer-label">Role</span>
            <strong id="teacher-profile-drawer-role">Spanish Teacher</strong>
            <p>How your role appears in the portal.</p>
          </article>
          <article class="teacher-profile-drawer-fact">
            <span class="teacher-profile-drawer-label">Location</span>
            <strong id="teacher-profile-drawer-location">Online</strong>
            <p>Where students think you are based.</p>
          </article>
          <article class="teacher-profile-drawer-fact">
            <span class="teacher-profile-drawer-label">Timezone</span>
            <strong id="teacher-profile-drawer-timezone">Europe/London</strong>
            <p>Used to set expectations around your schedule.</p>
          </article>
          <article class="teacher-profile-drawer-fact">
            <span class="teacher-profile-drawer-label">Hourly rate</span>
            <strong id="teacher-profile-drawer-rate">Hourly rate not set</strong>
            <p>What students see before booking.</p>
          </article>
          <article class="teacher-profile-drawer-fact">
            <span class="teacher-profile-drawer-label">Contact email</span>
            <strong id="teacher-profile-drawer-email">No email loaded</strong>
            <p>Your current teacher account email.</p>
          </article>
        </section>

        <section class="teacher-profile-drawer-section-grid">
          <article class="teacher-profile-drawer-section">
            <h3>Teaching style</h3>
            <p id="teacher-profile-drawer-teaching-style"></p>
          </article>
          <article class="teacher-profile-drawer-section">
            <h3>Certifications and experience</h3>
            <p id="teacher-profile-drawer-certifications"></p>
          </article>
          <article class="teacher-profile-drawer-section">
            <h3>Fun facts and hobbies</h3>
            <p id="teacher-profile-drawer-fun-facts"></p>
          </article>
          <article class="teacher-profile-drawer-section">
            <h3>Availability notes</h3>
            <p id="teacher-profile-drawer-availability-notes"></p>
          </article>
        </section>
      </div>
    </aside>
  `;

  document.body.appendChild(layer);
}

function renderTeacherProfileDrawer(profile = getTeacherProfileSnapshot()) {
  ensureTeacherProfileDrawerMarkup();

  const roleLabel = getTeacherRoleLabel(profile?.role);
  const hourlyRateLabel =
    Number.isFinite(Number(profile?.hourlyRate)) && Number(profile.hourlyRate) > 0
      ? `${formatCurrency(profile.hourlyRate)} / hour`
      : "Hourly rate not set";
  const locationLabel = hasText(profile?.location) ? profile.location : "Online";
  const timezoneLabel = hasText(profile?.timezone) ? profile.timezone : "Timezone not set yet";
  const emailLabel = hasText(profile?.email) ? profile.email : "No email loaded";
  const avatarUrl = String(profile?.avatarUrl || DEFAULT_PROFILE_AVATAR).trim() || DEFAULT_PROFILE_AVATAR;
  const subtitle = [roleLabel, timezoneLabel].filter(Boolean).join(" - ");
  const videoRow = byId("teacher-profile-drawer-video-row");
  const videoLink = byId("teacher-profile-drawer-video-link");

  ["teacher-profile-drawer-avatar", "teacher-profile-drawer-avatar-large"].forEach((id) => {
    const image = byId(id);
    if (image) {
      image.src = avatarUrl;
    }
  });

  if (byId("teacher-profile-drawer-title")) {
    byId("teacher-profile-drawer-title").textContent = String(profile?.fullName || "Teacher profile").trim() || "Teacher profile";
  }
  if (byId("teacher-profile-drawer-subtitle")) {
    byId("teacher-profile-drawer-subtitle").textContent = subtitle || "Student-facing preview";
  }
  if (byId("teacher-profile-drawer-name")) {
    byId("teacher-profile-drawer-name").textContent = String(profile?.fullName || "Teacher profile").trim() || "Teacher profile";
  }
  if (byId("teacher-profile-drawer-headline")) {
    byId("teacher-profile-drawer-headline").textContent =
      String(profile?.headline || "").trim() || "Modern, personal Spanish teaching.";
  }
  if (byId("teacher-profile-drawer-bio")) {
    byId("teacher-profile-drawer-bio").innerHTML = buildTeacherProfileDrawerTextMarkup(
      profile?.bio,
      "Add a rich introduction so students understand your style, background, and what lessons with you feel like."
    );
  }
  if (byId("teacher-profile-drawer-languages")) {
    byId("teacher-profile-drawer-languages").innerHTML = buildTeacherProfileDrawerChipMarkup(
      profile?.languages,
      "No languages added yet"
    );
  }
  if (byId("teacher-profile-drawer-specialties")) {
    byId("teacher-profile-drawer-specialties").innerHTML = buildTeacherProfileDrawerChipMarkup(
      profile?.specialties,
      "No specialties added yet"
    );
  }
  if (byId("teacher-profile-drawer-role")) {
    byId("teacher-profile-drawer-role").textContent = roleLabel;
  }
  if (byId("teacher-profile-drawer-location")) {
    byId("teacher-profile-drawer-location").textContent = locationLabel;
  }
  if (byId("teacher-profile-drawer-timezone")) {
    byId("teacher-profile-drawer-timezone").textContent = timezoneLabel;
  }
  if (byId("teacher-profile-drawer-rate")) {
    byId("teacher-profile-drawer-rate").textContent = hourlyRateLabel;
  }
  if (byId("teacher-profile-drawer-email")) {
    byId("teacher-profile-drawer-email").textContent = emailLabel;
  }
  if (byId("teacher-profile-drawer-teaching-style")) {
    byId("teacher-profile-drawer-teaching-style").innerHTML = buildTeacherProfileDrawerTextMarkup(
      profile?.teachingStyle,
      "Add your lesson structure, pacing, and classroom energy here."
    );
  }
  if (byId("teacher-profile-drawer-certifications")) {
    byId("teacher-profile-drawer-certifications").innerHTML = buildTeacherProfileDrawerTextMarkup(
      profile?.certifications,
      "Add qualifications, years of experience, or specialist background here."
    );
  }
  if (byId("teacher-profile-drawer-fun-facts")) {
    byId("teacher-profile-drawer-fun-facts").innerHTML = buildTeacherProfileDrawerTextMarkup(
      profile?.funFacts,
      "Add hobbies or personal details that help students connect with you."
    );
  }
  if (byId("teacher-profile-drawer-availability-notes")) {
    byId("teacher-profile-drawer-availability-notes").innerHTML = buildTeacherProfileDrawerTextMarkup(
      profile?.availabilityNotes,
      "Add notes about when you teach best or what students should know before booking."
    );
  }

  if (videoRow && videoLink) {
    if (hasText(profile?.videoUrl)) {
      videoLink.href = String(profile.videoUrl).trim();
      videoRow.hidden = false;
    } else {
      videoLink.removeAttribute("href");
      videoRow.hidden = true;
    }
  }
}

function openTeacherProfileDrawer() {
  ensureTeacherProfileDrawerMarkup();
  renderTeacherProfileDrawer();

  const layer = byId("teacher-profile-drawer-layer");
  if (!layer) {
    return;
  }

  if (isTeacherSidebarMobileMode()) {
    document.body.classList.remove("teacher-sidebar-open");
    updateTeacherSidebarToggleState();
  }
  layer.hidden = false;
  window.requestAnimationFrame(() => {
    document.body.classList.add("teacher-profile-drawer-open");
    byId("teacher-profile-close")?.focus();
  });
}

function closeTeacherProfileDrawer() {
  const layer = byId("teacher-profile-drawer-layer");
  if (!layer) {
    return;
  }

  document.body.classList.remove("teacher-profile-drawer-open");
  window.setTimeout(() => {
    if (!document.body.classList.contains("teacher-profile-drawer-open")) {
      layer.hidden = true;
    }
  }, 260);
}

function bindTeacherProfileDrawer() {
  if (teacherProfileDrawerBound) {
    return;
  }

  ensureTeacherProfileDrawerMarkup();
  const layer = byId("teacher-profile-drawer-layer");
  const openButtons = document.querySelectorAll(".teacher-open-profile");
  if (!layer || !openButtons.length) {
    return;
  }

  openButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openTeacherProfileDrawer();
    });
  });

  const closeButton = byId("teacher-profile-close");
  const closeOverlay = byId("teacher-profile-close-overlay");
  if (closeButton) {
    closeButton.addEventListener("click", () => {
      closeTeacherProfileDrawer();
    });
  }
  if (closeOverlay) {
    closeOverlay.addEventListener("click", () => {
      closeTeacherProfileDrawer();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("teacher-profile-drawer-open")) {
      closeTeacherProfileDrawer();
    }
  });

  teacherProfileDrawerBound = true;
}

async function markServerBookingPaid(bookingId) {
  const existingBooking = getBookings().find((booking) => String(booking.id) === String(bookingId));

  if (!existingBooking) {
    return { ok: false, error: "This booking could not be found." };
  }

  const statusMeta = getBookingStatusMeta(existingBooking.status);
  if (!statusMeta.canMarkPaid) {
    return { ok: false, error: "Only unpaid bookings can be marked as paid." };
  }

  const { data, error } = await window.supabaseClient
    .from("bookings")
    .update({ status: "confirmed_paid" })
    .eq("id", bookingId)
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, booking: data };
}

async function showTeacherDashboard() {
  const loginCard = byId("admin-login-card");
  const dashboard = byId("admin-dashboard");
  const teacherEntry = byId("teacher-entry");

  if (loginCard) {
    loginCard.hidden = true;
  }

  if (teacherEntry) {
    teacherEntry.hidden = true;
  }

  if (dashboard) {
    dashboard.hidden = false;
  }

  currentTeacherPortalTab = "home";
  setTeacherPortalTab(currentTeacherPortalTab);

  const bookingsLoaded = await loadServerBookings();
  const studentsLoaded = await syncStudentsFromServerProfiles();

  if (!bookingsLoaded) {
    setDashboardActionError(
      teacherBookingsLoadError || "Could not load latest bookings from server. Please refresh."
    );
  } else if (!studentsLoaded) {
    setDashboardActionError("Could not load student roster from Supabase. Refresh and check your teacher permissions.");
  } else {
    clearDashboardActionError();
  }

  initializeTeacherCalendarViewport();
  renderAdminDashboard();
  updateTeacherSidebarToggleState();
  startTeacherLiveSync();
}

async function getTeacherRoleForUser(userId) {
  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();
  const metadata = user && user.id === userId ? user.user_metadata || {} : {};
  const metadataRole = String(metadata.role || "").toLowerCase();

  const { data, error } = await window.supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: "Could not verify teacher role. Check the profiles table and permissions."
    };
  }

  if ((!data || !data.role || String(data.role).toLowerCase() === "student") && metadataRole === "teacher") {
    const profilePayload = {
      id: userId,
      full_name: metadata.full_name || user.email.split("@")[0],
      role: "teacher",
      timezone: metadata.timezone || "Europe/London",
      notes: metadata.notes || "",
      track: "Teacher",
      goal: "Teach on Hablawithflow"
    };

    const teacherProfilePayload = {
      id: userId,
      bio: metadata.notes || null,
      hourly_rate: metadata.hourly_rate ? Number(metadata.hourly_rate) : null,
      timezone: metadata.timezone || "Europe/London"
    };

    const profileUpsert = await window.supabaseClient.from("profiles").upsert(profilePayload);
    if (!profileUpsert.error) {
      await window.supabaseClient.from("teacher_profiles").upsert(teacherProfilePayload);
      return {
        ok: true,
        role: "teacher"
      };
    }
  }

  if (!data || !data.role) {
    return {
      ok: false,
      error: "This account has no teacher role yet. Ask admin to set role = teacher."
    };
  }

  const role = String(data.role).toLowerCase();
  if (!TEACHER_ROLES.has(role)) {
    return {
      ok: false,
      error: "This account does not have teacher access."
    };
  }

  return {
    ok: true,
    role
  };
}

async function openTeacherDashboardFromSession() {
  if (!window.supabaseClient) {
    showTeacherError("Teacher login is not configured.");
    return false;
  }

  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  if (!user) {
    currentTeacherUser = null;
    currentTeacherRole = "";
    teacherMeetingConfigured = false;
    teacherMeetingDynamicPerBooking = false;
    teacherMeetingJoinLink = "";
    teacherCalendarViewportInitialized = false;
    document.body.classList.remove("teacher-profile-drawer-open");
    const profileLayer = byId("teacher-profile-drawer-layer");
    if (profileLayer) {
      profileLayer.hidden = true;
    }
    stopTeacherLiveSync();
    if (IS_TEACHER_PROTECTED_PAGE) {
      redirectToTeacherLogin();
    }
    return false;
  }

  const roleResult = await getTeacherRoleForUser(user.id);
  if (!roleResult.ok) {
    currentTeacherUser = null;
    currentTeacherRole = "";
    teacherMeetingConfigured = false;
    teacherMeetingDynamicPerBooking = false;
    teacherMeetingJoinLink = "";
    teacherCalendarViewportInitialized = false;
    stopTeacherLiveSync();
    await window.supabaseClient.auth.signOut();
    if (IS_TEACHER_LOGIN_PAGE) {
      showTeacherError(roleResult.error);
    } else {
      redirectToTeacherLogin();
    }
    return false;
  }

  if (IS_TEACHER_LOGIN_PAGE) {
    window.location.href = getTeacherLoginNextTarget();
    return true;
  }

  currentTeacherUser = user;
  currentTeacherRole = roleResult.role || "teacher";
  await loadTeacherMeetingJoinConfig();
  clearTeacherError();
  await showTeacherDashboard();
  await loadTeacherProfileEditor();
  return true;
}

async function toggleSlot(date, time) {
  if (!(await ensureFreshBookingsForAvailabilityUpdate())) {
    return;
  }

  const booking = getBooking(date, time);

  if (booking) {
    setDashboardActionError("That time is already booked.");
    return;
  }

  const openSlot = getOpenSlot(date, time);

  if (openSlot) {
    window.HWFData.removeAvailabilitySlot(openSlot.id);
    clearDashboardActionError();
    renderAdminDashboard();
    return;
  }

  const result = window.HWFData.addAvailabilitySlot({ date, time });
  if (!result.ok) {
    setDashboardActionError(result.error);
    return;
  }

  clearDashboardActionError();
  renderAdminDashboard();
}

function renderAdminStats() {
  const students = getStudents();
  const upcomingCount = students.reduce((sum, student) => sum + student.upcomingLessons.length, 0);
  const activeBookings = getBookings().filter((booking) => getBookingStatusMeta(booking.status).active);

  if (byId("stat-open-slots")) {
    byId("stat-open-slots").textContent = getAvailability().length;
  }

  if (byId("stat-bookings")) {
    byId("stat-bookings").textContent = activeBookings.length;
  }

  if (byId("stat-students")) {
    byId("stat-students").textContent = students.length;
  }

  if (byId("stat-student-upcoming")) {
    byId("stat-student-upcoming").textContent = upcomingCount;
  }
}

function renderViewSwitcher() {
  const buttons = document.querySelectorAll(".view-switch-btn");

  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    const isActive = button.dataset.view === currentView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document.querySelectorAll(".calendar-view").forEach((panel) => {
    const isActive = panel.id === `calendar-view-${currentView}`;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}

function renderWeekCalendar() {
  const calendar = byId("availability-calendar");
  const range = byId("calendar-range");

  if (!calendar || !range) {
    return;
  }

  const timeSlots = getTimeSlots();
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(currentWeekStart, index));

  range.textContent = formatRangeLabel(currentWeekStart);
  syncBulkRangeToVisibleWeek();
  calendar.innerHTML = "";

  const headerSpacer = document.createElement("div");
  headerSpacer.className = "calendar-corner";
  calendar.appendChild(headerSpacer);

  weekDays.forEach((day) => {
    const header = document.createElement("div");
    header.className = "calendar-day-header";
    header.innerHTML = `
      <strong>${day.toLocaleDateString("en-GB", { weekday: "short" })}</strong>
      <span>${day.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
    `;
    calendar.appendChild(header);
  });

  timeSlots.forEach((time) => {
    const timeLabel = document.createElement("div");
    timeLabel.className = "calendar-time-label";
    timeLabel.textContent = time;
    calendar.appendChild(timeLabel);

    weekDays.forEach((day) => {
      const date = toIsoDate(day);
      const openSlot = getOpenSlot(date, time);
      const booking = getBooking(date, time);
      const cell = document.createElement("button");

      cell.type = "button";
      cell.className = "calendar-cell";
      cell.dataset.date = date;
      cell.dataset.time = time;

      if (booking) {
        const variant = getBookingCalendarVariant(booking);
        cell.classList.add("booked", variant === "paid" ? "booked-paid" : "booked-reserved");
        cell.disabled = true;
        cell.innerHTML = `
          <span class="calendar-cell-label">${variant === "paid" ? "Paid / booked" : "Reserved"}</span>
          <strong>${booking.studentName}</strong>
          <span>${booking.lessonType}</span>
        `;
      } else if (openSlot) {
        cell.classList.add("open");
        cell.innerHTML = `
          <span class="calendar-cell-label">Open</span>
          <strong>Available</strong>
          <span>Click to remove</span>
        `;
      } else {
        cell.classList.add("closed");
        cell.innerHTML = `
          <span class="calendar-cell-label">Closed</span>
          <strong>No slot</strong>
          <span>Click to open</span>
        `;
      }

      calendar.appendChild(cell);
    });
  });

  calendar.querySelectorAll(".calendar-cell:not(.booked)").forEach((cell) => {
    cell.addEventListener("click", () => {
      void toggleSlot(cell.dataset.date, cell.dataset.time);
    });
  });
}

function renderFocusDateGrid() {
  const grid = byId("focus-date-grid");
  const label = byId("focus-month-label");

  if (!grid || !label) {
    return;
  }

  ensureFocusedDate();

  const activeBookings = getBookings().filter((booking) => getBookingStatusMeta(booking.status).active);
  const openDates = new Set(getOpenDates());
  const bookedDates = new Set(activeBookings.map((booking) => booking.date));
  const year = focusMonth.getFullYear();
  const month = focusMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  label.textContent = focusMonth.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric"
  });

  grid.innerHTML = WEEKDAY_LABELS.map((day) => `<div class="focus-day-name">${day}</div>`).join("");

  for (let index = 0; index < firstWeekday; index += 1) {
    grid.innerHTML += '<div class="focus-date-cell empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = toIsoDate(new Date(year, month, day));
    const openCount = getAvailability().filter((slot) => slot.date === date).length;
    const dayActiveBookings = activeBookings.filter((booking) => booking.date === date);
    const bookedCount = dayActiveBookings.length;
    const reservedCount = dayActiveBookings.filter((booking) => getBookingCalendarVariant(booking) === "reserved").length;
    const paidCount = dayActiveBookings.filter((booking) => getBookingCalendarVariant(booking) === "paid").length;
    const isSelected = date === focusedDate;

    let statusClass = "closed";
    let caption = "No slots";

    if (bookedDates.has(date)) {
      if (paidCount > 0 && reservedCount === 0) {
        statusClass = openDates.has(date) ? "mixed" : "booked";
      } else if (reservedCount > 0 && paidCount === 0) {
        statusClass = openDates.has(date) ? "mixed" : "reserved";
      } else {
        statusClass = "mixed";
      }
      caption = bookedCount > 0 && openCount > 0
        ? `${openCount} open / ${reservedCount} reserved / ${paidCount} paid`
        : `${reservedCount} reserved / ${paidCount} paid`;
    }

    if (openDates.has(date)) {
      statusClass = bookedDates.has(date) ? "mixed" : "open";
      caption = `${openCount} open`;
    }

    grid.innerHTML += `
      <button class="focus-date-cell ${statusClass} ${isSelected ? "selected" : ""}" type="button" data-date="${date}">
        <strong>${day}</strong>
        <span>${caption}</span>
      </button>
    `;
  }

  grid.querySelectorAll(".focus-date-cell:not(.empty)").forEach((button) => {
    button.addEventListener("click", () => {
      focusedDate = button.dataset.date;
      focusMonth = new Date(parseDateParts(focusedDate).year, parseDateParts(focusedDate).month - 1, 1);
      renderFocusDateGrid();
      renderFocusHoursGrid();
    });
  });
}

function renderFocusHoursGrid() {
  const grid = byId("focus-hours-grid");
  const caption = byId("focus-date-caption");

  if (!grid || !caption) {
    return;
  }

  const timeSlots = getTimeSlots();

  caption.textContent = `Manage hours for ${formatLongDate(focusedDate)}.`;

  grid.innerHTML = timeSlots
    .map((time) => {
      const openSlot = getOpenSlot(focusedDate, time);
      const booking = getBooking(focusedDate, time);

      if (booking) {
        const variant = getBookingCalendarVariant(booking);
        return `
          <button class="focus-hour-chip booked ${variant === "paid" ? "paid" : "reserved"}" type="button" disabled>
            <strong>${time}</strong>
            <span>${booking.studentName} - ${variant === "paid" ? "Paid / booked" : "Reserved"}</span>
          </button>
        `;
      }

      if (openSlot) {
        return `
          <button class="focus-hour-chip open" type="button" data-time="${time}">
            <strong>${time}</strong>
            <span>Available</span>
          </button>
        `;
      }

      return `
        <button class="focus-hour-chip closed" type="button" data-time="${time}">
          <strong>${time}</strong>
          <span>Add slot</span>
        </button>
      `;
    })
    .join("");

  grid.querySelectorAll(".focus-hour-chip:not(.booked)").forEach((button) => {
    button.addEventListener("click", () => {
      void toggleSlot(focusedDate, button.dataset.time);
    });
  });
}

function renderBulkDefaults() {
  const dateFrom = byId("bulk-date-from");
  const dateTo = byId("bulk-date-to");

  if (!dateFrom || !dateTo) {
    return;
  }

  const today = new Date();
  const startDate = toIsoDate(today);
  const endDate = toIsoDate(addDays(today, 27));

  if (!dateFrom.value) {
    dateFrom.value = startDate;
  }

  if (!dateTo.value) {
    dateTo.value = endDate;
  }
}

function bindTeacherJoinMeetingButtons(container) {
  if (!container) {
    return;
  }

  container.querySelectorAll(".teacher-join-meeting").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!teacherMeetingConfigured) {
        setDashboardActionError("Meeting link is not configured yet.");
        return;
      }

      const bookingId = String(button.getAttribute("data-booking-id") || "").trim();
      const date = String(button.getAttribute("data-lesson-date") || "");
      const time = String(button.getAttribute("data-lesson-time") || "");
      const state = getTeacherMeetingJoinState(date, time);
      if (!state.enabled) {
        setDashboardActionError(`Join button unlocks ${teacherMeetingEnableMinutesBefore} minutes before class.`);
        return;
      }

      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Opening...";

      const resolvedMeetingLink = teacherMeetingDynamicPerBooking
        ? await fetchTeacherMeetingJoinLinkForBooking(bookingId)
        : teacherMeetingJoinLink;

      button.disabled = false;
      button.textContent = originalLabel || "Join Meeting";

      if (!hasText(resolvedMeetingLink)) {
        setDashboardActionError("Could not open meeting link right now. Please try again.");
        return;
      }

      clearDashboardActionError();
      window.open(resolvedMeetingLink, "_blank", "noopener,noreferrer");
    });
  });
}

function bindBookingMarkPaidButtons(container) {
  if (!container) {
    return;
  }

  container.querySelectorAll(".booking-mark-paid").forEach((button) => {
    button.addEventListener("click", async () => {
      clearDashboardActionError();
      button.disabled = true;

      const result = await markServerBookingPaid(button.dataset.bookingId);
      if (!result.ok) {
        button.disabled = false;
        setDashboardActionError(result.error);
        return;
      }

      await loadServerBookings();
      renderAdminDashboard();
    });
  });
}

function renderTeacherWeeklyPreview() {
  const container = byId("teacher-week-preview-grid");
  if (!container) {
    return;
  }

  const todayDate = toIsoDate(new Date());
  const activeBookings = getBookings().filter((booking) => getBookingStatusMeta(booking.status).active);
  const openSlots = getAvailability();
  const dayEntries = [
    ...activeBookings
      .filter((booking) => booking.date === todayDate)
      .map((booking) => {
        const statusMeta = getBookingStatusMeta(booking.status);
        return {
          time: booking.time,
          type: "booked",
          title: booking.studentName || "Booked lesson",
          subtitle: booking.lessonType || "Lesson",
          statusTone: statusMeta.tone,
          statusLabel: statusMeta.label
        };
      }),
    ...openSlots
      .filter((slot) => slot.date === todayDate)
      .map((slot) => ({
        time: slot.time,
        type: "open",
        title: "Open slot",
        subtitle: "Available to book",
        statusTone: "open",
        statusLabel: "Open"
      }))
  ].sort((left, right) => String(left.time || "").localeCompare(String(right.time || "")));

  if (!dayEntries.length) {
    container.innerHTML = `
      <article class="teacher-day-slot-card teacher-day-slot-card-empty">
        <div class="teacher-day-slot-copy">
          <strong>No slots today</strong>
          <p>Add availability in the calendar or wait for new bookings.</p>
        </div>
      </article>
    `;
    return;
  }

  container.innerHTML = dayEntries
    .map((entry) => {
      return `
        <article class="teacher-day-slot-card ${entry.type === "booked" ? "is-booked" : "is-open"}">
          <div class="teacher-day-slot-time">
            <strong>${formatLessonTimeLabel(entry.time)}</strong>
          </div>
          <div class="teacher-day-slot-copy">
            <div class="teacher-day-slot-head">
              <strong>${entry.title}</strong>
              <span class="status-pill ${entry.statusTone}">${entry.statusLabel}</span>
            </div>
            <p>${entry.subtitle}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTeacherHome() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Buenos dias" : hour < 18 ? "Buenas tardes" : "Buenas noches";
  const displayName = getTeacherDisplayName();
  const metadata = currentTeacherUser?.user_metadata || {};
  const metadataName = String(metadata.full_name || metadata.name || "").trim();
  const fullDisplayName = metadataName || displayName;
  const heading = byId("teacher-home-greeting-title");
  const subtitle = byId("teacher-home-greeting-subtitle");
  const upNextList = byId("teacher-home-up-next-list");

  if (byId("teacher-dashboard-date")) {
    byId("teacher-dashboard-date").textContent = formatCurrency(getWalletMonthTotal());
  }
  if (byId("teacher-topbar-name")) {
    byId("teacher-topbar-name").textContent = fullDisplayName;
  }
  if (byId("teacher-topbar-role")) {
    byId("teacher-topbar-role").textContent = getTeacherRoleLabel(currentTeacherRole);
  }

  if (!heading || !subtitle || !upNextList) {
    return;
  }

  const sortedActiveBookings = getSortedActiveBookings();
  const upcomingBookings = sortedActiveBookings.filter((booking) => getLessonTimestamp(booking.date, booking.time) >= now.getTime());
  const todayDate = toIsoDate(now);
  const tomorrowDate = toIsoDate(addDays(now, 1));
  const todayCount = upcomingBookings.filter((booking) => booking.date === todayDate).length;
  const tomorrowCount = upcomingBookings.filter((booking) => booking.date === tomorrowDate).length;
  const pendingPayments = getPendingPaymentBookings();
  const students = getStudents();
  const activeStudents = students.filter((student) => Array.isArray(student.upcomingLessons) && student.upcomingLessons.length);

  heading.textContent = `${greeting}, ${displayName}.`;
  if (todayCount > 0) {
    subtitle.textContent = `${todayCount} lesson${todayCount === 1 ? "" : "s"} remaining today.`;
  } else if (tomorrowCount > 0) {
    subtitle.textContent = `${tomorrowCount} lesson${tomorrowCount === 1 ? "" : "s"} scheduled for tomorrow.`;
  } else {
    subtitle.textContent = "No lessons queued right now. Add availability or review students.";
  }

  if (byId("teacher-home-stat-today")) {
    byId("teacher-home-stat-today").textContent = String(todayCount);
  }
  if (byId("teacher-home-stat-bookings")) {
    byId("teacher-home-stat-bookings").textContent = String(upcomingBookings.length);
  }
  if (byId("teacher-home-stat-students")) {
    byId("teacher-home-stat-students").textContent = String(activeStudents.length);
  }
  if (byId("teacher-home-stat-open-slots")) {
    byId("teacher-home-stat-open-slots").textContent = String(getAvailability().length);
  }
  if (byId("teacher-home-stat-pending")) {
    byId("teacher-home-stat-pending").textContent = String(pendingPayments.length);
  }

  if (!upcomingBookings.length) {
    upNextList.innerHTML = '<p class="empty-copy">No upcoming lessons scheduled yet.</p>';
  } else {
    upNextList.innerHTML = upcomingBookings
      .slice(0, 6)
      .map((booking) => {
        const statusMeta = getBookingStatusMeta(booking.status);
        const hasMeetingLink = teacherMeetingConfigured && statusMeta.value === "confirmed_paid";
        const meetingJoinState = hasMeetingLink
          ? getTeacherMeetingJoinState(booking.date, booking.time)
          : { enabled: false, label: "Join Meeting" };
        const lessonTag = String(booking.lessonType || "Lesson").trim();
        const timeLabel = formatLessonTimeLabel(booking.time);
        const [timePart, suffixPart] = timeLabel.split(" ");

        return `
          <article class="teacher-upnext-item">
            <div class="teacher-upnext-time">
              <strong>${timePart || booking.time}</strong>
              <span>${suffixPart || ""}</span>
            </div>
            <div class="teacher-upnext-copy">
              <div class="teacher-upnext-title">
                <strong>${booking.studentName}</strong>
                <span class="teacher-lesson-tag">${lessonTag}</span>
                <span class="status-pill ${statusMeta.tone}">${statusMeta.label}</span>
              </div>
              <p>${formatPortalDate(booking.date, booking.time)} - ${booking.email}</p>
              <span>${booking.message || "No booking note added."}</span>
              ${
                statusMeta.canMarkPaid || hasMeetingLink
                  ? `<div class="teacher-upnext-actions">
                      ${
                        hasMeetingLink
                          ? `<button
                              class="list-action meet teacher-join-meeting"
                              type="button"
                              data-booking-id="${booking.id}"
                              data-lesson-date="${booking.date}"
                              data-lesson-time="${booking.time}"
                              ${meetingJoinState.enabled ? "" : "disabled"}
                            >
                              ${meetingJoinState.label}
                            </button>`
                          : ""
                      }
                      ${
                        statusMeta.canMarkPaid
                          ? `<button class="list-action pay booking-mark-paid" type="button" data-booking-id="${booking.id}">
                              ${statusMeta.value === "payment_submitted" ? "Confirm Paid" : "Mark Paid"}
                            </button>`
                          : ""
                      }
                    </div>`
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  bindTeacherJoinMeetingButtons(upNextList);
  bindBookingMarkPaidButtons(upNextList);
  updateTeacherMeetingButtons();

  renderTeacherWeeklyPreview();
}

function getLessonRevenueAmount() {
  const configuredPrice =
    window.HWF_APP_CONFIG && Number(window.HWF_APP_CONFIG.lessonPrice)
      ? Number(window.HWF_APP_CONFIG.lessonPrice)
      : 20;

  return configuredPrice;
}

function getPaidBookings() {
  return getBookings().filter((booking) => getBookingStatusMeta(booking.status).value === "confirmed_paid");
}

function getWalletMonthTotal() {
  const paidBookings = getPaidBookings();
  const lessonRevenue = getLessonRevenueAmount();
  const now = new Date();
  const monthStart = getStartOfMonth(now);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return paidBookings.reduce((sum, booking) => {
    const lessonDate = toDateFromIso(booking.date);
    return lessonDate >= monthStart && lessonDate <= monthEnd ? sum + lessonRevenue : sum;
  }, 0);
}

function getStartOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildRevenueBreakdown(mode, count) {
  const now = new Date();
  const paidBookings = getPaidBookings();
  const lessonRevenue = getLessonRevenueAmount();
  const buckets = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    if (mode === "week") {
      const weekStart = addDays(getStartOfWeek(now), index * -7);
      const weekEnd = addDays(weekStart, 6);
      const total = paidBookings.reduce((sum, booking) => {
        const lessonDate = toDateFromIso(booking.date);
        return lessonDate >= weekStart && lessonDate <= weekEnd ? sum + lessonRevenue : sum;
      }, 0);

      buckets.push({
        label: `${weekStart.toLocaleDateString("en-GB", { month: "short", day: "numeric" })} - ${weekEnd.toLocaleDateString("en-GB", {
          month: "short",
          day: "numeric"
        })}`,
        total
      });
      continue;
    }

    const monthDate = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const total = paidBookings.reduce((sum, booking) => {
      const lessonDate = toDateFromIso(booking.date);
      return lessonDate.getFullYear() === monthDate.getFullYear() && lessonDate.getMonth() === monthDate.getMonth()
        ? sum + lessonRevenue
        : sum;
    }, 0);

    buckets.push({
      label: monthDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      total
    });
  }

  return buckets;
}

function renderTeacherWalletOverview() {
  const hasDashboardWallet =
    byId("teacher-home-stat-wallet-balance") || byId("teacher-wallet-week-total") || byId("wallet-week-total");
  if (!hasDashboardWallet) {
    return;
  }

  const lessonRevenue = getLessonRevenueAmount();
  const paidBookings = getPaidBookings();
  const now = new Date();
  const weekStart = getStartOfWeek(now);
  const weekEnd = addDays(weekStart, 6);
  const monthStart = getStartOfMonth(now);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const weekTotal = paidBookings.reduce((sum, booking) => {
    const lessonDate = toDateFromIso(booking.date);
    return lessonDate >= weekStart && lessonDate <= weekEnd ? sum + lessonRevenue : sum;
  }, 0);
  const monthTotal = paidBookings.reduce((sum, booking) => {
    const lessonDate = toDateFromIso(booking.date);
    return lessonDate >= monthStart && lessonDate <= monthEnd ? sum + lessonRevenue : sum;
  }, 0);
  const weeklyBreakdown = buildRevenueBreakdown("week", 6);
  const paidListContainer = byId("wallet-paid-list");

  if (byId("teacher-wallet-week-total")) {
    byId("teacher-wallet-week-total").textContent = formatCurrency(weekTotal);
  }
  if (byId("teacher-wallet-month-total")) {
    byId("teacher-wallet-month-total").textContent = formatCurrency(monthTotal);
  }
  if (byId("teacher-wallet-paid-lessons")) {
    byId("teacher-wallet-paid-lessons").textContent = String(paidBookings.length);
  }
  if (byId("teacher-home-stat-wallet-balance")) {
    byId("teacher-home-stat-wallet-balance").textContent = formatCurrency(monthTotal);
  }

  if (byId("wallet-week-total")) {
    byId("wallet-week-total").textContent = formatCurrency(weekTotal);
  }
  if (byId("wallet-month-total")) {
    byId("wallet-month-total").textContent = formatCurrency(monthTotal);
  }
  if (byId("wallet-paid-lessons")) {
    byId("wallet-paid-lessons").textContent = String(paidBookings.length);
  }

  if (paidListContainer) {
    const sortedPaidBookings = [...paidBookings].sort((left, right) => {
      return getLessonTimestamp(right.date, right.time) - getLessonTimestamp(left.date, left.time);
    });

    paidListContainer.innerHTML = sortedPaidBookings.length
      ? sortedPaidBookings.slice(0, 8).map((booking) => {
          return `
            <article class="list-card">
              <div class="list-card-top">
                <strong>${booking.studentName}</strong>
                <span class="status-pill paid">${formatCurrency(lessonRevenue)}</span>
              </div>
              <p>${formatPortalDate(booking.date, booking.time)} at ${formatLessonTimeLabel(booking.time)}</p>
              <p class="list-card-note">${booking.lessonType || "Lesson"}</p>
            </article>
          `;
        }).join("")
      : '<p class="empty-copy">No paid lessons yet.</p>';
  }
}

function setTeacherSettingsFeedback(message, type) {
  const feedback = byId("teacher-settings-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function renderTeacherSettingsPage() {
  if (!byId("teacher-settings-timezone") || !currentTeacherUser) {
    return;
  }

  const metadata = currentTeacherUser.user_metadata || {};
  const settings =
    metadata.teacher_settings && typeof metadata.teacher_settings === "object"
      ? metadata.teacher_settings
      : {};

  byId("teacher-settings-timezone").value = String(metadata.timezone || teacherProfileState?.timezone || "Europe/London");
  byId("teacher-settings-provider").value = teacherMeetingConfigured ? "Configured meeting link" : "Not configured";
  byId("teacher-settings-join-window").value = `${teacherMeetingEnableMinutesBefore} minutes before lesson`;
  byId("teacher-settings-sidebar-mode").value = settings.sidebarMode === "collapsed" ? "collapsed" : "open";
  byId("teacher-settings-weekly-summary").checked = Boolean(settings.weeklySummary);
  byId("teacher-settings-before-lesson").checked = Boolean(settings.beforeLessonChecklist);
  byId("teacher-settings-default-note").value = String(settings.defaultLessonNote || "");
  byId("teacher-settings-focus-reminder").value = String(settings.focusReminder || "");
}

function bindTeacherSettingsPage() {
  if (teacherSettingsBound) {
    return;
  }

  const saveButton = byId("teacher-settings-save");
  if (!saveButton) {
    return;
  }

  saveButton.addEventListener("click", async () => {
    if (!currentTeacherUser) {
      setTeacherSettingsFeedback("Sign in again to update settings.", "error");
      return;
    }

    const timezone = String(byId("teacher-settings-timezone")?.value || "Europe/London").trim() || "Europe/London";
    const settingsPayload = {
      sidebarMode: String(byId("teacher-settings-sidebar-mode")?.value || "open"),
      weeklySummary: Boolean(byId("teacher-settings-weekly-summary")?.checked),
      beforeLessonChecklist: Boolean(byId("teacher-settings-before-lesson")?.checked),
      defaultLessonNote: String(byId("teacher-settings-default-note")?.value || "").trim(),
      focusReminder: String(byId("teacher-settings-focus-reminder")?.value || "").trim()
    };

    saveButton.disabled = true;
    try {
      const { error: profileError } = await window.supabaseClient.from("profiles").upsert({
        id: currentTeacherUser.id,
        full_name: teacherProfileState?.fullName || currentTeacherUser.email.split("@")[0],
        role: currentTeacherRole || "teacher",
        timezone,
        notes: teacherProfileState?.bio || "",
        track: "Teacher",
        goal: "Teach on Hablawithflow"
      });

      if (profileError) {
        setTeacherSettingsFeedback(profileError.message || "Could not save teacher settings.", "error");
        return;
      }

      const { error } = await window.supabaseClient.auth.updateUser({
        data: {
          ...(currentTeacherUser.user_metadata || {}),
          timezone,
          teacher_settings: settingsPayload
        }
      });

      if (error) {
        setTeacherSettingsFeedback(error.message || "Could not save teacher settings.", "error");
        return;
      }

      currentTeacherUser = {
        ...currentTeacherUser,
        user_metadata: {
          ...(currentTeacherUser.user_metadata || {}),
          timezone,
          teacher_settings: settingsPayload
        }
      };

      if (teacherProfileState) {
        teacherProfileState.timezone = timezone;
      }
      renderTeacherSettingsPage();
      setTeacherSettingsFeedback("Settings updated.", "success");
    } finally {
      saveButton.disabled = false;
    }
  });

  teacherSettingsBound = true;
}

function renderBookings() {
  const container = byId("booking-list");

  if (!container) {
    return;
  }

  const bookings = getBookings();

  if (!bookings.length) {
    container.innerHTML = '<p class="empty-copy">No bookings have been made yet.</p>';
    return;
  }

  container.innerHTML = bookings
    .map((booking) => {
      const statusMeta = getBookingStatusMeta(booking.status);
      const isPendingPayment = isPendingPaymentStatus(statusMeta);
      const hasMeetingLink = teacherMeetingConfigured && statusMeta.value === "confirmed_paid";
      const meetingJoinState = hasMeetingLink
        ? getTeacherMeetingJoinState(booking.date, booking.time)
        : { enabled: false, label: "Join Meeting" };
      const paymentNote = statusMeta.value === "payment_submitted"
        ? '<p class="list-card-note">Student completed checkout. Status should switch to paid automatically. Use Confirm Paid only if it does not update.</p>'
        : statusMeta.canMarkPaid
          ? '<p class="list-card-note warning">Students can cancel only after you mark this lesson as paid.</p>'
          : statusMeta.value === "cancelled_paid"
          ? '<p class="list-card-note warning">Cancelled by the student. Payment remains retained.</p>'
          : "";
      return `
        <article class="list-card ${isPendingPayment ? "payment-pending-card" : ""}">
          <div class="list-card-top">
            <strong>${booking.studentName}</strong>
            <span class="status-pill ${statusMeta.tone}">${statusMeta.label}</span>
          </div>
          <p>${formatPortalDate(booking.date, booking.time)} at ${booking.time} - ${booking.lessonType}</p>
          <span>${booking.email}</span>
          <p class="list-card-note">${booking.message || "No booking note added."}</p>
          ${paymentNote}
            ${
              statusMeta.canMarkPaid || hasMeetingLink
                ? `<div class="list-card-actions">
                  ${
                    hasMeetingLink
                      ? `<button
                          class="list-action meet teacher-join-meeting"
                          type="button"
                          data-booking-id="${booking.id}"
                          data-lesson-date="${booking.date}"
                          data-lesson-time="${booking.time}"
                          ${meetingJoinState.enabled ? "" : "disabled"}
                        >
                          ${meetingJoinState.label}
                        </button>`
                      : ""
                  }
                  ${
                    statusMeta.canMarkPaid
                      ? `<button class="list-action pay booking-mark-paid" type="button" data-booking-id="${booking.id}">
                          ${statusMeta.value === "payment_submitted" ? "Confirm Paid" : "Mark Paid"}
                        </button>`
                      : ""
                  }
                </div>`
                : ""
            }
        </article>
      `;
    })
    .join("");
  bindTeacherJoinMeetingButtons(container);
  updateTeacherMeetingButtons();
  bindBookingMarkPaidButtons(container);
}

function renderStudentSelect() {
  const select = byId("student-select");

  if (!select) {
    return;
  }

  const selectedId = select.value;
  const students = getStudents();

  select.innerHTML = students
    .map((student) => `<option value="${student.id}">${student.name}</option>`)
    .join("");

  if (students.some((student) => student.id === selectedId)) {
    select.value = selectedId;
  }
}

function getTeacherStudentInsightKey(student) {
  const email = normalizeEmail(student?.email || "");
  const id = String(student?.id || "").trim();
  return email || id;
}

function getSelectedTeacherStudent() {
  const selectedId = String(byId("student-select")?.value || "").trim();
  if (!selectedId) {
    return null;
  }

  return getStudents().find((entry) => entry.id === selectedId) || null;
}

function setTeacherStudentProfileTriggerState(isDisabled) {
  const trigger = byId("open-student-profile");
  if (!trigger) {
    return;
  }

  trigger.classList.toggle("is-disabled", isDisabled);
  trigger.setAttribute("aria-disabled", String(isDisabled));
  if (isDisabled) {
    trigger.setAttribute("tabindex", "-1");
  } else {
    trigger.removeAttribute("tabindex");
  }
}

function setTeacherStudentProfileModalText(id, value, fallback) {
  const element = byId(id);
  if (!element) {
    return;
  }

  const normalized = String(value || "").trim();
  element.textContent = normalized || fallback;
}

function buildTeacherStudentProfileChipMarkup(values, fallback) {
  const items = normalizeStringList(values);
  if (!items.length) {
    return `<span class="focus-chip teacher-student-profile-empty-chip">${escapeHtml(fallback)}</span>`;
  }

  return items.map((value) => `<span class="focus-chip">${escapeHtml(value)}</span>`).join("");
}

function isTeacherStudentProfileModalOpen() {
  const layer = byId("teacher-student-profile-modal");
  return Boolean(layer && !layer.hidden);
}

function closeTeacherStudentProfileModal() {
  const layer = byId("teacher-student-profile-modal");
  if (!layer) {
    return;
  }

  layer.hidden = true;
  document.body.classList.remove("teacher-student-profile-modal-open");
  teacherStudentProfileModalStudentKey = "";
}

function renderTeacherStudentProfileModal(student) {
  const layer = byId("teacher-student-profile-modal");
  if (!layer || !student) {
    return;
  }

  const personalization = student.personalization || {};
  const learningPlan = student.learningPlan || {};
  const upcomingLesson = Array.isArray(student.upcomingLessons) && student.upcomingLessons.length ? student.upcomingLessons[0] : null;
  const focusAreas = normalizeStringList(student.focusAreas);
  const objectives = normalizeStringList(Array.isArray(learningPlan.objectives) ? learningPlan.objectives : learningPlan.objectives || "");
  const lessonHistory = Array.isArray(student.lessonHistory) ? student.lessonHistory.slice(0, 4) : [];
  const homeworkFiles = Array.isArray(student.homeworkFiles) ? student.homeworkFiles.slice(0, 3) : [];
  const whyLearning = String(personalization.learning_goal || student.goal || "").trim();
  const coachNote = String(student.coachNote || learningPlan.teacher_notes || student.notes || "").trim();

  byId("teacher-student-profile-modal-name").textContent = student.name;
  setTeacherStudentProfileModalText(
    "teacher-student-profile-modal-copy",
    `${student.track} - ${student.level} - ${student.email}`,
    "Open a student to review their full learning context."
  );
  byId("teacher-student-profile-modal-progress").textContent = String(student.completedLessons);
  byId("teacher-student-profile-modal-progress-copy").textContent = `${student.completedLessons} completed lesson${student.completedLessons === 1 ? "" : "s"}`;
  setTeacherStudentProfileModalText("teacher-student-profile-modal-track", student.track, "Track not set");
  setTeacherStudentProfileModalText("teacher-student-profile-modal-level", student.level, "Level unavailable");
  setTeacherStudentProfileModalText("teacher-student-profile-modal-timezone", student.timezone, "Timezone not added yet");
  setTeacherStudentProfileModalText(
    "teacher-student-profile-modal-upcoming",
    upcomingLesson ? formatStudentSummaryDate(upcomingLesson.date, upcomingLesson.time) : "",
    "No upcoming lessons booked"
  );
  setTeacherStudentProfileModalText("teacher-student-profile-modal-why", whyLearning, "No learning goal added yet.");
  setTeacherStudentProfileModalText("teacher-student-profile-modal-milestone", student.nextMilestone, "No milestone set yet.");
  setTeacherStudentProfileModalText("teacher-student-profile-modal-email", student.email, "No email available");
  setTeacherStudentProfileModalText(
    "teacher-student-profile-modal-occupation",
    personalization.occupation,
    "No occupation added yet"
  );
  setTeacherStudentProfileModalText(
    "teacher-student-profile-modal-weekly-focus",
    learningPlan.weekly_focus,
    "No weekly focus added yet"
  );
  setTeacherStudentProfileModalText(
    "teacher-student-profile-modal-plan-title",
    learningPlan.plan_title,
    "No plan title added yet"
  );
  setTeacherStudentProfileModalText(
    "teacher-student-profile-modal-coach-note",
    coachNote,
    "No coach note added yet."
  );
  setTeacherStudentProfileModalText(
    "teacher-student-profile-modal-interests",
    personalization.interests,
    "No interests added yet."
  );
  setTeacherStudentProfileModalText(
    "teacher-student-profile-modal-personality",
    personalization.personality_notes,
    "No personality notes added yet."
  );

  if (byId("teacher-student-profile-page-link")) {
    byId("teacher-student-profile-page-link").href = `student-profile.html?id=${encodeURIComponent(student.id)}&email=${encodeURIComponent(student.email)}`;
  }

  byId("teacher-student-profile-modal-languages").innerHTML = buildTeacherStudentProfileChipMarkup(
    student.languages,
    "No languages added yet"
  );
  byId("teacher-student-profile-modal-hobbies").innerHTML = buildTeacherStudentProfileChipMarkup(
    personalization.hobbies,
    "No hobbies added yet"
  );
  byId("teacher-student-profile-modal-focus").innerHTML = buildTeacherStudentProfileChipMarkup(
    focusAreas,
    "No focus areas yet"
  );

  byId("teacher-student-profile-modal-objectives").innerHTML = objectives.length
    ? objectives
        .map((objective) => {
          return `
            <article>
              <strong>${escapeHtml(objective)}</strong>
            </article>
          `;
        })
        .join("")
    : `
        <article>
          <strong>No objectives added yet.</strong>
          <p>Add a learning plan to surface the student's next targets.</p>
        </article>
      `;

  byId("teacher-student-profile-modal-lessons").innerHTML = lessonHistory.length
    ? lessonHistory
        .map((lesson) => {
          const topic = String(lesson.topic || "Lesson").trim() || "Lesson";
          const status = String(lesson.status || "Completed").trim() || "Completed";
          const notes = String(lesson.notes || "").trim();
          return `
            <article>
              <strong>${escapeHtml(topic)}</strong>
              <p>${escapeHtml(formatTeacherStudentHistoryDate(lesson.date))} - ${escapeHtml(status)}</p>
              ${notes ? `<span>${escapeHtml(notes)}</span>` : ""}
            </article>
          `;
        })
        .join("")
    : `
        <article>
          <strong>No lessons logged yet.</strong>
          <p>Add lesson logs to build a teaching history.</p>
        </article>
      `;

  byId("teacher-student-profile-modal-homework").innerHTML = homeworkFiles.length
    ? homeworkFiles
        .map((file) => {
          const title = String(file.title || file.file_name || "Homework").trim() || "Homework";
          const fileName = String(file.file_name || "").trim();
          const notes = String(file.notes || "").trim();
          return `
            <article>
              <strong>${escapeHtml(title)}</strong>
              ${fileName ? `<p>${escapeHtml(fileName)}</p>` : ""}
              ${notes ? `<span>${escapeHtml(notes)}</span>` : ""}
            </article>
          `;
        })
        .join("")
    : `
        <article>
          <strong>No homework uploaded yet.</strong>
          <p>Uploaded materials will appear here.</p>
        </article>
      `;
}

function openTeacherStudentProfileModal(student) {
  const layer = byId("teacher-student-profile-modal");
  if (!layer || !student) {
    return;
  }

  teacherStudentProfileModalStudentKey = getTeacherStudentInsightKey(student);
  renderTeacherStudentProfileModal(student);
  layer.hidden = false;
  document.body.classList.add("teacher-student-profile-modal-open");
}

function bindTeacherStudentProfileModal() {
  if (teacherStudentProfileModalBound) {
    return;
  }

  const trigger = byId("open-student-profile");
  const layer = byId("teacher-student-profile-modal");
  if (!trigger || !layer) {
    return;
  }

  trigger.addEventListener("click", (event) => {
    const selectedStudent = getSelectedTeacherStudent();
    if (!selectedStudent) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    openTeacherStudentProfileModal(mergeStudentWithInsights(selectedStudent));
    void loadStudentInsights(selectedStudent);
  });

  byId("teacher-student-profile-modal-close")?.addEventListener("click", () => {
    closeTeacherStudentProfileModal();
  });

  byId("teacher-student-profile-modal-backdrop")?.addEventListener("click", () => {
    closeTeacherStudentProfileModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isTeacherStudentProfileModalOpen()) {
      closeTeacherStudentProfileModal();
    }
  });

  teacherStudentProfileModalBound = true;
}

function mergeStudentWithInsights(student) {
  const cacheKey = getTeacherStudentInsightKey(student);
  const insights = cacheKey ? teacherStudentInsightsCache.get(cacheKey) : null;
  if (!insights) {
    return student;
  }

  return {
    ...student,
    learningPlan: insights.learningPlan || null,
    lessonHistory: Array.isArray(insights.lessonHistory) ? insights.lessonHistory : student.lessonHistory || [],
    homeworkFiles: Array.isArray(insights.homeworkFiles) ? insights.homeworkFiles : [],
    personalization: insights.personalization || student.personalization || null,
    goal: insights.personalization?.learning_goal || student.personalization?.learning_goal || student.goal,
    nextMilestone: student.nextMilestone || insights.learningPlan?.long_term_goal || "",
    coachNote: student.coachNote || insights.learningPlan?.teacher_notes || "",
    focusAreas:
      Array.isArray(insights.learningPlan?.objectives) && insights.learningPlan.objectives.length
        ? insights.learningPlan.objectives.slice(0, 4)
        : student.focusAreas
  };
}

async function loadStudentInsights(student) {
  if (!student?.email || !window.supabaseClient) {
    return;
  }

  try {
    const cacheKey = getTeacherStudentInsightKey(student);
    const email = normalizeEmail(student.email);

    const [planResult, lessonLogsResult, homeworkResult, personalizationResult] = await Promise.all([
      window.supabaseClient
        .from("student_learning_plans")
        .select("*")
        .eq("student_email", email)
        .maybeSingle(),
      window.supabaseClient
        .from("student_lesson_logs")
        .select("*")
        .eq("student_email", email)
        .order("lesson_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(6),
      window.supabaseClient
        .from("student_homework_files")
        .select("*")
        .eq("student_email", email)
        .order("created_at", { ascending: false })
        .limit(3),
      window.supabaseClient
        .from("student_personalization_profiles")
        .select("*")
        .eq("student_email", email)
        .maybeSingle()
    ]);

    const personalization =
      personalizationResult.error && String(personalizationResult.error.message || "").toLowerCase().includes("student_personalization_profiles")
        ? null
        : personalizationResult.data || null;

    teacherStudentInsightsCache.set(cacheKey, {
      learningPlan: planResult.error ? null : planResult.data,
      lessonHistory:
        lessonLogsResult.error || !Array.isArray(lessonLogsResult.data)
          ? []
          : lessonLogsResult.data.map((entry) => ({
              id: entry.id,
              topic: entry.topic,
              date: entry.lesson_date,
              status: entry.outcome || "Completed",
              notes: entry.teacher_notes || ""
            })),
      homeworkFiles: homeworkResult.error || !Array.isArray(homeworkResult.data) ? [] : homeworkResult.data,
      personalization
    });

    const selectedId = String(byId("student-select")?.value || "").trim();
    if (selectedId && selectedId === String(student.id || "").trim()) {
      renderSelectedStudentDetail(mergeStudentWithInsights(student));
    }
  } catch {
    return;
  }
}

function loadStudentIntoForm(studentId) {
  const student = getStudents().find((entry) => entry.id === String(studentId || "").trim()) || null;
  if (!student) {
    return;
  }

  if (isTeacherStudentProfileModalOpen() && teacherStudentProfileModalStudentKey !== getTeacherStudentInsightKey(student)) {
    closeTeacherStudentProfileModal();
  }

  if (byId("student-track")) {
    byId("student-track").value = student.track;
  }
  if (byId("student-level")) {
    byId("student-level").value = student.level;
  }
  if (byId("student-completed")) {
    byId("student-completed").value = student.completedLessons;
  }
  if (byId("student-total")) {
    byId("student-total").value = student.totalLessons;
  }
  if (byId("student-streak")) {
    byId("student-streak").value = student.streak;
  }
  if (byId("student-milestone")) {
    byId("student-milestone").value = student.nextMilestone;
  }
  if (byId("student-focus")) {
    byId("student-focus").value = student.focusAreas.join(", ");
  }
  if (byId("student-note")) {
    byId("student-note").value = student.coachNote;
  }

  renderSelectedStudentDetail(mergeStudentWithInsights(student));
  void loadStudentInsights(student);
}

function setTeacherStudentChatFeedback(message, type) {
  const feedback = byId("student-detail-chat-feedback");
  if (!feedback) {
    return;
  }

  if (!hasText(String(message || ""))) {
    feedback.hidden = true;
    feedback.textContent = "";
    return;
  }

  feedback.textContent = String(message || "");
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function setTeacherStudentChatTriggerState(disabled, student) {
  const trigger = byId("open-student-chat");
  if (!trigger) {
    return;
  }

  const studentId = String(student?.id || "").trim();
  const studentName = String(student?.name || student?.full_name || "Student").trim() || "Student";
  const canMessage = !disabled && looksLikeAuthUserId(studentId);

  trigger.disabled = !canMessage;
  trigger.classList.toggle("is-disabled", !canMessage);
  trigger.dataset.studentId = canMessage ? studentId : "";
  trigger.dataset.studentName = canMessage ? studentName : "";
  trigger.textContent = "Message student";
}

async function openTeacherStudentConversation(studentId, triggerButton) {
  const normalizedStudentId = String(studentId || "").trim();
  if (!looksLikeAuthUserId(normalizedStudentId)) {
    setTeacherStudentChatFeedback("This student needs an active portal account before chat is available.", "error");
    return;
  }

  const accessToken = await getTeacherAccessToken();
  if (!accessToken) {
    setTeacherStudentChatFeedback("Your session expired. Sign in again to open chat.", "error");
    return;
  }

  const button = triggerButton || null;
  const originalLabel = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.classList.remove("is-disabled");
    button.textContent = "Opening...";
  }

  setTeacherStudentChatFeedback("", "success");

  try {
    const response = await fetch(`${getTeacherApiBaseUrl()}/api/messages/conversations/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        otherUserId: normalizedStudentId
      })
    });

    const payload = await response.json().catch(() => ({
      ok: false,
      error: `Failed to open chat (${response.status}).`
    }));

    if (!response.ok || payload?.ok !== true || !payload?.conversation?.id) {
      throw new Error(String(payload?.error || payload?.message || `Failed to open chat (${response.status}).`));
    }

    window.location.href = `messages.html?conversation=${encodeURIComponent(String(payload.conversation.id))}`;
  } catch (error) {
    setTeacherStudentChatFeedback(error instanceof Error ? error.message : "Could not open chat right now.", "error");
    if (button) {
      button.disabled = false;
      button.classList.remove("is-disabled");
      button.textContent = originalLabel || "Message student";
    }
    return;
  }
}

function bindTeacherStudentChatLaunch() {
  const trigger = byId("open-student-chat");
  if (!trigger || trigger.dataset.chatBound === "1") {
    return;
  }

  trigger.dataset.chatBound = "1";
  trigger.addEventListener("click", () => {
    void openTeacherStudentConversation(trigger.dataset.studentId, trigger);
  });
}

function renderSelectedStudentDetail(student) {
  if (!byId("student-detail-name")) {
    return;
  }

  if (!student) {
    closeTeacherStudentProfileModal();
    byId("student-detail-name").textContent = "Select a student";
    byId("student-detail-track").textContent = "Choose a roster entry to load details.";
    byId("student-detail-level").textContent = "No student selected";
    byId("student-detail-progress").textContent = "0";
    byId("student-detail-progress-copy").textContent = "0 completed lessons";
    byId("student-detail-milestone").textContent = "No milestone loaded.";
    byId("student-detail-focus").innerHTML = '<span class="focus-chip">No focus areas yet</span>';
    setTeacherStudentProfileTriggerState(true);
    setTeacherStudentChatTriggerState(true, null);
    setTeacherStudentChatFeedback("", "success");
    if (byId("open-student-profile")) {
      byId("open-student-profile").href = "student-profile.html";
    }
    return;
  }

  byId("student-detail-name").textContent = student.name;
  byId("student-detail-track").textContent = `${student.track} - ${student.email}`;
  byId("student-detail-level").textContent = student.level;
  byId("student-detail-level").className = "status-pill";
  byId("student-detail-progress").textContent = String(student.completedLessons);
  byId("student-detail-progress-copy").textContent = `${student.completedLessons} completed lesson${student.completedLessons === 1 ? "" : "s"}`;
  byId("student-detail-milestone").textContent = student.nextMilestone || "No milestone set yet.";
  byId("student-detail-focus").innerHTML = (student.focusAreas && student.focusAreas.length
    ? student.focusAreas
    : ["No focus areas yet"])
    .map((area) => `<span class="focus-chip">${area}</span>`)
    .join("");
  setTeacherStudentProfileTriggerState(false);
  setTeacherStudentChatTriggerState(false, student);
  setTeacherStudentChatFeedback("", "success");
  if (byId("student-personal-learning-goal")) {
    byId("student-personal-learning-goal").value = (student.personalization || {}).learning_goal || "";
  }
  if (byId("student-personal-occupation")) {
    byId("student-personal-occupation").value = (student.personalization || {}).occupation || "";
  }
  if (byId("student-personal-hobbies")) {
    byId("student-personal-hobbies").value = (student.personalization || {}).hobbies || "";
  }
  if (byId("student-personal-interests")) {
    byId("student-personal-interests").value = (student.personalization || {}).interests || "";
  }
  if (byId("student-personal-personality")) {
    byId("student-personal-personality").value = (student.personalization || {}).personality_notes || "";
  }
  if (byId("open-student-profile")) {
    byId("open-student-profile").href = `student-profile.html?id=${encodeURIComponent(student.id)}&email=${encodeURIComponent(student.email)}`;
  }
  if (isTeacherStudentProfileModalOpen() && teacherStudentProfileModalStudentKey === getTeacherStudentInsightKey(student)) {
    renderTeacherStudentProfileModal(student);
  }
}

function setStudentPersonalizationFeedback(message, type) {
  const feedback = byId("student-personalization-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function setStudentGroupFeedback(message, type) {
  const feedback = byId("student-group-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function clearStudentGroupFeedback() {
  const feedback = byId("student-group-feedback");
  if (!feedback) {
    return;
  }

  feedback.hidden = true;
  feedback.textContent = "";
}

function renderGroupManager() {
  const filterSelect = byId("student-group-filter");
  const assignSelect = byId("student-assign-group");
  const listContainer = byId("student-group-list");

  if (!filterSelect || !assignSelect || !listContainer) {
    return;
  }

  const groups = getStudentGroups();
  const previousFilter = filterSelect.value || "";
  const previousAssign = assignSelect.value || "";

  filterSelect.innerHTML = [
    '<option value="">All groups</option>',
    ...groups.map((group) => `<option value="${group.id}">${group.name}</option>`)
  ].join("");

  assignSelect.innerHTML = [
    '<option value="">Select a group...</option>',
    ...groups.map((group) => `<option value="${group.id}">${group.name}</option>`)
  ].join("");

  if (groups.some((group) => group.id === previousFilter)) {
    filterSelect.value = previousFilter;
  }
  if (groups.some((group) => group.id === previousAssign)) {
    assignSelect.value = previousAssign;
  }

  if (!groups.length) {
    listContainer.innerHTML = '<p class="empty-copy">No groups created yet.</p>';
    return;
  }

  listContainer.innerHTML = groups
    .map((group) => {
      return `
        <article class="list-card group-list-card">
          <div>
            <strong>${group.name}</strong>
            <p class="group-list-count">${group.studentCount} student${group.studentCount === 1 ? "" : "s"}</p>
          </div>
          <button class="list-action danger student-group-delete" type="button" data-group-id="${group.id}">
            Delete
          </button>
        </article>
      `;
    })
    .join("");

  listContainer.querySelectorAll(".student-group-delete").forEach((button) => {
    button.addEventListener("click", () => {
      if (!window.HWFData || typeof window.HWFData.deleteStudentGroup !== "function") {
        return;
      }

      const result = window.HWFData.deleteStudentGroup(button.dataset.groupId);
      if (!result.ok) {
        setStudentGroupFeedback(result.error || "Could not delete group.", "error");
        return;
      }

      setStudentGroupFeedback("Group deleted.", "success");
      renderAdminDashboard();
    });
  });
}

function renderRoster() {
  const container = byId("student-roster");
  const filterInput = byId("student-roster-filter");
  const groupFilterSelect = byId("student-group-filter");
  const countLabel = byId("student-roster-count");

  if (!container) {
    return;
  }

  const students = getStudents();
  const query = filterInput ? filterInput.value.trim().toLowerCase() : "";
  const groupFilterId = groupFilterSelect ? String(groupFilterSelect.value || "") : "";
  const filteredStudents = query
    ? students.filter((student) => {
        const groupNames = getGroupsForStudent(student.id).map((group) => group.name).join(" ");
        const searchable = [
          student.name,
          student.email,
          student.track,
          student.level,
          groupNames
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        return searchable.includes(query);
      })
    : students;

  const groupFilteredStudents = groupFilterId
    ? filteredStudents.filter((student) => {
        return getGroupsForStudent(student.id).some((group) => group.id === groupFilterId);
      })
    : filteredStudents;

  if (countLabel) {
    countLabel.textContent = `${groupFilteredStudents.length} of ${students.length} shown`;
  }

  if (!students.length) {
    container.innerHTML = '<p class="empty-copy">No students are registered yet.</p>';
    return;
  }

  if (!groupFilteredStudents.length) {
    container.innerHTML = '<p class="empty-copy">No students match your search.</p>';
    return;
  }

  container.innerHTML = groupFilteredStudents
    .map((student) => {
      const selectedId = byId("student-select") ? byId("student-select").value : "";
      const studentGroups = getGroupsForStudent(student.id);
      const groupBadges = studentGroups.length
        ? `<div class="roster-group-chips">${studentGroups
            .map((group) => `<span class="roster-group-chip">${group.name}</span>`)
            .join("")}</div>`
        : "";
      return `
        <button class="list-card roster-card-button ${selectedId === student.id ? "active" : ""}" type="button" data-student-id="${student.id}">
          <div class="list-card-top">
            <strong>${student.name}</strong>
            <span class="status-pill">${student.level}</span>
          </div>
          <p>${student.track}</p>
          ${groupBadges}
          <div class="progress-wrap compact-progress">
            <div class="progress-copy">
              <span>Completed</span>
              <strong>${student.completedLessons}</strong>
            </div>
          </div>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll(".roster-card-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (byId("student-select")) {
        byId("student-select").value = button.dataset.studentId;
      }
      loadStudentIntoForm(button.dataset.studentId);
      renderRoster();
    });
  });
}

function renderAdminDashboard() {
  clearDashboardActionError();
  const students = getStudents();
  const select = byId("student-select");
  const currentStudentId = select && students.length ? (select.value || students[0].id) : "";

  ensureFocusedDate();
  renderTeacherHome();
  renderAdminStats();
  renderWeekCalendar();
  renderBookings();
  renderStudentSelect();
  renderGroupManager();
  renderRoster();
  renderTeacherWalletOverview();
  renderTeacherSettingsPage();

  if (currentStudentId) {
    loadStudentIntoForm(currentStudentId);
  } else {
    renderSelectedStudentDetail(null);
  }

  bindDashboardShortcuts();
  setTeacherPortalTab(currentTeacherPortalTab);
}

function bindTeacherAuth() {
  const button = byId("admin-login");
  const forgotButton = byId("admin-forgot-password");

  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    const email = byId("admin-email").value.trim().toLowerCase();
    const password = byId("admin-password").value;

    clearTeacherError();
    clearTeacherLoginFeedback();

    if (!email || !password) {
      showTeacherError("Enter your teacher email and password.");
      return;
    }

    const { error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      showTeacherError(error.message);
      return;
    }

    window.location.href = getTeacherLoginNextTarget();
  });

  if (forgotButton) {
    forgotButton.addEventListener("click", async () => {
      const email = byId("admin-email").value.trim().toLowerCase();
      clearTeacherError();
      clearTeacherLoginFeedback();

      if (!email) {
        setTeacherLoginFeedback("Enter your email first, then click Forgot password.", "error");
        return;
      }

      if (!window.supabaseClient) {
        setTeacherLoginFeedback("Password reset is not configured yet.", "error");
        return;
      }

      forgotButton.disabled = true;
      setTeacherLoginFeedback("Sending reset email...", "success");

      try {
        const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: getPasswordResetRedirect()
        });

        if (error) {
          setTeacherLoginFeedback(error.message, "error");
          return;
        }

        setTeacherLoginFeedback("Password reset email sent. Check your inbox and open the link to set a new password.", "success");
      } catch {
        setTeacherLoginFeedback("Could not send reset email right now. Please try again.", "error");
      } finally {
        forgotButton.disabled = false;
      }
    });
  }
}

function setTeacherInterestFeedback(message, type) {
  const feedback = byId("teacher-interest-feedback");

  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function bindTeacherInterestForm() {
  const form = byId("teacher-interest-form");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = byId("teacher-interest-name").value.trim();
    const email = byId("teacher-interest-email").value.trim();
    const message = byId("teacher-interest-message").value.trim();

    if (!name || !email || !message) {
      setTeacherInterestFeedback("Please complete your name, email, and message.", "error");
      return;
    }

    try {
      await window.HWFEmailApi.sendTeacherInterestEmail({
        name,
        email,
        message
      });
      form.reset();
      setTeacherInterestFeedback("Your message was sent. We will review it and get back to you.", "success");
    } catch {
      setTeacherInterestFeedback("Your message could not be sent yet. Please try again shortly.", "error");
    }
  });
}

function bindCalendarControls() {
  const previousWeekButton = byId("calendar-prev");
  const nextWeekButton = byId("calendar-next");
  const previousMonthButton = byId("focus-prev");
  const nextMonthButton = byId("focus-next");

  if (previousWeekButton) {
    previousWeekButton.addEventListener("click", () => {
      currentWeekStart = addDays(currentWeekStart, -7);
      renderWeekCalendar();
    });
  }

  if (nextWeekButton) {
    nextWeekButton.addEventListener("click", () => {
      currentWeekStart = addDays(currentWeekStart, 7);
      renderWeekCalendar();
    });
  }

  if (previousMonthButton) {
    previousMonthButton.addEventListener("click", () => {
      focusMonth = shiftMonth(focusMonth, -1);
      syncFocusedDateToFocusMonth();
      renderFocusDateGrid();
      renderFocusHoursGrid();
    });
  }

  if (nextMonthButton) {
    nextMonthButton.addEventListener("click", () => {
      focusMonth = shiftMonth(focusMonth, 1);
      syncFocusedDateToFocusMonth();
      renderFocusDateGrid();
      renderFocusHoursGrid();
    });
  }
}

function bindViewSwitcher() {
  const buttons = document.querySelectorAll(".view-switch-btn");

  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      renderViewSwitcher();
    });
  });
}

function syncBulkRangeToVisibleWeek(force = false) {
  const dateFromInput = byId("bulk-date-from");
  const dateToInput = byId("bulk-date-to");

  if (!dateFromInput || !dateToInput) {
    return;
  }

  if (!force && dateFromInput.value && dateToInput.value) {
    return;
  }

  dateFromInput.value = toIsoDate(currentWeekStart);
  dateToInput.value = toIsoDate(addDays(currentWeekStart, 6));
}

function buildBulkSlots() {
  const dateFrom = byId("bulk-date-from").value;
  const dateTo = byId("bulk-date-to").value;
  const startTime = byId("bulk-time-start").value;
  const endTime = byId("bulk-time-end").value;
  const selectedWeekdays = [...document.querySelectorAll("#bulk-weekday-row input:checked")].map((input) => Number(input.value));

  if (!dateFrom || !dateTo || !startTime || !endTime) {
    return { ok: false, error: "Choose a full date and time range first." };
  }

  if (dateTo < dateFrom) {
    return { ok: false, error: "The end date must be after the start date." };
  }

  if (endTime < startTime) {
    return { ok: false, error: "The end time must be after the start time." };
  }

  if (!selectedWeekdays.length) {
    return { ok: false, error: "Select at least one weekday." };
  }

  const availableTimeSlots = getTimeSlots();
  if (!availableTimeSlots.includes(startTime) || !availableTimeSlots.includes(endTime)) {
    return { ok: false, error: "Choose times in 30-minute steps within the planner range." };
  }

  const slots = [];
  const current = toDateFromIso(dateFrom);
  const finalDate = toDateFromIso(dateTo);
  const timeSlots = availableTimeSlots.filter((time) => time >= startTime && time <= endTime);

  if (!timeSlots.length) {
    return { ok: false, error: "No 30-minute slots match that time range." };
  }

  while (current <= finalDate) {
    const weekday = current.getDay();
    const date = toIsoDate(current);

    if (selectedWeekdays.includes(weekday)) {
      timeSlots.forEach((time) => {
        slots.push({ date, time });
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return { ok: true, slots };
}

function bindBulkControls() {
  if (!byId("bulk-preset-weekdays") || !byId("bulk-add")) {
    return;
  }

  byId("bulk-use-visible-week")?.addEventListener("click", () => {
    syncBulkRangeToVisibleWeek(true);
  });

  byId("bulk-preset-weekdays").addEventListener("click", () => {
    byId("bulk-time-start").value = "08:00";
    byId("bulk-time-end").value = "17:00";
    document.querySelectorAll("#bulk-weekday-row input").forEach((input) => {
      input.checked = ["1", "2", "3", "4", "5"].includes(input.value);
    });
  });

  byId("bulk-add").addEventListener("click", async () => {
    if (!(await ensureFreshBookingsForAvailabilityUpdate())) {
      setDashboardActionError("Could not verify reserved lessons from server. Refresh and try again.");
      return;
    }

    const result = buildBulkSlots();

    if (!result.ok) {
      setDashboardActionError(result.error);
      return;
    }

    const bulkResult = window.HWFData.addAvailabilitySlots(result.slots);

    if (!bulkResult.ok) {
      setDashboardActionError(bulkResult.error);
      return;
    }

    renderAdminDashboard();
    setDashboardActionSuccess(`Added ${bulkResult.added} slots${bulkResult.skipped ? `, skipped ${bulkResult.skipped}` : ""}.`);
  });
}

function bindStudentEditor() {
  if (!byId("student-select")) {
    return;
  }

  const filterInput = byId("student-roster-filter");
  if (filterInput) {
    filterInput.addEventListener("input", () => {
      renderRoster();
    });
  }

  const groupFilterSelect = byId("student-group-filter");
  if (groupFilterSelect) {
    groupFilterSelect.addEventListener("change", () => {
      renderRoster();
    });
  }

  const createGroupButton = byId("create-student-group");
  if (createGroupButton) {
    createGroupButton.addEventListener("click", () => {
      clearStudentGroupFeedback();

      if (!window.HWFData || typeof window.HWFData.createStudentGroup !== "function") {
        setStudentGroupFeedback("Group management is not available.", "error");
        return;
      }

      const input = byId("new-student-group");
      const groupName = input ? input.value.trim() : "";
      const result = window.HWFData.createStudentGroup(groupName);

      if (!result.ok) {
        setStudentGroupFeedback(result.error || "Could not create group.", "error");
        return;
      }

      if (input) {
        input.value = "";
      }
      setStudentGroupFeedback(`Group "${result.group.name}" created.`, "success");
      renderAdminDashboard();
    });
  }

  const assignButton = byId("assign-student-group");
  if (assignButton) {
    assignButton.addEventListener("click", () => {
      clearStudentGroupFeedback();

      if (!window.HWFData || typeof window.HWFData.assignStudentToGroup !== "function") {
        setStudentGroupFeedback("Group management is not available.", "error");
        return;
      }

      const studentId = byId("student-select").value;
      const groupId = byId("student-assign-group") ? byId("student-assign-group").value : "";
      const result = window.HWFData.assignStudentToGroup(studentId, groupId);

      if (!result.ok) {
        setStudentGroupFeedback(result.error || "Could not assign student to group.", "error");
        return;
      }

      setStudentGroupFeedback(
        result.alreadyAssigned ? "Student is already in this group." : "Student assigned to group.",
        "success"
      );
      renderAdminDashboard();
    });
  }

  const unassignButton = byId("unassign-student-group");
  if (unassignButton) {
    unassignButton.addEventListener("click", () => {
      clearStudentGroupFeedback();

      if (!window.HWFData || typeof window.HWFData.removeStudentFromGroup !== "function") {
        setStudentGroupFeedback("Group management is not available.", "error");
        return;
      }

      const studentId = byId("student-select").value;
      const groupId = byId("student-assign-group") ? byId("student-assign-group").value : "";
      const result = window.HWFData.removeStudentFromGroup(studentId, groupId);

      if (!result.ok) {
        setStudentGroupFeedback(result.error || "Could not unassign student from group.", "error");
        return;
      }

      setStudentGroupFeedback(result.removed ? "Student removed from group." : "Student was not in this group.", "success");
      renderAdminDashboard();
    });
  }

  byId("student-select").addEventListener("change", (event) => {
    clearStudentGroupFeedback();
    loadStudentIntoForm(event.target.value);
  });

  const personalizationButton = byId("save-student-personalization");
  if (personalizationButton && !teacherStudentPersonalizationBound) {
    personalizationButton.addEventListener("click", async () => {
      const selectedStudent = getStudents().find((entry) => entry.id === String(byId("student-select")?.value || "").trim()) || null;
      if (!selectedStudent) {
        setStudentPersonalizationFeedback("Select a student first.", "error");
        return;
      }

      personalizationButton.disabled = true;
      try {
        const payload = {
          student_email: normalizeEmail(selectedStudent.email),
          student_id: String(selectedStudent.id || "").trim() || null,
          learning_goal: String(byId("student-personal-learning-goal")?.value || "").trim() || null,
          occupation: String(byId("student-personal-occupation")?.value || "").trim() || null,
          hobbies: String(byId("student-personal-hobbies")?.value || "").trim() || null,
          interests: String(byId("student-personal-interests")?.value || "").trim() || null,
          personality_notes: String(byId("student-personal-personality")?.value || "").trim() || null,
          updated_by: currentTeacherUser?.id || null
        };

        const { error } = await window.supabaseClient
          .from("student_personalization_profiles")
          .upsert(payload, { onConflict: "student_email" });

        if (error) {
          const lowered = String(error.message || "").toLowerCase();
          if (lowered.includes("student_personalization_profiles")) {
            setStudentPersonalizationFeedback(
              "Personalization table is missing. Run supabase/teacher_student_personalization_setup.sql first.",
              "error"
            );
            return;
          }

          setStudentPersonalizationFeedback(error.message || "Could not save student personalization.", "error");
          return;
        }

        teacherStudentInsightsCache.set(getTeacherStudentInsightKey(selectedStudent), {
          ...(teacherStudentInsightsCache.get(getTeacherStudentInsightKey(selectedStudent)) || {}),
          personalization: payload
        });
        renderSelectedStudentDetail(mergeStudentWithInsights(selectedStudent));
        setStudentPersonalizationFeedback("Student personalization saved.", "success");
      } finally {
        personalizationButton.disabled = false;
      }
    });

    teacherStudentPersonalizationBound = true;
  }
}

function bindTeacherLogout() {
  const button = byId("teacher-logout");

  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    currentTeacherUser = null;
    currentTeacherRole = "";
    teacherMeetingConfigured = false;
    teacherMeetingDynamicPerBooking = false;
    teacherMeetingJoinLink = "";
    teacherCalendarViewportInitialized = false;
    stopTeacherLiveSync();
    if (teacherMeetingTickerId) {
      window.clearInterval(teacherMeetingTickerId);
      teacherMeetingTickerId = 0;
    }
    if (window.supabaseClient) {
      await window.supabaseClient.auth.signOut();
    }
    window.location.href = "teacher-login.html";
  });
}

async function initAdminPortal() {
  window.HWFData.ensurePortalState();
  clearLocalStudentCache();
  startTeacherMeetingTicker();
  prepareTeacherTopbarButtons();
  ensureTeacherProfileDrawerMarkup();
  bindTeacherProfileEditor();
  bindTeacherAuth();
  bindTeacherInterestForm();
  bindTeacherPortalTabs();
  bindDashboardShortcuts();
  bindTeacherSidebarToggle();
  bindTeacherProfileDrawer();
  bindTeacherSettingsPage();
  bindCalendarControls();
  bindViewSwitcher();
  bindBulkControls();
  bindStudentEditor();
  bindTeacherStudentChatLaunch();
  bindTeacherStudentProfileModal();
  bindTeacherLogout();

  await openTeacherDashboardFromSession();
}

window.HWFTeacherPortal = {
  getCurrentTeacherUser: () => currentTeacherUser,
  getTeacherRole: () => currentTeacherRole,
  getTeacherAccessToken,
  getStudents,
  refreshTeacherStudents: syncStudentsFromServerProfiles
};

initAdminPortal();
