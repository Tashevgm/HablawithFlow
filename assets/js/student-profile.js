const STUDENT_HOMEWORK_BUCKET = "student-homework";

const studentProfileState = {
  student: null,
  studentEmail: "",
  teacherUser: null,
  bookings: [],
  plan: null,
  lessonLogs: [],
  homeworkFiles: []
};

function byId(id) {
  return document.getElementById(id);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function formatPortalDate(date, time) {
  return new Date(`${date}T${time}`).toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function getPasswordResetRedirect() {
  return `${window.location.origin}/set-password.html`;
}

function buildTeacherLoginUrl() {
  return `teacher-login.html?next=${encodeURIComponent("student-profile.html" + window.location.search)}`;
}

function redirectToTeacherLogin() {
  window.location.href = buildTeacherLoginUrl();
}

function getStatusMeta(status) {
  if (window.HWFData && typeof window.HWFData.getBookingStatusMeta === "function") {
    return window.HWFData.getBookingStatusMeta(status);
  }

  return {
    value: String(status || "pending_payment"),
    label: "Awaiting payment",
    tone: "pending",
    active: true
  };
}

async function getTeacherRole(user) {
  const metadataRole = String(user.user_metadata?.role || "").toLowerCase();
  const { data, error } = await window.supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return metadataRole;
  }

  return String(data?.role || metadataRole || "").toLowerCase();
}

async function requireTeacherSession() {
  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  if (!user) {
    redirectToTeacherLogin();
    return null;
  }

  const role = await getTeacherRole(user);
  if (role !== "teacher" && role !== "admin") {
    await window.supabaseClient.auth.signOut();
    redirectToTeacherLogin();
    return null;
  }

  studentProfileState.teacherUser = user;
  return user;
}

function resolveStudentFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const studentId = params.get("id") || "";
  const studentEmail = normalizeEmail(params.get("email") || "");

  if (window.HWFData) {
    window.HWFData.ensurePortalState();
  }

  let student = null;

  if (studentId && window.HWFData && typeof window.HWFData.getStudentById === "function") {
    student = window.HWFData.getStudentById(studentId);
  }

  if (!student && studentEmail && window.HWFData && typeof window.HWFData.listStudents === "function") {
    student = window.HWFData.listStudents().find((entry) => normalizeEmail(entry.email) === studentEmail) || null;
  }

  if (!student && !studentEmail) {
    return null;
  }

  if (!student) {
    student = {
      id: studentId || studentEmail,
      name: studentEmail.split("@")[0] || "Student",
      email: studentEmail,
      track: "Not set",
      level: "Not set",
      completedLessons: 0,
      totalLessons: 0,
      streak: 0,
      coachNote: "",
      nextMilestone: "",
      focusAreas: [],
      upcomingLessons: [],
      lessonHistory: []
    };
  }

  studentProfileState.student = student;
  studentProfileState.studentEmail = normalizeEmail(student.email || studentEmail);
  return student;
}

async function loadStudentProfileData() {
  const email = studentProfileState.studentEmail;

  const [planResult, lessonLogsResult, homeworkResult, bookingsResult] = await Promise.all([
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
      .order("created_at", { ascending: false }),
    window.supabaseClient
      .from("student_homework_files")
      .select("*")
      .eq("student_email", email)
      .order("created_at", { ascending: false }),
    window.supabaseClient
      .from("bookings")
      .select("*")
      .eq("student_email", email)
      .order("lesson_date", { ascending: true })
      .order("lesson_time", { ascending: true })
  ]);

  studentProfileState.plan = planResult.error ? null : planResult.data;
  studentProfileState.lessonLogs = lessonLogsResult.error || !Array.isArray(lessonLogsResult.data) ? [] : lessonLogsResult.data;
  studentProfileState.homeworkFiles = homeworkResult.error || !Array.isArray(homeworkResult.data) ? [] : homeworkResult.data;
  studentProfileState.bookings = bookingsResult.error || !Array.isArray(bookingsResult.data) ? [] : bookingsResult.data;
}

function setFeedback(id, message, type) {
  const feedback = byId(id);
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function clearFeedback(id) {
  const feedback = byId(id);
  if (!feedback) {
    return;
  }

  feedback.hidden = true;
  feedback.textContent = "";
}

function populatePlanForm() {
  const plan = studentProfileState.plan;
  byId("plan-title").value = plan?.plan_title || "";
  byId("plan-long-goal").value = plan?.long_term_goal || "";
  byId("plan-weekly-focus").value = plan?.weekly_focus || "";
  byId("plan-objectives").value = Array.isArray(plan?.objectives) ? plan.objectives.join("\n") : "";
  byId("plan-notes").value = plan?.teacher_notes || "";
}

function renderLessonLogs() {
  const container = byId("lesson-log-list");

  if (!studentProfileState.lessonLogs.length) {
    container.innerHTML = '<p class="empty-copy">No lesson records have been added yet.</p>';
    return;
  }

  container.innerHTML = studentProfileState.lessonLogs
    .map((entry) => {
      return `
        <article class="list-card">
          <div class="list-card-top">
            <strong>${entry.topic}</strong>
            <span class="status-pill muted">${entry.duration_minutes || 0} min</span>
          </div>
          <p>${new Date(`${entry.lesson_date}T00:00:00`).toLocaleDateString("en-GB", {
            month: "short",
            day: "numeric",
            year: "numeric"
          })}</p>
          <p class="list-card-note">${entry.outcome || "No outcome recorded."}</p>
          <p class="list-card-note">${entry.homework || "No homework note recorded."}</p>
          <p class="list-card-note">${entry.teacher_notes || "No teacher note recorded."}</p>
        </article>
      `;
    })
    .join("");
}

function renderHomeworkFiles() {
  const container = byId("homework-file-list");

  if (!studentProfileState.homeworkFiles.length) {
    container.innerHTML = '<p class="empty-copy">No homework files uploaded yet.</p>';
    return;
  }

  container.innerHTML = studentProfileState.homeworkFiles
    .map((file) => {
      return `
        <article class="list-card">
          <div class="list-card-top">
            <strong>${file.title}</strong>
            <span class="status-pill muted">${file.file_name}</span>
          </div>
          <p>${new Date(file.created_at).toLocaleDateString("en-GB", {
            month: "short",
            day: "numeric",
            year: "numeric"
          })}</p>
          <p class="list-card-note">${file.notes || "No homework instructions added."}</p>
          <div class="list-card-actions">
            <button class="list-action pay homework-download" type="button" data-file-path="${file.file_path}">
              Download File
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll(".homework-download").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        const { data, error } = await window.supabaseClient.storage
          .from(STUDENT_HOMEWORK_BUCKET)
          .download(button.dataset.filePath);

        if (error || !data) {
          throw error || new Error("Download failed.");
        }

        const url = URL.createObjectURL(data);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = button.dataset.filePath.split("/").pop();
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        setFeedback("homework-feedback", error.message || "Could not download the file.", "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderStudentSummary() {
  const student = studentProfileState.student;
  const bookings = studentProfileState.bookings
    .map((booking) => ({
      ...booking,
      statusMeta: getStatusMeta(booking.status)
    }))
    .filter((booking) => booking.statusMeta.active);
  const nextBooking = bookings[0] || null;
  const progressPercent = Math.round((Number(student.completedLessons) / Math.max(Number(student.totalLessons) || 0, 1)) * 100);
  const focusSummary = student.focusAreas && student.focusAreas.length ? student.focusAreas[0] : "No focus areas yet";

  byId("student-profile-name").textContent = student.name;
  byId("student-profile-subtitle").textContent = `Individual plan, lesson tracking, and homework management for ${student.name}.`;
  byId("student-profile-progress").textContent = `${progressPercent}%`;
  byId("student-profile-progress-copy").textContent = `${student.completedLessons} of ${student.totalLessons} planned lessons completed.`;
  byId("student-profile-track").textContent = student.track || "Not set";
  byId("student-profile-level").textContent = student.level || "Level not set";
  byId("student-profile-focus-summary").textContent = focusSummary;
  byId("student-profile-next-lesson").textContent = nextBooking
    ? `${formatPortalDate(nextBooking.lesson_date, nextBooking.lesson_time)} at ${nextBooking.lesson_time.slice(0, 5)}`
    : "No upcoming lesson recorded.";

  byId("student-profile-detail-name").textContent = student.name;
  byId("student-profile-email").textContent = student.email;
  byId("student-profile-level-pill").textContent = student.level || "Not set";
  byId("student-profile-note").textContent = student.coachNote || "No coaching note recorded yet.";
  byId("student-profile-focus").innerHTML = (student.focusAreas && student.focusAreas.length ? student.focusAreas : ["No focus areas yet"])
    .map((area) => `<span class="focus-chip">${area}</span>`)
    .join("");

  byId("student-profile-upcoming").innerHTML = bookings.length
    ? bookings
        .map((booking) => {
          return `
            <article class="list-card">
              <div class="list-card-top">
                <strong>${booking.lesson_type || student.track}</strong>
                <span class="status-pill ${booking.statusMeta.tone}">${booking.statusMeta.label}</span>
              </div>
              <p>${formatPortalDate(booking.lesson_date, booking.lesson_time)} at ${booking.lesson_time.slice(0, 5)}</p>
            </article>
          `;
        })
        .join("")
    : '<p class="empty-copy">No upcoming lessons recorded yet.</p>';
}

function bindPlanForm() {
  byId("save-student-plan").addEventListener("click", async () => {
    clearFeedback("student-plan-feedback");

    const payload = {
      student_email: studentProfileState.studentEmail,
      plan_title: byId("plan-title").value.trim(),
      long_term_goal: byId("plan-long-goal").value.trim(),
      weekly_focus: byId("plan-weekly-focus").value.trim(),
      objectives: byId("plan-objectives").value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      teacher_notes: byId("plan-notes").value.trim(),
      updated_by: studentProfileState.teacherUser.id
    };

    const { data, error } = await window.supabaseClient
      .from("student_learning_plans")
      .upsert(payload, { onConflict: "student_email" })
      .select()
      .single();

    if (error) {
      setFeedback("student-plan-feedback", error.message, "error");
      return;
    }

    studentProfileState.plan = data;
    setFeedback("student-plan-feedback", "Learning plan saved.", "success");
  });
}

function bindLessonLogForm() {
  byId("save-lesson-log").addEventListener("click", async () => {
    clearFeedback("lesson-log-feedback");

    const payload = {
      student_email: studentProfileState.studentEmail,
      lesson_date: byId("lesson-log-date").value,
      topic: byId("lesson-log-topic").value.trim(),
      duration_minutes: Number(byId("lesson-log-duration").value || 0),
      outcome: byId("lesson-log-outcome").value.trim(),
      homework: byId("lesson-log-homework").value.trim(),
      teacher_notes: byId("lesson-log-notes").value.trim(),
      created_by: studentProfileState.teacherUser.id
    };

    if (!payload.lesson_date || !payload.topic) {
      setFeedback("lesson-log-feedback", "Lesson date and topic are required.", "error");
      return;
    }

    const { data, error } = await window.supabaseClient
      .from("student_lesson_logs")
      .insert(payload)
      .select()
      .single();

    if (error) {
      setFeedback("lesson-log-feedback", error.message, "error");
      return;
    }

    studentProfileState.lessonLogs = [data, ...studentProfileState.lessonLogs];
    renderLessonLogs();
    byId("lesson-log-date").value = "";
    byId("lesson-log-topic").value = "";
    byId("lesson-log-duration").value = "60";
    byId("lesson-log-outcome").value = "";
    byId("lesson-log-homework").value = "";
    byId("lesson-log-notes").value = "";
    setFeedback("lesson-log-feedback", "Lesson record added.", "success");
  });
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function bindHomeworkUpload() {
  byId("upload-homework").addEventListener("click", async () => {
    clearFeedback("homework-feedback");

    const title = byId("homework-title").value.trim();
    const notes = byId("homework-notes").value.trim();
    const fileInput = byId("homework-file");
    const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

    if (!title || !file) {
      setFeedback("homework-feedback", "Homework title and Word file are required.", "error");
      return;
    }

    const filePath = `${studentProfileState.studentEmail}/${Date.now()}-${sanitizeFileName(file.name)}`;

    const uploadResult = await window.supabaseClient.storage
      .from(STUDENT_HOMEWORK_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined
      });

    if (uploadResult.error) {
      setFeedback("homework-feedback", uploadResult.error.message, "error");
      return;
    }

    const metadataPayload = {
      student_email: studentProfileState.studentEmail,
      title,
      notes,
      file_path: filePath,
      file_name: file.name,
      mime_type: file.type || "",
      size_bytes: file.size,
      uploaded_by: studentProfileState.teacherUser.id
    };

    const { data, error } = await window.supabaseClient
      .from("student_homework_files")
      .insert(metadataPayload)
      .select()
      .single();

    if (error) {
      await window.supabaseClient.storage.from(STUDENT_HOMEWORK_BUCKET).remove([filePath]);
      setFeedback("homework-feedback", error.message, "error");
      return;
    }

    studentProfileState.homeworkFiles = [data, ...studentProfileState.homeworkFiles];
    renderHomeworkFiles();
    byId("homework-title").value = "";
    byId("homework-notes").value = "";
    fileInput.value = "";
    setFeedback("homework-feedback", "Homework file uploaded.", "success");
  });
}

function bindTeacherLogout() {
  const button = byId("teacher-logout");
  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    await window.supabaseClient.auth.signOut();
    window.location.href = "teacher-login.html";
  });
}

async function initStudentProfilePage() {
  if (!window.supabaseClient) {
    redirectToTeacherLogin();
    return;
  }

  const user = await requireTeacherSession();
  if (!user) {
    return;
  }

  const student = resolveStudentFromQuery();
  if (!student || !studentProfileState.studentEmail) {
    window.location.href = "teacher-students.html";
    return;
  }

  await loadStudentProfileData();
  renderStudentSummary();
  populatePlanForm();
  renderLessonLogs();
  renderHomeworkFiles();
  bindPlanForm();
  bindLessonLogForm();
  bindHomeworkUpload();
  bindTeacherLogout();
  byId("student-profile-dashboard").hidden = false;
}

initStudentProfilePage();
