const STUDENT_REVIEW_STORAGE_KEY = "hwf_reviews";
const STUDENT_BOOKING_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let currentStudent = null;
let selectedStudentRating = 0;
let studentBookingMonth = null;
let selectedStudentBookingDate = "";
let selectedStudentBookingTime = "";

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

async function openStudentDashboardFromSession() {
  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  if (!user) {
    return;
  }

  const profile = await loadSupabaseProfile(user);
  const student = window.HWFData.ensureStudentFromProfile(profile);

  document.getElementById("student-error").hidden = true;
  document.getElementById("student-login-card").hidden = true;
  document.getElementById("student-dashboard").hidden = false;
  renderStudentDashboard(student);
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

  document.getElementById("student-name-heading").textContent = `Welcome back, ${student.name}`;
  document.getElementById("student-track-label").textContent = student.track;
  document.getElementById("student-level-label").textContent = `Level ${student.level}`;
  document.getElementById("student-progress-count").textContent = student.completedLessons;
  document.getElementById("student-progress-caption").textContent = `out of ${student.totalLessons} planned lessons`;
  document.getElementById("student-streak-label").textContent = student.streak;
  document.getElementById("student-progress-percent").textContent = `${progressPercent}%`;
  document.getElementById("student-progress-bar").style.width = `${progressPercent}%`;
  document.getElementById("student-milestone").textContent = student.nextMilestone;
  document.getElementById("student-note").textContent = student.coachNote;
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
              <span class="status-pill">Upcoming</span>
            </div>
            <p>${formatStudentDate(lesson.date, lesson.time)} at ${lesson.time}</p>
          </article>
        `;
      })
      .join("");
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

  document.getElementById("student-booking-confirm").addEventListener("click", () => {
    if (!currentStudent || !selectedStudentBookingDate || !selectedStudentBookingTime) {
      setStudentBookingFeedback("Please choose an available lesson slot first.", "error");
      return;
    }

    const result = window.HWFData.createBooking({
      studentName: currentStudent.name,
      email: currentStudent.email,
      date: selectedStudentBookingDate,
      time: selectedStudentBookingTime,
      lessonType: currentStudent.track,
      message: document.getElementById("student-booking-message").value.trim()
    });

    if (!result.ok) {
      setStudentBookingFeedback(result.error, "error");
      renderStudentBookingSection();
      return;
    }

    document.getElementById("student-booking-message").value = "";
    setStudentBookingFeedback(
      `Booked for ${formatStudentDate(result.booking.date, result.booking.time)} at ${result.booking.time}.`,
      "success"
    );

    renderStudentDashboard(window.HWFData.getStudentById(currentStudent.id));
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

  document.getElementById("student-logout").addEventListener("click", async () => {
    currentStudent = null;
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
