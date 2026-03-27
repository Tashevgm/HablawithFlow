require("dotenv").config();

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
const publicSiteUrl = process.env.PUBLIC_SITE_URL || "https://hablawithflow.com";
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

function toPortalUrl(pathname) {
  return `${publicSiteUrl.replace(/\/$/, "")}${pathname}`;
}

function readBearerToken(request) {
  const authorization = request.headers?.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function requireOwnerAccess(request, response) {
  if (!ensureSupabaseAdmin(response)) {
    return null;
  }

  if (!required(ownerEmail)) {
    jsonError(response, 500, "OWNER_EMAIL is not configured on the server.");
    return null;
  }

  const accessToken = readBearerToken(request);
  if (!required(accessToken)) {
    jsonError(response, 401, "Missing owner session token.");
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) {
    jsonError(response, 401, "Invalid or expired owner session token.");
    return null;
  }

  const sessionEmail = (data.user.email || "").trim().toLowerCase();
  const normalizedOwnerEmail = ownerEmail.trim().toLowerCase();
  if (sessionEmail !== normalizedOwnerEmail) {
    jsonError(response, 403, "Owner access only.");
    return null;
  }

  return data.user;
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

async function findAuthUserByEmail(email) {
  if (!supabaseAdmin) {
    return null;
  }

  let page = 1;
  const normalizedEmail = email.trim().toLowerCase();

  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200
    });

    if (error) {
      throw error;
    }

    const users = data?.users || [];
    const match = users.find((user) => (user.email || "").toLowerCase() === normalizedEmail);
    if (match) {
      return match;
    }

    if (users.length < 200) {
      break;
    }

    page += 1;
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

app.get("/api", (request, response) => {
  response.type("html").send(`
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1a1a1a;padding:32px;max-width:760px">
      <h1 style="margin-bottom:8px">Hablawithflow App Backend</h1>
      <p>This server now powers both the website and the email API.</p>
      <ul>
        <li><strong>Health:</strong> <a href="/api/health">/api/health</a></li>
        <li><strong>Registration email:</strong> <code>POST /api/email/register</code></li>
        <li><strong>Booking email:</strong> <code>POST /api/email/booking</code></li>
        <li><strong>Website:</strong> <a href="/">/</a></li>
      </ul>
    </div>
  `);
});

app.get("/api/health", (request, response) => {
  response.json({
    ok: true,
    service: "hablawithflow-app-backend"
  });
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
      await resend.emails.send({
        from: emailFrom,
        to: normalizedEmail,
        subject: "Reset your Hablawithflow owner password",
        html: ownerPasswordResetHtml({
          resetUrl
        })
      });
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
    jsonError(response, 500, "Failed to send owner password reset.");
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

    const teacherName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedTimezone = required(timezone) ? timezone.trim() : "Europe/London";
    const teacherBio = required(bio) ? bio.trim() : "";
    const parsedHourlyRate = Number(hourlyRate);
    const normalizedHourlyRate = Number.isFinite(parsedHourlyRate) && parsedHourlyRate > 0 ? parsedHourlyRate : null;

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
          source: "owner_teacher_registration"
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
      await resend.emails.send({
        from: emailFrom,
        to: normalizedEmail,
        subject: "Your Hablawithflow teacher account is ready",
        html: teacherInviteHtml({
          teacherName,
          accountSetupUrl
        })
      });
      inviteEmailSent = true;
    }

    response.json({
      ok: true,
      message: existingUser
        ? "Teacher access granted to existing account."
        : inviteEmailSent
          ? "Teacher invite sent."
          : "Teacher account created. Share the setup link manually.",
      existingUser,
      inviteEmailSent,
      accountSetupUrl: existingUser || inviteEmailSent ? "" : accountSetupUrl,
      requestedBy: ownerUser.email || ""
    });
  } catch (error) {
    console.error("Failed to register teacher account", error);
    jsonError(response, 500, "Failed to register teacher account.");
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
      resend.emails.send({
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
      })
    ];

    if (required(ownerEmail)) {
      sends.push(
        resend.emails.send({
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
        })
      );
    }

    await Promise.all(sends);

    response.json({
      ok: true,
      message: "Registration emails sent."
    });
  } catch (error) {
    console.error("Failed to send registration email", error);
    jsonError(response, 500, "Failed to send registration email.");
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
    const sends = [
      resend.emails.send({
        from: emailFrom,
        to: email,
        subject: "Your Hablawithflow lesson is confirmed",
        html: bookingHtml({
          studentName,
          date,
          time,
          lessonType,
          message: required(message) ? message : ""
        })
      })
    ];

    if (required(ownerEmail)) {
      sends.push(
        resend.emails.send({
          from: emailFrom,
          to: ownerEmail,
          subject: `New booking: ${studentName} on ${date} ${time}`,
          html: `
            <p><strong>Student:</strong> ${studentName}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Date:</strong> ${date}</p>
            <p><strong>Time:</strong> ${time}</p>
            <p><strong>Lesson type:</strong> ${lessonType}</p>
            <p><strong>Message:</strong> ${required(message) ? message : "No note added."}</p>
          `
        })
      );
    }

    await Promise.all(sends);

    response.json({
      ok: true,
      message: "Booking emails sent."
    });
  } catch (error) {
    console.error("Failed to send booking email", error);
    jsonError(response, 500, "Failed to send booking email.");
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

    const sends = [
      resend.emails.send({
        from: emailFrom,
        to: email,
        subject: inviteOutcome.existingUser
          ? "Your Hablawithflow free trial is confirmed"
          : "Your free trial is confirmed | Set your Hablawithflow password",
        html: bookingHtml({
          studentName,
          date,
          time,
          lessonType,
          message: required(message) ? message : "",
          accountSetupUrl: inviteOutcome.accountSetupUrl,
          isExistingStudent: inviteOutcome.existingUser
        })
      })
    ];

    if (required(ownerEmail)) {
      sends.push(
        resend.emails.send({
          from: emailFrom,
          to: ownerEmail,
          subject: `New trial booking: ${studentName} on ${date} ${time}`,
          html: `
            <p><strong>Student:</strong> ${escapeHtml(studentName)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Date:</strong> ${escapeHtml(date)}</p>
            <p><strong>Time:</strong> ${escapeHtml(time)}</p>
            <p><strong>Lesson type:</strong> ${escapeHtml(lessonType)}</p>
            <p><strong>Account flow:</strong> ${
              inviteOutcome.existingUser ? "Existing student account" : "New password setup link sent"
            }</p>
            <p><strong>Message:</strong> ${required(message) ? escapeHtml(message) : "No note added."}</p>
          `
        })
      );
    }

    await Promise.all(sends);

    response.json({
      ok: true,
      message: "Trial booking emails sent.",
      existingAccount: inviteOutcome.existingUser,
      accountSetupSent: inviteOutcome.accountSetupSent,
      accountSetupConfigured: Boolean(supabaseAdmin)
    });
  } catch (error) {
    console.error("Failed to send trial booking email", error);
    jsonError(response, 500, "Failed to send trial booking email.");
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
        resend.emails.send({
          from: emailFrom,
          to: ownerEmail,
          subject: `Teacher application interest: ${name}`,
          html: `
            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Message:</strong></p>
            <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
          `
        })
      );
    }

    sends.push(
      resend.emails.send({
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
      })
    );

    await Promise.all(sends);

    response.json({
      ok: true,
      message: "Teacher interest email sent."
    });
  } catch (error) {
    console.error("Failed to send teacher interest email", error);
    jsonError(response, 500, "Failed to send teacher interest email.");
  }
});

app.use(express.static(projectRoot));

app.get("/", (request, response) => {
  response.sendFile(path.join(projectRoot, "index.html"));
});

app.listen(port, () => {
  console.log(`App backend running at http://127.0.0.1:${port}`);
});
