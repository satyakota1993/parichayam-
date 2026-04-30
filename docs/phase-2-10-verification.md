# Phase 2.10 Verification

Date: 2026-04-29
Branch: `codex/agent-dashboard-complete`

## Implemented

- Agent dashboard now renders five tabs: Overview, Leads, Earnings, Tools, Profile.
- Overview uses server-side commission summary from `calculateAgentCommissions`/`agentGetDashboard`: total earned, locked, available, paid out, monthly performance, tier progress, activity, and anonymous leaderboard.
- Leads view supports status/date/city filtering, search by name/phone/city, manual lead creation, CSV export, mobile card-style table layout, and Phase 2 payment status badges.
- Earnings view uses `agentGetCommissionLedger` for chronological `revenueEvents` rows, payout history, tax summary, and payout request controls.
- Tools view includes referral link, QR generation/download through `qrcode.js`, WhatsApp share deep link, Firestore WhatsApp templates, festivals, and marketing materials.
- Profile view includes personal details, editable WhatsApp/languages/TDS preference, masked bank details, document status, and password change.
- Telugu/English toggle persists to `localStorage` and reads strings from `agent-i18n.json`.
- Backend settings are stored in Firestore app state keys:
  - `appState/parichayam_agent_commission_settings`
  - `appState/parichayam_agent_tiers`
  - `appState/parichayam_leaderboard_settings`
  - `appState/parichayam_whatsapp_notification_settings`
- Default tiers, 8 festivals, 5 WhatsApp templates, and 4 marketing material placeholders are seeded by `getAgentSettings` / `agentGetDashboard` if missing.
- `calculateAgentCommissions` and payout eligibility now use `revenueEvents`, lock status, clawbacks, paid-out payouts, and pending payouts.
- Added scheduled `updateAgentTiers`.
- Added WhatsApp notification triggers with Interakt/Twilio support, notification logging, and email-webhook fallback:
  - `notifyAgentNewSignup`
  - `notifyAgentPaymentReceived`
  - `notifyAgentCommissionUnlocked`
  - `notifyAgentPayoutProcessed`
  - `notifyAgentWeeklyDigest`
  - `notifyAgentFestivalReminder`
  - plus refund/tier-upgrade notifications.
- Admin has a new Agent Settings tab with commission settings, tier table, festival editor, leaderboard settings, and WhatsApp trigger toggles.
- Firestore rules and indexes were updated for settings/content collections and notification logs.

## Commands Run

- `node --check functions/index.js` passed.
- Inline JavaScript parse check for `agent.html` and `admin.html` passed.
- `firestore.indexes.json` and `agent-i18n.json` JSON parse checks passed.

## Not Fully Verifiable In This Desktop Session

- Actual phone testing at 360px and WhatsApp app handoff still needs to be done on a physical Android/iOS device.
- WhatsApp notifications are disabled by default. Provider delivery requires founder-supplied Interakt/Twilio credentials in `functions/.env` / Cloud Functions environment (`WHATSAPP_API_PROVIDER`, `WHATSAPP_API_KEY`, `WHATSAPP_SENDER_NUMBER`) and a successful admin test notification before enabling the master switch.
- Email fallback requires `FALLBACK_EMAIL_WEBHOOK_URL` or equivalent mail webhook.
- End-to-end payment/refund timing should be verified against Firebase emulator or staging data after deployment because Cloud Functions triggers depend on live Firestore writes.

## Scenario Checklist

- New agent setup: UI/backend paths implemented; needs staging login test.
- Referral and commission flow: referral lead sync and revenue ledger calculation implemented; needs staging payment test.
- Tier upgrade: scheduled updater implemented; needs scheduled/manual invocation test.
- Payout flow: request and admin process paths implemented; needs staging payout test.
- Refund clawback: ledger consumption implemented; needs staging refund test.
- Telugu UI: static and dynamic dashboard labels implemented; founder copy review required.
- Admin controls: UI and `adminSaveAgentSettings` implemented; needs admin save test.
- Mobile end-to-end: responsive layout implemented; physical device test pending.

## Pre-Deploy Hardening (Round 2)

Date: 2026-04-29

Applied 5 fixes from independent review:

- [x] B1: Committed all Phase 2.10 work (commit `4a9405c`)
- [x] H1: Tightened Firestore rules - whatsappTemplates/marketingMaterials/festivals now require agent or admin (commit `51c582a`)
- [x] H2: Added per-day WhatsApp send cap (default 200/day, configurable) (commit `6e3edd3`)
- [x] H3: WhatsApp notifications disabled by default until credentials configured (commit `0384bd3`)
- [x] H4: notifyAgentCommissionUnlocked now uses indexed query with limit 500 (commit `0d1e6d9`)

Validation:

- node --check functions/index.js: PASS
- JSON parse checks: PASS
- Inline JS parse for agent.html and admin.html: PASS

Status: READY FOR STAGING DEPLOY

Founder must complete physical phone testing (10 scenarios in initial verification report) before production merge.
