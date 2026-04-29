# Phase 2.10 Agent Dashboard Audit

Date: 2026-04-29
Branch: `codex/agent-dashboard-complete`

## Current Agent Portal

`agent.html` is a mobile-first page with agent login/application flow and four dashboard tabs:

- Overview: shows available balance, lead counts, conversion rate, a stage pipeline, due follow-ups, and recent activity.
- Leads: loads `agentGetLeads`, supports search by name/mobile/city, stage filtering, manual lead creation, notes, stage updates, and follow-up dates.
- Earnings: shows local lead-level conversion cards, payout request form, and payout history from `agentGetDashboard`.
- Tools: shows referral code/link, WhatsApp share, plan prices, profile details, UPI/area update, and change password.

## What Works Today

- Firebase Auth email/password login for approved agents.
- Self-serve agent application submission through `submitAgentApplication`.
- Agent identity enforcement through `verifyAgentUser`.
- Manual lead add/update via `agentAddLead` and `agentUpdateLead`.
- Referral-link lead sync through `syncAgentLeadOnMemberWrite`.
- Payout request validation through `agentRequestPayout`.
- Admin-created agents, application approval, and payout processing in `functions/index.js`.
- Phase 2 ledger endpoint `calculateAgentCommissions` reads trusted `revenueEvents`.
- Refund flow creates `refund_issued` and `commission_clawback` revenue events and marks locked commission events as disputed.

## Stubbed Or Incomplete

- Agent dashboard has only 4 tabs; Profile is folded into Tools.
- Overview still emphasizes lead pipeline/follow-ups rather than required commission cards, tier progress, monthly performance, and leaderboard.
- Leads view uses older pipeline stages and lead-level commission fields; it does not present Phase 2 lock/available/disputed states from `revenueEvents`.
- Earnings tab shows converted leads, not a trusted chronological ledger.
- Referral tools do not generate QR codes, do not download QR images, and do not read templates/festivals/materials from Firestore.
- Profile lacks bank-account masking, document status, WhatsApp/language editing, and TDS preference.
- Admin page has agent management but no dedicated Agent Settings tab for commission settings, tier config, festivals, leaderboard, or WhatsApp trigger toggles.
- WhatsApp notification triggers are not present.
- Tier thresholds are not Firestore-configurable and no scheduled tier updater exists.

## Old Data References

- `agent.html` and legacy admin code still reference `commissionAmount`, `commissionCredited`, `paidAmount`, `commissionPercent`, `totalEarned`, and `totalPaidOut` on `agentLeads`/`agents`.
- `computeAgentBalance` currently computes from converted `agentLeads`, while Phase 2 source of truth is `revenueEvents`.
- `getAgentCommissionPercent` uses legacy hardcoded tier names (`starter`, `standard`, `premium`, `custom`) and defaults to 25%.
- Admin referral dashboard contains localStorage-based legacy keys: `parichayam_agents`, `parichayam_agent_referral_settings`, `parichayam_agent_payout_history`, and `parichayam_agent_payout_requests`.
- Agent plan prices are read from localStorage on the agent page.

## Backend Functions: Wired Vs Orphaned

Wired to current UI:

- `submitAgentApplication`
- `agentGetDashboard`
- `agentGetLeads`
- `agentAddLead`
- `agentUpdateLead`
- `agentRequestPayout`
- `agentUpdateProfile`
- `agentChangePassword`
- `adminCreateAgent`
- `adminListAgents`
- `adminUpdateAgent`
- `adminProcessPayout`
- `adminListAgentApplications`
- `adminApproveAgentApplication`

Phase 2 wired elsewhere but not fully consumed by agent UI:

- `calculateAgentCommissions`
- `processRefund`
- `adminBackfillRevenueEvents`

Mostly backend/system functions not directly called by `agent.html`:

- `syncAgentLeadOnMemberWrite`
- payment activation/reconciliation/webhook functions
- public profile, member match, verification, contact, phone login, password reset, and staff/member functions

## Broken Or Risky Features

- Self-service payout availability can overstate balance because `computeAgentBalance` is lead-based and does not subtract locked commissions or revenue-ledger clawbacks.
- New revenue ledger commission rate is hardcoded at 15% via `REFERRED_AGENT_COMMISSION_RATE`; agent tiers/settings cannot tune it yet.
- Existing agent lead commission sync uses a separate legacy commission function, creating possible mismatch with `revenueEvents`.
- Agent dashboard can show commission numbers from stale lead documents after refunds.
- Firestore rules do not expose `festivals`, `whatsappTemplates`, `marketingMaterials`, or `notificationLog` to agents.
- Admin has no cost controls for WhatsApp notification sends.
- The current four-tab bottom nav does not meet the required five-tab structure.

## Implementation Direction

- Make `revenueEvents` the server-side source for balances, ledger, lock state, available amount, and refund clawbacks.
- Store business settings in Firestore `appState` keys and content collections.
- Keep legacy lead pipeline behavior for offline lead tracking, but render payment/commission status from server-enriched ledger fields.
- Add the missing admin settings surface without disturbing the existing agent management tab.
