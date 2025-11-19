# Documentation: Web-to-App Promotion Policy

**Version:** 1.0  
**Date:** February 28, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Purpose

This policy captures the rules governing how web surfaces (landing pages, invite links, partner campaigns) promote the native Guar[APP]ari application. It ensures every module (Invite, Onboarding, Task & Reminder, Partner Analytics) follows the same stance when deciding whether high-value actions can occur on the web or must flow through the app.

## 2. Launch Stance

1. **Native-App Requirement for Core Actions**
   * Invite acceptance, booking confirmations, task completions, check-ins, and partner-required workflows must be performed inside the native app (Flutter client). Web experiences stop at showing context and prompting the user to open or install the app.
2. **Web Landing Behavior**
   * Landing pages display invite/event summaries, partner branding, and analytics instrumentation, but their primary CTA is “Open in App.” Deep links (`app://invite/{code}`) or fallback app-store links handle navigation. We track click → app-open funnels to evaluate conversion.
3. **Deferred Features**
   * Rich web interactions (confirming invites, chatting, uploading docs) are explicitly out of scope for launch. Modules should not expose public web APIs for these actions until the policy is revisited.

## 3. Future Evaluation Criteria

We will revisit the policy after Phase 8 (Gamification Spine) once we have sufficient telemetry on invite funnels. A shift toward web confirmations or web-native chat will require:

1. **Security Parity:** Equivalent authentication/authorization guarantees on the web as in the app.
2. **Task & Reminder Bridging:** Ability to schedule push/email reminders even when the acceptance originated on the web.
3. **Module Parity:** Invite, Onboarding, Map, and Transaction modules must expose consistent schemas so both web and app clients stay in sync.
4. **Partner Requirements:** Certain partner tiers may fund lighter web funnels; these will be evaluated per tenant with opt-in contracts.

## 4. Implications by Module

| Module | Impact |
|--------|--------|
| Invite & Social Loop | Web surfaces deep link to the app; no server-side confirmation without app context. Web instrumented events feed analytics but do not mutate invites. |
| Onboarding Flow | All onboarding steps (preferences, location, contact import) are app-only. Web page simply informs the user of the benefits. |
| Task & Reminder | Push reminders always point to app deep links; no SMS/email fallbacks until Phase 13. |
| Tenant Home Composer | Search/filter deep links from the web map to the app’s initial filter payloads. |
| Partner Analytics | Tracks web landing traffic but attributes conversions only when the app reports completion events. |

## 5. Policy Maintenance

* Any proposal to relax the app requirement must update this file, the system roadmap section, and the affected module docs.
* Changes require product and partner stakeholder approval, since they affect revenue-sharing agreements and data privacy.

---

*Next Review:* After Phase 8 telemetry review or sooner if growth experiments justify reconsideration.
