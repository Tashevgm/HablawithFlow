const MY_PROFILE_AVATAR_BUCKET = "community-avatars";
const MY_PROFILE_DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=400&q=80";
const TEACHER_ROLES = new Set(["teacher", "admin"]);

let myProfileUser = null;
let pendingAvatarFile = null;

function byId(id) {
  return document.getElementById(id);
}

function required(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function setFeedback(id, message, type) {
  const el = byId(id);
  if (!el) {
    return;
  }

  el.textContent = message;
  el.className = `booking-feedback ${type}`;
  el.hidden = false;
}

function clearFeedback(id) {
  const el = byId(id);
  if (!el) {
    return;
  }

  el.hidden = true;
  el.textContent = "";
}

function splitLanguages(textValue) {
  return String(textValue || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function joinLanguages(values) {
  return Array.isArray(values) ? values.filter(Boolean).join(", ") : "";
}

function normalizeCommunityProfileRow(row, user) {
  const metadata = user?.user_metadata || {};
  const baseName =
    String(row?.display_name || metadata.full_name || metadata.name || user?.email?.split("@")[0] || "Student").trim();
  const headline = String(row?.headline || metadata.community_headline || "").trim();
  const location = String(row?.location || metadata.community_location || "").trim();
  const bio = String(row?.bio || metadata.community_bio || "").trim();
  const avatarUrl = String(row?.avatar_url || metadata.avatar_url || "").trim();
  const languages = Array.isArray(row?.languages) ? row.languages : splitLanguages(metadata.community_languages || "");
  const visibility = row?.is_public === false || metadata.community_visibility === "private" ? "private" : "public";

  return {
    displayName: baseName,
    headline,
    location,
    bio,
    avatarUrl,
    languages,
    visibility
  };
}

async function resolvePortalRole(user) {
  const metadataRole = normalizeRole(user?.user_metadata?.role || user?.app_metadata?.role || "");
  if (TEACHER_ROLES.has(metadataRole)) {
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

  const profileRole = profileResult.error ? "" : normalizeRole(profileResult.data?.role || "");
  if (TEACHER_ROLES.has(profileRole)) {
    return profileRole;
  }

  if (!teacherProfileResult.error && teacherProfileResult.data?.id) {
    return "teacher";
  }

  return profileRole || metadataRole || "student";
}

async function loadCommunityProfile(user) {
  const { data, error } = await window.supabaseClient
    .from("community_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if (
      String(error.message || "").toLowerCase().includes("community_profiles") ||
      String(error.message || "").toLowerCase().includes("does not exist")
    ) {
      return { row: null, setupMissing: true };
    }
    return { row: null, setupMissing: false, error };
  }

  return { row: data || null, setupMissing: false };
}

function updateProfileCardPreview() {
  const name = byId("my-profile-name").value.trim() || "Student";
  const headline = byId("my-profile-headline").value.trim() || "Add a short headline.";
  const location = byId("my-profile-location").value.trim() || "Location not set";
  const currentAvatar = byId("my-profile-avatar-preview").src || MY_PROFILE_DEFAULT_AVATAR;

  byId("my-profile-card-name").textContent = name;
  byId("my-profile-card-headline").textContent = headline;
  byId("my-profile-card-location").textContent = location;
  byId("my-profile-avatar-preview").src = currentAvatar;
}

function bindLivePreview() {
  ["my-profile-name", "my-profile-headline", "my-profile-location"].forEach((id) => {
    const input = byId(id);
    if (!input) {
      return;
    }
    input.addEventListener("input", () => {
      updateProfileCardPreview();
    });
  });
}

function renderProfileForm(profile) {
  byId("my-profile-name").value = profile.displayName || "";
  byId("my-profile-headline").value = profile.headline || "";
  byId("my-profile-location").value = profile.location || "";
  byId("my-profile-languages").value = joinLanguages(profile.languages);
  byId("my-profile-bio").value = profile.bio || "";
  byId("my-profile-visibility").value = profile.visibility || "public";

  byId("my-profile-avatar-preview").src = required(profile.avatarUrl) ? profile.avatarUrl : MY_PROFILE_DEFAULT_AVATAR;
  updateProfileCardPreview();
}

async function upsertCommunityProfile(profilePayload) {
  const { error } = await window.supabaseClient.from("community_profiles").upsert(profilePayload, {
    onConflict: "id"
  });

  return { ok: !error, error };
}

async function saveProfile() {
  clearFeedback("my-profile-feedback");

  const displayName = byId("my-profile-name").value.trim();
  if (!displayName) {
    setFeedback("my-profile-feedback", "Display name is required.", "error");
    return;
  }

  const payload = {
    id: myProfileUser.id,
    display_name: displayName,
    headline: byId("my-profile-headline").value.trim(),
    location: byId("my-profile-location").value.trim(),
    bio: byId("my-profile-bio").value.trim(),
    languages: splitLanguages(byId("my-profile-languages").value),
    is_public: byId("my-profile-visibility").value !== "private"
  };

  const saveResult = await upsertCommunityProfile(payload);
  if (!saveResult.ok) {
    const msg = String(saveResult.error?.message || "");
    if (msg.toLowerCase().includes("community_profiles")) {
      setFeedback(
        "my-profile-feedback",
        "Community setup is missing. Run supabase/community_profiles_setup.sql first.",
        "error"
      );
      return;
    }
    setFeedback("my-profile-feedback", saveResult.error?.message || "Could not save profile.", "error");
    return;
  }

  await window.supabaseClient.auth.updateUser({
    data: {
      full_name: displayName,
      community_headline: payload.headline,
      community_location: payload.location,
      community_bio: payload.bio,
      community_languages: payload.languages.join(", "),
      community_visibility: payload.is_public ? "public" : "private"
    }
  });

  await window.supabaseClient
    .from("profiles")
    .update({
      full_name: displayName
    })
    .eq("id", myProfileUser.id);

  updateProfileCardPreview();
  setFeedback("my-profile-feedback", "Profile saved.", "success");
}

function getExtensionForMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  return "jpg";
}

async function uploadAvatar() {
  clearFeedback("my-profile-avatar-feedback");

  if (!pendingAvatarFile) {
    setFeedback("my-profile-avatar-feedback", "Choose an image first.", "error");
    return;
  }

  if (pendingAvatarFile.size > 4 * 1024 * 1024) {
    setFeedback("my-profile-avatar-feedback", "Image must be 4MB or smaller.", "error");
    return;
  }

  const file = pendingAvatarFile;
  const ext = getExtensionForMime(file.type);
  const path = `${myProfileUser.id}/avatar.${ext}`;
  const uploadResult = await window.supabaseClient.storage
    .from(MY_PROFILE_AVATAR_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || undefined
    });

  if (uploadResult.error) {
    const message = String(uploadResult.error.message || "");
    if (message.toLowerCase().includes("bucket")) {
      setFeedback(
        "my-profile-avatar-feedback",
        "Avatar storage is not ready. Run supabase/community_profiles_setup.sql first.",
        "error"
      );
      return;
    }
    setFeedback("my-profile-avatar-feedback", uploadResult.error.message, "error");
    return;
  }

  const { data: publicData } = window.supabaseClient.storage.from(MY_PROFILE_AVATAR_BUCKET).getPublicUrl(path);
  const avatarUrl = `${publicData.publicUrl}?v=${Date.now()}`;
  const displayNameFallback =
    byId("my-profile-name").value.trim() ||
    String(myProfileUser?.user_metadata?.full_name || myProfileUser?.email?.split("@")[0] || "Student").trim();

  const updateResult = await upsertCommunityProfile({
    id: myProfileUser.id,
    display_name: displayNameFallback,
    avatar_url: avatarUrl
  });
  if (!updateResult.ok) {
    setFeedback("my-profile-avatar-feedback", updateResult.error?.message || "Could not save avatar URL.", "error");
    return;
  }

  await window.supabaseClient.auth.updateUser({
    data: {
      avatar_url: avatarUrl
    }
  });

  byId("my-profile-avatar-preview").src = avatarUrl;
  pendingAvatarFile = null;
  byId("my-profile-avatar-file").value = "";
  updateProfileCardPreview();
  setFeedback("my-profile-avatar-feedback", "Profile picture updated.", "success");
}

function bindActions() {
  const saveButton = byId("my-profile-save");
  if (saveButton) {
    saveButton.addEventListener("click", saveProfile);
  }

  const avatarInput = byId("my-profile-avatar-file");
  if (avatarInput) {
    avatarInput.addEventListener("change", () => {
      pendingAvatarFile = avatarInput.files && avatarInput.files[0] ? avatarInput.files[0] : null;
      if (!pendingAvatarFile) {
        return;
      }

      const previewUrl = URL.createObjectURL(pendingAvatarFile);
      byId("my-profile-avatar-preview").src = previewUrl;
      updateProfileCardPreview();
    });
  }

  const avatarButton = byId("my-profile-avatar-upload");
  if (avatarButton) {
    avatarButton.addEventListener("click", uploadAvatar);
  }
}

function showLoginRequiredCard(message) {
  byId("my-profile-dashboard").hidden = true;
  byId("my-profile-login-card").hidden = false;
  if (required(message)) {
    setFeedback("my-profile-feedback", message, "error");
  }
}

async function initMyProfilePage() {
  if (!window.supabaseClient) {
    showLoginRequiredCard("");
    return;
  }

  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  if (!user) {
    showLoginRequiredCard("");
    return;
  }

  const role = await resolvePortalRole(user);
  if (TEACHER_ROLES.has(role)) {
    await window.supabaseClient.auth.signOut();
    window.location.href = "teacher-login.html";
    return;
  }

  myProfileUser = user;
  const loadResult = await loadCommunityProfile(user);
  if (loadResult.error) {
    showLoginRequiredCard("");
    return;
  }

  const profile = normalizeCommunityProfileRow(loadResult.row, user);
  renderProfileForm(profile);

  byId("my-profile-login-card").hidden = true;
  byId("my-profile-dashboard").hidden = false;

  if (loadResult.setupMissing) {
    setFeedback(
      "my-profile-feedback",
      "Community profile setup is missing. Run supabase/community_profiles_setup.sql to enable full profile features.",
      "error"
    );
  }

  bindLivePreview();
  bindActions();
}

initMyProfilePage();
