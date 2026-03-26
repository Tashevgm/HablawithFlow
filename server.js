require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");

const app = express();
const projectRoot = __dirname;
const port = Number(process.env.PORT || 8787);
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM || "Hablawithflow <onboarding@resend.dev>";
const ownerEmail = process.env.OWNER_EMAIL || "";
const publicSiteUrl = process.env.PUBLIC_SITE_URL || "https://hablawithflow.com";

const resend = resendApiKey ? new Resend(resendApiKey) : null;

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

function bookingHtml({ studentName, date, time, lessonType, message }) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1a1a1a">
      <h2 style="margin-bottom:8px">Your lesson is booked</h2>
      <p>Hi ${studentName},</p>
      <p>Your Hablawithflow lesson is confirmed.</p>
      <ul>
        <li><strong>Date:</strong> ${date}</li>
        <li><strong>Time:</strong> ${time}</li>
        <li><strong>Lesson type:</strong> ${lessonType}</li>
      </ul>
      ${message ? `<p><strong>Your note:</strong> ${message}</p>` : ""}
      <p>You can log in to your student portal to see your lesson progress and upcoming sessions.</p>
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

app.use(express.static(projectRoot));

app.get("/", (request, response) => {
  response.sendFile(path.join(projectRoot, "index.html"));
});

app.listen(port, () => {
  console.log(`App backend running at http://127.0.0.1:${port}`);
});
