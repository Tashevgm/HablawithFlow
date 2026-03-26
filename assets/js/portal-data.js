const HWF_PORTAL_STORAGE_KEY = "hwf_portal_state_v1";
const HWF_REGISTRATION_STORAGE_KEY = "hwf_registrations";

const DEFAULT_PORTAL_STATE = {
  availability: [
    { id: "slot-1", date: "2026-03-28", time: "10:00" },
    { id: "slot-2", date: "2026-03-28", time: "14:00" },
    { id: "slot-3", date: "2026-03-29", time: "11:30" },
    { id: "slot-4", date: "2026-03-31", time: "16:00" },
    { id: "slot-5", date: "2026-04-01", time: "09:30" },
    { id: "slot-6", date: "2026-04-02", time: "18:30" }
  ],
  bookings: [
    {
      id: "booking-1",
      studentName: "Maria Garcia",
      email: "maria@hablawithflow.com",
      date: "2026-03-27",
      time: "18:00",
      lessonType: "1-on-1",
      message: "Airport, hotel, and restaurant practice.",
      status: "confirmed"
    },
    {
      id: "booking-2",
      studentName: "James Patel",
      email: "james@hablawithflow.com",
      date: "2026-03-29",
      time: "15:00",
      lessonType: "1-on-1",
      message: "Presentation rehearsal and negotiation phrases.",
      status: "confirmed"
    }
  ],
  students: [
    {
      id: "student-1",
      name: "Maria Garcia",
      email: "maria@hablawithflow.com",
      accessCode: "mariaflow",
      track: "1-on-1",
      level: "A2",
      completedLessons: 8,
      totalLessons: 12,
      streak: 5,
      coachNote: "Strong listening progress. Next focus is spontaneous speaking under time pressure.",
      nextMilestone: "Order confidently and ask follow-up questions while traveling.",
      focusAreas: ["Travel conversations", "Past tense", "Confidence"],
      upcomingLessons: [
        { date: "2026-03-27", time: "18:00", topic: "1-on-1" }
      ],
      lessonHistory: [
        { date: "2026-03-20", topic: "Restaurant survival Spanish", status: "Completed" },
        { date: "2026-03-17", topic: "Directions and transport", status: "Completed" },
        { date: "2026-03-13", topic: "Confidence drills", status: "Completed" }
      ]
    },
    {
      id: "student-2",
      name: "James Patel",
      email: "james@hablawithflow.com",
      accessCode: "jamesflow",
      track: "1-on-1",
      level: "B1",
      completedLessons: 14,
      totalLessons: 20,
      streak: 7,
      coachNote: "Vocabulary is strong. We are now tightening fluency and transitions during presentations.",
      nextMilestone: "Lead a client meeting introduction without switching to English.",
      focusAreas: ["Presentation flow", "Negotiation phrases", "Pronunciation"],
      upcomingLessons: [
        { date: "2026-03-29", time: "15:00", topic: "Pitch rehearsal" }
      ],
      lessonHistory: [
        { date: "2026-03-22", topic: "Formal meeting openers", status: "Completed" },
        { date: "2026-03-18", topic: "Client objection handling", status: "Completed" },
        { date: "2026-03-14", topic: "Business vocabulary sprints", status: "Completed" }
      ]
    },
    {
      id: "student-3",
      name: "Nina Rossi",
      email: "nina@hablawithflow.com",
      accessCode: "ninaflow",
      track: "Group Classes",
      level: "A1",
      completedLessons: 4,
      totalLessons: 10,
      streak: 3,
      coachNote: "Good consistency. We are building sentence structure and speaking confidence.",
      nextMilestone: "Introduce yourself and describe daily routines with ease.",
      focusAreas: ["Introductions", "Present tense", "Listening"],
      upcomingLessons: [
        { date: "2026-04-01", time: "17:00", topic: "Daily routine speaking circle" }
      ],
      lessonHistory: [
        { date: "2026-03-19", topic: "Greetings and self-introduction", status: "Completed" },
        { date: "2026-03-15", topic: "Numbers and time", status: "Completed" }
      ]
    }
  ],
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

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
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

function createStudentProfile(booking, students) {
  const accessCode = buildUniqueAccessCode(booking.studentName, students);

  return {
    id: buildId("student"),
    name: booking.studentName,
    email: normalizeEmail(booking.email),
    accessCode,
    track: booking.lessonType,
    level: "Beginner",
    completedLessons: 0,
    totalLessons: 8,
    streak: 0,
    coachNote: "Welcome to Hablawithflow. Your first lesson is booked and your learning plan will start from there.",
    nextMilestone: "Complete your first live lesson and set your personalized speaking goals.",
    focusAreas: ["Confidence", "Conversation", booking.lessonType],
    upcomingLessons: [
      {
        date: booking.date,
        time: booking.time,
        topic: booking.lessonType
      }
    ],
    lessonHistory: []
  };
}

function upsertRegistrationFromBooking(booking) {
  const registrations = readRegistrations();
  const email = normalizeEmail(booking.email);
  const existingIndex = registrations.findIndex((registration) => {
    return normalizeEmail(registration.email) === email;
  });

  const payload = {
    name: booking.studentName,
    email,
    level: existingIndex >= 0 ? registrations[existingIndex].level || "Beginner" : "Beginner",
    track: booking.lessonType,
    timezone: existingIndex >= 0 ? registrations[existingIndex].timezone || "other" : "other",
    goal: existingIndex >= 0 ? registrations[existingIndex].goal || "Conversation" : "Conversation",
    message: booking.message,
    submittedAt: new Date().toISOString(),
    source: "booking"
  };

  if (existingIndex >= 0) {
    registrations[existingIndex] = {
      ...registrations[existingIndex],
      ...payload
    };
  } else {
    registrations.push(payload);
  }

  writeRegistrations(registrations);
}

function readPortalState() {
  const raw = localStorage.getItem(HWF_PORTAL_STORAGE_KEY);

  if (!raw) {
    const seeded = deepClone(DEFAULT_PORTAL_STATE);
    localStorage.setItem(HWF_PORTAL_STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  return JSON.parse(raw);
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

function addAvailabilitySlot(slot) {
  const state = readPortalState();
  const date = slot.date;
  const time = slot.time;

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
    const time = slot.time;

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
        ...booking,
        email: normalizedEmail
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
  });

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
  addAvailabilitySlot,
  addAvailabilitySlots,
  removeAvailabilitySlot,
  createBooking,
  updateStudentProgress
};
