# Matchmaker Lean Audit

Date: 2026-04-29
Branch: `codex/matchmaker-lean-v1`

## Files Reviewed

- `matchmaker.html` (entire file)
- `dashboard.html`
  - matchmaker nav around lines 800-870
  - matchmaker view around lines 2025-2165
  - verification handoff around lines 2347+
- `admin.html`
  - matchmaker/staff references
  - staff assignment + role management around lines 1711-1751 and 3815-3950
- `functions/index.js`
  - `memberAssignments` and staff listing around lines 2661-2700
- `parichayam-firebase.js`
  - staff role helpers
  - `createMemberAssignment`, `listMemberAssignments`, `saveMemberAssignment`
  - `logStaffActivity`, `listStaffActivity`
- `firestore.rules`
  - staff helpers near top
  - member update allowlist
  - `memberAssignments` and `staffActivityLogs`

## Current State

### What works today

- `matchmaker.html` is a working staff portal for `ADMIN`, `MATCHMAKER`, and `EMPLOYEE`.
- The portal already loads:
  - assigned client cases from `memberAssignments`
  - verification tasks from `verificationRequests`
  - staff activity from `staffActivityLogs`
  - member directory data from `listMembersForStaff`
- Admin can:
  - promote members to `MATCHMAKER`, `EMPLOYEE`, or `ADMIN`
  - assign a member to matchmaker or employee from `admin.html`
  - write assignment metadata back onto `members/{uid}`
- Firestore rules already support:
  - staff helper `isStaff()`
  - staff-only updates to specific member workflow fields
  - per-assignee access to `memberAssignments`
  - per-actor access to `staffActivityLogs`
- `parichayam-firebase.js` already exposes reusable patterns for staff/member role checks and assignment CRUD.

### What is stubbed or demo-only

- `dashboard.html` "My Matchmaker" is static showcase content:
  - hardcoded matchmaker identity
  - hardcoded packages
  - hardcoded shortlisted profiles
  - fake request/chat interactions
- `matchmaker.html` is not a real matchmaking workboard yet:
  - no universal search
  - no Member 360
  - no suggestions pipeline
  - no family introduction workflow
  - no messaging system beyond external WhatsApp links
- `functions/index.js` has no matchmaker subscription, suggestion, notes, messages, activity timeline, or reassignment endpoints yet.
- There is no dedicated `matchSuggestions`, `familyIntroductions`, `matchmakerSubscriptions`, `matchmakerNotes`, `matchmakerMessages`, `activityLog`, or `analyticsEvents` collection.

## Existing `memberAssignments` Schema

Current `memberAssignments` documents are lightweight operational case records created by admin through `parichayam-firebase.js`:

- `memberUid`
- `memberName`
- `memberPhone`
- `memberEmail`
- `memberCity`
- `memberTier`
- `assignedToUid`
- `assignedToName`
- `assignedRole`
- `status`
- `note`
- `incentiveAmount`
- `nextFollowUpAt`
- `lastContactAt`
- `outcome`
- `createdAt`
- `updatedAt`
- `createdBy`

This schema is appropriate for generic staff follow-up and verification work, but it is not suitable as the source of truth for member-to-member matchmaking.

### Coexistence Decision

`memberAssignments` and the new `matchSuggestions` collection should coexist as separate collections.

- `memberAssignments` should remain the staff/admin operational case queue.
- `matchSuggestions` should become the matching domain record between two members.
- `matchmakerSubscriptions` should become the exclusive-assignment source of truth.
- `activityLog` should become the append-only cross-surface timeline.

Reusing `memberAssignments` for suggestions would create schema conflicts, status collisions, and unsafe rule overlaps with the current staff portal.

## Existing Matchmaker Role Permissions

### In rules

- `isStaff()` currently includes `ADMIN`, `MATCHMAKER`, and `EMPLOYEE`.
- Members can read only their own `members/{uid}` document unless admin.
- Staff can update only an allowlisted subset of workflow fields on member docs.
- `memberAssignments`:
  - admin can create/delete
  - admin or assignee can read
  - admin or assignee can update limited fields
- `staffActivityLogs`:
  - staff can create their own entries
  - admin or actor can read

### In frontend/client helper code

- `matchmaker.html` permits `ADMIN`, `MATCHMAKER`, `EMPLOYEE`.
- `parichayam-firebase.js` treats `ADMIN`, `MATCHMAKER`, `EMPLOYEE` as staff.
- `listMembersForStaff` returns all members to admin, but for non-admin staff it only returns members connected through:
  - `memberAssignments`
  - `verificationRequests`

### Gap versus Lean v1 requirements

Lean v1 needs two separate permission models:

- any matchmaker can search all paid members and see full photos
- only the assigned matchmaker can mutate a member's suggestions, notes, messages, or family introductions

That distinction does not exist today.

## Functions Wired to UI vs Orphaned

### Wired to UI today

- `matchmaker.html`
  - `window.ParichayamFirebase.listMemberAssignments()`
  - `window.ParichayamFirebase.listVerificationRequests()`
  - `window.ParichayamFirebase.listStaffActivity()`
  - `window.ParichayamFirebase.listMembers()`
  - `window.ParichayamFirebase.saveMemberAssignment()`
  - `window.ParichayamFirebase.saveVerificationRequest()`
  - `window.ParichayamFirebase.logStaffActivity()`
- `admin.html`
  - `window.ParichayamFirebase.setMemberRole()`
  - `window.ParichayamFirebase.createMemberAssignment()`
  - `window.ParichayamFirebase.updateMemberFields()`
  - `window.ParichayamFirebase.logStaffActivity()`
- `functions/index.js`
  - `listMembersForStaff`

### Effectively orphaned for Lean v1

- Current dashboard matchmaker chat/request interactions are client-only demo behavior.
- Current matchmaker packages in `dashboard.html` are hardcoded and not backed by billing or app state.
- Current staff assignment lifecycle in `memberAssignments` is not consumed by member-facing matching flows.

## References to Old or Pre-Lean Data

- `dashboard.html` uses hardcoded matchmaker name, packages, note copy, shortlisted profiles, and WhatsApp number.
- `matchmaker.html` is built around generic "client operations" and incentive tracking, not member-to-member matching.
- `admin.html` exposes "Matchmaker Operations Portal" only as a link to the current staff portal.
- Existing member fields `assignedMatchmakerUid` and `assignedMatchmakerName` are already used for staff assignment metadata, but not yet tied to paid subscription lifecycle or exclusive-assignment enforcement.

## Broken Features or Structural Gaps

- There is no server-side suggestion model, so mutual-interest, family introductions, and engagement progression cannot persist.
- There is no server-side photo gating for matchmaker/member contexts.
- There is no append-only activity timeline for members or matchmakers.
- There is no matchmaker subscription billing flow tied to `revenueEvents`.
- There is no sticky reassignment logic on renewal.
- There is no admin-only reassignment transaction/history flow.
- There is no name autocomplete field/backfill (`nameLower`) for universal search.

## Conflict Risks With New Code

### 1. `assignedMatchmakerUid` already exists

This field is already written from `admin.html` for generic staff assignment. Lean v1 must preserve that field name, but shift its authority to:

- subscription enrollment
- admin reassignment
- subscription expiry cleanup

Ad hoc writes from member-facing client code must remain blocked.

### 2. `matchmaker.html` currently includes employees

The current portal is intentionally shared by `MATCHMAKER` and `EMPLOYEE`. Lean v1 will turn `matchmaker.html` into a true matchmaker operating system, so employee-only verification workflows should not be broken silently. The safest path is to preserve the existing access gate and adapt the UI by role where needed.

### 3. Existing admin staff tools and new admin matchmaker tools will overlap

`admin.html` already has staff promotion/assignment controls. New matchmaker management and lifecycle tabs must not break:

- staff promotion
- generic member assignment
- verification queue support

### 4. Rules must distinguish search visibility from mutation authority

Lean v1 requires:

- all matchmakers can search and view full photos
- only assigned matchmaker can mutate member-specific records

The rules need both `isMatchmaker()` and `isAssignedMatchmaker(memberUid)`. Using only one helper would either leak write access or block required search behavior.

### 5. Activity source split

`staffActivityLogs` already exists for operational actions. Lean v1 introduces `activityLog` as the member/matchmaker/admin truth source. The new build should add `activityLog` without retrofitting or deleting `staffActivityLogs`, otherwise current staff workflows may regress.

## Recommended Build Boundaries

- Keep `memberAssignments` and `staffActivityLogs` intact for existing operations.
- Add all Lean v1 matching behavior in new collections and endpoints.
- Extend `dashboard.html`, `matchmaker.html`, and `admin.html` incrementally instead of replacing existing structures.
- Reuse Phase 2.10 patterns for:
  - auth verification helpers
  - appState settings persistence
  - admin save endpoints
  - targeted validation and verification docs

## Summary

The codebase already has a usable staff operations foundation, role metadata, assignment fields on member docs, and admin tools for staffing. It does not yet have a matchmaking domain model. Lean v1 should be built as a new layer on top of the current staff/assignment system, not by repurposing `memberAssignments` into match records.
