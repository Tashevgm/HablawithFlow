const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 20;
const CALENDAR_STEP_MINUTES = 30;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let currentWeekStart = getStartOfWeek(new Date());
let currentView = "week";
let focusMonth = new Date();
let focusedDate = "";

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

function getOpenSlot(date, time) {
  return getAvailability().find((slot) => slot.date === date && slot.time === time) || null;
}

function getBooking(date, time) {
  return getBookings().find((entry) => entry.date === date && entry.time === time) || null;
}

function getOpenDates() {
  return [...new Set(getAvailability().map((slot) => slot.date))].sort();
}

function ensureFocusedDate() {
  const openDates = getOpenDates();

  if (!openDates.length) {
    focusedDate = toIsoDate(new Date());
    focusMonth = new Date();
    return;
  }

  if (!focusedDate || ![...openDates, ...getBookings().map((booking) => booking.date)].includes(focusedDate)) {
    focusedDate = openDates[0];
  }

  focusMonth = new Date(toDateFromIso(focusedDate).getFullYear(), toDateFromIso(focusedDate).getMonth(), 1);
}

function toggleSlot(date, time) {
  const error = document.getElementById("slot-error");
  const booking = getBooking(date, time);

  if (booking) {
    error.textContent = "That time is already booked.";
    error.hidden = false;
    return;
  }

  const openSlot = getOpenSlot(date, time);

  if (openSlot) {
    window.HWFData.removeAvailabilitySlot(openSlot.id);
    error.hidden = true;
    renderAdminDashboard();
    return;
  }

  const result = window.HWFData.addAvailabilitySlot({ date, time });
  if (!result.ok) {
    error.textContent = result.error;
    error.hidden = false;
    return;
  }

  error.hidden = true;
  renderAdminDashboard();
}

function renderAdminStats() {
  document.getElementById("stat-open-slots").textContent = getAvailability().length;
  document.getElementById("stat-bookings").textContent = getBookings().length;
  document.getElementById("stat-students").textContent = window.HWFData.listStudents().length;
}

function renderViewSwitcher() {
  document.querySelectorAll(".view-switch-btn").forEach((button) => {
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
  const calendar = document.getElementById("availability-calendar");
  const range = document.getElementById("calendar-range");
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
  ensureFocusedDate();

  const grid = document.getElementById("focus-date-grid");
  const label = document.getElementById("focus-month-label");
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
      renderFocusDateGrid();
      renderFocusHoursGrid();
    });
  });
}

function renderFocusHoursGrid() {
  const grid = document.getElementById("focus-hours-grid");
  const caption = document.getElementById("focus-date-caption");
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
  const today = new Date();
  const startDate = toIsoDate(today);
  const endDate = toIsoDate(addDays(today, 27));

  if (!document.getElementById("bulk-date-from").value) {
    document.getElementById("bulk-date-from").value = startDate;
  }

  if (!document.getElementById("bulk-date-to").value) {
    document.getElementById("bulk-date-to").value = endDate;
  }
}

function renderBookings() {
  const container = document.getElementById("booking-list");
  const bookings = getBookings();

  if (!bookings.length) {
    container.innerHTML = '<p class="empty-copy">No bookings have been made yet.</p>';
    return;
  }

  container.innerHTML = bookings
    .map((booking) => {
      return `
        <article class="list-card">
          <div class="list-card-top">
            <strong>${booking.studentName}</strong>
            <span class="status-pill">${booking.lessonType}</span>
          </div>
          <p>${formatPortalDate(booking.date, booking.time)} at ${booking.time}</p>
          <span>${booking.email}</span>
          <p class="list-card-note">${booking.message || "No booking note added."}</p>
        </article>
      `;
    })
    .join("");
}

function renderStudentSelect() {
  const select = document.getElementById("student-select");
  const selectedId = select.value;
  const students = window.HWFData.listStudents();

  select.innerHTML = students
    .map((student) => `<option value="${student.id}">${student.name}</option>`)
    .join("");

  if (students.some((student) => student.id === selectedId)) {
    select.value = selectedId;
  }
}

function loadStudentIntoForm(studentId) {
  const student = window.HWFData.getStudentById(studentId);
  if (!student) {
    return;
  }

  document.getElementById("student-track").value = student.track;
  document.getElementById("student-level").value = student.level;
  document.getElementById("student-completed").value = student.completedLessons;
  document.getElementById("student-total").value = student.totalLessons;
  document.getElementById("student-streak").value = student.streak;
  document.getElementById("student-milestone").value = student.nextMilestone;
  document.getElementById("student-focus").value = student.focusAreas.join(", ");
  document.getElementById("student-note").value = student.coachNote;
}

function renderRoster() {
  const container = document.getElementById("student-roster");
  const students = window.HWFData.listStudents();

  container.innerHTML = students
    .map((student) => {
      const percent = Math.round((student.completedLessons / student.totalLessons) * 100);
      return `
        <article class="list-card">
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
        </article>
      `;
    })
    .join("");
}

function renderAdminDashboard() {
  const students = window.HWFData.listStudents();
  const select = document.getElementById("student-select");
  const currentStudentId = students.length ? (select.value || students[0].id) : "";

  ensureFocusedDate();
  renderAdminStats();
  renderViewSwitcher();
  renderWeekCalendar();
  renderFocusDateGrid();
  renderFocusHoursGrid();
  renderBulkDefaults();
  renderBookings();
  renderStudentSelect();

  if (currentStudentId) {
    loadStudentIntoForm(currentStudentId);
  }

  renderRoster();
}

function bindTeacherAuth() {
  const button = document.getElementById("admin-login");
  button.addEventListener("click", () => {
    const code = document.getElementById("admin-code").value.trim();
    const error = document.getElementById("admin-error");

    if (code !== window.HWFData.getTeacherAccessCode()) {
      error.textContent = "Incorrect access code.";
      error.hidden = false;
      return;
    }

    error.hidden = true;
    document.getElementById("admin-login-card").hidden = true;
    document.getElementById("admin-dashboard").hidden = false;
    renderAdminDashboard();
  });
}

function bindCalendarControls() {
  document.getElementById("calendar-prev").addEventListener("click", () => {
    currentWeekStart = addDays(currentWeekStart, -7);
    renderWeekCalendar();
  });

  document.getElementById("calendar-next").addEventListener("click", () => {
    currentWeekStart = addDays(currentWeekStart, 7);
    renderWeekCalendar();
  });

  document.getElementById("focus-prev").addEventListener("click", () => {
    focusMonth = shiftMonth(focusMonth, -1);
    renderFocusDateGrid();
  });

  document.getElementById("focus-next").addEventListener("click", () => {
    focusMonth = shiftMonth(focusMonth, 1);
    renderFocusDateGrid();
  });
}

function bindViewSwitcher() {
  document.querySelectorAll(".view-switch-btn").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      renderViewSwitcher();
    });
  });
}

function buildBulkSlots() {
  const dateFrom = document.getElementById("bulk-date-from").value;
  const dateTo = document.getElementById("bulk-date-to").value;
  const startTime = document.getElementById("bulk-time-start").value;
  const endTime = document.getElementById("bulk-time-end").value;
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
  document.getElementById("bulk-preset-weekdays").addEventListener("click", () => {
    document.getElementById("bulk-time-start").value = "08:00";
    document.getElementById("bulk-time-end").value = "17:00";
    document.querySelectorAll("#bulk-weekday-row input").forEach((input) => {
      input.checked = ["1", "2", "3", "4", "5"].includes(input.value);
    });
  });

  document.getElementById("bulk-add").addEventListener("click", () => {
    const error = document.getElementById("slot-error");
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
  document.getElementById("student-select").addEventListener("change", (event) => {
    loadStudentIntoForm(event.target.value);
  });

  document.getElementById("save-student").addEventListener("click", () => {
    const result = window.HWFData.updateStudentProgress(document.getElementById("student-select").value, {
      track: document.getElementById("student-track").value.trim(),
      level: document.getElementById("student-level").value.trim(),
      completedLessons: document.getElementById("student-completed").value,
      totalLessons: document.getElementById("student-total").value,
      streak: document.getElementById("student-streak").value,
      nextMilestone: document.getElementById("student-milestone").value.trim(),
      focusAreas: document.getElementById("student-focus").value,
      coachNote: document.getElementById("student-note").value.trim()
    });

    const message = document.getElementById("student-save-message");
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

function initAdminPortal() {
  window.HWFData.ensurePortalState();
  bindTeacherAuth();
  bindCalendarControls();
  bindViewSwitcher();
  bindBulkControls();
  bindStudentEditor();
}

initAdminPortal();
