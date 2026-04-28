(function () {
  const DEFAULT_TRIAL_SETTINGS = {
    durationDays: 30,
    trialConnects: 30,
    freeConnects: 5,
    freeDailyInterests: 5,
    freeMonthlyInterests: 30,
  };

  const DEFAULT_KUNDALI_SETTINGS = {
    enabled: true,
    enableForTrial: true,
    enableForPaid: true,
    enableForFree: false,
    sameGotraPolicy: "hard",
    showScoreOnCards: true,
    weight: 55,
  };

  const DEFAULT_DASHBOARD_NOTICE = {
    enabled: false,
    text: "",
    color: "gold",
    icon: "",
    cta: "",
    action: "settings",
    validUntil: "",
  };

  const DEFAULT_AGENT_DIRECTORY = [];
  const DEFAULT_VERIFICATION_SETTINGS = {
    aadhaarFee: 100,
    incomeFee: 100,
    turnaroundHours: 24,
    reminderHours: 5,
    enabled: true,
  };
  const DEFAULT_KUNDALI_PACK_SETTINGS = {
    enabled: true,
    price: 100,
    checks: 5,
    validityDays: 30,
    title: "Kundali Match Pack",
    description: "Validate Jathakam compatibility with a limited-use paid pack.",
  };
  const DEFAULT_AUTH_SETTINGS = {
    enabled: false,
    mode: "firebase-password",
    requireSignupOtp: false,
    allowPasswordFallback: true,
    widgetId: "",
    authToken: "",
    countryCode: "91",
    verifyEndpoint: "https://msg91verifyaccesstoken-kqn7sulcoa-uc.a.run.app",
    brandLabel: "Parichayam",
  };
  const DEFAULT_PUBLIC_PROFILE_FIELDS = {
    profileNumber: true,
    name: true,
    age: true,
    city: true,
    community: true,
    education: true,
    profession: true,
    nakshatra: true,
    rashi: true,
    gotra: true,
    padam: false,
    about: true,
    verification: true,
  };

  const BRIDGE_KEYS = new Set([
    "parichayam_trial_settings",
    "parichayam_kundali_settings",
    "parichayam_dashboard_notice",
    "parichayam_plan_prices",
    "parichayam_site_settings",
    "parichayam_payment_settings",
    "parichayam_coupons",
    "parichayam_addon_prices",
    "parichayam_connect_packs",
    "parichayam_connect_costs",
    "parichayam_agent_referral_settings",
    "parichayam_agent_payout_history",
    "parichayam_agent_directory",
    "parichayam_connect_requests",
    "parichayam_gotra_requests",
    "parichayam_gotras",
    "parichayam_ads",
    "parichayam_user_access",
    "parichayam_dash_vis",
    "parichayam_form_fields",
    "parichayam_communities",
    "parichayam_custom_fields",
    "parichayam_verification_settings",
    "parichayam_kundali_pack_settings",
    "parichayam_public_profile_fields",
  ]);

  const firebaseConfig = window.PARICHAYAM_FIREBASE_CONFIG || {};
  const options = Object.assign(
    {
      appUrl: "https://parichayam.co.in",
      supportEmail: "support@parichayam.co.in",
      supportPhone: "9440176078",
      adminEmails: [],
      functionsRegion: "us-central1",
      stateCollection: "appState",
      membersCollection: "members",
      phoneIndexCollection: "memberPhoneIndex",
      publicProfilesCollection: "publicProfiles",
      countersCollection: "systemCounters",
    },
    window.PARICHAYAM_FIREBASE_OPTIONS || {}
  );
  const sqlReporting = {
    url: String(window.PARICHAYAM_SQL_API || "").trim(),
    apiKey: String(window.PARICHAYAM_SQL_API_KEY || "").trim(),
  };
  const REGISTRATION_DRAFT_KEY = "parichayam_registration_draft";
  const AUTH_READY_TIMEOUT_MS = 8000;
  const FIRESTORE_OP_TIMEOUT_MS = 12000;
  const SKIP_AUTH_READY_PATHS = new Set([
    "/auth/register",
    "/auth/login",
    "/auth/forgot-password/request",
    "/public/settings",
  ]);

  const requiredConfigKeys = ["apiKey", "authDomain", "projectId", "appId"];
  const isConfigured = requiredConfigKeys.every((key) => String(firebaseConfig[key] || "").trim());

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  const originalLocalSetItem = window.localStorage?.setItem?.bind(window.localStorage);
  const originalLocalRemoveItem = window.localStorage?.removeItem?.bind(window.localStorage);

  let app = null;
  let auth = null;
  let db = null;
  let storage = null;
  let bootPromise = null;
  let authReadyPromise = Promise.resolve(null);
  let isApplyingRemoteState = false;

  function normalizePhone(value) {
    return String(value || "").replace(/[^\d]/g, "").replace(/^91/, "").slice(-10);
  }

  function normalizeAgentRefId(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  function normalizeProfileNumber(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function toLowerEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function isSafePassword(value) {
    const raw = String(value || "");
    return raw.trim().length >= 8 && raw.length >= 8;
  }

  function isProductionLikeRuntime() {
    const host = String(window.location.hostname || "").toLowerCase();
    return window.location.protocol !== "file:" && host !== "localhost" && host !== "127.0.0.1";
  }

  function profileNumberFromCounter(counter) {
    const numeric = Math.max(100001, parseInt(counter, 10) || 100001);
    return `P${String(numeric).padStart(6, "0")}`;
  }

  function parseMaybeJson(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  function writeLocalCache(key, value) {
    if (!originalLocalSetItem) return;
    originalLocalSetItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  function postSqlReporting(path, payload) {
    if (!sqlReporting.url || !originalFetch) return;
    const base = sqlReporting.url.replace(/\/+$/, "");
    const endpoint = path.startsWith("/") ? path : "/" + path;
    originalFetch(base + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sqlReporting.apiKey ? { "x-sql-api-key": sqlReporting.apiKey } : {}),
      },
      body: JSON.stringify(payload || {}),
    }).catch(() => {});
  }

  function trackSqlEvent(type, payload) {
    if (!type) return;
    const map = {
      member: "/reporting/member",
      payment: "/reporting/payment",
      invoice: "/reporting/invoice",
      payout: "/reporting/payout",
      verification: "/reporting/verification",
    };
    const path = map[type];
    if (!path) return;
    postSqlReporting(path, payload);
  }

  function removeLocalCache(key) {
    if (!originalLocalRemoveItem) return;
    originalLocalRemoveItem(key);
  }

  function buildError(status, message, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code || "";
    return error;
  }

  function withTimeout(promise, ms, message, code) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        reject(buildError(504, message || "Request timed out.", code || "timeout"));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) window.clearTimeout(timer);
    });
  }

  function firebaseMessage(error, fallback) {
    const code = String(error?.code || "");
    const map = {
      "auth/email-already-in-use": "Email is already registered. Sign in instead.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/user-not-found": "No account found for these credentials.",
      "auth/wrong-password": "Incorrect password.",
      "auth/invalid-credential": "Invalid email/mobile or password.",
      "auth/too-many-requests": "Too many attempts. Please try again later.",
      "auth/network-request-failed": "Network issue. Please check your internet connection.",
      "permission-denied": "You do not have permission for this action.",
    };
    return map[code] || error?.message || fallback || "Request failed.";
  }

  function maskEmail(email) {
    const value = String(email || "");
    const parts = value.split("@");
    if (parts.length !== 2) return "your registered email";
    const name = parts[0];
    const domain = parts[1];
    if (name.length <= 2) return name.charAt(0) + "*@" + domain;
    return name.slice(0, 2) + "*".repeat(Math.max(1, name.length - 2)) + "@" + domain;
  }

  function normalizeTrialSettings(raw) {
    const saved = raw || {};
    return {
      ...DEFAULT_TRIAL_SETTINGS,
      ...saved,
      durationDays: Math.max(1, parseInt(saved.durationDays ?? DEFAULT_TRIAL_SETTINGS.durationDays, 10) || DEFAULT_TRIAL_SETTINGS.durationDays),
      trialConnects: Math.max(1, parseInt(saved.trialConnects ?? DEFAULT_TRIAL_SETTINGS.trialConnects, 10) || DEFAULT_TRIAL_SETTINGS.trialConnects),
      freeConnects: Math.max(0, parseInt(saved.freeConnects ?? DEFAULT_TRIAL_SETTINGS.freeConnects, 10) || DEFAULT_TRIAL_SETTINGS.freeConnects),
      freeDailyInterests: Math.max(1, parseInt(saved.freeDailyInterests ?? DEFAULT_TRIAL_SETTINGS.freeDailyInterests, 10) || DEFAULT_TRIAL_SETTINGS.freeDailyInterests),
      freeMonthlyInterests: Math.max(1, parseInt(saved.freeMonthlyInterests ?? DEFAULT_TRIAL_SETTINGS.freeMonthlyInterests, 10) || DEFAULT_TRIAL_SETTINGS.freeMonthlyInterests),
    };
  }

  function normalizeKundaliSettings(raw) {
    const saved = raw || {};
    return {
      ...DEFAULT_KUNDALI_SETTINGS,
      ...saved,
      weight: Math.max(0, Math.min(100, parseInt(saved.weight ?? DEFAULT_KUNDALI_SETTINGS.weight, 10) || DEFAULT_KUNDALI_SETTINGS.weight)),
    };
  }

  function normalizeNotice(raw) {
    const saved = raw || {};
    return {
      ...DEFAULT_DASHBOARD_NOTICE,
      ...saved,
      validUntil: saved.validUntil ? String(saved.validUntil) : "",
    };
  }

  function normalizeAgentDirectory(raw) {
    const items = Array.isArray(raw) ? raw : [];
    return items
      .map((item) => {
        const refId = normalizeAgentRefId(item?.refId || item?.agentRefId || "");
        if (!refId) return null;
        return {
          refId,
          name: String(item?.name || "").trim(),
          city: String(item?.city || "").trim(),
          tier: String(item?.tier || "").trim(),
          mobile: normalizePhone(item?.mobile || ""),
          status: String(item?.status || "active").toLowerCase(),
          active: item?.active !== false && String(item?.status || "active").toLowerCase() !== "revoked",
          joined: String(item?.joined || "").trim(),
        };
      })
      .filter(Boolean);
  }

  function normalizeVerificationSettings(raw) {
    const saved = raw || {};
    return {
      ...DEFAULT_VERIFICATION_SETTINGS,
      ...saved,
      aadhaarFee: Math.max(0, parseInt(saved.aadhaarFee ?? DEFAULT_VERIFICATION_SETTINGS.aadhaarFee, 10) || DEFAULT_VERIFICATION_SETTINGS.aadhaarFee),
      incomeFee: Math.max(0, parseInt(saved.incomeFee ?? DEFAULT_VERIFICATION_SETTINGS.incomeFee, 10) || DEFAULT_VERIFICATION_SETTINGS.incomeFee),
      turnaroundHours: Math.max(1, parseInt(saved.turnaroundHours ?? DEFAULT_VERIFICATION_SETTINGS.turnaroundHours, 10) || DEFAULT_VERIFICATION_SETTINGS.turnaroundHours),
      reminderHours: Math.max(1, parseInt(saved.reminderHours ?? DEFAULT_VERIFICATION_SETTINGS.reminderHours, 10) || DEFAULT_VERIFICATION_SETTINGS.reminderHours),
      enabled: saved.enabled !== false,
    };
  }

  function normalizeKundaliPackSettings(raw) {
    const saved = raw || {};
    return {
      ...DEFAULT_KUNDALI_PACK_SETTINGS,
      ...saved,
      enabled: saved.enabled !== false,
      price: Math.max(0, parseInt(saved.price ?? DEFAULT_KUNDALI_PACK_SETTINGS.price, 10) || DEFAULT_KUNDALI_PACK_SETTINGS.price),
      checks: Math.max(1, parseInt(saved.checks ?? DEFAULT_KUNDALI_PACK_SETTINGS.checks, 10) || DEFAULT_KUNDALI_PACK_SETTINGS.checks),
      validityDays: Math.max(1, parseInt(saved.validityDays ?? DEFAULT_KUNDALI_PACK_SETTINGS.validityDays, 10) || DEFAULT_KUNDALI_PACK_SETTINGS.validityDays),
      title: String(saved.title || DEFAULT_KUNDALI_PACK_SETTINGS.title).trim() || DEFAULT_KUNDALI_PACK_SETTINGS.title,
      description: String(saved.description || DEFAULT_KUNDALI_PACK_SETTINGS.description).trim() || DEFAULT_KUNDALI_PACK_SETTINGS.description,
    };
  }

  function normalizeAuthSettings(raw) {
    const configFallback = window.PARICHAYAM_MSG91_OPTIONS || {};
    const saved = raw || {};
    const mode = String(saved.mode || configFallback.mode || DEFAULT_AUTH_SETTINGS.mode).trim().toLowerCase();
    const allowedModes = new Set(["firebase-password", "msg91-hybrid", "msg91-mobile-first"]);
    return {
      ...DEFAULT_AUTH_SETTINGS,
      ...configFallback,
      ...saved,
      enabled: saved.enabled === true || configFallback.enabled === true,
      mode: allowedModes.has(mode) ? mode : DEFAULT_AUTH_SETTINGS.mode,
      requireSignupOtp: saved.requireSignupOtp === true || configFallback.requireSignupOtp === true,
      allowPasswordFallback: saved.allowPasswordFallback !== false && configFallback.allowPasswordFallback !== false,
      widgetId: String(saved.widgetId || configFallback.widgetId || "").trim(),
      authToken: String(saved.authToken || configFallback.authToken || "").trim(),
      countryCode: String(saved.countryCode || configFallback.countryCode || DEFAULT_AUTH_SETTINGS.countryCode)
        .replace(/[^\d]/g, "")
        .slice(0, 4) || DEFAULT_AUTH_SETTINGS.countryCode,
      verifyEndpoint: String(saved.verifyEndpoint || configFallback.verifyEndpoint || "").trim(),
      brandLabel: String(saved.brandLabel || configFallback.brandLabel || DEFAULT_AUTH_SETTINGS.brandLabel).trim() || DEFAULT_AUTH_SETTINGS.brandLabel,
    };
  }

  function sanitizeSharedAuthSettings(raw) {
    const normalized = normalizeAuthSettings(raw);
    return {
      ...normalized,
      enabled: false,
      mode: DEFAULT_AUTH_SETTINGS.mode,
      requireSignupOtp: false,
      widgetId: "",
      authToken: "",
    };
  }

  const MATCHMAKER_PIPELINE_STATUSES = [
    "new",
    "contacted",
    "follow_up",
    "profile_pending",
    "verification_pending",
    "shortlisted",
    "family_discussion",
    "meeting_planned",
    "negotiation",
    "converted",
    "closed",
    "on_hold",
  ];

  const EMPLOYEE_ASSIGNMENT_STATUSES = [
    "new",
    "verification_pending",
    "in_review",
    "awaiting_member",
    "resolved",
    "closed",
    "on_hold",
  ];

  function normalizeAssignmentStatus(value, assignedRole) {
    const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
    const role = normalizeRole(assignedRole || "MATCHMAKER");
    const allowed = role === "EMPLOYEE" ? EMPLOYEE_ASSIGNMENT_STATUSES : MATCHMAKER_PIPELINE_STATUSES;
    return allowed.includes(normalized) ? normalized : allowed[0];
  }

  function isAdminMember(member) {
    return String(member?.role || "").toUpperCase() === "ADMIN";
  }

  function normalizeRole(value) {
    return String(value || "MEMBER").trim().toUpperCase();
  }

  function isStaffMember(member) {
    const role = normalizeRole(member?.role);
    return role === "ADMIN" || role === "MATCHMAKER" || role === "EMPLOYEE";
  }

  function isMatchmakerMember(member) {
    const role = normalizeRole(member?.role);
    return role === "ADMIN" || role === "MATCHMAKER";
  }

  function makeResponse(status, payload) {
    return new Response(JSON.stringify(payload || {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function serverTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getFunctionEndpoint(name) {
    const fnName = String(name || "").trim();
    if (!fnName) return "";
    const explicitBase = String(window.PARICHAYAM_FUNCTIONS_BASE_URL || "").trim().replace(/\/+$/, "");
    if (explicitBase) return `${explicitBase}/${fnName}`;
    const projectId = String(firebaseConfig.projectId || "").trim();
    if (!projectId) return "";
    const region = String(options.functionsRegion || "us-central1").trim() || "us-central1";
    return `https://${region}-${projectId}.cloudfunctions.net/${fnName}`;
  }

  async function submitContactForm(payload) {
    if (!originalFetch) throw buildError(503, "Network requests are not available.", "contact/network-unavailable");
    const endpoint = getFunctionEndpoint("submitContactForm");
    if (!endpoint) throw buildError(503, "Contact service is not configured.", "contact/not-configured");
    const response = await originalFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw buildError(response.status || 500, body.message || "Unable to submit your request right now.", body.code || "contact/submit-failed");
    }
    return body;
  }

  async function callAuthenticatedFunction(name, payload) {
    if (!originalFetch) throw buildError(503, "Network requests are not available.", "functions/network-unavailable");
    const endpoint = getFunctionEndpoint(name);
    if (!endpoint) throw buildError(503, "Cloud Functions are not configured.", "functions/not-configured");
    const user = await ensureAuthReady();
    if (!user) throw buildError(401, "Please sign in again to continue.", "auth/session-required");
    const token = await user.getIdToken(true);
    const response = await originalFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload || {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw buildError(response.status || 500, body.message || "Request failed.", body.code || "functions/request-failed");
    }
    return body;
  }

  async function checkPaymentStatus(payload) {
    return callAuthenticatedFunction("checkPaymentStatus", payload || {});
  }

  async function ensureAuthReady() {
    try {
      await withTimeout(authReadyPromise, AUTH_READY_TIMEOUT_MS, "Authentication service is taking longer than expected. Please refresh and try again.", "auth/timeout");
    } catch (error) {}
    return auth?.currentUser || null;
  }

  async function waitForCurrentUser(expectedUid, timeoutMs) {
    if (!auth || !expectedUid) return auth?.currentUser || null;
    if (auth.currentUser?.uid === expectedUid) return auth.currentUser;
    return withTimeout(
      new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
          if (user?.uid === expectedUid) {
            unsubscribe();
            resolve(user);
          }
        });
      }),
      timeoutMs || AUTH_READY_TIMEOUT_MS,
      "We created the account but could not finish starting your session. Please try signing in once.",
      "auth/session-timeout"
    );
  }

  async function setBridgedState(key, value, meta) {
    if (!db || !BRIDGE_KEYS.has(key)) return;
    await db.collection(options.stateCollection).doc(key).set(
      {
        key,
        value,
        updatedAt: serverTimestamp(),
        updatedBy: meta?.updatedBy || "",
      },
      { merge: true }
    );
  }

  async function deleteBridgedState(key) {
    if (!db || !BRIDGE_KEYS.has(key)) return;
    await db.collection(options.stateCollection).doc(key).delete();
  }

  const PAGE_BRIDGE_KEYS = {
    index: [
      "parichayam_plan_prices",
      "parichayam_site_settings",
      "parichayam_trial_settings",
    ],
    auth: [
      "parichayam_plan_prices",
      "parichayam_site_settings",
      "parichayam_trial_settings",
      "parichayam_agent_directory",
      "parichayam_kundali_pack_settings",
    ],
    dashboard: [
      "parichayam_trial_settings",
      "parichayam_kundali_settings",
      "parichayam_kundali_pack_settings",
      "parichayam_verification_settings",
      "parichayam_dashboard_notice",
      "parichayam_plan_prices",
      "parichayam_site_settings",
      "parichayam_addon_prices",
      "parichayam_connect_packs",
      "parichayam_connect_costs",
      "parichayam_coupons",
      "parichayam_gotras",
      "parichayam_ads",
      "parichayam_dash_vis",
      "parichayam_communities",
      "parichayam_agent_directory",
      "parichayam_public_profile_fields",
    ],
    checkout: [
      "parichayam_plan_prices",
      "parichayam_site_settings",
      "parichayam_payment_settings",
      "parichayam_coupons",
      "parichayam_kundali_pack_settings",
      "parichayam_verification_settings",
    ],
    admin: [
      "parichayam_trial_settings",
      "parichayam_kundali_settings",
      "parichayam_kundali_pack_settings",
      "parichayam_verification_settings",
      "parichayam_dashboard_notice",
      "parichayam_plan_prices",
      "parichayam_site_settings",
      "parichayam_payment_settings",
      "parichayam_coupons",
      "parichayam_addon_prices",
      "parichayam_connect_packs",
      "parichayam_connect_costs",
      "parichayam_connect_requests",
      "parichayam_gotra_requests",
      "parichayam_gotras",
      "parichayam_ads",
      "parichayam_user_access",
      "parichayam_dash_vis",
      "parichayam_form_fields",
      "parichayam_communities",
      "parichayam_custom_fields",
      "parichayam_agent_referral_settings",
      "parichayam_agent_payout_history",
      "parichayam_agent_directory",
      "parichayam_public_profile_fields",
    ],
    agent: ["parichayam_plan_prices"],
    matchmaker: [
      "parichayam_site_settings",
      "parichayam_verification_settings",
      "parichayam_dashboard_notice",
    ],
  };

  async function hydrateBridgedState(pageName, member) {
    if (!db) return;
    const requestedKeys = new Set(PAGE_BRIDGE_KEYS[pageName] || []);
    if (pageName === "admin" && !isAdminMember(member)) return;
    if (!requestedKeys.size) return;
    isApplyingRemoteState = true;
    try {
      for (const key of requestedKeys) {
        try {
          const doc = await db.collection(options.stateCollection).doc(key).get();
          if (!doc.exists) continue;
          const data = doc.data() || {};
          writeLocalCache(key, data.value ?? {});
        } catch (error) {
          if (String(error?.code || "").trim().toLowerCase() !== "permission-denied") {
            console.warn("Unable to hydrate Firebase setting:", key, error?.message || error);
          }
        }
      }
    } finally {
      isApplyingRemoteState = false;
    }
  }

  async function readStateValue(key, fallback) {
    if (!db) return fallback;
    const doc = await db.collection(options.stateCollection).doc(key).get();
    if (!doc.exists) return fallback;
    const value = doc.data()?.value ?? fallback;
    return key === "parichayam_auth_settings"
      ? sanitizeSharedAuthSettings(value)
      : value;
  }

  async function readStateValueSafely(key, fallback) {
    try {
      return await readStateValue(key, fallback);
    } catch (error) {
      return fallback;
    }
  }

  async function getPublicSettingsBundle() {
    const [trial, kundali, notice, verification, kundaliPack, publicProfileFields] = await Promise.all([
      readStateValueSafely("parichayam_trial_settings", DEFAULT_TRIAL_SETTINGS),
      readStateValueSafely("parichayam_kundali_settings", DEFAULT_KUNDALI_SETTINGS),
      readStateValueSafely("parichayam_dashboard_notice", DEFAULT_DASHBOARD_NOTICE),
      readStateValueSafely("parichayam_verification_settings", DEFAULT_VERIFICATION_SETTINGS),
      readStateValueSafely("parichayam_kundali_pack_settings", DEFAULT_KUNDALI_PACK_SETTINGS),
      readStateValueSafely("parichayam_public_profile_fields", DEFAULT_PUBLIC_PROFILE_FIELDS),
    ]);
    return {
      trial: normalizeTrialSettings(trial),
      kundali: normalizeKundaliSettings(kundali),
      notice: normalizeNotice(notice),
      verification: normalizeVerificationSettings(verification),
      kundaliPack: normalizeKundaliPackSettings(kundaliPack),
      auth: sanitizeSharedAuthSettings(window.PARICHAYAM_MSG91_OPTIONS || {}),
      publicProfileFields: { ...DEFAULT_PUBLIC_PROFILE_FIELDS, ...(publicProfileFields || {}) },
    };
  }

  async function getAgentDirectory() {
    return normalizeAgentDirectory(
      await readStateValue("parichayam_agent_directory", DEFAULT_AGENT_DIRECTORY)
    );
  }

  async function assignProfileNumberIfMissing(uid) {
    if (!uid) return "";
    await ensureAuthReady();
    if (!auth?.currentUser || String(auth.currentUser.uid || "") !== String(uid || "")) return "";
    if (!originalFetch) throw buildError(500, "Profile number service is unavailable in this browser.");
    const endpoint = getFunctionEndpoint("ensureMyProfileNumber");
    if (!endpoint) throw buildError(500, "Profile number function endpoint is not configured.");
    const idToken = await auth.currentUser.getIdToken();
    const response = await withTimeout(
      originalFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken,
        },
        body: JSON.stringify({}),
      }),
      FIRESTORE_OP_TIMEOUT_MS,
      "Unable to reserve a profile number right now. Please try again.",
      "functions/profile-number-timeout"
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw buildError(response.status || 400, payload?.message || "Unable to reserve a profile number right now.");
    }
    return normalizeProfileNumber(payload?.profileNumber || "");
  }

  async function initializeMemberProfileIfMissing(payload) {
    await ensureAuthReady();
    if (!auth?.currentUser) throw buildError(401, "Please sign in to continue.");
    if (!originalFetch) throw buildError(500, "Member profile service is unavailable in this browser.");
    const endpoint = getFunctionEndpoint("initializeMyMemberProfile");
    if (!endpoint) throw buildError(500, "Member profile function endpoint is not configured.");
    const idToken = await auth.currentUser.getIdToken();
    const response = await withTimeout(
      originalFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken,
        },
        body: JSON.stringify(payload || {}),
      }),
      FIRESTORE_OP_TIMEOUT_MS,
      "Unable to initialize your profile right now. Please try again.",
      "functions/member-init-timeout"
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw buildError(response.status || 400, result?.message || "Unable to initialize your profile right now.");
    }
    return result?.member || null;
  }

  function persistMemberSession(member) {
    if (!member) return;
    const session = { ...member };
    if (session.uid && !session.id) session.id = session.uid;
    window.USER_SESSION = session;
    sessionStorage.setItem("parichayam_member_session", JSON.stringify(session));
    sessionStorage.setItem("parichayam_auth_token", "firebase:" + (session.uid || session.id || "session"));
  }

  function clearMemberSession() {
    delete window.USER_SESSION;
    sessionStorage.removeItem("parichayam_member_session");
    sessionStorage.removeItem("parichayam_auth_token");
  }

  function readRegistrationDraft() {
    try {
      return parseMaybeJson(sessionStorage.getItem(REGISTRATION_DRAFT_KEY) || "null");
    } catch (error) {
      return null;
    }
  }

  function saveRegistrationDraft(member) {
    try {
      sessionStorage.setItem(REGISTRATION_DRAFT_KEY, JSON.stringify(member || {}));
    } catch (error) {}
  }

  function clearRegistrationDraft() {
    try {
      sessionStorage.removeItem(REGISTRATION_DRAFT_KEY);
    } catch (error) {}
  }

  async function ensureMemberDoc(user) {
    if (!user || !db) return null;
    const ref = db.collection(options.membersCollection).doc(user.uid);
    const doc = await withTimeout(
      ref.get(),
      FIRESTORE_OP_TIMEOUT_MS,
      "Unable to load your profile right now. Please try again.",
      "firestore/member-read-timeout"
    );
    if (doc.exists) {
      const data = doc.data() || {};
      const member = { id: user.uid, uid: user.uid, email: user.email || "", ...data };
      if (!normalizeProfileNumber(member.profileNumber)) {
        member.profileNumber = await assignProfileNumberIfMissing(user.uid).catch(() => "");
      }
      persistMemberSession(member);
      clearRegistrationDraft();
      return member;
    }

    const draft = readRegistrationDraft();
    const matchesDraft = draft && (
      String(draft.uid || "") === String(user.uid || "") ||
      (toLowerEmail(draft.email || "") && toLowerEmail(draft.email || "") === toLowerEmail(user.email || ""))
    );
    const bootstrapPayload = matchesDraft ? draft : {
      name: user.displayName || "",
      phone: normalizePhone(user.phoneNumber || ""),
      email: user.email || "",
      profileFor: "",
      gender: "",
      pendingPlan: "",
      agentRefId: "",
    };
    await initializeMemberProfileIfMissing(bootstrapPayload).catch(() => null);
    const hydrated = await withTimeout(
      ref.get(),
      FIRESTORE_OP_TIMEOUT_MS,
      "Unable to load your profile right now. Please try again.",
      "firestore/member-read-timeout"
    );
    if (!hydrated.exists) throw buildError(500, "Unable to initialize your profile right now.");
    const member = { id: user.uid, uid: user.uid, email: user.email || "", ...(hydrated.data() || {}) };
    if (!normalizeProfileNumber(member.profileNumber)) {
      member.profileNumber = await assignProfileNumberIfMissing(user.uid).catch(() => "");
    }
    persistMemberSession(member);
    clearRegistrationDraft();
    return member;
  }

  async function resolveIdentifierToEmail(identifier) {
    const value = String(identifier || "").trim();
    if (!value) throw buildError(400, "Enter your mobile number or email.");
    if (!value.includes("@")) {
      throw buildError(400, "Phone identifier must be verified through secure server login.");
    }
    return toLowerEmail(value);
  }

  async function requireCurrentMember() {
    const user = await ensureAuthReady();
    if (!user) throw buildError(401, "Please sign in to continue.");
    const member = await ensureMemberDoc(user);
    if (!member) throw buildError(401, "Please sign in to continue.");
    return member;
  }

  async function requireAdminMember() {
    const member = await requireCurrentMember();
    if (!isAdminMember(member)) throw buildError(403, "This account does not have admin access.");
    return member;
  }

  async function requireStaffMember() {
    const member = await requireCurrentMember();
    if (!isStaffMember(member)) throw buildError(403, "This account does not have staff access.");
    return member;
  }

  function sanitizeMember(memberDoc, id) {
    const data = memberDoc || {};
    const status = String(data.status || data.accountStatus || "active").trim().toLowerCase() || "active";
    const photoPrivacyMode = String(data.photoPrivacyMode || data.photoVisibilityMode || "").trim().toLowerCase();
    return {
      id: id || data.id || data.uid || "",
      uid: data.uid || id || "",
      name: String(data.name || "").trim(),
      email: String(data.email || "").trim(),
      phone: normalizePhone(data.phone || ""),
      profileNumber: normalizeProfileNumber(data.profileNumber || ""),
      city: String(data.city || data.currentCity || "").trim(),
      role: normalizeRole(data.role || "MEMBER"),
      tier: String(data.tier || data.plan || "").trim(),
      plan: String(data.plan || "").trim(),
      isPaid: data.isPaid === true,
      status,
      accountStatus: String(data.accountStatus || data.status || status).trim().toLowerCase() || status,
      hidden: data.hidden === true || data.visibility === "hidden",
      visibility: String(data.visibility || (data.hidden === true ? "hidden" : "visible")).trim().toLowerCase() || "visible",
      suspendedUntil: String(data.suspendedUntil || "").trim(),
      suspensionReason: String(data.suspensionReason || "").trim(),
      blockedAt: String(data.blockedAt || "").trim(),
      blockReason: String(data.blockReason || "").trim(),
      adminWatchlist: data.adminWatchlist === true,
      adminWatchlistReason: String(data.adminWatchlistReason || "").trim(),
      verificationStatus: data.verificationStatus || {},
      photoUrl: String(data.photoUrl || data.profilePhoto || "").trim(),
      profilePhoto: String(data.profilePhoto || data.photoUrl || "").trim(),
      photoPrivacyMode: ["search_visible", "blur_until_unlock", "hidden"].includes(photoPrivacyMode) ? photoPrivacyMode : "search_visible",
      sharePhoneAfterUnlock: data.sharePhoneAfterUnlock !== false,
      shareEmailAfterUnlock: data.shareEmailAfterUnlock !== false,
      assignedMatchmakerUid: data.assignedMatchmakerUid || "",
      assignedMatchmakerName: data.assignedMatchmakerName || "",
      assignedVerificationStaffUid: data.assignedVerificationStaffUid || "",
      assignedVerificationStaffName: data.assignedVerificationStaffName || "",
      paidUntil: String(data.paidUntil || "").trim(),
      staffScope: data.staffScope || {},
      updatedAt: data.updatedAt || data.createdAt || "",
      referredByAgentRefId: data.referredByAgentRefId || "",
    };
  }

  async function listMembers(limitValue) {
    const actor = await requireStaffMember();
    const safeLimit = Math.min(isAdminMember(actor) ? 500 : 200, Math.max(1, parseInt(limitValue || 100, 10) || 100));
    if (auth?.currentUser) {
      const endpoint = getFunctionEndpoint("listMembersForStaff");
      if (endpoint) {
        if (!originalFetch) throw buildError(500, "Staff listing service is unavailable in this browser.");
        const idToken = await auth.currentUser.getIdToken();
        const response = await withTimeout(
          originalFetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + idToken,
          },
          body: JSON.stringify({ limit: safeLimit }),
          }),
          FIRESTORE_OP_TIMEOUT_MS,
          "Unable to load members right now. Please try again.",
          "functions/member-list-timeout"
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw buildError(response.status || 400, payload?.message || "Unable to load members right now.");
        return Array.isArray(payload?.members) ? payload.members : [];
      }
    }
    throw buildError(503, "Staff member listing requires server configuration.");
  }

  async function getMemberMatches(limitValue) {
    await requireCurrentMember();
    const safeLimit = Math.min(120, Math.max(1, parseInt(limitValue || 60, 10) || 60));
    if (!auth?.currentUser) throw buildError(401, "Please sign in to continue.");
    if (!originalFetch) throw buildError(500, "Match service is unavailable in this browser.");
    const endpoint = getFunctionEndpoint("memberGetMatches");
    if (!endpoint) throw buildError(503, "Match service endpoint is not configured.");
    const idToken = await auth.currentUser.getIdToken();
    const response = await withTimeout(
      originalFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken,
        },
        body: JSON.stringify({ limit: safeLimit }),
      }),
      15000,
      "Loading live matches is taking too long. Please try again.",
      "matches/load-timeout"
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw buildError(response.status || 400, payload?.message || "Unable to load live matches right now.");
    return Array.isArray(payload?.matches) ? payload.matches : [];
  }

  async function updateMemberFields(uid, patch) {
    const actor = await requireStaffMember();
    const cleanUid = String(uid || "").trim();
    if (!cleanUid) throw buildError(400, "Missing member ID.");
    const updates = { ...(patch || {}), updatedAt: nowIso(), updatedByStaffUid: actor.uid };
    if (!isAdminMember(actor)) {
      const allowedKeys = new Set([
        "status",
        "accountStatus",
        "hidden",
        "visibility",
        "suspendedUntil",
        "suspensionReason",
        "blockedAt",
        "blockReason",
        "reactivatedAt",
        "approvedAt",
        "rejectedAt",
        "rejectionReason",
        "reviewRequestedAt",
        "reviewRequestNote",
        "adminWatchlist",
        "adminWatchlistReason",
        "adminWatchlistAt",
      ]);
      Object.keys(updates).forEach((key) => {
        if (!allowedKeys.has(key) && key !== "updatedAt" && key !== "updatedByStaffUid") {
          delete updates[key];
        }
      });
      delete updates.role;
      delete updates.staffScope;
      delete updates.assignedMatchmakerUid;
      delete updates.assignedMatchmakerName;
      delete updates.assignedVerificationStaffUid;
      delete updates.assignedVerificationStaffName;
    }
    if (!Object.keys(updates).some((key) => key !== "updatedAt" && key !== "updatedByStaffUid")) {
      throw buildError(400, "No staff-editable member fields were provided.");
    }
    await db.collection(options.membersCollection).doc(cleanUid).set(updates, { merge: true });
    const doc = await db.collection(options.membersCollection).doc(cleanUid).get();
    return sanitizeMember(doc.data(), cleanUid);
  }

  async function updateCurrentMemberFields(patch) {
    const member = await requireCurrentMember();
    const safeKeys = new Set([
      "dob",
      "dateOfBirth",
      "timeOfBirth",
      "placeOfBirth",
      "star",
      "nakshatra",
      "rashi",
      "padam",
      "gotra",
      "swaGotram",
      "maternalGotra",
      "mothersGotra",
      "dosham",
      "manglik",
      "height",
      "complexion",
      "education",
      "profession",
      "salary",
      "community",
      "caste",
      "subCaste",
      "jathakam",
      "kundali",
      "jathakamCompleted",
      "kundaliScore",
      "profilePhoto",
      "photoUrl",
      "photoPrivacyMode",
      "sharePhoneAfterUnlock",
      "shareEmailAfterUnlock",
      "address",
      "city",
      "currentCity",
      "state",
      "about",
      "psychoType",
    ]);
    const cleanPatch = {};
    Object.keys(patch || {}).forEach((key) => {
      if (!safeKeys.has(key)) return;
      cleanPatch[key] = patch[key];
    });
    if (!Object.keys(cleanPatch).length) {
      persistMemberSession(member);
      return member;
    }
    cleanPatch.updatedAt = nowIso();
    await db.collection(options.membersCollection).doc(member.uid).set(cleanPatch, { merge: true });
    const doc = await db.collection(options.membersCollection).doc(member.uid).get();
    const updated = sanitizeMember(doc.data(), member.uid);
    const mergedSession = { ...(member || {}), ...(doc.data() || {}), ...updated };
    persistMemberSession(mergedSession);
    return updated;
  }

  async function setMemberRole(body) {
    const admin = await requireAdminMember();
    const uid = String(body?.uid || "").trim();
    const role = normalizeRole(body?.role || "MEMBER");
    if (!uid) throw buildError(400, "Member ID is required.");
    await db.collection(options.membersCollection).doc(uid).set(
      {
        role,
        staffScope: {
          cities: Array.isArray(body?.cities) ? body.cities.filter(Boolean) : [],
          active: body?.active !== false,
        },
        updatedAt: nowIso(),
        updatedByStaffUid: admin.uid,
      },
      { merge: true }
    );
    const doc = await db.collection(options.membersCollection).doc(uid).get();
    return sanitizeMember(doc.data(), uid);
  }

  async function createVerificationRequest(body) {
    const member = await requireCurrentMember();
    const type = String(body?.type || "").trim().toLowerCase();
    if (!["aadhaar", "income"].includes(type)) throw buildError(400, "Invalid verification type.");
    const verificationSettings = normalizeVerificationSettings(
      await readStateValue("parichayam_verification_settings", DEFAULT_VERIFICATION_SETTINGS)
    );
    if (verificationSettings.enabled === false) {
      throw buildError(403, "Verification requests are temporarily paused.");
    }
    const trustedAmount = type === "income"
      ? verificationSettings.incomeFee
      : verificationSettings.aadhaarFee;
    if (!Number.isFinite(trustedAmount) || trustedAmount <= 0) {
      throw buildError(400, "Verification pricing is not configured yet.");
    }
    const docData = {
      memberUid: member.uid,
      memberName: member.name || member.email || "Member",
      memberPhone: member.phone || "",
      memberEmail: member.email || "",
      type,
      // Security: member-created verification requests must start in unpaid/unassigned state.
      status: "awaiting_payment",
      amount: trustedAmount,
      paymentStatus: "pending",
      submittedAt: nowIso(),
      updatedAt: nowIso(),
      assignedToUid: "",
      assignedToName: "",
      documentLabel: String(body?.documentLabel || "").trim(),
      documentType: String(body?.documentType || "").trim(),
      documentName: String(body?.documentName || "").trim(),
      documentUrl: String(body?.documentUrl || "").trim(),
      storagePending: body?.storagePending === true,
      note: String(body?.note || "").trim(),
      requestedFrom: String(body?.requestedFrom || "dashboard"),
      lastReminderAt: body?.lastReminderAt || "",
      reminderCount: Math.max(0, parseInt(body?.reminderCount || 0, 10) || 0),
      assignedRole: type === "income" ? "EMPLOYEE" : "MATCHMAKER",
    };
    const ref = await db.collection("verificationRequests").add(docData);
    trackSqlEvent("verification", {
      firebaseUid: member.uid,
      verificationType: type,
      status: docData.status,
      amount: docData.amount,
      paymentStatus: docData.paymentStatus,
      requestId: ref.id,
    });
    return { id: ref.id, ...docData };
  }

  async function listVerificationRequests(filter) {
    const actor = await requireStaffMember();
    let items = [];
    if (isAdminMember(actor)) {
      const snapshot = await db.collection("verificationRequests").limit(300).get();
      items = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    } else {
      const actorRole = normalizeRole(actor.role || "EMPLOYEE");
      const [assignedSnapshot, unassignedSnapshot] = await Promise.all([
        db.collection("verificationRequests").where("assignedToUid", "==", actor.uid).limit(300).get(),
        db.collection("verificationRequests")
          .where("assignedToUid", "==", "")
          .limit(300)
          .get(),
      ]);
      const merged = new Map();
      assignedSnapshot.docs.forEach((doc) => {
        merged.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
      });
      unassignedSnapshot.docs.forEach((doc) => {
        if (normalizeRole(doc.data()?.assignedRole || "EMPLOYEE") !== actorRole) return;
        merged.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
      });
      items = Array.from(merged.values());
    }
    if (filter?.status) items = items.filter((item) => String(item.status || "") === String(filter.status));
    if (filter?.type) items = items.filter((item) => String(item.type || "") === String(filter.type));
    return items.sort((a, b) => Date.parse(b.updatedAt || b.submittedAt || "") - Date.parse(a.updatedAt || a.submittedAt || ""));
  }

  async function saveVerificationRequest(id, patch) {
    const actor = await requireStaffMember();
    const cleanId = String(id || "").trim();
    if (!cleanId) throw buildError(400, "Verification request ID is required.");
    const ref = db.collection("verificationRequests").doc(cleanId);
    const existing = await ref.get();
    if (!existing.exists) throw buildError(404, "Verification request not found.");
    const data = existing.data() || {};
    if (!isAdminMember(actor) && String(data.assignedToUid || "") !== String(actor.uid || "")) {
      const expectedRole = normalizeRole(data.assignedRole || "EMPLOYEE");
      const isClaimingOpenTask =
        String(data.assignedToUid || "") === "" &&
        expectedRole === normalizeRole(actor.role || "EMPLOYEE") &&
        String(patch?.assignedToUid || "") === String(actor.uid || "") &&
        String(patch?.assignedRole || normalizeRole(actor.role || "EMPLOYEE")) === normalizeRole(actor.role || "EMPLOYEE");
      if (!isClaimingOpenTask) {
        throw buildError(403, "This verification task is not assigned to you.");
      }
    }
    if (!isAdminMember(actor)) {
      const normalizedActorRole = normalizeRole(actor.role || "EMPLOYEE");
      const expectedRole = normalizeRole(data.assignedRole || "EMPLOYEE");
      const isClaimingOpenTask =
        String(data.assignedToUid || "") === "" &&
        expectedRole === normalizedActorRole &&
        String(patch?.assignedToUid || "") === String(actor.uid || "") &&
        String(patch?.assignedRole || normalizedActorRole) === normalizedActorRole;
      const allowedKeys = isClaimingOpenTask
        ? new Set([
          "assignedToUid",
          "assignedToName",
          "assignedRole",
          "assignedAt",
          "status",
        ])
        : new Set([
          "status",
          "memberVerificationStatus",
          "approvedAt",
          "rejectedAt",
          "reviewNotes",
          "reviewedAt",
        ]);
      const disallowed = Object.keys(patch || {}).filter((key) => !allowedKeys.has(String(key || "")));
      if (disallowed.length) {
        throw buildError(403, isClaimingOpenTask
          ? "Staff can only claim open verification tasks."
          : "Staff can only update verification review fields.");
      }
      if (isClaimingOpenTask) {
        patch = {
          assignedToUid: actor.uid,
          assignedToName: actor.name || actor.email || "Staff",
          assignedRole: normalizedActorRole,
          assignedAt: patch?.assignedAt || nowIso(),
          status: "in_review",
        };
      }
    }
    if (String(patch?.status || "").toLowerCase() === "approved") {
      const nextPaymentStatus = isAdminMember(actor)
        ? String(patch?.paymentStatus || data.paymentStatus || "").toLowerCase()
        : String(data.paymentStatus || "").toLowerCase();
      if (nextPaymentStatus !== "paid") {
        throw buildError(400, "Payment must be marked as paid before approval.");
      }
    }
    const next = { ...(patch || {}), updatedAt: nowIso(), updatedByStaffUid: actor.uid };
    await ref.set(next, { merge: true });
    if (patch?.status === "approved" || patch?.status === "rejected") {
      const memberRef = db.collection(options.membersCollection).doc(String(data.memberUid || ""));
      const memberPatch = data.type === "aadhaar"
        ? { verificationStatus: { ...(patch?.memberVerificationStatus || {}), aadhaar: patch.status === "approved" ? "verified" : "rejected" }, aadhaarVerified: patch.status === "approved" }
        : { verificationStatus: { ...(patch?.memberVerificationStatus || {}), income: patch.status === "approved" ? "verified" : "rejected" }, incomeVerified: patch.status === "approved" };
      await memberRef.set(memberPatch, { merge: true });
    }
    const latest = await ref.get();
    return { id: latest.id, ...(latest.data() || {}) };
  }

  async function createMemberAssignment(body) {
    const admin = await requireAdminMember();
    const assignedRole = normalizeRole(body?.assignedRole || "MATCHMAKER");
    const payload = {
      memberUid: String(body?.memberUid || "").trim(),
      memberName: String(body?.memberName || "").trim(),
      memberPhone: normalizePhone(body?.memberPhone || ""),
      memberEmail: toLowerEmail(body?.memberEmail || ""),
      memberCity: String(body?.memberCity || "").trim(),
      memberTier: String(body?.memberTier || "").trim(),
      assignedToUid: String(body?.assignedToUid || "").trim(),
      assignedToName: String(body?.assignedToName || "").trim(),
      assignedRole,
      status: normalizeAssignmentStatus(body?.status || (assignedRole === "EMPLOYEE" ? "verification_pending" : "new"), assignedRole),
      note: String(body?.note || "").trim(),
      incentiveAmount: Math.max(0, parseFloat(body?.incentiveAmount || 0) || 0),
      nextFollowUpAt: String(body?.nextFollowUpAt || "").trim(),
      lastContactAt: String(body?.lastContactAt || "").trim(),
      outcome: String(body?.outcome || "").trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: admin.uid,
    };
    const ref = await db.collection("memberAssignments").add(payload);
    return { id: ref.id, ...payload };
  }

  async function listMemberAssignments(filter) {
    const actor = await requireStaffMember();
    let query = db.collection("memberAssignments");
    if (!isAdminMember(actor)) {
      query = query.where("assignedToUid", "==", actor.uid);
    }
    const snapshot = await query.limit(300).get();
    let items = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    if (filter?.assignedRole) items = items.filter((item) => normalizeRole(item.assignedRole) === normalizeRole(filter.assignedRole));
    return items.sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""));
  }

  async function saveMemberAssignment(id, patch) {
    const actor = await requireStaffMember();
    const ref = db.collection("memberAssignments").doc(String(id || "").trim());
    const existing = await ref.get();
    if (!existing.exists) throw buildError(404, "Assignment not found.");
    const data = existing.data() || {};
    if (!isAdminMember(actor) && String(data.assignedToUid || "") !== String(actor.uid || "")) {
      throw buildError(403, "This client assignment is not assigned to you.");
    }
    const next = { ...(patch || {}), updatedAt: nowIso(), updatedBy: actor.uid };
    if (Object.prototype.hasOwnProperty.call(next, "status")) {
      const actorRole = normalizeRole(actor.role);
      const assignedRole = normalizeRole(data.assignedRole || actorRole);
      const requestedStatus = normalizeAssignmentStatus(next.status, assignedRole);
      if (!isAdminMember(actor)) {
        const allowed = actorRole === "EMPLOYEE" ? EMPLOYEE_ASSIGNMENT_STATUSES : MATCHMAKER_PIPELINE_STATUSES;
        if (!allowed.includes(requestedStatus)) {
          throw buildError(403, "This role cannot move the case into that stage.");
        }
      }
      next.status = requestedStatus;
      next.outcome = String(next.outcome || requestedStatus).trim().toLowerCase();
    }
    await ref.set(next, { merge: true });
    const latest = await ref.get();
    return { id: latest.id, ...(latest.data() || {}) };
  }

  async function logStaffActivity(body) {
    const actor = await requireStaffMember();
    const payload = {
      actorUid: actor.uid,
      actorName: actor.name || actor.email || "Staff",
      actorRole: normalizeRole(actor.role),
      memberUid: String(body?.memberUid || "").trim(),
      memberName: String(body?.memberName || "").trim(),
      type: String(body?.type || "note").trim().toLowerCase(),
      note: String(body?.note || "").trim(),
      createdAt: nowIso(),
    };
    const ref = await db.collection("staffActivityLogs").add(payload);
    return { id: ref.id, ...payload };
  }

  async function listStaffActivity(filter) {
    const actor = await requireStaffMember();
    let query = db.collection("staffActivityLogs");
    if (!isAdminMember(actor)) {
      query = query.where("actorUid", "==", actor.uid);
    }
    const snapshot = await query.limit(300).get();
    let items = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    if (filter?.memberUid) items = items.filter((item) => String(item.memberUid || "") === String(filter.memberUid));
    return items.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  }

  async function apiRegister(body) {
    const name = String(body?.name || "").trim();
    const phone = normalizePhone(body?.phone || "");
    const email = toLowerEmail(body?.email || "");
    const password = String(body?.password || "");
    const profileFor = String(body?.profileFor || "");
    const gender = String(body?.gender || "");
    const pendingPlan = String(body?.pendingPlan || "");
    const agentRefId = normalizeAgentRefId(body?.agentRefId || "");
    const phoneVerified = body?.phoneVerified === true;
    const phoneVerificationProvider = String(body?.phoneVerificationProvider || (phoneVerified ? "msg91" : "")).trim().toLowerCase();
    const phoneVerifiedAt = String(body?.phoneVerifiedAt || "").trim();
    const msg91AccessToken = String(body?.msg91AccessToken || "").trim();

    if (!name) throw buildError(400, "Enter the full name.");
    if (name.length > 200) throw buildError(400, "Name must be 200 characters or fewer.");
    if (phone.length < 10) throw buildError(400, "Enter a valid 10-digit mobile number.");
    if (!isValidEmail(email)) throw buildError(400, "Enter a valid email address.");
    if (!isSafePassword(password)) throw buildError(400, "Password must be at least 8 characters and cannot be only spaces.");

    const credential = await withTimeout(
      auth.createUserWithEmailAndPassword(email, password),
      AUTH_READY_TIMEOUT_MS,
      "Account creation is taking longer than expected. Please try again.",
      "auth/register-timeout"
    );
    await credential.user.sendEmailVerification().catch(() => null);
    await credential.user.getIdToken(true).catch(() => {});
    await waitForCurrentUser(credential.user.uid, AUTH_READY_TIMEOUT_MS).catch(() => credential.user);
    saveRegistrationDraft({
      uid: credential.user.uid,
      name,
      phone,
      email,
      profileFor,
      gender,
      pendingPlan,
      agentRefId,
      ...(msg91AccessToken ? { msg91AccessToken } : {}),
    });
    try {
      await initializeMemberProfileIfMissing({
        name,
        phone,
        email,
        profileFor,
        gender,
        pendingPlan,
        agentRefId,
        ...(msg91AccessToken ? { msg91AccessToken } : {}),
        ...(phoneVerified ? {
          phoneVerified: true,
          phoneVerificationProvider: phoneVerificationProvider || "msg91",
          phoneVerifiedAt: phoneVerifiedAt || nowIso(),
        } : {}),
      });
    } catch (error) {
      if (String(error?.code || "").trim().toUpperCase() === "PHONE_ALREADY_REGISTERED") {
        await credential.user.delete().catch(() => null);
        await auth.signOut().catch(() => null);
        clearMemberSession();
        throw buildError(409, "Mobile already registered. Sign in instead.");
      }
      throw error;
    }
    const member = await ensureMemberDoc(credential.user);
    const trialSettings = normalizeTrialSettings({
      durationDays: member?.trialDurationDays ?? DEFAULT_TRIAL_SETTINGS.durationDays,
      trialConnects: member?.connectsMax ?? DEFAULT_TRIAL_SETTINGS.trialConnects,
      freeConnects: DEFAULT_TRIAL_SETTINGS.freeConnects,
      freeDailyInterests: DEFAULT_TRIAL_SETTINGS.freeDailyInterests,
      freeMonthlyInterests: DEFAULT_TRIAL_SETTINGS.freeMonthlyInterests,
    });
    persistMemberSession(member);
    trackSqlEvent("member", {
      firebaseUid: member.uid,
      name: member.name || "",
      phone: member.phone || "",
      email: member.email || "",
      profileNumber: member.profileNumber || "",
      plan: member.plan || "",
      tier: member.tier || "",
      isPaid: member.isPaid === true,
      registeredOn: member.registeredOn || "",
      agentRefId: member.agentRefId || "",
    });
    return {
      member,
      token: "firebase:" + member.uid,
      trialSettings,
      emailVerificationRequired: true,
    };
  }

  async function apiLogin(body) {
    const identifier = String(body?.identifier || "").trim();
    const password = String(body?.password || "");
    if (!password) throw buildError(400, "Enter your password.");
    let credential = null;
    if (identifier.includes("@")) {
      const email = await resolveIdentifierToEmail(identifier);
      credential = await auth.signInWithEmailAndPassword(email, password);
    } else {
      const phone = normalizePhone(identifier);
      if (phone.length < 10) throw buildError(400, "Enter a valid 10-digit mobile number.");
      if (!originalFetch) throw buildError(500, "Login service is unavailable in this browser.");
      const endpoint = getFunctionEndpoint("signInWithPhone");
      if (!endpoint) throw buildError(500, "Phone sign-in service endpoint is not configured.");
      const response = await withTimeout(
        originalFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, password }),
        }),
        FIRESTORE_OP_TIMEOUT_MS,
        "Unable to sign in right now. Please try again.",
        "functions/phone-login-timeout"
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw buildError(response.status || 400, payload?.message || "Unable to sign in right now.");
      }
      return signInWithCustomToken(payload?.firebaseToken || "");
    }
    const member = await ensureMemberDoc(credential.user);
    return {
      member,
      token: "firebase:" + credential.user.uid,
    };
  }

  async function signInWithCustomToken(customToken) {
    const token = String(customToken || "").trim();
    if (!token) throw buildError(400, "Missing secure login token.");
    const credential = await auth.signInWithCustomToken(token);
    const member = await ensureMemberDoc(credential.user);
    return {
      member,
      token: "firebase:" + credential.user.uid,
    };
  }

  async function apiAuthMe() {
    const member = await requireCurrentMember();
    return { member };
  }

  async function findPublicProfileByNumber(profileNumber) {
    const normalized = normalizeProfileNumber(profileNumber);
    if (!normalized) throw buildError(400, "Enter a valid P number.");
    await ensureAuthReady();
    if (!auth?.currentUser) throw buildError(401, "Please sign in to search by P number.");
    if (!originalFetch) throw buildError(500, "Lookup client is unavailable in this browser.");
    const idToken = await auth.currentUser.getIdToken();
    const endpoint = getFunctionEndpoint("findPublicProfileByNumber");
    if (!endpoint) throw buildError(500, "P-number lookup function endpoint is not configured.");
    const response = await withTimeout(
      originalFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken,
        },
        body: JSON.stringify({ profileNumber: normalized }),
      }),
      FIRESTORE_OP_TIMEOUT_MS,
      "Unable to search that P number right now. Please try again.",
      "functions/public-profile-read-timeout"
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw buildError(
        response.status || 400,
        payload?.message || "Unable to find that P number right now.",
        payload?.code || "public-profile-unavailable"
      );
    }
    return {
      profile: payload?.profile || {},
      visibleFields: payload?.visibleFields || {},
    };
  }

  async function apiLogout() {
    await auth.signOut();
    clearMemberSession();
    return { success: true };
  }

  async function apiForgotPasswordRequest(body) {
    const identifier = String(body?.identifier || "").trim();
    if (!identifier) throw buildError(400, "Enter your mobile number or email.");
    if (!originalFetch) throw buildError(500, "Password reset service is unavailable in this browser.");
    const endpoint = getFunctionEndpoint("requestPasswordReset");
    if (!endpoint) throw buildError(500, "Password reset service endpoint is not configured.");
    const response = await withTimeout(
      originalFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      }),
      FIRESTORE_OP_TIMEOUT_MS,
      "Unable to send reset email right now. Please try again.",
      "functions/password-reset-timeout"
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw buildError(response.status || 400, payload?.message || "Unable to send reset email right now.");
    }
    return {
      maskedEmail: "your registered email",
      delivery: "firebase-email-link",
    };
  }

  async function apiForgotPasswordVerify() {
    throw buildError(400, "This build uses Firebase email reset links. Open the reset email and set your new password there.");
  }

  async function apiForgotPasswordReset() {
    throw buildError(400, "This build uses Firebase email reset links. Open the reset email and set your new password there.");
  }

  async function apiUpdateJathakam(body) {
    const member = await requireCurrentMember();
    const allowedKeys = [
      "dob",
      "dateOfBirth",
      "timeOfBirth",
      "placeOfBirth",
      "star",
      "nakshatra",
      "rashi",
      "padam",
      "gotra",
      "swaGotram",
      "maternalGotra",
      "mothersGotra",
      "dosham",
      "manglik",
      "height",
      "complexion",
      "education",
      "profession",
      "salary",
      "community",
      "caste",
      "subCaste",
      "jathakam",
      "kundali",
      "jathakamCompleted",
      "kundaliScore",
      "profilePhoto",
      "photoUrl",
      "address",
    ];
    const patch = {};
    allowedKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(body || {}, key)) patch[key] = body[key];
    });
    patch.updatedAt = nowIso();

    await db.collection(options.membersCollection).doc(member.uid).set(patch, { merge: true });
    const updated = { ...member, ...patch };
    persistMemberSession(updated);
    return { member: updated };
  }

  async function getTrialWatchlist() {
    const snapshot = await db.collection(options.membersCollection).limit(500).get();
    const now = Date.now();
    const items = [];
    snapshot.forEach((doc) => {
      const member = doc.data() || {};
      if (String(member.tier || "").toLowerCase() !== "trial") return;
      const end = Date.parse(member.trialEndsOn || "");
      if (!Number.isFinite(end)) return;
      const daysLeft = Math.ceil((end - now) / 86400000);
      if (daysLeft > 3) return;
      items.push({
        id: doc.id,
        name: member.name || member.email || member.phone || "Member",
        phone: member.phone || "",
        email: member.email || "",
        trialEndsOn: member.trialEndsOn || "",
        daysLeft,
      });
    });
    items.sort((a, b) => a.daysLeft - b.daysLeft);
    return items.slice(0, 20);
  }

  async function apiGetAdminSettings() {
    await requireAdminMember();
    const settings = await getPublicSettingsBundle();
    const trialWatchlist = await getTrialWatchlist();
    return { settings, trialWatchlist };
  }

  async function apiSaveAdminTrial(body) {
    const member = await requireAdminMember();
    const settings = normalizeTrialSettings(body || {});
    await setBridgedState("parichayam_trial_settings", settings, { updatedBy: member.uid });
    writeLocalCache("parichayam_trial_settings", settings);
    return { trial: settings };
  }

  async function apiSaveAdminKundali(body) {
    const member = await requireAdminMember();
    const settings = normalizeKundaliSettings(body || {});
    await setBridgedState("parichayam_kundali_settings", settings, { updatedBy: member.uid });
    writeLocalCache("parichayam_kundali_settings", settings);
    return { kundali: settings };
  }

  async function apiSaveAdminNotice(body) {
    const member = await requireAdminMember();
    const notice = normalizeNotice(body || {});
    await setBridgedState("parichayam_dashboard_notice", notice, { updatedBy: member.uid });
    writeLocalCache("parichayam_dashboard_notice", notice);
    return { notice };
  }

  async function setStateValue(key, value) {
    const member = await requireAdminMember();
    let normalized = value;
    if (key === "parichayam_trial_settings") normalized = normalizeTrialSettings(value);
    if (key === "parichayam_kundali_settings") normalized = normalizeKundaliSettings(value);
    if (key === "parichayam_dashboard_notice") normalized = normalizeNotice(value);
    if (key === "parichayam_verification_settings") normalized = normalizeVerificationSettings(value);
    if (key === "parichayam_kundali_pack_settings") normalized = normalizeKundaliPackSettings(value);
    if (key === "parichayam_auth_settings") normalized = sanitizeSharedAuthSettings(value);
    await setBridgedState(key, normalized, { updatedBy: member.uid });
    writeLocalCache(key, normalized);
    return normalized;
  }

  async function apiCompleteMembership(body) {
    if (isProductionLikeRuntime()) {
      throw buildError(
        403,
        "Membership activation is backend-controlled in production."
      );
    }
    if (window.PARICHAYAM_ALLOW_CLIENT_MEMBERSHIP_COMPLETE !== true) {
      throw buildError(403, "Client-side membership completion is disabled.");
    }
    const member = await requireCurrentMember();
    const amount = parseInt(String(body?.amount || "").replace(/[^\d]/g, ""), 10) || 0;
    const updated = {
      plan: String(body?.plan || member.plan || "paid"),
      planName: String(body?.planName || member.planName || ""),
      tier: "paid",
      isPaid: true,
      pendingPlan: "",
      lastPaymentId: String(body?.gatewayPaymentId || body?.paymentId || ""),
      lastPaymentAt: nowIso(),
      lastPaymentAmount: amount,
      paymentGateway: String(body?.gateway || ""),
      paymentCurrency: String(body?.currency || "INR"),
      updatedAt: nowIso(),
    };
    const merged = { ...member, ...updated };
    let localOnly = false;
    try {
      await db.collection(options.membersCollection).doc(member.uid).set(updated, { merge: true });
    } catch (error) {
      if (String(error?.code || "") !== "permission-denied") {
        throw error;
      }
      localOnly = true;
    }
    persistMemberSession(merged);
    trackSqlEvent("payment", {
      firebaseUid: merged.uid,
      plan: merged.plan || "paid",
      amount: amount,
      currency: String(body?.currency || "INR"),
      gateway: String(body?.gateway || ""),
      paymentId: String(body?.gatewayPaymentId || body?.paymentId || ""),
    });
    return { member: merged, localOnly };
  }

  function extractApiPath(input) {
    try {
      const url = typeof input === "string" ? new URL(input, window.location.href) : new URL(input.url, window.location.href);
      const marker = url.pathname.indexOf("/api/");
      if (marker === -1) return null;
      return url.pathname.slice(marker + 4);
    } catch (error) {
      return null;
    }
  }

  function parseRequestBody(init) {
    if (!init || !init.body) return {};
    if (typeof init.body === "string") {
      try {
        return JSON.parse(init.body);
      } catch (error) {
        return {};
      }
    }
    return init.body;
  }

  async function handleApiRequest(path, method, body) {
    switch (method + " " + path) {
      case "POST /auth/register":
        return apiRegister(body);
      case "POST /auth/login":
        return apiLogin(body);
      case "GET /auth/me":
        return apiAuthMe();
      case "POST /auth/logout":
        return apiLogout();
      case "POST /auth/forgot-password/request":
        return apiForgotPasswordRequest(body);
      case "POST /auth/forgot-password/verify":
        return apiForgotPasswordVerify(body);
      case "POST /auth/forgot-password/reset":
        return apiForgotPasswordReset(body);
      case "GET /public/settings":
        return { settings: await getPublicSettingsBundle() };
      case "PATCH /profile/jathakam":
        return apiUpdateJathakam(body);
      case "GET /admin/settings":
        return apiGetAdminSettings();
      case "PUT /admin/settings/trial":
        return apiSaveAdminTrial(body);
      case "PUT /admin/settings/kundali":
        return apiSaveAdminKundali(body);
      case "PUT /admin/settings/notice":
        return apiSaveAdminNotice(body);
      case "POST /payment/complete-membership":
        return apiCompleteMembership(body);
      default:
        throw buildError(404, "API route not implemented in Firebase mode.");
    }
  }

  function installFetchInterceptor() {
    if (!originalFetch || !isConfigured) return;
    window.fetch = async function (input, init = {}) {
      const path = extractApiPath(input);
      if (!path) return originalFetch(input, init);

      try {
        if (!SKIP_AUTH_READY_PATHS.has(path)) {
          await ensureAuthReady();
        }
        const payload = await handleApiRequest(path, String(init.method || "GET").toUpperCase(), parseRequestBody(init));
        return makeResponse(200, payload);
      } catch (error) {
        const status = Number(error?.status) || (String(error?.code || "").includes("network") ? 503 : 400);
        return makeResponse(status, {
          message: firebaseMessage(error, "Request failed."),
          code: error?.code || "",
        });
      }
    };
  }

  function patchLocalStorageBridge() {
    if (!window.localStorage || !originalLocalSetItem || !originalLocalRemoveItem) return;

    window.localStorage.setItem = function (key, value) {
      originalLocalSetItem(key, value);
      if (!isConfigured || isApplyingRemoteState || !BRIDGE_KEYS.has(key) || !db) return;
      setBridgedState(key, parseMaybeJson(value), {
        updatedBy: auth?.currentUser?.uid || "",
      }).catch((error) => {
        console.warn("Unable to sync setting to Firebase:", key, error?.message || error);
      });
    };

    window.localStorage.removeItem = function (key) {
      originalLocalRemoveItem(key);
      if (!isConfigured || isApplyingRemoteState || !BRIDGE_KEYS.has(key) || !db) return;
      deleteBridgedState(key).catch((error) => {
        console.warn("Unable to remove Firebase setting:", key, error?.message || error);
      });
    };
  }

  async function bootstrapPage(pageName) {
    if (!isConfigured || !db || !auth) {
      return { configured: false, pageName };
    }
    if (!bootPromise) {
      bootPromise = (async function () {
        await ensureAuthReady();
        const member = auth.currentUser ? await ensureMemberDoc(auth.currentUser) : null;
        await hydrateBridgedState(pageName, member);
        const detail = { configured: true, pageName };
        document.dispatchEvent(new CustomEvent("parichayam:firebase-ready", { detail }));
        return detail;
      })().finally(() => {
        bootPromise = null;
      });
    }
    return bootPromise;
  }

  async function signOutAndRedirect(targetUrl) {
    if (auth) {
      try {
        await auth.signOut();
      } catch (error) {}
    }
    clearMemberSession();
    window.location.href = targetUrl || "auth.html";
    return false;
  }

  function uploadFile(path, file) {
    if (!storage) return Promise.reject(new Error("Firebase Storage is not configured."));
    return storage.ref(path).put(file).then((snapshot) => snapshot.ref.getDownloadURL());
  }

  if (isConfigured && window.firebase) {
    app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    try {
      storage = firebase.storage();
    } catch (error) {
      storage = null;
    }

    authReadyPromise = new Promise((resolve) => {
      let settled = false;
      let unsubscribe = function () {};
      const finalize = function (user) {
        if (settled) return;
        settled = true;
        resolve(user || null);
        try {
          unsubscribe();
        } catch (error) {}
      };
      unsubscribe = auth.onAuthStateChanged(async (user) => {
        if (user) {
          try {
            await ensureMemberDoc(user);
          } catch (error) {
            console.warn("Unable to hydrate Firebase member session:", error?.message || error);
          }
        } else {
          clearMemberSession();
        }
        finalize(user);
      }, function () {
        finalize(auth.currentUser || null);
      });
      window.setTimeout(() => {
        finalize(auth.currentUser || null);
      }, AUTH_READY_TIMEOUT_MS);
    });

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    patchLocalStorageBridge();
    installFetchInterceptor();
  }

  window.ParichayamFirebase = {
    isConfigured: function () {
      return !!(isConfigured && app && auth && db);
    },
    register: apiRegister,
    login: apiLogin,
    requestPasswordReset: apiForgotPasswordRequest,
    submitContactForm,
    checkPaymentStatus,
    signInWithCustomToken,
    completeMembership: apiCompleteMembership,
    bootstrapPage,
    signOutAndRedirect,
    uploadFile,
    getCurrentMember: requireCurrentMember,
    getPublicSettingsBundle,
    getAgentDirectory,
    getStateValue: readStateValue,
    setStateValue,
    listMembers,
    getMemberMatches,
    updateMemberFields,
    updateCurrentMemberFields,
    setMemberRole,
    createVerificationRequest,
    listVerificationRequests,
    saveVerificationRequest,
    createMemberAssignment,
    listMemberAssignments,
    saveMemberAssignment,
    logStaffActivity,
    listStaffActivity,
    findPublicProfileByNumber,
    syncStateToLocal: hydrateBridgedState,
    trackSqlEvent,
    options,
  };
})();
