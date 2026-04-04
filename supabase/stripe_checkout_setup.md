# Stripe Checkout Setup

## Edge Functions added

- `create-checkout-session`
- `stripe-webhook`
- `create-plan-checkout-session`

## Supabase function secrets to set

Set these in Supabase for your Edge Functions:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_test_xxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
supabase secrets set STRIPE_CURRENCY=gbp
supabase secrets set STRIPE_LESSON_PRICE_MINOR=2000
supabase secrets set STRIPE_PRODUCT_ONE_ON_ONE=prod_xxx
supabase secrets set STRIPE_PRODUCT_GROUP_CLASSES=prod_xxx
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set EMAIL_FROM="Hablawithflow <vladimirtsagov@hablawithflow.com>"
supabase secrets set SITE_URL=https://hablawithflow.com
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase secrets set SUPABASE_URL=https://ubetwjpyookwdgtfppim.supabase.co
```

## Deploy functions

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy create-plan-checkout-session
```

## Stripe webhook endpoint

Add this endpoint in Stripe:

```text
https://ubetwjpyookwdgtfppim.supabase.co/functions/v1/stripe-webhook
```

Subscribe to:

- `checkout.session.completed`

## Current payment behavior

- Student pays booked lessons from `student-portal.html`
- Checkout is created in Stripe for booked lessons that are still unpaid
- The first active lesson stays free and is excluded server-side
- Stripe webhook marks paid lessons as `confirmed_paid`
- Stripe webhook sends a payment-confirmation email to the student after status changes to `confirmed_paid`
- Student `Pay Now` uses the booking `lesson_type` to choose:
  - `STRIPE_PRODUCT_ONE_ON_ONE`
  - `STRIPE_PRODUCT_GROUP_CLASSES`
- The landing-page `Choose Your Flow` buttons open Stripe Checkout directly using:
  - `STRIPE_PRODUCT_ONE_ON_ONE`
  - `STRIPE_PRODUCT_GROUP_CLASSES`

## Notes

- `STRIPE_PUBLISHABLE_KEY` is optional for the current redirect-based Checkout flow. It is not used by the Edge Functions.
- Product IDs belong in Supabase function secrets, not in frontend code.

## Security note

The Stripe secret key was pasted into chat during setup. Rotate that test secret in Stripe after you finish wiring your function secrets.
