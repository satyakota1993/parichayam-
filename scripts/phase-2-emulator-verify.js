const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "parichayam-9ee09";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT;
const FUNCTIONS_BASE = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
const FIRESTORE_REST_BASE = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const TEST_SECRET = process.env.RAZORPAY_KEY_SECRET || "phase2_test_secret";
const TEST_PASSWORD = "Phase2Test!23";
const reportPath = path.join(__dirname, "..", "docs", "phase-2-verification.md");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const auth = admin.auth();
const results = [];
const bugs = [];
const revenueSnapshots = [];
const emulatorLogs = [];

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function roundMoney(value) {
  const numberValue = Number(value || 0);
  return Math.round(numberValue * 100) / 100;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sign(orderId, paymentId) {
  return crypto.createHmac("sha256", TEST_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}

async function waitFor(url, label, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 120000);
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options.fetchOptions || {});
      if (response.status < 500) return response;
      lastError = `${response.status} ${await response.text().catch(() => "")}`;
    } catch (error) {
      lastError = error.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} did not become ready: ${lastError}`);
}

async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  if (snap.empty) return;
  let batch = db.batch();
  let count = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (count % 400 !== 0) await batch.commit();
}

async function ensureUser(uid, email, customClaims) {
  await auth.deleteUser(uid).catch(() => null);
  await auth.createUser({
    uid,
    email,
    password: TEST_PASSWORD,
    emailVerified: true,
    displayName: uid,
  });
  if (customClaims) await auth.setCustomUserClaims(uid, customClaims);
}

async function signIn(email) {
  const response = await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD, returnSecureToken: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Auth sign-in failed for ${email}: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function callFunction(name, token, body) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`${name} failed with ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function createPaymentOrder(uid, orderId, amount, plan, planName) {
  await db.collection("paymentOrders").doc(orderId).set({
    uid,
    purchaseType: "membership",
    plan,
    planName,
    amountInr: amount,
    basePrice: amount,
    discountApplied: 0,
    currency: "INR",
    razorpayOrderId: orderId,
    status: "created",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function verifyPayment(uid, token, amount, planName) {
  const orderId = `order_${uid}_${Date.now()}`;
  const paymentId = `pay_${uid}_${Date.now()}`;
  await createPaymentOrder(uid, orderId, amount, "annual", planName);
  const payload = await callFunction("verifyPaymentAndActivateMembership", token, {
    orderId,
    paymentId,
    signature: sign(orderId, paymentId),
    planName,
  });
  return { orderId, paymentId, payload };
}

async function eventsForMember(memberId) {
  const snap = await db.collection("revenueEvents").where("memberId", "==", memberId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function eventsByRelatedEvent(relatedEventId) {
  const snap = await db.collection("revenueEvents").where("relatedEventId", "==", relatedEventId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function snapshotRevenueEvents(label) {
  const snap = await db.collection("revenueEvents").get();
  const rows = snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      eventType: data.eventType,
      memberId: data.memberId,
      amount: data.amount,
      agentId: data.agentId,
      agentCommissionAmount: data.agentCommissionAmount,
      status: data.status,
      isLocked: data.isLocked,
      relatedEventId: data.relatedEventId || "",
      createdBy: data.createdBy,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  revenueSnapshots.push({ label, rows });
}

function firestoreValue(value) {
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value === null) return { nullValue: null };
  return { stringValue: String(value || "") };
}

function firestoreDocPayload(data) {
  const fields = {};
  Object.entries(data).forEach(([key, value]) => {
    fields[key] = firestoreValue(value);
  });
  return { fields };
}

async function firestoreRest(pathSuffix, token, init) {
  const response = await fetch(`${FIRESTORE_REST_BASE}${pathSuffix}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init && init.headers ? init.headers : {}),
    },
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function runQueryAs(token, structuredQuery) {
  return firestoreRest(":runQuery", token, {
    method: "POST",
    body: JSON.stringify({ structuredQuery }),
  });
}

async function seed() {
  await waitFor(`${FIRESTORE_REST_BASE}`, "Firestore emulator");
  await waitFor(`${AUTH_BASE}/projects/${PROJECT_ID}/config?key=fake-key`, "Auth emulator");
  await waitFor(`${FUNCTIONS_BASE}/verifyPaymentAndActivateMembership`, "Functions emulator", {
    fetchOptions: { method: "OPTIONS" },
  });

  for (const uid of ["member_A", "member_B", "member_C", "agent_X", "admin_root"]) {
    await auth.deleteUser(uid).catch(() => null);
  }
  for (const collection of ["revenueEvents", "paymentOrders", "payments", "members", "agents"]) {
    await deleteCollection(collection);
  }

  await ensureUser("member_A", "member_a@example.test");
  await ensureUser("member_B", "member_b@example.test");
  await ensureUser("member_C", "member_c@example.test");
  await ensureUser("agent_X", "agent_x@example.test");
  await ensureUser("admin_root", "admin_root@example.test");

  const paid45DaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  await db.collection("members").doc("member_A").set({
    uid: "member_A",
    id: "member_A",
    name: "Member A",
    role: "MEMBER",
    tier: "BASIC",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("members").doc("member_B").set({
    uid: "member_B",
    id: "member_B",
    name: "Member B",
    role: "MEMBER",
    tier: "BASIC",
    referredByAgentRefId: "agent_X",
    agentRefId: "agent_X",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("members").doc("member_C").set({
    uid: "member_C",
    id: "member_C",
    name: "Member C",
    role: "MEMBER",
    tier: "PREMIUM",
    isPaid: true,
    plan: "annual",
    planName: "PREMIUM",
    paidAt: paid45DaysAgo,
    lastPaymentAt: paid45DaysAgo,
    lastPaymentAmount: 4999,
    lastPaymentId: "pay_member_C_backfill",
    lastOrderId: "order_member_C_backfill",
    paymentGateway: "razorpay",
    paymentCurrency: "INR",
    paymentStatus: "paid",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("members").doc("agent_X").set({
    uid: "agent_X",
    id: "agent_X",
    name: "Agent X",
    role: "AGENT",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("members").doc("admin_root").set({
    uid: "admin_root",
    id: "admin_root",
    name: "Admin Root",
    role: "ADMIN",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("agents").doc("agent_X").set({
    name: "Agent X",
    referralCode: "AGENT-X",
    status: "active",
    commissionType: "percent",
    commissionPercent: 15,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    memberAToken: await signIn("member_a@example.test"),
    memberBToken: await signIn("member_b@example.test"),
    adminToken: await signIn("admin_root@example.test"),
    agentToken: await signIn("agent_x@example.test"),
  };
}

async function test(name, fn) {
  try {
    const details = await fn();
    results.push({ name, status: "PASS", details });
    await snapshotRevenueEvents(`After ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      details: {
        message: error.message,
        details: error.details || error.payload || {},
      },
    });
    bugs.push(`${name}: ${error.message}`);
    await snapshotRevenueEvents(`After failed ${name}`).catch(() => null);
  }
}

async function main() {
  const tokens = await seed();
  emulatorLogs.push("Functions endpoint responded to OPTIONS for verifyPaymentAndActivateMembership.");
  emulatorLogs.push(`Firestore REST endpoint responded on ${process.env.FIRESTORE_EMULATOR_HOST}.`);
  emulatorLogs.push("Auth emulator REST endpoint responded on 127.0.0.1:9099.");

  let testBOrderId = "";
  let testCRefundOrderId = "";

  await test("Test A - Direct payment, no commission", async () => {
    const started = Date.now();
    const payment = await verifyPayment("member_A", tokens.memberAToken, 4999, "ASSISTED");
    const events = await eventsForMember("member_A");
    const membership = events.find((event) => event.eventType === "membership_paid");
    const commissions = events.filter((event) => event.eventType === "agent_commission");
    assert(events.length === 1, "Expected exactly 1 revenueEvent for member_A", events);
    assert(membership, "membership_paid event missing", events);
    assert(commissions.length === 0, "Direct member should not have agent_commission event", commissions);
    assert(membership.amount === 4999, "membership_paid amount mismatch", membership);
    assert(membership.agentId === "", "Direct member should have empty agentId", membership);
    assert(membership.isLocked === true, "membership_paid should be locked", membership);
    const lockDeltaDays = (timestampMs(membership.lockExpiresAt) - started) / (24 * 60 * 60 * 1000);
    assert(lockDeltaDays > 29.9 && lockDeltaDays < 30.1, "lockExpiresAt should be about now + 30 days", { lockDeltaDays });
    assert(membership.metadata.memberTier === "ASSISTED", "memberTier should be ASSISTED", membership.metadata);
    return { orderId: payment.orderId, eventId: membership.id, lockDeltaDays: roundMoney(lockDeltaDays) };
  });

  await test("Test B - Referred payment with commission", async () => {
    const payment = await verifyPayment("member_B", tokens.memberBToken, 9999, "PREMIUM");
    testBOrderId = payment.orderId;
    const events = await eventsForMember("member_B");
    const membership = events.find((event) => event.eventType === "membership_paid");
    const commission = events.find((event) => event.eventType === "agent_commission");
    assert(events.length === 2, "Expected membership_paid and agent_commission for member_B", events);
    assert(membership && commission, "Missing membership or commission event", events);
    assert(membership.amount === 9999, "membership amount mismatch", membership);
    assert(roundMoney(commission.amount) === 1499.85, "commission amount should be 1499.85", commission);
    assert(roundMoney(commission.agentCommissionAmount) === 1499.85, "agentCommissionAmount should be 1499.85", commission);
    assert(membership.agentId === "agent_X" && commission.agentId === "agent_X", "agentId should resolve to agent_X", events);
    assert(timestampMs(membership.lockExpiresAt) === timestampMs(commission.lockExpiresAt), "lockExpiresAt should match between events", events);
    assert(membership.metadata.memberTier === "PREMIUM", "memberTier should be PREMIUM", membership.metadata);
    return { orderId: payment.orderId, membershipEventId: membership.id, commissionEventId: commission.id };
  });

  await test("Test C - Calculate agent commissions", async () => {
    const payload = await callFunction("calculateAgentCommissions", tokens.agentToken, { agentId: "agent_X" });
    assert(roundMoney(payload.lockedAmount) === 1499.85, "lockedAmount should be 1499.85", payload);
    assert(roundMoney(payload.unlockedAmount) === 0, "unlockedAmount should be 0", payload);
    assert(payload.eventCount === 1, "eventCount should be 1", payload);
    return payload;
  });

  await test("Test D - Refund within lock window", async () => {
    const payload = await callFunction("processRefund", tokens.adminToken, {
      memberId: "member_B",
      orderId: testBOrderId,
      reason: "user_requested",
    });
    const membership = (await eventsForMember("member_B")).find((event) => event.eventType === "membership_paid" && event.orderId === testBOrderId);
    const related = await eventsByRelatedEvent(membership.id);
    const refund = related.find((event) => event.eventType === "refund_issued");
    const clawback = related.find((event) => event.eventType === "commission_clawback");
    const commission = related.find((event) => event.eventType === "agent_commission");
    assert(payload.refundAttemptError, "Razorpay refund attempt should be logged as emulator fallback", payload);
    assert(refund && refund.amount === -9999, "refund_issued amount should be -9999", related);
    assert(clawback && roundMoney(clawback.amount) === -1499.85, "commission_clawback amount should be -1499.85", related);
    assert(commission && commission.status === "disputed", "Original commission event should be disputed", related);
    return { payload, related };
  });

  await test("Test E - Refund after lock expires", async () => {
    const yesterday = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const orderId = "order_member_C_refund_expired";
    const paymentId = "pay_member_C_refund_expired";
    const eventId = "membership_paid_member_C_expired_refund";
    testCRefundOrderId = orderId;
    await db.collection("revenueEvents").doc(eventId).set({
      eventType: "membership_paid",
      memberId: "member_C",
      amount: 4999,
      currency: "INR",
      orderId,
      paymentId,
      agentId: "agent_X",
      agentCommissionRate: 0.15,
      agentCommissionAmount: 749.85,
      refundReason: "",
      relatedEventId: "",
      lockExpiresAt: yesterday,
      isLocked: false,
      createdAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)),
      createdBy: "system",
      metadata: {
        memberTier: "PREMIUM",
        planDurationDays: 365,
        basePrice: 4999,
        discountApplied: 0,
        paymentGateway: "razorpay",
        notes: "Manual expired-lock refund test event",
      },
      status: "recorded",
      version: 1,
    });
    const payload = await callFunction("processRefund", tokens.adminToken, {
      memberId: "member_C",
      orderId: testCRefundOrderId,
      reason: "admin_cancel",
    });
    const related = await eventsByRelatedEvent(eventId);
    const refunds = related.filter((event) => event.eventType === "refund_issued");
    const clawbacks = related.filter((event) => event.eventType === "commission_clawback");
    assert(refunds.length === 1 && refunds[0].amount === -4999, "Expected only refund_issued for expired lock", related);
    assert(clawbacks.length === 0, "Expired lock should not create commission_clawback", related);
    return { payload, related };
  });

  await test("Test F - Backfill dry run", async () => {
    const before = (await eventsForMember("member_C")).length;
    const payload = await callFunction("adminBackfillRevenueEvents", tokens.adminToken, { dryRun: true });
    const after = (await eventsForMember("member_C")).length;
    assert(payload.dryRun === true, "dryRun should be true", payload);
    assert(payload.createdMembershipEvents >= 1, "Expected at least one member to be backfilled", payload);
    assert(Array.isArray(payload.wouldBackfillMemberIds) && payload.wouldBackfillMemberIds.includes("member_C"), "member_C should appear in dry-run list", payload);
    assert(before === after, "Dry run should not write new revenueEvents", { before, after });
    return payload;
  });

  await test("Test G - Backfill live run", async () => {
    const payload = await callFunction("adminBackfillRevenueEvents", tokens.adminToken, { dryRun: false });
    const events = await eventsForMember("member_C");
    const backfilled = events.find((event) => event.id === "membership_paid_pay_member_C_backfill");
    assert(payload.dryRun === false, "dryRun should be false", payload);
    assert(backfilled, "member_C backfilled membership event missing", events);
    assert(backfilled.isLocked === false, "Backfilled 45-day-old event should be unlocked", backfilled);
    assert(backfilled.createdBy === "system_backfill", "Backfilled event createdBy mismatch", backfilled);
    return { payload, backfilled };
  });

  await test("Test H - Security rules enforcement", async () => {
    const memberBQuery = {
      from: [{ collectionId: "revenueEvents" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "memberId" },
          op: "EQUAL",
          value: { stringValue: "member_B" },
        },
      },
      limit: 1,
    };
    const memberAReadsB = await runQueryAs(tokens.memberAToken, memberBQuery);
    const memberAWrites = await firestoreRest("/revenueEvents?documentId=member_A_forbidden_write", tokens.memberAToken, {
      method: "POST",
      body: JSON.stringify(firestoreDocPayload({
        eventType: "membership_paid",
        memberId: "member_A",
        amount: 1,
        currency: "INR",
        status: "recorded",
      })),
    });
    const adminReads = await runQueryAs(tokens.adminToken, {
      from: [{ collectionId: "revenueEvents" }],
      limit: 1,
    });
    assert([401, 403].includes(memberAReadsB.status), "member_A should not read member_B revenueEvents", memberAReadsB);
    assert([401, 403].includes(memberAWrites.status), "member_A should not write revenueEvents", memberAWrites);
    assert(adminReads.status === 200, "admin_root should read revenueEvents", adminReads);
    return {
      memberAReadMemberBStatus: memberAReadsB.status,
      memberAWriteStatus: memberAWrites.status,
      adminReadStatus: adminReads.status,
    };
  });

  writeReport();

  const failed = results.filter((result) => result.status !== "PASS");
  if (failed.length) {
    process.exitCode = 1;
  }
}

function compact(value) {
  return JSON.stringify(value, (key, innerValue) => {
    if (key === "body" && typeof innerValue === "string" && innerValue.length > 500) return `${innerValue.slice(0, 500)}...`;
    if (innerValue && typeof innerValue.toDate === "function") return innerValue.toDate().toISOString();
    if (innerValue && typeof innerValue._seconds === "number") return new Date(innerValue._seconds * 1000).toISOString();
    return innerValue;
  }, 2);
}

function writeReport() {
  const failed = results.filter((result) => result.status !== "PASS");
  const lines = [];
  lines.push("# Phase 2.5 Verification: Revenue Events Ledger");
  lines.push("");
  lines.push(`Branch: codex/mvp-phase-1`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Emulators: Functions, Firestore, Auth on project ${PROJECT_ID}`);
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(failed.length ? "NO-GO for production until failures below are resolved." : "GO for production deployment. All eight verification tests passed in the Firebase Emulator Suite.");
  lines.push("");
  lines.push("## Startup");
  lines.push("");
  emulatorLogs.forEach((line) => lines.push(`- ${line}`));
  lines.push("");
  lines.push("## Test Results");
  lines.push("");
  results.forEach((result) => {
    lines.push(`### ${result.name}: ${result.status}`);
    lines.push("");
    lines.push("```json");
    lines.push(compact(result.details));
    lines.push("```");
    lines.push("");
  });
  lines.push("## Firestore Revenue Event State");
  lines.push("");
  revenueSnapshots.forEach((snapshot) => {
    lines.push(`### ${snapshot.label}`);
    lines.push("");
    lines.push("```json");
    lines.push(compact(snapshot.rows));
    lines.push("```");
    lines.push("");
  });
  lines.push("## Bugs Discovered And Fixes");
  lines.push("");
  if (bugs.length) {
    bugs.forEach((bug) => lines.push(`- Outstanding: ${bug}`));
  } else {
    lines.push("- Fixed during verification: agent commission values now preserve two-decimal rupee amounts, so 15% of Rs 9999 is recorded as Rs 1499.85 instead of rounding to Rs 1500.");
    lines.push("- Fixed during verification: emulator refund attempts now record ledger fallback entries after logging the skipped Razorpay refund, while production still calls Razorpay normally.");
    lines.push("- Fixed during verification: backfill dry-run now returns `wouldBackfillMemberIds` so member-level dry-run coverage can be audited without writes.");
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Test E used a manually seeded expired-lock membership event for member_C so the separate backfill tests could still prove member_C appears in dry-run and live backfill results.");
  lines.push("- Firestore security rules were checked through the Firestore emulator REST API with Auth emulator ID tokens, not Admin SDK bypasses.");
  lines.push("");
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

main().catch((error) => {
  results.push({ name: "Harness setup", status: "FAIL", details: { message: error.message, stack: error.stack } });
  bugs.push(`Harness setup: ${error.message}`);
  writeReport();
  console.error(error);
  process.exit(1);
});
