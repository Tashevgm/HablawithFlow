const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 20;
const CALENDAR_STEP_MINUTES = 60;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const IS_TEACHER_LOGIN_PAGE = window.location.pathname.endsWith("/teacher-login.html") || window.location.pathname.endsWith("teacher-login.html");
const IS_TEACHER_CALENDAR_PAGE = window.location.pathname.endsWith("/admin.html") || window.location.pathname.endsWith("admin.html");
const IS_TEACHER_STUDENTS_PAGE = window.location.pathname.endsWith("/teacher-students.html") || window.location.pathname.endsWith("teacher-students.html");
const TEACHER_ROLES = new Set(["teacher", "admin"]);

let currentWeekStart = getStartOfWeek(new Date());
let currentView = "week";
let focusMonth = new Date();
let focusedDate = "";
window.HWFServerBookings = window.HWFServerBookings || [];

function getPasswordResetRedirect() {
  return `${window.location.origin}/set-password.html`;
}

function byId(id) {
  return document.getElementById(id);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function buildTeacherLoginUrl() {
  const currentPath = window.location.pathname.split("/").pop() || "admin.html";
  const targetPath = currentPath === "teacher-login.html" ? "admin.html" : currentPath;
  return `teacher-login.html?next=${encodeURIComponent(targetPath)}`;
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

function getStudents() {
  return window.HWFData.listStudents();
}

function formatStudentSummaryDate(date, time) {
  if (!date || !time) {
    return "No date set";
  }

  return `${formatPortalDate(date, time)} at ${time}`;
}

function getOpenSlot(date, time) {
  return getAvailability().find((slot) => slot.date === date && slot.time === time) || null;
}

function getBooking(date, time) {
  return getBookings().find((entry) => entry.date === date && entry.time === time) || null;
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

function ensureFocusedDate() {
  const focusableDates = getFocusableDates();

  if (!focusableDates.length) {
    if (!focusedDate) {
      focusedDate = toIsoDate(new Date());
    }

    if (!(focusMonth instanceof Date) || Number.isNaN(focusMonth.getTime())) {
      focusMonth = new Date();
    }

    return;
  }

  if (!focusedDate || !focusableDates.includes(focusedDate)) {
    focusedDate = focusableDates[0];
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
  const { data, error } = await window.supabaseClient
    .from("bookings")
    .select("*")
    .order("lesson_date", { ascending: true })
    .order("lesson_time", { ascending: true });

  if (error) {
    window.HWFServerBookings = [];
    return false;
  }

  window.HWFServerBookings = Array.isArray(data) ? data : [];
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

async function syncStudentsFromServerProfiles() {
  if (
    !window.HWFData ||
    typeof window.HWFData.ensureStudentFromProfile !== "function" ||
    typeof window.HWFData.pruneStudentsByEmails !== "function"
  ) {
    return false;
  }

  const serverStudents = await fetchTeacherStudentsFromServer();
  if (!Array.isArray(serverStudents)) {
    return false;
  }

  const activeEmails = [];
  serverStudents.forEach((student) => {
    const email = normalizeEmail(student.email);
    if (!email) {
      return;
    }

    window.HWFData.ensureStudentFromProfile({
      ...student,
      name: student.name || student.full_name || email.split("@")[0],
      full_name: student.full_name || student.name || email.split("@")[0],
      email
    });
    activeEmails.push(email);
  });

  window.HWFData.pruneStudentsByEmails(activeEmails);
  return true;
}

function setDashboardActionError(message) {
  const error = byId("slot-error");
  if (!error) {
    return;
  }

  error.textContent = message;
  error.hidden = false;
}

function clearDashboardActionError() {
  const error = byId("slot-error");
  if (!error) {
    return;
  }

  error.textContent = "";
  error.hidden = true;
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

  await loadServerBookings();
  await syncStudentsFromServerProfiles();
  renderAdminDashboard();
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
    if (IS_TEACHER_CALENDAR_PAGE || IS_TEACHER_STUDENTS_PAGE) {
      redirectToTeacherLogin();
    }
    return false;
  }

  const roleResult = await getTeacherRoleForUser(user.id);
  if (!roleResult.ok) {
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

  clearTeacherError();
  await showTeacherDashboard();
  return true;
}

function toggleSlot(date, time) {
  const error = byId("slot-error");
  const booking = getBooking(date, time);

  if (booking) {
    if (error) {
      error.textContent = "That time is already booked.";
      error.hidden = false;
    }
    return;
  }

  const openSlot = getOpenSlot(date, time);

  if (openSlot) {
    window.HWFData.removeAvailabilitySlot(openSlot.id);
    if (error) {
      error.hidden = true;
    }
    renderAdminDashboard();
    return;
  }

  const result = window.HWFData.addAvailabilitySlot({ date, time });
  if (!result.ok) {
    if (error) {
      error.textContent = result.error;
      error.hidden = false;
    }
    return;
  }

  if (error) {
    error.hidden = true;
  }
  renderAdminDashboard();
}

function renderAdminStats() {
  const students = getStudents();
  const averageProgress = students.length
    ? Math.round(
        students.reduce((sum, student) => {
          const total = Math.max(Number(student.totalLessons) || 0, 1);
          return sum + Math.round(((Number(student.completedLessons) || 0) / total) * 100);
        }, 0) / students.length
      )
    : 0;
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

  if (byId("stat-average-progress")) {
    byId("stat-average-progress").textContent = `${averageProgress}%`;
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
        cell.classList.add("booked");
        cell.disabled = true;
        cell.innerHTML = `
          <span class="calendar-cell-label">Booked</span>
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
      toggleSlot(cell.dataset.date, cell.dataset.time);
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

  const openDates = new Set(getOpenDates());
  const bookedDates = new Set(getBookings().map((booking) => booking.date));
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
    const bookedCount = getBookings().filter((booking) => booking.date === date).length;
    const isSelected = date === focusedDate;

    let statusClass = "closed";
    let caption = "No slots";

    if (bookedDates.has(date)) {
      statusClass = openDates.has(date) ? "mixed" : "booked";
      caption = bookedCount > 0 && openCount > 0
        ? `${openCount} open / ${bookedCount} booked`
        : `${bookedCount} booked`;
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
        return `
          <button class="focus-hour-chip booked" type="button" disabled>
            <strong>${time}</strong>
            <span>${booking.studentName}</span>
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
      toggleSlot(focusedDate, button.dataset.time);
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
      const paymentNote = statusMeta.value === "payment_submitted"
        ? '<p class="list-card-note">Student completed checkout. Verify the payment, then mark this lesson as paid.</p>'
        : statusMeta.canMarkPaid
          ? '<p class="list-card-note warning">Students can cancel only after you mark this lesson as paid.</p>'
          : statusMeta.value === "cancelled_paid"
          ? '<p class="list-card-note warning">Cancelled by the student. Payment remains retained.</p>'
          : "";
      return `
        <article class="list-card">
          <div class="list-card-top">
            <strong>${booking.studentName}</strong>
            <span class="status-pill ${statusMeta.tone}">${statusMeta.label}</span>
          </div>
          <p>${formatPortalDate(booking.date, booking.time)} at ${booking.time} - ${booking.lessonType}</p>
          <span>${booking.email}</span>
          <p class="list-card-note">${booking.message || "No booking note added."}</p>
          ${paymentNote}
            ${
              statusMeta.canMarkPaid
                ? `<div class="list-card-actions">
                  <button class="list-action pay booking-mark-paid" type="button" data-booking-id="${booking.id}">
                    ${statusMeta.value === "payment_submitted" ? "Confirm Paid" : "Mark Paid"}
                  </button>
                </div>`
                : ""
            }
        </article>
      `;
    })
    .join("");

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

function loadStudentIntoForm(studentId) {
  if (!byId("student-track")) {
    return;
  }

  const student = window.HWFData.getStudentById(studentId);
  if (!student) {
    return;
  }

  byId("student-track").value = student.track;
  byId("student-level").value = student.level;
  byId("student-completed").value = student.completedLessons;
  byId("student-total").value = student.totalLessons;
  byId("student-streak").value = student.streak;
  byId("student-milestone").value = student.nextMilestone;
  byId("student-focus").value = student.focusAreas.join(", ");
  byId("student-note").value = student.coachNote;
  renderSelectedStudentDetail(student);
}

function renderSelectedStudentDetail(student) {
  if (!byId("student-detail-name")) {
    return;
  }

  if (!student) {
    byId("student-detail-name").textContent = "Select a student";
    byId("student-detail-track").textContent = "Choose a roster entry to load details.";
    byId("student-detail-level").textContent = "No student selected";
    byId("student-detail-progress").textContent = "0%";
    byId("student-detail-progress-copy").textContent = "0 of 0 lessons completed";
    byId("student-detail-streak").textContent = "0";
    byId("student-detail-streak-copy").textContent = "No active learning streak yet.";
    byId("student-detail-milestone").textContent = "No milestone loaded.";
    byId("student-detail-focus").innerHTML = '<span class="focus-chip">No focus areas yet</span>';
    byId("student-detail-upcoming").innerHTML = '<p class="empty-copy">No upcoming lessons loaded.</p>';
    byId("student-detail-history").innerHTML = '<p class="empty-copy">No lesson history loaded.</p>';
    byId("student-detail-note").textContent = "No note loaded.";
    if (byId("open-student-profile")) {
      byId("open-student-profile").href = "student-profile.html";
    }
    return;
  }

  const progressPercent = Math.round((student.completedLessons / Math.max(student.totalLessons, 1)) * 100);
  const nextLesson = student.upcomingLessons && student.upcomingLessons.length ? student.upcomingLessons[0] : null;

  byId("student-detail-name").textContent = student.name;
  byId("student-detail-track").textContent = `${student.track} - ${student.email}`;
  byId("student-detail-level").textContent = student.level;
  byId("student-detail-level").className = "status-pill";
  byId("student-detail-progress").textContent = `${progressPercent}%`;
  byId("student-detail-progress-copy").textContent = `${student.completedLessons} of ${student.totalLessons} lessons completed`;
  byId("student-detail-streak").textContent = String(student.streak);
  byId("student-detail-streak-copy").textContent = student.streak
    ? `${student.streak} consecutive study sessions recorded.`
    : "No active learning streak yet.";
  byId("student-detail-milestone").textContent = student.nextMilestone || "No milestone set yet.";
  byId("student-detail-focus").innerHTML = (student.focusAreas && student.focusAreas.length
    ? student.focusAreas
    : ["No focus areas yet"])
    .map((area) => `<span class="focus-chip">${area}</span>`)
    .join("");
  byId("student-detail-upcoming").innerHTML = nextLesson
    ? student.upcomingLessons
        .map((lesson) => {
          return `
            <article class="list-card">
              <strong>${lesson.topic || student.track}</strong>
              <p>${formatStudentSummaryDate(lesson.date, lesson.time)}</p>
            </article>
          `;
        })
        .join("")
    : '<p class="empty-copy">No upcoming lessons booked.</p>';
  byId("student-detail-history").innerHTML = student.lessonHistory && student.lessonHistory.length
    ? student.lessonHistory
        .map((lesson) => {
          return `
            <article class="list-card">
              <strong>${lesson.topic || "Lesson"}</strong>
              <p>${lesson.date ? new Date(`${lesson.date}T00:00:00`).toLocaleDateString("en-GB", {
                month: "short",
                day: "numeric",
                year: "numeric"
              }) : "Date not recorded"}</p>
              <span>${lesson.status || "Completed"}</span>
            </article>
          `;
        })
        .join("")
    : '<p class="empty-copy">No lesson history recorded yet.</p>';
  byId("student-detail-note").textContent = student.coachNote || "No coaching note recorded yet.";
  if (byId("open-student-profile")) {
    byId("open-student-profile").href = `student-profile.html?id=${encodeURIComponent(student.id)}&email=${encodeURIComponent(student.email)}`;
  }
}

function renderRoster() {
  const container = byId("student-roster");
  const filterInput = byId("student-roster-filter");
  const countLabel = byId("student-roster-count");

  if (!container) {
    return;
  }

  const students = getStudents();
  const query = filterInput ? filterInput.value.trim().toLowerCase() : "";
  const filteredStudents = query
    ? students.filter((student) => {
        const searchable = [
          student.name,
          student.email,
          student.track,
          student.level
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        return searchable.includes(query);
      })
    : students;

  if (countLabel) {
    countLabel.textContent = `${filteredStudents.length} of ${students.length} shown`;
  }

  if (!students.length) {
    container.innerHTML = '<p class="empty-copy">No students are registered yet.</p>';
    return;
  }

  if (!filteredStudents.length) {
    container.innerHTML = '<p class="empty-copy">No students match your search.</p>';
    return;
  }

  container.innerHTML = filteredStudents
    .map((student) => {
      const percent = Math.round((student.completedLessons / Math.max(student.totalLessons, 1)) * 100);
      const selectedId = byId("student-select") ? byId("student-select").value : "";
      return `
        <button class="list-card roster-card-button ${selectedId === student.id ? "active" : ""}" type="button" data-student-id="${student.id}">
          <div class="list-card-top">
            <strong>${student.name}</strong>
            <span class="status-pill">${student.level}</span>
          </div>
          <p>${student.track}</p>
          <div class="progress-wrap compact-progress">
            <div class="progress-copy">
              <span>Progress</span>
              <strong>${percent}%</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${percent}%"></div>
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
  renderAdminStats();
  renderViewSwitcher();
  renderWeekCalendar();
  renderFocusDateGrid();
  renderFocusHoursGrid();
  renderBulkDefaults();
  renderBookings();
  renderStudentSelect();
  renderRoster();

  if (currentStudentId) {
    loadStudentIntoForm(currentStudentId);
  } else {
    renderSelectedStudentDetail(null);
  }
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
  if (!byId("calendar-prev")) {
    return;
  }

  byId("calendar-prev").addEventListener("click", () => {
    currentWeekStart = addDays(currentWeekStart, -7);
    renderWeekCalendar();
  });

  byId("calendar-next").addEventListener("click", () => {
    currentWeekStart = addDays(currentWeekStart, 7);
    renderWeekCalendar();
  });

  byId("focus-prev").addEventListener("click", () => {
    focusMonth = shiftMonth(focusMonth, -1);
    syncFocusedDateToFocusMonth();
    renderFocusDateGrid();
    renderFocusHoursGrid();
  });

  byId("focus-next").addEventListener("click", () => {
    focusMonth = shiftMonth(focusMonth, 1);
    syncFocusedDateToFocusMonth();
    renderFocusDateGrid();
    renderFocusHoursGrid();
  });
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

  const slots = [];
  const current = toDateFromIso(dateFrom);
  const finalDate = toDateFromIso(dateTo);
  const timeSlots = getTimeSlots().filter((time) => time >= startTime && time <= endTime);

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
  if (!byId("bulk-preset-weekdays")) {
    return;
  }

  byId("bulk-preset-weekdays").addEventListener("click", () => {
    byId("bulk-time-start").value = "08:00";
    byId("bulk-time-end").value = "17:00";
    document.querySelectorAll("#bulk-weekday-row input").forEach((input) => {
      input.checked = ["1", "2", "3", "4", "5"].includes(input.value);
    });
  });

  byId("bulk-add").addEventListener("click", () => {
    const error = byId("slot-error");
    const result = buildBulkSlots();

    if (!result.ok) {
      error.textContent = result.error;
      error.hidden = false;
      return;
    }

    const bulkResult = window.HWFData.addAvailabilitySlots(result.slots);

    if (!bulkResult.ok) {
      error.textContent = bulkResult.error;
      error.hidden = false;
      return;
    }

    error.hidden = false;
    error.textContent = `Added ${bulkResult.added} slots${bulkResult.skipped ? `, skipped ${bulkResult.skipped}` : ""}.`;
    renderAdminDashboard();
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

  byId("student-select").addEventListener("change", (event) => {
    loadStudentIntoForm(event.target.value);
  });

  byId("save-student").addEventListener("click", () => {
    const result = window.HWFData.updateStudentProgress(byId("student-select").value, {
      track: byId("student-track").value.trim(),
      level: byId("student-level").value.trim(),
      completedLessons: byId("student-completed").value,
      totalLessons: byId("student-total").value,
      streak: byId("student-streak").value,
      nextMilestone: byId("student-milestone").value.trim(),
      focusAreas: byId("student-focus").value,
      coachNote: byId("student-note").value.trim()
    });

    const message = byId("student-save-message");
    message.hidden = false;

    if (!result.ok) {
      message.className = "booking-feedback error";
      message.textContent = result.error;
      return;
    }

    message.className = "booking-feedback success";
    message.textContent = "Student progress saved.";
    renderAdminDashboard();
  });
}

function bindTeacherLogout() {
  const button = byId("teacher-logout");

  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    if (window.supabaseClient) {
      await window.supabaseClient.auth.signOut();
    }
    window.location.href = "teacher-login.html";
  });
}

async function initAdminPortal() {
  window.HWFData.ensurePortalState();
  bindTeacherAuth();
  bindTeacherInterestForm();
  bindCalendarControls();
  bindViewSwitcher();
  bindBulkControls();
  bindStudentEditor();
  bindTeacherLogout();

  await openTeacherDashboardFromSession();
}

initAdminPortal();
