import Stripe from "npm:stripe@16.10.0";
import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

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
        status: "confirmed_paid",
        paid_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from("bookings")
        .update(updatePayload)
        .eq("id", bookingId)
        .select();

      console.log("[stripe-webhook] supabase update result", {
        booking_id: bookingId,
        error: error?.message || null,
        rows_updated: Array.isArray(data) ? data.length : 0
      });

      if (error) {
        return jsonResponse({ ok: false, error: error.message }, 500);
      }
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("[stripe-webhook] error", error);
    const message = error instanceof Error ? error.message : "Stripe webhook handling failed.";
    return jsonResponse({ ok: false, error: message }, 400);
  }
});
