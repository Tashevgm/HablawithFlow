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
let studentSidebarBound = false;
let studentMessagesConversationId = "";
let studentMessagesPartner = null;
let studentMessagesSubscription = null;
let studentMessagesRefreshTimerId = 0;
let studentMessagesBound = false;
let studentHobbyPickerBound = false;
const TEACHER_PORTAL_ROLES = new Set(["teacher", "admin"]);
const DEFAULT_PROFILE_AVATAR =
  "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=400&q=80";
const STUDENT_HOBBY_OPTIONS = [
  "Travel",
  "Music",
  "Fitness",
  "Cooking",
  "Reading",
  "Movies",
  "Dancing",
  "Art",
  "Photography",
  "Nature",
  "Hiking",
  "Coffee",
  "Food",
  "Languages",
  "Technology",
  "Business",
  "Fashion",
  "Yoga",
  "Gaming",
  "Sports",
  "Podcasts",
  "Writing",
  "Pets",
  "Culture"
];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function splitStudentCsvText(value, limit = 12) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function joinStudentCsvText(values) {
  return Array.isArray(values) ? values.filter(Boolean).join(", ") : "";
}

function isMissingSupabaseTableError(error, tableName) {
  const message = String(error?.message || "").toLowerCase();
  const normalizedTable = String(tableName || "").toLowerCase();

  return Boolean(normalizedTable) && message.includes(normalizedTable) && (
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("table")
  );
}

function normalizeStudentHobbySelection(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean)));
  }

  return Array.from(new Set(splitStudentCsvText(value, STUDENT_HOBBY_OPTIONS.length)));
}

function buildStudentHobbyPickerMarkup(context, selectedValues = []) {
  const selectedSet = new Set(normalizeStudentHobbySelection(selectedValues));

  return STUDENT_HOBBY_OPTIONS.map((option) => {
    const isSelected = selectedSet.has(option);
    return `
      <button
        class="student-hobby-chip${isSelected ? " active" : ""}"
        type="button"
        data-student-hobby-context="${context}"
        data-student-hobby-value="${option}"
        aria-pressed="${isSelected ? "true" : "false"}"
      >
        ${option}
      </button>
    `;
  }).join("");
}

function getSelectedStudentHobbies(context) {
  return Array.from(document.querySelectorAll(`[data-student-hobby-context="${context}"]`))
    .filter((button) => button.classList.contains("active"))
    .map((button) => String(button.getAttribute("data-student-hobby-value") || "").trim())
    .filter(Boolean);
}

function updateStudentHobbyPickerSummary(context) {
  const summary = byId(`student-${context}-hobbies-count`);
  if (!summary) {
    return;
  }

  const selectedCount = getSelectedStudentHobbies(context).length;
  summary.textContent =
    selectedCount >= 3
      ? `${selectedCount} hobbies selected.`
      : `Choose at least 3 hobbies. ${selectedCount}/3 selected.`;
  summary.classList.toggle("ready", selectedCount >= 3);
}

function renderStudentHobbyPicker(context, selectedValues = []) {
  const container = byId(`student-${context}-hobbies-picker`);
  if (!container) {
    return;
  }

  container.innerHTML = buildStudentHobbyPickerMarkup(context, selectedValues);
  updateStudentHobbyPickerSummary(context);
}

function bindStudentHobbyPickers() {
  if (studentHobbyPickerBound) {
    return;
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-student-hobby-context]") : null;
    if (!button) {
      return;
    }

    event.preventDefault();
    button.classList.toggle("active");
    button.setAttribute("aria-pressed", button.classList.contains("active") ? "true" : "false");
    updateStudentHobbyPickerSummary(String(button.getAttribute("data-student-hobby-context") || ""));
  });

  studentHobbyPickerBound = true;
}

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = byId(id);
  if (!node) {
    return;
  }

  node.textContent = String(value || "");
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

async function openStudentMeetingForBooking({ bookingId, date, time, triggerButton }) {
  if (!studentMeetingConfigured) {
    setStudentBookingFeedback("Meeting link is not configured yet.", "error");
    return false;
  }

  const state = getMeetingJoinState(date, time);
  if (!state.enabled) {
    setStudentBookingFeedback(
      `Join button unlocks ${studentMeetingEnableMinutesBefore} minutes before the lesson.`,
      "error"
    );
    return false;
  }

  const button = triggerButton || null;
  const originalLabel = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Opening...";
  }

  const resolvedMeetingLink = studentMeetingDynamicPerBooking
    ? await fetchStudentMeetingJoinLinkForBooking(bookingId)
    : studentMeetingJoinLink;

  if (button) {
    button.disabled = false;
    button.textContent = originalLabel || "Join Meeting";
  }

  if (!hasText(resolvedMeetingLink)) {
    setStudentBookingFeedback("Could not open meeting link right now. Please try again.", "error");
    return false;
  }

  window.open(resolvedMeetingLink, "_blank", "noopener,noreferrer");
  return true;
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

function buildStudentPersonalizationFromSources({ personalizationRow, metadata, fallbackGoal = "" }) {
  const learningGoal = String(personalizationRow?.learning_goal || metadata.student_learning_goal || metadata.goal || fallbackGoal || "").trim();
  const occupation = String(personalizationRow?.occupation || metadata.student_occupation || "").trim();
  const hobbies = String(personalizationRow?.hobbies || metadata.student_hobbies || "").trim();
  const interests = String(personalizationRow?.interests || metadata.student_interests || "").trim();
  const personalityNotes = String(personalizationRow?.personality_notes || metadata.student_personality_notes || "").trim();

  return {
    learning_goal: learningGoal || null,
    occupation: occupation || null,
    hobbies: hobbies || null,
    interests: interests || null,
    personality_notes: personalityNotes || null
  };
}

function hasStudentPersonalizationData(personalization) {
  return Boolean(
    hasText(personalization?.learning_goal) ||
      hasText(personalization?.occupation) ||
      hasText(personalization?.hobbies) ||
      hasText(personalization?.interests) ||
      hasText(personalization?.personality_notes)
  );
}

async function loadStudentExtendedProfile(student) {
  const metadata = currentSupabaseUser?.user_metadata || {};
  const userId = String(currentSupabaseUserId || student?.id || "").trim();
  const studentEmail = String(currentSupabaseUser?.email || student?.email || "").trim().toLowerCase();

  let communityProfileRow = null;
  let personalizationRow = null;

  if (window.supabaseClient && userId) {
    const [communityProfileResult, personalizationResult] = await Promise.all([
      window.supabaseClient
        .from("community_profiles")
        .select("languages, avatar_url")
        .eq("id", userId)
        .maybeSingle(),
      studentEmail
        ? window.supabaseClient
            .from("student_personalization_profiles")
            .select("learning_goal, occupation, hobbies, interests, personality_notes")
            .eq("student_email", studentEmail)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);

    if (!communityProfileResult.error || !isMissingSupabaseTableError(communityProfileResult.error, "community_profiles")) {
      communityProfileRow = communityProfileResult.data || null;
    }

    if (!personalizationResult.error || !isMissingSupabaseTableError(personalizationResult.error, "student_personalization_profiles")) {
      personalizationRow = personalizationResult.data || null;
    }
  }

  const languagesFromCommunityProfile = Array.isArray(communityProfileRow?.languages)
    ? communityProfileRow.languages.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const languages = languagesFromCommunityProfile.length
    ? languagesFromCommunityProfile
    : splitStudentCsvText(metadata.community_languages || joinStudentCsvText(student?.languages || []));
  const avatarUrl = String(communityProfileRow?.avatar_url || metadata.avatar_url || student?.avatarUrl || "").trim();
  const personalization = buildStudentPersonalizationFromSources({
    personalizationRow,
    metadata,
    fallbackGoal: student?.goal || ""
  });

  return {
    languages,
    avatarUrl,
    personalization: hasStudentPersonalizationData(personalization) ? personalization : null
  };
}

async function upsertStudentCommunityProfile({ displayName, avatarUrl, languages }) {
  if (!window.supabaseClient || !currentSupabaseUserId) {
    return { ok: false, error: new Error("Profile service is not available.") };
  }

  const existingResult = await window.supabaseClient
    .from("community_profiles")
    .select("headline, bio, location, avatar_url, is_public")
    .eq("id", currentSupabaseUserId)
    .maybeSingle();

  if (existingResult.error) {
    if (isMissingSupabaseTableError(existingResult.error, "community_profiles")) {
      return { ok: true, setupMissing: true };
    }

    return { ok: false, error: existingResult.error };
  }

  const existingRow = existingResult.data || {};
  const { error } = await window.supabaseClient.from("community_profiles").upsert(
    {
      id: currentSupabaseUserId,
      display_name: String(displayName || "Student").trim() || "Student",
      headline: String(existingRow.headline || "").trim(),
      bio: String(existingRow.bio || "").trim(),
      location: String(existingRow.location || "").trim(),
      languages,
      avatar_url: hasText(avatarUrl) ? avatarUrl : String(existingRow.avatar_url || "").trim() || null,
      is_public: existingRow.is_public !== false
    },
    {
      onConflict: "id"
    }
  );

  if (error) {
    if (isMissingSupabaseTableError(error, "community_profiles")) {
      return { ok: true, setupMissing: true };
    }

    return { ok: false, error };
  }

  return { ok: true, setupMissing: false };
}

function getStudentProfileCompletionState({
  fullName,
  timezone,
  track,
  goal,
  languages,
  occupation,
  hobbies,
  interests,
  personalityNotes,
  forceProfileCompleted = false
}) {
  const existingProfileCompleted =
    parseBooleanLike(currentSupabaseUser?.user_metadata?.profile_completed) ||
    hasText(currentSupabaseUser?.user_metadata?.profile_completed_at);
  const normalizedHobbies = normalizeStudentHobbySelection(hobbies);
  const computedProfileCompleted =
    hasText(fullName) &&
    hasText(track) &&
    hasText(goal) &&
    hasText(timezone) &&
    String(timezone || "").trim().toLowerCase() !== "other" &&
    Array.isArray(languages) &&
    languages.length > 0 &&
    hasText(occupation) &&
    normalizedHobbies.length >= 3 &&
    hasText(interests) &&
    hasText(personalityNotes);
  const nextProfileCompleted = existingProfileCompleted || forceProfileCompleted || computedProfileCompleted;

  return {
    computedProfileCompleted,
    nextProfileCompleted,
    nextProfileCompletedAt: nextProfileCompleted
      ? String(currentSupabaseUser?.user_metadata?.profile_completed_at || new Date().toISOString())
      : ""
  };
}

async function persistStudentProfileData({
  fullName,
  timezone,
  track,
  goal,
  notes,
  avatarUrl,
  languagesText,
  occupation,
  hobbies,
  interests,
  personalityNotes,
  forceProfileCompleted = false
}) {
  const normalizedFullName = String(fullName || "").trim();
  const normalizedTimezone = String(timezone || "").trim() || "other";
  const normalizedTrack = String(track || "").trim() || "1-on-1";
  const normalizedGoal = String(goal || "").trim() || "Conversation";
  const normalizedNotes = String(notes || "").trim();
  const normalizedAvatarUrl = String(avatarUrl || "").trim();
  const normalizedLanguages = splitStudentCsvText(languagesText);
  const normalizedOccupation = String(occupation || "").trim();
  const normalizedHobbies = normalizeStudentHobbySelection(hobbies);
  const normalizedInterests = String(interests || "").trim();
  const normalizedPersonalityNotes = String(personalityNotes || "").trim();

  const completionState = getStudentProfileCompletionState({
    fullName: normalizedFullName,
    timezone: normalizedTimezone,
    track: normalizedTrack,
    goal: normalizedGoal,
    languages: normalizedLanguages,
    occupation: normalizedOccupation,
    hobbies: normalizedHobbies,
    interests: normalizedInterests,
    personalityNotes: normalizedPersonalityNotes,
    forceProfileCompleted
  });

  const { error: profileError } = await window.supabaseClient
    .from("profiles")
    .update({
      full_name: normalizedFullName,
      timezone: normalizedTimezone,
      track: normalizedTrack,
      goal: normalizedGoal,
      notes: normalizedNotes
    })
    .eq("id", currentSupabaseUserId);

  if (profileError) {
    return {
      ok: false,
      error: profileError.message || "Could not save profile details."
    };
  }

  const communityProfileResult = await upsertStudentCommunityProfile({
    displayName: normalizedFullName,
    avatarUrl: normalizedAvatarUrl,
    languages: normalizedLanguages
  });

  if (!communityProfileResult.ok) {
    return {
      ok: false,
      error: communityProfileResult.error?.message || "Could not save community profile details."
    };
  }

  const metadataPayload = {
    full_name: normalizedFullName,
    timezone: normalizedTimezone,
    track: normalizedTrack,
    goal: normalizedGoal,
    notes: normalizedNotes,
    avatar_url: normalizedAvatarUrl,
    community_languages: normalizedLanguages.join(", "),
    student_learning_goal: normalizedGoal,
    student_occupation: normalizedOccupation,
    student_hobbies: normalizedHobbies.join(", "),
    student_interests: normalizedInterests,
    student_personality_notes: normalizedPersonalityNotes,
    profile_completed: completionState.nextProfileCompleted,
    profile_completed_at: completionState.nextProfileCompletedAt
  };

  const { error: authError } = await window.supabaseClient.auth.updateUser({
    data: metadataPayload
  });

  if (authError) {
    return {
      ok: false,
      error: authError.message || "Could not update profile metadata.",
      communitySetupMissing: communityProfileResult.setupMissing
    };
  }

  if (currentSupabaseUser) {
    currentSupabaseUser = {
      ...currentSupabaseUser,
      user_metadata: {
        ...(currentSupabaseUser.user_metadata || {}),
        ...metadataPayload
      }
    };
  }

  return {
    ok: true,
    communitySetupMissing: communityProfileResult.setupMissing,
    profileCompleted: completionState.nextProfileCompleted,
    data: {
      fullName: normalizedFullName,
      timezone: normalizedTimezone,
      track: normalizedTrack,
      goal: normalizedGoal,
      notes: normalizedNotes,
      avatarUrl: normalizedAvatarUrl,
      languages: normalizedLanguages,
      personalization: {
        learning_goal: normalizedGoal,
        occupation: normalizedOccupation || null,
        hobbies: normalizedHobbies.length ? normalizedHobbies.join(", ") : null,
        interests: normalizedInterests || null,
        personality_notes: normalizedPersonalityNotes || null
      }
    }
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
    resetStudentMessagesState();
    await window.supabaseClient.auth.signOut();
    closeStudentSetupModal();
    setStudentDashboardAppState(false);
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
  setStudentDashboardAppState(true);
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
  const candidateStart = parseLessonStart(date, time);
  if (!candidateStart) {
    return false;
  }

  const candidateEnd = new Date(candidateStart.getTime() + 60 * 60 * 1000);
  const bookings = Array.isArray(window.HWFServerBookings) ? window.HWFServerBookings : [];
  return bookings.some((booking) => {
    const bookingDate = normalizeIsoDateValue(booking.lesson_date || booking.date || "");
    const bookingTime = normalizeIsoTimeValue(booking.lesson_time || booking.time || "");
    const statusMeta = getBookingStatusMeta(booking.status);
    if (!statusMeta.active) {
      return false;
    }

    const bookingStart = parseLessonStart(bookingDate, bookingTime);
    if (!bookingStart) {
      return false;
    }

    const bookingEnd = new Date(bookingStart.getTime() + 60 * 60 * 1000);
    return candidateStart < bookingEnd && bookingStart < candidateEnd;
  });
}

async function hydrateStudentFromServer(student) {
  const [serverBookings, extendedProfile] = await Promise.all([
    listServerBookingsForCurrentStudent(),
    loadStudentExtendedProfile(student)
  ]);
  const firstFreeLessonBookingId = getFirstFreeLessonBookingId(serverBookings, student);

  const hydratedStudent = {
    ...student,
    languages: extendedProfile.languages.length ? extendedProfile.languages : Array.isArray(student.languages) ? student.languages : [],
    avatarUrl: extendedProfile.avatarUrl || student.avatarUrl || "",
    personalization: extendedProfile.personalization || student.personalization || null,
    goal: extendedProfile.personalization?.learning_goal || student.goal,
    notes: student.notes || ""
  };

  if (!serverBookings.length) {
    return {
      ...hydratedStudent,
      upcomingLessons: []
    };
  }

  return {
    ...hydratedStudent,
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

  const existingSameSlotForStudent = existingStudentBookings.find((booking) => {
    const bookingDate = normalizeIsoDateValue(booking.lesson_date || booking.date || "");
    const bookingTime = normalizeIsoTimeValue(booking.lesson_time || booking.time || "");
    return bookingDate === date && bookingTime === time;
  });

  if (existingSameSlotForStudent) {
    const existingStatusMeta = getBookingStatusMeta(existingSameSlotForStudent.status);
    if (existingStatusMeta.active) {
      return {
        ok: false,
        error: "You already have this lesson booked at that time."
      };
    }

    const { data: reactivatedBooking, error: reactivateError } = await window.supabaseClient
      .from("bookings")
      .update({
        student_email: email,
        student_name: studentName,
        lesson_type: lessonType,
        timezone: currentStudent && currentStudent.timezone ? currentStudent.timezone : "Europe/London",
        message,
        status: isFreeFirstLessonBooking ? "confirmed_paid" : "pending_payment"
      })
      .eq("id", existingSameSlotForStudent.id)
      .eq("student_id", currentSupabaseUserId)
      .select()
      .single();

    if (reactivateError) {
      return { ok: false, error: reactivateError.message };
    }

    return { ok: true, booking: reactivatedBooking };
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
  const feedback = byId("student-review-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `booking-feedback ${type}`;
  feedback.hidden = false;
}

function getStudentAvailabilityDates() {
  return [...new Set(window.HWFData.listBookableAvailability().map((slot) => slot.date))].sort();
}

function getStudentTimesForDate(date) {
  return window.HWFData.listBookableAvailability()
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

  if (hasText(metadata.profile_completed_at)) {
    return true;
  }

  return false;
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

function isStudentSidebarMobileMode() {
  return window.matchMedia("(max-width: 1024px)").matches;
}

function updateStudentSidebarToggleState() {
  const isExpanded = document.body.classList.contains("teacher-sidebar-open");
  document.querySelectorAll("[data-student-sidebar-toggle]").forEach((button) => {
    button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  });
}

function closeStudentSidebar() {
  document.body.classList.remove("teacher-sidebar-open");
  updateStudentSidebarToggleState();
}

function setStudentDashboardAppState(isActive) {
  document.body.classList.toggle("student-dashboard-active", Boolean(isActive));
  document.body.classList.toggle("teacher-portal-v2", Boolean(isActive));
  if (!isActive) {
    document.body.classList.remove("teacher-sidebar-open");
  }
  updateStudentSidebarToggleState();
}

function bindStudentSidebar() {
  if (studentSidebarBound) {
    updateStudentSidebarToggleState();
    return;
  }

  const toggleButtons = document.querySelectorAll("[data-student-sidebar-toggle]");
  const backdrop = byId("student-sidebar-backdrop");

  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      document.body.classList.toggle("teacher-sidebar-open");
      updateStudentSidebarToggleState();
    });
  });

  if (backdrop) {
    backdrop.addEventListener("click", () => {
      closeStudentSidebar();
    });
  }

  window.addEventListener("resize", () => {
    if (!isStudentSidebarMobileMode()) {
      document.body.classList.remove("teacher-sidebar-open");
    }
    updateStudentSidebarToggleState();
  });

  updateStudentSidebarToggleState();
  studentSidebarBound = true;
}

function setStudentPortalSection(section) {
  const normalized = String(section || "").trim().toLowerCase();
  const allowed = new Set(["book", "lessons", "progress", "community", "profile", "messages"]);
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

  if (nextSection === "messages" && currentSupabaseUserId) {
    void loadStudentMessagesConversation();
  }

  if (isStudentSidebarMobileMode()) {
    closeStudentSidebar();
  }
}

function bindStudentSectionNav() {
  if (studentSectionNavBound) {
    return;
  }

  const dashboard = document.getElementById("student-dashboard");
  if (!dashboard) {
    return;
  }

  dashboard.querySelectorAll("[data-student-section]").forEach((button) => {
    button.addEventListener("click", () => {
      setStudentPortalSection(button.getAttribute("data-student-section"));
    });
  });

  dashboard.querySelectorAll("[data-student-section-trigger]").forEach((button) => {
    button.addEventListener("click", () => {
      setStudentPortalSection(button.getAttribute("data-student-section-trigger"));
    });
  });

  const statusJoinButton = byId("student-status-join");
  if (statusJoinButton) {
    statusJoinButton.addEventListener("click", async () => {
      const bookingId = String(statusJoinButton.getAttribute("data-booking-id") || "").trim();
      const date = String(statusJoinButton.getAttribute("data-lesson-date") || "");
      const time = String(statusJoinButton.getAttribute("data-lesson-time") || "");
      await openStudentMeetingForBooking({ bookingId, date, time, triggerButton: statusJoinButton });
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
  const languagesInput = document.getElementById("student-setup-languages");
  const occupationInput = document.getElementById("student-setup-occupation");
  const hobbiesPicker = document.getElementById("student-setup-hobbies-picker");
  const interestsInput = document.getElementById("student-setup-interests");
  const personalityInput = document.getElementById("student-setup-personality");
  const feedback = document.getElementById("student-setup-feedback");

  if (
    !modal ||
    !nameInput ||
    !timezoneSelect ||
    !trackInput ||
    !goalSelect ||
    !languagesInput ||
    !occupationInput ||
    !hobbiesPicker ||
    !interestsInput ||
    !personalityInput ||
    !feedback
  ) {
    return;
  }

  const metadata = currentSupabaseUser?.user_metadata || {};
  const personalization = student?.personalization || buildStudentPersonalizationFromSources({
    personalizationRow: null,
    metadata,
    fallbackGoal: student?.goal || ""
  });
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
  const seededGoal = String(personalization.learning_goal || student?.goal || metadata.goal || "Free trial lesson").trim();

  nameInput.value = seededName;
  trackInput.value = seededTrack;
  setSelectValue(timezoneSelect, seededTimezone);
  setSelectValue(goalSelect, seededGoal);
  languagesInput.value = joinStudentCsvText(student?.languages || splitStudentCsvText(metadata.community_languages || ""));
  occupationInput.value = String(personalization.occupation || "").trim();
  renderStudentHobbyPicker("setup", normalizeStudentHobbySelection(personalization.hobbies || ""));
  interestsInput.value = String(personalization.interests || "").trim();
  personalityInput.value = String(personalization.personality_notes || "").trim();
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

  setStudentPortalSection("profile");
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
  const languagesInput = document.getElementById("student-profile-languages-input");
  const occupationInput = document.getElementById("student-profile-occupation-input");
  const hobbiesPicker = document.getElementById("student-profile-hobbies-picker");
  const interestsInput = document.getElementById("student-profile-interests-input");
  const personalityInput = document.getElementById("student-profile-personality-input");
  const notesInput = document.getElementById("student-profile-notes-input");
  const avatarInput = document.getElementById("student-profile-avatar-url");
  const preview = document.getElementById("student-profile-avatar-preview");

  if (
    !nameInput ||
    !timezoneInput ||
    !trackInput ||
    !goalInput ||
    !languagesInput ||
    !occupationInput ||
    !hobbiesPicker ||
    !interestsInput ||
    !personalityInput ||
    !notesInput ||
    !avatarInput ||
    !preview
  ) {
    return;
  }

  const metadata = currentSupabaseUser?.user_metadata || {};
  const personalization = student?.personalization || buildStudentPersonalizationFromSources({
    personalizationRow: null,
    metadata,
    fallbackGoal: student?.goal || ""
  });
  const avatarUrl = String(student?.avatarUrl || metadata.avatar_url || "").trim();

  nameInput.value = student.name || "";
  setSelectValue(timezoneInput, student.timezone || "");
  trackInput.value = student.track || "";
  setSelectValue(goalInput, student.goal || "");
  languagesInput.value = joinStudentCsvText(student.languages || splitStudentCsvText(metadata.community_languages || ""));
  occupationInput.value = String(personalization.occupation || "").trim();
  renderStudentHobbyPicker("profile", normalizeStudentHobbySelection(personalization.hobbies || ""));
  interestsInput.value = String(personalization.interests || "").trim();
  personalityInput.value = String(personalization.personality_notes || "").trim();
  notesInput.value = student.notes || "";
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

function getApiBaseUrl() {
  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";
  return configuredApiBase || window.location.origin;
}

function escapeStudentMessageHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };

  return String(text || "").replace(/[&<>"']/g, (character) => map[character]);
}

async function getStudentPortalAccessToken() {
  if (!window.supabaseClient) {
    return "";
  }

  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();

  return session?.access_token || "";
}

async function authorizedStudentPortalFetch(url, options = {}) {
  const accessToken = await getStudentPortalAccessToken();
  if (!accessToken) {
    throw new Error("Your session expired. Please sign in again.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(url, {
    ...options,
    headers
  });
}

function clearStudentMessagesSubscription() {
  if (!studentMessagesSubscription || !window.supabaseClient) {
    studentMessagesSubscription = null;
    return;
  }

  window.supabaseClient.removeChannel(studentMessagesSubscription);
  studentMessagesSubscription = null;
}

function stopStudentMessagesPolling() {
  if (!studentMessagesRefreshTimerId) {
    return;
  }

  window.clearInterval(studentMessagesRefreshTimerId);
  studentMessagesRefreshTimerId = 0;
}

function startStudentMessagesPolling() {
  stopStudentMessagesPolling();
  studentMessagesRefreshTimerId = window.setInterval(() => {
    if (!studentMessagesConversationId) {
      return;
    }

    void loadStudentConversationMessages();
  }, 5000);
}

function resetStudentMessagesState() {
  studentMessagesConversationId = "";
  studentMessagesPartner = null;
  clearStudentMessagesSubscription();
  stopStudentMessagesPolling();

  const container = byId("student-messages-container");
  if (container) {
    container.dataset.messagesReady = "0";
    container.innerHTML = '<p style="color: #999; text-align: center;">Loading messages...</p>';
  }

  studentMessagesBound = false;
}

function ensureStudentMessagesLayout() {
  const container = byId("student-messages-container");
  if (!container) {
    return null;
  }

  if (container.dataset.messagesReady === "1") {
    return container;
  }

  container.dataset.messagesReady = "1";
  container.innerHTML = `
    <div class="messages-shell student-messages-shell">
      <div class="messages-container whatsapp-layout student-messages-layout">
        <div class="messages-content whatsapp-chat-content">
          <div class="chat-empty whatsapp-chat-empty" id="student-chat-empty">
            <div>
              <div class="chat-empty-icon">M</div>
              <p class="chat-empty-title">Chat with your teacher</p>
              <p class="chat-empty-text" id="student-chat-empty-text">Open this section to start a direct conversation.</p>
            </div>
          </div>

          <div class="chat-thread whatsapp-chat-thread" id="student-chat-thread" hidden>
            <div class="chat-header whatsapp-chat-header">
              <div class="whatsapp-chat-person">
                <div class="whatsapp-chat-avatar" id="student-chat-user-avatar">T</div>
                <div>
                  <h3 id="student-chat-user-name">Teacher</h3>
                  <p id="student-chat-user-role" class="chat-user-role"></p>
                </div>
              </div>
            </div>

            <div class="chat-messages-scroll whatsapp-chat-scroll" id="student-chat-messages-scroll">
              <div class="chat-messages" id="student-chat-messages"></div>
            </div>

            <div class="chat-input-area whatsapp-chat-input-area">
              <div class="booking-feedback" id="student-message-error" hidden></div>
              <div class="chat-input-form whatsapp-composer">
                <textarea id="student-message-input" class="message-textarea" placeholder="Type a message..." rows="2"></textarea>
                <button id="student-send-message-btn" class="btn-submit" type="button">Send</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  bindStudentMessagesSection();
  return container;
}

function setStudentMessagesFeedback(message, type) {
  const feedback = byId("student-message-error");
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

function createStudentPortalMessageElement(message) {
  const element = document.createElement("div");
  const isOwn = String(message?.sender_id || "") === String(currentSupabaseUserId || "");
  const timestamp = new Date(message.created_at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });

  element.className = `message ${isOwn ? "sent" : "received"}`;
  element.innerHTML = `
    <div class="message-content">${escapeStudentMessageHtml(message?.body || "")}</div>
    <div class="message-time">${timestamp}</div>
  `;

  return element;
}

function renderStudentMessagesFromPayload({ partner, messages }) {
  ensureStudentMessagesLayout();

  const chatEmpty = byId("student-chat-empty");
  const chatThread = byId("student-chat-thread");
  const chatUserName = byId("student-chat-user-name");
  const chatUserRole = byId("student-chat-user-role");
  const chatUserAvatar = byId("student-chat-user-avatar");
  const messagesContainer = byId("student-chat-messages");
  const scroll = byId("student-chat-messages-scroll");
  const resolvedPartner = partner || studentMessagesPartner || null;

  if (chatEmpty) {
    chatEmpty.hidden = true;
  }
  if (chatThread) {
    chatThread.hidden = false;
  }
  if (chatUserName) {
    chatUserName.textContent = resolvedPartner?.name || "Teacher";
  }
  if (chatUserRole) {
    chatUserRole.textContent = resolvedPartner?.subtitle || "Spanish Teacher";
  }
  if (chatUserAvatar) {
    chatUserAvatar.textContent = String(resolvedPartner?.avatar || resolvedPartner?.name || "T").trim().charAt(0).toUpperCase() || "T";
  }

  if (!messagesContainer) {
    return;
  }

  messagesContainer.innerHTML = "";
  if (!Array.isArray(messages) || !messages.length) {
    messagesContainer.innerHTML =
      '<div style="text-align: center; color: #7d6c61; padding: 40px; font-size: 0.9rem;">No messages yet. Say hello to start the conversation.</div>';
    return;
  }

  messages.forEach((message) => {
    messagesContainer.appendChild(createStudentPortalMessageElement(message));

    const unreadByStudent =
      String(message?.sender_id || "") !== String(currentSupabaseUserId || "") &&
      !message?.message_read_status?.some((status) => String(status?.reader_id || "") === String(currentSupabaseUserId || ""));

    if (unreadByStudent) {
      void markStudentPortalMessageAsRead(message.id);
    }
  });

  if (scroll) {
    scroll.scrollTop = scroll.scrollHeight;
  }
}

async function markStudentPortalMessageAsRead(messageId) {
  try {
    await authorizedStudentPortalFetch(`${getApiBaseUrl()}/api/messages/${encodeURIComponent(String(messageId || ""))}/read`, {
      method: "POST"
    });
  } catch {}
}

async function loadStudentConversationMessages() {
  if (!studentMessagesConversationId) {
    return;
  }

  try {
    const response = await authorizedStudentPortalFetch(
      `${getApiBaseUrl()}/api/messages/conversations/${encodeURIComponent(studentMessagesConversationId)}`
    );
    const payload = await response.json().catch(() => ({
      ok: false,
      error: `Failed to load messages (${response.status}).`
    }));

    if (!response.ok || payload?.ok !== true) {
      throw new Error(String(payload?.error || payload?.message || `Failed to load messages (${response.status}).`));
    }

    renderStudentMessagesFromPayload({
      partner: studentMessagesPartner,
      messages: payload.messages || []
    });
  } catch (error) {
    setStudentMessagesFeedback(error instanceof Error ? error.message : "Could not load messages right now.", "error");
  }
}

function subscribeToStudentMessages() {
  if (!studentMessagesConversationId || !window.supabaseClient) {
    return;
  }

  clearStudentMessagesSubscription();
  studentMessagesSubscription = window.supabaseClient
    .channel(`student-messages:${studentMessagesConversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${studentMessagesConversationId}`
      },
      () => {
        void loadStudentConversationMessages();
      }
    )
    .subscribe();
}

async function loadStudentMessagesConversation() {
  ensureStudentMessagesLayout();

  const emptyState = byId("student-chat-empty");
  const emptyText = byId("student-chat-empty-text");
  const thread = byId("student-chat-thread");
  if (emptyState) {
    emptyState.hidden = false;
  }
  if (thread) {
    thread.hidden = true;
  }
  if (emptyText) {
    emptyText.textContent = "Loading conversation...";
  }

  setStudentMessagesFeedback("", "success");

  try {
    const response = await authorizedStudentPortalFetch(`${getApiBaseUrl()}/api/messages/default-conversation`);
    const payload = await response.json().catch(() => ({
      ok: false,
      error: `Failed to open chat (${response.status}).`
    }));

    if (!response.ok || payload?.ok !== true || !payload?.conversation?.id) {
      throw new Error(String(payload?.error || payload?.message || `Failed to open chat (${response.status}).`));
    }

    studentMessagesConversationId = String(payload.conversation.id || "").trim();
    studentMessagesPartner = payload.partner || null;
    renderStudentMessagesFromPayload({
      partner: studentMessagesPartner,
      messages: payload.messages || []
    });
    subscribeToStudentMessages();
    startStudentMessagesPolling();
  } catch (error) {
    if (emptyText) {
      emptyText.textContent = error instanceof Error ? error.message : "Chat is not available right now.";
    }
    setStudentMessagesFeedback(error instanceof Error ? error.message : "Could not open chat right now.", "error");
  }
}

async function sendStudentPortalMessage() {
  if (!studentMessagesConversationId) {
    await loadStudentMessagesConversation();
  }

  const input = byId("student-message-input");
  const sendButton = byId("student-send-message-btn");
  if (!input || !sendButton || !studentMessagesConversationId) {
    return;
  }

  const body = String(input.value || "").trim();
  if (!body) {
    return;
  }

  sendButton.disabled = true;
  setStudentMessagesFeedback("", "success");

  try {
    const response = await authorizedStudentPortalFetch(`${getApiBaseUrl()}/api/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId: studentMessagesConversationId,
        body
      })
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      error: `Failed to send message (${response.status}).`
    }));

    if (!response.ok || payload?.ok !== true) {
      throw new Error(String(payload?.error || payload?.message || `Failed to send message (${response.status}).`));
    }

    input.value = "";
    input.style.height = "auto";
    await loadStudentConversationMessages();
  } catch (error) {
    setStudentMessagesFeedback(error instanceof Error ? error.message : "Could not send your message.", "error");
  } finally {
    sendButton.disabled = false;
  }
}

function bindStudentMessagesSection() {
  if (studentMessagesBound) {
    return;
  }

  const sendButton = byId("student-send-message-btn");
  const input = byId("student-message-input");
  if (!sendButton || !input) {
    return;
  }

  sendButton.addEventListener("click", () => {
    void sendStudentPortalMessage();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendStudentPortalMessage();
    }
  });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });

  studentMessagesBound = true;
}

async function requestStripeCheckoutSession(url, accessToken, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({
    ok: false,
    error: `Stripe checkout failed with status ${response.status}.`
  }));

  if (!response.ok || !data?.ok || !data?.url) {
    throw new Error(data?.error || `Stripe checkout failed with status ${response.status}.`);
  }

  return String(data.url);
}

async function createStripeCheckoutSession(bookingId) {
  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Your session expired. Please sign in again.");
  }

  const backendUrl = `${getApiBaseUrl()}/api/booking/stripe/create-session`;
  try {
    return await requestStripeCheckoutSession(backendUrl, session.access_token, {
      bookingId
    });
  } catch (backendError) {
    const edgeUrl = `${getFunctionsBaseUrl()}/create-checkout-session`;
    try {
      return await requestStripeCheckoutSession(edgeUrl, session.access_token, {
        booking_id: bookingId
      });
    } catch (edgeError) {
      const backendMessage = backendError instanceof Error ? backendError.message : "";
      const edgeMessage = edgeError instanceof Error ? edgeError.message : "";
      if (hasText(backendMessage) && hasText(edgeMessage) && backendMessage !== edgeMessage) {
        throw new Error(`${backendMessage} Fallback error: ${edgeMessage}`);
      }
      throw new Error(edgeMessage || backendMessage || "Could not open Stripe checkout.");
    }
  }
}

async function confirmStripeCheckoutSession(sessionId) {
  const apiBase = getApiBaseUrl();
  const fallbackUrl = `${apiBase}/api/booking/stripe/confirm-session-public`;

  async function requestConfirmation(url, accessToken) {
    const headers = {
      "Content-Type": "application/json"
    };
    if (hasText(accessToken)) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
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

  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();
  const accessToken = session?.access_token || "";
  const authUrl = `${apiBase}/api/booking/stripe/confirm-session`;
  if (hasText(accessToken)) {
    try {
      return await requestConfirmation(authUrl, accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const canFallback =
        /missing session token|invalid or expired session token|session expired|401|403/i.test(message) || !hasText(message);
      if (!canFallback) {
        throw error;
      }
    }
  }

  return requestConfirmation(fallbackUrl, "");
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
  caption.textContent = `${formatStudentLongDate(selectedStudentBookingDate)} has ${times.length} available 1-hour start time${times.length === 1 ? "" : "s"}.`;

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
  const reviewName = byId("student-review-name");
  const reviewTrack = byId("student-review-track");
  const reviewRole = byId("student-review-role");
  const reviewText = byId("student-review-text");
  const reviewSubmit = byId("student-review-submit");
  const feedback = byId("student-review-feedback");
  if (!reviewName || !reviewTrack || !reviewRole || !reviewText || !reviewSubmit || !feedback) {
    return;
  }

  const existingReview = findStudentReview(student);

  reviewName.value = student.name;
  reviewTrack.value = student.track;
  reviewRole.value = existingReview ? existingReview.role || "" : "";
  reviewText.value = existingReview ? existingReview.text : "";
  reviewSubmit.textContent = existingReview ? "Update Review" : "Submit Review";

  selectedStudentRating = existingReview ? existingReview.rating : 0;
  setStudentStarPreview(selectedStudentRating);

  feedback.hidden = true;
}

function renderStudentDashboard(student) {
  currentStudent = student;

  const totalLessons = Math.max(Number(student.totalLessons) || 0, 1);
  const progressPercent = Math.max(0, Math.min(100, Math.round(((Number(student.completedLessons) || 0) / totalLessons) * 100)));
  const nextLesson = student.upcomingLessons.length ? student.upcomingLessons[0] : null;
  const nextJoinLesson =
    studentMeetingConfigured &&
    Array.isArray(student.upcomingLessons)
      ? student.upcomingLessons.find((lesson) => lesson.status === "free_first_lesson" || lesson.status === "confirmed_paid") || null
      : null;
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

  setText("student-topbar-name", student.name || "Student");
  setText("student-topbar-track", `${student.track} • Level ${student.level}`);
  setText("student-dashboard-title", `Welcome back, ${student.name}`);
  setText("student-summary-caption", summaryCaption);
  setText("student-next-lesson-summary", nextLessonSummary);
  setText("student-payment-summary", paymentSummary);
  setText("student-focus-summary", primaryFocus);
  setText("student-name-heading", "Progress");
  setText("student-track-label", student.track);
  setText("student-level-label", `Level ${student.level}`);
  setText("student-progress-count", student.completedLessons);
  setText("student-progress-caption", `out of ${student.totalLessons} planned lessons`);
  setText("student-streak-label", student.streak);
  setText("student-progress-percent", `${progressPercent}%`);
  setText("student-milestone", student.nextMilestone);
  setText("student-note", buildStudentCoachNote(student, nextLesson));

  const progressBar = byId("student-progress-bar");
  if (progressBar) {
    progressBar.style.width = `${progressPercent}%`;
  }

  const focusContainer = byId("student-focus");
  if (focusContainer) {
    focusContainer.innerHTML = student.focusAreas
      .map((area) => `<span class="focus-chip">${area}</span>`)
      .join("");
  }

  const statusJoinButton = byId("student-status-join");
  if (statusJoinButton) {
    if (nextJoinLesson) {
      statusJoinButton.hidden = false;
      statusJoinButton.setAttribute("data-booking-id", String(nextJoinLesson.id || ""));
      statusJoinButton.setAttribute("data-lesson-date", String(nextJoinLesson.date || ""));
      statusJoinButton.setAttribute("data-lesson-time", String(nextJoinLesson.time || ""));
    } else {
      statusJoinButton.hidden = true;
      statusJoinButton.setAttribute("data-booking-id", "");
      statusJoinButton.setAttribute("data-lesson-date", "");
      statusJoinButton.setAttribute("data-lesson-time", "");
      statusJoinButton.disabled = true;
      statusJoinButton.textContent = "Join Meeting";
    }
  }

  const upcomingContainer = byId("student-upcoming");
  if (!upcomingContainer) {
    renderStudentBookingSection();
    setStudentPortalSection(activeStudentPortalSection);
    updateStudentMeetingButtons();
    return;
  }
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
        const bookingId = String(meetingButton.getAttribute("data-booking-id") || "").trim();
        const date = String(meetingButton.getAttribute("data-lesson-date") || "");
        const time = String(meetingButton.getAttribute("data-lesson-time") || "");
        await openStudentMeetingForBooking({ bookingId, date, time, triggerButton: meetingButton });
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
    const languagesText = document.getElementById("student-profile-languages-input").value.trim();
    const occupation = document.getElementById("student-profile-occupation-input").value.trim();
    const hobbies = getSelectedStudentHobbies("profile");
    const interests = document.getElementById("student-profile-interests-input").value.trim();
    const personalityNotes = document.getElementById("student-profile-personality-input").value.trim();
    const notes = document.getElementById("student-profile-notes-input").value.trim();
    const avatarUrl = document.getElementById("student-profile-avatar-url").value.trim();

    if (!fullName) {
      setStudentProfileFeedback("Full name is required.", "error");
      return;
    }

    if (hobbies.length < 3) {
      setStudentProfileFeedback("Choose at least 3 hobbies.", "error");
      return;
    }

    saveButton.disabled = true;
    try {
      const saveResult = await persistStudentProfileData({
        fullName,
        timezone,
        track,
        goal,
        notes,
        avatarUrl,
        languagesText,
        occupation,
        hobbies,
        interests,
        personalityNotes
      });

      if (!saveResult.ok) {
        setStudentProfileFeedback(saveResult.error || "Could not save profile details.", "error");
        return;
      }

      const hydratedStudent = await hydrateStudentFromServer({
        ...currentStudent,
        name: saveResult.data.fullName,
        track: saveResult.data.track,
        timezone: saveResult.data.timezone,
        goal: saveResult.data.goal,
        notes: saveResult.data.notes,
        avatarUrl: saveResult.data.avatarUrl,
        languages: saveResult.data.languages,
        personalization: saveResult.data.personalization
      });
      renderStudentDashboard(hydratedStudent);

      setStudentProfileFeedback(
        saveResult.profileCompleted
          ? "Profile updated. Your teacher can now use these details to personalize lessons."
          : "Profile saved. Complete the remaining fields to finish your setup.",
        "success"
      );
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
    const languagesText = String(document.getElementById("student-setup-languages")?.value || "").trim();
    const occupation = String(document.getElementById("student-setup-occupation")?.value || "").trim();
    const hobbies = getSelectedStudentHobbies("setup");
    const interests = String(document.getElementById("student-setup-interests")?.value || "").trim();
    const personalityNotes = String(document.getElementById("student-setup-personality")?.value || "").trim();

    if (!fullName || !timezone || !track || !goal || !splitStudentCsvText(languagesText).length || !occupation || hobbies.length < 3 || !interests || !personalityNotes) {
      setStudentSetupFeedback("Please complete every field so your teacher has enough context to personalize lessons.", "error");
      return;
    }

    saveButton.disabled = true;
    try {
      const saveResult = await persistStudentProfileData({
        fullName,
        timezone,
        track,
        goal,
        notes: currentStudent.notes || "",
        avatarUrl: currentStudent.avatarUrl || currentSupabaseUser?.user_metadata?.avatar_url || "",
        languagesText,
        occupation,
        hobbies,
        interests,
        personalityNotes,
        forceProfileCompleted: true
      });

      if (!saveResult.ok) {
        setStudentSetupFeedback(saveResult.error || "Could not finish setup.", "error");
        return;
      }

      const refreshedStudent = await hydrateStudentFromServer({
        ...currentStudent,
        name: saveResult.data.fullName,
        timezone: saveResult.data.timezone,
        track: saveResult.data.track,
        goal: saveResult.data.goal,
        notes: saveResult.data.notes,
        avatarUrl: saveResult.data.avatarUrl,
        languages: saveResult.data.languages,
        personalization: saveResult.data.personalization
      });
      activeStudentPortalSection = "profile";
      renderStudentDashboard(refreshedStudent);
      closeStudentSetupModal();
      setStudentProfileFeedback("Profile setup saved. Your teacher can now personalize your lessons better.", "success");
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

    const lessonBlockTimes = window.HWFData.getLessonBlockTimes(bookingPayload.time);
    window.HWFData
      .listAvailability()
      .filter((slot) => slot.date === bookingPayload.date && lessonBlockTimes.includes(slot.time))
      .forEach((slot) => {
        window.HWFData.removeAvailabilitySlot(slot.id);
      });

    document.getElementById("student-booking-message").value = "";
    await loadActiveServerBookingsForAvailability();
    const refreshedStudent = await hydrateStudentFromServer(currentStudent);
    renderStudentDashboard(refreshedStudent);
    const bookedLesson = refreshedStudent.upcomingLessons.find((lesson) => {
      return String(lesson.id) === String(serverResult.booking.id);
    });
    const savedBookingStatus = getBookingStatusMeta(serverResult.booking.status).value;
    const shouldSendConfirmedBookingEmail =
      Boolean(bookedLesson && bookedLesson.isFreeFirstLesson) || savedBookingStatus === "confirmed_paid";

    let emailErrorMessage = "";

    if (!window.HWFEmailApi) {
      emailErrorMessage = "Email service is not loaded on this page.";
    } else {
      try {
        if (shouldSendConfirmedBookingEmail) {
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
      shouldSendConfirmedBookingEmail
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
  const reviewSubmitButton = byId("student-review-submit");
  if (!reviewSubmitButton) {
    return;
  }

  document.querySelectorAll(".student-sp-star").forEach((star) => {
    star.addEventListener("mouseover", () => setStudentStarPreview(Number(star.dataset.val)));
    star.addEventListener("focus", () => setStudentStarPreview(Number(star.dataset.val)));
    star.addEventListener("mouseout", () => setStudentStarPreview(selectedStudentRating));
    star.addEventListener("blur", () => setStudentStarPreview(selectedStudentRating));
    star.addEventListener("click", () => {
      selectedStudentRating = Number(star.dataset.val);
      setStudentStarPreview(selectedStudentRating);
      const reviewFeedback = byId("student-review-feedback");
      if (reviewFeedback) {
        reviewFeedback.hidden = true;
      }
    });
  });

  reviewSubmitButton.addEventListener("click", () => {
    if (!currentStudent) {
      return;
    }

    const roleInput = byId("student-review-role");
    const textInput = byId("student-review-text");
    if (!roleInput || !textInput) {
      return;
    }

    const role = roleInput.value.trim();
    const text = textInput.value.trim();

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
    resetStudentMessagesState();
    activeStudentPortalSection = "book";
    selectedStudentRating = 0;
    selectedStudentBookingDate = "";
    selectedStudentBookingTime = "";
    await window.supabaseClient.auth.signOut();
    closeStudentSetupModal();
    setStudentDashboardAppState(false);
    document.getElementById("student-login-card").hidden = false;
    document.getElementById("student-dashboard").hidden = true;
    document.getElementById("student-email").value = "";
    document.getElementById("student-password").value = "";
    const reviewFeedback = byId("student-review-feedback");
    if (reviewFeedback) {
      reviewFeedback.hidden = true;
    }
    document.getElementById("student-booking-feedback").hidden = true;
    document.getElementById("student-login-feedback").hidden = true;
    document.getElementById("student-booking-message").value = "";
    setStudentStarPreview(0);
  });
}

function initStudentPortal() {
  window.HWFData.ensurePortalState();
  startStudentMeetingTicker();
  bindStudentHobbyPickers();
  renderStudentHobbyPicker("profile", []);
  renderStudentHobbyPicker("setup", []);
  bindStudentSectionNav();
  bindStudentSidebar();
  setStudentDashboardAppState(false);
  bindStudentLogin();
  bindStudentProfileEditor();
  bindStudentSetupModal();
  bindStudentBookingSection();
  bindStudentReviewForm();
  openStudentDashboardFromSession();
}

initStudentPortal();
