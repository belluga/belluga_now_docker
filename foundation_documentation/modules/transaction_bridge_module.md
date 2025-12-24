# Documentation: Transaction Bridge Module

**Version:** 1.0  
**Date:** February 28, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Overview

The Transaction Bridge module (MOD-305) connects tenant experiences to the external Commercial Engine. It orchestrates booking intents, deposits, payments, refunds, and loyalty credits while shielding the Flutter app from the complexity of multi-instrument pricing. The bridge persists lightweight booking projections and webhooks so we can continue operating during mock phases without a live payment processor.

---

## 2. Responsibilities

1. **Booking Lifecycle Management:** Translate offering reservations from the Partner Catalog or Map module into `booking_reservations` documents, assign status transitions, and keep agenda nodes synchronized.
2. **Payment Intent Mediation:** Create payment intents through the Commercial Engine, store the resulting `intent_reference`, and expose simplified status flags to clients (`pending`, `authorized`, `captured`, `failed`).
3. **Transaction Ledger Projection:** Maintain a tenant-scoped ledger summarizing every financial event so UI surfaces (profile balances, booking history) can query a single read model without touching external systems.
4. **Webhooks & Retry Policies:** Handle webhook callbacks (`payment.succeeded`, `refund.created`) with idempotent processors and exponential backoff queues.

---

## 3. Data Structures

### 3.1 `booking_reservations`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "user_id": "ObjectId()",
  "offer_id": "ObjectId()",
  "partner_id": "ObjectId()",
  "status": "String",
  "party_size": "Number",
  "scheduled_at": "Date",
  "payment_intent_id": "String",
  "pricing_snapshot": {
    "currency": "String",
    "amount": "Number",
    "pricing_model": "String",
    "comps_applied": ["String"]
  },
  "metadata": {},
  "created_at": "Date",
  "updated_at": "Date"
}
```

### 3.2 `transaction_ledger`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "user_id": "ObjectId()",
  "booking_id": "ObjectId()",
  "commercial_event_type": "String",
  "amount": "Number",
  "currency": "String",
  "direction": "String",
  "occurred_at": "Date",
  "external_reference": "String",
  "metadata": {}
}
```

### 3.3 `webhook_events`
Durable log of inbound webhook deliveries with ack status for observability.

---

## 4. Interfaces

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/bookings` | POST | Creates a reservation and initializes a payment intent. |
| `/api/v1/bookings/{bookingId}` | GET | Returns booking status, payment state, and action descriptors. |
| `/api/v1/bookings/{bookingId}/cancel` | POST | Cancels a pending booking and issues refunds when applicable. |
| `/api/v1/transactions` | GET | Lists ledger entries filtered by date or partner. |
| `/webhooks/commercial-engine` | POST | Receives signed webhook callbacks from the external Commercial Engine. |

---

## 5. Event Contract

* **Outbound:** `booking.created`, `booking.confirmed`, `booking.cancelled`, `payment.intent.updated`, `payment.refund.completed`.
* **Inbound:** `offer.published` (to validate pricing), `agenda.action.completed` (to mark bookings as consumed), `commercial.payment.succeeded` (webhook).

---

## 6. Roadmap Considerations

* **Short Term (Mocks):** Use deterministic mock payment responses and store fake intent IDs while still generating ledger entries.
* **Launch:** Integrate with the landlord-hosted Commercial Engine using service-to-service auth; enable multi-currency pricing.
* **Future:** Extend ledger with loyalty credits and offline settlement flows for partners without real-time payment capabilities.
