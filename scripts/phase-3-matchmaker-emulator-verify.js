process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "parichayam-9ee09";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT;
const FUNCTIONS_BASE = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const TEST_PASSWORD = "Phase3Matchmaker!23";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const auth = admin.auth();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const results = [];

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
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

async function ensureUser(uid, email) {
  await auth.deleteUser(uid).catch(() => null);
  await auth.createUser({
    uid,
    email,
    password: TEST_PASSWORD,
    emailVerified: true,
    displayName: uid,
  });
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

async function callFunctionRaw(name, token, body) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return { status: response.status, ok: response.ok, payload };
}

async function callFunction(name, token, body) {
  const result = await callFunctionRaw(name, token, body);
  if (!result.ok) {
    const error = new Error(`${name} failed with ${result.status}`);
    error.payload = result.payload;
    throw error;
  }
  return result.payload;
}

async function callScheduledFunction(name) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await response.text().catch(() => "");
  return { status: response.status, ok: response.ok, text };
}

async function cleanup() {
  const ids = ["mm_a", "mm_b", "member_assigned", "member_other", "member_expired", "admin_root"];
  await Promise.all(ids.map((uid) => auth.deleteUser(uid).catch(() => null)));
  const directDeletes = [
    ...ids.map((uid) => db.collection("members").doc(uid).delete()),
    db.collection("matchmakerSubscriptions").doc("mmsub_active_test").delete(),
    db.collection("matchmakerSubscriptions").doc("mmsub_expired_test").delete(),
    db.collection("matchSuggestions").doc("match_family_guard_test").delete(),
  ];
  await Promise.all(directDeletes.map((work) => work.catch(() => null)));
  for (const memberUid of ["member_assigned", "member_expired"]) {
    const snap = await db.collection("activityLog").where("memberUid", "==", memberUid).get();
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    if (!snap.empty) await batch.commit();
  }
}

async function seed() {
  await waitFor(`${FUNCTIONS_BASE}/getMemberProfile360`, "Functions emulator", {
    fetchOptions: { method: "OPTIONS" },
  });
  await waitFor(`${AUTH_BASE}/projects/${PROJECT_ID}/config?key=fake-key`, "Auth emulator");
  await cleanup();

  await Promise.all([
    ensureUser("mm_a", "mm_a@example.test"),
    ensureUser("mm_b", "mm_b@example.test"),
    ensureUser("member_assigned", "member_assigned@example.test"),
    ensureUser("member_other", "member_other@example.test"),
    ensureUser("member_expired", "member_expired@example.test"),
    ensureUser("admin_root", "admin_root@example.test"),
  ]);

  const future = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const past = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.collection("members").doc("mm_a"), {
    uid: "mm_a", role: "MATCHMAKER", status: "ACTIVE", name: "Matchmaker A", phone: "9000000001", email: "mm_a@example.test", createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("members").doc("mm_b"), {
    uid: "mm_b", role: "MATCHMAKER", status: "ACTIVE", name: "Matchmaker B", phone: "9000000002", email: "mm_b@example.test", createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("members").doc("admin_root"), {
    uid: "admin_root", role: "ADMIN", status: "ACTIVE", name: "Admin Root", email: "admin_root@example.test", createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("members").doc("member_assigned"), {
    uid: "member_assigned", role: "MEMBER", status: "ACTIVE", isPaid: true, name: "Assigned Member", profileNumber: "P300001",
    phone: "9999990001", email: "assigned@example.test", city: "Vijayawada", assignedMatchmakerUid: "mm_a", assignedMatchmakerName: "Matchmaker A",
    matchmakerActive: true, matchmakerSubscriptionId: "mmsub_active_test", matchmakerEndDate: future, createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("members").doc("member_other"), {
    uid: "member_other", role: "MEMBER", status: "ACTIVE", isPaid: true, name: "Other Member", profileNumber: "P300002", city: "Hyderabad", createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("members").doc("member_expired"), {
    uid: "member_expired", role: "MEMBER", status: "ACTIVE", isPaid: true, name: "Expired Member", profileNumber: "P300003",
    assignedMatchmakerUid: "mm_a", assignedMatchmakerName: "Matchmaker A", matchmakerActive: true, matchmakerSubscriptionId: "mmsub_expired_test",
    matchmakerEndDate: past, createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("matchmakerSubscriptions").doc("mmsub_active_test"), {
    subscriptionId: "mmsub_active_test", memberUid: "member_assigned", plan: "monthly", status: "active", endDate: future,
    assignedMatchmakerUid: "mm_a", price: 2000, durationDays: 30, suggestionsPerWeek: 3, createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("matchmakerSubscriptions").doc("mmsub_expired_test"), {
    subscriptionId: "mmsub_expired_test", memberUid: "member_expired", plan: "monthly", status: "active", endDate: past,
    assignedMatchmakerUid: "mm_a", price: 2000, durationDays: 30, suggestionsPerWeek: 3, createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("matchSuggestions").doc("match_family_guard_test"), {
    suggestionId: "match_family_guard_test", forMemberAUid: "member_assigned", forMemberBUid: "member_other", createdBy: "mm_a",
    createdByName: "Matchmaker A", matchmakerNote: "Both families are aligned on city, education, and timing.", matchScore: 80,
    status: "mutual_interest", memberAAction: "liked", memberBAction: "liked", createdAt: now, updatedAt: now,
  });
  await batch.commit();

  return {
    mmAToken: await signIn("mm_a@example.test"),
    mmBToken: await signIn("mm_b@example.test"),
    memberToken: await signIn("member_assigned@example.test"),
  };
}

async function test(name, fn) {
  try {
    const details = await fn();
    results.push({ name, status: "PASS", details });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", message: error.message, details: error.details || error.payload || null });
    console.error(`FAIL ${name}: ${error.message}`);
    if (error.details || error.payload) console.error(JSON.stringify(error.details || error.payload, null, 2));
  }
}

async function main() {
  const tokens = await seed();

  await test("non-assigned matchmaker profile 360 redacts PII", async () => {
    const payload = await callFunction("getMemberProfile360", tokens.mmBToken, { memberUid: "member_assigned" });
    assert(payload.ok === true, "Profile 360 should load for search-visible matchmaker", payload);
    assert(payload.isAssignedMatchmaker === false, "Viewer should not be treated as assigned matchmaker", payload);
    assert(payload.profile.phone === "" && payload.profile.email === "", "Phone/email should be redacted", payload.profile);
    assert(payload.profile.family === null, "Family details should be redacted", payload.profile);
    assert(payload.profile.matchmaker?.uid === "", "Assignment UID should be redacted", payload.profile.matchmaker);
    return { phone: payload.profile.phone, email: payload.profile.email, assigned: payload.isAssignedMatchmaker };
  });

  await test("non-assigned matchmaker cannot create family introduction", async () => {
    const result = await callFunctionRaw("createFamilyIntroduction", tokens.mmBToken, { matchSuggestionId: "match_family_guard_test" });
    assert(result.status === 403, "Expected assigned-matchmaker guard to reject non-assigned matchmaker", result);
    return { status: result.status, message: result.payload.message };
  });

  await test("cancel keeps subscription active until endDate", async () => {
    const payload = await callFunction("cancelMatchmakerSubscription", tokens.memberToken, { reason: "emulator test cancellation" });
    const sub = (await db.collection("matchmakerSubscriptions").doc("mmsub_active_test").get()).data() || {};
    const member = (await db.collection("members").doc("member_assigned").get()).data() || {};
    assert(payload.cancelsAtEnd === true, "Cancel response should mark period-end cancellation", payload);
    assert(sub.status === "active", "Subscription should remain active until sweep", sub);
    assert(!!sub.cancelledAt, "Subscription should stamp cancelledAt", sub);
    assert(member.matchmakerActive === true, "Member should remain active until endDate", member);
    return { subscriptionId: payload.subscriptionId, status: sub.status, matchmakerActive: member.matchmakerActive };
  });

  await test("expiry sweep flips ended subscription to expired", async () => {
    const trigger = await callScheduledFunction("expireMatchmakerSubscriptions");
    assert(trigger.status < 500, "Scheduled expiry endpoint should respond in emulator", trigger);
    const sub = (await db.collection("matchmakerSubscriptions").doc("mmsub_expired_test").get()).data() || {};
    const member = (await db.collection("members").doc("member_expired").get()).data() || {};
    const activity = await db.collection("activityLog").where("memberUid", "==", "member_expired").get();
    assert(sub.status === "expired", "Expired subscription should be marked expired", sub);
    assert(member.matchmakerActive === false, "Member matchmakerActive should be cleared", member);
    assert(String(member.assignedMatchmakerUid || "") === "", "Assigned matchmaker should be cleared", member);
    assert(activity.docs.some((doc) => doc.data()?.eventType === "system_subscription_expired"), "Expiry activity log should be written", activity.docs.map((doc) => doc.data()));
    return { triggerStatus: trigger.status, subscriptionStatus: sub.status, activityCount: activity.size };
  });

  const failed = results.filter((item) => item.status !== "PASS");
  if (failed.length) {
    process.exitCode = 1;
  }
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
