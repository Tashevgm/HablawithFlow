require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const projectRoot = __dirname;
const port = Number(process.env.PORT || 8787);
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM || "Hablawithflow <onboarding@resend.dev>";
const ownerEmail = process.env.OWNER_EMAIL || "";
const bookingTeacherEmails = process.env.BOOKING_TEACHER_EMAILS || "";
const emailOverrideTo = process.env.EMAIL_OVERRIDE_TO || "";
const teacherInviteToken = process.env.TEACHER_INVITE_TOKEN || "";
const publicSiteUrl = process.env.PUBLIC_SITE_URL || "https://hablawithflow.com";
const googleMeetLink = process.env.GOOGLE_MEET_LINK || "";
const meetingProvider = String(process.env.MEETING_PROVIDER || (googleMeetLink ? "google_meet" : "jitsi"))
  .trim()
  .toLowerCase();
const jitsiBaseUrl = process.env.JITSI_BASE_URL || "https://meet.jit.si";
const meetingRoomSecret =
  process.env.MEETING_ROOM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TEACHER_INVITE_TOKEN || "hwf-room-secret";
const meetingJoinEnableMinutes = Math.max(1, Number(process.env.MEETING_JOIN_ENABLE_MINUTES || 15));
const lessonTimezoneDefault = process.env.LESSON_TIMEZONE_DEFAULT || "Europe/London";
const bookingReminderMinutes = Math.max(1, Number(process.env.BOOKING_REMINDER_MINUTES || 15));
const bookingReminderWindowMinutes = Math.max(1, Number(process.env.BOOKING_REMINDER_WINDOW_MINUTES || 5));
const bookingReminderPollMs = Math.max(15000, Number(process.env.BOOKING_REMINDER_POLL_MS || 60000));
const TEACHER_ROLES = new Set(["teacher", "admin"]);
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const supabaseConfigLooksPlaceholder = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return true;
  }

  return (
    raw.includes("your-project-ref") ||
    raw.includes("replace_with") ||
    raw.includes("your_supabase_service_role_key")
  );
};
const hasValidSupabaseAdminConfig =
  !supabaseConfigLooksPlaceholder(supabaseUrl) &&
  !supabaseConfigLooksPlaceholder(supabaseServiceRoleKey);

const resend = resendApiKey ? new Resend(resendApiKey) : null;
const supabaseAdmin =
  hasValidSupabaseAdminConfig
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      })
    : null;

app.use(
  cors({
    origin: true
  })
);
app.use(express.json());

function required(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function secureTokenMatch(expected, provided) {
  if (!required(expected) || !required(provided)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected.trim(), "utf8");
  const providedBuffer = Buffer.from(provided.trim(), "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

async function fetchStripeCheckoutSession(sessionId) {
  if (!required(stripeSecretKey)) {
    const error = new Error("Stripe secret key is not configured on the backend.");
    error.statusCode = 500;
    throw error;
  }

  const encodedSessionId = encodeURIComponent(sessionId);
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodedSessionId}?expand[]=payment_intent`,
    {
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`
      }
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const stripeMessage = String(payload?.error?.message || "").trim() || `Stripe API request failed (${response.status}).`;
    const error = new Error(stripeMessage);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }

  return payload;
}

async function fetchStripeActivePriceForProduct(productId) {
  const encodedProductId = encodeURIComponent(productId);
  const response = await fetch(`https://api.stripe.com/v1/prices?product=${encodedProductId}&active=true&limit=1`, {
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const stripeMessage = String(payload?.error?.message || "").trim() || `Stripe API request failed (${response.status}).`;
    const error = new Error(stripeMessage);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }

  const price = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!price?.id) {
    const error = new Error(`No active Stripe price found for product ${productId}.`);
    error.statusCode = 500;
    throw error;
  }

  return price;
}

async function createStripeCheckoutSession({
  customerEmail,
  studentId,
  bookingId,
  lessonType,
  productId,
  priceId,
  successUrl,
  cancelUrl
}) {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("customer_email", customerEmail);
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("payment_method_types[0]", "card");
  form.set("client_reference_id", studentId);
  form.set("metadata[booking_id]", bookingId);
  form.set("metadata[student_id]", studentId);
  form.set("metadata[student_email]", customerEmail);
  form.set("metadata[lesson_type]", lessonType);
  form.set("metadata[product_id]", productId);
  form.set("metadata[price_id]", priceId);
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const stripeMessage = String(payload?.error?.message || "").trim() || `Stripe API request failed (${response.status}).`;
    const error = new Error(stripeMessage);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }

  return payload;
}

function readStripeSessionBookingContext(stripeSession) {
  const metadata = stripeSession?.metadata && typeof stripeSession.metadata === "object" ? stripeSession.metadata : {};
  const bookingId = String(metadata.booking_id || "").trim();
  const metadataStudentId = String(metadata.student_id || "").trim();
  const clientReferenceId = String(stripeSession?.client_reference_id || "").trim();
  const studentId = required(metadataStudentId) ? metadataStudentId : clientReferenceId;
  const paymentStatus = String(stripeSession?.payment_status || "").trim().toLowerCase();

  return {
    bookingId,
    metadataStudentId,
    clientReferenceId,
    studentId,
    paymentStatus
  };
}

function jsonError(response, status, message) {
  return response.status(status).json({
    ok: false,
    error: message
  });
}

function ensureEmailServer(response) {
  if (!resend) {
    jsonError(response, 500, "Resend is not configured. Add RESEND_API_KEY to the server environment.");
    return false;
  }

  return true;
}

function ensureSupabaseAdmin(response) {
  if (!supabaseAdmin) {
    jsonError(
      response,
      500,
      "Supabase admin is not configured. Add real SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values (not placeholders)."
    );
    return false;
  }

  return true;
}

function publicErrorMessage(fallback, error) {
  const message = String(error?.message || "").trim();
  return required(message) ? `${fallback} ${message}` : fallback;
}

async function sendEmailWithResend(payload, label) {
  if (!resend) {
    throw new Error("Resend is not configured. Add RESEND_API_KEY to the server environment.");
  }

  const outboundPayload =
    required(emailOverrideTo) && payload && typeof payload === "object"
      ? {
          ...payload,
          to: emailOverrideTo.trim().toLowerCase(),
          cc: undefined,
          bcc: undefined
        }
      : payload;

  const result = await resend.emails.send(outboundPayload);
  if (result?.error) {
    const resendMessage = String(result.error.message || "Unknown Resend error.").trim();
    const context = required(label) ? `${label}: ` : "";
    const statusCode = Number(result.error.statusCode) || 500;
    const error = new Error(`Resend rejected email (${context}${resendMessage})`);
    error.statusCode = statusCode;
    error.resend = result.error;
    throw error;
  }

  return result;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatLessonDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function toIsoDateString(value) {
  return value.toISOString().slice(0, 10);
}

function addMinutes(value, minutes) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function parseDateParts(dateString) {
  const match = String(dateString || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function parseTimeParts(timeString) {
  const match = String(timeString || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return {
    hour,
    minute
  };
}

function normalizeLessonDateValue(value) {
  const raw = String(value || "").trim();
  if (!required(raw)) {
    return "";
  }

  const prefixedDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (prefixedDate) {
    return prefixedDate[1];
  }

  return raw;
}

function normalizeLessonTimeValue(value) {
  const raw = String(value || "").trim();
  if (!required(raw)) {
    return "";
  }

  const matched = raw.match(/^(\d{1,2}):(\d{2})/);
  if (matched) {
    return `${String(Number(matched[1])).padStart(2, "0")}:${matched[2]}`;
  }

  return raw.slice(0, 5);
}

function normalizeMeetingProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "google_meet" || raw === "google" ? "google_meet" : "jitsi";
}

function buildMeetingRoomNameForBooking(bookingId) {
  const normalizedBookingId = String(bookingId || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
  const digest = crypto
    .createHash("sha256")
    .update(`${String(bookingId || "").trim()}:${meetingRoomSecret}`)
    .digest("hex")
    .slice(0, 14);

  return `hwf-${normalizedBookingId || "lesson"}-${digest}`;
}

function buildMeetingJoinLinkForBooking(bookingId) {
  const provider = normalizeMeetingProvider(meetingProvider);
  if (provider === "google_meet") {
    return required(googleMeetLink) ? googleMeetLink.trim() : "";
  }

  const base = String(jitsiBaseUrl || "https://meet.jit.si").trim().replace(/\/+$/, "");
  if (!required(base)) {
    return "";
  }

  const room = buildMeetingRoomNameForBooking(bookingId);
  return `${base}/${room}`;
}

function normalizeBookingStatus(status) {
  const rawStatus = String(status || "").trim().toLowerCase();

  if (!rawStatus) {
    return "pending_payment";
  }

  if (rawStatus === "confirmed" || rawStatus === "paid" || rawStatus === "confirmed_paid") {
    return "confirmed_paid";
  }

  if (rawStatus === "cancelled" || rawStatus === "canceled" || rawStatus === "cancelled_paid" || rawStatus === "canceled_paid") {
    return "cancelled_paid";
  }

  if (rawStatus === "payment_submitted" || rawStatus === "payment submitted" || rawStatus === "checkout_submitted") {
    return "payment_submitted";
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

  return rawStatus;
}

function normalizeLessonTypeForPayment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getLessonProductEnvName(lessonType) {
  const normalized = normalizeLessonTypeForPayment(lessonType);

  if (normalized === "1-on-1" || normalized === "1-on-1 lesson" || normalized === "1-on-1 class") {
    return "STRIPE_PRODUCT_ONE_ON_ONE";
  }

  if (normalized === "group classes" || normalized === "group class") {
    return "STRIPE_PRODUCT_GROUP_CLASSES";
  }

  return "";
}

function isBookingStatusActive(status) {
  return normalizeBookingStatus(status) !== "cancelled_paid";
}

function zonedLessonStartToUtc(dateString, timeString, timeZone) {
  const dateParts = parseDateParts(dateString);
  const timeParts = parseTimeParts(timeString);
  if (!dateParts || !timeParts) {
    return null;
  }

  const zone = required(timeZone) ? timeZone.trim() : lessonTimezoneDefault;
  const utcGuess = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hour, timeParts.minute, 0, 0);

  try {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    const parts = dtf.formatToParts(new Date(utcGuess));
    const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asIfUtc = Date.UTC(
      Number(mapped.year),
      Number(mapped.month) - 1,
      Number(mapped.day),
      Number(mapped.hour),
      Number(mapped.minute),
      Number(mapped.second),
      0
    );
    const offset = asIfUtc - utcGuess;

    return new Date(utcGuess - offset);
  } catch {
    return new Date(utcGuess);
  }
}

function formatLessonStartLabel(dateString, timeString, timeZone) {
  const startsAt = zonedLessonStartToUtc(dateString, timeString, timeZone);
  if (!startsAt) {
    return `${formatLessonDate(dateString)} at ${String(timeString || "").slice(0, 5)}`;
  }

  const zone = required(timeZone) ? timeZone.trim() : lessonTimezoneDefault;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(startsAt);
  } catch {
    return `${formatLessonDate(dateString)} at ${String(timeString || "").slice(0, 5)}`;
  }
}

function toPortalUrl(pathname) {
  return `${publicSiteUrl.replace(/\/$/, "")}${pathname}`;
}

function listBookingNotificationRecipients() {
  const rawRecipients = bookingTeacherEmails
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (required(ownerEmail)) {
    rawRecipients.push(ownerEmail.trim().toLowerCase());
  }

  return [...new Set(rawRecipients)];
}

function readBearerToken(request) {
  const authorization = request.headers?.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function requireAuthenticatedUser(request, response) {
  if (!ensureSupabaseAdmin(response)) {
    return null;
  }

  const accessToken = readBearerToken(request);
  if (!required(accessToken)) {
    jsonError(response, 401, "Missing session token.");
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) {
    jsonError(response, 401, "Invalid or expired session token.");
    return null;
  }

  return data.user;
}

async function requireOwnerAccess(request, response) {
  const user = await requireAuthenticatedUser(request, response);
  if (!user) {
    return null;
  }

  if (!required(ownerEmail)) {
    jsonError(response, 500, "OWNER_EMAIL is not configured on the server.");
    return null;
  }

  const sessionEmail = (user.email || "").trim().toLowerCase();
  const normalizedOwnerEmail = ownerEmail.trim().toLowerCase();
  if (sessionEmail !== normalizedOwnerEmail) {
    jsonError(response, 403, "Owner access only.");
    return null;
  }

  return user;
}

async function getProfileRole(userId) {
  if (!supabaseAdmin) {
    return "";
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return "";
  }

  return String(data?.role || "").trim().toLowerCase();
}

async function hasTeacherProfile(userId) {
  if (!supabaseAdmin) {
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from("teacher_profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return false;
  }

  return required(String(data?.id || ""));
}

async function isTeacherUser(user) {
  const metadataRole = String(user?.user_metadata?.role || "").trim().toLowerCase();
  const profileRole = await getProfileRole(user?.id || "");
  if (TEACHER_ROLES.has(profileRole || metadataRole)) {
    return true;
  }

  return hasTeacherProfile(user?.id || "");
}

async function requireTeacherAccess(request, response) {
  const user = await requireAuthenticatedUser(request, response);
  if (!user) {
    return null;
  }

  const metadataRole = String(user.user_metadata?.role || "").trim().toLowerCase();
  const profileRole = await getProfileRole(user.id);
  const teacherProfileExists = await hasTeacherProfile(user.id);
  const role = profileRole || metadataRole;

  if (!TEACHER_ROLES.has(role) && !teacherProfileExists) {
    jsonError(response, 403, "Teacher access only.");
    return null;
  }

  return user;
}

function bookingHtml({ studentName, date, time, lessonType, message, accountSetupUrl, isExistingStudent }) {
  const safeName = escapeHtml(studentName);
  const safeLessonType = escapeHtml(lessonType);
  const safeMessage = required(message) ? escapeHtml(message) : "";
  const portalButtonLabel = isExistingStudent ? "Open Student Portal" : "Set Your Password";
  const portalButtonUrl = accountSetupUrl || toPortalUrl("/student-portal.html");
  const nextStepCopy = isExistingStudent
    ? "Your account is already active, so you can log in to the student portal and manage your upcoming lessons there."
    : "We created your student portal access for you. Use the button below to set your password and activate your account before class.";

  return `
    <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
        <div style="padding:18px 28px;background:linear-gradient(135deg,#c0392b 0%,#cf4c35 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Clase Confirmada</div>
          <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">Your free trial lesson is booked</h1>
        </div>

        <div style="padding:32px 28px;">
          <p style="margin:0 0 14px;font-size:18px;line-height:1.6;">Hi ${safeName},</p>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#514741;">
            Your Hablawithflow free trial is confirmed. Bienvenido. We are excited to meet you and get your Spanish moving with confidence.
          </p>

          <div style="margin:0 0 24px;padding:20px;border-radius:18px;background:#fbf5ef;border:1px solid #efe1d5;">
            <div style="margin:0 0 14px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#8c5a47;">
              Lesson details
            </div>
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Date</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(formatLessonDate(date))}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Time</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(time)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Lesson type</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${safeLessonType}</td>
              </tr>
            </table>
          </div>

          <div style="margin:0 0 24px;padding:18px 20px;border-radius:18px;background:#eaf7f4;border:1px solid #bfe7dc;">
            <div style="margin:0 0 8px;font-size:14px;font-weight:700;color:#116d5a;">Next step</div>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#36504b;">
              ${escapeHtml(nextStepCopy)}
            </p>
          </div>

          ${
            safeMessage
              ? `
                <div style="margin:0 0 24px;padding:18px 20px;border-radius:18px;background:#fff8ef;border:1px solid #f1dfc2;">
                  <div style="margin:0 0 8px;font-size:14px;font-weight:700;color:#8c5a47;">Your note</div>
                  <p style="margin:0;font-size:15px;line-height:1.7;color:#514741;">${safeMessage}</p>
                </div>
              `
              : ""
          }

          <div style="margin:0 0 24px;">
            <a href="${escapeHtml(portalButtonUrl)}" style="display:inline-block;padding:14px 22px;margin:0 12px 12px 0;border-radius:10px;background:#c0392b;color:#ffffff;text-decoration:none;font-weight:700;">
              ${portalButtonLabel}
            </a>
            <a href="${toPortalUrl("/student-portal.html")}" style="display:inline-block;padding:14px 22px;margin:0 12px 12px 0;border-radius:10px;border:2px solid #1abc9c;color:#1abc9c;text-decoration:none;font-weight:700;">
              Student Portal
            </a>
          </div>

          <p style="margin:0;font-size:14px;line-height:1.7;color:#7c6e67;">
            If you need to change anything before your lesson, reply to this email and we will help.
          </p>
        </div>
      </div>
    </div>
  `;
}

function paymentPendingHtml({ studentName, date, time, lessonType }) {
  const safeName = escapeHtml(studentName);
  const safeLessonType = escapeHtml(lessonType);
  const portalUrl = toPortalUrl("/student-portal.html");

  return `
    <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
        <div style="padding:18px 28px;background:linear-gradient(135deg,#c0392b 0%,#cf4c35 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Payment Required</div>
          <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">Your lesson is reserved</h1>
        </div>

        <div style="padding:32px 28px;">
          <p style="margin:0 0 14px;font-size:18px;line-height:1.6;">Hi ${safeName},</p>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#514741;">
            Your lesson slot is now reserved. Please complete payment in your student portal so the class is fully confirmed.
          </p>

          <div style="margin:0 0 24px;padding:20px;border-radius:18px;background:#fbf5ef;border:1px solid #efe1d5;">
            <div style="margin:0 0 14px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#8c5a47;">
              Reserved lesson
            </div>
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Date</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(formatLessonDate(date))}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Time</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(time)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Lesson type</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${safeLessonType}</td>
              </tr>
            </table>
          </div>

          <div style="margin:0 0 24px;">
            <a href="${portalUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#c0392b;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Student Portal to Pay
            </a>
          </div>

          <p style="margin:0;font-size:14px;line-height:1.7;color:#7c6e67;">
            Inside the portal, open your upcoming lesson and click <strong>Pay Now</strong>.
          </p>
        </div>
      </div>
    </div>
  `;
}

function teacherBookingHtml({ studentName, email, date, time, lessonType, message, heading, source }) {
  const safeHeading = escapeHtml(heading || "A new lesson has been booked");
  const safeSource = escapeHtml(source || "Website booking flow");
  const safeMessage = required(message) ? escapeHtml(message).replace(/\n/g, "<br>") : "No note added.";

  return `
    <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
        <div style="padding:18px 28px;background:linear-gradient(135deg,#0f766e 0%,#159a8c 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Teacher Notification</div>
          <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">${safeHeading}</h1>
        </div>

        <div style="padding:32px 28px;">
          <div style="margin:0 0 24px;padding:20px;border-radius:18px;background:#fbf5ef;border:1px solid #efe1d5;">
            <div style="margin:0 0 14px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#8c5a47;">
              Booking details
            </div>
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Student</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(studentName)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Email</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(email)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Date</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(formatLessonDate(date))}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Time</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(time)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Lesson type</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(lessonType)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Source</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${safeSource}</td>
              </tr>
            </table>
          </div>

          <div style="margin:0;padding:18px 20px;border-radius:18px;background:#eaf7f4;border:1px solid #bfe7dc;">
            <div style="margin:0 0 8px;font-size:14px;font-weight:700;color:#116d5a;">Student note</div>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#36504b;">${safeMessage}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function sendBookingEmails({
  studentName,
  email,
  date,
  time,
  lessonType,
  message,
  accountSetupUrl,
  isExistingStudent,
  studentSubject,
  teacherSubject,
  teacherHeading,
  source
}) {
  const sends = [
    sendEmailWithResend({
      from: emailFrom,
      to: email,
      subject: studentSubject || "Your Hablawithflow lesson is confirmed",
      html: bookingHtml({
        studentName,
        date,
        time,
        lessonType,
        message,
        accountSetupUrl,
        isExistingStudent
      })
    }, "student booking confirmation")
  ];

  const teacherRecipients = listBookingNotificationRecipients();
  if (teacherRecipients.length) {
    sends.push(
      sendEmailWithResend({
        from: emailFrom,
        to: teacherRecipients,
        subject: teacherSubject || `New booking: ${studentName} on ${date} ${time}`,
        html: teacherBookingHtml({
          studentName,
          email,
          date,
          time,
          lessonType,
          message,
          heading: teacherHeading,
          source
        })
      }, "teacher booking notification")
    );
  }

  await Promise.all(sends);

  return {
    teacherNotificationSent: teacherRecipients.length > 0,
    teacherRecipients
  };
}

function lessonReminderHtml({ studentName, lessonType, lessonStartLabel, meetLink, minutesBefore }) {
  return `
    <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
        <div style="padding:18px 28px;background:linear-gradient(135deg,#c0392b 0%,#cf4c35 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Lesson Reminder</div>
          <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">Your class starts in ${minutesBefore} minutes</h1>
        </div>

        <div style="padding:32px 28px;">
          <p style="margin:0 0 14px;font-size:18px;line-height:1.6;">Hi ${escapeHtml(studentName)},</p>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#514741;">
            Your Hablawithflow lesson is starting soon. Use the lesson link below to join on time.
          </p>

          <div style="margin:0 0 24px;padding:20px;border-radius:18px;background:#fbf5ef;border:1px solid #efe1d5;">
            <div style="margin:0 0 14px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#8c5a47;">
              Lesson details
            </div>
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Starts</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(lessonStartLabel)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Lesson type</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${escapeHtml(lessonType || "Spanish lesson")}</td>
              </tr>
            </table>
          </div>

          <div style="margin:0 0 24px;">
            <a href="${escapeHtml(meetLink)}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#c0392b;color:#ffffff;text-decoration:none;font-weight:700;">
              Join Lesson
            </a>
          </div>

          <p style="margin:0;font-size:14px;line-height:1.7;color:#7c6e67;">
            If the button does not open, copy this link into your browser:<br>
            <span style="word-break:break-all;">${escapeHtml(meetLink)}</span>
          </p>
        </div>
      </div>
    </div>
  `;
}

let reminderWorkerRunning = false;
let reminderSchemaReady = true;

async function processBookingReminderBatch() {
  if (reminderWorkerRunning || !supabaseAdmin || !resend || !reminderSchemaReady) {
    return { ok: false, sent: 0, checked: 0, reason: "disabled_or_busy" };
  }

  reminderWorkerRunning = true;
  try {
    const now = new Date();
    const windowStart = addMinutes(now, bookingReminderMinutes - bookingReminderWindowMinutes);
    const windowEnd = addMinutes(now, bookingReminderMinutes + 1);
    const fromDate = toIsoDateString(addMinutes(now, -24 * 60));
    const toDate = toIsoDateString(addMinutes(now, 72 * 60));

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("id, student_email, student_name, lesson_type, lesson_date, lesson_time, timezone, status, reminder_sent_at")
      .is("reminder_sent_at", null)
      .gte("lesson_date", fromDate)
      .lte("lesson_date", toDate)
      .limit(500);

    if (error) {
      if (String(error.message || "").toLowerCase().includes("reminder_sent_at")) {
        reminderSchemaReady = false;
        console.error("Booking reminder worker disabled: missing reminder_sent_at column. Apply SQL setup first.");
      } else {
        console.error("Failed to fetch bookings for reminder worker", error);
      }
      return { ok: false, sent: 0, checked: 0, reason: "fetch_failed" };
    }

    const rows = Array.isArray(data) ? data : [];
    let sent = 0;

    for (const booking of rows) {
      if (!required(booking.student_email) || !required(booking.lesson_date) || !required(booking.lesson_time)) {
        continue;
      }

      if (!isBookingStatusActive(booking.status)) {
        continue;
      }

      const lessonStart = zonedLessonStartToUtc(booking.lesson_date, booking.lesson_time, booking.timezone || lessonTimezoneDefault);
      if (!lessonStart) {
        continue;
      }

      const startsAt = lessonStart.getTime();
      if (startsAt < windowStart.getTime() || startsAt >= windowEnd.getTime()) {
        continue;
      }

      const studentName = required(booking.student_name) ? booking.student_name.trim() : booking.student_email.split("@")[0];
      const lessonType = required(booking.lesson_type) ? booking.lesson_type.trim() : "Spanish lesson";
      const lessonStartLabel = formatLessonStartLabel(booking.lesson_date, booking.lesson_time, booking.timezone || lessonTimezoneDefault);
      const meetingJoinLink = buildMeetingJoinLinkForBooking(booking.id);
      if (!required(meetingJoinLink)) {
        continue;
      }

      await sendEmailWithResend({
        from: emailFrom,
        to: booking.student_email,
        subject: `Reminder: your lesson starts in ${bookingReminderMinutes} minutes`,
        html: lessonReminderHtml({
          studentName,
          lessonType,
          lessonStartLabel,
          meetLink: meetingJoinLink,
          minutesBefore: bookingReminderMinutes
        })
      }, "lesson reminder");

      const { error: updateError } = await supabaseAdmin
        .from("bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id)
        .is("reminder_sent_at", null);

      if (updateError) {
        if (String(updateError.message || "").toLowerCase().includes("reminder_sent_at")) {
          reminderSchemaReady = false;
          console.error("Booking reminder worker disabled: missing reminder_sent_at column. Apply SQL setup first.");
          break;
        }
        console.error("Failed to mark booking reminder as sent", {
          bookingId: booking.id,
          error: updateError.message || updateError
        });
      } else {
        sent += 1;
      }
    }

    if (sent > 0) {
      console.log(`Booking reminder worker sent ${sent} reminder email(s).`);
    }

    return { ok: true, sent, checked: rows.length };
  } catch (error) {
    console.error("Booking reminder worker failed", error);
    return { ok: false, sent: 0, checked: 0, reason: "runtime_failure" };
  } finally {
    reminderWorkerRunning = false;
  }
}

function startBookingReminderWorker() {
  if (!supabaseAdmin || !resend) {
    console.log("Booking reminder worker disabled: missing Supabase admin or Resend configuration.");
    return;
  }

  if (normalizeMeetingProvider(meetingProvider) === "google_meet" && !required(googleMeetLink)) {
    console.log("Booking reminder worker disabled: meeting provider is google_meet but GOOGLE_MEET_LINK is not configured.");
    return;
  }

  processBookingReminderBatch().catch((error) => {
    console.error("Initial booking reminder run failed", error);
  });

  setInterval(() => {
    processBookingReminderBatch().catch((error) => {
      console.error("Booking reminder scheduled run failed", error);
    });
  }, bookingReminderPollMs);

  console.log(
    `Booking reminder worker enabled (lead ${bookingReminderMinutes} min, window ${bookingReminderWindowMinutes} min, poll ${bookingReminderPollMs} ms).`
  );
}

function teacherInviteHtml({ teacherName, accountSetupUrl }) {
  const safeName = escapeHtml(teacherName);
  const safeSetupUrl = escapeHtml(accountSetupUrl);

  return `
    <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
        <div style="padding:18px 28px;background:linear-gradient(135deg,#c0392b 0%,#cf4c35 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Teacher Access</div>
          <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">Welcome to Hablawithflow Teaching Portal</h1>
        </div>

        <div style="padding:32px 28px;">
          <p style="margin:0 0 14px;font-size:18px;line-height:1.6;">Hi ${safeName},</p>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#514741;">
            Your teacher account has been created. Use the secure button below to set your password and activate portal access.
          </p>

          <div style="margin:0 0 24px;">
            <a href="${safeSetupUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#c0392b;color:#ffffff;text-decoration:none;font-weight:700;">
              Set Your Password
            </a>
          </div>

          <p style="margin:0;font-size:14px;line-height:1.7;color:#7c6e67;">
            After activation, you can sign in from the teacher portal with your email and password.
          </p>
        </div>
      </div>
    </div>
  `;
}

function ownerPasswordResetHtml({ resetUrl }) {
  const safeResetUrl = escapeHtml(resetUrl);

  return `
    <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
        <div style="padding:18px 28px;background:linear-gradient(135deg,#c0392b 0%,#cf4c35 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Owner Access</div>
          <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">Reset your Hablawithflow password</h1>
        </div>

        <div style="padding:32px 28px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#514741;">
            Use the secure button below to set a new password for your owner account.
          </p>

          <div style="margin:0 0 24px;">
            <a href="${safeResetUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#c0392b;color:#ffffff;text-decoration:none;font-weight:700;">
              Set New Password
            </a>
          </div>

          <p style="margin:0;font-size:14px;line-height:1.7;color:#7c6e67;">
            If you did not request this, you can ignore this email.
          </p>
        </div>
      </div>
    </div>
  `;
}

function registrationHtml({ name, email, track, goal, timezone }) {
  return `
    <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
        <div style="padding:18px 28px;background:linear-gradient(135deg,#c0392b 0%,#cf4c35 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Bienvenido</div>
          <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">Welcome to Hablawithflow</h1>
        </div>

        <div style="padding:32px 28px;">
          <p style="margin:0 0 14px;font-size:18px;line-height:1.6;">Hi ${name},</p>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#514741;">
            Your registration is confirmed and your Spanish journey is officially underway.
            We are excited to help you build confidence, rhythm, and real conversational flow.
          </p>

          <div style="margin:0 0 24px;padding:20px;border-radius:18px;background:#fbf5ef;border:1px solid #efe1d5;">
            <div style="margin:0 0 14px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#8c5a47;">
              Your registration details
            </div>
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Email</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${email}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Track</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${track}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Main goal</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${goal}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#8a7c74;font-size:14px;">Timezone</td>
                <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#1a1a1a;">${timezone}</td>
              </tr>
            </table>
          </div>

          <div style="margin:0 0 26px;padding:18px 20px;border-radius:18px;background:#eaf7f4;border:1px solid #bfe7dc;">
            <div style="margin:0 0 8px;font-size:14px;font-weight:700;color:#116d5a;">What happens next</div>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#36504b;">
              You can now sign in to your student portal with the email and password you created,
              and when you book a lesson you will receive a separate confirmation email as well.
            </p>
          </div>

          <div style="margin:0 0 24px;">
            <a href="${publicSiteUrl}/student-portal.html" style="display:inline-block;padding:14px 22px;margin:0 12px 12px 0;border-radius:10px;background:#c0392b;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Student Portal
            </a>
            <a href="${publicSiteUrl}/#booking" style="display:inline-block;padding:14px 22px;margin:0 12px 12px 0;border-radius:10px;border:2px solid #1abc9c;color:#1abc9c;text-decoration:none;font-weight:700;">
              Book Your First Lesson
            </a>
          </div>

          <p style="margin:0;font-size:14px;line-height:1.7;color:#7c6e67;">
            Gracias for registering with Hablawithflow. We will see you inside the portal soon.
          </p>
        </div>
      </div>
    </div>
  `;
}

async function listAuthUsers(maxPages = 10) {
  if (!supabaseAdmin) {
    return [];
  }

  const users = [];
  let page = 1;

  while (page <= maxPages) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200
    });

    if (error) {
      throw error;
    }

    const batch = data?.users || [];
    users.push(...batch);

    if (batch.length < 200) {
      break;
    }

    page += 1;
  }

  return users;
}

async function findAuthUserByEmail(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const users = await listAuthUsers(10);
  const match = users.find((user) => (user.email || "").toLowerCase() === normalizedEmail);
  if (match) {
    return match;
  }

  return null;
}

async function createInviteLinkForTrialStudent({ studentName, email, lessonType, timezone, message }) {
  if (!supabaseAdmin) {
    return { ok: false, reason: "Supabase admin is not configured." };
  }

  const existingUser = await findAuthUserByEmail(email);
  if (existingUser) {
    return {
      ok: true,
      created: false,
      existingUser: true,
      accountSetupUrl: ""
    };
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      redirectTo: toPortalUrl("/set-password.html")
    },
    data: {
      full_name: studentName,
      track: lessonType,
      timezone: required(timezone) ? timezone : "Europe/London",
      notes: required(message) ? message : "",
      source: "free_trial_booking"
    }
  });

  if (error) {
    throw error;
  }

  const userId = data?.user?.id;
  if (userId) {
    await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: studentName,
      track: lessonType,
      timezone: required(timezone) ? timezone : "Europe/London",
      goal: "Free trial lesson",
      notes: required(message) ? message : "Student booked a free trial lesson."
    });
  }

  return {
    ok: true,
    created: true,
    existingUser: false,
    accountSetupUrl: data?.properties?.action_link || ""
  };
}

async function registerTeacherAccess({ name, email, timezone, bio, hourlyRate, source }) {
  const teacherName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedTimezone = required(timezone) ? timezone.trim() : "Europe/London";
  const teacherBio = required(bio) ? bio.trim() : "";
  const parsedHourlyRate = Number(hourlyRate);
  const normalizedHourlyRate = Number.isFinite(parsedHourlyRate) && parsedHourlyRate > 0 ? parsedHourlyRate : null;
  const inviteSource = required(source) ? source.trim() : "teacher_registration";

  let existingUser = false;
  let accountSetupUrl = "";
  let targetUser = await findAuthUserByEmail(normalizedEmail);

  if (targetUser) {
    existingUser = true;
  } else {
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email: normalizedEmail,
      options: {
        redirectTo: toPortalUrl("/set-password.html")
      },
      data: {
        full_name: teacherName,
        role: "teacher",
        timezone: normalizedTimezone,
        notes: teacherBio,
        source: inviteSource
      }
    });

    if (inviteError) {
      throw inviteError;
    }

    targetUser = inviteData?.user || null;
    accountSetupUrl = inviteData?.properties?.action_link || "";
  }

  if (!targetUser?.id) {
    throw new Error("Could not resolve teacher auth user id.");
  }

  const { error: profileUpsertError } = await supabaseAdmin.from("profiles").upsert({
    id: targetUser.id,
    full_name: teacherName,
    role: "teacher",
    timezone: normalizedTimezone,
    notes: teacherBio
  });
  if (profileUpsertError) {
    throw profileUpsertError;
  }

  const { error: teacherProfileUpsertError } = await supabaseAdmin.from("teacher_profiles").upsert({
    id: targetUser.id,
    bio: teacherBio || null,
    hourly_rate: normalizedHourlyRate,
    timezone: normalizedTimezone
  });
  if (teacherProfileUpsertError) {
    throw teacherProfileUpsertError;
  }

  let inviteEmailSent = false;
  if (!existingUser && required(accountSetupUrl) && resend) {
    await sendEmailWithResend({
      from: emailFrom,
      to: normalizedEmail,
      subject: "Your Hablawithflow teacher account is ready",
      html: teacherInviteHtml({
        teacherName,
        accountSetupUrl
      })
    }, "teacher invite");
    inviteEmailSent = true;
  }

  return {
    existingUser,
    inviteEmailSent,
    accountSetupUrl: existingUser || inviteEmailSent ? "" : accountSetupUrl
  };
}

app.get("/api", (request, response) => {
  response.type("html").send(`
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1a1a1a;padding:32px;max-width:760px">
      <h1 style="margin-bottom:8px">Hablawithflow App Backend</h1>
      <p>This server now powers both the website and the email API.</p>
      <ul>
        <li><strong>Health:</strong> <a href="/api/health">/api/health</a></li>
        <li><strong>Registration email:</strong> <code>POST /api/email/register</code></li>
        <li><strong>Booking email:</strong> <code>POST /api/email/booking</code></li>
        <li><strong>Payment pending email:</strong> <code>POST /api/email/payment-pending</code></li>
        <li><strong>Stripe checkout create:</strong> <code>POST /api/booking/stripe/create-session</code></li>
        <li><strong>Stripe payment confirm:</strong> <code>POST /api/booking/stripe/confirm-session</code></li>
        <li><strong>Stripe payment confirm (fallback):</strong> <code>POST /api/booking/stripe/confirm-session-public</code></li>
        <li><strong>Meeting join link:</strong> <code>GET /api/meeting/join-link</code> or <code>GET /api/meeting/join-link?bookingId=...</code></li>
        <li><strong>Blocked slots:</strong> <code>GET /api/availability/blocked-slots</code></li>
        <li><strong>Teacher bookings:</strong> <code>GET /api/teacher/bookings</code></li>
        <li><strong>Owner test email:</strong> <code>POST /api/owner/email-test</code></li>
        <li><strong>Owner reminder trigger:</strong> <code>POST /api/owner/booking-reminders/run</code></li>
        <li><strong>Website:</strong> <a href="/">/</a></li>
      </ul>
    </div>
  `);
});

app.get("/api/health", async (request, response) => {
  let supabaseAdminConnected = false;
  let supabaseAdminConnectionError = "";
  if (supabaseAdmin) {
    try {
      const { error } = await supabaseAdmin.from("bookings").select("id", { head: true, count: "exact" }).limit(1);
      if (error) {
        throw error;
      }
      supabaseAdminConnected = true;
    } catch (error) {
      supabaseAdminConnectionError = String(error?.message || "Unknown Supabase connection error.");
    }
  }

  response.json({
    ok: true,
    service: "hablawithflow-app-backend",
    meeting: {
      provider: normalizeMeetingProvider(meetingProvider),
      configured:
        normalizeMeetingProvider(meetingProvider) === "google_meet"
          ? required(googleMeetLink)
          : required(String(jitsiBaseUrl || "").trim()),
      enableMinutesBefore: meetingJoinEnableMinutes
    },
    email: {
      provider: "resend",
      configured: Boolean(resendApiKey),
      from: emailFrom,
      overrideTo: required(emailOverrideTo) ? emailOverrideTo.trim().toLowerCase() : "",
      ownerConfigured: required(ownerEmail),
      teacherNotificationRecipients: listBookingNotificationRecipients().length
    },
    supabaseAdminConfigured: Boolean(supabaseAdmin),
    supabaseAdminConnected,
    supabaseAdminConnectionError
  });
});

app.get("/api/meeting/join-link", async (request, response) => {
  try {
    const user = await requireAuthenticatedUser(request, response);
    if (!user) {
      return;
    }

    const provider = normalizeMeetingProvider(meetingProvider);
    const bookingId = String(request.query?.bookingId || "").trim();

    if (!required(bookingId)) {
      const defaultJoinLink = provider === "google_meet" ? buildMeetingJoinLinkForBooking("") : "";
      response.json({
        ok: true,
        configured: required(defaultJoinLink) || provider === "jitsi",
        provider,
        dynamicPerBooking: provider === "jitsi",
        joinLink: defaultJoinLink,
        enableMinutesBefore: meetingJoinEnableMinutes
      });
      return;
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, student_id, lesson_date, lesson_time, timezone, status")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      throw bookingError;
    }

    if (!booking) {
      jsonError(response, 404, "Booking was not found.");
      return;
    }

    const sessionUserId = String(user.id || "").trim();
    const bookingStudentId = String(booking.student_id || "").trim();
    const isLessonStudent = required(sessionUserId) && required(bookingStudentId) && sessionUserId === bookingStudentId;
    const teacherUser = await isTeacherUser(user);

    if (!isLessonStudent && !teacherUser) {
      jsonError(response, 403, "You are not allowed to join this booking.");
      return;
    }

    const bookingStatus = normalizeBookingStatus(booking.status);
    if (bookingStatus !== "confirmed_paid") {
      jsonError(response, 403, "Meeting link is available only for paid lessons.");
      return;
    }

    const lessonStart = zonedLessonStartToUtc(
      normalizeLessonDateValue(booking.lesson_date),
      normalizeLessonTimeValue(booking.lesson_time),
      required(booking.timezone) ? booking.timezone : lessonTimezoneDefault
    );
    if (!lessonStart) {
      jsonError(response, 400, "Lesson date/time is invalid.");
      return;
    }

    const openAt = addMinutes(lessonStart, -meetingJoinEnableMinutes);
    const closeAt = addMinutes(lessonStart, 120);
    const now = new Date();
    if (now < openAt || now > closeAt) {
      jsonError(response, 403, `Meeting link unlocks ${meetingJoinEnableMinutes} minutes before the lesson.`);
      return;
    }

    const joinLink = buildMeetingJoinLinkForBooking(booking.id);
    const configured = required(joinLink);
    response.json({
      ok: true,
      bookingId: String(booking.id),
      configured,
      provider,
      dynamicPerBooking: provider === "jitsi",
      joinLink: configured ? joinLink : "",
      enableMinutesBefore: meetingJoinEnableMinutes
    });
  } catch (error) {
    console.error("Failed to resolve meeting join link", error);
    jsonError(response, 500, "Failed to resolve meeting join link.");
  }
});

app.get("/api/availability/blocked-slots", async (request, response) => {
  try {
    const user = await requireAuthenticatedUser(request, response);
    if (!user) {
      return;
    }

    const activeStatuses = ["pending_payment", "payment_submitted", "confirmed_paid"];
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("lesson_date, lesson_time, status")
      .in("status", activeStatuses)
      .order("lesson_date", { ascending: true })
      .order("lesson_time", { ascending: true });

    if (error) {
      throw error;
    }

    response.json({
      ok: true,
      blockedSlots: Array.isArray(data)
        ? data.map((row) => ({
            date: normalizeLessonDateValue(row.lesson_date),
            time: normalizeLessonTimeValue(row.lesson_time),
            status: normalizeBookingStatus(row.status)
          }))
        : []
    });
  } catch (error) {
    console.error("Failed to fetch blocked slots", error);
    jsonError(response, 500, "Failed to fetch blocked slots.");
  }
});

app.post("/api/teacher-invite/validate", (request, response) => {
  if (!required(teacherInviteToken)) {
    jsonError(response, 500, "TEACHER_INVITE_TOKEN is not configured on the server.");
    return;
  }

  const { token } = request.body || {};
  if (!secureTokenMatch(teacherInviteToken, token || "")) {
    jsonError(response, 403, "Invalid teacher invite token.");
    return;
  }

  response.json({
    ok: true,
    message: "Invite token accepted."
  });
});

app.post("/api/teacher-invite/register", async (request, response) => {
  try {
    if (!ensureSupabaseAdmin(response)) {
      return;
    }

    if (!required(teacherInviteToken)) {
      jsonError(response, 500, "TEACHER_INVITE_TOKEN is not configured on the server.");
      return;
    }

    const { token, name, email, timezone, bio, hourlyRate } = request.body || {};
    if (!secureTokenMatch(teacherInviteToken, token || "")) {
      jsonError(response, 403, "Invalid teacher invite token.");
      return;
    }

    if (![name, email].every(required)) {
      jsonError(response, 400, "Missing teacher registration fields.");
      return;
    }

    const result = await registerTeacherAccess({
      name,
      email,
      timezone,
      bio,
      hourlyRate,
      source: "teacher_private_invite"
    });

    response.json({
      ok: true,
      message: result.existingUser
        ? "Teacher access granted to existing account."
        : result.inviteEmailSent
          ? "Teacher invite sent."
          : "Teacher account created. Share the setup link manually.",
      existingUser: result.existingUser,
      inviteEmailSent: result.inviteEmailSent,
      accountSetupUrl: result.accountSetupUrl
    });
  } catch (error) {
    console.error("Failed to register teacher from invite link", error);
    jsonError(response, 500, publicErrorMessage("Failed to register teacher account.", error));
  }
});

app.post("/api/teacher/register", async (request, response) => {
  try {
    if (!ensureSupabaseAdmin(response)) {
      return;
    }

    const { name, email, timezone, bio, hourlyRate } = request.body || {};
    if (![name, email].every(required)) {
      jsonError(response, 400, "Missing teacher registration fields.");
      return;
    }

    const result = await registerTeacherAccess({
      name,
      email,
      timezone,
      bio,
      hourlyRate,
      source: "teacher_private_portal"
    });

    response.json({
      ok: true,
      message: result.existingUser
        ? "Teacher access granted to existing account."
        : result.inviteEmailSent
          ? "Teacher invite sent."
          : "Teacher account created. Share the setup link manually.",
      existingUser: result.existingUser,
      inviteEmailSent: result.inviteEmailSent,
      accountSetupUrl: result.accountSetupUrl
    });
  } catch (error) {
    console.error("Failed to register teacher from private portal", error);
    jsonError(response, 500, publicErrorMessage("Failed to register teacher account.", error));
  }
});

app.post("/api/booking/confirm-email-complete", async (request, response) => {
  try {
    const user = await requireAuthenticatedUser(request, response);
    if (!user) {
      return;
    }

    if (!user.email_confirmed_at) {
      jsonError(response, 403, "Email is not confirmed yet.");
      return;
    }

    if (!ensureEmailServer(response)) {
      return;
    }

    const metadata = user.user_metadata || {};
    const pendingBooking = metadata.pending_trial_booking || null;

    if (!pendingBooking) {
      response.json({
        ok: true,
        processed: false,
        message: "No pending booking found for this account."
      });
      return;
    }

    const studentName = required(pendingBooking.student_name)
      ? pendingBooking.student_name.trim()
      : required(metadata.full_name)
        ? metadata.full_name.trim()
        : (user.email || "").split("@")[0];
    const email = (user.email || "").trim().toLowerCase();
    const date = required(pendingBooking.date) ? pendingBooking.date.trim() : "";
    const time = required(pendingBooking.time) ? pendingBooking.time.trim() : "";
    const lessonType = required(pendingBooking.lesson_type) ? pendingBooking.lesson_type.trim() : "";
    const message = required(pendingBooking.message) ? pendingBooking.message.trim() : "";
    const timezone = required(pendingBooking.timezone) ? pendingBooking.timezone.trim() : "Europe/London";

    if (![studentName, email, date, time, lessonType].every(required)) {
      jsonError(response, 400, "Pending booking metadata is incomplete.");
      return;
    }

    const { data: existingRows, error: existingBookingError } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("student_id", user.id)
      .eq("lesson_date", date)
      .eq("lesson_time", time)
      .limit(1);

    if (existingBookingError) {
      throw existingBookingError;
    }

    const bookingExists = Array.isArray(existingRows) && existingRows.length > 0;

    if (!bookingExists) {
      const { error: insertBookingError } = await supabaseAdmin.from("bookings").insert({
        student_id: user.id,
        student_email: email,
        student_name: studentName,
        lesson_type: lessonType,
        lesson_date: date,
        lesson_time: time,
        timezone,
        message,
        status: "confirmed_paid"
      });

      if (insertBookingError) {
        throw insertBookingError;
      }
    }

    await sendBookingEmails({
      studentName,
      email,
      date,
      time,
      lessonType,
      message,
      isExistingStudent: true,
      studentSubject: "Your Hablawithflow lesson is confirmed",
      teacherSubject: `Confirmed trial booking: ${studentName} on ${date} ${time}`,
      teacherHeading: "A confirmed free trial lesson has been booked",
      source: "Email-confirmed landing booking flow"
    });

    const nextMetadata = {
      ...metadata,
      trial_booking_confirmation_sent_at: new Date().toISOString()
    };
    delete nextMetadata.pending_trial_booking;

    const { error: metadataUpdateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: nextMetadata
    });

    if (metadataUpdateError) {
      throw metadataUpdateError;
    }

    response.json({
      ok: true,
      processed: true,
      bookingExists,
      message: "Booking confirmation email sent after signup confirmation."
    });
  } catch (error) {
    console.error("Failed to complete booking after confirmation", error);
    jsonError(response, 500, publicErrorMessage("Failed to finalize booking after email confirmation.", error));
  }
});

app.post("/api/booking/stripe/create-session", async (request, response) => {
  try {
    const user = await requireAuthenticatedUser(request, response);
    if (!user) {
      return;
    }

    if (!required(stripeSecretKey)) {
      jsonError(response, 500, "Stripe secret key is not configured on the backend.");
      return;
    }

    const profileRole = await getProfileRole(user.id);
    const metadataRole = String(user?.user_metadata?.role || "").trim().toLowerCase();
    const role = profileRole || metadataRole || "student";
    if (role === "teacher" || role === "admin") {
      jsonError(response, 403, "Teacher accounts cannot open student checkout.");
      return;
    }

    const bookingId = String(request.body?.bookingId || request.body?.booking_id || "").trim();
    if (!required(bookingId)) {
      jsonError(response, 400, "No booking id was provided.");
      return;
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, lesson_type, status")
      .eq("id", bookingId)
      .eq("student_id", user.id)
      .maybeSingle();

    if (bookingError) {
      throw bookingError;
    }
    if (!booking) {
      jsonError(response, 404, "Could not load the selected booking for checkout.");
      return;
    }

    if (normalizeBookingStatus(booking.status) !== "pending_payment") {
      jsonError(response, 400, "This booking is no longer waiting for payment.");
      return;
    }

    const lessonType = String(booking.lesson_type || "1-on-1").trim();
    const productEnvName = getLessonProductEnvName(lessonType);
    if (!required(productEnvName)) {
      jsonError(response, 400, `Unsupported lesson type for checkout: ${lessonType || "Unknown"}.`);
      return;
    }

    const productId = String(process.env[productEnvName] || "").trim();
    if (!required(productId)) {
      jsonError(response, 500, `Missing Stripe product configuration (${productEnvName}).`);
      return;
    }

    const price = await fetchStripeActivePriceForProduct(productId);

    const requestOrigin = String(request.headers.origin || "").trim().replace(/\/+$/, "");
    const configuredSiteUrl = String(process.env.SITE_URL || publicSiteUrl || "").trim().replace(/\/+$/, "");
    const fallbackHostUrl = `${request.protocol}://${request.get("host")}`.replace(/\/+$/, "");
    const siteUrl = required(requestOrigin) ? requestOrigin : required(configuredSiteUrl) ? configuredSiteUrl : fallbackHostUrl;

    const checkoutSession = await createStripeCheckoutSession({
      customerEmail: String(user.email || "").trim().toLowerCase(),
      studentId: String(user.id || "").trim(),
      bookingId: String(booking.id || "").trim(),
      lessonType,
      productId,
      priceId: String(price.id || "").trim(),
      successUrl: `${siteUrl}/student-portal.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl}/student-portal.html?checkout=cancelled`
    });

    const checkoutUrl = String(checkoutSession?.url || "").trim();
    if (!required(checkoutUrl)) {
      jsonError(response, 500, "Stripe checkout session was created without a redirect URL.");
      return;
    }

    response.json({
      ok: true,
      url: checkoutUrl,
      sessionId: String(checkoutSession.id || "").trim()
    });
  } catch (error) {
    console.error("Failed to create Stripe checkout session", error);
    const statusCode = Number(error?.statusCode);
    jsonError(
      response,
      Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500,
      publicErrorMessage("Failed to create Stripe checkout session.", error)
    );
  }
});

app.post("/api/booking/stripe/confirm-session", async (request, response) => {
  try {
    const user = await requireAuthenticatedUser(request, response);
    if (!user) {
      return;
    }

    if (!ensureSupabaseAdmin(response)) {
      return;
    }

    const sessionId = String(request.body?.sessionId || "").trim();
    if (!required(sessionId)) {
      jsonError(response, 400, "Stripe checkout session id is required.");
      return;
    }

    const stripeSession = await fetchStripeCheckoutSession(sessionId);
    const { bookingId, metadataStudentId, clientReferenceId, paymentStatus } = readStripeSessionBookingContext(stripeSession);

    if (!required(bookingId)) {
      jsonError(response, 400, "Stripe session is missing booking_id metadata.");
      return;
    }

    const userId = String(user.id || "").trim();
    const sessionBelongsToUser =
      (required(metadataStudentId) && metadataStudentId === userId) ||
      (required(clientReferenceId) && clientReferenceId === userId);
    if (!sessionBelongsToUser) {
      jsonError(response, 403, "This Stripe session does not belong to the current user.");
      return;
    }

    if (paymentStatus !== "paid") {
      response.json({
        ok: true,
        paid: false,
        bookingId,
        paymentStatus
      });
      return;
    }

    const { data: existingBooking, error: existingBookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, status")
      .eq("id", bookingId)
      .eq("student_id", userId)
      .maybeSingle();

    if (existingBookingError) {
      throw existingBookingError;
    }

    if (!existingBooking) {
      jsonError(response, 404, "Booking could not be found for this student.");
      return;
    }

    const normalizedStatus = normalizeBookingStatus(existingBooking.status);
    if (normalizedStatus === "confirmed_paid") {
      response.json({
        ok: true,
        paid: true,
        updated: false,
        bookingId,
        status: "confirmed_paid"
      });
      return;
    }

    const { data: updatedBooking, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "confirmed_paid"
      })
      .eq("id", bookingId)
      .eq("student_id", userId)
      .in("status", ["pending_payment", "payment_submitted"])
      .select("id, status")
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    response.json({
      ok: true,
      paid: true,
      updated: Boolean(updatedBooking),
      bookingId,
      status: "confirmed_paid"
    });
  } catch (error) {
    console.error("Failed to confirm Stripe checkout session", error);
    const statusCode = Number(error?.statusCode);
    jsonError(
      response,
      Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500,
      publicErrorMessage("Failed to confirm Stripe checkout session.", error)
    );
  }
});

app.post("/api/booking/stripe/confirm-session-public", async (request, response) => {
  try {
    if (!ensureSupabaseAdmin(response)) {
      return;
    }

    const sessionId = String(request.body?.sessionId || "").trim();
    if (!required(sessionId)) {
      jsonError(response, 400, "Stripe checkout session id is required.");
      return;
    }

    const stripeSession = await fetchStripeCheckoutSession(sessionId);
    const { bookingId, studentId, paymentStatus } = readStripeSessionBookingContext(stripeSession);

    if (!required(bookingId)) {
      jsonError(response, 400, "Stripe session is missing booking_id metadata.");
      return;
    }
    if (!required(studentId)) {
      jsonError(response, 400, "Stripe session is missing student identity metadata.");
      return;
    }

    if (paymentStatus !== "paid") {
      response.json({
        ok: true,
        paid: false,
        bookingId,
        paymentStatus
      });
      return;
    }

    const { data: existingBooking, error: existingBookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, status")
      .eq("id", bookingId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (existingBookingError) {
      throw existingBookingError;
    }

    if (!existingBooking) {
      jsonError(response, 404, "Booking could not be found for this student.");
      return;
    }

    const normalizedStatus = normalizeBookingStatus(existingBooking.status);
    if (normalizedStatus === "confirmed_paid") {
      response.json({
        ok: true,
        paid: true,
        updated: false,
        bookingId,
        status: "confirmed_paid"
      });
      return;
    }

    const { data: updatedBooking, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "confirmed_paid"
      })
      .eq("id", bookingId)
      .eq("student_id", studentId)
      .in("status", ["pending_payment", "payment_submitted"])
      .select("id, status")
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    response.json({
      ok: true,
      paid: true,
      updated: Boolean(updatedBooking),
      bookingId,
      status: "confirmed_paid"
    });
  } catch (error) {
    console.error("Failed to confirm Stripe checkout session without auth fallback", error);
    const statusCode = Number(error?.statusCode);
    jsonError(
      response,
      Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500,
      publicErrorMessage("Failed to confirm Stripe checkout session.", error)
    );
  }
});

app.get("/api/teacher/students", async (request, response) => {
  try {
    const teacherUser = await requireTeacherAccess(request, response);
    if (!teacherUser) {
      return;
    }
    const teacherUserId = String(teacherUser.id || "").trim();
    const teacherEmail = String(teacherUser.email || "").trim().toLowerCase();

    const [{ data: profileRows, error: profileError }, authUsers, { data: bookingRows, error: bookingError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, role, full_name, level, track, goal, notes"),
      listAuthUsers(10),
      supabaseAdmin
        .from("bookings")
        .select("student_id, student_email, student_name")
    ]);

    if (profileError) {
      throw profileError;
    }
    if (bookingError) {
      throw bookingError;
    }

    const authUserById = new Map(authUsers.map((user) => [user.id, user]));
    const profileById = new Map((profileRows || []).map((profile) => [String(profile.id || "").trim(), profile]));
    const authUserByEmail = new Map(
      authUsers
        .filter((user) => required(user?.email))
        .map((user) => [String(user.email || "").trim().toLowerCase(), user])
    );
    const normalizedOwnerEmail = required(ownerEmail) ? ownerEmail.trim().toLowerCase() : "";

    function shouldSkipStudent({ id, email, authUser, profile }) {
      const normalizedId = String(id || "").trim();
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const profileRole = String(profile?.role || "").trim().toLowerCase();
      const metadataRole = String(authUser?.user_metadata?.role || "").trim().toLowerCase();

      if ((required(teacherUserId) && normalizedId === teacherUserId) || (required(teacherEmail) && normalizedEmail === teacherEmail)) {
        return true;
      }
      if (required(normalizedOwnerEmail) && normalizedEmail === normalizedOwnerEmail) {
        return true;
      }
      if (profileRole === "teacher" || profileRole === "admin") {
        return true;
      }
      if (metadataRole === "teacher" || metadataRole === "admin") {
        return true;
      }
      return false;
    }

    function buildStudentRecord({ id, email, profile, authUser, bookingName }) {
      const normalizedId = String(id || "").trim();
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const metadataName = String(authUser?.user_metadata?.full_name || "").trim();
      const preferredName = String(profile?.full_name || metadataName || bookingName || normalizedEmail.split("@")[0] || "Student").trim();
      const studentId = required(normalizedId) ? normalizedId : normalizedEmail;

      return {
        id: studentId,
        email: normalizedEmail,
        name: preferredName,
        full_name: preferredName,
        level: profile?.level || "Beginner",
        track: profile?.track || "1-on-1",
        goal: profile?.goal || "Conversation",
        notes: profile?.notes || ""
      };
    }

    const studentsByKey = new Map();

    for (const profile of profileRows || []) {
      const profileId = String(profile.id || "").trim();
      const authUser = authUserById.get(profileId);
      const email = String(authUser?.email || "").trim().toLowerCase();

      if (!required(email)) {
        continue;
      }
      if (String(profile.role || "student").toLowerCase() !== "student") {
        continue;
      }
      if (shouldSkipStudent({ id: profileId, email, authUser, profile })) {
        continue;
      }

      const key = required(profileId) ? `id:${profileId}` : `email:${email}`;
      studentsByKey.set(
        key,
        buildStudentRecord({
          id: profileId,
          email,
          profile,
          authUser
        })
      );
    }

    for (const booking of bookingRows || []) {
      const bookingStudentId = String(booking.student_id || "").trim();
      const bookingEmail = String(booking.student_email || "").trim().toLowerCase();
      if (!required(bookingStudentId) && !required(bookingEmail)) {
        continue;
      }

      const profile = required(bookingStudentId) ? profileById.get(bookingStudentId) : null;
      const authUser =
        (required(bookingStudentId) ? authUserById.get(bookingStudentId) : null) ||
        (required(bookingEmail) ? authUserByEmail.get(bookingEmail) : null) ||
        null;
      const email = required(bookingEmail) ? bookingEmail : String(authUser?.email || "").trim().toLowerCase();
      if (!required(email)) {
        continue;
      }

      if (shouldSkipStudent({ id: bookingStudentId, email, authUser, profile })) {
        continue;
      }

      const key = required(bookingStudentId) ? `id:${bookingStudentId}` : `email:${email}`;
      if (studentsByKey.has(key)) {
        continue;
      }

      studentsByKey.set(
        key,
        buildStudentRecord({
          id: bookingStudentId,
          email,
          profile,
          authUser,
          bookingName: String(booking.student_name || "").trim()
        })
      );
    }

    const students = Array.from(studentsByKey.values()).sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));

    response.json({
      ok: true,
      students
    });
  } catch (error) {
    console.error("Failed to fetch teacher students", error);
    jsonError(response, 500, "Failed to fetch teacher student roster.");
  }
});

app.get("/api/teacher/bookings", async (request, response) => {
  try {
    const teacherUser = await requireTeacherAccess(request, response);
    if (!teacherUser) {
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("id, student_id, student_email, student_name, lesson_type, lesson_date, lesson_time, timezone, message, status")
      .order("lesson_date", { ascending: true })
      .order("lesson_time", { ascending: true });

    if (error) {
      throw error;
    }

    response.json({
      ok: true,
      bookings: Array.isArray(data)
        ? data.map((booking) => ({
            ...booking,
            lesson_date: normalizeLessonDateValue(booking.lesson_date),
            lesson_time: normalizeLessonTimeValue(booking.lesson_time),
            status: normalizeBookingStatus(booking.status)
          }))
        : []
    });
  } catch (error) {
    console.error("Failed to fetch teacher bookings", error);
    jsonError(response, 500, "Failed to fetch teacher bookings.");
  }
});

app.get("/api/owner/access", async (request, response) => {
  try {
    const ownerUser = await requireOwnerAccess(request, response);
    if (!ownerUser) {
      return;
    }

    response.json({
      ok: true,
      email: ownerUser.email || ""
    });
  } catch (error) {
    console.error("Failed to verify owner access", error);
    jsonError(response, 500, "Failed to verify owner access.");
  }
});

app.post("/api/owner/booking-reminders/run", async (request, response) => {
  try {
    const ownerUser = await requireOwnerAccess(request, response);
    if (!ownerUser) {
      return;
    }

    const result = await processBookingReminderBatch();
    response.json({
      ok: true,
      triggeredBy: ownerUser.email || "",
      ...result
    });
  } catch (error) {
    console.error("Failed to run booking reminder worker on demand", error);
    jsonError(response, 500, "Failed to run booking reminders.");
  }
});

app.post("/api/owner/password-reset", async (request, response) => {
  try {
    if (!ensureSupabaseAdmin(response)) {
      return;
    }

    if (!required(ownerEmail)) {
      jsonError(response, 500, "OWNER_EMAIL is not configured on the server.");
      return;
    }

    const { email } = request.body || {};
    if (!required(email)) {
      jsonError(response, 400, "Owner email is required.");
      return;
    }

    const normalizedOwnerEmail = ownerEmail.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail !== normalizedOwnerEmail) {
      jsonError(response, 403, "Only the configured owner email can reset from this page.");
      return;
    }

    const ownerUser = await findAuthUserByEmail(normalizedEmail);
    if (!ownerUser) {
      jsonError(response, 404, "Owner account does not exist yet. Create it first on the register page.");
      return;
    }

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: {
        redirectTo: toPortalUrl("/set-password.html")
      }
    });

    if (error) {
      throw error;
    }

    const resetUrl = data?.properties?.action_link || "";
    if (!required(resetUrl)) {
      throw new Error("Could not generate password reset link.");
    }

    let emailSent = false;
    if (resend) {
      await sendEmailWithResend({
        from: emailFrom,
        to: normalizedEmail,
        subject: "Reset your Hablawithflow owner password",
        html: ownerPasswordResetHtml({
          resetUrl
        })
      }, "owner password reset");
      emailSent = true;
    }

    response.json({
      ok: true,
      message: emailSent
        ? "Password reset email sent."
        : "Password reset link generated. Email service is not configured.",
      emailSent,
      resetUrl: emailSent ? "" : resetUrl
    });
  } catch (error) {
    console.error("Failed to send owner password reset", error);
    jsonError(response, 500, publicErrorMessage("Failed to send owner password reset.", error));
  }
});

app.post("/api/owner/email-test", async (request, response) => {
  try {
    const ownerUser = await requireOwnerAccess(request, response);
    if (!ownerUser) {
      return;
    }

    if (!ensureEmailServer(response)) {
      return;
    }

    const { to, subject } = request.body || {};
    const targetEmail = required(to)
      ? to.trim().toLowerCase()
      : required(ownerUser.email)
        ? ownerUser.email.trim().toLowerCase()
        : ownerEmail.trim().toLowerCase();

    if (!required(targetEmail)) {
      jsonError(response, 400, "Missing recipient email for test send.");
      return;
    }

    const testSubject = required(subject)
      ? subject.trim()
      : `Hablawithflow email test - ${new Date().toISOString()}`;

    await sendEmailWithResend({
      from: emailFrom,
      to: targetEmail,
      subject: testSubject,
      html: `
        <p><strong>Resend connection:</strong> OK</p>
        <p><strong>Sent at:</strong> ${escapeHtml(new Date().toISOString())}</p>
        <p><strong>Server:</strong> Hablawithflow API</p>
      `
    }, "owner email test");

    response.json({
      ok: true,
      message: `Test email sent to ${targetEmail}.`,
      to: targetEmail
    });
  } catch (error) {
    console.error("Failed to send owner test email", error);
    jsonError(response, 500, publicErrorMessage("Failed to send test email.", error));
  }
});

app.post("/api/owner/teacher-register", async (request, response) => {
  try {
    const ownerUser = await requireOwnerAccess(request, response);
    if (!ownerUser) {
      return;
    }

    const { name, email, timezone, bio, hourlyRate } = request.body || {};
    if (![name, email].every(required)) {
      jsonError(response, 400, "Missing teacher registration fields.");
      return;
    }

    const result = await registerTeacherAccess({
      name,
      email,
      timezone,
      bio,
      hourlyRate,
      source: "owner_teacher_registration"
    });

    response.json({
      ok: true,
      message: result.existingUser
        ? "Teacher access granted to existing account."
        : result.inviteEmailSent
          ? "Teacher invite sent."
          : "Teacher account created. Share the setup link manually.",
      existingUser: result.existingUser,
      inviteEmailSent: result.inviteEmailSent,
      accountSetupUrl: result.accountSetupUrl,
      requestedBy: ownerUser.email || ""
    });
  } catch (error) {
    console.error("Failed to register teacher account", error);
    jsonError(response, 500, publicErrorMessage("Failed to register teacher account.", error));
  }
});

app.post("/api/email/register", async (request, response) => {
  if (!ensureEmailServer(response)) {
    return;
  }

  const { name, email, track, goal, timezone } = request.body || {};

  if (![name, email, track, goal].every(required)) {
    jsonError(response, 400, "Missing registration email fields.");
    return;
  }

  try {
    const sends = [
      sendEmailWithResend({
        from: emailFrom,
        to: email,
        subject: "Bienvenido to Hablawithflow | Your registration is confirmed",
        html: registrationHtml({
          name,
          email,
          track,
          goal,
          timezone: required(timezone) ? timezone : "Not set"
        })
      }, "student registration confirmation")
    ];

    if (required(ownerEmail)) {
      sends.push(
        sendEmailWithResend({
          from: emailFrom,
          to: ownerEmail,
          subject: `New registration: ${name}`,
          html: `
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Track:</strong> ${track}</p>
            <p><strong>Goal:</strong> ${goal}</p>
            <p><strong>Timezone:</strong> ${required(timezone) ? timezone : "Not set"}</p>
          `
        }, "owner registration notification")
      );
    }

    await Promise.all(sends);

    response.json({
      ok: true,
      message: "Registration emails sent."
    });
  } catch (error) {
    console.error("Failed to send registration email", error);
    jsonError(response, 500, publicErrorMessage("Failed to send registration email.", error));
  }
});

app.post("/api/email/booking", async (request, response) => {
  if (!ensureEmailServer(response)) {
    return;
  }

  const { studentName, email, date, time, lessonType, message } = request.body || {};

  if (![studentName, email, date, time, lessonType].every(required)) {
    jsonError(response, 400, "Missing booking email fields.");
    return;
  }

  try {
    await sendBookingEmails({
      studentName,
      email,
      date,
      time,
      lessonType,
      message: required(message) ? message : "",
      isExistingStudent: true,
      studentSubject: "Your Hablawithflow lesson is confirmed",
      teacherSubject: `New booking: ${studentName} on ${date} ${time}`,
      teacherHeading: "A lesson has been booked",
      source: "Student portal booking flow"
    });

    response.json({
      ok: true,
      message: "Booking emails sent."
    });
  } catch (error) {
    console.error("Failed to send booking email", error);
    jsonError(response, 500, publicErrorMessage("Failed to send booking email.", error));
  }
});

app.post("/api/email/payment-pending", async (request, response) => {
  if (!ensureEmailServer(response)) {
    return;
  }

  const { studentName, email, date, time, lessonType } = request.body || {};
  if (![studentName, email, date, time, lessonType].every(required)) {
    jsonError(response, 400, "Missing payment pending email fields.");
    return;
  }

  try {
    await sendEmailWithResend(
      {
        from: emailFrom,
        to: email,
        subject: "Lesson reserved | Please complete your payment",
        html: paymentPendingHtml({
          studentName,
          date,
          time,
          lessonType
        })
      },
      "student payment pending reminder"
    );

    response.json({
      ok: true,
      message: "Payment pending email sent."
    });
  } catch (error) {
    console.error("Failed to send payment pending email", error);
    jsonError(response, 500, publicErrorMessage("Failed to send payment pending email.", error));
  }
});

app.post("/api/email/trial-booking", async (request, response) => {
  if (!ensureEmailServer(response)) {
    return;
  }

  const { studentName, email, date, time, lessonType, message, timezone } = request.body || {};

  if (![studentName, email, date, time, lessonType].every(required)) {
    jsonError(response, 400, "Missing trial booking email fields.");
    return;
  }

  try {
    let inviteOutcome = {
      created: false,
      existingUser: true,
      accountSetupUrl: "",
      accountSetupSent: false
    };

    if (supabaseAdmin) {
      inviteOutcome = await createInviteLinkForTrialStudent({
        studentName,
        email,
        lessonType,
        timezone,
        message
      });
      inviteOutcome.accountSetupSent = Boolean(inviteOutcome.accountSetupUrl);
    }

    await sendBookingEmails({
      studentName,
      email,
      date,
      time,
      lessonType,
      message: required(message) ? message : "",
      accountSetupUrl: inviteOutcome.accountSetupUrl,
      isExistingStudent: inviteOutcome.existingUser,
      studentSubject: inviteOutcome.existingUser
        ? "Your Hablawithflow free trial is confirmed"
        : "Your free trial is confirmed | Set your Hablawithflow password",
      teacherSubject: `New trial booking: ${studentName} on ${date} ${time}`,
      teacherHeading: "A free trial lesson has been booked",
      source: inviteOutcome.existingUser
        ? "Landing page booking flow for existing student"
        : "Landing page booking flow for new student"
    });

    response.json({
      ok: true,
      message: "Trial booking emails sent.",
      existingAccount: inviteOutcome.existingUser,
      accountSetupSent: inviteOutcome.accountSetupSent,
      accountSetupConfigured: Boolean(supabaseAdmin)
    });
  } catch (error) {
    console.error("Failed to send trial booking email", error);
    jsonError(response, 500, publicErrorMessage("Failed to send trial booking email.", error));
  }
});

app.post("/api/email/teacher-interest", async (request, response) => {
  if (!ensureEmailServer(response)) {
    return;
  }

  const { name, email, message } = request.body || {};

  if (![name, email, message].every(required)) {
    jsonError(response, 400, "Missing teacher interest email fields.");
    return;
  }

  try {
    const sends = [];

    if (required(ownerEmail)) {
      sends.push(
        sendEmailWithResend({
          from: emailFrom,
          to: ownerEmail,
          subject: `Teacher application interest: ${name}`,
          html: `
            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Message:</strong></p>
            <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
          `
        }, "owner teacher-interest notification")
      );
    }

    sends.push(
      sendEmailWithResend({
        from: emailFrom,
        to: email,
        subject: "We received your teacher application interest",
        html: `
          <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
            <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
              <div style="padding:18px 28px;background:linear-gradient(135deg,#c0392b 0%,#cf4c35 100%);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Teacher Interest</div>
                <h1 style="margin:10px 0 0;font-size:28px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">Gracias for reaching out</h1>
              </div>
              <div style="padding:32px 28px;">
                <p style="margin:0 0 14px;font-size:18px;line-height:1.6;">Hi ${escapeHtml(name)},</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#514741;">
                  We received your message about becoming a teacher on Hablawithflow. We will review your details and get back to you if there is a fit.
                </p>
                <div style="padding:18px 20px;border-radius:18px;background:#fbf5ef;border:1px solid #efe1d5;">
                  <div style="margin:0 0 8px;font-size:14px;font-weight:700;color:#8c5a47;">Your message</div>
                  <p style="margin:0;font-size:15px;line-height:1.7;color:#514741;">${escapeHtml(message).replace(/\n/g, "<br>")}</p>
                </div>
              </div>
            </div>
          </div>
        `
      }, "teacher-interest confirmation")
    );

    await Promise.all(sends);

    response.json({
      ok: true,
      message: "Teacher interest email sent."
    });
  } catch (error) {
    console.error("Failed to send teacher interest email", error);
    jsonError(response, 500, publicErrorMessage("Failed to send teacher interest email.", error));
  }
});

app.use(express.static(projectRoot));

app.get("/", (request, response) => {
  response.sendFile(path.join(projectRoot, "index.html"));
});

app.listen(port, () => {
  console.log(`App backend running at http://127.0.0.1:${port}`);
  startBookingReminderWorker();
});
