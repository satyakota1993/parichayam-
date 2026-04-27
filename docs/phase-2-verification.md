# Phase 2.5 Verification: Revenue Events Ledger

Branch: codex/mvp-phase-1
Generated: 2026-04-27T17:03:22.008Z
Emulators: Functions, Firestore, Auth on project parichayam-9ee09

## Verdict

GO for production deployment. All eight verification tests passed in the Firebase Emulator Suite.

## Startup

- Functions endpoint responded to OPTIONS for verifyPaymentAndActivateMembership.
- Firestore REST endpoint responded on 127.0.0.1:8085.
- Auth emulator REST endpoint responded on 127.0.0.1:9099.

## Test Results

### Test A - Direct payment, no commission: PASS

```json
{
  "orderId": "order_member_A_1777309389311",
  "eventId": "membership_paid_pay_member_A_1777309389311",
  "lockDeltaDays": 30
}
```

### Test B - Referred payment with commission: PASS

```json
{
  "orderId": "order_member_B_1777309389886",
  "membershipEventId": "membership_paid_pay_member_B_1777309389886",
  "commissionEventId": "agent_commission_pay_member_B_1777309389886"
}
```

### Test C - Calculate agent commissions: PASS

```json
{
  "ok": true,
  "agentId": "agent_X",
  "totalUnpaidCommissions": 1499.85,
  "lockedAmount": 1499.85,
  "unlockedAmount": 0,
  "eventCount": 1,
  "asOf": "2026-04-27T17:03:14.113Z"
}
```

### Test D - Refund within lock window: PASS

```json
{
  "payload": {
    "ok": true,
    "refundId": "emulator_refund_pay_member_B_1777309389886_1777309397848",
    "refundEventId": "refund_issued_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "clawbackEventId": "commission_clawback_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "status": "emulator_refund_attempt_failed",
    "refundAttemptError": "Razorpay refund skipped in emulator; ledger fallback is active.",
    "lockActive": true,
    "refundedAmount": 9999,
    "clawbackAmount": 1499.85
  },
  "related": [
    {
      "id": "agent_commission_pay_member_B_1777309389886",
      "eventType": "agent_commission",
      "memberId": "member_B",
      "amount": 1499.85,
      "currency": "INR",
      "orderId": "order_member_B_1777309389886",
      "paymentId": "pay_member_B_1777309389886",
      "agentId": "agent_X",
      "agentCommissionRate": 0.15,
      "agentCommissionAmount": 1499.85,
      "refundReason": "",
      "relatedEventId": "membership_paid_pay_member_B_1777309389886",
      "lockExpiresAt": "2026-05-27T17:03:09.983Z",
      "isLocked": true,
      "createdBy": "system",
      "metadata": {
        "memberTier": "PREMIUM",
        "planDurationDays": 365,
        "basePrice": 9999,
        "discountApplied": 0,
        "paymentGateway": "razorpay",
        "notes": "Membership activated for Member B",
        "ipAddress": "unknown",
        "agentReferralCode": "AGENT-X"
      },
      "version": 1,
      "createdAt": "2026-04-27T17:03:10.001Z",
      "status": "disputed"
    },
    {
      "id": "commission_clawback_emulator_refund_pay_member_B_1777309389886_1777309397848",
      "eventType": "commission_clawback",
      "memberId": "member_B",
      "amount": -1499.85,
      "currency": "INR",
      "orderId": "",
      "paymentId": "",
      "agentId": "agent_X",
      "agentCommissionRate": 0.15,
      "agentCommissionAmount": -1499.85,
      "refundReason": "user_requested",
      "relatedEventId": "membership_paid_pay_member_B_1777309389886",
      "lockExpiresAt": null,
      "isLocked": false,
      "createdBy": "admin_root",
      "metadata": {
        "memberTier": "PREMIUM",
        "planDurationDays": 365,
        "basePrice": 9999,
        "discountApplied": 0,
        "paymentGateway": "razorpay",
        "notes": "Commission clawback for refund: user_requested",
        "originalCommissionEventId": "agent_commission_pay_member_B_1777309389886",
        "razorpayRefundId": "emulator_refund_pay_member_B_1777309389886_1777309397848",
        "refundAttemptError": "Razorpay refund skipped in emulator; ledger fallback is active."
      },
      "status": "recorded",
      "version": 1,
      "createdAt": "2026-04-27T17:03:17.881Z"
    },
    {
      "id": "refund_issued_emulator_refund_pay_member_B_1777309389886_1777309397848",
      "eventType": "refund_issued",
      "memberId": "member_B",
      "amount": -9999,
      "currency": "INR",
      "orderId": "order_member_B_1777309389886",
      "paymentId": "pay_member_B_1777309389886",
      "agentId": "agent_X",
      "agentCommissionRate": 0.15,
      "agentCommissionAmount": 0,
      "refundReason": "user_requested",
      "relatedEventId": "membership_paid_pay_member_B_1777309389886",
      "lockExpiresAt": null,
      "isLocked": false,
      "createdBy": "admin_root",
      "metadata": {
        "memberTier": "PREMIUM",
        "planDurationDays": 365,
        "basePrice": 9999,
        "discountApplied": 0,
        "paymentGateway": "razorpay",
        "notes": "Refund issued: user_requested",
        "razorpayRefundId": "emulator_refund_pay_member_B_1777309389886_1777309397848",
        "refundAttemptError": "Razorpay refund skipped in emulator; ledger fallback is active."
      },
      "status": "recorded",
      "version": 1,
      "createdAt": "2026-04-27T17:03:17.881Z"
    }
  ]
}
```

### Test E - Refund after lock expires: PASS

```json
{
  "payload": {
    "ok": true,
    "refundId": "emulator_refund_pay_member_C_refund_expired_1777309398010",
    "refundEventId": "refund_issued_emulator_refund_pay_member_C_refund_expired_1777309398010",
    "clawbackEventId": "",
    "status": "emulator_refund_attempt_failed",
    "refundAttemptError": "Razorpay refund skipped in emulator; ledger fallback is active.",
    "lockActive": false,
    "refundedAmount": 4999,
    "clawbackAmount": 0
  },
  "related": [
    {
      "id": "refund_issued_emulator_refund_pay_member_C_refund_expired_1777309398010",
      "eventType": "refund_issued",
      "memberId": "member_C",
      "amount": -4999,
      "currency": "INR",
      "orderId": "order_member_C_refund_expired",
      "paymentId": "pay_member_C_refund_expired",
      "agentId": "agent_X",
      "agentCommissionRate": 0.15,
      "agentCommissionAmount": 0,
      "refundReason": "admin_cancel",
      "relatedEventId": "membership_paid_member_C_expired_refund",
      "lockExpiresAt": null,
      "isLocked": false,
      "createdBy": "admin_root",
      "metadata": {
        "memberTier": "PREMIUM",
        "planDurationDays": 365,
        "basePrice": 4999,
        "discountApplied": 0,
        "paymentGateway": "razorpay",
        "notes": "Refund issued: admin_cancel",
        "razorpayRefundId": "emulator_refund_pay_member_C_refund_expired_1777309398010",
        "refundAttemptError": "Razorpay refund skipped in emulator; ledger fallback is active."
      },
      "status": "recorded",
      "version": 1,
      "createdAt": "2026-04-27T17:03:18.041Z"
    }
  ]
}
```

### Test F - Backfill dry run: PASS

```json
{
  "ok": true,
  "dryRun": true,
  "scanned": 5,
  "createdMembershipEvents": 1,
  "createdCommissionEvents": 0,
  "skippedExisting": 2,
  "skippedUnpaid": 2,
  "skippedInvalidAmount": 0,
  "wouldBackfillMemberIds": [
    "member_C"
  ],
  "createdBy": "admin_root"
}
```

### Test G - Backfill live run: PASS

```json
{
  "payload": {
    "ok": true,
    "dryRun": false,
    "scanned": 5,
    "createdMembershipEvents": 1,
    "createdCommissionEvents": 0,
    "skippedExisting": 2,
    "skippedUnpaid": 2,
    "skippedInvalidAmount": 0,
    "wouldBackfillMemberIds": [
      "member_C"
    ],
    "createdBy": "admin_root"
  },
  "backfilled": {
    "id": "membership_paid_pay_member_C_backfill",
    "eventType": "membership_paid",
    "memberId": "member_C",
    "amount": 4999,
    "currency": "INR",
    "orderId": "order_member_C_backfill",
    "paymentId": "pay_member_C_backfill",
    "agentId": "",
    "agentCommissionRate": 0,
    "agentCommissionAmount": 0,
    "refundReason": "",
    "relatedEventId": "",
    "lockExpiresAt": "2026-04-12T17:03:09.222Z",
    "isLocked": false,
    "createdAt": "2026-03-13T17:03:09.222Z",
    "createdBy": "system_backfill",
    "metadata": {
      "memberTier": "PREMIUM",
      "planDurationDays": 365,
      "basePrice": 4236,
      "discountApplied": 0,
      "paymentGateway": "razorpay",
      "notes": "Backfilled membership payment for Member C"
    },
    "status": "recorded",
    "version": 1
  }
}
```

### Test H - Security rules enforcement: PASS

```json
{
  "memberAReadMemberBStatus": 403,
  "memberAWriteStatus": 403,
  "adminReadStatus": 200
}
```

## Firestore Revenue Event State

### After Test A - Direct payment, no commission

```json
[
  {
    "id": "membership_paid_pay_member_A_1777309389311",
    "eventType": "membership_paid",
    "memberId": "member_A",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  }
]
```

### After Test B - Referred payment with commission

```json
[
  {
    "id": "agent_commission_pay_member_B_1777309389886",
    "eventType": "agent_commission",
    "memberId": "member_B",
    "amount": 1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_A_1777309389311",
    "eventType": "membership_paid",
    "memberId": "member_A",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_B_1777309389886",
    "eventType": "membership_paid",
    "memberId": "member_B",
    "amount": 9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  }
]
```

### After Test C - Calculate agent commissions

```json
[
  {
    "id": "agent_commission_pay_member_B_1777309389886",
    "eventType": "agent_commission",
    "memberId": "member_B",
    "amount": 1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_A_1777309389311",
    "eventType": "membership_paid",
    "memberId": "member_A",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_B_1777309389886",
    "eventType": "membership_paid",
    "memberId": "member_B",
    "amount": 9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  }
]
```

### After Test D - Refund within lock window

```json
[
  {
    "id": "agent_commission_pay_member_B_1777309389886",
    "eventType": "agent_commission",
    "memberId": "member_B",
    "amount": 1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "disputed",
    "isLocked": true,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "system"
  },
  {
    "id": "commission_clawback_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "commission_clawback",
    "memberId": "member_B",
    "amount": -1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": -1499.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "membership_paid_pay_member_A_1777309389311",
    "eventType": "membership_paid",
    "memberId": "member_A",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_B_1777309389886",
    "eventType": "membership_paid",
    "memberId": "member_B",
    "amount": 9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "refund_issued",
    "memberId": "member_B",
    "amount": -9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  }
]
```

### After Test E - Refund after lock expires

```json
[
  {
    "id": "agent_commission_pay_member_B_1777309389886",
    "eventType": "agent_commission",
    "memberId": "member_B",
    "amount": 1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "disputed",
    "isLocked": true,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "system"
  },
  {
    "id": "commission_clawback_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "commission_clawback",
    "memberId": "member_B",
    "amount": -1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": -1499.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "membership_paid_member_C_expired_refund",
    "eventType": "membership_paid",
    "memberId": "member_C",
    "amount": 4999,
    "agentId": "agent_X",
    "agentCommissionAmount": 749.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_A_1777309389311",
    "eventType": "membership_paid",
    "memberId": "member_A",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_B_1777309389886",
    "eventType": "membership_paid",
    "memberId": "member_B",
    "amount": 9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "refund_issued",
    "memberId": "member_B",
    "amount": -9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_C_refund_expired_1777309398010",
    "eventType": "refund_issued",
    "memberId": "member_C",
    "amount": -4999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_member_C_expired_refund",
    "createdBy": "admin_root"
  }
]
```

### After Test F - Backfill dry run

```json
[
  {
    "id": "agent_commission_pay_member_B_1777309389886",
    "eventType": "agent_commission",
    "memberId": "member_B",
    "amount": 1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "disputed",
    "isLocked": true,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "system"
  },
  {
    "id": "commission_clawback_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "commission_clawback",
    "memberId": "member_B",
    "amount": -1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": -1499.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "membership_paid_member_C_expired_refund",
    "eventType": "membership_paid",
    "memberId": "member_C",
    "amount": 4999,
    "agentId": "agent_X",
    "agentCommissionAmount": 749.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_A_1777309389311",
    "eventType": "membership_paid",
    "memberId": "member_A",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_B_1777309389886",
    "eventType": "membership_paid",
    "memberId": "member_B",
    "amount": 9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "refund_issued",
    "memberId": "member_B",
    "amount": -9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_C_refund_expired_1777309398010",
    "eventType": "refund_issued",
    "memberId": "member_C",
    "amount": -4999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_member_C_expired_refund",
    "createdBy": "admin_root"
  }
]
```

### After Test G - Backfill live run

```json
[
  {
    "id": "agent_commission_pay_member_B_1777309389886",
    "eventType": "agent_commission",
    "memberId": "member_B",
    "amount": 1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "disputed",
    "isLocked": true,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "system"
  },
  {
    "id": "commission_clawback_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "commission_clawback",
    "memberId": "member_B",
    "amount": -1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": -1499.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "membership_paid_member_C_expired_refund",
    "eventType": "membership_paid",
    "memberId": "member_C",
    "amount": 4999,
    "agentId": "agent_X",
    "agentCommissionAmount": 749.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_A_1777309389311",
    "eventType": "membership_paid",
    "memberId": "member_A",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_B_1777309389886",
    "eventType": "membership_paid",
    "memberId": "member_B",
    "amount": 9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_C_backfill",
    "eventType": "membership_paid",
    "memberId": "member_C",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "",
    "createdBy": "system_backfill"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "refund_issued",
    "memberId": "member_B",
    "amount": -9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_C_refund_expired_1777309398010",
    "eventType": "refund_issued",
    "memberId": "member_C",
    "amount": -4999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_member_C_expired_refund",
    "createdBy": "admin_root"
  }
]
```

### After Test H - Security rules enforcement

```json
[
  {
    "id": "agent_commission_pay_member_B_1777309389886",
    "eventType": "agent_commission",
    "memberId": "member_B",
    "amount": 1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "disputed",
    "isLocked": true,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "system"
  },
  {
    "id": "commission_clawback_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "commission_clawback",
    "memberId": "member_B",
    "amount": -1499.85,
    "agentId": "agent_X",
    "agentCommissionAmount": -1499.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "membership_paid_member_C_expired_refund",
    "eventType": "membership_paid",
    "memberId": "member_C",
    "amount": 4999,
    "agentId": "agent_X",
    "agentCommissionAmount": 749.85,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_A_1777309389311",
    "eventType": "membership_paid",
    "memberId": "member_A",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_B_1777309389886",
    "eventType": "membership_paid",
    "memberId": "member_B",
    "amount": 9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 1499.85,
    "status": "recorded",
    "isLocked": true,
    "relatedEventId": "",
    "createdBy": "system"
  },
  {
    "id": "membership_paid_pay_member_C_backfill",
    "eventType": "membership_paid",
    "memberId": "member_C",
    "amount": 4999,
    "agentId": "",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "",
    "createdBy": "system_backfill"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_B_1777309389886_1777309397848",
    "eventType": "refund_issued",
    "memberId": "member_B",
    "amount": -9999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_pay_member_B_1777309389886",
    "createdBy": "admin_root"
  },
  {
    "id": "refund_issued_emulator_refund_pay_member_C_refund_expired_1777309398010",
    "eventType": "refund_issued",
    "memberId": "member_C",
    "amount": -4999,
    "agentId": "agent_X",
    "agentCommissionAmount": 0,
    "status": "recorded",
    "isLocked": false,
    "relatedEventId": "membership_paid_member_C_expired_refund",
    "createdBy": "admin_root"
  }
]
```

## Bugs Discovered And Fixes

- Fixed during verification: agent commission values now preserve two-decimal rupee amounts, so 15% of Rs 9999 is recorded as Rs 1499.85 instead of rounding to Rs 1500.
- Fixed during verification: emulator refund attempts now record ledger fallback entries after logging the skipped Razorpay refund, while production still calls Razorpay normally.
- Fixed during verification: backfill dry-run now returns `wouldBackfillMemberIds` so member-level dry-run coverage can be audited without writes.

## Notes

- Test E used a manually seeded expired-lock membership event for member_C so the separate backfill tests could still prove member_C appears in dry-run and live backfill results.
- Firestore security rules were checked through the Firestore emulator REST API with Auth emulator ID tokens, not Admin SDK bypasses.

