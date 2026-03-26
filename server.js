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
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1a1a1a">
      <h2 style="margin-bottom:8px">Your registration is confirmed</h2>
      <p>Hi ${name},</p>
      <p>Your Hablawithflow registration has been confirmed successfully.</p>
      <ul>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Track:</strong> ${track}</li>
        <li><strong>Main goal:</strong> ${goal}</li>
        <li><strong>Timezone:</strong> ${timezone}</li>
      </ul>
      <p>You can now sign in to the student portal using the email and password you created.</p>
      <p>If you book a lesson, you will also receive a separate booking confirmation email.</p>
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
        subject: "Your Hablawithflow registration is confirmed",
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
