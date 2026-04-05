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
  studentGroups: [],
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
    return `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`;
  }

  return raw.slice(0, 5);
}

function parseSlotDateTime(date, time) {
  if (typeof date !== "string" || typeof time !== "string") {
    return null;
  }

  const dateMatch = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.trim().match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function isFutureAvailabilitySlot(slot, now = new Date()) {
  const parsed = parseSlotDateTime(slot?.date, slot?.time);
  if (!parsed) {
    return false;
  }

  return parsed.getTime() > now.getTime();
}

function normalizeBookingStatus(status) {
  const rawStatus = String(status || "").trim().toLowerCase();

  if (!rawStatus) {
    return "pending_payment";
  }

  if (rawStatus === "confirmed" || rawStatus === "paid" || rawStatus === "confirmed_paid") {
    return "confirmed_paid";
  }

  if (
    rawStatus === "pending" ||
    rawStatus === "awaiting_payment" ||
    rawStatus === "awaiting payment" ||
    rawStatus === "unpaid" ||
    rawStatus === "pending_payment"
  ) {
    return "pending_payment";
  }

  if (
    rawStatus === "payment_submitted" ||
    rawStatus === "payment submitted" ||
    rawStatus === "checkout_submitted"
  ) {
    return "payment_submitted";
  }

  if (
    rawStatus === "cancelled" ||
    rawStatus === "canceled" ||
    rawStatus === "cancelled_paid" ||
    rawStatus === "canceled_paid"
  ) {
    return "cancelled_paid";
  }

  return rawStatus;
}

function getBookingStatusMeta(status) {
  const value = normalizeBookingStatus(status);

  if (value === "confirmed_paid") {
    return {
      value,
      label: "Paid",
      tone: "paid",
      active: true,
      canStudentCancel: true,
      canMarkPaid: false
    };
  }

  if (value === "cancelled_paid") {
    return {
      value,
      label: "Cancelled",
      tone: "cancelled",
      active: false,
      canStudentCancel: false,
      canMarkPaid: false
    };
  }

  if (value === "payment_submitted") {
    return {
      value,
      label: "Payment sent",
      tone: "submitted",
      active: true,
      canStudentCancel: false,
      canMarkPaid: true
    };
  }

  return {
    value: "pending_payment",
    label: "Ready to pay",
    tone: "pending",
    active: true,
    canStudentCancel: false,
    canMarkPaid: true
  };
}

function normalizeBookingRecord(booking) {
  const date = normalizeIsoDateValue(booking.date || booking.lesson_date || "");
  const rawTime = booking.time || booking.lesson_time || "";
  const normalizedTime = normalizeIsoTimeValue(rawTime);

  return {
    ...booking,
    date,
    time: normalizedTime || (typeof rawTime === "string" ? rawTime.slice(0, 5) : normalizeTimeToHour(rawTime)),
    studentName: booking.studentName || booking.student_name || "",
    lessonType: booking.lessonType || booking.lesson_type || "",
    message: booking.message || "",
    email: normalizeEmail(booking.email || booking.student_email || ""),
    status: normalizeBookingStatus(booking.status)
  };
}

function getAuthoritativeBookings() {
  if (Array.isArray(window.HWFServerBookings)) {
    return window.HWFServerBookings.map(normalizeBookingRecord);
  }

  return readPortalState().bookings.map(normalizeBookingRecord);
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
    : "Welcome to Hablawithflow. Your learning plan will start once you book your first lesson.";

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
    marketingEmailOptIn: Boolean(booking.marketingEmailOptIn),
    termsAcceptedAt: booking.termsAcceptedAt || "",
    privacyAcceptedAt: booking.privacyAcceptedAt || "",
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
        ).filter((slot) => isFutureAvailabilitySlot(slot))
      : deepClone(DEFAULT_PORTAL_STATE.availability),
    bookings: Array.isArray(state?.bookings)
      ? state.bookings.map((booking) => ({
          ...booking,
          time: normalizeTimeToHour(booking.time)
        }))
      : [],
    students: Array.isArray(state?.students) ? state.students : [],
    studentGroups: Array.isArray(state?.studentGroups) ? state.studentGroups : [],
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

  const validStudentIds = new Set(nextState.students.map((student) => student.id).filter(Boolean));
  const seenGroupNames = new Set();
  nextState.studentGroups = nextState.studentGroups
    .filter((group) => group && typeof group.name === "string" && group.name.trim().length > 0)
    .map((group) => {
      const normalizedStudentIds = Array.isArray(group.studentIds)
        ? [...new Set(group.studentIds.map((id) => String(id || "").trim()).filter((id) => validStudentIds.has(id)))]
        : [];

      return {
        id: String(group.id || "").trim() || buildId("group"),
        name: group.name.trim(),
        studentIds: normalizedStudentIds
      };
    })
    .filter((group) => {
      const key = group.name.toLowerCase();
      if (seenGroupNames.has(key)) {
        return false;
      }
      seenGroupNames.add(key);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

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
  const state = readPortalState();
  const nextAvailability = state.availability.filter((slot) => isFutureAvailabilitySlot(slot));

  if (nextAvailability.length !== state.availability.length) {
    state.availability = nextAvailability;
    writePortalState(state);
  }

  return sortByDateTime(nextAvailability);
}

function listBookings() {
  return sortByDateTime(getAuthoritativeBookings());
}

function listStudents() {
  return readPortalState().students.sort((left, right) => left.name.localeCompare(right.name));
}

function listStudentGroups() {
  return readPortalState().studentGroups
    .map((group) => ({
      ...group,
      studentIds: Array.isArray(group.studentIds) ? [...group.studentIds] : [],
      studentCount: Array.isArray(group.studentIds) ? group.studentIds.length : 0
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getStudentGroupsForStudent(studentId) {
  const normalizedStudentId = String(studentId || "").trim();
  if (!normalizedStudentId) {
    return [];
  }

  return listStudentGroups().filter((group) => group.studentIds.includes(normalizedStudentId));
}

function createStudentGroup(name) {
  const groupName = String(name || "").trim();
  if (!groupName) {
    return { ok: false, error: "Enter a group name first." };
  }

  const state = readPortalState();
  if (
    state.studentGroups.some((group) => String(group.name || "").trim().toLowerCase() === groupName.toLowerCase())
  ) {
    return { ok: false, error: "That group already exists." };
  }

  const newGroup = {
    id: buildId("group"),
    name: groupName,
    studentIds: []
  };
  state.studentGroups.push(newGroup);
  writePortalState(state);

  return { ok: true, group: newGroup };
}

function assignStudentToGroup(studentId, groupId) {
  const normalizedStudentId = String(studentId || "").trim();
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedStudentId || !normalizedGroupId) {
    return { ok: false, error: "Select a student and group first." };
  }

  const state = readPortalState();
  const student = state.students.find((entry) => entry.id === normalizedStudentId);
  if (!student) {
    return { ok: false, error: "Student not found." };
  }

  const group = state.studentGroups.find((entry) => entry.id === normalizedGroupId);
  if (!group) {
    return { ok: false, error: "Group not found." };
  }

  if (!Array.isArray(group.studentIds)) {
    group.studentIds = [];
  }

  if (group.studentIds.includes(normalizedStudentId)) {
    return { ok: true, alreadyAssigned: true, group };
  }

  group.studentIds.push(normalizedStudentId);
  writePortalState(state);

  return { ok: true, alreadyAssigned: false, group };
}

function removeStudentFromGroup(studentId, groupId) {
  const normalizedStudentId = String(studentId || "").trim();
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedStudentId || !normalizedGroupId) {
    return { ok: false, error: "Select a student and group first." };
  }

  const state = readPortalState();
  const group = state.studentGroups.find((entry) => entry.id === normalizedGroupId);
  if (!group) {
    return { ok: false, error: "Group not found." };
  }

  const beforeCount = Array.isArray(group.studentIds) ? group.studentIds.length : 0;
  group.studentIds = (group.studentIds || []).filter((id) => id !== normalizedStudentId);
  const changed = group.studentIds.length !== beforeCount;

  if (changed) {
    writePortalState(state);
  }

  return { ok: true, removed: changed, group };
}

function deleteStudentGroup(groupId) {
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedGroupId) {
    return { ok: false, error: "Group not found." };
  }

  const state = readPortalState();
  const beforeCount = state.studentGroups.length;
  state.studentGroups = state.studentGroups.filter((group) => group.id !== normalizedGroupId);

  if (state.studentGroups.length === beforeCount) {
    return { ok: false, error: "Group not found." };
  }

  writePortalState(state);
  return { ok: true };
}

function pruneStudentsByEmails(activeEmails) {
  const emailSet = new Set(
    (Array.isArray(activeEmails) ? activeEmails : [])
      .map((email) => normalizeEmail(String(email || "")))
      .filter(Boolean)
  );
  const state = readPortalState();
  const nextStudents = state.students.filter((student) => emailSet.has(normalizeEmail(student.email || "")));
  const validStudentIds = new Set(nextStudents.map((student) => student.id).filter(Boolean));
  const nextGroups = (state.studentGroups || []).map((group) => ({
    ...group,
    studentIds: Array.isArray(group.studentIds)
      ? group.studentIds.filter((studentId) => validStudentIds.has(studentId))
      : []
  }));

  const studentsChanged = nextStudents.length !== state.students.length;
  const groupsChanged = JSON.stringify(nextGroups) !== JSON.stringify(state.studentGroups || []);
  if (studentsChanged || groupsChanged) {
    state.students = nextStudents;
    state.studentGroups = nextGroups;
    writePortalState(state);
  }

  return nextStudents.sort((left, right) => left.name.localeCompare(right.name));
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
    marketingEmailOptIn: Boolean(registration.marketingEmailOptIn),
    termsAcceptedAt: registration.legalAcceptedAt || "",
    privacyAcceptedAt: registration.legalAcceptedAt || "",
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
  const candidate = { date, time };

  if (!isFutureAvailabilitySlot(candidate)) {
    return { ok: false, error: "Cannot add a slot in the past." };
  }

  const hasBooking = getAuthoritativeBookings().some((entry) => {
    return entry.date === date && entry.time === time && getBookingStatusMeta(entry.status).active;
  });
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
  const authoritativeBookings = getAuthoritativeBookings();

  slots.forEach((slot) => {
    const date = slot.date;
    const time = normalizeTimeToHour(slot.time);
    const candidate = { date, time };

    if (!isFutureAvailabilitySlot(candidate)) {
      skipped += 1;
      return;
    }

    const hasBooking = authoritativeBookings.some((entry) => {
      return entry.date === date && entry.time === time && getBookingStatusMeta(entry.status).active;
    });
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
  const bookingDate = booking.date;
  const bookingTime = normalizeTimeToHour(booking.time);

  if (!isFutureAvailabilitySlot({ date: bookingDate, time: bookingTime })) {
    return { ok: false, error: "That lesson time has already passed. Please choose a future slot." };
  }

  const existingRegistration = readRegistrations().find((registration) => {
    return normalizeEmail(registration.email) === normalizedEmail;
  }) || null;
  const matchingSlot = state.availability.find((slot) => {
    return slot.date === bookingDate && slot.time === bookingTime;
  });

  if (!matchingSlot) {
    return { ok: false, error: "That time slot is no longer available." };
  }

  state.availability = state.availability.filter((slot) => slot.id !== matchingSlot.id);

  const savedBooking = {
    id: buildId("booking"),
    studentName: booking.studentName,
    email: normalizedEmail,
    date: bookingDate,
    time: bookingTime,
    lessonType: booking.lessonType,
    message: booking.message,
    status: "pending_payment"
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
        date: bookingDate,
        time: bookingTime
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
  listStudentGroups,
  getStudentGroupsForStudent,
  createStudentGroup,
  assignStudentToGroup,
  removeStudentFromGroup,
  deleteStudentGroup,
  normalizeBookingStatus,
  getBookingStatusMeta,
  getTeacherAccessCode,
  getStudentById,
  getStudentByCredentials,
  getStudentByEmail,
  ensureStudentFromProfile,
  pruneStudentsByEmails,
  registerStudent,
  addAvailabilitySlot,
  addAvailabilitySlots,
  removeAvailabilitySlot,
  createBooking,
  updateStudentProgress
};
