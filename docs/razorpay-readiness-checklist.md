# Razorpay Launch Readiness Checklist

Date: April 27, 2026  
Branch: `codex/razorpay-launch-readiness`  
Founder / Grievance Officer: Kota Venkateswara Rao  
Support email used across pages: `support@parichayam.co.im`  
Phone / WhatsApp: `+91 94401 76078`  
Postal address: Flat No. 05, Padmavathi Enclave, Ajith Singh Nagar, Vijayawada, Andhra Pradesh, India

## Summary

Phase 2.8 added the mandatory Razorpay trust and legal surface for Parichayam:

- `privacy.html` - DPDP Act 2023 aligned privacy policy.
- `terms.html` - full matrimony terms and conditions.
- `refund.html` - clear refund/cancellation policy for Razorpay review.
- `contact.html` - visible phone, email, postal address, Google Map, SLAs, and contact form.
- `about.html` - founder story, mission, values, and community focus.
- `pricing.html` - tier feature matrix, add-ons, GST note, refund link, and FAQ.
- Shared footer and cookie banner added through `parichayam-site-common.css` and `parichayam-site-common.js`.
- Contact form backend added as `submitContactForm`, writing validated requests into `complaints/{id}`.
- Firestore rules added for public complaint creation and admin-only complaint reads.

## Checklist

| Requirement | Status | Evidence |
| --- | --- | --- |
| All 6 mandatory pages created | PASS | `privacy.html`, `terms.html`, `refund.html`, `contact.html`, `about.html`, `pricing.html` exist. |
| Production content, no lorem ipsum | PASS | Static scan on six new pages found no lorem ipsum or TODO/TBD content. |
| Effective date and last updated on policies | PASS | Privacy, Terms, and Refund all show April 27, 2026. |
| DPDP grievance officer details filled | PASS | Kota Venkateswara Rao, support email, phone, 15-day SLA. |
| Full postal address visible | PASS | Contact, Privacy, and Terms include the Vijayawada address. |
| Refund policy clear for Razorpay | PASS | Includes 7-day cooling-off, no full refund after assignment, no refund after first suggestion, verification/add-on rules, gateway fee deduction, timelines, and escalation. |
| Pricing matrix readable and linked | PASS | `pricing.html` includes full tier matrix and responsive horizontal scroll for small screens. |
| Footer added to existing pages | PASS | Common footer script/CSS included in `index.html`, `auth.html`, `dashboard.html`, `admin.html`, `agent.html`, `matchmaker.html`, and `checkout.html`. |
| Public nav updated | PASS | `index.html`, `auth.html`, and `pricing.html` expose About, Pricing, Contact, Sign In, Register. |
| Cookie banner working path added | PASS | Banner stores `parichayam_cookie_consent=accepted` in `localStorage` and links to `privacy.html#cookies`. |
| Contact form wired to Firestore path | PASS | `contact.html` calls `ParichayamFirebase.submitContactForm`; Cloud Function writes `complaints/{id}`. |
| Complaint rules added | PASS | `firestore.rules` allows validated public create and admin-only read/update/delete. |
| Internal links on public pages | PASS | Node static link scan found no missing local references on the six new public pages. |
| Page weight under 200KB for new public pages | PASS | Privacy 15.7KB, Terms 17.2KB, Refund 9.4KB, Contact 9.0KB, About 5.9KB, Pricing 8.1KB. |
| Founder image path does not 404 | PASS | Added lightweight `founder.jpg` placeholder with founder initials. |
| Print-friendly legal pages | PASS | Shared CSS includes `@media print` rules hiding navigation/footer/cookie banner and removing heavy backgrounds. |

## Validation Commands

```text
npm.cmd --prefix functions run lint
node --check functions/index.js
node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8')); console.log('json ok')"
git diff --check
```

Results:

- Functions syntax: PASS.
- Firebase JSON validation: PASS.
- Diff whitespace check: PASS.
- Static public-page link and size scan: PASS.

## Contact Form Smoke Test

Added `scripts/razorpay-readiness-smoke.js` to submit a sample contact request to the Firebase Functions emulator and verify the resulting `complaints/{id}` document through the Firestore emulator REST API.

Attempted command:

```text
firebase emulators:exec --only functions,firestore --project parichayam-9ee09 "node scripts/razorpay-readiness-smoke.js"
```

Local Firebase CLI result:

```text
Welcome to firepit v1.1.0!
Error: spawn EPERM
```

The same emulator command was retried with elevated execution approval and exited without producing emulator logs. `firestore-debug.log` remained empty. This appears to be a local Firebase standalone CLI/Firepit launcher issue, not a code syntax issue. Before production deployment, run the smoke test in an environment where Firebase emulators start successfully, or install the npm-based `firebase-tools` CLI and re-run the command above.

## Notes and Follow-ups

- The support email provided for this task was `support@parichayam.co.im`; all new public pages and app defaults now use that email. Confirm that `.co.im` is the intended live domain before submitting Razorpay activation.
- `dashboard.html` and `admin.html` are pre-existing large app pages above 200KB. The six new Razorpay public pages are all under 200KB.
- `refund-policy.html` now redirects to `refund.html` so old links do not show the outdated refund language.
- `firebase.json` now supports clean routes for `/about`, `/pricing`, and `/refund`.

## Verdict

Conditional GO for Razorpay content review: the mandatory pages, visible trust details, refund policy, footer, cookie banner, and contact backend code are in place. Final production GO should wait for the contact form smoke test to pass in a Firebase emulator or staging deployment because the local Firebase CLI could not launch emulators on this machine.
