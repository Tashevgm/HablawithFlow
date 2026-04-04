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
const lessonTimezoneDefault = process.env.LESSON_TIMEZONE_DEFAULT || "Europe/London";
const bookingReminderMinutes = Math.max(1, Number(process.env.BOOKING_REMINDER_MINUTES || 15));
const bookingReminderWindowMinutes = Math.max(1, Number(process.env.BOOKING_REMINDER_WINDOW_MINUTES || 5));
const bookingReminderPollMs = Math.max(15000, Number(process.env.BOOKING_REMINDER_POLL_MS || 60000));
const TEACHER_ROLES = new Set(["teacher", "admin"]);
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const resend = resendApiKey ? new Resend(resendApiKey) : null;
const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
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
      "Supabase admin is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the server environment."
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

async function requireTeacherAccess(request, response) {
  const user = await requireAuthenticatedUser(request, response);
  if (!user) {
    return null;
  }

  const metadataRole = String(user.user_metadata?.role || "").trim().toLowerCase();
  const profileRole = await getProfileRole(user.id);
  const role = profileRole || metadataRole;

  if (!TEACHER_ROLES.has(role)) {
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
            Your Hablawithflow lesson is starting soon. Use the Google Meet link below to join on time.
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
              Join Google Meet
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
  if (reminderWorkerRunning || !supabaseAdmin || !resend || !required(googleMeetLink) || !reminderSchemaReady) {
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

      await sendEmailWithResend({
        from: emailFrom,
        to: booking.student_email,
        subject: `Reminder: your lesson starts in ${bookingReminderMinutes} minutes`,
        html: lessonReminderHtml({
          studentName,
          lessonType,
          lessonStartLabel,
          meetLink: googleMeetLink.trim(),
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

  if (!required(googleMeetLink)) {
    console.log("Booking reminder worker disabled: GOOGLE_MEET_LINK is not configured.");
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
        <li><strong>Owner test email:</strong> <code>POST /api/owner/email-test</code></li>
        <li><strong>Owner reminder trigger:</strong> <code>POST /api/owner/booking-reminders/run</code></li>
        <li><strong>Website:</strong> <a href="/">/</a></li>
      </ul>
    </div>
  `);
});

app.get("/api/health", (request, response) => {
  response.json({
    ok: true,
    service: "hablawithflow-app-backend",
    email: {
      provider: "resend",
      configured: Boolean(resendApiKey),
      from: emailFrom,
      overrideTo: required(emailOverrideTo) ? emailOverrideTo.trim().toLowerCase() : "",
      ownerConfigured: required(ownerEmail),
      teacherNotificationRecipients: listBookingNotificationRecipients().length
    },
    supabaseAdminConfigured: Boolean(supabaseAdmin)
  });
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
        status: "pending_payment"
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

app.get("/api/teacher/students", async (request, response) => {
  try {
    const teacherUser = await requireTeacherAccess(request, response);
    if (!teacherUser) {
      return;
    }
    const teacherUserId = String(teacherUser.id || "").trim();
    const teacherEmail = String(teacherUser.email || "").trim().toLowerCase();

    const [{ data: profileRows, error: profileError }, authUsers] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, role, full_name, level, track, goal, notes"),
      listAuthUsers(10)
    ]);

    if (profileError) {
      throw profileError;
    }

    const authUserById = new Map(authUsers.map((user) => [user.id, user]));
    const students = (profileRows || [])
      .filter((profile) => String(profile.role || "student").toLowerCase() === "student")
      .map((profile) => {
        const authUser = authUserById.get(profile.id);
        const email = (authUser?.email || "").trim().toLowerCase();
        if (!required(email)) {
          return null;
        }

        if ((required(teacherUserId) && String(profile.id || "").trim() === teacherUserId) || (required(teacherEmail) && email === teacherEmail)) {
          return null;
        }

        const metadataRole = String(authUser?.user_metadata?.role || "").trim().toLowerCase();
        if (metadataRole === "teacher" || metadataRole === "admin") {
          return null;
        }

        if (required(ownerEmail) && email === ownerEmail.trim().toLowerCase()) {
          return null;
        }

        const metadataName = String(authUser?.user_metadata?.full_name || "").trim();
        const fullName = String(profile.full_name || metadataName || email.split("@")[0]).trim();

        return {
          id: profile.id,
          email,
          name: fullName,
          full_name: fullName,
          level: profile.level || "Beginner",
          track: profile.track || "1-on-1",
          goal: profile.goal || "Conversation",
          notes: profile.notes || ""
        };
      })
      .filter(Boolean);

    response.json({
      ok: true,
      students
    });
  } catch (error) {
    console.error("Failed to fetch teacher students", error);
    jsonError(response, 500, "Failed to fetch teacher student roster.");
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
