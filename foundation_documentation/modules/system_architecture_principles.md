# Documentation: System Architecture Principles (Bóora! Platform)

**Version:** 1.0  
**Date:** March 8, 2025  
**Authors:** Belluga Engineering

## 1. Overview

This document defines the **project-specific architectural principles** for the Bóora! platform. These principles **extend** (do not replace) the agnostic core rules in `delphi-ai/system_architecture_principles.md`.

Bóora! is the platform. Guar[APP]ari is a **tenant** hosted on the platform and serves as the first reference implementation.

---

## 2. Scope & Source of Truth

1. **Agnostic Core (Mandatory):** `delphi-ai/system_architecture_principles.md` is the canonical baseline for all projects.
2. **Project-Specific Additions (This Document):** Any platform/tenant decisions unique to Bóora! live here.

---

## 3. Platform & Tenant Model

1. **Platform vs Tenant:** Bóora! operates as a multi-tenant platform. Each tenant has its own domain, branding, and content scope. Guar[APP]ari is one tenant, not the platform itself.
2. **Tenant-Scoped APIs:** All tenant data is served via tenant-scoped APIs; landlord/global APIs remain separated by routing and authorization.
3. **Account vs Partner:** Accounts are generic administrative containers. Partner is a first-class domain model stored separately and linked 1:1 to `account_id`.

---

## 4. API & Data Access Principles (Project-Specific)

1. **Page-Based Lists + SSE Deltas:** All lists are page-based; realtime updates are delivered via SSE delta streams that never replace the list contract.
2. **Independent Requests for Home:** No aggregated home endpoint in MVP. The client composes home using independent requests (invites, agenda, discovery, map).
3. **Invite Attribution:** Share codes are attribution tokens. Accepting via `/invites/share/{code}/accept` must record source = `share_url`, and uniqueness rules prevent duplicate invite issuance to the same person/event.
4. **Taxonomy-Ready Discovery:** Partners support multi-taxonomy terms (`{type, value}`), and discovery filters can target taxonomy terms in addition to categories/tags.

---

## 5. Client Architecture Addendum

1. **Repository Boundaries:** Controllers/services may coordinate multiple repositories, but repositories never call each other.
2. **Realtime Consumption:** Clients subscribe to SSE streams for deltas and reconcile against page-based caches.

---

## 6. Documentation Rules (Project-Specific)

1. **Naming:** Bóora! is the platform; Guar[APP]ari is a tenant.
2. **Module Docs:** Use tenant-accurate wording (e.g., “tenant app users”) unless describing tenant-specific UI or copy.
3. **Tenant-Specific Assets:** Marketing collateral and screen copy may remain tenant-specific.
