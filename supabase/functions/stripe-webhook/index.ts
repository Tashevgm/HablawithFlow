import Stripe from "npm:stripe@16.10.0";
import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

function required(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatLessonDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  return parsed.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function formatLessonTime(value: unknown) {
  const raw = String(value || "").trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) {
    return raw.slice(0, 5);
  }
  return raw;
}

function paidBookingHtml({
  studentName,
  lessonType,
  lessonDate,
  lessonTime,
  timezone
}: {
  studentName: string;
  lessonType: string;
  lessonDate: string;
  lessonTime: string;
  timezone: string;
}) {
  const safeStudentName = escapeHtml(studentName);
  const safeLessonType = escapeHtml(lessonType);
  const safeLessonDate = escapeHtml(lessonDate);
  const safeLessonTime = escapeHtml(lessonTime);
  const safeTimezone = escapeHtml(timezone);

  return `
    <div style="margin:0;padding:32px 16px;background:#f6f1ea;font-family:Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid #eadfd7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,0.08);">
        <div style="padding:18px 28px;background:linear-gradient(135deg,#c0392b 0%,#cf4c35 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.86;">Payment Confirmed</div>
          <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:700;">Your lesson is fully confirmed</h1>
        </div>

        <div style="padding:32px 28px;">
          <p style="margin:0 0 14px;font-size:18px;line-height:1.6;">Hi ${safeStudentName},</p>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#514741;">
            We received your payment. Your class is now confirmed and ready.
          </p>

          <div style="margin:0 0 24px;padding:20px;border-radius:18px;background:#fbf5ef;border:1px solid #efe1d5;">
            <div style="margin:0 0 14px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#8c5a47;">
              Lesson details
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.7;color:#3f342d;">
              <tr>
                <td style="padding:4px 0;font-weight:700;width:130px;">Type</td>
                <td style="padding:4px 0;">${safeLessonType}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;font-weight:700;">Date</td>
                <td style="padding:4px 0;">${safeLessonDate}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;font-weight:700;">Time</td>
                <td style="padding:4px 0;">${safeLessonTime}${safeTimezone ? ` (${safeTimezone})` : ""}</td>
              </tr>
            </table>
          </div>

          <p style="margin:0;font-size:14px;line-height:1.7;color:#6a5c53;">
            You will also receive your lesson reminder before class starts.
          </p>
        </div>
      </div>
    </div>
  `;
}

async function sendPaidBookingConfirmationEmail({
  to,
  studentName,
  lessonType,
  lessonDate,
  lessonTime,
  timezone
}: {
  to: string;
  studentName: string;
  lessonType: string;
  lessonDate: string;
  lessonTime: string;
  timezone: string;
}) {
  const resendApiKey = String(Deno.env.get("RESEND_API_KEY") || "").trim();
  const emailFrom = String(Deno.env.get("EMAIL_FROM") || "Hablawithflow <onboarding@resend.dev>").trim();
  const emailOverrideTo = String(Deno.env.get("EMAIL_OVERRIDE_TO") || "").trim().toLowerCase();
  const recipient = required(emailOverrideTo) ? emailOverrideTo : String(to || "").trim().toLowerCase();

  if (!resendApiKey) {
    console.log("[stripe-webhook] skipping paid confirmation email: RESEND_API_KEY is missing.");
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: emailFrom,
      to: recipient,
      subject: "Payment received | Your Hablawithflow lesson is confirmed",
      html: paidBookingHtml({
        studentName,
        lessonType,
        lessonDate,
        lessonTime,
        timezone
      })
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Resend email failed (${response.status}): ${bodyText.slice(0, 400)}`);
  }

  console.log("[stripe-webhook] paid confirmation email sent", {
    to: recipient,
    response: bodyText.slice(0, 200)
  });
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeSecretKey || !webhookSecret) {
      return jsonResponse({ ok: false, error: "Stripe webhook secrets are not configured." }, 500);
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return jsonResponse({ ok: false, error: "Missing Stripe signature header." }, 400);
    }

    const body = await request.text();
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20"
    });

    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    console.log("[stripe-webhook] incoming event", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata || {};
      const bookingId = String(metadata.booking_id || "").trim();

      console.log("[stripe-webhook] metadata", metadata);

      if (!bookingId) {
        return jsonResponse({ ok: false, error: "Missing booking_id in Stripe session metadata." }, 400);
      }

      const supabase = createAdminClient();
      const updatePayload = {
        status: "confirmed_paid"
      };

      const { data, error } = await supabase
        .from("bookings")
        .update(updatePayload)
        .eq("id", bookingId)
        .in("status", ["pending_payment", "payment_submitted"])
        .select("id, student_email, student_name, lesson_type, lesson_date, lesson_time, timezone, status");

      console.log("[stripe-webhook] supabase update result", {
        booking_id: bookingId,
        error: error?.message || null,
        rows_updated: Array.isArray(data) ? data.length : 0
      });

      if (error) {
        return jsonResponse({ ok: false, error: error.message }, 500);
      }

      const updatedBooking = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!updatedBooking) {
        console.log("[stripe-webhook] booking already processed or not payable", {
          booking_id: bookingId
        });
      } else {
        const recipientEmail = String(updatedBooking.student_email || metadata.student_email || "").trim().toLowerCase();

        if (!required(recipientEmail)) {
          console.log("[stripe-webhook] skipping paid confirmation email: missing student_email", {
            booking_id: bookingId
          });
        } else {
          const studentName = required(updatedBooking.student_name)
            ? String(updatedBooking.student_name).trim()
            : recipientEmail.split("@")[0];
          const lessonType = required(updatedBooking.lesson_type)
            ? String(updatedBooking.lesson_type).trim()
            : "Spanish lesson";
          const lessonDate = formatLessonDate(updatedBooking.lesson_date) || String(updatedBooking.lesson_date || "").trim();
          const lessonTime = formatLessonTime(updatedBooking.lesson_time);
          const timezone = String(updatedBooking.timezone || "").trim();

          try {
            await sendPaidBookingConfirmationEmail({
              to: recipientEmail,
              studentName,
              lessonType,
              lessonDate,
              lessonTime,
              timezone
            });
          } catch (emailError) {
            console.error("[stripe-webhook] paid confirmation email failed", {
              booking_id: bookingId,
              to: recipientEmail,
              error: emailError instanceof Error ? emailError.message : String(emailError)
            });
          }
        }
      }
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("[stripe-webhook] error", error);
    const message = error instanceof Error ? error.message : "Stripe webhook handling failed.";
    return jsonResponse({ ok: false, error: message }, 400);
  }
});
