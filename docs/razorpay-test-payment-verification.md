# Razorpay Test Payment Verification - April 28, 2026

Branch: `codex/razorpay-launch-readiness`
Firebase project: `parichayam-9ee09`
Hosting URL: `https://parichayam-9ee09.web.app`

## Summary

The Razorpay test-mode verification could not be completed end-to-end because the deployed Functions runtime does not currently have Razorpay credentials configured. A live readiness probe reached `createPaymentOrder`, but the function returned:

```json
{
  "message": "Payment verification is not configured yet."
}
```

This blocks Test 1 and every downstream payment, activation, ledger, refund, and reconciliation test.

## Fixes Applied During This Verification

The code also had a few setup gaps that would have blocked the requested sequence after keys were added. These are now fixed:

- Functions now accept both production-style env names and the prompt's test-mode names:
  - `RAZORPAY_KEY_ID` or `RAZORPAY_TEST_KEY_ID`
  - `RAZORPAY_KEY_SECRET` or `RAZORPAY_TEST_KEY_SECRET`
- Added optional webhook secret support:
  - `RAZORPAY_WEBHOOK_SECRET` or `RAZORPAY_TEST_WEBHOOK_SECRET`
- Added `razorpayWebhook` function for payment capture webhooks.
- Added Hosting rewrite for `/webhook/razorpay` to `razorpayWebhook`.
- Added `reconciliationReports/{yyyy-mm-dd}` report writes from reconciliation runs.
- Added Firestore rules for `reconciliationReports`.
- Added test-mode refund fallback alert path gated by:
  - test key mode (`rzp_test_...`)
  - `PARICHAYAM_TEST_REFUND_FALLBACK=true`
- Hardened Firebase Hosting ignores so backend source, docs, scripts, logs, and local patch files are not public.

## Runtime Probe

Probe steps performed:

1. Created a disposable Firebase Auth test user.
2. Initialised a member profile through deployed `initializeMyMemberProfile`.
3. Called deployed `createPaymentOrder` with:

```json
{
  "purchaseType": "membership",
  "plan": "1mo",
  "planName": "BASIC Test"
}
```

Actual result:

```json
{
  "uid": "NT0n8u243yUWXeO3I7JYkjf5q5a2",
  "email": "codex.razorpay.probe.1777351810199@parichayam.co.in",
  "phone": "9351810199",
  "initializeStatus": 200,
  "initializeOk": true,
  "createPaymentOrderStatus": 503,
  "createPaymentOrderOk": false,
  "createPaymentOrderBody": {
    "message": "Payment verification is not configured yet."
  }
}
```

Note: The disposable test Auth/member record was left in place. Deleting cloud data requires explicit confirmation.

## Deployment Status

The Razorpay test-mode compatibility fixes were deployed successfully:

```text
firebase deploy --only functions:createPaymentOrder,functions:verifyPaymentAndActivateMembership,functions:checkPaymentStatus,functions:razorpayWebhook,functions:retryPendingActivations,functions:dailyReconciliation,functions:adminRunPaymentReconciliation,functions:adminRetryPendingActivation,functions:adminAcknowledgeAlert,functions:adminListPaymentResilience,functions:processRefund,firestore:rules,hosting --project parichayam-9ee09
```

Deployment result:

- `razorpayWebhook` created.
- `processRefund` created.
- Payment/resilience functions updated.
- Firestore rules released.
- Hosting rewrite for `/webhook/razorpay` released.

Hosting exposure hardening was then deployed:

```text
firebase deploy --only hosting --project parichayam-9ee09
```

Live HTTP verification:

| URL | Expected | Actual |
| --- | --- | --- |
| `/functions/index.js` | 404 | 404 |
| `/recovery-stash.patch` | 404 | 404 |
| `/docs/razorpay-readiness-checklist.md` | 404 | 404 |
| `/webhook/razorpay` GET | 405 | 405 |
| `/pricing` | 200 | 200 |

## Test Results

| Test | Expected | Actual | Status |
| --- | --- | --- | --- |
| Test 1: Create Order | Razorpay order ID created | Blocked: `createPaymentOrder` returned 503 because Razorpay keys are not configured in deployed Functions runtime. | FAIL - BLOCKED |
| Test 2: Webhook Payment | Member activated, `membership_paid` revenue event created | Not run because Test 1 did not create an order. Webhook endpoint has been added for the next run. | BLOCKED |
| Test 3: Refund & Clawback | Refund event and alert/fallback path verified | Not run because no paid order exists. Test-mode fallback support has been added. | BLOCKED |
| Test 4: Referred Member & Commission | Membership + 15% commission events | Not run because order creation is blocked. | BLOCKED |
| Test 5: Admin Alerts | Alert created on retry failure | Not run because test payment data could not be created. Existing admin alert system remains deployed. | BLOCKED |
| Test 6: Daily Reconciliation | Report generated, zero mismatches | Not run because Razorpay access is not configured. `reconciliationReports/{date}` writes have been added. | BLOCKED |
| Test 7: Dashboard Member View | Payment status visible | Not run because no successful payment exists. Dashboard Recent Payments card is already deployed. | BLOCKED |
| Test 8: Admin Dashboard | Alerts, Refunds, Reconciliation tabs functional | Not re-tested visually. In-app browser runtime failed in the prior pass; HTTP/code checks remain clean. | BLOCKED |

## Required Before Re-Run

Add Razorpay test-mode credentials to `functions/.env` or the deployed Functions environment:

```text
RAZORPAY_TEST_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_TEST_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
RAZORPAY_TEST_WEBHOOK_SECRET=<test webhook secret if using signed dashboard webhooks>
PARICHAYAM_TEST_REFUND_FALLBACK=true
```

The deployed backend also accepts:

```text
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=<test webhook secret>
```

After adding keys, deploy only the affected functions and hosting rewrite:

```text
firebase deploy --only functions:createPaymentOrder,functions:verifyPaymentAndActivateMembership,functions:checkPaymentStatus,functions:razorpayWebhook,functions:retryPendingActivations,functions:dailyReconciliation,functions:adminRunPaymentReconciliation,functions:adminRetryPendingActivation,functions:adminAcknowledgeAlert,functions:adminListPaymentResilience,functions:processRefund,firestore:rules,hosting --project parichayam-9ee09
```

## Logs

```text
createPaymentOrder probe:
HTTP 503
Payment verification is not configured yet.

Validation:
npm.cmd run lint - PASS
node --check functions/index.js - PASS
firebase.json and firestore.indexes.json parse - PASS
git diff --check - PASS
```

## Conclusion

FAIL - BLOCKED BY MISSING RAZORPAY TEST CREDENTIALS.

The application is now prepared for Razorpay test-mode verification, but the end-to-end payment tests cannot pass until test keys are configured and deployed.

## Next Step

Configure Razorpay test credentials, redeploy the targeted functions/hosting/rules, then rerun Tests 1-8.
