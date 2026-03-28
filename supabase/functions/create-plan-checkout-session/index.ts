import Stripe from "npm:stripe@16.10.0";
import { corsHeaders } from "../_shared/cors.ts";

type PlanPayload = {
  plan_key?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function getPlanConfig(planKey: string) {
  const plans: Record<string, { productEnv: string; label: string }> = {
    one_on_one: {
      productEnv: "STRIPE_PRODUCT_ONE_ON_ONE",
      label: "1-on-1"
    },
    group_classes: {
      productEnv: "STRIPE_PRODUCT_GROUP_CLASSES",
      label: "Group Classes"
    }
  };

  return plans[planKey] || null;
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

    const payload = (await request.json().catch(() => ({}))) as PlanPayload;
    const planKey = String(payload.plan_key || "").trim();
    const planConfig = getPlanConfig(planKey);

    if (!planConfig) {
      return jsonResponse({ ok: false, error: "Unknown plan selected." }, 400);
    }

    const productId = String(Deno.env.get(planConfig.productEnv) || "").trim();
    if (!productId) {
      return jsonResponse({ ok: false, error: `Missing product configuration for ${planConfig.label}.` }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20"
    });

    const { data: prices } = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 1
    });

    const price = prices[0];
    if (!price) {
      return jsonResponse({ ok: false, error: `No active Stripe price found for ${planConfig.label}.` }, 500);
    }

    console.log("[create-plan-checkout-session] creating session", {
      plan_key: planKey,
      product_id: productId,
      price_id: price.id
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${siteUrl}/index.html?plan_checkout=success&plan=${encodeURIComponent(planKey)}`,
      cancel_url: `${siteUrl}/index.html?plan_checkout=cancelled&plan=${encodeURIComponent(planKey)}`,
      payment_method_types: ["card"],
      metadata: {
        plan_key: planKey,
        product_id: productId,
        price_id: price.id
      },
      line_items: [
        {
          price: price.id,
          quantity: 1
        }
      ]
    });

    console.log("[create-plan-checkout-session] session created", {
      plan_key: planKey,
      session_id: session.id,
      has_url: Boolean(session.url)
    });

    return jsonResponse({
      ok: true,
      url: session.url
    });
  } catch (error) {
    console.error("[create-plan-checkout-session] error", error);
    const message = error instanceof Error ? error.message : "Could not create Stripe Checkout session.";
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
