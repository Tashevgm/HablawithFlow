import Stripe from "npm:stripe@16.10.0";
import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

type CheckoutPayload = {
  booking_id?: string;
};

function normalizeLessonType(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getLessonProductConfig(lessonType: string) {
  const normalized = normalizeLessonType(lessonType);

  if (normalized === "1-on-1" || normalized === "1-on-1 lesson" || normalized === "1-on-1 class") {
    return {
      label: "1-on-1",
      productEnv: "STRIPE_PRODUCT_ONE_ON_ONE"
    };
  }

  if (normalized === "group classes" || normalized === "group class") {
    return {
      label: "Group Classes",
      productEnv: "STRIPE_PRODUCT_GROUP_CLASSES"
    };
  }

  return null;
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
    const siteUrl = String(Deno.env.get("SITE_URL") || "https://hablawithflow.com").replace(/\/+$/, "");

    if (!stripeSecretKey) {
      return jsonResponse({ ok: false, error: "Stripe secret key is not configured." }, 500);
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ ok: false, error: "Missing authorization header." }, 401);
    }

    const supabase = createAdminClient();
    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ ok: false, error: "Could not verify the current student session." }, 401);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, track")
      .eq("id", user.id)
      .maybeSingle();

    const role = String(profile?.role || user.user_metadata?.role || "student").toLowerCase();
    if (role === "teacher" || role === "admin") {
      return jsonResponse({ ok: false, error: "Teacher accounts cannot open student checkout." }, 403);
    }

    const payload = (await request.json().catch(() => ({}))) as CheckoutPayload;
    const bookingId = String(payload.booking_id || "").trim();

    if (!bookingId) {
      return jsonResponse({ ok: false, error: "No booking_id was provided." }, 400);
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, lesson_date, lesson_time, lesson_type, status")
      .eq("id", bookingId)
      .eq("student_id", user.id)
      .maybeSingle();

    if (bookingError || !booking) {
      return jsonResponse({ ok: false, error: "Could not load the selected booking for checkout." }, 400);
    }

    const { data: allStudentBookings, error: allBookingsError } = await supabase
      .from("bookings")
      .select("id, lesson_date, lesson_time, status")
      .eq("student_id", user.id)
      .order("lesson_date", { ascending: true })
      .order("lesson_time", { ascending: true });

    if (allBookingsError) {
      return jsonResponse({ ok: false, error: "Could not verify the student's free first lesson state." }, 500);
    }

    const activeStatuses = new Set(["pending_payment", "payment_submitted", "confirmed_paid"]);
    const firstFreeLessonBookingId = (allStudentBookings || []).find((entry) => {
      return activeStatuses.has(String(entry.status || "").toLowerCase());
    })?.id;

    if (String(booking.id) === String(firstFreeLessonBookingId || "")) {
      return jsonResponse({ ok: false, error: "The first booked lesson is free and should not go through Stripe checkout." }, 400);
    }

    if (String(booking.status || "").toLowerCase() !== "pending_payment") {
      return jsonResponse({ ok: false, error: "This booking is no longer waiting for payment." }, 400);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20"
    });

    const lessonConfig = getLessonProductConfig(booking.lesson_type);
    if (!lessonConfig) {
      return jsonResponse(
        { ok: false, error: `Unsupported lesson type for checkout: ${booking.lesson_type || "Unknown"}.` },
        400
      );
    }

    const productId = String(Deno.env.get(lessonConfig.productEnv) || "").trim();
    if (!productId) {
      return jsonResponse(
        { ok: false, error: `Missing Stripe product configuration for ${lessonConfig.label}.` },
        500
      );
    }

    const { data: prices } = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 1
    });

    const price = prices[0];
    if (!price) {
      return jsonResponse(
        { ok: false, error: `No active Stripe price found for ${lessonConfig.label}.` },
        500
      );
    }

    const metadata = {
      booking_id: String(booking.id),
      student_id: user.id,
      student_email: user.email || "",
      lesson_type: String(booking.lesson_type || lessonConfig.label),
      product_id: productId,
      price_id: price.id
    };

    console.log("[create-checkout-session] creating session", {
      booking_id: booking.id,
      student_id: user.id,
      lesson_type: booking.lesson_type,
      product_id: productId,
      price_id: price.id
    });
    console.log("[create-checkout-session] metadata", metadata);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      success_url: `${siteUrl}/student-portal.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/student-portal.html?checkout=cancelled`,
      payment_method_types: ["card"],
      client_reference_id: user.id,
      metadata,
      line_items: [
        {
          price: price.id,
          quantity: 1
        }
      ]
    });

    console.log("[create-checkout-session] session created", {
      booking_id: booking.id,
      session_id: session.id,
      has_url: Boolean(session.url)
    });

    return jsonResponse({
      ok: true,
      url: session.url
    });
  } catch (error) {
    console.error("[create-checkout-session] error", error);
    const message = error instanceof Error ? error.message : "Could not create Stripe Checkout session.";
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
