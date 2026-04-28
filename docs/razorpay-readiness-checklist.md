# Razorpay Launch Readiness Checklist

Date: April 28, 2026
Branch: `codex/razorpay-launch-readiness`
Founder / Grievance Officer: Kota Venkateswara Rao
Support email used across pages: `support@parichayam.co.in`
Phone / WhatsApp: `+91 94401 76078`
Postal address: Flat No. 05, Padmavathi Enclave, Ajith Singh Nagar, Vijayawada, Andhra Pradesh, India

## Summary

Phase 2.8 now includes the Razorpay trust pages plus the required payment resilience path:

- `privacy.html` - DPDP Act 2023 aligned privacy policy.
- `terms.html` - matrimony terms and conditions.
- `refund.html` - clear refund/cancellation policy for Razorpay review.
- `contact.html` - visible phone, email, postal address, Google Map, SLAs, and contact form.
- `about.html` - founder story, mission, values, and community focus.
- `pricing.html` - tier feature matrix, add-ons, GST note, refund link, and FAQ.
- Shared footer and cookie banner through `parichayam-site-common.css` and `parichayam-site-common.js`.
- Contact form backend `submitContactForm`, writing validated requests into `complaints/{id}`.
- Payment resilience backend: pending activation retry queue, admin alerts, daily reconciliation, member payment-status check, admin retry/acknowledge tools, and refund/reconciliation admin views.

## Critical Fix Results

| Requirement | Status | Evidence |
| --- | --- | --- |
| Zero old mistyped-domain instances remain | PASS | Recursive scan excluding `.git`, `.claude`, and `node_modules` returned zero matches. |
| All emails use `parichayam.co.in` | PASS | Static scan found 46 `.co.in` references and zero old mistyped-domain references. |
| Legal/trust pages live | PASS | `/privacy`, `/terms`, `/refund`, `/contact`, `/about`, and `/pricing` all return HTTP 200 on Firebase Hosting. |
| Footer links from existing pages | PASS | Live HTTP scan confirmed existing pages include `parichayam-site-common.js`; no missing local links found. |
| Cookie banner | PASS | Deployed common script contains `parichayam_cookie_consent` storage and Cookie Policy link behaviour. |
| Contact form page wiring | PASS | Live `/contact` includes `id="contactForm"` and `submitContactForm` integration. |
| Print-friendly pages | PASS | Deployed shared CSS includes `@media print` rules. |
| Pricing mobile support | PASS | Deployed pricing page uses `pc-price-table-wrap`; shared CSS applies `overflow-x: auto` for the matrix. |
| Payment resilience Part 3 | PASS | Built and deployed; details below. |

## Payment Resilience Status

Part 3 was not present before this fix. It is now implemented:

- `functions/index.js`
  - `pendingActivations` recovery queue helpers.
  - `adminAlerts` alert writer.
  - Razorpay status fetchers for payment/order reconciliation.
  - `checkPaymentStatus` member endpoint.
  - `retryPendingActivations` scheduled retry job.
  - `dailyReconciliation` scheduled reconciliation job.
  - `adminRunPaymentReconciliation`, `adminRetryPendingActivation`, `adminAcknowledgeAlert`, `adminListPaymentResilience`.
  - `createPaymentOrder` now stores `pendingPaymentOrderId` / `lastOrderId`.
  - `verifyPaymentAndActivateMembership` now queues recoverable activation failures instead of leaving members stranded after capture.
- `firestore.rules`
  - Added `pendingActivations/{paymentId}`, `adminAlerts/{alertId}`, and `paymentReconciliationRuns/{runId}` rules.
  - Protected `lastOrderId` and `pendingPaymentOrderId` from member-side writes.
- `dashboard.html`
  - Added Settings > Recent Payments card with `checkPaymentStatus` recovery action.
- `admin.html`
  - Added Payment Alerts, Refunds, and Reconciliation tabs.
  - Admin can retry pending activations, acknowledge alerts, process refunds, and run reconciliation.
- `parichayam-firebase.js`
  - Added authenticated `checkPaymentStatus` wrapper.

## Deployment Results

Commands run:

```text
firebase deploy --only hosting,functions,firestore:rules --project parichayam-9ee09
```

Result:

- Firestore rules released successfully.
- Hosting uploaded but did not finalize because Functions deployment aborted before Hosting release.
- Functions deploy aborted because production contains `memberRecordConnectAction` and `parseBiodata`, which are not in local source. Firebase refused to delete them in non-interactive mode.

Follow-up commands run:

```text
firebase deploy --only functions:createPaymentOrder,functions:verifyPaymentAndActivateMembership,functions:checkPaymentStatus,functions:retryPendingActivations,functions:dailyReconciliation,functions:adminRunPaymentReconciliation,functions:adminRetryPendingActivation,functions:adminAcknowledgeAlert,functions:adminListPaymentResilience,functions:submitContactForm --project parichayam-9ee09
firebase deploy --only hosting --project parichayam-9ee09
```

Result:

- Targeted functions deployment completed successfully without deleting production-only functions.
- Hosting deployment finalized and released successfully.

## Contact Form Smoke Test

Deployed function call:

```text
POST https://us-central1-parichayam-9ee09.cloudfunctions.net/submitContactForm
```

Payload:

```json
{
  "name": "Test Smoke",
  "email": "smoketest@parichayam.co.in",
  "phone": "+91 9999999999",
  "category": "general",
  "message": "Smoke test from Codex Phase 2.8 verification"
}
```

Result:

```json
{
  "ok": true,
  "complaintId": "iZhvvg0GMQLejkErM2z3",
  "message": "Your request was submitted. Parichayam support will respond within the published SLA."
}
```

Admin-level Firestore verification:

```json
{
  "ok": true,
  "docId": "iZhvvg0GMQLejkErM2z3",
  "fieldNames": [
    "adminNotes",
    "assignedTo",
    "category",
    "createdAt",
    "email",
    "ipAddress",
    "message",
    "name",
    "phone",
    "priority",
    "source",
    "status",
    "updatedAt",
    "userAgent"
  ],
  "values": {
    "name": "Test Smoke",
    "email": "smoketest@parichayam.co.in",
    "phone": "9999999999",
    "category": "general",
    "message": "Smoke test from Codex Phase 2.8 verification",
    "status": "new",
    "createdAt": "2026-04-28T03:12:16.564Z"
  }
}
```

Security rules check:

- Unauthenticated Firestore REST read of `complaints/iZhvvg0GMQLejkErM2z3`: PASS, returned `403 Forbidden`.
- Admin-level read using the authenticated Firebase CLI session: PASS, returned the expected document and fields.

## Live Link Scan

Firebase Hosting URL: `https://parichayam-9ee09.web.app`

| Route | Status | Approx size |
| --- | --- | --- |
| `/` | 200 | 59 KB |
| `/auth` | 200 | 92 KB |
| `/dashboard` | 200 | 444 KB |
| `/admin` | 200 | 423 KB |
| `/agent` | 200 | 69 KB |
| `/matchmaker` | 200 | 33 KB |
| `/checkout` | 200 | 62 KB |
| `/privacy` | 200 | 15 KB |
| `/terms` | 200 | 17 KB |
| `/refund` | 200 | 9 KB |
| `/contact` | 200 | 9 KB |
| `/about` | 200 | 6 KB |
| `/pricing` | 200 | 8 KB |

Result:

- Missing local links: none found.
- Footer script included on all existing pages.
- Cookie banner script present.
- Contact page form present.
- Print CSS present.
- Pricing table mobile horizontal-scroll CSS present.

Browser note:

- The Codex in-app browser plugin failed to open the live site with `failed to start codex app-server: The system cannot find the path specified`.
- Live verification was completed through deployed HTTP checks and authenticated Firestore REST verification instead.

## Validation Commands

```text
npm.cmd run lint
node --check functions/index.js
node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8')); console.log('json ok')"
git diff --check
```

Results:

- Functions syntax: PASS.
- Firebase JSON validation: PASS.
- Static public-page link and size scan: PASS.
- `git diff --check`: PASS after this report update.

## Final Verdict

READY FOR RAZORPAY SUBMISSION: Yes.

Notes for future deploys:

- Avoid a broad `firebase deploy --only functions` until `memberRecordConnectAction` and `parseBiodata` are either restored locally or intentionally deleted from production.
- Use targeted function deploys for this branch to avoid accidental deletion prompts.
