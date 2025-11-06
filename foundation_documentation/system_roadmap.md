# Documentation: System Roadmap
**Version:** 1.0

## 1. Roadmap Overview

This roadmap enumerates the foundational milestones for the Belluga ecosystem. It aligns mocked implementations with the definitive architecture to guarantee a seamless transition toward production services.

## 2. Current Milestones

| Workstream | Milestone | Description | Target | Status | Owner |
|------------|-----------|-------------|--------|--------|-------|
| Flutter Client Experience | FCX-01 | Bootstrap DI container, theming, and StreamValue-based controller scaffolding. | 2025-02-28 | In Progress | Delphi |
| Flutter Client Experience | FCX-02 | Wire mocked repositories and services to tenant home, agenda, invites, and map controllers. | 2025-03-05 | Planned | Delphi |
| Flutter Client Experience | FCX-03 | Implement analytics instrumentation (logs, metrics, tracing) for prototype flows. | 2025-03-12 | Planned | Delphi |
| Flutter Client Experience | FCX-04 | Author operational runbook for prototype bootstrapping and mock backend rotation. | 2025-03-19 | Planned | Delphi |

## 3. API Endpoint Tracking

| Endpoint | Module | Description | Current Status | Notes |
|----------|--------|-------------|----------------|-------|
| `/v1/app/home-overview` | MOD-201 | Tenant home composition payload. | Mocked | Mock backend returns schema-aligned snapshot. |
| `/v1/app/invites` | MOD-201 | Invite feed and referral graph. | Mocked | Controller simulates pagination locally. |
| `/v1/app/agenda` | MOD-201 | Agenda and schedulable actions. | Mocked | Generates multi-day samples for testing UI. |
| `/v1/app/map/pois` | MOD-201 | Map POIs and live offers. | Mocked | WebSocket mock emits move/offer events. |
| `/v1/app/profile` | MOD-201 | Profile summary and role claims. | Defined | Mock payload authoring queued in FCX-02. |
| `/v1/app/onboarding/context` | MOD-201 | Dynamic onboarding strings and branding. | Defined | Requires content modeling before mocking. |

## 4. Risk & Mitigation Log

| ID | Risk | Impact | Mitigation |
|----|------|--------|------------|
| R-201-01 | Mock payload drift from backend contract. | UI regressions when real API arrives. | Maintain contract tests and share DTO schemas with backend team. |
| R-201-02 | Controller lifecycle leaks degrade performance. | Memory growth and navigation instability. | Enforce disposal patterns and add integration tests covering scope teardown. |
