# Documentation: Onboarding Flow Module

**Version:** 0.1  
**Date:** February 28, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Scope

The Onboarding Flow module (MOD-307) owns the full first-time experience across the app. It orchestrates how a user—often entering through an invite link—progresses from invite context to account creation, preference capture, and location initialization. While the Invite & Social Loop module handles the graph logic, onboarding governs the UI state machine, partial profile storage, and cross-module handoffs.

## 2. Entry Paths

1. **Invite Acceptance Path**
    * Steps:
        * User lands via `inviteCode` deep link → sees invite context (sender, event, incentives).
        * `Accept` action immediately confirms the invite (even before full account creation) and emits `invite.accepted`.
        * Screen flows continue with:
            1. Minimal identity capture (name + email/phone).
            2. Contact import prompt (`import contacts to share with friends`) wired to Invite module’s endpoint.
            3. Optional “Find friends” preview from `friend_resumes` to encourage immediate viral sharing.
        * After contact import (or skip), user transitions to preference capture + location consent steps to personalize home/map.
    * Integration: Directly calls `/v1/app/invites/{inviteCode}/accept/import-contacts` if the user chooses to import, and passes invite metadata into onboarding state so preference recommendations can reference the same event/partner.

2. **Invite Decline / No Invite Path**
    * Steps:
        * User declines invite (or arrives without one) → flows into preference capture wizard.
        * Prompts include “What are you looking for today?” categories, location consent, and optional contact import later in the flow.
        * Produced values feed Tenant Home Composer (initial sections) and Map module (initial filters).
    * Integration: When user declines an invite for an event, onboarding triggers `invite.suppressed` for that event and optionally suggests alternative events via home/map modules.

## 3. Core Responsibilities

1. **Invite Context Transfer**
    * Store `invite_context_snapshot` with sender info, event metadata, partner incentives.
    * Provide this snapshot to downstream modules to pre-populate CTAs (“Join João at Praia Jam”).

2. **Partial Profile Persistence**
    * `onboarding_sessions` documents track progress (steps completed, deferred tasks, associated invite).
    * Sessions expire after defined inactivity windows; Task & Reminder module receives `task.intent` when users exit mid-way.

3. **Preference Capture**
    * Standard API contract: `POST /v1/onboarding/preferences` with categories, tags, location sharing preference, radius default.
    * Stored preferences feed initial Map filter payloads and Tenant Home Composer rulesets.

4. **Location Consent & Initialization**
    * Step ensures location permissions are requested once, with tenant-specific privacy copy.
    * On acceptance, onboarding initializes `LocationRepository`/`UserLocationService` so other modules can read immediately.

5. **Task & Reminder Hooks**
    * When user skips contact import, preferences, or location, onboarding emits `task.intent` event specifying which step needs follow-up. The Task module schedules push reminders (“Finish tailoring your experience”).

6. **Gamification / Rewards**
    * Early completion badges (e.g., “Hometown Host”) and invite boosts for users who import contacts during onboarding.

## 4. Integration with Invite Module

* After `invite.accepted`, onboarding listens for `invite.accepted.contacts-import-triggered` to mark the contact-import step as completed automatically.
* When `invite.suppressed` occurs, onboarding ensures future prompts respect the suppression but still directs the user to preference capture so they can find other events.
* On finishing onboarding, emit `onboarding.completed` event referencing whether the user entered via invite or organic path. This helps Invites/Gamification calibrate rewards.

## 5. Open Questions

1. Should we allow anonymous exploration (limited map access) before completing onboarding, or do we gate all main surfaces until preferences/location are captured?
2. How do we handle invite acceptance when the event is full or expired mid-onboarding? (Fallback suggestions, auto-decline plus onboarding path.)
3. Do we need separate onboarding variants for partner/promoter roles, or do they share the same core flow with role selection prompts?

---

*Next Action:* Flesh out collection schemas (`onboarding_sessions`, `preference_snapshots`), API details, and UI sequence diagrams once we finalize the answers above.
