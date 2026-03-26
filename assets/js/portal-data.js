const HWF_PORTAL_STORAGE_KEY = "hwf_portal_state_v1";
const HWF_REGISTRATION_STORAGE_KEY = "hwf_registrations";
const DEMO_STUDENT_EMAILS = new Set([
  "maria@hablawithflow.com",
  "james@hablawithflow.com",
  "nina@hablawithflow.com"
]);

const DEFAULT_PORTAL_STATE = {
  availability: [
    { id: "slot-1", date: "2026-03-28", time: "10:00" },
    { id: "slot-2", date: "2026-03-28", time: "14:00" },
    { id: "slot-3", date: "2026-03-29", time: "11:00" },
    { id: "slot-4", date: "2026-03-31", time: "16:00" },
    { id: "slot-5", date: "2026-04-01", time: "09:00" },
    { id: "slot-6", date: "2026-04-02", time: "18:00" }
  ],
  bookings: [],
  students: [],
  teacherAccessCode: "vlad-admin"
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortByDateTime(items) {
  return [...items].sort((left, right) => {
    const leftValue = `${left.date}T${left.time}`;
    const rightValue = `${right.date}T${right.time}`;
    return leftValue.localeCompare(rightValue);
  });
}

function uniqueByDateTime(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = `${item.date}T${item.time}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function normalizeTimeToHour(time) {
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) {
    return time;
  }

  const [hours] = time.split(":");
  return `${hours}:00`;
}

function normalizeStudent(student) {
  return {
    ...student,
    email: normalizeEmail(student.email || ""),
    upcomingLessons: Array.isArray(student.upcomingLessons)
      ? student.upcomingLessons.map((lesson) => ({
          ...lesson,
          time: normalizeTimeToHour(lesson.time)
        }))
      : [],
    lessonHistory: Array.isArray(student.lessonHistory) ? student.lessonHistory : [],
    focusAreas: Array.isArray(student.focusAreas) ? student.focusAreas : []
  };
}

function readRegistrations() {
  const raw = localStorage.getItem(HWF_REGISTRATION_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function writeRegistrations(registrations) {
  localStorage.setItem(HWF_REGISTRATION_STORAGE_KEY, JSON.stringify(registrations));
}

function firstNameFromName(name) {
  return name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "student";
}

function buildUniqueAccessCode(name, students) {
  let candidate = `${firstNameFromName(name)}flow`;

  if (!students.some((student) => student.accessCode === candidate)) {
    return candidate;
  }

  do {
    candidate = `${firstNameFromName(name)}${Math.random().toString(36).slice(2, 6)}`;
  } while (students.some((student) => student.accessCode === candidate));

  return candidate;
}

function goalToFocusArea(goal) {
  if (!goal || goal === "Not sure") {
    return "Conversation";
  }

  if (goal === "Work") {
    return "Professional Spanish";
  }

  return goal;
}

function createStudentProfile(details, students) {
  const studentName = details.studentName || details.name;
  const accessCode = buildUniqueAccessCode(studentName, students);
  const track = details.track || details.lessonType || "1-on-1";
  const level = details.level || "Beginner";
  const focusArea = goalToFocusArea(details.goal);
  const coachNote = details.message
    ? `Welcome to Hablawithflow. Your note has been saved: "${details.message}".`
    : "Welcome to Hablawithflow. Your first lesson is booked and your learning plan will start from there.";

  return {
    id: buildId("student"),
    name: studentName,
    email: normalizeEmail(details.email),
    accessCode,
    track,
    level,
    completedLessons: 0,
    totalLessons: 8,
    streak: 0,
    coachNote,
    nextMilestone: "Complete your first live lesson and set your personalized speaking goals.",
    focusAreas: [...new Set(["Confidence", focusArea, track])],
    upcomingLessons: details.date && details.time
      ? [
          {
            date: details.date,
            time: details.time,
            topic: track
          }
        ]
      : [],
    lessonHistory: []
  };
}

function upsertRegistrationRecord(payload) {
  const registrations = readRegistrations();
  const email = normalizeEmail(payload.email);
  const existingIndex = registrations.findIndex((registration) => {
    return normalizeEmail(registration.email) === email;
  });

  const nextRegistration = {
    ...(existingIndex >= 0 ? registrations[existingIndex] : {}),
    ...payload,
    email,
    updatedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    registrations[existingIndex] = nextRegistration;
  } else {
    registrations.push({
      ...nextRegistration,
      submittedAt: nextRegistration.submittedAt || new Date().toISOString()
    });
  }

  writeRegistrations(registrations);
  return existingIndex >= 0 ? registrations[existingIndex] : registrations[registrations.length - 1];
}

function upsertRegistrationFromBooking(booking, student) {
  return upsertRegistrationRecord({
    name: booking.studentName,
    email: booking.email,
    level: student ? student.level : "Beginner",
    track: booking.lessonType,
    timezone: "other",
    goal: student && student.focusAreas.length ? student.focusAreas[0] : "Conversation",
    message: booking.message,
    source: "booking",
    accessCode: student ? student.accessCode : ""
  });
}

function sanitizePortalState(state) {
  const nextState = {
    availability: Array.isArray(state?.availability)
      ? uniqueByDateTime(
          state.availability.map((slot) => ({
            ...slot,
            time: normalizeTimeToHour(slot.time)
          }))
        )
      : deepClone(DEFAULT_PORTAL_STATE.availability),
    bookings: Array.isArray(state?.bookings)
      ? state.bookings.map((booking) => ({
          ...booking,
          time: normalizeTimeToHour(booking.time)
        }))
      : [],
    students: Array.isArray(state?.students) ? state.students : [],
    teacherAccessCode:
      typeof state?.teacherAccessCode === "string" && state.teacherAccessCode.trim()
        ? state.teacherAccessCode.trim()
        : DEFAULT_PORTAL_STATE.teacherAccessCode
  };

  nextState.bookings = nextState.bookings.filter((booking) => {
    return booking && !DEMO_STUDENT_EMAILS.has(normalizeEmail(booking.email || ""));
  });

  nextState.students = nextState.students
    .filter((student) => student && !DEMO_STUDENT_EMAILS.has(normalizeEmail(student.email || "")))
    .map(normalizeStudent);

  return nextState;
}

function readPortalState() {
  const raw = localStorage.getItem(HWF_PORTAL_STORAGE_KEY);

  if (!raw) {
    const seeded = sanitizePortalState(deepClone(DEFAULT_PORTAL_STATE));
    localStorage.setItem(HWF_PORTAL_STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  const parsed = JSON.parse(raw);
  const sanitized = sanitizePortalState(parsed);

  if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
    localStorage.setItem(HWF_PORTAL_STORAGE_KEY, JSON.stringify(sanitized));
  }

  return sanitized;
}

function writePortalState(state) {
  localStorage.setItem(HWF_PORTAL_STORAGE_KEY, JSON.stringify(state));
}

function ensurePortalState() {
  return readPortalState();
}

function listAvailability() {
  return sortByDateTime(readPortalState().availability);
}

function listBookings() {
  return sortByDateTime(readPortalState().bookings);
}

function listStudents() {
  return readPortalState().students.sort((left, right) => left.name.localeCompare(right.name));
}

function getTeacherAccessCode() {
  return readPortalState().teacherAccessCode;
}

function getStudentById(studentId) {
  return readPortalState().students.find((student) => student.id === studentId) || null;
}

function getStudentByCredentials(email, accessCode) {
  const normalizedEmail = normalizeEmail(email);

  return (
    readPortalState().students.find((student) => {
      return (
        student.email.toLowerCase() === normalizedEmail &&
        student.accessCode === accessCode.trim()
      );
    }) || null
  );
}

function getStudentByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  return (
    readPortalState().students.find((student) => {
      return student.email.toLowerCase() === normalizedEmail;
    }) || null
  );
}

function ensureStudentFromProfile(profile) {
  const state = readPortalState();
  const normalizedEmail = normalizeEmail(profile.email);

  let student = state.students.find((entry) => entry.email === normalizedEmail) || null;

  if (student) {
    student.name = profile.name || profile.full_name || student.name;
    student.track = profile.track || student.track;
    student.level = profile.level || student.level;
    student.focusAreas = [...new Set([
      "Confidence",
      goalToFocusArea(profile.goal || student.focusAreas[0] || "Conversation"),
      profile.track || student.track
    ])];

    if (profile.notes) {
      student.coachNote = profile.notes;
    }
  } else {
    student = createStudentProfile(
      {
        name: profile.name || profile.full_name || normalizedEmail.split("@")[0],
        email: normalizedEmail,
        track: profile.track || "1-on-1",
        level: profile.level || "Beginner",
        goal: profile.goal || "Conversation",
        message: profile.notes || ""
      },
      state.students
    );
    state.students.push(student);
  }

  writePortalState(state);
  return student;
}

function registerStudent(registration) {
  const state = readPortalState();
  const normalizedEmail = normalizeEmail(registration.email);

  if (!registration.name || !normalizedEmail || !registration.track || !registration.goal) {
    return { ok: false, error: "Please complete your name, email, preferred track, and main goal." };
  }

  let student = state.students.find((entry) => entry.email === normalizedEmail) || null;
  const created = !student;

  if (student) {
    student.name = registration.name;
    student.track = registration.track;
    student.level = registration.level || student.level || "Beginner";
    student.focusAreas = [...new Set(["Confidence", goalToFocusArea(registration.goal), registration.track])];
    if (registration.message) {
      student.coachNote = `Registration updated. Latest student note: "${registration.message}".`;
    }
  } else {
    student = createStudentProfile(
      {
        ...registration,
        email: normalizedEmail
      },
      state.students
    );
    state.students.push(student);
  }

  writePortalState(state);

  upsertRegistrationRecord({
    name: registration.name,
    email: normalizedEmail,
    level: registration.level || "Beginner",
    track: registration.track,
    timezone: registration.timezone || "other",
    goal: registration.goal,
    message: registration.message,
    source: "register",
    accessCode: student.accessCode
  });

  return {
    ok: true,
    created,
    student: {
      id: student.id,
      name: student.name,
      email: student.email,
      accessCode: student.accessCode
    }
  };
}

function addAvailabilitySlot(slot) {
  const state = readPortalState();
  const date = slot.date;
  const time = normalizeTimeToHour(slot.time);

  const hasBooking = state.bookings.some((entry) => entry.date === date && entry.time === time);
  if (hasBooking) {
    return { ok: false, error: "That time is already booked." };
  }

  const duplicate = state.availability.some((entry) => entry.date === date && entry.time === time);
  if (duplicate) {
    return { ok: false, error: "That slot already exists." };
  }

  state.availability.push({
    id: buildId("slot"),
    date,
    time
  });

  writePortalState(state);
  return { ok: true, availability: sortByDateTime(state.availability) };
}

function addAvailabilitySlots(slots) {
  const state = readPortalState();
  let added = 0;
  let skipped = 0;

  slots.forEach((slot) => {
    const date = slot.date;
    const time = normalizeTimeToHour(slot.time);

    const hasBooking = state.bookings.some((entry) => entry.date === date && entry.time === time);
    const duplicate = state.availability.some((entry) => entry.date === date && entry.time === time);

    if (hasBooking || duplicate) {
      skipped += 1;
      return;
    }

    state.availability.push({
      id: buildId("slot"),
      date,
      time
    });
    added += 1;
  });

  writePortalState(state);

  return {
    ok: added > 0,
    added,
    skipped,
    availability: sortByDateTime(state.availability),
    error: added > 0 ? "" : "No new availability was added."
  };
}

function removeAvailabilitySlot(slotId) {
  const state = readPortalState();
  state.availability = state.availability.filter((slot) => slot.id !== slotId);
  writePortalState(state);
  return sortByDateTime(state.availability);
}

function createBooking(booking) {
  const state = readPortalState();
  const normalizedEmail = normalizeEmail(booking.email);
  const existingRegistration = readRegistrations().find((registration) => {
    return normalizeEmail(registration.email) === normalizedEmail;
  }) || null;
  const matchingSlot = state.availability.find((slot) => {
    return slot.date === booking.date && slot.time === booking.time;
  });

  if (!matchingSlot) {
    return { ok: false, error: "That time slot is no longer available." };
  }

  state.availability = state.availability.filter((slot) => slot.id !== matchingSlot.id);

  const savedBooking = {
    id: buildId("booking"),
    studentName: booking.studentName,
    email: normalizedEmail,
    date: booking.date,
    time: booking.time,
    lessonType: booking.lessonType,
    message: booking.message,
    status: "confirmed"
  };

  state.bookings.push(savedBooking);

  let matchingStudent = state.students.find((student) => {
    return student.email.toLowerCase() === normalizedEmail;
  });

  let registrationOutcome = {
    created: false,
    accessCode: matchingStudent ? matchingStudent.accessCode : ""
  };

  if (matchingStudent) {
    matchingStudent.name = booking.studentName;
    matchingStudent.track = booking.lessonType;
    matchingStudent.upcomingLessons = sortByDateTime([
      ...matchingStudent.upcomingLessons,
      {
        date: booking.date,
        time: booking.time,
        topic: booking.lessonType
      }
    ]);
  } else {
    matchingStudent = createStudentProfile(
      {
        studentName: booking.studentName,
        email: normalizedEmail,
        lessonType: booking.lessonType,
        track: existingRegistration ? existingRegistration.track : booking.lessonType,
        level: existingRegistration ? existingRegistration.level : "Beginner",
        goal: existingRegistration ? existingRegistration.goal : "Conversation",
        message: booking.message,
        date: booking.date,
        time: booking.time
      },
      state.students
    );
    state.students.push(matchingStudent);
    registrationOutcome = {
      created: true,
      accessCode: matchingStudent.accessCode
    };
  }

  upsertRegistrationFromBooking({
    ...booking,
    email: normalizedEmail
  }, matchingStudent);

  writePortalState(state);
  return {
    ok: true,
    booking: savedBooking,
    registration: registrationOutcome,
    student: {
      name: matchingStudent.name,
      email: matchingStudent.email,
      accessCode: matchingStudent.accessCode
    }
  };
}

function updateStudentProgress(studentId, updates) {
  const state = readPortalState();
  const student = state.students.find((entry) => entry.id === studentId);

  if (!student) {
    return { ok: false, error: "Student not found." };
  }

  student.level = updates.level;
  student.track = updates.track;
  student.completedLessons = Number(updates.completedLessons);
  student.totalLessons = Number(updates.totalLessons);
  student.streak = Number(updates.streak);
  student.coachNote = updates.coachNote;
  student.nextMilestone = updates.nextMilestone;
  student.focusAreas = updates.focusAreas
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  writePortalState(state);
  return { ok: true, student };
}

window.HWFData = {
  ensurePortalState,
  listAvailability,
  listBookings,
  listStudents,
  getTeacherAccessCode,
  getStudentById,
  getStudentByCredentials,
  getStudentByEmail,
  ensureStudentFromProfile,
  registerStudent,
  addAvailabilitySlot,
  addAvailabilitySlots,
  removeAvailabilitySlot,
  createBooking,
  updateStudentProgress
};
