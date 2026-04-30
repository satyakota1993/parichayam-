const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const MEMBERS_COLLECTION = "members";
const PHONE_INDEX_COLLECTION = "memberPhoneIndex";
const MEMBER_ASSIGNMENTS_COLLECTION = "memberAssignments";
const VERIFICATION_REQUESTS_COLLECTION = "verificationRequests";
const PUBLIC_PROFILES_COLLECTION = "publicProfiles";
const APP_STATE_COLLECTION = "appState";
const COUNTERS_COLLECTION = "systemCounters";
const PROFILE_NUMBER_COUNTER_ID = "publicProfileNumber";
const LOOKUP_RATE_LIMIT_COLLECTION = "pnumberLookupRateLimits";
const LOOKUP_RATE_LIMIT_MAX = 10;
const LOOKUP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const AUTH_RATE_LIMIT_COLLECTION = "authRateLimits";
const PAYMENT_ORDERS_COLLECTION = "paymentOrders";
const PAYMENTS_COLLECTION = "payments";
const REVENUE_EVENTS_COLLECTION = "revenueEvents";
const COMPLAINTS_COLLECTION = "complaints";
const PENDING_ACTIVATIONS_COLLECTION = "pendingActivations";
const ADMIN_ALERTS_COLLECTION = "adminAlerts";
const PAYMENT_RECONCILIATION_RUNS_COLLECTION = "paymentReconciliationRuns";
const RECONCILIATION_REPORTS_COLLECTION = "reconciliationReports";
const REVENUE_SCHEMA_VERSION = 1;
const REVENUE_LOCK_DAYS = 30;
const REVENUE_LOCK_MS = REVENUE_LOCK_DAYS * 24 * 60 * 60 * 1000;
const REFERRED_AGENT_COMMISSION_RATE = 0.15;
const DEFAULT_MEMBERSHIP_PRICES = {
  "1mo": 199,
  "3mo": 449,
  "6mo": 550,
  annual: 1000,
};
const MEMBERSHIP_PLAN_DURATION_DAYS = {
  "1mo": 30,
  "3mo": 90,
  "6mo": 180,
  annual: 365,
};
const DEFAULT_VERIFICATION_SETTINGS = {
  aadhaarFee: 100,
  incomeFee: 100,
  turnaroundHours: 24,
  reminderHours: 5,
  enabled: true,
};
const PUBLIC_PROFILE_FIELDS_KEY = "parichayam_public_profile_fields";
const TRIAL_SETTINGS_KEY = "parichayam_trial_settings";
const KUNDALI_SETTINGS_KEY = "parichayam_kundali_settings";
const AGENT_DIRECTORY_KEY = "parichayam_agent_directory";
const DEFAULT_MATCH_KUNDALI_SETTINGS = {
  enabled: true,
  enableForTrial: true,
  enableForPaid: true,
  enableForFree: false,
  sameGotraPolicy: "hard",
  weight: 35,
};
const DEFAULT_SERVER_AUTH_SETTINGS = {
  enabled: false,
  mode: "firebase-password",
  requireSignupOtp: false,
};
const AGENT_TIERS_KEY = "parichayam_agent_tiers";
const AGENT_COMMISSION_SETTINGS_KEY = "parichayam_agent_commission_settings";
const LEADERBOARD_SETTINGS_KEY = "parichayam_leaderboard_settings";
const WHATSAPP_NOTIFICATION_SETTINGS_KEY = "parichayam_whatsapp_notification_settings";
const WHATSAPP_TEMPLATES_COLLECTION = "whatsappTemplates";
const FESTIVALS_COLLECTION = "festivals";
const MARKETING_MATERIALS_COLLECTION = "marketingMaterials";
const NOTIFICATION_LOG_COLLECTION = "notificationLog";

// ──────────────────────────────────────────────────────────
// PHASE 3-LEAN: MATCHMAKER OPERATING SYSTEM
// ──────────────────────────────────────────────────────────
const MATCH_SUGGESTIONS_COLLECTION = "matchSuggestions";
const FAMILY_INTRODUCTIONS_COLLECTION = "familyIntroductions";
const MATCHMAKER_SUBSCRIPTIONS_COLLECTION = "matchmakerSubscriptions";
const MATCHMAKER_NOTES_COLLECTION = "matchmakerNotes";
const MATCHMAKER_MESSAGES_COLLECTION = "matchmakerMessages";
const ACTIVITY_LOG_COLLECTION = "activityLog";
const ANALYTICS_EVENTS_COLLECTION = "analyticsEvents";

const MATCHMAKER_PRICING_KEY = "parichayam_matchmaker_pricing";
const MATCHMAKER_SETTINGS_KEY = "parichayam_matchmaker_settings";
const MATCHMAKER_PROOF_KEY = "parichayam_matchmaker_proof";
const MATCHMAKER_PROMPTS_KEY = "parichayam_matchmaker_prompts";

const SUGGESTION_STATUS_FLOW = {
  PENDING: "pending",
  A_VIEWED: "a_viewed",
  B_VIEWED: "b_viewed",
  BOTH_VIEWED: "both_viewed",
  A_LIKED: "a_liked",
  B_LIKED: "b_liked",
  MUTUAL_INTEREST: "mutual_interest",
  A_DECLINED: "a_declined",
  B_DECLINED: "b_declined",
  FAMILY_INTRODUCED: "family_introduced",
  IN_DISCUSSION: "in_discussion",
  ENGAGED: "engaged",
  CLOSED: "closed",
};

const ACTIVITY_EVENT_TYPES = {
  MEMBER_LOGIN: "member_login",
  MEMBER_PROFILE_UPDATED: "member_profile_updated",
  MEMBER_PHOTO_UPLOADED: "member_photo_uploaded",
  MEMBER_PLAN_PURCHASED: "member_plan_purchased",
  MEMBER_MATCHMAKER_SUBSCRIBED: "member_matchmaker_subscribed",
  MEMBER_MATCHMAKER_CANCELLED: "member_matchmaker_cancelled",
  SUGGESTION_CREATED: "suggestion_created",
  SUGGESTION_VIEWED: "suggestion_viewed",
  SUGGESTION_LIKED: "suggestion_liked",
  SUGGESTION_DECLINED: "suggestion_declined",
  MUTUAL_INTEREST_REACHED: "mutual_interest_reached",
  FAMILY_INTRODUCTION_CREATED: "family_introduction_created",
  FAMILY_INTRODUCTION_OUTCOME_RECORDED: "family_introduction_outcome_recorded",
  MATCHMAKER_ASSIGNED: "matchmaker_assigned",
  MATCHMAKER_REASSIGNED: "matchmaker_reassigned",
  MATCHMAKER_NOTE_ADDED: "matchmaker_note_added",
  MATCHMAKER_MESSAGE_SENT: "matchmaker_message_sent",
  MATCHMAKER_CALL_LOGGED: "matchmaker_call_logged",
  ADMIN_INTERVENTION: "admin_intervention",
  ADMIN_REFUND_ISSUED: "admin_refund_issued",
  ADMIN_NOTE_ADDED: "admin_note_added",
  SYSTEM_SUGGESTION_EXPIRED: "system_suggestion_expired",
  SYSTEM_SUBSCRIPTION_EXPIRED: "system_subscription_expired",
  SYSTEM_RENEWAL_REMINDER: "system_renewal_reminder",
};

const DEFAULT_MATCHMAKER_PRICING = {
  monthly: { price: 2000, durationDays: 30, suggestionsPerWeek: 3, enabled: true, label: "" },
  quarterly: { price: 5000, durationDays: 90, suggestionsPerWeek: 3, enabled: true, label: "MOST POPULAR" },
  six_months: { price: 10000, durationDays: 180, suggestionsPerWeek: 3, enabled: true, label: "BEST VALUE" },
};

const DEFAULT_MATCHMAKER_SETTINGS = {
  suggestionExpiryDays: 14,
  autoCloseExpired: true,
  warnSameGotra: true,
  warnAgeDifferenceAbove: 7,
  warnInterStateMatch: false,
  warnManglikMismatch: true,
  revealFullNameOnMutualInterest: true,
  revealPhoneOnFamilyIntroduction: true,
  revealPhoneOnMutualInterest: false,
  minimumNoteLength: 30,
  maximumNoteLength: 500,
  allowMatchmakerMessaging: true,
  stickyMatchmakerOnRenewal: true,
  enableConflictOfInterestCheck: true,
};

const DEFAULT_MATCHMAKER_PROOF = {
  totalCouplesMatched: 47,
  avgEngagementDays: 67,
  successRatePercent: 92,
  testimonials: [
    { name: "S. Lakshmi", city: "Vijayawada", quote: "Our matchmaker guided both families with warmth and clarity.", engagedAt: "2026-01-12" },
    { name: "P. Karthik", city: "Hyderabad", quote: "The shortlist quality was much better than searching alone.", engagedAt: "2025-12-08" },
  ],
  matchmakerProfile: {
    name: "Parichayam Match Desk",
    experience: "22 years",
    languages: ["Telugu", "English", "Hindi"],
    city: "Vijayawada",
    photoUrl: "",
  },
};

const DEFAULT_MATCHMAKER_PROMPTS = [
  { id: "trial_interest", enabled: true, trigger: "member_shortlisted_without_matchmaker", title: "Want curated matches?", body: "A dedicated matchmaker can handpick families and manage the first introduction.", cta: "See plans" },
  { id: "recent_declines", enabled: true, trigger: "member_declined_three_profiles", title: "Need help refining the search?", body: "Your matchmaker can screen profiles based on family fit before you see them.", cta: "Get a matchmaker" },
  { id: "inactive_search", enabled: true, trigger: "member_inactive_search_7d", title: "Search feeling slow?", body: "A matchmaker can keep momentum with curated suggestions each week.", cta: "View plans" },
  { id: "verification_upgrade", enabled: true, trigger: "member_verified_profile", title: "Use your verified profile fully", body: "Unlock guided introductions with a dedicated Parichayam matchmaker.", cta: "Subscribe" },
  { id: "event_followup", enabled: true, trigger: "member_event_interest", title: "Continue after the event", body: "Stay with the same matchmaker after Parichaya Vedhika and keep the shortlist moving.", cta: "Continue with matchmaker" },
];

const MATCHMAKER_NOTE_CATEGORIES = ["general", "preference", "family", "conflict", "follow_up"];
const MATCHMAKER_MESSAGE_ATTACHMENT_TYPES = ["", "image", "document"];
const MATCHMAKER_SUBSCRIPTION_PLANS = ["monthly", "quarterly", "six_months"];
const MATCHMAKER_SUBSCRIPTION_STATUSES = ["active", "expired", "paused", "cancelled"];
const DEFAULT_AGENT_COMMISSION_SETTINGS = {
  defaultCommissionRate: 15,
  lockPeriodDays: 30,
  minimumPayoutAmount: 500,
  payoutSlaBusinessDays: 3,
  tdsThreshold: 25000,
  tdsRate: 5,
};
const DEFAULT_AGENT_TIERS = [
  { id: "bronze", name: "Bronze", minPaidReferrals: 0, commissionRate: 15, monthlyBonus: 0, enabled: true },
  { id: "silver", name: "Silver", minPaidReferrals: 10, commissionRate: 17, monthlyBonus: 0, enabled: true },
  { id: "gold", name: "Gold", minPaidReferrals: 25, commissionRate: 20, monthlyBonus: 0, enabled: true },
  { id: "platinum", name: "Platinum", minPaidReferrals: 50, commissionRate: 22, monthlyBonus: 2000, enabled: true },
];
const DEFAULT_LEADERBOARD_SETTINGS = {
  enabled: true,
  metric: "paid",
  resetPeriod: "monthly",
  showTop: 10,
  anonymizeNames: true,
  rewards: { top1: 5000, top3: 2000, top10: 500 },
};
const DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS = {
  enabled: false,
  dailyCap: 200,
  estimatedCostPerMessage: 0.5,
  triggers: {
    newSignup: true,
    paymentReceived: true,
    commissionUnlocked: true,
    payoutProcessed: true,
    weeklyDigest: true,
    festivalReminder: true,
    tierUpgrade: true,
    refundApplied: true,
  },
};
const DEFAULT_WHATSAPP_TEMPLATES = [
  {
    id: "newSignup",
    title: "New referral signup",
    trigger: "newSignup",
    language: "telugu",
    enabled: true,
    message: "{{agent_name}}, మీ రిఫరల్ {{member_name}} సైన్ అప్ చేశారు. వారికి స్వాగతం చెప్పండి!",
    englishMessage: "{{agent_name}}, your referral {{member_name}} just signed up. Say hi to them!",
  },
  {
    id: "paymentReceived",
    title: "Referral paid",
    trigger: "paymentReceived",
    language: "telugu",
    enabled: true,
    message: "{{agent_name}}, {{member_name}} చెల్లింపు పూర్తి చేశారు. మీ కమిషన్ {{commission_amount}} 30 రోజుల తర్వాత అందుబాటులోకి వస్తుంది.",
    englishMessage: "{{agent_name}}, {{member_name}} paid successfully. Your commission {{commission_amount}} unlocks after 30 days.",
  },
  {
    id: "commissionUnlocked",
    title: "Commission unlocked",
    trigger: "commissionUnlocked",
    language: "telugu",
    enabled: true,
    message: "{{agent_name}}, మీ కమిషన్ {{commission_amount}} ఇప్పుడు విత్‌డ్రాకు అందుబాటులో ఉంది.",
    englishMessage: "{{agent_name}}, your commission {{commission_amount}} is now available to withdraw.",
  },
  {
    id: "payoutProcessed",
    title: "Payout processed",
    trigger: "payoutProcessed",
    language: "telugu",
    enabled: true,
    message: "{{agent_name}}, మీ పేఅవుట్ {{payout_amount}} ప్రాసెస్ అయింది. బ్యాంక్ రిఫరెన్స్: {{bank_reference}}.",
    englishMessage: "{{agent_name}}, your payout {{payout_amount}} has been processed. Bank ref: {{bank_reference}}.",
  },
  {
    id: "weeklyDigest",
    title: "Weekly digest",
    trigger: "weeklyDigest",
    language: "telugu",
    enabled: true,
    message: "{{agent_name}}, ఈ వారం: {{signups}} సైన్‌అప్స్, {{paid}} చెల్లింపులు, {{commission_amount}} కమిషన్.",
    englishMessage: "{{agent_name}}, this week: {{signups}} signups, {{paid}} paid, {{commission_amount}} commission.",
  },
];
const DEFAULT_FESTIVALS = [
  { id: "sankranti", name: "Sankranti", date: "2027-01-14", enabled: true, reminderDaysBefore: 7, promoCode: "SANKRANTI", englishMessage: "Celebrate Sankranti by helping families find trusted Telugu matches on Parichayam.", teluguMessage: "సంక్రాంతి సందర్భంగా పరిచయం ద్వారా మంచి తెలుగు సంబంధాలను కుటుంబాలకు పరిచయం చేయండి." },
  { id: "ugadi", name: "Ugadi", date: "2027-04-08", enabled: true, reminderDaysBefore: 7, promoCode: "UGADI", englishMessage: "New year, new beginnings. Share Parichayam with families looking for verified Telugu matches.", teluguMessage: "ఉగాది కొత్త ఆరంభం. నమ్మకమైన తెలుగు సంబంధాల కోసం పరిచయాన్ని షేర్ చేయండి." },
  { id: "akshaya-tritiya", name: "Akshaya Tritiya", date: "2027-05-14", enabled: true, reminderDaysBefore: 7, promoCode: "AKSHAYA", englishMessage: "Akshaya Tritiya is a beautiful time to start marriage conversations with trusted families.", teluguMessage: "అక్షయ తృతీయ రోజున నమ్మకమైన కుటుంబాలతో వివాహ పరిచయాలు ప్రారంభించండి." },
  { id: "brahmotsavam", name: "Brahmotsavam", date: "2026-09-16", enabled: true, reminderDaysBefore: 7, promoCode: "BRAHMOTSAVAM", englishMessage: "Share Parichayam during Brahmotsavam season with families seeking community-first matches.", teluguMessage: "బ్రహ్మోత్సవం సమయంలో కమ్యూనిటీ ఆధారిత సంబంధాల కోసం పరిచయాన్ని షేర్ చేయండి." },
  { id: "karthika-masam", name: "Karthika Masam", date: "2026-11-10", enabled: true, reminderDaysBefore: 7, promoCode: "KARTHIKA", englishMessage: "Karthika Masam is an auspicious time to help families begin match discussions.", teluguMessage: "కార్తీక మాసం కుటుంబాలకు సంబంధాల చర్చలు ప్రారంభించడానికి శుభ సమయం." },
  { id: "margashira", name: "Margashira", date: "2026-12-11", enabled: true, reminderDaysBefore: 7, promoCode: "MARGASHIRA", englishMessage: "Share verified Telugu matrimony options with families this Margashira season.", teluguMessage: "ఈ మార్గశిర కాలంలో ధృవీకరించిన తెలుగు వివాహ పరిచయాలను కుటుంబాలతో పంచుకోండి." },
  { id: "shravana", name: "Shravana", date: "2026-08-15", enabled: true, reminderDaysBefore: 7, promoCode: "SHRAVANA", englishMessage: "Shravana is a meaningful season for family introductions. Share Parichayam today.", teluguMessage: "శ్రావణం కుటుంబ పరిచయాలకు మంచి కాలం. ఈరోజే పరిచయాన్ని షేర్ చేయండి." },
  { id: "vasanta-panchami", name: "Vasanta Panchami", date: "2027-02-11", enabled: true, reminderDaysBefore: 7, promoCode: "VASANTA", englishMessage: "Invite families to begin a hopeful match journey this Vasanta Panchami.", teluguMessage: "వసంత పంచమి సందర్భంగా మంచి సంబంధాల ప్రయాణం ప్రారంభించడానికి కుటుంబాలను ఆహ్వానించండి." }
];
const DEFAULT_MARKETING_MATERIALS = [
  { id: "whatsapp-dp", title: "WhatsApp DP", type: "image", enabled: true, description: "Square profile image placeholder", url: "assets/agent-whatsapp-dp-placeholder.svg" },
  { id: "a4-flyer", title: "A4 Flyer", type: "image", enabled: true, description: "Printable flyer placeholder", url: "assets/agent-a4-flyer-placeholder.svg" },
  { id: "business-card", title: "Business Card", type: "image", enabled: true, description: "Business card placeholder", url: "assets/agent-business-card-placeholder.svg" },
  { id: "instagram-story", title: "Instagram Story", type: "image", enabled: true, description: "Vertical story placeholder", url: "assets/agent-instagram-story-placeholder.svg" }
];
const PUBLIC_PROFILE_ALLOWED_FIELDS = [
  "profileNumber",
  "name",
  "age",
  "city",
  "community",
  "education",
  "profession",
  "nakshatra",
  "rashi",
  "gotra",
  "padam",
  "about",
];
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
const CONTACT_FORM_CATEGORIES = new Set(["general", "refund", "grievance", "technical"]);

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
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!/^P\d{6,10}$/.test(normalized)) return "";
  return normalized;
}

function nowIso() {
  return new Date().toISOString();
}

function profileNumberFromCounter(counter) {
  const numeric = Math.max(100001, parseInt(counter, 10) || 100001);
  return `P${String(numeric).padStart(6, "0")}`;
}

function getVerificationLabel(member) {
  const aadhaarVerified = member?.aadhaarVerified === true || member?.verificationStatus?.aadhaar === "verified";
  const incomeVerified = member?.incomeVerified === true || member?.verificationStatus?.income === "verified";
  if (aadhaarVerified && incomeVerified) return "ID + Income Verified";
  if (aadhaarVerified) return "ID Verified";
  if (incomeVerified) return "Income Verified";
  return "Verification Pending";
}

function buildPublicProfileDoc(member) {
  if (!isShareablePublicProfileMember(member)) return null;
  const profileNumber = normalizeProfileNumber(member?.profileNumber || "");
  if (!profileNumber) return null;
  const ageRaw = parseInt(member?.age ?? member?.profileAge ?? "", 10);
  const city = String(member?.city || member?.currentCity || member?.location || "").trim();
  const state = String(member?.state || "").trim();
  return {
    profileNumber,
    name: String(member?.name || member?.fullName || "").trim(),
    age: Number.isFinite(ageRaw) && ageRaw > 0 ? ageRaw : null,
    city: [city, state].filter(Boolean).join(", "),
    community: String(member?.community || member?.caste || "").trim(),
    education: String(member?.education || member?.edu || "").trim(),
    profession: String(member?.profession || member?.designation || member?.job || "").trim(),
    nakshatra: String(member?.nakshatra || member?.nak || "").trim(),
    rashi: String(member?.rashi || "").trim(),
    gotra: String(member?.gotra || "").trim(),
    padam: String(member?.padam || "").trim(),
    about: String(member?.about || "").trim(),
    verificationLabel: getVerificationLabel(member),
    aadhaarVerified: member?.aadhaarVerified === true || member?.verificationStatus?.aadhaar === "verified",
    incomeVerified: member?.incomeVerified === true || member?.verificationStatus?.income === "verified",
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function sanitizePublicProfile(profile, visibleFields) {
  const source = profile || {};
  const allow = visibleFields || DEFAULT_PUBLIC_PROFILE_FIELDS;
  const out = {};
  PUBLIC_PROFILE_ALLOWED_FIELDS.forEach((field) => {
    const isVisible = allow[field] !== false;
    if (!isVisible) return;
    const value = source[field];
    if (value === undefined || value === null || value === "") return;
    out[field] = value;
  });
  if (allow.verification !== false) {
    if (source.verificationLabel) out.verification = source.verificationLabel;
    else if (source.aadhaarVerified || source.incomeVerified) out.verification = "Verified";
    else out.verification = "Verification Pending";
  }
  return out;
}

async function readVisiblePublicProfileFields() {
  const doc = await db.collection(APP_STATE_COLLECTION).doc(PUBLIC_PROFILE_FIELDS_KEY).get();
  const rawValue = doc.exists ? (doc.data()?.value || {}) : {};
  const normalized = { ...DEFAULT_PUBLIC_PROFILE_FIELDS };
  Object.keys(normalized).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rawValue, key)) {
      normalized[key] = rawValue[key] !== false;
    }
  });
  return normalized;
}

async function readTrialSettings() {
  const defaults = { durationDays: 30, trialConnects: 30 };
  const doc = await db.collection(APP_STATE_COLLECTION).doc(TRIAL_SETTINGS_KEY).get();
  const value = doc.exists ? (doc.data()?.value || {}) : {};
  return {
    durationDays: Math.max(1, parseInt(value.durationDays ?? defaults.durationDays, 10) || defaults.durationDays),
    trialConnects: Math.max(1, parseInt(value.trialConnects ?? defaults.trialConnects, 10) || defaults.trialConnects),
  };
}

async function readKundaliMatchSettings() {
  const doc = await db.collection(APP_STATE_COLLECTION).doc(KUNDALI_SETTINGS_KEY).get();
  const value = doc.exists ? (doc.data()?.value || {}) : {};
  return {
    enabled: value.enabled !== false,
    enableForTrial: value.enableForTrial !== false,
    enableForPaid: value.enableForPaid !== false,
    enableForFree: value.enableForFree === true,
    sameGotraPolicy: String(value.sameGotraPolicy || DEFAULT_MATCH_KUNDALI_SETTINGS.sameGotraPolicy).trim().toLowerCase() || "hard",
    weight: Math.max(0, parseInt(value.weight ?? DEFAULT_MATCH_KUNDALI_SETTINGS.weight, 10) || DEFAULT_MATCH_KUNDALI_SETTINGS.weight),
  };
}

async function readAuthSettings() {
  return {
    enabled: false,
    mode: DEFAULT_SERVER_AUTH_SETTINGS.mode,
    requireSignupOtp: false,
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeGenderValue(value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return "";
  if (["male", "groom", "bridegroom", "son"].includes(raw)) return "male";
  if (["female", "bride", "daughter", "girl"].includes(raw)) return "female";
  return raw === "m" ? "male" : raw === "f" ? "female" : "";
}

function getOppositeGenderValue(value) {
  const gender = normalizeGenderValue(value);
  return gender === "male" ? "female" : gender === "female" ? "male" : "";
}

function parseTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveMemberAge(member) {
  const directAge = parseInt(member?.age ?? member?.profileAge ?? "", 10);
  if (Number.isFinite(directAge) && directAge >= 18 && directAge <= 80) return directAge;
  const dobRaw = member?.dateOfBirth || member?.dob || "";
  const dobMs = parseTimestampMs(dobRaw);
  if (!dobMs) return null;
  const dob = new Date(dobMs);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age >= 18 && age <= 80 ? age : null;
}

function normalizeLocationBits(member) {
  const city = normalizeText(member?.city || member?.currentCity || member?.location || "");
  const state = normalizeText(member?.state || "");
  const country = normalizeText(member?.country || "India");
  return { city, state, country };
}

function educationBucket(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) return "unknown";
  if (/(PH\.?D|PH D|DOCTORATE|DOCTORAL|CA|CS|CMA|MBBS|MD|MS|LLB|LLM|BDS|DOCTOR|ADVOCATE|CHARTERED)/.test(text)) return "professional";
  if (/(MBA|M\.TECH|MTECH|M\.SC|MSC|M\.A|MA |MCA|M\.COM|MCOM|M\.ED|MED|POST)/.test(text)) return "postgrad";
  if (/(B\.TECH|BTECH|B\.E|BE |B\.COM|BCOM|B\.SC|BSC|B\.A|BA |BBA|BCA|B\.ARCH|BARCH|B\.ED|BED|GRAD)/.test(text)) return "undergrad";
  return "other";
}

function getEducationFitScore(seeker, candidate) {
  const left = educationBucket(seeker?.education || seeker?.edu || "");
  const right = educationBucket(candidate?.education || candidate?.edu || "");
  if (left === "unknown" || right === "unknown") return 6;
  if (left === right) return 10;
  const order = ["professional", "postgrad", "undergrad", "other"];
  const diff = Math.abs(order.indexOf(left) - order.indexOf(right));
  return diff <= 1 ? 7 : diff === 2 ? 4 : 2;
}

function parseIncomeLakhs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return null;
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  let numeric = parseFloat(match[1]);
  if (!Number.isFinite(numeric)) return null;
  if (raw.includes("crore")) numeric *= 100;
  else if (raw.includes("thousand") || /\bk\b/.test(raw)) numeric /= 100;
  return numeric;
}

function incomeBand(value) {
  const lakhs = parseIncomeLakhs(value);
  if (!Number.isFinite(lakhs)) return -1;
  if (lakhs < 5) return 0;
  if (lakhs < 10) return 1;
  if (lakhs < 20) return 2;
  if (lakhs < 35) return 3;
  return 4;
}

function getIncomeFitScore(seeker, candidate) {
  const seekerBand = incomeBand(seeker?.salary || seeker?.incomeRange || seeker?.income || seeker?.businessIncome || seeker?.annualIncome || "");
  const candidateBand = incomeBand(candidate?.salary || candidate?.incomeRange || candidate?.income || candidate?.businessIncome || candidate?.annualIncome || "");
  if (seekerBand === -1 || candidateBand === -1) return 5;
  const diff = Math.abs(seekerBand - candidateBand);
  return diff === 0 ? 10 : diff === 1 ? 7 : diff === 2 ? 4 : 2;
}

function normalizeNakshatraValue(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const aliases = {
    Krittika: "Karthika",
    Karthika: "Karthika",
    Swati: "Swathi",
    Swathi: "Swathi",
  };
  return aliases[raw] || raw;
}

function normalizeRashiValue(value) {
  const raw = normalizeText(value).replace(/\s*\(.*?\)\s*/g, "");
  if (!raw) return "";
  const aliases = {
    Aries: "Mesha",
    Taurus: "Vrishabha",
    Gemini: "Mithuna",
    Cancer: "Karka",
    Leo: "Simha",
    Virgo: "Kanya",
    Libra: "Tula",
    Scorpio: "Vrishchika",
    Sagittarius: "Dhanu",
    Capricorn: "Makara",
    Aquarius: "Kumbha",
    Pisces: "Meena",
  };
  return aliases[raw] || raw;
}

function normalizeGotraValue(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePadamValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return String(value);
  const match = normalizeText(value).match(/([1-4])/);
  return match ? String(match[1]) : normalizeText(value);
}

const NAK_COMPAT = {
  Rohini: { Karthika: 8, Rohini: 0, Mrigashira: 7, Ashwini: 6, Swathi: 5, Vishakha: 7, Hasta: 8, Punarvasu: 6, Magha: 5, "Uttara Phalguni": 7, Chitra: 6, "Purva Ashadha": 5 },
  Ashwini: { Karthika: 7, Rohini: 6, Mrigashira: 8, Ashwini: 0, Swathi: 6, Vishakha: 8, Hasta: 7, Punarvasu: 7, Magha: 6, "Uttara Phalguni": 6, Chitra: 7, "Purva Ashadha": 6 },
  Karthika: { Karthika: 0, Rohini: 8, Mrigashira: 7, Ashwini: 7, Swathi: 6, Vishakha: 6, Hasta: 7, Punarvasu: 5, Magha: 7, "Uttara Phalguni": 8, Chitra: 6, "Purva Ashadha": 5 },
  Mrigashira: { Karthika: 7, Rohini: 7, Mrigashira: 0, Ashwini: 8, Swathi: 7, Vishakha: 6, Hasta: 8, Punarvasu: 8, Magha: 5, "Uttara Phalguni": 6, Chitra: 7, "Purva Ashadha": 7 },
};

function getNakshatraScore(leftValue, rightValue) {
  const left = normalizeNakshatraValue(leftValue);
  const right = normalizeNakshatraValue(rightValue);
  if (!left || !right) return 5;
  if (left === right) return 0;
  const row = NAK_COMPAT[left] || NAK_COMPAT[right];
  if (!row) return 5;
  return row[right] || row[left] || 5;
}

const RASHI_COMPAT = {
  Mesha: ["Simha", "Dhanu", "Mithuna", "Kumbha"],
  Vrishabha: ["Kanya", "Makara", "Karka", "Meena"],
  Mithuna: ["Tula", "Kumbha", "Mesha", "Simha"],
  Karka: ["Vrishchika", "Meena", "Vrishabha", "Kanya"],
  Simha: ["Mesha", "Dhanu", "Mithuna", "Tula"],
  Kanya: ["Vrishabha", "Makara", "Karka", "Vrishchika"],
  Tula: ["Mithuna", "Kumbha", "Simha", "Dhanu"],
  Vrishchika: ["Karka", "Meena", "Kanya", "Makara"],
  Dhanu: ["Mesha", "Simha", "Tula", "Kumbha"],
  Makara: ["Vrishabha", "Kanya", "Meena", "Vrishchika"],
  Kumbha: ["Mithuna", "Tula", "Mesha", "Dhanu"],
  Meena: ["Karka", "Vrishchika", "Vrishabha", "Makara"],
};

function getRashiScore(leftValue, rightValue) {
  const left = normalizeRashiValue(leftValue);
  const right = normalizeRashiValue(rightValue);
  if (!left || !right) return 4;
  return (RASHI_COMPAT[left] || []).includes(right) ? 10 : 4;
}

function hasKundaliEntitlement(member, settings) {
  if (!settings?.enabled) return false;
  if (member?.addons?.jathakamPurchased === true) return true;
  if (member?.kundaliPack?.active === true) return true;
  if (member?.isPaid === true) return settings.enableForPaid !== false;
  if (String(member?.tier || member?.plan || "").trim().toLowerCase() === "trial") return settings.enableForTrial !== false;
  return settings.enableForFree === true;
}

function buildKundaliSnapshot(seeker, candidate, settings) {
  const seekerGotra = normalizeGotraValue(seeker?.gotra || "");
  const candidateGotra = normalizeGotraValue(candidate?.gotra || "");
  const sameGotra = !!(seekerGotra && candidateGotra && seekerGotra === candidateGotra);
  const sameGotraPolicy = String(settings?.sameGotraPolicy || "hard").toLowerCase();
  if (sameGotra && sameGotraPolicy === "hard") {
    return { sameGotra: true, total: 0, verdict: "Blocked", label: "Same Gotra" };
  }
  const nakScore = getNakshatraScore(seeker?.nakshatra || seeker?.nak || "", candidate?.nakshatra || candidate?.nak || "");
  const rashiScore = getRashiScore(seeker?.rashi || "", candidate?.rashi || "");
  const seekerPadam = normalizePadamValue(seeker?.padam || "");
  const candidatePadam = normalizePadamValue(candidate?.padam || "");
  const padamScore = seekerPadam && candidatePadam ? (seekerPadam === candidatePadam ? 1 : 4) : 2;
  const gotraScore = sameGotra ? 0 : 6;
  const total = Math.max(0, Math.min(36, Math.round((nakScore / 10) * 16 + (rashiScore / 10) * 10 + padamScore + gotraScore)));
  let verdict = "Average";
  if (total >= 30) verdict = "Excellent";
  else if (total >= 24) verdict = "Very Good";
  else if (total >= 18) verdict = "Good";
  else if (total < 12) verdict = "Weak";
  return {
    sameGotra,
    total,
    verdict,
    label: `${total}/36 Jathakam`,
    gotraWarning: sameGotra && sameGotraPolicy === "soft",
  };
}

function getAgeFitScore(seeker, candidate) {
  const seekerAge = resolveMemberAge(seeker);
  const candidateAge = resolveMemberAge(candidate);
  if (!seekerAge || !candidateAge) return 8;
  const seekerGender = normalizeGenderValue(seeker?.gender || seeker?.profileFor || "");
  const groomOlderBy = seekerGender === "male" ? seekerAge - candidateAge : candidateAge - seekerAge;
  if (groomOlderBy >= 2 && groomOlderBy <= 5) return 15;
  if (groomOlderBy >= 0 && groomOlderBy <= 7) return 11;
  if (groomOlderBy >= -1 && groomOlderBy <= 9) return 7;
  if (Math.abs(groomOlderBy) <= 12) return 4;
  return 1;
}

function getCommunityFitScore(seeker, candidate) {
  const seekerCommunity = normalizeText(seeker?.community || seeker?.caste || "").toLowerCase();
  const candidateCommunity = normalizeText(candidate?.community || candidate?.caste || "").toLowerCase();
  if (!seekerCommunity && !candidateCommunity) return 8;
  if (!seekerCommunity || !candidateCommunity) return 6;
  if (seekerCommunity === candidateCommunity) return 15;
  if (seekerCommunity.includes(candidateCommunity) || candidateCommunity.includes(seekerCommunity)) return 11;
  return 4;
}

function getLocationFitScore(seeker, candidate) {
  const left = normalizeLocationBits(seeker);
  const right = normalizeLocationBits(candidate);
  if (!left.city && !left.state && !right.city && !right.state) return 5;
  if (left.city && right.city && left.city.toLowerCase() === right.city.toLowerCase()) return 10;
  if (left.state && right.state && left.state.toLowerCase() === right.state.toLowerCase()) return 7;
  if (left.country && right.country && left.country.toLowerCase() === right.country.toLowerCase()) return 4;
  return 2;
}

function isVerificationApproved(member, type) {
  const key = String(type || "").trim().toLowerCase();
  return member?.[`${key}Verified`] === true || member?.verificationStatus?.[key] === "verified";
}

function getTrustScore(member) {
  let score = 1;
  if (isVerificationApproved(member, "aadhaar")) score += 2;
  if (isVerificationApproved(member, "income")) score += 2;
  if (member?.phoneVerified === true || normalizePhone(member?.phone || "").length === 10) score += 1;
  return Math.min(10, score);
}

function getProfileCompletenessScore(member) {
  const fields = [
    resolveMemberAge(member),
    normalizeLocationBits(member).city,
    normalizeText(member?.community || member?.caste || ""),
    normalizeText(member?.education || member?.edu || ""),
    normalizeText(member?.profession || member?.designation || member?.job || ""),
    normalizeText(member?.salary || member?.incomeRange || member?.income || member?.businessIncome || member?.annualIncome || ""),
    normalizeText(member?.gotra || ""),
    normalizeText(member?.nakshatra || member?.nak || ""),
    normalizeText(member?.rashi || ""),
    normalizeText(member?.about || ""),
  ];
  const filled = fields.filter(Boolean).length;
  return Math.max(1, Math.min(10, Math.round((filled / fields.length) * 10)));
}

function getActivityScore(member) {
  const latest = Math.max(
    parseTimestampMs(member?.lastActiveAt),
    parseTimestampMs(member?.updatedAt),
    parseTimestampMs(member?.createdAt),
    parseTimestampMs(member?.registeredOn)
  );
  if (!latest) return 2;
  const days = Math.max(0, Math.floor((Date.now() - latest) / 86400000));
  if (days <= 7) return 5;
  if (days <= 30) return 4;
  if (days <= 90) return 3;
  return 1;
}

function normalizePhotoPrivacyMode(value) {
  const mode = normalizeText(value).toLowerCase();
  if (["search_visible", "blur_until_unlock", "hidden"].includes(mode)) return mode;
  return "search_visible";
}

function resolveMemberPhotoUrl(member) {
  return normalizeText(member?.photoUrl || member?.profilePhoto || "");
}

function getFreshnessBonus(member) {
  const latest = Math.max(
    parseTimestampMs(member?.lastActiveAt),
    parseTimestampMs(member?.updatedAt),
    parseTimestampMs(member?.createdAt),
    parseTimestampMs(member?.registeredOn)
  );
  if (!latest) return 0;
  const days = Math.max(0, Math.floor((Date.now() - latest) / 86400000));
  if (days <= 3) return 4;
  if (days <= 14) return 3;
  if (days <= 30) return 2;
  if (days <= 60) return 1;
  return 0;
}

function isMatchableMemberProfile(member) {
  const role = String(member?.role || "MEMBER").trim().toUpperCase();
  if (role !== "MEMBER") return false;
  if (!normalizeText(member?.name || "")) return false;
  const status = String(member?.status || member?.accountStatus || "").trim().toLowerCase();
  if (["blocked", "deactivated", "deleted", "inactive", "suspended"].includes(status)) return false;
  const suspendedUntilMs = Date.parse(String(member?.suspendedUntil || ""));
  if (Number.isFinite(suspendedUntilMs) && suspendedUntilMs > Date.now()) return false;
  if (!isSearchVisibleMember(member)) return false;
  return true;
}

function isSearchVisibleMember(member) {
  const visibility = String(member?.visibility || (member?.hidden === true ? "hidden" : "visible")).trim().toLowerCase();
  if (visibility && visibility !== "visible") return false;
  if (member?.hidden === true) return false;
  if (member?.searchVisible === false) return false;
  if (member?.visibleInSearch === false) return false;
  if (member?.discoverable === false) return false;
  if (member?.directoryVisible === false) return false;
  return true;
}

function isShareablePublicProfileMember(member) {
  return isMatchableMemberProfile(member) && !!normalizeProfileNumber(member?.profileNumber || "");
}

function buildVisibilityBonus(candidate) {
  let bonus = 0;
  // Only explicit boost add-ons should influence visibility; paid status alone should not.
  if (candidate?.addons?.profileBoost === true) bonus += 6;
  return Math.min(6, bonus);
}

function buildProfileQualityPercent(completenessScore, trustScore, activityScore) {
  return Math.max(45, Math.min(98, Math.round((completenessScore * 5.5) + (trustScore * 2.5) + (activityScore * 4))));
}

function isWithinPracticalAgeWindow(seeker, candidate) {
  const seekerAge = resolveMemberAge(seeker);
  const candidateAge = resolveMemberAge(candidate);
  if (!seekerAge || !candidateAge) return true;
  const seekerGender = normalizeGenderValue(seeker?.gender || seeker?.profileFor || "");
  const groomOlderBy = seekerGender === "male" ? seekerAge - candidateAge : candidateAge - seekerAge;
  return groomOlderBy >= -2 && groomOlderBy <= 12;
}

function buildMatchBaseQuery(oppositeGender) {
  return db.collection(MEMBERS_COLLECTION).where("gender", "==", oppositeGender);
}

async function runMatchPrefilterQuery(label, query) {
  try {
    return await query.get();
  } catch (error) {
    logger.warn(`memberGetMatches: ${label} prefilter query failed, falling back to broader pool`, {
      message: error?.message || String(error || ""),
    });
    return null;
  }
}

function appendMatchSnapshot(targetMap, snapshot, hardCap) {
  if (!snapshot || !Array.isArray(snapshot.docs)) return;
  for (const doc of snapshot.docs) {
    if (targetMap.size >= hardCap) break;
    if (!targetMap.has(doc.id)) {
      targetMap.set(doc.id, doc.data() || {});
    }
  }
}

async function loadMatchCandidatePool(seeker, oppositeGender, safeLimit) {
  const baseQuery = buildMatchBaseQuery(oppositeGender);
  const candidateTarget = Math.min(200, Math.max(120, safeLimit * 2));
  const focusedQueryLimit = Math.min(70, Math.max(30, Math.ceil(candidateTarget * 0.35)));
  const hardCap = candidateTarget + (focusedQueryLimit * 2);
  const queries = [];
  const seenQueryKeys = new Set();
  const addFocusedQuery = (label, field, rawValue) => {
    const value = normalizeText(rawValue);
    if (!value) return;
    const key = `${field}:${value.toLowerCase()}`;
    if (seenQueryKeys.has(key)) return;
    seenQueryKeys.add(key);
    queries.push({
      label,
      query: baseQuery.where(field, "==", value).limit(focusedQueryLimit),
    });
  };

  addFocusedQuery("city", "city", seeker?.city || "");
  addFocusedQuery("community", "community", seeker?.community || seeker?.caste || "");
  addFocusedQuery("caste", "caste", seeker?.caste || "");
  addFocusedQuery("state", "state", seeker?.state || "");

  const seekerCountry = normalizeText(seeker?.country || "");
  if (seekerCountry && seekerCountry.toLowerCase() !== "india" && !normalizeText(seeker?.state || "")) {
    addFocusedQuery("country", "country", seekerCountry);
  }

  queries.push({
    label: "broad-gender-pool",
    query: baseQuery.limit(candidateTarget),
  });

  const snapshots = await Promise.all(
    queries.map(({ label, query }) => runMatchPrefilterQuery(label, query))
  );
  const candidateMap = new Map();
  snapshots.forEach((snapshot) => appendMatchSnapshot(candidateMap, snapshot, hardCap));
  return Array.from(candidateMap.entries()).map(([uid, data]) => ({ uid, ...data }));
}

function buildMatchReasons(scoreBreakdown, candidate, kundaliAccess, kundali) {
  const reasons = [];
  const location = normalizeLocationBits(candidate);
  if (scoreBreakdown.community >= 11 && normalizeText(candidate?.community || candidate?.caste || "")) {
    reasons.push("Same community");
  }
  if (scoreBreakdown.location >= 10 && location.city) {
    reasons.push("Same city");
  } else if (scoreBreakdown.location >= 7 && location.state) {
    reasons.push("Same state");
  }
  if (scoreBreakdown.education >= 9 && normalizeText(candidate?.education || candidate?.edu || "")) {
    reasons.push("Education aligned");
  }
  if (scoreBreakdown.income >= 8 && normalizeText(candidate?.salary || candidate?.incomeRange || candidate?.income || candidate?.businessIncome || candidate?.annualIncome || "")) {
    reasons.push("Income expectations aligned");
  }
  if (scoreBreakdown.trust >= 5) {
    reasons.push("Verified profile");
  }
  if (scoreBreakdown.completeness >= 8) {
    reasons.push("Well-completed profile");
  }
  if (scoreBreakdown.activity >= 5 || scoreBreakdown.freshness >= 3) {
    reasons.push("Recently active");
  }
  if (kundaliAccess && Number(kundali?.total || 0) >= 24) {
    reasons.push("Strong kundali match");
  }
  return Array.from(new Set(reasons)).slice(0, 3);
}

function buildDiversificationGeoKey(match) {
  return normalizeText(match?.city || match?.state || match?.country || "").toLowerCase();
}

function buildDiversificationCommunityKey(match) {
  return normalizeText(match?.community || match?.caste || "").toLowerCase();
}

function sharesRecentMatchBucket(candidate, recentMatches) {
  const candidateGeo = buildDiversificationGeoKey(candidate);
  const candidateCommunity = buildDiversificationCommunityKey(candidate);
  return recentMatches.some((recentMatch) => {
    const recentGeo = buildDiversificationGeoKey(recentMatch);
    const recentCommunity = buildDiversificationCommunityKey(recentMatch);
    return Boolean(candidateGeo && recentGeo && candidateGeo === recentGeo && candidateCommunity && recentCommunity && candidateCommunity === recentCommunity);
  });
}

function diversifyRankedMatches(matches, safeLimit) {
  if (!Array.isArray(matches) || matches.length <= 4) return matches;
  const poolSize = Math.min(matches.length, Math.max(24, safeLimit * 2));
  const primaryPool = matches.slice(0, poolSize);
  const remaining = matches.slice(poolSize);
  const diversified = [];
  const usedIndexes = new Set();
  while (diversified.length < primaryPool.length) {
    const recentMatches = diversified.slice(-3);
    let pickedIndex = -1;
    for (let i = 0; i < primaryPool.length; i += 1) {
      if (usedIndexes.has(i)) continue;
      if (!recentMatches.length || !sharesRecentMatchBucket(primaryPool[i], recentMatches)) {
        pickedIndex = i;
        break;
      }
    }
    if (pickedIndex === -1) {
      pickedIndex = primaryPool.findIndex((_, index) => !usedIndexes.has(index));
    }
    if (pickedIndex === -1) break;
    usedIndexes.add(pickedIndex);
    diversified.push(primaryPool[pickedIndex]);
  }
  return diversified.concat(remaining);
}

function buildMemberMatchCandidate(seeker, candidate, kundaliSettings) {
  if (!isMatchableMemberProfile(candidate)) return null;
  if (String(candidate?.uid || candidate?.id || "").trim() === String(seeker?.uid || seeker?.id || "").trim()) return null;
  const oppositeGender = getOppositeGenderValue(seeker?.gender || seeker?.profileFor || "");
  const candidateGender = normalizeGenderValue(candidate?.gender || candidate?.profileFor || "");
  if (!oppositeGender || candidateGender !== oppositeGender) return null;

  const kundaliAccess = hasKundaliEntitlement(seeker, kundaliSettings);
  const kundali = buildKundaliSnapshot(seeker, candidate, kundaliSettings);
  if (kundali.sameGotra && (String(kundaliSettings?.sameGotraPolicy || "hard").toLowerCase() === "hard" || seeker?.addons?.gotraBlock === true)) {
    return null;
  }

  const ageScore = getAgeFitScore(seeker, candidate);
  const communityScore = getCommunityFitScore(seeker, candidate);
  const locationScore = getLocationFitScore(seeker, candidate);
  const educationScore = getEducationFitScore(seeker, candidate);
  const incomeScore = getIncomeFitScore(seeker, candidate);
  const completenessScore = getProfileCompletenessScore(candidate);
  const activityScore = getActivityScore(candidate);
  const freshnessBonus = getFreshnessBonus(candidate);
  const trustScore = getTrustScore(candidate);
  const kundaliScore = kundaliAccess ? Math.max(2, Math.round((kundali.total / 36) * 10)) : 0;
  let baseScore = 0;
  if (kundaliAccess) {
    baseScore = ageScore + communityScore + locationScore + educationScore + incomeScore + completenessScore + activityScore + trustScore + kundaliScore;
  } else {
    baseScore =
      Math.round((ageScore / 15) * 20) +
      Math.round((communityScore / 15) * 20) +
      Math.round((locationScore / 10) * 15) +
      Math.round((educationScore / 10) * 15) +
      Math.round((incomeScore / 10) * 10) +
      completenessScore +
      activityScore +
      Math.round((trustScore / 10) * 5);
  }
  const visibilityBonus = buildVisibilityBonus(candidate);
  const finalScore = Math.max(1, Math.min(100, baseScore + freshnessBonus + visibilityBonus));
  const location = normalizeLocationBits(candidate);
  const readiness = buildProfileQualityPercent(completenessScore, trustScore, activityScore);
  const salaryText = normalizeText(candidate?.salary || candidate?.incomeRange || candidate?.income || candidate?.businessIncome || candidate?.annualIncome || "");
  const age = resolveMemberAge(candidate);
  const photoPrivacyMode = normalizePhotoPrivacyMode(candidate?.photoPrivacyMode || candidate?.photoVisibilityMode || candidate?.privacySettings?.photoMode || "");
  const searchPhotoUrl = photoPrivacyMode === "search_visible" ? resolveMemberPhotoUrl(candidate) : "";
  const scoreBreakdown = {
    age: ageScore,
    community: communityScore,
    location: locationScore,
    education: educationScore,
    income: incomeScore,
    completeness: completenessScore,
    activity: activityScore,
    freshness: freshnessBonus,
    trust: trustScore,
    kundali: kundaliScore,
    boost: visibilityBonus,
  };
  const matchReasons = buildMatchReasons(scoreBreakdown, candidate, kundaliAccess, kundali);
  return {
    id: String(candidate?.uid || candidate?.id || "").trim(),
    uid: String(candidate?.uid || candidate?.id || "").trim(),
    profileNumber: normalizeProfileNumber(candidate?.profileNumber || ""),
    n: normalizeText(candidate?.name || ""),
    age: age || "",
    city: [location.city, location.state].filter(Boolean).join(", ") || location.country || "India",
    state: location.state,
    country: location.country || "India",
    job: normalizeText(candidate?.profession || candidate?.designation || candidate?.job || ""),
    profession: normalizeText(candidate?.profession || candidate?.designation || candidate?.job || ""),
    edu: normalizeText(candidate?.education || candidate?.edu || ""),
    education: normalizeText(candidate?.education || candidate?.edu || ""),
    aadhaar: isVerificationApproved(candidate, "aadhaar"),
    income: isVerificationApproved(candidate, "income"),
    aadhaarVerified: isVerificationApproved(candidate, "aadhaar"),
    incomeVerified: isVerificationApproved(candidate, "income"),
    gotra: normalizeText(candidate?.gotra || ""),
    nak: normalizeNakshatraValue(candidate?.nakshatra || candidate?.nak || ""),
    nakshatra: normalizeNakshatraValue(candidate?.nakshatra || candidate?.nak || ""),
    rashi: normalizeRashiValue(candidate?.rashi || ""),
    padam: normalizePadamValue(candidate?.padam || ""),
    online: activityScore >= 4,
    respRate: readiness,
    compat: finalScore,
    mutual: false,
    featured: visibilityBonus > 0,
    boostBonus: visibilityBonus,
    icon: candidateGender === "female" ? "👩" : "👨",
    gender: candidateGender,
    psychoType: normalizeText(candidate?.psychoType || ""),
    salary: salaryText,
    incomeRange: salaryText,
    height: normalizeText(candidate?.height || ""),
    community: normalizeText(candidate?.community || candidate?.caste || ""),
    caste: normalizeText(candidate?.caste || ""),
    photoUrl: searchPhotoUrl,
    photoPrivacyMode,
    photoVisibilityLabel: photoPrivacyMode === "hidden"
      ? "Photo hidden in search"
      : photoPrivacyMode === "blur_until_unlock"
        ? "Photo unlock required"
        : "",
    sharePhoneAfterUnlock: candidate?.sharePhoneAfterUnlock !== false,
    shareEmailAfterUnlock: candidate?.shareEmailAfterUnlock !== false,
    kundali,
    updatedAt: candidate?.updatedAt || candidate?.createdAt || candidate?.registeredOn || "",
    matchReasons,
    matchSummary: matchReasons.join(" · "),
    scoreBreakdown,
  };
}

async function readAgentByRef(agentRefId) {
  const normalizedRef = normalizeAgentRefId(agentRefId);
  if (!normalizedRef) return null;
  const doc = await db.collection(APP_STATE_COLLECTION).doc(AGENT_DIRECTORY_KEY).get();
  const list = doc.exists && Array.isArray(doc.data()?.value) ? doc.data().value : [];
  return list.find((agent) => normalizeAgentRefId(agent?.refId || agent?.agentRefId || "") === normalizedRef) || null;
}

async function verifyAuthenticatedUser(req) {
  const authHeader = String(req.headers.authorization || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("Authentication required.");
    error.status = 401;
    throw error;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (err) {
    const error = new Error("Invalid authentication token.");
    error.status = 401;
    throw error;
  }
}

async function assignProfileNumberIfMissingServer(uid) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) return "";
  const memberRef = db.collection(MEMBERS_COLLECTION).doc(cleanUid);
  const counterRef = db.collection(COUNTERS_COLLECTION).doc(PROFILE_NUMBER_COUNTER_ID);
  return db.runTransaction(async (transaction) => {
    const memberSnap = await transaction.get(memberRef);
    if (!memberSnap.exists) return "";
    const existing = normalizeProfileNumber(memberSnap.data()?.profileNumber || "");
    if (existing) return existing;
    const counterSnap = await transaction.get(counterRef);
    const nextValue = Math.max(100001, parseInt(counterSnap.data()?.nextValue ?? 100001, 10) || 100001);
    const profileNumber = profileNumberFromCounter(nextValue);
    transaction.set(counterRef, {
      nextValue: nextValue + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(memberRef, {
      profileNumber,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return profileNumber;
  });
}

async function enforceLookupRateLimit(uid) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) {
    const error = new Error("Authentication required.");
    error.status = 401;
    throw error;
  }
  const now = Date.now();
  const windowStart = now - (now % LOOKUP_RATE_LIMIT_WINDOW_MS);
  const rateRef = db.collection(LOOKUP_RATE_LIMIT_COLLECTION).doc(cleanUid);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(rateRef);
    const data = snap.exists ? (snap.data() || {}) : {};
    const currentWindow = Number(data.windowStart || 0);
    const currentCount = Number(data.count || 0);
    if (currentWindow === windowStart && currentCount >= LOOKUP_RATE_LIMIT_MAX) {
      const error = new Error("Lookup limit reached. You can search up to 10 P numbers per hour.");
      error.status = 429;
      error.code = "public-profile-rate-limited";
      throw error;
    }
    const nextCount = currentWindow === windowStart ? currentCount + 1 : 1;
    transaction.set(rateRef, {
      uid: cleanUid,
      windowStart,
      count: nextCount,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function initializeMemberProfileForUid(uid, payload, authUserRecord) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) return null;
  const memberRef = db.collection(MEMBERS_COLLECTION).doc(cleanUid);
  const trial = await readTrialSettings();
  const authSettings = await readAuthSettings();
  const registeredOn = nowIso();
  const safePhone = normalizePhone(authUserRecord?.phoneNumber || payload?.phone || "");
  const safeEmail = String(authUserRecord?.email || payload?.email || "").trim().toLowerCase();
  const safeAgentRefId = normalizeAgentRefId(payload?.agentRefId || "");
  const matchedAgent = safeAgentRefId ? await readAgentByRef(safeAgentRefId) : null;
  const msg91AccessToken = String(payload?.msg91AccessToken || payload?.accessToken || "").trim();
  const requiresSignupOtp = authSettings.enabled && authSettings.mode !== "firebase-password" && authSettings.requireSignupOtp === true;
  let phoneVerified = false;
  let phoneVerificationProvider = "";
  let phoneVerifiedAt = "";

  if (safePhone && msg91AccessToken) {
    const providerPayload = await verifyMsg91AccessTokenWithProvider(msg91AccessToken);
    const verifiedPhone = extractVerifiedPhone(providerPayload);
    if (!verifiedPhone) {
      const error = new Error("Unable to confirm the verified mobile number from MSG91.");
      error.status = 502;
      throw error;
    }
    if (verifiedPhone !== safePhone) {
      const error = new Error("The verified OTP mobile number does not match the registration mobile number.");
      error.status = 409;
      throw error;
    }
    phoneVerified = true;
    phoneVerificationProvider = "msg91";
    phoneVerifiedAt = registeredOn;
  } else if (requiresSignupOtp && safePhone) {
    const error = new Error("Complete mobile OTP verification before creating this account.");
    error.status = 400;
    throw error;
  }

  const member = {
    id: cleanUid,
    uid: cleanUid,
    name: String(payload?.name || authUserRecord?.displayName || "").trim(),
    phone: safePhone,
    email: safeEmail,
    profileFor: String(payload?.profileFor || "").trim(),
    gender: String(payload?.gender || "").trim(),
    plan: "trial",
    tier: "trial",
    pendingPlan: String(payload?.pendingPlan || "").trim(),
    isPaid: false,
    profileNumber: "",
    registeredOn,
    trialDurationDays: trial.durationDays,
    trialEndsOn: new Date(Date.parse(registeredOn) + trial.durationDays * 86400000).toISOString(),
    connects: trial.trialConnects,
    connectsMax: trial.trialConnects,
    role: "MEMBER",
    createdAt: registeredOn,
    updatedAt: registeredOn,
    ...(phoneVerified ? {
      phoneVerified,
      phoneVerificationProvider,
      phoneVerifiedAt,
    } : {}),
    ...(safeAgentRefId ? {
      agentRefId: safeAgentRefId,
      referredByAgentRefId: safeAgentRefId,
      referredByAgentName: String(matchedAgent?.name || "").trim(),
      referredByAgentCity: String(matchedAgent?.city || "").trim(),
      referredByAgentTier: String(matchedAgent?.tier || "").trim(),
      referredByAgentMobile: normalizePhone(matchedAgent?.mobile || ""),
      agentReferralStatus: matchedAgent ? "matched" : "unverified",
      referredAt: registeredOn,
    } : {}),
  };
  await db.runTransaction(async (transaction) => {
    const existingMemberSnap = await transaction.get(memberRef);
    if (existingMemberSnap.exists) return;
    if (safePhone) {
      const phoneIndexRef = db.collection(PHONE_INDEX_COLLECTION).doc(safePhone);
      const existingPhoneIndex = await transaction.get(phoneIndexRef);
      if (existingPhoneIndex.exists && String(existingPhoneIndex.data()?.uid || "") !== cleanUid) {
        const error = new Error("Mobile already registered. Sign in instead.");
        error.status = 409;
        error.code = "PHONE_ALREADY_REGISTERED";
        throw error;
      }
      transaction.set(phoneIndexRef, {
        uid: cleanUid,
        email: safeEmail,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    transaction.set(memberRef, member, { merge: true });
  });
  const profileNumber = await assignProfileNumberIfMissingServer(cleanUid);
  const latest = await memberRef.get();
  const latestData = latest.data() || {};
  return { id: cleanUid, ...latestData, profileNumber: profileNumber || latestData.profileNumber || "" };
}

async function syncMemberToPublicProfile(memberData) {
  const profileDoc = buildPublicProfileDoc(memberData);
  if (!profileDoc || !profileDoc.profileNumber) {
    await deletePublicProfileByNumber(memberData?.profileNumber || "");
    return;
  }
  await db
    .collection(PUBLIC_PROFILES_COLLECTION)
    .doc(profileDoc.profileNumber)
    .set(profileDoc);
}

async function deletePublicProfileByNumber(profileNumber) {
  const normalized = normalizeProfileNumber(profileNumber);
  if (!normalized) return;
  await db.collection(PUBLIC_PROFILES_COLLECTION).doc(normalized).delete();
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickAllowedOrigin(origin) {
  const allowedOrigins = splitCsv(process.env.MSG91_ALLOWED_ORIGINS);
  const normalizedOrigin = String(origin || "").trim();
  if (!normalizedOrigin) return "";
  if (!allowedOrigins.length) {
    // Safe built-in origins for live Hosting plus local development.
    const safeOrigins = [
      "https://parichayam-9ee09.web.app",
      "https://parichayam-9ee09.firebaseapp.com",
      "https://parichayam.co.in",
      "https://www.parichayam.co.in",
      "http://localhost:3000",
      "http://localhost:4000",
      "http://localhost:5000",
      "http://localhost:5173",
      "http://localhost:5500",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:4000",
      "http://127.0.0.1:5000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5500",
    ];
    return safeOrigins.includes(normalizedOrigin) ? normalizedOrigin : "";
  }
  return allowedOrigins.includes(normalizedOrigin) ? normalizedOrigin : "";
}

function setCorsHeaders(req, res) {
  const origin = pickAllowedOrigin(req.headers.origin);
  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Vary", "Origin");
}

function sendJson(req, res, status, payload) {
  setCorsHeaders(req, res);
  res.status(status).json(payload);
}

function extractClientIp(req) {
  const resolved = String(req.ip || req.socket?.remoteAddress || "").trim();
  return (resolved.split(",")[0] || "").trim() || "unknown";
}

function normalizeRateKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, "_")
    .slice(0, 80) || "unknown";
}

function cleanSingleLine(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength || 500);
}

function cleanLongText(value, maxLength) {
  return String(value || "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, maxLength || 2000);
}

function isValidSupportEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function enforceAuthRateLimit(scope, key, limit, windowMs, message) {
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const docId = `${normalizeRateKeyPart(scope)}:${normalizeRateKeyPart(key)}:${windowStart}`;
  const ref = db.collection(AUTH_RATE_LIMIT_COLLECTION).doc(docId);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const count = Number(data.count || 0);
    if (count >= limit) {
      const error = new Error(message || "Too many requests. Please try again later.");
      error.status = 429;
      throw error;
    }
    transaction.set(ref, {
      scope,
      key: String(key || ""),
      count: count + 1,
      windowStart,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

function firebaseAuthApiKey() {
  return String(process.env.PARICHAYAM_FIREBASE_WEB_API_KEY || "").trim();
}

function razorpayKeyId() {
  return String(process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID || "").trim();
}

function razorpayKeySecret() {
  return String(process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET || "").trim();
}

function razorpayWebhookSecret() {
  return String(process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_TEST_WEBHOOK_SECRET || "").trim();
}

function isRazorpayTestMode() {
  return /^rzp_test_/i.test(razorpayKeyId());
}

function isRazorpayConfigured() {
  return !!(razorpayKeyId() && razorpayKeySecret());
}

async function readMembershipPricing() {
  const doc = await db.collection(APP_STATE_COLLECTION).doc("parichayam_plan_prices").get();
  const value = doc.exists ? (doc.data()?.value || {}) : {};
  const merged = { ...DEFAULT_MEMBERSHIP_PRICES };
  Object.keys(merged).forEach((plan) => {
    const parsed = parseInt(value?.[plan], 10);
    if (Number.isFinite(parsed) && parsed > 0) merged[plan] = parsed;
  });
  return merged;
}

async function readVerificationSettings() {
  const doc = await db.collection(APP_STATE_COLLECTION).doc("parichayam_verification_settings").get();
  const value = doc.exists ? (doc.data()?.value || {}) : {};
  return {
    ...DEFAULT_VERIFICATION_SETTINGS,
    ...value,
    aadhaarFee: Math.max(0, parseInt(value?.aadhaarFee ?? DEFAULT_VERIFICATION_SETTINGS.aadhaarFee, 10) || DEFAULT_VERIFICATION_SETTINGS.aadhaarFee),
    incomeFee: Math.max(0, parseInt(value?.incomeFee ?? DEFAULT_VERIFICATION_SETTINGS.incomeFee, 10) || DEFAULT_VERIFICATION_SETTINGS.incomeFee),
    turnaroundHours: Math.max(1, parseInt(value?.turnaroundHours ?? DEFAULT_VERIFICATION_SETTINGS.turnaroundHours, 10) || DEFAULT_VERIFICATION_SETTINGS.turnaroundHours),
    reminderHours: Math.max(1, parseInt(value?.reminderHours ?? DEFAULT_VERIFICATION_SETTINGS.reminderHours, 10) || DEFAULT_VERIFICATION_SETTINGS.reminderHours),
    enabled: value?.enabled !== false,
  };
}

function normalizeMembershipPlan(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  return ["1mo", "3mo", "6mo", "annual"].includes(normalized) ? normalized : "";
}

function normalizeVerificationType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return ["aadhaar", "income"].includes(normalized) ? normalized : "";
}

function computeMembershipTotal(plan, pricing) {
  const base = Number(pricing?.[plan] || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return base + Math.round(base * 0.18);
}

function revenueTimestampFromMs(ms) {
  return Timestamp.fromDate(new Date(ms));
}

function roundMoney(value) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.round(numberValue * 100) / 100;
}

function isFunctionsEmulatorRuntime() {
  return process.env.FUNCTIONS_EMULATOR === "true" ||
    process.env.PARICHAYAM_EMULATOR_REFUND_FALLBACK === "true";
}

function safeRevenueEventId(prefix, value) {
  const clean = String(value || Date.now())
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || String(Date.now());
  return `${prefix}_${clean}`;
}

function resolvePlanDurationDays(plan, planName) {
  const normalizedPlan = normalizeMembershipPlan(plan || "");
  if (MEMBERSHIP_PLAN_DURATION_DAYS[normalizedPlan]) return MEMBERSHIP_PLAN_DURATION_DAYS[normalizedPlan];
  const label = String(planName || "").trim().toLowerCase();
  if (label.includes("annual") || label.includes("year")) return 365;
  if (label.includes("6")) return 180;
  if (label.includes("3")) return 90;
  if (label.includes("1")) return 30;
  return 30;
}

function normalizeRevenueMemberTier(memberData, planName) {
  const source = `${memberData?.memberTier || ""} ${memberData?.tier || ""} ${planName || memberData?.planName || ""}`;
  const upper = source.toUpperCase();
  if (upper.includes("ELITE")) return "ELITE";
  if (upper.includes("ASSISTED")) return "ASSISTED";
  if (upper.includes("PREMIUM") || upper.includes("PAID")) return "PREMIUM";
  return "BASIC";
}

function computeRevenueBasePrice(chargeAmount, orderData, memberData) {
  const direct = Number(orderData?.basePrice ?? orderData?.baseAmountInr ?? memberData?.basePrice ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const amount = Number(chargeAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount / 1.18);
}

async function resolveRevenueAgentForMember(memberData, transaction) {
  const directAgentId = String(
    memberData?.referredByAgentUid ||
    memberData?.agentUid ||
    memberData?.agentId ||
    ""
  ).trim();
  if (directAgentId) {
    const agentRef = db.collection(AGENTS_COLLECTION).doc(directAgentId);
    const agentSnap = transaction ? await transaction.get(agentRef) : await agentRef.get();
    if (agentSnap.exists) {
      const agentData = agentSnap.data() || {};
      return {
        id: agentSnap.id,
        data: await attachAgentTierSnapshot(agentSnap.id, agentData, transaction),
        referralCode: String(agentData?.referralCode || ""),
      };
    }
  }

  const referralCode = normalizeAgentRefId(memberData?.referredByAgentRefId || memberData?.agentRefId || "");
  if (!referralCode) return { id: "", data: null, referralCode: "" };

  const query = db.collection(AGENTS_COLLECTION).where("referralCode", "==", referralCode).limit(1);
  const snap = transaction ? await transaction.get(query) : await query.get();
  if (snap.empty) return { id: "", data: null, referralCode };
  const doc = snap.docs[0];
  return { id: doc.id, data: await attachAgentTierSnapshot(doc.id, doc.data() || {}, transaction), referralCode };
}

function buildMembershipRevenueEvents(params) {
  const memberId = String(params.memberId || "").trim();
  const memberData = params.memberData || {};
  const orderData = params.orderData || {};
  const orderId = String(params.orderId || orderData.razorpayOrderId || "").trim();
  const paymentId = String(params.paymentId || "").trim();
  const agentInfo = params.agentInfo || { id: "", referralCode: "" };
  const chargeAmount = Math.max(0, Math.round(Number(orderData.amountInr || memberData.lastPaymentAmount || 0)));
  const plan = normalizeMembershipPlan(orderData.plan || memberData.plan || memberData.pendingPlan || "");
  const planName = String(orderData.planName || memberData.planName || plan || "").trim();
  const planDurationDays = resolvePlanDurationDays(plan, planName);
  const paidAtMs = parseTimestampMs(memberData.paidAt || memberData.lastPaymentAt) || Date.now();
  const lockExpiresMs = paidAtMs + REVENUE_LOCK_MS;
  const lockExpiresAt = revenueTimestampFromMs(lockExpiresMs);
  const isLocked = lockExpiresMs > Date.now();
  const agentId = String(agentInfo.id || "").trim();
  const agentCommissionRate = agentId ? getAgentCommissionRateForRevenue(agentInfo.data || {}) : 0;
  const agentCommissionAmount = agentId ? roundMoney(chargeAmount * agentCommissionRate) : 0;
  const basePrice = computeRevenueBasePrice(chargeAmount, orderData, memberData);
  const discountApplied = Math.max(0, Math.round(Number(orderData.discountApplied || memberData.discountApplied || 0)));
  const memberTier = normalizeRevenueMemberTier(memberData, planName);
  const metadata = {
    memberTier,
    planDurationDays,
    basePrice,
    discountApplied,
    paymentGateway: "razorpay",
    notes: String(params.notes || `Membership activated for ${memberData.name || memberData.fullName || memberId}`),
    memberPaymentAmount: chargeAmount,
    agentTierName: String(agentInfo.data?.currentTier || agentInfo.data?.commissionTier || ""),
    ...(params.ipAddress ? { ipAddress: String(params.ipAddress) } : {}),
    ...(agentInfo.referralCode ? { agentReferralCode: String(agentInfo.referralCode) } : {}),
  };

  const membershipEventId = safeRevenueEventId("membership_paid", paymentId || orderId || memberId);
  const membershipEvent = {
    eventType: "membership_paid",
    memberId,
    amount: chargeAmount,
    currency: "INR",
    orderId,
    paymentId,
    agentId,
    agentCommissionRate,
    agentCommissionAmount,
    refundReason: "",
    relatedEventId: "",
    lockExpiresAt,
    isLocked,
    createdAt: params.createdAt || FieldValue.serverTimestamp(),
    createdBy: String(params.createdBy || "system"),
    metadata,
    status: "recorded",
    version: REVENUE_SCHEMA_VERSION,
  };

  const commissionEventId = agentCommissionAmount > 0 ? safeRevenueEventId("agent_commission", paymentId || orderId || memberId) : "";
  const commissionEvent = commissionEventId ? {
    ...membershipEvent,
    eventType: "agent_commission",
    amount: agentCommissionAmount,
    relatedEventId: membershipEventId,
    commissionUnlockNotifyAt: lockExpiresAt,
    commissionUnlockedNotifiedAt: null,
  } : null;

  return { membershipEventId, membershipEvent, commissionEventId, commissionEvent };
}

async function createRazorpayRefund(paymentId, amountInRupees, notes) {
  if (isFunctionsEmulatorRuntime() || (isRazorpayTestMode() && process.env.PARICHAYAM_TEST_REFUND_FALLBACK === "true")) {
    const error = new Error("Razorpay refund skipped in emulator; ledger fallback is active.");
    error.status = 502;
    throw error;
  }
  const amountInPaise = Math.max(1, Math.round(Number(amountInRupees || 0) * 100));
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: amountInPaise,
      notes: notes || {},
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    const error = new Error(payload?.error?.description || "Unable to issue Razorpay refund.");
    error.status = 502;
    throw error;
  }
  return payload;
}

async function createRazorpayOrder(params) {
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString("base64")}`,
    },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    const error = new Error(payload?.error?.description || "Unable to create payment order.");
    error.status = 502;
    throw error;
  }
  return payload;
}

async function fetchRazorpayJson(path) {
  if (!isRazorpayConfigured()) {
    const error = new Error("Razorpay credentials are not configured.");
    error.status = 503;
    throw error;
  }
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const response = await fetch(`https://api.razorpay.com/v1/${cleanPath}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString("base64")}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.description || "Unable to read Razorpay payment status.");
    error.status = 502;
    throw error;
  }
  return payload;
}

async function fetchRazorpayPayment(paymentId) {
  const id = String(paymentId || "").trim();
  if (!id) return null;
  return fetchRazorpayJson(`payments/${encodeURIComponent(id)}`);
}

async function fetchRazorpayOrderPayments(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return [];
  const payload = await fetchRazorpayJson(`orders/${encodeURIComponent(id)}/payments`);
  return Array.isArray(payload?.items) ? payload.items : [];
}

function isCapturedRazorpayPayment(payment) {
  const status = String(payment?.status || "").toLowerCase();
  return status === "captured" || payment?.captured === true;
}

function razorpayPaymentMatchesOrder(payment, orderData, orderId) {
  if (!payment) return false;
  const expectedOrderId = String(orderId || orderData?.razorpayOrderId || "").trim();
  const paymentOrderId = String(payment.order_id || payment.orderId || "").trim();
  if (expectedOrderId && paymentOrderId && paymentOrderId !== expectedOrderId) return false;
  const expectedCurrency = String(orderData?.currency || "INR").toUpperCase();
  const paymentCurrency = String(payment.currency || "INR").toUpperCase();
  if (paymentCurrency !== expectedCurrency) return false;
  const expectedPaise = Math.max(0, Math.round(Number(orderData?.amountInr || 0) * 100));
  const actualPaise = Math.max(0, Math.round(Number(payment.amount || 0)));
  return !expectedPaise || expectedPaise === actualPaise;
}

async function findCapturedRazorpayPayment(orderId, orderData, preferredPaymentId) {
  const preferredId = String(preferredPaymentId || "").trim();
  if (preferredId) {
    const payment = await fetchRazorpayPayment(preferredId);
    if (isCapturedRazorpayPayment(payment) && razorpayPaymentMatchesOrder(payment, orderData, orderId)) return payment;
  }
  const payments = await fetchRazorpayOrderPayments(orderId);
  return payments.find((payment) => (
    isCapturedRazorpayPayment(payment) &&
    razorpayPaymentMatchesOrder(payment, orderData, orderId)
  )) || null;
}

function paymentRetryDelayMs(retryCount) {
  const attempt = Math.max(0, Math.min(6, Number(retryCount || 0)));
  return Math.round(Math.min(6 * 60, Math.pow(2, attempt) * 5) * 60 * 1000);
}

function serializeAdminDoc(doc) {
  return { id: doc.id, ...(doc.data() || {}) };
}

async function writeAdminAlert(params) {
  const type = String(params?.type || "payment_alert").trim();
  const relatedId = String(params?.relatedId || params?.paymentId || params?.orderId || Date.now()).trim();
  const ref = db.collection(ADMIN_ALERTS_COLLECTION).doc(safeRevenueEventId(type, `${relatedId}_${Date.now()}`));
  await ref.set({
    type,
    severity: String(params?.severity || "warning").trim(),
    title: String(params?.title || "Payment attention required").trim(),
    message: String(params?.message || "").trim(),
    status: "open",
    source: String(params?.source || "system").trim(),
    memberId: String(params?.memberId || params?.uid || "").trim(),
    orderId: String(params?.orderId || "").trim(),
    paymentId: String(params?.paymentId || "").trim(),
    relatedCollection: String(params?.relatedCollection || "").trim(),
    relatedId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return ref.id;
}

async function writePendingActivation(params) {
  const paymentId = String(params?.paymentId || "").trim();
  const orderId = String(params?.orderId || "").trim();
  if (!paymentId || !orderId) {
    const error = new Error("Pending activation requires paymentId and orderId.");
    error.status = 400;
    throw error;
  }
  const ref = db.collection(PENDING_ACTIVATIONS_COLLECTION).doc(paymentId);
  const orderSnap = await db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderId).get();
  const orderData = orderSnap.exists ? (orderSnap.data() || {}) : {};
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists ? (snap.data() || {}) : {};
    const retryCount = Math.max(0, Number(existing.retryCount || 0));
    const status = String(existing.status || "").toLowerCase() === "completed" ? "completed" : "pending";
    const payload = {
      uid: String(params.uid || orderData.uid || "").trim(),
      orderId,
      paymentId,
      signature: String(params.signature || existing.signature || "").trim(),
      purchaseType: String(orderData.purchaseType || params.purchaseType || "").trim(),
      amountInr: Number(orderData.amountInr || params.amountInr || 0),
      currency: String(orderData.currency || params.currency || "INR").trim(),
      status,
      retryCount,
      nextRetryAt: Timestamp.fromDate(new Date(Date.now() + paymentRetryDelayMs(retryCount))),
      lastError: String(params.error?.message || params.lastError || "").slice(0, 500),
      source: String(params.source || "payment_verification").trim(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!snap.exists) payload.createdAt = FieldValue.serverTimestamp();
    transaction.set(ref, payload, { merge: true });
  });
  return ref.id;
}

async function activateVerifiedPurchase(params) {
  const uid = String(params?.uid || "").trim();
  const orderId = String(params?.orderId || "").trim();
  const paymentId = String(params?.paymentId || "").trim();
  const signature = String(params?.signature || "").trim();
  if (!uid || !orderId || !paymentId) {
    const error = new Error("Payment activation payload is incomplete.");
    error.status = 400;
    throw error;
  }
  if (!params?.skipSignature && !signature) {
    const error = new Error("Payment verification payload is incomplete.");
    error.status = 400;
    throw error;
  }

  const orderRef = db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderId);
  const memberRef = db.collection(MEMBERS_COLLECTION).doc(uid);
  const paymentRef = db.collection(PAYMENTS_COLLECTION).doc(paymentId);
  const pendingRef = params?.pendingActivationId
    ? db.collection(PENDING_ACTIVATIONS_COLLECTION).doc(String(params.pendingActivationId))
    : null;
  let responsePayload = null;

  await db.runTransaction(async (transaction) => {
    const reads = [transaction.get(orderRef), transaction.get(memberRef), transaction.get(paymentRef)];
    if (pendingRef) reads.push(transaction.get(pendingRef));
    const [orderSnap, memberSnap, existingPaymentSnap] = await Promise.all(reads);
    if (!orderSnap.exists) {
      const err = new Error("Payment order not found.");
      err.status = 404;
      throw err;
    }
    if (!memberSnap.exists) {
      const err = new Error("Member profile not found.");
      err.status = 404;
      throw err;
    }
    const orderData = orderSnap.data() || {};
    if (String(orderData.uid || "") !== uid) {
      const err = new Error("Order does not belong to this user.");
      err.status = 403;
      throw err;
    }
    const memberData = memberSnap.data() || {};
    if (existingPaymentSnap.exists || String(orderData.status || "").toLowerCase() === "paid") {
      if (pendingRef) {
        transaction.set(pendingRef, {
          status: "completed",
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastRetrySource: String(params.source || "status_check"),
        }, { merge: true });
      }
      responsePayload = {
        ok: true,
        alreadyProcessed: true,
        purchaseType: String(orderData.purchaseType || "membership"),
        member: { uid, ...memberData },
      };
      return;
    }
    if (!params?.skipSignature && !verifyRazorpaySignature(orderId, paymentId, signature)) {
      const err = new Error("Payment verification failed.");
      err.status = 400;
      throw err;
    }

    const purchaseType = String(orderData.purchaseType || "membership").trim().toLowerCase();
    if (purchaseType === "membership") {
      const paidAt = nowIso();
      const agentInfo = await resolveRevenueAgentForMember(memberData, transaction);
      const updatedMember = {
        plan: String(orderData.plan || memberData.pendingPlan || "paid"),
        planName: String(params.requestBody?.planName || orderData.planName || orderData.plan || ""),
        tier: "paid",
        isPaid: true,
        pendingPlan: "",
        pendingPaymentOrderId: "",
        lastOrderId: orderId,
        lastPaymentId: paymentId,
        lastPaymentAt: paidAt,
        lastPaymentAmount: Number(orderData.amountInr || 0),
        paymentGateway: "razorpay",
        paymentCurrency: String(orderData.currency || "INR"),
        paymentStatus: "paid",
        paidAt,
        updatedAt: FieldValue.serverTimestamp(),
      };
      const revenueEvents = buildMembershipRevenueEvents({
        memberId: uid,
        memberData: { ...memberData, ...updatedMember },
        orderData,
        orderId,
        paymentId,
        agentInfo,
        ipAddress: params.ipAddress || "",
        createdBy: "system",
      });
      transaction.set(memberRef, updatedMember, { merge: true });
      transaction.create(
        db.collection(REVENUE_EVENTS_COLLECTION).doc(revenueEvents.membershipEventId),
        revenueEvents.membershipEvent
      );
      if (revenueEvents.commissionEvent) {
        transaction.create(
          db.collection(REVENUE_EVENTS_COLLECTION).doc(revenueEvents.commissionEventId),
          revenueEvents.commissionEvent
        );
      }
      responsePayload = {
        ok: true,
        purchaseType: "membership",
        member: {
          uid,
          ...memberData,
          ...updatedMember,
          updatedAt: nowIso(),
        },
      };
    } else if (purchaseType === "verification") {
      const requestId = String(orderData.requestId || "").trim();
      const verificationType = normalizeVerificationType(orderData.verificationType || "");
      if (!requestId || !verificationType) {
        const err = new Error("Verification payment order is incomplete.");
        err.status = 400;
        throw err;
      }
      const requestRef = db.collection(VERIFICATION_REQUESTS_COLLECTION).doc(requestId);
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) {
        const err = new Error("Verification request not found.");
        err.status = 404;
        throw err;
      }
      const requestData = requestSnap.data() || {};
      if (String(requestData.memberUid || "") !== uid) {
        const err = new Error("Verification request does not belong to this user.");
        err.status = 403;
        throw err;
      }
      transaction.set(requestRef, {
        amount: Number(orderData.amountInr || 0),
        paymentStatus: "paid",
        status: "pending_review",
        paidAt: nowIso(),
        lastPaymentId: paymentId,
        lastPaymentAmount: Number(orderData.amountInr || 0),
        paymentGateway: "razorpay",
        paymentCurrency: String(orderData.currency || "INR"),
        reminderCount: 0,
        lastReminderAt: "",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      const verificationStatus = {
        ...(memberData.verificationStatus || {}),
        [verificationType]: "pending_review",
      };
      transaction.set(memberRef, {
        verificationStatus,
        lastOrderId: orderId,
        lastPaymentId: paymentId,
        paymentStatus: "paid",
        pendingPaymentOrderId: "",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      responsePayload = {
        ok: true,
        purchaseType: "verification",
        verificationRequest: {
          id: requestId,
          ...requestData,
          amount: Number(orderData.amountInr || 0),
          paymentStatus: "paid",
          status: "pending_review",
          paidAt: nowIso(),
          lastPaymentId: paymentId,
          lastPaymentAmount: Number(orderData.amountInr || 0),
          paymentGateway: "razorpay",
          paymentCurrency: String(orderData.currency || "INR"),
        },
      };
    } else {
      const err = new Error("Unsupported purchase type for payment verification.");
      err.status = 400;
      throw err;
    }

    transaction.set(orderRef, {
      status: "paid",
      paymentId,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      recoverySource: String(params.source || "member_verify"),
    }, { merge: true });
    transaction.set(paymentRef, {
      uid,
      orderId,
      paymentId,
      gateway: "razorpay",
      signature,
      purchaseType,
      plan: String(orderData.plan || ""),
      requestId: String(orderData.requestId || ""),
      verificationType: String(orderData.verificationType || ""),
      amountInr: Number(orderData.amountInr || 0),
      currency: String(orderData.currency || "INR"),
      status: "paid",
      gatewayStatus: String(params.gatewayPayment?.status || ""),
      gatewayCapturedAt: params.gatewayPayment?.created_at
        ? Timestamp.fromMillis(Number(params.gatewayPayment.created_at) * 1000)
        : null,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (pendingRef) {
      transaction.set(pendingRef, {
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastRetrySource: String(params.source || "status_check"),
      }, { merge: true });
    }
  });

  return responsePayload || { ok: true };
}

async function recordPendingActivationFailure(params) {
  const pendingActivationId = await writePendingActivation(params);
  await writeAdminAlert({
    type: "payment_activation_failed",
    severity: "critical",
    title: "Payment captured but service activation is pending",
    message: String(params.error?.message || "A payment reached Parichayam but activation failed. Retry from Payment Alerts."),
    memberId: params.uid,
    orderId: params.orderId,
    paymentId: params.paymentId,
    relatedCollection: PENDING_ACTIVATIONS_COLLECTION,
    relatedId: pendingActivationId,
    source: params.source || "member_verify",
  });
  return pendingActivationId;
}

async function retryPendingActivationDoc(doc, source) {
  const pending = doc.data() || {};
  const status = String(pending.status || "").toLowerCase();
  if (status === "completed") return { id: doc.id, skipped: true, reason: "already_completed" };
  const orderId = String(pending.orderId || "").trim();
  const paymentId = String(pending.paymentId || doc.id).trim();
  const uid = String(pending.uid || "").trim();
  if (!orderId || !paymentId || !uid) {
    await doc.ref.set({
      status: "needs_admin",
      lastError: "Pending activation is missing uid, orderId, or paymentId.",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { id: doc.id, ok: false, needsAdmin: true };
  }

  await doc.ref.set({
    status: "retrying",
    lastRetryAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    const orderSnap = await db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderId).get();
    if (!orderSnap.exists) {
      const error = new Error("Payment order is missing for pending activation.");
      error.status = 404;
      throw error;
    }
    const orderData = orderSnap.data() || {};
    const payment = await findCapturedRazorpayPayment(orderId, orderData, paymentId);
    if (!payment) {
      await doc.ref.set({
        status: "waiting_gateway",
        lastError: "No captured Razorpay payment found yet.",
        retryCount: Number(pending.retryCount || 0),
        nextRetryAt: Timestamp.fromDate(new Date(Date.now() + paymentRetryDelayMs(Number(pending.retryCount || 0)))),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { id: doc.id, ok: false, waitingGateway: true };
    }
    const result = await activateVerifiedPurchase({
      uid,
      orderId,
      paymentId: String(payment.id || paymentId),
      signature: String(pending.signature || ""),
      skipSignature: true,
      gatewayPayment: payment,
      source: source || "retry_queue",
      pendingActivationId: doc.id,
    });
    return { id: doc.id, ok: true, result };
  } catch (error) {
    const retryCount = Math.max(0, Number(pending.retryCount || 0)) + 1;
    const needsAdmin = retryCount >= 8 || (error.status && error.status < 500);
    await doc.ref.set({
      status: needsAdmin ? "needs_admin" : "retry_failed",
      retryCount,
      lastError: String(error.message || error).slice(0, 500),
      nextRetryAt: Timestamp.fromDate(new Date(Date.now() + paymentRetryDelayMs(retryCount))),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (needsAdmin) {
      await writeAdminAlert({
        type: "payment_activation_needs_admin",
        severity: "critical",
        title: "Payment activation needs manual review",
        message: String(error.message || "Retry queue could not activate a captured payment."),
        memberId: uid,
        orderId,
        paymentId,
        relatedCollection: PENDING_ACTIVATIONS_COLLECTION,
        relatedId: doc.id,
        source: source || "retry_queue",
      });
    }
    return { id: doc.id, ok: false, error: error.message || String(error), needsAdmin };
  }
}

async function runPaymentReconciliation(params = {}) {
  const limit = Math.max(1, Math.min(200, parseInt(params.limit || 100, 10) || 100));
  const source = String(params.source || "manual").trim();
  const createdSnap = await db.collection(PAYMENT_ORDERS_COLLECTION)
    .where("status", "==", "created")
    .limit(limit)
    .get();
  const result = {
    ok: true,
    source,
    scanned: 0,
    capturedFound: 0,
    activated: 0,
    pendingCreated: 0,
    skippedRecent: 0,
    errors: [],
  };
  const cutoffMs = Date.now() - (5 * 60 * 1000);
  for (const orderDoc of createdSnap.docs) {
    const order = orderDoc.data() || {};
    const createdMs = parseTimestampMs(order.createdAt);
    if (createdMs && createdMs > cutoffMs) {
      result.skippedRecent++;
      continue;
    }
    result.scanned++;
    try {
      const payment = await findCapturedRazorpayPayment(orderDoc.id, order, order.paymentId || "");
      if (!payment) continue;
      result.capturedFound++;
      const pendingId = await writePendingActivation({
        uid: String(order.uid || ""),
        orderId: orderDoc.id,
        paymentId: String(payment.id || ""),
        purchaseType: String(order.purchaseType || ""),
        amountInr: Number(order.amountInr || 0),
        currency: String(order.currency || "INR"),
        source: `reconciliation_${source}`,
        lastError: "Captured payment found during reconciliation before activation.",
      });
      result.pendingCreated++;
      const retryResult = await retryPendingActivationDoc(
        await db.collection(PENDING_ACTIVATIONS_COLLECTION).doc(pendingId).get(),
        `reconciliation_${source}`
      );
      if (retryResult.ok) result.activated++;
    } catch (error) {
      result.errors.push({
        orderId: orderDoc.id,
        message: String(error.message || error).slice(0, 300),
      });
      await writeAdminAlert({
        type: "payment_reconciliation_error",
        severity: "warning",
        title: "Payment reconciliation error",
        message: String(error.message || error),
        memberId: String(order.uid || ""),
        orderId: orderDoc.id,
        paymentId: String(order.paymentId || ""),
        source,
      });
    }
  }
  const runRef = await db.collection(PAYMENT_RECONCILIATION_RUNS_COLLECTION).add({
    ...result,
    createdAt: FieldValue.serverTimestamp(),
  });
  const reportId = new Date().toISOString().slice(0, 10);
  await db.collection(RECONCILIATION_REPORTS_COLLECTION).doc(reportId).set({
    reportDate: reportId,
    source,
    razorpayPayments: result.capturedFound,
    revenueEventsLedger: result.capturedFound - result.errors.length,
    matchedCount: result.capturedFound - result.errors.length,
    mismatches: result.errors,
    status: result.errors.length ? "review_required" : "pass",
    runId: runRef.id,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  result.runId = runRef.id;
  return result;
}

function verifyRazorpayWebhookSignature(rawBody, signature) {
  const secret = razorpayWebhookSecret();
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return expected === String(signature || "");
}

function unsignedTestWebhooksAllowed() {
  return isRazorpayTestMode() && process.env.PARICHAYAM_ALLOW_UNSIGNED_TEST_WEBHOOKS === "true";
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac("sha256", razorpayKeySecret())
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === String(signature || "");
}

function firebaseAuthRestUrl(path) {
  const apiKey = firebaseAuthApiKey();
  if (!apiKey) return "";
  return `https://identitytoolkit.googleapis.com/v1/${path}?key=${apiKey}`;
}

async function resolveEmailFromIdentifier(identifier) {
  const raw = String(identifier || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw.toLowerCase();
  const phone = normalizePhone(raw);
  if (phone.length < 10) return "";
  const phoneIndexDoc = await db.collection(PHONE_INDEX_COLLECTION).doc(phone).get();
  if (!phoneIndexDoc.exists) return "";
  const indexData = phoneIndexDoc.data() || {};
  if (indexData.email) return String(indexData.email || "").trim().toLowerCase();
  const memberUid = String(indexData.uid || "").trim();
  if (!memberUid) return "";
  const memberDoc = await db.collection(MEMBERS_COLLECTION).doc(memberUid).get();
  return memberDoc.exists ? String(memberDoc.data()?.email || "").trim().toLowerCase() : "";
}

function extractVerifiedPhone(payload) {
  const candidates = [
    payload?.phone,
    payload?.mobile,
    payload?.identifier,
    payload?.data?.phone,
    payload?.data?.mobile,
    payload?.data?.identifier,
    payload?.user?.phone,
    payload?.user?.mobile,
  ];
  const verifiedPhone = normalizePhone(candidates.find(Boolean) || "");
  return verifiedPhone;
}

async function verifyMsg91AccessTokenWithProvider(accessToken) {
  const verifyUrl = String(process.env.MSG91_VERIFY_URL || "").trim();
  const authKey = String(process.env.MSG91_AUTH_KEY || "").trim();
  if (!verifyUrl || !authKey) {
    const error = new Error("MSG91 verify URL or auth key is not configured.");
    error.status = 500;
    throw error;
  }

  const response = await fetch(verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authkey: authKey,
    },
    body: JSON.stringify({
      accessToken,
      token: accessToken,
    }),
  });

  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    payload = { raw: rawText };
  }

  if (!response.ok) {
    const upstreamError = new Error(payload?.message || "MSG91 access token verification failed.");
    upstreamError.status = response.status;
    upstreamError.payload = payload;
    throw upstreamError;
  }

  return payload;
}

exports.msg91VerifyAccessToken = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }

  try {
    const accessToken = String(req.body?.accessToken || "").trim();
    const requestedPhone = normalizePhone(req.body?.phone || "");
    const intent = String(req.body?.intent || "").trim().toLowerCase();
    const clientIp = extractClientIp(req);

    await enforceAuthRateLimit("msg91VerifyAccessToken:ip", clientIp, 40, 60 * 60 * 1000, "Too many verification attempts. Please try again later.");
    if (requestedPhone) {
      await enforceAuthRateLimit("msg91VerifyAccessToken:phone", requestedPhone, 12, 60 * 60 * 1000, "Too many verification attempts. Please try again later.");
    }

    if (!accessToken) {
      sendJson(req, res, 400, { message: "Access token is required." });
      return;
    }
    if (!["login", "signup"].includes(intent)) {
      sendJson(req, res, 400, { message: "Intent must be login or signup." });
      return;
    }

    const providerPayload = await verifyMsg91AccessTokenWithProvider(accessToken);
    const verifiedPhone = extractVerifiedPhone(providerPayload);
    if (!verifiedPhone) {
      sendJson(req, res, 502, {
        message: "MSG91 verified the token but did not return a phone number we could normalize.",
      });
      return;
    }
    if (requestedPhone && requestedPhone !== verifiedPhone) {
      sendJson(req, res, 409, {
        message: "The OTP was verified for a different phone number.",
        phone: verifiedPhone,
      });
      return;
    }

    if (intent === "signup") {
      sendJson(req, res, 200, {
        ok: true,
        verified: true,
        phone: verifiedPhone,
      });
      return;
    }

    const phoneIndexDoc = await db.collection(PHONE_INDEX_COLLECTION).doc(verifiedPhone).get();
    if (!phoneIndexDoc.exists || !phoneIndexDoc.data()?.uid) {
      sendJson(req, res, 404, {
        message: "No Parichayam account is linked to this verified mobile number yet.",
        phone: verifiedPhone,
      });
      return;
    }

    const memberUid = String(phoneIndexDoc.data().uid || "").trim();
    const memberDoc = await db.collection(MEMBERS_COLLECTION).doc(memberUid).get();
    if (!memberDoc.exists) {
      sendJson(req, res, 404, {
        message: "The member linked to this mobile number no longer exists.",
        phone: verifiedPhone,
      });
      return;
    }

    const firebaseToken = await admin.auth().createCustomToken(memberUid, {
      signInMethod: "msg91",
      phone: verifiedPhone,
    });

    sendJson(req, res, 200, {
      ok: true,
      phone: verifiedPhone,
      memberUid,
      firebaseToken,
    });
  } catch (error) {
    logger.error("msg91VerifyAccessToken failed", error);
    sendJson(req, res, error.status || 500, {
      message: error.message || "Unable to complete MSG91 verification.",
    });
  }
});

exports.findPublicProfileByNumber = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    await enforceLookupRateLimit(authUser.uid);
    const profileNumber = normalizeProfileNumber(req.body?.profileNumber || "");
    if (!profileNumber) {
      sendJson(req, res, 400, { code: "public-profile-invalid", message: "Enter a valid P number." });
      return;
    }

    const [profileSnap, visibleFields] = await Promise.all([
      db.collection(PUBLIC_PROFILES_COLLECTION).doc(profileNumber).get(),
      readVisiblePublicProfileFields(),
    ]);
    if (!profileSnap.exists) {
      sendJson(req, res, 404, { code: "public-profile-not-found", message: "No profile was found for that P number." });
      return;
    }

    const profile = sanitizePublicProfile(
      { profileNumber: profileSnap.id, ...(profileSnap.data() || {}) },
      visibleFields
    );
    if (!Object.keys(profile).length) {
      sendJson(req, res, 403, {
        code: "public-profile-not-visible",
        message: "This P number is not available for lookup right now.",
      });
      return;
    }
    sendJson(req, res, 200, { ok: true, profile, visibleFields });
  } catch (error) {
    logger.error("findPublicProfileByNumber failed", error);
    sendJson(req, res, error.status || 500, {
      code: error.code || "public-profile-unavailable",
      message: error.message || "Unable to search that P number right now.",
    });
  }
});

exports.ensureMyProfileNumber = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const profileNumber = await assignProfileNumberIfMissingServer(authUser.uid);
    if (!profileNumber) {
      sendJson(req, res, 404, { message: "Member profile was not found." });
      return;
    }
    sendJson(req, res, 200, { ok: true, profileNumber });
  } catch (error) {
    logger.error("ensureMyProfileNumber failed", error);
    sendJson(req, res, error.status || 500, {
      message: error.message || "Unable to assign profile number right now.",
    });
  }
});

exports.initializeMyMemberProfile = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const authRecord = await admin.auth().getUser(authUser.uid);
    const member = await initializeMemberProfileForUid(authUser.uid, req.body || {}, authRecord);
    if (!member) {
      sendJson(req, res, 400, { message: "Unable to initialize member profile." });
      return;
    }
    sendJson(req, res, 200, { ok: true, member });
  } catch (error) {
    logger.error("initializeMyMemberProfile failed", error);
    sendJson(req, res, error.status || 500, {
      message: error.message || "Unable to initialize member profile right now.",
      code: error.code || "",
    });
  }
});

exports.submitContactForm = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const clientIp = extractClientIp(req);
    await enforceAuthRateLimit("submitContactForm:ip", clientIp, 8, 60 * 60 * 1000, "Too many contact requests from this network. Please email support instead.");

    const body = req.body || {};
    const name = cleanSingleLine(body.name, 120);
    const email = cleanSingleLine(body.email, 180).toLowerCase();
    const phone = normalizePhone(body.phone);
    const category = cleanSingleLine(body.category, 40).toLowerCase();
    const message = cleanLongText(body.message, 2000);

    if (!name || name.length < 2) {
      sendJson(req, res, 400, { message: "Please enter your name." });
      return;
    }
    if (!isValidSupportEmail(email)) {
      sendJson(req, res, 400, { message: "Please enter a valid email address." });
      return;
    }
    if (!phone || phone.length !== 10) {
      sendJson(req, res, 400, { message: "Please enter a valid 10-digit Indian phone number." });
      return;
    }
    if (!CONTACT_FORM_CATEGORIES.has(category)) {
      sendJson(req, res, 400, { message: "Please choose a valid contact category." });
      return;
    }
    if (!message || message.length < 10) {
      sendJson(req, res, 400, { message: "Please describe the issue in at least 10 characters." });
      return;
    }

    await enforceAuthRateLimit("submitContactForm:email", email, 5, 60 * 60 * 1000, "Too many contact requests for this email. Please wait and try again.");

    const complaintRef = await db.collection(COMPLAINTS_COLLECTION).add({
      name,
      email,
      phone,
      category,
      message,
      status: "new",
      priority: category === "grievance" ? "high" : "normal",
      source: "contact_page",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ipAddress: clientIp,
      userAgent: cleanSingleLine(req.headers["user-agent"], 300),
      assignedTo: "",
      adminNotes: "",
    });

    sendJson(req, res, 200, {
      ok: true,
      complaintId: complaintRef.id,
      message: "Your request was submitted. Parichayam support will respond within the published SLA.",
    });
  } catch (error) {
    logger.error("submitContactForm failed", error);
    sendJson(req, res, error.status || 500, {
      message: error.message || "Unable to submit your request right now.",
    });
  }
});

exports.signInWithPhone = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const phone = normalizePhone(req.body?.phone || "");
    const password = String(req.body?.password || "");
    const clientIp = extractClientIp(req);
    if (phone.length < 10 || !password) {
      sendJson(req, res, 400, { message: "Phone and password are required." });
      return;
    }
    await enforceAuthRateLimit("signInWithPhone:ip", clientIp, 30, 60 * 60 * 1000, "Too many sign-in attempts. Please try again later.");
    await enforceAuthRateLimit("signInWithPhone:phone", phone, 12, 60 * 60 * 1000, "Too many sign-in attempts. Please try again later.");
    const apiUrl = firebaseAuthRestUrl("accounts:signInWithPassword");
    if (!apiUrl) {
      logger.error("signInWithPhone: PARICHAYAM_FIREBASE_WEB_API_KEY not configured.");
      sendJson(req, res, 500, { message: "Secure login service is not configured." });
      return;
    }
    const email = await resolveEmailFromIdentifier(phone);
    if (!email) {
      sendJson(req, res, 401, { message: "Invalid mobile number or password." });
      return;
    }
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      sendJson(req, res, 401, { message: "Invalid mobile number or password." });
      return;
    }
    const uid = String(payload.localId || "").trim();
    if (!uid) {
      sendJson(req, res, 401, { message: "Invalid mobile number or password." });
      return;
    }
    const firebaseToken = await admin.auth().createCustomToken(uid, { signInMethod: "phone-password" });
    sendJson(req, res, 200, { ok: true, firebaseToken, memberUid: uid });
  } catch (error) {
    logger.error("signInWithPhone failed", error);
    sendJson(req, res, 500, { message: "Unable to sign in right now. Please try again." });
  }
});

exports.requestPasswordReset = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  const genericResponse = {
    ok: true,
    maskedEmail: "your registered email",
    message: "If an account exists, a password reset email has been sent.",
  };
  try {
    const identifier = String(req.body?.identifier || "").trim();
    const clientIp = extractClientIp(req);
    await enforceAuthRateLimit("requestPasswordReset:ip", clientIp, 20, 60 * 60 * 1000, "Too many reset attempts. Please try again later.");
    if (identifier) {
      await enforceAuthRateLimit("requestPasswordReset:identifier", identifier, 8, 60 * 60 * 1000, "Too many reset attempts. Please try again later.");
    }
    const email = await resolveEmailFromIdentifier(identifier);
    if (!email) {
      sendJson(req, res, 200, genericResponse);
      return;
    }
    const apiUrl = firebaseAuthRestUrl("accounts:sendOobCode");
    if (!apiUrl) {
      logger.error("requestPasswordReset: PARICHAYAM_FIREBASE_WEB_API_KEY not configured.");
      sendJson(req, res, 500, { message: "Password reset service is not configured." });
      return;
    }
    await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
      }),
    }).catch((sendErr) => {
      logger.warn("requestPasswordReset: failed to send reset email", sendErr?.message || sendErr);
    });
    sendJson(req, res, 200, genericResponse);
  } catch (error) {
    logger.error("requestPasswordReset failed", error);
    sendJson(req, res, 200, genericResponse);
  }
});

exports.requestAgentPayout = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    await enforceAuthRateLimit("requestAgentPayout:uid", authUser.uid, 10, 60 * 60 * 1000, "Too many payout requests. Please try again later.");
    // Fail closed until trusted commission computation is server-owned.
    sendJson(req, res, 503, {
      message: "Self-service payout requests are temporarily unavailable until trusted payout computation is enabled.",
      code: "PAYOUT_SELF_SERVICE_DISABLED",
    });
  } catch (error) {
    logger.error("requestAgentPayout failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to process payout request right now." });
  }
});

exports.memberGetMatches = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    await enforceAuthRateLimit("memberGetMatches:uid", authUser.uid, 60, 60 * 60 * 1000, "Too many match refreshes. Please try again later.");
    const [memberSnap, kundaliSettings] = await Promise.all([
      db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get(),
      readKundaliMatchSettings(),
    ]);
    if (!memberSnap.exists) {
      sendJson(req, res, 404, { message: "Member profile not found." });
      return;
    }
    const seeker = { uid: authUser.uid, ...(memberSnap.data() || {}) };
    const seekerGender = normalizeGenderValue(seeker.gender || seeker.profileFor || "");
    if (!seekerGender) {
      sendJson(req, res, 400, { message: "Complete your gender/profile details before loading matches." });
      return;
    }
    const safeLimit = Math.min(120, Math.max(1, parseInt(req.body?.limit || 60, 10) || 60));
    const oppositeGender = seekerGender === "male" ? "female" : "male";
    const candidatePool = await loadMatchCandidatePool(seeker, oppositeGender, safeLimit);
    const matches = [];
    const seenMatchIds = new Set();
    candidatePool.forEach((candidateDoc) => {
      const docData = candidateDoc || {};
      // Extra safety to avoid matching against admin test accounts or same gender
      if (docData.role && docData.role !== "MEMBER") return;
      if (docData.gender === seekerGender) return;
      if (!isMatchableMemberProfile(docData)) return;
      if (!isWithinPracticalAgeWindow(seeker, docData)) return;

      const candidate = buildMemberMatchCandidate(seeker, docData, kundaliSettings);
      if (candidate) {
        const candidateId = String(candidate.uid || candidate.id || "").trim();
        if (!candidateId || seenMatchIds.has(candidateId)) return;
        seenMatchIds.add(candidateId);
        // Strip sensitive fields before exposing to client (DPDPA 2023 Safety)
        delete candidate.phone;
        delete candidate.email;
        delete candidate.staffNotes;
        delete candidate.internalNotes;
        delete candidate.msg91AccessToken;
        delete candidate.lastPaymentId;
        matches.push(candidate);
      }
    });
    matches.sort((left, right) => {
      if ((right.compat || 0) !== (left.compat || 0)) return (right.compat || 0) - (left.compat || 0);
      if ((right.scoreBreakdown?.freshness || 0) !== (left.scoreBreakdown?.freshness || 0)) return (right.scoreBreakdown?.freshness || 0) - (left.scoreBreakdown?.freshness || 0);
      if ((right.boostBonus || 0) !== (left.boostBonus || 0)) return (right.boostBonus || 0) - (left.boostBonus || 0);
      if ((right.scoreBreakdown?.trust || 0) !== (left.scoreBreakdown?.trust || 0)) return (right.scoreBreakdown?.trust || 0) - (left.scoreBreakdown?.trust || 0);
      return parseTimestampMs(right.updatedAt) - parseTimestampMs(left.updatedAt);
    });
    const diversifiedMatches = diversifyRankedMatches(matches, safeLimit);
    sendJson(req, res, 200, { ok: true, matches: diversifiedMatches.slice(0, safeLimit) });
  } catch (error) {
    logger.error("memberGetMatches failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load matches right now." });
  }
});

exports.listMembersForStaff = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const actorDoc = await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get();
    if (!actorDoc.exists) {
      sendJson(req, res, 403, { message: "Staff access required." });
      return;
    }
    const actor = actorDoc.data() || {};
    const role = String(actor.role || "").toUpperCase();
    if (!["ADMIN", "MATCHMAKER", "EMPLOYEE"].includes(role)) {
      sendJson(req, res, 403, { message: "Staff access required." });
      return;
    }
    const limitValue = Math.min(role === "ADMIN" ? 500 : 200, Math.max(1, parseInt(req.body?.limit || 100, 10) || 100));
    const serializeStaffMember = (memberId, data) => {
      const status = String(data.status || data.accountStatus || "active").trim().toLowerCase() || "active";
      return {
        id: memberId,
        uid: memberId,
        name: String(data.name || "").trim(),
        email: String(data.email || "").trim(),
        phone: normalizePhone(data.phone || ""),
        profileNumber: normalizeProfileNumber(data.profileNumber || ""),
        city: String(data.city || data.currentCity || "").trim(),
        role: String(data.role || "MEMBER").toUpperCase(),
        tier: String(data.tier || data.plan || "").trim(),
        plan: String(data.plan || "").trim(),
        isPaid: data.isPaid === true,
        paidUntil: String(data.paidUntil || "").trim(),
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
        photoPrivacyMode: normalizePhotoPrivacyMode(data.photoPrivacyMode || data.photoVisibilityMode || ""),
        sharePhoneAfterUnlock: data.sharePhoneAfterUnlock !== false,
        shareEmailAfterUnlock: data.shareEmailAfterUnlock !== false,
        assignedMatchmakerUid: String(data.assignedMatchmakerUid || "").trim(),
        assignedMatchmakerName: String(data.assignedMatchmakerName || "").trim(),
        assignedVerificationStaffUid: String(data.assignedVerificationStaffUid || "").trim(),
        assignedVerificationStaffName: String(data.assignedVerificationStaffName || "").trim(),
        staffScope: data.staffScope || {},
        updatedAt: data.updatedAt || data.createdAt || "",
        referredByAgentRefId: String(data.referredByAgentRefId || "").trim(),
      };
    };

    let members = [];
    if (role === "ADMIN") {
      const snapshot = await db.collection(MEMBERS_COLLECTION).limit(limitValue).get();
      members = snapshot.docs.map((doc) => serializeStaffMember(doc.id, doc.data() || {}));
    } else {
      const [assignmentSnap, verificationSnap] = await Promise.all([
        db.collection(MEMBER_ASSIGNMENTS_COLLECTION).where("assignedToUid", "==", authUser.uid).limit(400).get(),
        db.collection(VERIFICATION_REQUESTS_COLLECTION).where("assignedToUid", "==", authUser.uid).limit(400).get(),
      ]);
      const assignedMemberIds = new Set();
      assignmentSnap.docs.forEach((doc) => {
        const id = String(doc.data()?.memberUid || "").trim();
        if (id) assignedMemberIds.add(id);
      });
      verificationSnap.docs.forEach((doc) => {
        const id = String(doc.data()?.memberUid || "").trim();
        if (id) assignedMemberIds.add(id);
      });
      const memberIds = Array.from(assignedMemberIds).slice(0, limitValue);
      const memberDocs = await Promise.all(memberIds.map((memberId) => db.collection(MEMBERS_COLLECTION).doc(memberId).get()));
      members = memberDocs
        .filter((snap) => snap.exists)
        .map((snap) => serializeStaffMember(snap.id, snap.data() || {}));
    }
    sendJson(req, res, 200, { ok: true, members });
  } catch (error) {
    logger.error("listMembersForStaff failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to list members right now." });
  }
});

exports.createPaymentOrder = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    await enforceAuthRateLimit("createPaymentOrder:uid", authUser.uid, 30, 60 * 60 * 1000, "Too many payment requests. Please try again later.");
    const purchaseType = String(req.body?.purchaseType || "").trim().toLowerCase();
    if (!["membership", "verification"].includes(purchaseType)) {
      sendJson(req, res, 400, { message: "Unsupported purchase type for trusted activation." });
      return;
    }
    if (!isRazorpayConfigured()) {
      sendJson(req, res, 503, { message: "Payment verification is not configured yet." });
      return;
    }

    let totalInr = 0;
    let orderDoc = null;
    let orderNotes = { uid: authUser.uid, purchaseType };
    if (purchaseType === "membership") {
      const plan = normalizeMembershipPlan(req.body?.plan || "");
      if (!plan) {
        sendJson(req, res, 400, { message: "Invalid membership plan." });
        return;
      }
      const pricing = await readMembershipPricing();
      totalInr = computeMembershipTotal(plan, pricing);
      if (!totalInr) {
        sendJson(req, res, 500, { message: "Unable to calculate membership amount." });
        return;
      }
      const basePrice = Math.round(Number(pricing?.[plan] || 0));
      orderNotes = {
        uid: authUser.uid,
        purchaseType: "membership",
        plan,
      };
      orderDoc = {
        uid: authUser.uid,
        purchaseType: "membership",
        plan,
        amountInr: totalInr,
        basePrice,
        discountApplied: 0,
        planDurationDays: resolvePlanDurationDays(plan, ""),
        taxAmountInr: Math.max(0, totalInr - basePrice),
      };
    } else {
      const verificationType = normalizeVerificationType(req.body?.verificationType || "");
      const requestId = String(req.body?.requestId || "").trim();
      if (!verificationType || !requestId) {
        sendJson(req, res, 400, { message: "Verification request details are incomplete." });
        return;
      }
      const [verificationSnap, verificationSettings] = await Promise.all([
        db.collection(VERIFICATION_REQUESTS_COLLECTION).doc(requestId).get(),
        readVerificationSettings(),
      ]);
      if (!verificationSnap.exists) {
        sendJson(req, res, 404, { message: "Verification request not found." });
        return;
      }
      const verificationData = verificationSnap.data() || {};
      if (String(verificationData.memberUid || "") !== String(authUser.uid || "")) {
        sendJson(req, res, 403, { message: "This verification request does not belong to you." });
        return;
      }
      if (normalizeVerificationType(verificationData.type || "") !== verificationType) {
        sendJson(req, res, 400, { message: "Verification request type does not match." });
        return;
      }
      if (verificationSettings.enabled === false) {
        sendJson(req, res, 403, { message: "Verification payments are temporarily paused." });
        return;
      }
      if (String(verificationData.paymentStatus || "").toLowerCase() === "paid") {
        sendJson(req, res, 409, { message: "This verification request is already paid." });
        return;
      }
      if (["approved", "rejected"].includes(String(verificationData.status || "").toLowerCase())) {
        sendJson(req, res, 409, { message: "This verification request is already closed." });
        return;
      }
      totalInr = verificationType === "income"
        ? verificationSettings.incomeFee
        : verificationSettings.aadhaarFee;
      if (!totalInr) {
        sendJson(req, res, 500, { message: "Unable to calculate verification amount." });
        return;
      }
      orderNotes = {
        uid: authUser.uid,
        purchaseType: "verification",
        verificationType,
        requestId,
      };
      orderDoc = {
        uid: authUser.uid,
        purchaseType: "verification",
        verificationType,
        requestId,
        amountInr: totalInr,
      };
      await db.collection(VERIFICATION_REQUESTS_COLLECTION).doc(requestId).set({
        amount: totalInr,
        paymentStatus: "pending",
        status: "awaiting_payment",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    const currency = "INR";
    const receipt = `pari-${authUser.uid.slice(0, 8)}-${Date.now()}`;
    const order = await createRazorpayOrder({
      amount: totalInr * 100,
      currency,
      receipt,
      notes: orderNotes,
    });
    orderDoc = {
      ...(orderDoc || {}),
      currency,
      razorpayOrderId: String(order.id || ""),
      status: "created",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderDoc.razorpayOrderId).set(orderDoc, { merge: true });
    await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).set({
      pendingPaymentOrderId: orderDoc.razorpayOrderId,
      lastOrderId: orderDoc.razorpayOrderId,
      paymentStatus: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    sendJson(req, res, 200, {
      ok: true,
      gateway: "razorpay",
      orderId: orderDoc.razorpayOrderId,
      amount: totalInr * 100,
      currency,
      keyId: razorpayKeyId(),
      plan: orderDoc.plan || "",
      purchaseType: orderDoc.purchaseType,
      verificationType: orderDoc.verificationType || "",
      requestId: orderDoc.requestId || "",
    });
  } catch (error) {
    logger.error("createPaymentOrder failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to create payment order right now." });
  }
});

exports.verifyPaymentAndActivateMembership = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { message: "Method not allowed." });
    return;
  }
  let authUser = null;
  let orderId = "";
  let paymentId = "";
  let signature = "";
  try {
    authUser = await verifyAuthenticatedUser(req);
    await enforceAuthRateLimit("verifyPaymentAndActivateMembership:uid", authUser.uid, 40, 60 * 60 * 1000, "Too many verification attempts. Please try again later.");
    if (!isRazorpayConfigured()) {
      sendJson(req, res, 503, { message: "Payment verification is not configured yet." });
      return;
    }
    orderId = String(req.body?.razorpay_order_id || req.body?.orderId || "").trim();
    paymentId = String(req.body?.razorpay_payment_id || req.body?.paymentId || "").trim();
    signature = String(req.body?.razorpay_signature || req.body?.signature || "").trim();
    if (!orderId || !paymentId || !signature) {
      sendJson(req, res, 400, { message: "Payment verification payload is incomplete." });
      return;
    }
    const orderRef = db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderId);
    const memberRef = db.collection(MEMBERS_COLLECTION).doc(authUser.uid);
    const paymentRef = db.collection(PAYMENTS_COLLECTION).doc(paymentId);
    let responsePayload = null;
    await db.runTransaction(async (transaction) => {
      const [orderSnap, memberSnap, existingPaymentSnap] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(memberRef),
        transaction.get(paymentRef),
      ]);
      if (!orderSnap.exists) {
        const err = new Error("Payment order not found.");
        err.status = 404;
        throw err;
      }
      if (!memberSnap.exists) {
        const err = new Error("Member profile not found.");
        err.status = 404;
        throw err;
      }
      const orderData = orderSnap.data() || {};
      if (String(orderData.uid || "") !== String(authUser.uid || "")) {
        const err = new Error("Order does not belong to this user.");
        err.status = 403;
        throw err;
      }
      if (existingPaymentSnap.exists || String(orderData.status || "").toLowerCase() === "paid") {
        responsePayload = {
          ok: true,
          alreadyProcessed: true,
          member: {
            uid: authUser.uid,
            ...(memberSnap.data() || {}),
          },
        };
        return;
      }
      if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
        const err = new Error("Payment verification failed.");
        err.status = 400;
        throw err;
      }
      const memberData = memberSnap.data() || {};
      const purchaseType = String(orderData.purchaseType || "membership").trim().toLowerCase();
      if (purchaseType === "membership") {
        const paidAt = nowIso();
        const agentInfo = await resolveRevenueAgentForMember(memberData, transaction);
        const updatedMember = {
          plan: String(orderData.plan || memberData.pendingPlan || "paid"),
          planName: String(req.body?.planName || orderData.plan || ""),
          tier: "paid",
          isPaid: true,
          pendingPlan: "",
          pendingPaymentOrderId: "",
          lastOrderId: orderId,
          lastPaymentId: paymentId,
          lastPaymentAt: paidAt,
          lastPaymentAmount: Number(orderData.amountInr || 0),
          paymentGateway: "razorpay",
          paymentCurrency: String(orderData.currency || "INR"),
          paymentStatus: "paid",
          paidAt,
          updatedAt: FieldValue.serverTimestamp(),
        };
        const revenueEvents = buildMembershipRevenueEvents({
          memberId: authUser.uid,
          memberData: { ...memberData, ...updatedMember },
          orderData,
          orderId,
          paymentId,
          agentInfo,
          ipAddress: extractClientIp(req),
          createdBy: "system",
        });
        transaction.set(memberRef, updatedMember, { merge: true });
        transaction.create(
          db.collection(REVENUE_EVENTS_COLLECTION).doc(revenueEvents.membershipEventId),
          revenueEvents.membershipEvent
        );
        if (revenueEvents.commissionEvent) {
          transaction.create(
            db.collection(REVENUE_EVENTS_COLLECTION).doc(revenueEvents.commissionEventId),
            revenueEvents.commissionEvent
          );
        }
        responsePayload = {
          ok: true,
          purchaseType: "membership",
          member: {
            uid: authUser.uid,
            ...memberData,
            ...updatedMember,
            updatedAt: nowIso(),
          },
        };
      } else if (purchaseType === "verification") {
        const requestId = String(orderData.requestId || "").trim();
        const verificationType = normalizeVerificationType(orderData.verificationType || "");
        if (!requestId || !verificationType) {
          const err = new Error("Verification payment order is incomplete.");
          err.status = 400;
          throw err;
        }
        const requestRef = db.collection(VERIFICATION_REQUESTS_COLLECTION).doc(requestId);
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists) {
          const err = new Error("Verification request not found.");
          err.status = 404;
          throw err;
        }
        const requestData = requestSnap.data() || {};
        if (String(requestData.memberUid || "") !== String(authUser.uid || "")) {
          const err = new Error("Verification request does not belong to this user.");
          err.status = 403;
          throw err;
        }
        transaction.set(requestRef, {
          amount: Number(orderData.amountInr || 0),
          paymentStatus: "paid",
          status: "pending_review",
          paidAt: nowIso(),
          lastPaymentId: paymentId,
          lastPaymentAmount: Number(orderData.amountInr || 0),
          paymentGateway: "razorpay",
          paymentCurrency: String(orderData.currency || "INR"),
          reminderCount: 0,
          lastReminderAt: "",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        const verificationStatus = {
          ...(memberData.verificationStatus || {}),
          [verificationType]: "pending_review",
        };
        transaction.set(memberRef, {
          verificationStatus,
          pendingPaymentOrderId: "",
          lastOrderId: orderId,
          lastPaymentId: paymentId,
          paymentStatus: "paid",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        responsePayload = {
          ok: true,
          purchaseType: "verification",
          verificationRequest: {
            id: requestId,
            ...requestData,
            amount: Number(orderData.amountInr || 0),
            paymentStatus: "paid",
            status: "pending_review",
            paidAt: nowIso(),
            lastPaymentId: paymentId,
            lastPaymentAmount: Number(orderData.amountInr || 0),
            paymentGateway: "razorpay",
            paymentCurrency: String(orderData.currency || "INR"),
          },
        };
      } else {
        const err = new Error("Unsupported purchase type for payment verification.");
        err.status = 400;
        throw err;
      }
      transaction.set(orderRef, {
        status: "paid",
        paymentId,
        verifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(paymentRef, {
        uid: authUser.uid,
        orderId,
        paymentId,
        gateway: "razorpay",
        signature,
        purchaseType: purchaseType,
        plan: String(orderData.plan || ""),
        requestId: String(orderData.requestId || ""),
        verificationType: String(orderData.verificationType || ""),
        amountInr: Number(orderData.amountInr || 0),
        currency: String(orderData.currency || "INR"),
        status: "paid",
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    sendJson(req, res, 200, responsePayload || { ok: true });
  } catch (error) {
    const canQueueForRetry = authUser?.uid &&
      orderId &&
      paymentId &&
      signature &&
      isRazorpayConfigured() &&
      (!error.status || Number(error.status) >= 500) &&
      verifyRazorpaySignature(orderId, paymentId, signature);
    if (canQueueForRetry) {
      try {
        const pendingActivationId = await recordPendingActivationFailure({
          uid: authUser.uid,
          orderId,
          paymentId,
          signature,
          error,
          source: "member_verify_failed",
        });
        sendJson(req, res, 202, {
          ok: false,
          pendingActivation: true,
          pendingActivationId,
          message: "Payment received. Activation is queued for automatic recovery and the team has been alerted.",
        });
        return;
      } catch (queueError) {
        logger.error("verifyPaymentAndActivateMembership recovery queue failed", queueError);
      }
    }
    logger.error("verifyPaymentAndActivateMembership failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to verify payment right now." });
  }
});

exports.checkPaymentStatus = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const memberSnap = await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get();
    const memberData = memberSnap.exists ? (memberSnap.data() || {}) : {};
    let orderId = String(req.body?.orderId || req.body?.razorpay_order_id || memberData.pendingPaymentOrderId || memberData.lastOrderId || "").trim();
    let paymentId = String(req.body?.paymentId || req.body?.razorpay_payment_id || memberData.lastPaymentId || "").trim();
    if (!orderId && !paymentId) {
      sendJson(req, res, 200, {
        ok: true,
        status: "none",
        message: "No recent online payment was found for this account.",
      });
      return;
    }

    let orderData = null;
    if (orderId) {
      const orderSnap = await db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderId).get();
      if (!orderSnap.exists) {
        sendJson(req, res, 404, { message: "Payment order not found." });
        return;
      }
      orderData = orderSnap.data() || {};
      if (String(orderData.uid || "") !== authUser.uid) {
        sendJson(req, res, 403, { message: "This payment order does not belong to your account." });
        return;
      }
      if (!paymentId) paymentId = String(orderData.paymentId || "").trim();
    }

    const paymentSnap = paymentId ? await db.collection(PAYMENTS_COLLECTION).doc(paymentId).get() : null;
    const pendingSnap = paymentId ? await db.collection(PENDING_ACTIVATIONS_COLLECTION).doc(paymentId).get() : null;
    if (paymentSnap?.exists || String(orderData?.status || "").toLowerCase() === "paid") {
      sendJson(req, res, 200, {
        ok: true,
        status: "paid",
        orderId,
        paymentId,
        localPayment: paymentSnap?.exists ? serializeAdminDoc(paymentSnap) : null,
        pendingActivation: pendingSnap?.exists ? serializeAdminDoc(pendingSnap) : null,
      });
      return;
    }

    if (!isRazorpayConfigured() || !orderId || !orderData) {
      sendJson(req, res, 200, {
        ok: true,
        status: pendingSnap?.exists ? String(pendingSnap.data()?.status || "pending") : "pending",
        orderId,
        paymentId,
        pendingActivation: pendingSnap?.exists ? serializeAdminDoc(pendingSnap) : null,
      });
      return;
    }

    const capturedPayment = await findCapturedRazorpayPayment(orderId, orderData, paymentId);
    if (!capturedPayment) {
      sendJson(req, res, 200, {
        ok: true,
        status: "awaiting_gateway_capture",
        orderId,
        paymentId,
        pendingActivation: pendingSnap?.exists ? serializeAdminDoc(pendingSnap) : null,
      });
      return;
    }

    const capturedPaymentId = String(capturedPayment.id || paymentId).trim();
    try {
      const result = await activateVerifiedPurchase({
        uid: authUser.uid,
        orderId,
        paymentId: capturedPaymentId,
        skipSignature: true,
        gatewayPayment: capturedPayment,
        source: "member_status_check",
        pendingActivationId: capturedPaymentId,
      });
      sendJson(req, res, 200, {
        ok: true,
        status: "paid",
        activated: true,
        orderId,
        paymentId: capturedPaymentId,
        result,
      });
    } catch (activationError) {
      const pendingActivationId = await recordPendingActivationFailure({
        uid: authUser.uid,
        orderId,
        paymentId: capturedPaymentId,
        error: activationError,
        source: "member_status_check_failed",
      });
      sendJson(req, res, 202, {
        ok: false,
        status: "activation_pending",
        pendingActivation: true,
        pendingActivationId,
        orderId,
        paymentId: capturedPaymentId,
        message: "Razorpay shows this payment as captured. Activation is queued for recovery.",
      });
    }
  } catch (error) {
    logger.error("checkPaymentStatus failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to check payment status right now." });
  }
});

exports.razorpayWebhook = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    if (!isRazorpayConfigured()) {
      sendJson(req, res, 503, { message: "Razorpay is not configured." });
      return;
    }
    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
    const signature = String(req.headers["x-razorpay-signature"] || "").trim();
    if (!verifyRazorpayWebhookSignature(rawBody, signature) && !unsignedTestWebhooksAllowed()) {
      sendJson(req, res, 401, { message: "Invalid Razorpay webhook signature." });
      return;
    }
    const eventName = String(req.body?.event || "").trim();
    const payment = req.body?.payload?.payment?.entity || req.body?.payment || {};
    const paymentId = String(payment.id || "").trim();
    const orderId = String(payment.order_id || payment.orderId || "").trim();
    const paymentStatus = String(payment.status || "").toLowerCase();
    if (!paymentId || !orderId) {
      sendJson(req, res, 400, { message: "Webhook payment payload is incomplete." });
      return;
    }
    if (!["payment.captured", "payment.authorized"].includes(eventName) && paymentStatus !== "captured") {
      sendJson(req, res, 200, { ok: true, ignored: true, event: eventName, status: paymentStatus });
      return;
    }

    const orderSnap = await db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderId).get();
    if (!orderSnap.exists) {
      await writeAdminAlert({
        type: "razorpay_webhook_unknown_order",
        severity: "warning",
        title: "Razorpay webhook received for unknown order",
        message: `Payment ${paymentId} referenced order ${orderId}, but no paymentOrders document exists.`,
        orderId,
        paymentId,
        source: "razorpay_webhook",
      });
      sendJson(req, res, 202, { ok: false, queued: false, message: "Unknown order; admin alert created." });
      return;
    }
    const orderData = orderSnap.data() || {};
    const uid = String(orderData.uid || "").trim();
    if (!uid) {
      await writeAdminAlert({
        type: "razorpay_webhook_missing_uid",
        severity: "critical",
        title: "Razorpay webhook order missing member UID",
        message: `Payment ${paymentId} could not activate because order ${orderId} has no uid.`,
        orderId,
        paymentId,
        source: "razorpay_webhook",
      });
      sendJson(req, res, 202, { ok: false, queued: false, message: "Order missing uid; admin alert created." });
      return;
    }

    try {
      const result = await activateVerifiedPurchase({
        uid,
        orderId,
        paymentId,
        skipSignature: true,
        gatewayPayment: payment,
        source: "razorpay_webhook",
        pendingActivationId: paymentId,
      });
      sendJson(req, res, 200, { ok: true, activated: true, result });
    } catch (activationError) {
      const pendingActivationId = await recordPendingActivationFailure({
        uid,
        orderId,
        paymentId,
        error: activationError,
        source: "razorpay_webhook_failed",
      });
      sendJson(req, res, 202, {
        ok: false,
        pendingActivation: true,
        pendingActivationId,
        message: "Webhook received; activation queued for recovery.",
      });
    }
  } catch (error) {
    logger.error("razorpayWebhook failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to process Razorpay webhook." });
  }
});

exports.retryPendingActivations = onSchedule({
  schedule: "every 10 minutes",
  timeZone: "Asia/Kolkata",
  region: "us-central1",
}, async () => {
  const now = Date.now();
  const statuses = ["pending", "retry_failed", "waiting_gateway"];
  const outcomes = [];
  for (const status of statuses) {
    const snap = await db.collection(PENDING_ACTIVATIONS_COLLECTION)
      .where("status", "==", status)
      .limit(25)
      .get();
    for (const doc of snap.docs) {
      const pending = doc.data() || {};
      const nextRetryMs = parseTimestampMs(pending.nextRetryAt) || 0;
      if (nextRetryMs && nextRetryMs > now) continue;
      outcomes.push(await retryPendingActivationDoc(doc, "scheduled_retry"));
    }
  }
  logger.info("retryPendingActivations complete", {
    attempted: outcomes.length,
    activated: outcomes.filter((item) => item.ok).length,
  });
});

exports.dailyReconciliation = onSchedule({
  schedule: "every day 02:30",
  timeZone: "Asia/Kolkata",
  region: "us-central1",
}, async () => {
  const result = await runPaymentReconciliation({ source: "scheduled", limit: 100 });
  logger.info("dailyReconciliation complete", result);
});

exports.adminRunPaymentReconciliation = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    await verifyAdminUser(req);
    const result = await runPaymentReconciliation({
      source: "admin_manual",
      limit: req.body?.limit || 100,
    });
    sendJson(req, res, 200, result);
  } catch (error) {
    logger.error("adminRunPaymentReconciliation failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to run reconciliation." });
  }
});

exports.adminRetryPendingActivation = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    await verifyAdminUser(req);
    const pendingActivationId = String(req.body?.pendingActivationId || req.body?.paymentId || "").trim();
    if (!pendingActivationId) { sendJson(req, res, 400, { message: "Pending activation ID is required." }); return; }
    const doc = await db.collection(PENDING_ACTIVATIONS_COLLECTION).doc(pendingActivationId).get();
    if (!doc.exists) { sendJson(req, res, 404, { message: "Pending activation not found." }); return; }
    const result = await retryPendingActivationDoc(doc, "admin_manual_retry");
    sendJson(req, res, 200, { ok: !!result.ok, result });
  } catch (error) {
    logger.error("adminRetryPendingActivation failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to retry activation." });
  }
});

exports.adminAcknowledgeAlert = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const alertId = String(req.body?.alertId || "").trim();
    if (!alertId) { sendJson(req, res, 400, { message: "Alert ID is required." }); return; }
    await db.collection(ADMIN_ALERTS_COLLECTION).doc(alertId).set({
      status: "acknowledged",
      acknowledgedBy: adminUser.uid,
      acknowledgedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    sendJson(req, res, 200, { ok: true });
  } catch (error) {
    logger.error("adminAcknowledgeAlert failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to acknowledge alert." });
  }
});

exports.adminListPaymentResilience = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!["GET", "POST"].includes(req.method)) { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    await verifyAdminUser(req);
    const [
      pendingSnap,
      alertsSnap,
      paymentsSnap,
      ordersSnap,
      refundSnap,
      clawbackSnap,
      reconciliationSnap,
    ] = await Promise.all([
      db.collection(PENDING_ACTIVATIONS_COLLECTION).limit(50).get(),
      db.collection(ADMIN_ALERTS_COLLECTION).limit(50).get(),
      db.collection(PAYMENTS_COLLECTION).limit(50).get(),
      db.collection(PAYMENT_ORDERS_COLLECTION).limit(50).get(),
      db.collection(REVENUE_EVENTS_COLLECTION).where("eventType", "==", "refund_issued").limit(25).get(),
      db.collection(REVENUE_EVENTS_COLLECTION).where("eventType", "==", "commission_clawback").limit(25).get(),
      db.collection(PAYMENT_RECONCILIATION_RUNS_COLLECTION).limit(20).get(),
    ]);
    sendJson(req, res, 200, {
      ok: true,
      pendingActivations: pendingSnap.docs.map(serializeAdminDoc),
      adminAlerts: alertsSnap.docs.map(serializeAdminDoc),
      recentPayments: paymentsSnap.docs.map(serializeAdminDoc),
      paymentOrders: ordersSnap.docs.map(serializeAdminDoc),
      refunds: [
        ...refundSnap.docs.map(serializeAdminDoc),
        ...clawbackSnap.docs.map(serializeAdminDoc),
      ],
      reconciliationRuns: reconciliationSnap.docs.map(serializeAdminDoc),
    });
  } catch (error) {
    logger.error("adminListPaymentResilience failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load payment resilience data." });
  }
});

exports.syncPublicProfileOnMemberWrite = onDocumentWritten(
  { document: `${MEMBERS_COLLECTION}/{uid}`, region: "us-central1" },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    const beforeData = before?.exists ? before.data() : null;
    const afterData = after?.exists ? after.data() : null;
    const uid = event.params.uid;
    try {
      if (!afterData) {
        await deletePublicProfileByNumber(beforeData?.profileNumber || "");
        return;
      }
      if (!normalizeProfileNumber(afterData?.profileNumber || "")) {
        await assignProfileNumberIfMissingServer(uid);
        return;
      }
      const beforeProfileNumber = normalizeProfileNumber(beforeData?.profileNumber || "");
      await syncMemberToPublicProfile(afterData);
      const afterProfileNumber = normalizeProfileNumber(afterData?.profileNumber || "");
      if (beforeProfileNumber && beforeProfileNumber !== afterProfileNumber) {
        await deletePublicProfileByNumber(beforeProfileNumber);
      }
    } catch (error) {
      logger.error("syncPublicProfileOnMemberWrite failed", { uid, error: error?.message || error });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
// AGENT SYSTEM — Cloud Functions
// ═══════════════════════════════════════════════════════════════════════

const AGENTS_COLLECTION = "agents";
const AGENT_LEADS_COLLECTION = "agentLeads";
const AGENT_ACTIVITY_COLLECTION = "agentActivity";

const VALID_AGENT_STATUSES = ["active", "suspended", "deactivated"];
const VALID_LEAD_STAGES = ["new", "contacted", "interested", "registered", "profile_complete", "payment_pending", "converted", "inactive"];
const DEFAULT_AGENT_COMMISSION_PERCENT = DEFAULT_AGENT_COMMISSION_SETTINGS.defaultCommissionRate;
const AGENT_MIN_PAYOUT = 500;
const LEGACY_COMMISSION_PERCENT_BY_TIER = { bronze: 15, silver: 17, gold: 20, platinum: 22, starter: 15, standard: 17, premium: 20, custom: 15 };

function generateReferralCode(name, city) {
  const n = String(name || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "AGENT";
  const c = String(city || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "IND";
  return `${n}-${c}`;
}

async function ensureUniqueReferralCode(baseCode) {
  let code = baseCode;
  let suffix = 2;
  for (let i = 0; i < 20; i++) {
    const snap = await db.collection(AGENTS_COLLECTION).where("referralCode", "==", code).limit(1).get();
    if (snap.empty) return code;
    code = `${baseCode}-${suffix}`;
    suffix++;
  }
  return `${baseCode}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

async function verifyAdminUser(req) {
  const authUser = await verifyAuthenticatedUser(req);
  const memberSnap = await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get();
  if (!memberSnap.exists || String(memberSnap.data()?.role || "").toUpperCase() !== "ADMIN") {
    const err = new Error("Admin access required.");
    err.status = 403;
    throw err;
  }
  return authUser;
}

async function verifyAgentUser(req) {
  const authUser = await verifyAuthenticatedUser(req);
  const agentSnap = await db.collection(AGENTS_COLLECTION).doc(authUser.uid).get();
  if (!agentSnap.exists) {
    const err = new Error("Agent profile not found.");
    err.status = 404;
    throw err;
  }
  const agent = { id: agentSnap.id, ...agentSnap.data() };
  if (agent.status === "deactivated") {
    const err = new Error("This agent account has been closed.");
    err.status = 403;
    throw err;
  }
  return { ...authUser, agent };
}

function requireActiveAgent(agent) {
  if (agent.status !== "active") {
    const err = new Error("Your agent account is currently " + agent.status + ". Contact admin for assistance.");
    err.status = 403;
    throw err;
  }
}

function leadStageIndex(stage) {
  return VALID_LEAD_STAGES.indexOf(String(stage || "").trim().toLowerCase());
}

function clampCommissionPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AGENT_COMMISSION_PERCENT;
  return Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));
}

function getAgentCommissionPercent(agent) {
  const direct = Number(agent?.commissionPercent);
  if (Number.isFinite(direct) && direct >= 0 && direct <= 100) {
    return clampCommissionPercent(direct);
  }
  const tier = String(agent?.commissionTier || "").trim().toLowerCase();
  if (LEGACY_COMMISSION_PERCENT_BY_TIER[tier] !== undefined) {
    return LEGACY_COMMISSION_PERCENT_BY_TIER[tier];
  }
  return DEFAULT_AGENT_COMMISSION_PERCENT;
}

async function getTrustedPaidAmountFromMember(member) {
  const direct = Number(member?.lastPaymentAmount || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const pricing = await readMembershipPricing();
  const plan = normalizeMembershipPlan(member?.plan || member?.pendingPlan || "");
  const fallbackTotal = computeMembershipTotal(plan, pricing);
  if (Number.isFinite(fallbackTotal) && fallbackTotal > 0 && member?.isPaid === true) {
    return Math.round(fallbackTotal);
  }
  return 0;
}

function computeCommissionSnapshot(agent, paidAmount) {
  const trustedPaidAmount = Math.max(0, Math.round(Number(paidAmount || 0)));
  const commissionPercent = getAgentCommissionPercent(agent);
  return {
    commissionType: "percent",
    commissionPercent,
    paidAmount: trustedPaidAmount,
    commissionAmount: Math.round((trustedPaidAmount * commissionPercent) / 100),
  };
}

async function computeAgentBalance(agentId) {
  const leadsSnap = await db.collection(AGENT_LEADS_COLLECTION)
    .where("agentId", "==", agentId)
    .where("stage", "==", "converted")
    .where("commissionCredited", "==", true)
    .get();
  let totalEarned = 0;
  leadsSnap.forEach(doc => { totalEarned += Number(doc.data().commissionAmount || 0); });

  const paidSnap = await db.collection("agentPayoutRequests")
    .where("agentId", "==", agentId)
    .where("status", "==", "paid")
    .get();
  let totalPaidOut = 0;
  paidSnap.forEach(doc => { totalPaidOut += Number(doc.data().amount || 0); });

  const pendingSnap = await db.collection("agentPayoutRequests")
    .where("agentId", "==", agentId)
    .where("status", "==", "requested")
    .get();
  let pendingPayoutAmount = 0;
  pendingSnap.forEach(doc => { pendingPayoutAmount += Number(doc.data().amount || 0); });

  return {
    totalEarned,
    totalPaidOut,
    pendingPayoutAmount,
    availableBalance: totalEarned - totalPaidOut - pendingPayoutAmount,
  };
}

exports.calculateAgentCommissions = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!["GET", "POST"].includes(req.method)) { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const requestedAgentId = String(req.query?.agentId || req.body?.agentId || authUser.uid || "").trim();
    if (!requestedAgentId) { sendJson(req, res, 400, { message: "Agent ID is required." }); return; }
    if (requestedAgentId !== authUser.uid) {
      const memberSnap = await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get();
      if (!memberSnap.exists || String(memberSnap.data()?.role || "").toUpperCase() !== "ADMIN") {
        sendJson(req, res, 403, { message: "You can only view your own commission summary." });
        return;
      }
    }

    const balance = await computeAgentBalance(requestedAgentId);

    sendJson(req, res, 200, {
      ok: true,
      agentId: requestedAgentId,
      totalUnpaidCommissions: roundMoney(balance.lockedAmount + balance.availableBeforePending),
      totalLifetimeEarned: balance.totalLifetimeEarned,
      lockedAmount: balance.lockedAmount,
      unlockedAmount: balance.unlockedAmount,
      availableToWithdraw: balance.availableToWithdraw,
      alreadyPaidOut: balance.alreadyPaidOut,
      pendingPayoutAmount: balance.pendingPayoutAmount,
      disputedAmount: balance.disputedAmount,
      nextUnlockAt: balance.nextUnlockAt,
      nextUnlockDays: balance.nextUnlockDays,
      eventCount: balance.eventCount,
      asOf: nowIso(),
    });
  } catch (error) {
    logger.error("calculateAgentCommissions failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to calculate commissions." });
  }
});

function resolveMemberSubscriptionDate(memberData) {
  const paidUntil = String(memberData?.paidUntil || "").trim();
  if (paidUntil) return paidUntil;
  const trialEndsOn = String(memberData?.trialEndsOn || "").trim();
  if (trialEndsOn) return trialEndsOn;
  return "";
}

async function enrichAgentLeadsWithMemberState(leads) {
  if (!Array.isArray(leads) || !leads.length) return Array.isArray(leads) ? leads : [];
  const memberIds = Array.from(new Set(
    leads
      .map((lead) => String(lead?.memberUid || "").trim())
      .filter(Boolean)
  ));
  if (!memberIds.length) return leads;

  const refs = memberIds.map((uid) => db.collection(MEMBERS_COLLECTION).doc(uid));
  const memberDocs = await db.getAll(...refs);
  const memberMap = new Map();
  memberDocs.forEach((doc) => {
    if (doc.exists) memberMap.set(doc.id, doc.data() || {});
  });

  return leads.map((lead) => {
    const memberUid = String(lead?.memberUid || "").trim();
    if (!memberUid || !memberMap.has(memberUid)) return lead;
    const memberData = memberMap.get(memberUid);
    const subscriptionExpiryDate = resolveMemberSubscriptionDate(memberData);
    return {
      ...lead,
      subscriptionExpiryDate: subscriptionExpiryDate || String(lead?.subscriptionExpiryDate || "").trim(),
    };
  });
}

function extractComparableTimestamp(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?._seconds === "number") return value._seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function logAgentActivity(agentId, type, description, extra) {
  await db.collection(AGENT_ACTIVITY_COLLECTION).add({
    agentId,
    type,
    description,
    ...(extra || {}),
    createdAt: FieldValue.serverTimestamp(),
  });
}

function cleanPercent(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));
}

function normalizeAgentCommissionSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    defaultCommissionRate: cleanPercent(source.defaultCommissionRate, DEFAULT_AGENT_COMMISSION_SETTINGS.defaultCommissionRate),
    lockPeriodDays: Math.max(0, parseInt(source.lockPeriodDays ?? DEFAULT_AGENT_COMMISSION_SETTINGS.lockPeriodDays, 10) || DEFAULT_AGENT_COMMISSION_SETTINGS.lockPeriodDays),
    minimumPayoutAmount: Math.max(0, Math.round(Number(source.minimumPayoutAmount ?? DEFAULT_AGENT_COMMISSION_SETTINGS.minimumPayoutAmount) || DEFAULT_AGENT_COMMISSION_SETTINGS.minimumPayoutAmount)),
    payoutSlaBusinessDays: Math.max(1, parseInt(source.payoutSlaBusinessDays ?? DEFAULT_AGENT_COMMISSION_SETTINGS.payoutSlaBusinessDays, 10) || DEFAULT_AGENT_COMMISSION_SETTINGS.payoutSlaBusinessDays),
    tdsThreshold: Math.max(0, Math.round(Number(source.tdsThreshold ?? DEFAULT_AGENT_COMMISSION_SETTINGS.tdsThreshold) || DEFAULT_AGENT_COMMISSION_SETTINGS.tdsThreshold)),
    tdsRate: cleanPercent(source.tdsRate, DEFAULT_AGENT_COMMISSION_SETTINGS.tdsRate),
  };
}

function normalizeAgentTiers(raw) {
  const sourceList = Array.isArray(raw?.tiers) ? raw.tiers : Array.isArray(raw) ? raw : DEFAULT_AGENT_TIERS;
  const normalized = sourceList.map((tier, idx) => {
    const name = String(tier?.name || DEFAULT_AGENT_TIERS[idx]?.name || `Tier ${idx + 1}`).trim();
    return {
      id: String(tier?.id || name || `tier-${idx + 1}`).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `tier-${idx + 1}`,
      name,
      minPaidReferrals: Math.max(0, parseInt(tier?.minPaidReferrals ?? tier?.minReferrals ?? DEFAULT_AGENT_TIERS[idx]?.minPaidReferrals ?? 0, 10) || 0),
      commissionRate: cleanPercent(tier?.commissionRate ?? tier?.commissionPercent, DEFAULT_AGENT_TIERS[idx]?.commissionRate ?? DEFAULT_AGENT_COMMISSION_SETTINGS.defaultCommissionRate),
      monthlyBonus: Math.max(0, Math.round(Number(tier?.monthlyBonus ?? DEFAULT_AGENT_TIERS[idx]?.monthlyBonus ?? 0) || 0)),
      enabled: tier?.enabled !== false,
    };
  }).filter((tier) => tier.enabled || tier.minPaidReferrals === 0);
  if (!normalized.length) return DEFAULT_AGENT_TIERS;
  return normalized.sort((a, b) => a.minPaidReferrals - b.minPaidReferrals);
}

function normalizeLeaderboardSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rewards = source.rewards && typeof source.rewards === "object" ? source.rewards : {};
  const metric = String(source.metric || DEFAULT_LEADERBOARD_SETTINGS.metric).trim().toLowerCase();
  const resetPeriod = String(source.resetPeriod || DEFAULT_LEADERBOARD_SETTINGS.resetPeriod).trim().toLowerCase();
  return {
    enabled: source.enabled !== false,
    metric: ["signups", "paid", "commission"].includes(metric) ? metric : DEFAULT_LEADERBOARD_SETTINGS.metric,
    resetPeriod: ["weekly", "monthly"].includes(resetPeriod) ? resetPeriod : DEFAULT_LEADERBOARD_SETTINGS.resetPeriod,
    showTop: Math.max(1, Math.min(50, parseInt(source.showTop ?? DEFAULT_LEADERBOARD_SETTINGS.showTop, 10) || DEFAULT_LEADERBOARD_SETTINGS.showTop)),
    anonymizeNames: source.anonymizeNames !== false,
    rewards: {
      top1: Math.max(0, Math.round(Number(rewards.top1 ?? DEFAULT_LEADERBOARD_SETTINGS.rewards.top1) || 0)),
      top3: Math.max(0, Math.round(Number(rewards.top3 ?? DEFAULT_LEADERBOARD_SETTINGS.rewards.top3) || 0)),
      top10: Math.max(0, Math.round(Number(rewards.top10 ?? DEFAULT_LEADERBOARD_SETTINGS.rewards.top10) || 0)),
    },
  };
}

function normalizeWhatsappNotificationSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const triggers = source.triggers && typeof source.triggers === "object" ? source.triggers : {};
  return {
    enabled: source.enabled === true,
    dailyCap: Math.max(1, parseInt(source.dailyCap ?? DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS.dailyCap, 10) || DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS.dailyCap),
    estimatedCostPerMessage: Math.max(0, Number(source.estimatedCostPerMessage ?? DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS.estimatedCostPerMessage) || DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS.estimatedCostPerMessage),
    triggers: {
      ...DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS.triggers,
      ...triggers,
    },
  };
}

async function readAppStateValue(key, fallback, transaction) {
  const ref = db.collection(APP_STATE_COLLECTION).doc(key);
  const snap = transaction ? await transaction.get(ref) : await ref.get();
  if (!snap.exists) return fallback;
  const data = snap.data() || {};
  return data.value !== undefined ? data.value : fallback;
}

async function readAgentCommissionSettings(transaction) {
  return normalizeAgentCommissionSettings(await readAppStateValue(AGENT_COMMISSION_SETTINGS_KEY, DEFAULT_AGENT_COMMISSION_SETTINGS, transaction));
}

async function readAgentTierConfig(transaction) {
  return normalizeAgentTiers(await readAppStateValue(AGENT_TIERS_KEY, { tiers: DEFAULT_AGENT_TIERS }, transaction));
}

async function readLeaderboardSettings(transaction) {
  return normalizeLeaderboardSettings(await readAppStateValue(LEADERBOARD_SETTINGS_KEY, DEFAULT_LEADERBOARD_SETTINGS, transaction));
}

async function readWhatsappNotificationSettings(transaction) {
  return normalizeWhatsappNotificationSettings(await readAppStateValue(WHATSAPP_NOTIFICATION_SETTINGS_KEY, DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS, transaction));
}

function chooseAgentTier(tiers, paidReferralCount) {
  const enabled = normalizeAgentTiers(tiers).filter((tier) => tier.enabled !== false);
  const count = Math.max(0, parseInt(paidReferralCount, 10) || 0);
  let current = enabled[0] || DEFAULT_AGENT_TIERS[0];
  for (const tier of enabled) {
    if (count >= tier.minPaidReferrals) current = tier;
  }
  const next = enabled.find((tier) => tier.minPaidReferrals > count) || null;
  return { current, next };
}

async function countAgentPaidReferrals(agentId, transaction) {
  if (!agentId) return 0;
  const query = db.collection(REVENUE_EVENTS_COLLECTION)
    .where("agentId", "==", agentId)
    .where("eventType", "==", "agent_commission")
    .where("status", "==", "recorded");
  try {
    const snap = transaction ? await transaction.get(query) : await query.get();
    return snap.size;
  } catch (error) {
    logger.warn("countAgentPaidReferrals failed; falling back to agent totals", { agentId, message: error?.message || String(error || "") });
    return 0;
  }
}

async function attachAgentTierSnapshot(agentId, agentData, transaction) {
  const settings = await readAgentCommissionSettings(transaction);
  const tiers = await readAgentTierConfig(transaction);
  const paidReferralCount = Math.max(
    Number(agentData?.paidReferralCount || 0),
    Number(agentData?.totalConversions || 0),
    await countAgentPaidReferrals(agentId, transaction)
  );
  const { current } = chooseAgentTier(tiers, paidReferralCount);
  return {
    ...(agentData || {}),
    paidReferralCount,
    currentTier: current.name,
    commissionTier: current.name,
    tierId: current.id,
    tierMonthlyBonus: current.monthlyBonus,
    commissionPercent: cleanPercent(agentData?.commissionPercent ?? current.commissionRate, settings.defaultCommissionRate),
  };
}

function getAgentCommissionRateForRevenue(agentData) {
  const percent = cleanPercent(
    agentData?.commissionPercent ?? agentData?.commissionRate ?? agentData?.tierCommissionRate,
    DEFAULT_AGENT_COMMISSION_SETTINGS.defaultCommissionRate
  );
  return Math.round((percent / 100) * 10000) / 10000;
}

function firstName(value) {
  return String(value || "").trim().split(/\s+/)[0] || "";
}

function initialsForName(value) {
  const parts = String(value || "Agent").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "A.";
  if (parts.length === 1) return `${parts[0].slice(0, 1).toUpperCase()}.`;
  return `${parts[0].slice(0, 1).toUpperCase()}.${parts[parts.length - 1].slice(0, 1).toUpperCase()}.`;
}

function currentPeriodStartMs(resetPeriod) {
  const now = new Date();
  if (resetPeriod === "weekly") {
    const day = now.getDay();
    const diff = (day + 6) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff).getTime();
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

async function listSeededCollection(collectionName, defaults) {
  const collection = db.collection(collectionName);
  const snap = await collection.limit(100).get();
  if (snap.empty) {
    const batch = db.batch();
    defaults.forEach((item) => {
      batch.set(collection.doc(String(item.id)), { ...item, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    await batch.commit();
    return defaults;
  }
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function ensureAgentDashboardDefaults() {
  const stateDefaults = [
    [AGENT_COMMISSION_SETTINGS_KEY, normalizeAgentCommissionSettings(DEFAULT_AGENT_COMMISSION_SETTINGS)],
    [AGENT_TIERS_KEY, { tiers: normalizeAgentTiers(DEFAULT_AGENT_TIERS) }],
    [LEADERBOARD_SETTINGS_KEY, normalizeLeaderboardSettings(DEFAULT_LEADERBOARD_SETTINGS)],
    [WHATSAPP_NOTIFICATION_SETTINGS_KEY, normalizeWhatsappNotificationSettings(DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS)],
  ];
  const batch = db.batch();
  const snaps = await Promise.all(stateDefaults.map(([key]) => db.collection(APP_STATE_COLLECTION).doc(key).get()));
  snaps.forEach((snap, idx) => {
    if (snap.exists) return;
    const [key, value] = stateDefaults[idx];
    batch.set(db.collection(APP_STATE_COLLECTION).doc(key), {
      value,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "system_phase_2_10_seed",
    }, { merge: true });
  });
  await batch.commit();
  await Promise.all([
    listSeededCollection(FESTIVALS_COLLECTION, DEFAULT_FESTIVALS),
    listSeededCollection(WHATSAPP_TEMPLATES_COLLECTION, DEFAULT_WHATSAPP_TEMPLATES),
    listSeededCollection(MARKETING_MATERIALS_COLLECTION, DEFAULT_MARKETING_MATERIALS),
  ]);
}

async function computeAgentBalance(agentId) {
  const [settings, commissionSnap, clawbackSnap, payoutSnap] = await Promise.all([
    readAgentCommissionSettings(),
    db.collection(REVENUE_EVENTS_COLLECTION)
      .where("agentId", "==", agentId)
      .where("eventType", "==", "agent_commission")
      .get(),
    db.collection(REVENUE_EVENTS_COLLECTION)
      .where("agentId", "==", agentId)
      .where("eventType", "==", "commission_clawback")
      .get(),
    db.collection("agentPayoutRequests")
      .where("agentId", "==", agentId)
      .get(),
  ]);

  const nowMs = Date.now();
  let totalEarned = 0;
  let lockedAmount = 0;
  let unlockedAmount = 0;
  let disputedAmount = 0;
  let eventCount = 0;
  let nextUnlockAt = null;
  let nextUnlockMs = 0;

  commissionSnap.forEach((doc) => {
    const event = doc.data() || {};
    const amount = Math.max(0, roundMoney(event.agentCommissionAmount || event.amount || 0));
    const status = String(event.status || "recorded").toLowerCase();
    if (status === "disputed") {
      disputedAmount += amount;
      return;
    }
    if (!["recorded", "settled"].includes(status)) return;
    eventCount++;
    totalEarned += amount;
    const lockExpiresMs = parseTimestampMs(event.lockExpiresAt);
    if (lockExpiresMs > nowMs) {
      lockedAmount += amount;
      if (!nextUnlockMs || lockExpiresMs < nextUnlockMs) {
        nextUnlockMs = lockExpiresMs;
        nextUnlockAt = event.lockExpiresAt || revenueTimestampFromMs(lockExpiresMs);
      }
    } else {
      unlockedAmount += amount;
    }
  });

  clawbackSnap.forEach((doc) => {
    const event = doc.data() || {};
    const status = String(event.status || "recorded").toLowerCase();
    if (!["recorded", "settled"].includes(status)) return;
    const amount = roundMoney(event.agentCommissionAmount || event.amount || 0);
    totalEarned += amount;
    unlockedAmount += amount;
  });

  let totalPaidOut = 0;
  let pendingPayoutAmount = 0;
  payoutSnap.forEach((doc) => {
    const payout = doc.data() || {};
    const amount = Math.max(0, roundMoney(payout.amount || payout.requestedAmount || 0));
    const status = String(payout.status || "").toLowerCase();
    if (status === "paid" || status === "settled") totalPaidOut += amount;
    if (["requested", "approved", "processing"].includes(status)) pendingPayoutAmount += amount;
  });

  const availableBeforePending = roundMoney(unlockedAmount);
  const availableBalance = roundMoney(Math.max(0, availableBeforePending - totalPaidOut - pendingPayoutAmount));
  return {
    totalEarned: roundMoney(totalEarned),
    totalLifetimeEarned: roundMoney(totalEarned),
    lockedAmount: roundMoney(Math.max(0, lockedAmount)),
    unlockedAmount: roundMoney(Math.max(0, unlockedAmount)),
    availableBeforePending: roundMoney(Math.max(0, availableBeforePending - totalPaidOut)),
    totalPaidOut: roundMoney(totalPaidOut),
    alreadyPaidOut: roundMoney(totalPaidOut),
    pendingPayoutAmount: roundMoney(pendingPayoutAmount),
    availableBalance,
    availableToWithdraw: availableBalance,
    disputedAmount: roundMoney(disputedAmount),
    eventCount,
    nextUnlockAt,
    nextUnlockDays: nextUnlockMs ? Math.max(0, Math.ceil((nextUnlockMs - nowMs) / (24 * 60 * 60 * 1000))) : 0,
    minimumPayoutAmount: settings.minimumPayoutAmount,
    payoutSlaBusinessDays: settings.payoutSlaBusinessDays,
  };
}

async function buildAgentTierProgress(agentId, agentData, paidReferralCount) {
  const tiers = await readAgentTierConfig();
  const count = Math.max(0, parseInt(paidReferralCount ?? agentData?.paidReferralCount ?? agentData?.totalConversions, 10) || 0);
  const { current, next } = chooseAgentTier(tiers, count);
  const remaining = next ? Math.max(0, next.minPaidReferrals - count) : 0;
  const span = next ? Math.max(1, next.minPaidReferrals - current.minPaidReferrals) : Math.max(1, count || 1);
  const progress = next ? Math.min(100, Math.round(((count - current.minPaidReferrals) / span) * 100)) : 100;
  return {
    currentTier: current,
    nextTier: next,
    paidReferrals: count,
    remainingToNextTier: remaining,
    progressPercent: progress,
    message: next ? `${remaining} more referrals to reach ${next.name}` : `Top tier reached: ${current.name}`,
  };
}

async function buildAgentLeaderboard(agentId) {
  const settings = await readLeaderboardSettings();
  if (!settings.enabled) return { enabled: false, settings };
  const periodStart = currentPeriodStartMs(settings.resetPeriod);
  const agentsSnap = await db.collection(AGENTS_COLLECTION).where("status", "==", "active").get();
  const agentMap = new Map();
  agentsSnap.forEach((doc) => {
    agentMap.set(doc.id, { id: doc.id, ...(doc.data() || {}), score: 0, paid: 0, signups: 0, commission: 0 });
  });

  if (settings.metric === "signups") {
    const leadsSnap = await db.collection(AGENT_LEADS_COLLECTION).get();
    leadsSnap.forEach((doc) => {
      const lead = doc.data() || {};
      const id = String(lead.agentId || "");
      const entry = agentMap.get(id);
      if (!entry) return;
      if (parseTimestampMs(lead.createdAt) < periodStart) return;
      entry.signups++;
      entry.score++;
    });
  } else {
    const eventsSnap = await db.collection(REVENUE_EVENTS_COLLECTION)
      .where("eventType", "==", "agent_commission")
      .where("status", "==", "recorded")
      .get();
    eventsSnap.forEach((doc) => {
      const event = doc.data() || {};
      const id = String(event.agentId || "");
      const entry = agentMap.get(id);
      if (!entry) return;
      if (parseTimestampMs(event.createdAt) < periodStart) return;
      const amount = Math.max(0, roundMoney(event.agentCommissionAmount || event.amount || 0));
      entry.paid++;
      entry.commission += amount;
      entry.score += settings.metric === "commission" ? amount : 1;
    });
  }

  const ranked = Array.from(agentMap.values())
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || String(a.name || "").localeCompare(String(b.name || "")));
  const index = ranked.findIndex((entry) => entry.id === agentId);
  const activeAgents = Math.max(ranked.length, agentMap.size);
  const rank = index >= 0 ? index + 1 : activeAgents || 0;
  return {
    enabled: true,
    settings,
    rank,
    activeAgents,
    percentile: rank && activeAgents ? Math.max(1, Math.round((rank / activeAgents) * 100)) : 0,
    score: index >= 0 ? ranked[index].score : 0,
    top: ranked.slice(0, settings.showTop).map((entry) => ({
      initials: settings.anonymizeNames ? initialsForName(entry.name) : String(entry.name || "Agent"),
      score: entry.score,
      paid: entry.paid,
      signups: entry.signups,
      commission: roundMoney(entry.commission),
    })),
  };
}

async function buildAgentMonthlyPerformance(agentId) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const [leadsSnap, eventsSnap] = await Promise.all([
    db.collection(AGENT_LEADS_COLLECTION).where("agentId", "==", agentId).get(),
    db.collection(REVENUE_EVENTS_COLLECTION)
      .where("agentId", "==", agentId)
      .where("eventType", "==", "agent_commission")
      .where("status", "==", "recorded")
      .get(),
  ]);
  let signups = 0;
  leadsSnap.forEach((doc) => {
    if (parseTimestampMs(doc.data()?.createdAt) >= monthStart) signups++;
  });
  let paid = 0;
  let commission = 0;
  eventsSnap.forEach((doc) => {
    const event = doc.data() || {};
    if (parseTimestampMs(event.createdAt) < monthStart) return;
    paid++;
    commission += Math.max(0, roundMoney(event.agentCommissionAmount || event.amount || 0));
  });
  return {
    signups,
    paid,
    conversionRate: signups ? Math.round((paid / signups) * 100) : 0,
    commission: roundMoney(commission),
  };
}

// ── Admin: Create Agent ──
exports.adminCreateAgent = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const name = String(req.body?.name || "").trim();
    const mobile = normalizePhone(req.body?.mobile || "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const city = String(req.body?.city || "").trim();
    const area = String(req.body?.area || "").trim();
    const state = String(req.body?.state || "").trim();
    const commissionSettings = await readAgentCommissionSettings();
    const defaultTier = chooseAgentTier(await readAgentTierConfig(), 0).current;
    const commissionPercent = clampCommissionPercent(
      req.body?.commissionPercent !== undefined ? req.body?.commissionPercent : (defaultTier?.commissionRate ?? commissionSettings.defaultCommissionRate)
    );
    const upiId = String(req.body?.upiId || "").trim();
    const adminNotes = String(req.body?.notes || "").trim();

    if (!name || name.length < 2) { sendJson(req, res, 400, { message: "Agent name is required." }); return; }
    if (mobile.length < 10) { sendJson(req, res, 400, { message: "Valid 10-digit mobile is required." }); return; }
    if (!city) { sendJson(req, res, 400, { message: "City is required." }); return; }

    // Check duplicate mobile
    const existingSnap = await db.collection(AGENTS_COLLECTION).where("mobile", "==", mobile).limit(1).get();
    if (!existingSnap.empty) { sendJson(req, res, 409, { message: "An agent with this mobile already exists." }); return; }

    // Create Firebase Auth account
    const authEmail = email || `${mobile}@agent.parichayam.local`;
    const tempPassword = "Agent" + mobile.slice(-4) + "!" + Math.random().toString(36).slice(-3).toUpperCase();
    let authRecord;
    try {
      authRecord = await admin.auth().createUser({ email: authEmail, password: tempPassword, displayName: name, disabled: false });
    } catch (authError) {
      if (authError.code === "auth/email-already-exists") {
        sendJson(req, res, 409, { message: "An account with this email already exists." });
        return;
      }
      throw authError;
    }

    // Generate referral code
    const referralCode = await ensureUniqueReferralCode(generateReferralCode(name, city));

    // Create agent document
    const agentDoc = {
      name, mobile, email: authEmail, city, area, state,
      status: "active",
      referralCode,
      commissionType: "percent",
      commissionPercent,
      commissionTier: defaultTier?.name || "Bronze",
      currentTier: defaultTier?.name || "Bronze",
      tierId: defaultTier?.id || "bronze",
      tierMonthlyBonus: defaultTier?.monthlyBonus || 0,
      paidReferralCount: 0,
      upiId,
      totalEarned: 0, totalPaidOut: 0, totalLeads: 0, totalConversions: 0,
      lastActiveAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUser.uid,
      onboardingPath: "admin-created",
      statusChangedAt: FieldValue.serverTimestamp(),
      statusChangedBy: adminUser.uid,
      payoutHold: false,
      notes: adminNotes,
      passwordChangedAt: null,
    };
    await db.collection(AGENTS_COLLECTION).doc(authRecord.uid).set(agentDoc);
    await logAgentActivity(authRecord.uid, "agent_created", `Agent ${name} created by admin.`);

    sendJson(req, res, 200, {
      ok: true,
      agent: { id: authRecord.uid, ...agentDoc, createdAt: nowIso(), lastActiveAt: nowIso(), statusChangedAt: nowIso() },
      referralCode,
      tempPassword,
      loginEmail: authEmail,
    });
  } catch (error) {
    logger.error("adminCreateAgent failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to create agent." });
  }
});

// ── Admin: List Agents ──
exports.adminListAgents = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    await verifyAdminUser(req);
    const snap = await db.collection(AGENTS_COLLECTION).orderBy("createdAt", "desc").get();
    const agents = [];
    snap.forEach(doc => { agents.push({ id: doc.id, ...doc.data() }); });

    // Get pending applications count
    const appsSnap = await db.collection("agentApplications").where("status", "==", "pending").get();
    const pendingApplications = appsSnap.size;

    // Get pending payout requests
    const payoutsSnap = await db.collection("agentPayoutRequests").where("status", "==", "requested").get();
    const pendingPayouts = [];
    payoutsSnap.forEach(doc => { pendingPayouts.push({ id: doc.id, ...doc.data() }); });

    sendJson(req, res, 200, { ok: true, agents, pendingApplications, pendingPayouts });
  } catch (error) {
    logger.error("adminListAgents failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to list agents." });
  }
});

// ── Admin: Update Agent ──
exports.adminUpdateAgent = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const agentId = String(req.body?.agentId || "").trim();
    if (!agentId) { sendJson(req, res, 400, { message: "Agent ID is required." }); return; }

    const agentRef = db.collection(AGENTS_COLLECTION).doc(agentId);
    const agentSnap = await agentRef.get();
    if (!agentSnap.exists) { sendJson(req, res, 404, { message: "Agent not found." }); return; }

    const current = agentSnap.data();
    const updates = { updatedAt: FieldValue.serverTimestamp() };

    // Status change
    if (req.body?.status && VALID_AGENT_STATUSES.includes(req.body.status) && req.body.status !== current.status) {
      if (current.status === "deactivated") { sendJson(req, res, 400, { message: "Cannot reactivate a deactivated agent." }); return; }
      updates.status = req.body.status;
      updates.statusChangedAt = FieldValue.serverTimestamp();
      updates.statusChangedBy = adminUser.uid;
      updates.statusReason = String(req.body?.reason || "").trim();
      if (req.body.status === "deactivated") {
        await admin.auth().updateUser(agentId, { disabled: true }).catch(() => null);
      } else if (req.body.status === "active" && current.status === "suspended") {
        await admin.auth().updateUser(agentId, { disabled: false }).catch(() => null);
      }
    }

    // Editable fields
    if (req.body?.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body?.city !== undefined) updates.city = String(req.body.city).trim();
    if (req.body?.area !== undefined) updates.area = String(req.body.area).trim();
    if (req.body?.state !== undefined) updates.state = String(req.body.state).trim();
    if (req.body?.upiId !== undefined) updates.upiId = String(req.body.upiId).trim();
    if (req.body?.notes !== undefined) updates.notes = String(req.body.notes).trim();
    if (req.body?.payoutHold !== undefined) {
      const payoutHold = req.body.payoutHold === true;
      const payoutHoldReason = String(req.body?.payoutHoldReason || "").trim();
      updates.payoutHold = payoutHold;
      if (!payoutHold) {
        updates.payoutHoldReason = "";
      } else if (payoutHoldReason) {
        updates.payoutHoldReason = payoutHoldReason;
      }
    }
    if (req.body?.commissionPercent !== undefined) {
      updates.commissionType = "percent";
      updates.commissionPercent = clampCommissionPercent(req.body.commissionPercent);
    }

    await agentRef.set(updates, { merge: true });
    if (updates.status) {
      await logAgentActivity(agentId, "status_changed", `Status changed to ${updates.status} by admin.${updates.statusReason ? " Reason: " + updates.statusReason : ""}`);
    }

    const updated = await agentRef.get();
    sendJson(req, res, 200, { ok: true, agent: { id: agentId, ...updated.data() } });
  } catch (error) {
    logger.error("adminUpdateAgent failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to update agent." });
  }
});

// ── Admin: Process Payout ──
exports.adminProcessPayout = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const requestId = String(req.body?.requestId || "").trim();
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!requestId) { sendJson(req, res, 400, { message: "Payout request ID is required." }); return; }
    if (!["approve", "reject"].includes(action)) { sendJson(req, res, 400, { message: "Action must be approve or reject." }); return; }

    const payoutRef = db.collection("agentPayoutRequests").doc(requestId);
    
    const result = await db.runTransaction(async (transaction) => {
      const payoutSnap = await transaction.get(payoutRef);
      if (!payoutSnap.exists) { throw new Error("404:Payout request not found."); }
      
      const payout = payoutSnap.data();
      if (payout.status !== "requested") { throw new Error("400:This payout has already been processed."); }

      const update = {
        processedAt: FieldValue.serverTimestamp(),
        processedBy: adminUser.uid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      
      let statusResult = "rejected";

      if (action === "approve") {
        update.status = "paid";
        update.bankReference = String(req.body?.bankReference || "").trim();
        statusResult = "paid";
        
        // Update agent totalPaidOut
        const agentRef = db.collection(AGENTS_COLLECTION).doc(payout.agentId);
        transaction.set(agentRef, { totalPaidOut: FieldValue.increment(Number(payout.amount || 0)), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      } else {
        update.status = "rejected";
        update.rejectReason = String(req.body?.reason || "").trim();
      }

      transaction.set(payoutRef, update, { merge: true });
      
      return { status: statusResult, agentId: payout.agentId, amount: payout.amount, rejectReason: update.rejectReason };
    });

    if (result.status === "paid") {
      await logAgentActivity(result.agentId, "payout_paid", `Payout of Rs ${result.amount} approved and paid.`);
    } else {
      await logAgentActivity(result.agentId, "payout_rejected", `Payout of Rs ${result.amount} rejected.${result.rejectReason ? " Reason: " + result.rejectReason : ""}`);
    }

    sendJson(req, res, 200, { ok: true, status: result.status });
  } catch (error) {
    logger.error("adminProcessPayout failed", error);
    const message = error.message || "";
    if (message.startsWith("404:")) { sendJson(req, res, 404, { message: message.split(":")[1] }); return; }
    if (message.startsWith("400:")) { sendJson(req, res, 400, { message: message.split(":")[1] }); return; }
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to process payout." });
  }
});

// Admin: Process Refund
exports.processRefund = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    if (!isRazorpayConfigured()) {
      sendJson(req, res, 503, { message: "Payment refunds are not configured yet." });
      return;
    }

    const memberId = String(req.body?.memberId || "").trim();
    const orderId = String(req.body?.orderId || "").trim();
    const reason = String(req.body?.reason || "admin_cancel").trim() || "admin_cancel";
    const requestedAmount = Number(req.body?.amount || 0);
    if (!orderId) { sendJson(req, res, 400, { message: "Order ID is required." }); return; }

    const originalSnap = await db.collection(REVENUE_EVENTS_COLLECTION)
      .where("orderId", "==", orderId)
      .limit(5)
      .get();
    const originalDoc = originalSnap.docs.find((doc) => ["membership_paid", "matchmaker_subscription_paid"].includes(String(doc.data()?.eventType || "")));
    if (!originalDoc) { sendJson(req, res, 404, { message: "Original revenue event not found." }); return; }
    const originalEvent = originalDoc.data() || {};
    if (memberId && String(originalEvent.memberId || "") !== memberId) {
      sendJson(req, res, 400, { message: "Order does not belong to the provided member." });
      return;
    }

    const existingRefundSnap = await db.collection(REVENUE_EVENTS_COLLECTION)
      .where("relatedEventId", "==", originalDoc.id)
      .where("eventType", "==", "refund_issued")
      .limit(1)
      .get();
    if (!existingRefundSnap.empty) {
      sendJson(req, res, 409, { message: "A refund has already been recorded for this order." });
      return;
    }

    const originalAmount = Math.max(0, Math.round(Number(originalEvent.amount || 0)));
    const refundAmount = Math.min(originalAmount, Math.round(Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : originalAmount));
    const paymentId = String(originalEvent.paymentId || "").trim();
    if (!paymentId) { sendJson(req, res, 400, { message: "Original payment ID is missing." }); return; }
    if (refundAmount <= 0) { sendJson(req, res, 400, { message: "Refund amount must be greater than zero." }); return; }

    const lockExpiresMs = parseTimestampMs(originalEvent.lockExpiresAt);
    const lockActive = lockExpiresMs ? lockExpiresMs > Date.now() : originalEvent.isLocked === true;
    const originalCommissionAmount = Math.max(0, roundMoney(originalEvent.agentCommissionAmount || 0));
    const agentId = String(originalEvent.agentId || "").trim();
    let commissionDoc = null;
    if (lockActive && agentId && originalCommissionAmount > 0) {
      const commissionSnap = await db.collection(REVENUE_EVENTS_COLLECTION)
        .where("relatedEventId", "==", originalDoc.id)
        .where("eventType", "==", "agent_commission")
        .where("agentId", "==", agentId)
        .limit(1)
        .get();
      commissionDoc = commissionSnap.empty ? null : commissionSnap.docs[0];
    }

    let refund = null;
    let refundAttemptError = "";
    try {
      refund = await createRazorpayRefund(paymentId, refundAmount, {
        memberId: String(originalEvent.memberId || ""),
        orderId,
        reason,
        processedBy: adminUser.uid,
      });
    } catch (refundError) {
      const allowLedgerFallback = isFunctionsEmulatorRuntime() ||
        (isRazorpayTestMode() && process.env.PARICHAYAM_TEST_REFUND_FALLBACK === "true");
      if (!allowLedgerFallback) {
        await writeAdminAlert({
          type: "razorpay_refund_failed",
          severity: "warning",
          title: "Razorpay refund failed",
          message: String(refundError?.message || "Refund API call failed before ledger events were created."),
          memberId: String(originalEvent.memberId || ""),
          orderId,
          paymentId,
          relatedCollection: REVENUE_EVENTS_COLLECTION,
          relatedId: originalDoc.id,
          source: "process_refund",
        });
        throw refundError;
      }
      refundAttemptError = refundError?.message || String(refundError || "Unknown Razorpay emulator error");
      logger.warn("processRefund: Razorpay refund failed in emulator; recording ledger fallback.", {
        orderId,
        paymentId,
        refundAttemptError,
      });
      await writeAdminAlert({
        type: "razorpay_refund_test_fallback",
        severity: "warning",
        title: "Razorpay refund fallback recorded",
        message: refundAttemptError,
        memberId: String(originalEvent.memberId || ""),
        orderId,
        paymentId,
        relatedCollection: REVENUE_EVENTS_COLLECTION,
        relatedId: originalDoc.id,
        source: "process_refund",
      });
      refund = {
        id: safeRevenueEventId("emulator_refund", `${paymentId}_${Date.now()}`),
        status: "emulator_refund_attempt_failed",
      };
    }

    const refundEventId = safeRevenueEventId("refund_issued", refund.id || `${paymentId}_${Date.now()}`);
    const clawbackAmount = lockActive && agentId ? originalCommissionAmount : 0;
    const clawbackEventId = clawbackAmount > 0 ? safeRevenueEventId("commission_clawback", refund.id || `${paymentId}_${Date.now()}`) : "";
    const originalMetadata = originalEvent.metadata || {};
    const baseMetadata = {
      memberTier: normalizeRevenueMemberTier({ memberTier: originalMetadata.memberTier }, originalMetadata.memberTier),
      planDurationDays: Math.max(0, Math.round(Number(originalMetadata.planDurationDays || 0))),
      basePrice: Math.max(0, Math.round(Number(originalMetadata.basePrice || 0))),
      discountApplied: Math.max(0, Math.round(Number(originalMetadata.discountApplied || 0))),
      paymentGateway: "razorpay",
      notes: String(req.body?.notes || `Refund issued: ${reason}`),
    };

    await db.runTransaction(async (transaction) => {
      const freshOriginal = await transaction.get(originalDoc.ref);
      if (!freshOriginal.exists) {
        const err = new Error("Original revenue event not found.");
        err.status = 404;
        throw err;
      }
      transaction.create(db.collection(REVENUE_EVENTS_COLLECTION).doc(refundEventId), {
        eventType: "refund_issued",
        memberId: String(originalEvent.memberId || ""),
        amount: -refundAmount,
        currency: "INR",
        orderId,
        paymentId,
        agentId,
        agentCommissionRate: Number(originalEvent.agentCommissionRate || 0),
        agentCommissionAmount: 0,
        refundReason: reason,
        relatedEventId: originalDoc.id,
        lockExpiresAt: null,
        isLocked: false,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: adminUser.uid,
        metadata: {
          ...baseMetadata,
          razorpayRefundId: String(refund.id || ""),
          refundAttemptError,
        },
        status: "recorded",
        version: REVENUE_SCHEMA_VERSION,
      });

      if (clawbackAmount > 0) {
        transaction.create(db.collection(REVENUE_EVENTS_COLLECTION).doc(clawbackEventId), {
          eventType: "commission_clawback",
          memberId: String(originalEvent.memberId || ""),
          amount: -clawbackAmount,
          currency: "INR",
          orderId: "",
          paymentId: "",
          agentId,
          agentCommissionRate: Number(originalEvent.agentCommissionRate || 0),
          agentCommissionAmount: -clawbackAmount,
          refundReason: reason,
          relatedEventId: originalDoc.id,
          lockExpiresAt: null,
          isLocked: false,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: adminUser.uid,
          metadata: {
            ...baseMetadata,
            notes: String(req.body?.notes || `Commission clawback for refund: ${reason}`),
            originalCommissionEventId: commissionDoc?.id || "",
            razorpayRefundId: String(refund.id || ""),
            refundAttemptError,
          },
          status: "recorded",
          version: REVENUE_SCHEMA_VERSION,
        });
        if (commissionDoc) transaction.update(commissionDoc.ref, { status: "disputed" });
      }
    });

    if (String(originalEvent.eventType || "") === "matchmaker_subscription_paid") {
      const subscriptionId = String(originalEvent.metadata?.matchmakerSubscriptionId || "").trim();
      const memberUid = String(originalEvent.memberId || "").trim();
      if (subscriptionId) {
        await db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION).doc(subscriptionId).set({
          status: "cancelled",
          cancelledAt: FieldValue.serverTimestamp(),
          cancelReason: `Refunded by admin: ${reason}`,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => null);
      }
      if (memberUid) {
        await db.collection(MEMBERS_COLLECTION).doc(memberUid).set({
          matchmakerActive: false,
          matchmakerSubscriptionId: "",
          matchmakerPlan: "",
          assignedMatchmakerUid: "",
          assignedMatchmakerName: "",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => null);
        await logActivity({
          memberUid,
          actor: { type: "admin", uid: adminUser.uid, name: "Admin" },
          eventType: ACTIVITY_EVENT_TYPES.ADMIN_REFUND_ISSUED,
          details: { orderId, refundEventId, subscriptionId, reason },
          relatedDocs: [{ collection: REVENUE_EVENTS_COLLECTION, id: refundEventId }],
          visibility: { member: true, matchmaker: true, admin: true },
        }).catch(() => null);
      }
    }

    sendJson(req, res, 200, {
      ok: true,
      refundId: String(refund.id || ""),
      refundEventId,
      clawbackEventId,
      status: String(refund.status || "processed"),
      refundAttemptError,
      lockActive,
      refundedAmount: refundAmount,
      clawbackAmount,
    });
  } catch (error) {
    logger.error("processRefund failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to process refund." });
  }
});

// Admin: Backfill Revenue Events
exports.adminBackfillRevenueEvents = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const dryRun = req.body?.dryRun !== false;
    const limit = Math.max(0, Math.min(10000, parseInt(req.body?.limit ?? req.query?.limit ?? 0, 10) || 0));
    const snap = await db.collection(MEMBERS_COLLECTION).get();
    let batch = db.batch();
    let pendingWrites = 0;
    let scanned = 0;
    let createdMembershipEvents = 0;
    let createdCommissionEvents = 0;
    let skippedExisting = 0;
    let skippedUnpaid = 0;
    let skippedInvalidAmount = 0;
    const wouldBackfillMemberIds = [];

    async function flushBatch(force) {
      if (!pendingWrites || (!force && pendingWrites < 400)) return;
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    }

    for (const doc of snap.docs) {
      if (limit && scanned >= limit) break;
      scanned++;
      const memberData = doc.data() || {};
      const paidAtMs = parseTimestampMs(memberData.paidAt || memberData.lastPaymentAt);
      if (!paidAtMs) {
        skippedUnpaid++;
        continue;
      }
      const amount = Math.max(0, Math.round(Number(memberData.lastPaymentAmount || 0)));
      if (amount <= 0) {
        skippedInvalidAmount++;
        continue;
      }

      const paymentId = String(memberData.lastPaymentId || memberData.paymentId || "").trim();
      const orderId = String(memberData.lastOrderId || memberData.razorpayOrderId || memberData.orderId || "").trim();
      const agentInfo = await resolveRevenueAgentForMember(memberData);
      const events = buildMembershipRevenueEvents({
        memberId: doc.id,
        memberData: {
          ...memberData,
          paidAt: revenueTimestampFromMs(paidAtMs),
          lastPaymentAmount: amount,
        },
        orderData: {
          amountInr: amount,
          plan: memberData.plan || memberData.pendingPlan || "",
          planName: memberData.planName || "",
          basePrice: computeRevenueBasePrice(amount, {}, memberData),
          discountApplied: Number(memberData.discountApplied || 0),
        },
        orderId,
        paymentId,
        agentInfo,
        createdBy: "system_backfill",
        createdAt: revenueTimestampFromMs(paidAtMs),
        notes: `Backfilled membership payment for ${memberData.name || memberData.fullName || doc.id}`,
      });

      const membershipRef = db.collection(REVENUE_EVENTS_COLLECTION).doc(events.membershipEventId);
      const commissionRef = events.commissionEvent ? db.collection(REVENUE_EVENTS_COLLECTION).doc(events.commissionEventId) : null;
      const existingSnaps = await Promise.all([
        membershipRef.get(),
        commissionRef ? commissionRef.get() : Promise.resolve(null),
      ]);
      if (existingSnaps[0].exists || existingSnaps[1]?.exists) {
        skippedExisting++;
        continue;
      }

      createdMembershipEvents++;
      if (events.commissionEvent) createdCommissionEvents++;
      if (wouldBackfillMemberIds.length < 100) wouldBackfillMemberIds.push(doc.id);
      if (dryRun) continue;

      batch.create(membershipRef, events.membershipEvent);
      pendingWrites++;
      if (events.commissionEvent) {
        batch.create(commissionRef, events.commissionEvent);
        pendingWrites++;
      }
      await flushBatch(false);
    }
    await flushBatch(true);

    sendJson(req, res, 200, {
      ok: true,
      dryRun,
      scanned,
      createdMembershipEvents,
      createdCommissionEvents,
      skippedExisting,
      skippedUnpaid,
      skippedInvalidAmount,
      wouldBackfillMemberIds,
      createdBy: adminUser.uid,
    });
  } catch (error) {
    logger.error("adminBackfillRevenueEvents failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to backfill revenue events." });
  }
});

// Admin: Backfill Commission Unlock Notification Fields
exports.adminBackfillCommissionNotifyFields = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const dryRun = req.body?.dryRun !== false;
    const limit = Math.max(1, Math.min(10000, parseInt(req.body?.limit ?? req.query?.limit ?? 1000, 10) || 1000));
    const snap = await db.collection(REVENUE_EVENTS_COLLECTION)
      .where("eventType", "==", "agent_commission")
      .where("status", "==", "recorded")
      .limit(limit)
      .get();
    let batch = db.batch();
    let pendingWrites = 0;
    let scanned = 0;
    let wouldUpdate = 0;
    let updated = 0;
    let skippedMissingLockExpiresAt = 0;
    const sampleIds = [];

    async function flushBatch(force) {
      if (!pendingWrites || (!force && pendingWrites < 400)) return;
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    }

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};
      const update = {};
      if (!Object.prototype.hasOwnProperty.call(data, "commissionUnlockNotifyAt")) {
        if (!data.lockExpiresAt) {
          skippedMissingLockExpiresAt++;
        } else {
          update.commissionUnlockNotifyAt = data.lockExpiresAt;
        }
      }
      if (!Object.prototype.hasOwnProperty.call(data, "commissionUnlockedNotifiedAt")) {
        update.commissionUnlockedNotifiedAt = null;
      }
      if (!Object.keys(update).length) continue;
      wouldUpdate++;
      if (sampleIds.length < 25) sampleIds.push(doc.id);
      if (dryRun) continue;
      batch.set(doc.ref, update, { merge: true });
      pendingWrites++;
      updated++;
      await flushBatch(false);
    }
    await flushBatch(true);

    sendJson(req, res, 200, {
      ok: true,
      dryRun,
      scanned,
      wouldUpdate,
      updated,
      skippedMissingLockExpiresAt,
      sampleIds,
      processedBy: adminUser.uid,
    });
  } catch (error) {
    logger.error("adminBackfillCommissionNotifyFields failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to backfill commission notification fields." });
  }
});

// Admin: Reset Agent Password
exports.adminResetAgentPassword = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    await verifyAdminUser(req);
    const agentId = String(req.body?.agentId || "").trim();
    if (!agentId) { sendJson(req, res, 400, { message: "Agent ID is required." }); return; }
    const agentSnap = await db.collection(AGENTS_COLLECTION).doc(agentId).get();
    if (!agentSnap.exists) { sendJson(req, res, 404, { message: "Agent not found." }); return; }
    const mobile = agentSnap.data()?.mobile || "";
    const tempPassword = "Agent" + mobile.slice(-4) + "!" + Math.random().toString(36).slice(-3).toUpperCase();
    await admin.auth().updateUser(agentId, { password: tempPassword });
    await db.collection(AGENTS_COLLECTION).doc(agentId).set({ passwordChangedAt: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    sendJson(req, res, 200, { ok: true, tempPassword });
  } catch (error) {
    logger.error("adminResetAgentPassword failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to reset password." });
  }
});

// ── Admin: List/Process Agent Applications ──
exports.adminListAgentApplications = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    await verifyAdminUser(req);
    const snap = await db.collection("agentApplications").orderBy("appliedAt", "desc").get();
    const applications = [];
    snap.forEach(doc => { applications.push({ id: doc.id, ...doc.data() }); });
    sendJson(req, res, 200, { ok: true, applications });
  } catch (error) {
    logger.error("adminListAgentApplications failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to list applications." });
  }
});

// ── Agent: Get Dashboard ──
exports.agentGetDashboard = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const { agent } = await verifyAgentUser(req);
    await ensureAgentDashboardDefaults();

    // Update lastActiveAt
    await db.collection(AGENTS_COLLECTION).doc(agent.id).set({ lastActiveAt: FieldValue.serverTimestamp() }, { merge: true });

    // Get leads summary
    const leadsSnap = await db.collection(AGENT_LEADS_COLLECTION).where("agentId", "==", agent.id).get();
    const leads = [];
    const stageCounts = {};
    VALID_LEAD_STAGES.forEach(s => { stageCounts[s] = 0; });
    leadsSnap.forEach(doc => {
      const d = { id: doc.id, ...doc.data() };
      leads.push(d);
      if (stageCounts[d.stage] !== undefined) stageCounts[d.stage]++;
    });
    const enrichedLeads = await enrichAgentLeadsWithMemberState(leads);

    // Today's follow-ups
    const today = new Date().toISOString().slice(0, 10);
    const followUps = enrichedLeads.filter(l => l.followUpDate && l.followUpDate <= today && l.stage !== "converted" && l.stage !== "inactive" && !l.followUpDone);

    // Balance
    const balance = await computeAgentBalance(agent.id);
    const [commissionSettings, tiers, leaderboard, thisMonth, festivals, whatsappTemplates, marketingMaterials] = await Promise.all([
      readAgentCommissionSettings(),
      readAgentTierConfig(),
      buildAgentLeaderboard(agent.id),
      buildAgentMonthlyPerformance(agent.id),
      listSeededCollection(FESTIVALS_COLLECTION, DEFAULT_FESTIVALS),
      listSeededCollection(WHATSAPP_TEMPLATES_COLLECTION, DEFAULT_WHATSAPP_TEMPLATES),
      listSeededCollection(MARKETING_MATERIALS_COLLECTION, DEFAULT_MARKETING_MATERIALS),
    ]);
    const tierProgress = await buildAgentTierProgress(agent.id, agent, balance.eventCount || agent.totalConversions || 0);

    // Recent activity
    const activity = [];
    try {
      const activitySnap = await db.collection(AGENT_ACTIVITY_COLLECTION)
        .where("agentId", "==", agent.id)
        .orderBy("createdAt", "desc")
        .limit(10)
        .get();
      activitySnap.forEach(doc => { activity.push({ id: doc.id, ...doc.data() }); });
    } catch (activityError) {
      const code = Number(activityError?.code);
      const message = String(activityError?.message || "");
      const isIndexDelay = code === 9 || message.includes("FAILED_PRECONDITION") || message.includes("requires an index");
      if (!isIndexDelay) throw activityError;
      logger.warn("agentGetDashboard recentActivity skipped while index builds", {
        agentId: agent.id,
        code: activityError?.code || null,
        message,
      });
    }

    const payoutHistory = [];
    try {
      const payoutSnap = await db.collection("agentPayoutRequests").where("agentId", "==", agent.id).limit(20).get();
      payoutSnap.forEach((doc) => { payoutHistory.push({ id: doc.id, ...doc.data() }); });
      payoutHistory.sort((a, b) => extractComparableTimestamp(b?.requestedAt || b?.createdAt) - extractComparableTimestamp(a?.requestedAt || a?.createdAt));
    } catch (payoutError) {
      logger.warn("agentGetDashboard payoutHistory skipped", {
        agentId: agent.id,
        code: payoutError?.code || null,
        message: payoutError?.message || String(payoutError || ""),
      });
    }

    // Conversion rate
    const registered = enrichedLeads.filter(l => ["registered", "profile_complete", "payment_pending", "converted"].includes(l.stage)).length;
    const converted = enrichedLeads.filter(l => l.stage === "converted").length;
    const conversionRate = registered > 0 ? Math.round((converted / registered) * 100) : 0;

    sendJson(req, res, 200, {
      ok: true,
      agent: { ...agent, ...balance, currentTier: tierProgress.currentTier.name, commissionTier: tierProgress.currentTier.name, commissionPercent: tierProgress.currentTier.commissionRate },
      kpi: {
        totalLeads: enrichedLeads.length,
        converted,
        conversionRate,
        thisMonthEarnings: thisMonth.commission,
        availableBalance: balance.availableBalance,
        pendingPayoutAmount: balance.pendingPayoutAmount,
      },
      commissionSummary: balance,
      settings: {
        commission: commissionSettings,
        tiers,
      },
      tierProgress,
      thisMonth,
      leaderboard,
      festivals: festivals.filter((item) => item.enabled !== false),
      whatsappTemplates: whatsappTemplates.filter((item) => item.enabled !== false),
      marketingMaterials: marketingMaterials.filter((item) => item.enabled !== false),
      stageCounts,
      followUps: followUps.slice(0, 10),
      recentActivity: activity,
      payoutHistory: payoutHistory.slice(0, 10),
      minimumPayoutAmount: commissionSettings.minimumPayoutAmount,
    });
  } catch (error) {
    logger.error("agentGetDashboard failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load dashboard." });
  }
});

// ── Agent: Get Leads ──
exports.agentGetLeads = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const { agent } = await verifyAgentUser(req);
    const snap = await db.collection(AGENT_LEADS_COLLECTION).where("agentId", "==", agent.id).orderBy("updatedAt", "desc").get();
    const leads = [];
    snap.forEach(doc => { leads.push({ id: doc.id, ...doc.data() }); });
    const enrichedLeads = await enrichAgentLeadsWithMemberState(leads);
    sendJson(req, res, 200, { ok: true, leads: enrichedLeads });
  } catch (error) {
    logger.error("agentGetLeads failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load leads." });
  }
});

// ── Agent: Add Lead ──
exports.agentAddLead = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const { agent } = await verifyAgentUser(req);
    requireActiveAgent(agent);
    await enforceAuthRateLimit("agentAddLead:uid", agent.id, 50, 60 * 60 * 1000, "Too many leads added. Please try again later.");

    const name = String(req.body?.name || "").trim();
    const mobile = normalizePhone(req.body?.mobile || "");
    const city = String(req.body?.city || "").trim();
    const note = String(req.body?.note || "").trim();

    if (!name) { sendJson(req, res, 400, { message: "Lead name is required." }); return; }
    if (mobile.length < 10) { sendJson(req, res, 400, { message: "Valid 10-digit mobile is required." }); return; }

    // Check for duplicate lead under this agent
    const dupeSnap = await db.collection(AGENT_LEADS_COLLECTION).where("agentId", "==", agent.id).where("mobile", "==", mobile).limit(1).get();
    if (!dupeSnap.empty) { sendJson(req, res, 409, { message: "You already have a lead with this mobile number." }); return; }

    const leadDoc = {
      agentId: agent.id,
      agentName: agent.name || "",
      name, mobile, city,
      stage: "new",
      source: "manual",
      memberUid: "",
      notes: note ? [{ text: note, at: nowIso(), by: "agent" }] : [],
      followUpDate: "",
      followUpDone: false,
      commissionCredited: false,
      commissionAmount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const docRef = await db.collection(AGENT_LEADS_COLLECTION).add(leadDoc);

    // Update agent lead count
    await db.collection(AGENTS_COLLECTION).doc(agent.id).set({ totalLeads: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await logAgentActivity(agent.id, "lead_added", `Added lead ${name} (${mobile}).`, { leadId: docRef.id, leadName: name });

    sendJson(req, res, 200, { ok: true, lead: { id: docRef.id, ...leadDoc, createdAt: nowIso(), updatedAt: nowIso() } });
  } catch (error) {
    logger.error("agentAddLead failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to add lead." });
  }
});

// ── Agent: Update Lead ──
exports.agentUpdateLead = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const { agent } = await verifyAgentUser(req);
    requireActiveAgent(agent);
    const leadId = String(req.body?.leadId || "").trim();
    if (!leadId) { sendJson(req, res, 400, { message: "Lead ID is required." }); return; }

    const leadRef = db.collection(AGENT_LEADS_COLLECTION).doc(leadId);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) { sendJson(req, res, 404, { message: "Lead not found." }); return; }
    if (leadSnap.data().agentId !== agent.id) { sendJson(req, res, 403, { message: "This lead does not belong to you." }); return; }

    const updates = { updatedAt: FieldValue.serverTimestamp() };

    // Stage change
    if (req.body?.stage && VALID_LEAD_STAGES.includes(req.body.stage)) {
      const currentStage = leadSnap.data().stage;
      if (req.body.stage === "converted" && currentStage !== "converted") {
        sendJson(req, res, 400, { message: "Conversion is automatic when the member pays. You cannot manually mark as converted." });
        return;
      }
      updates.stage = req.body.stage;
      if (req.body.stage !== currentStage) {
        await logAgentActivity(agent.id, "stage_changed", `Lead ${leadSnap.data().name} moved from ${currentStage} to ${req.body.stage}.`, { leadId, leadName: leadSnap.data().name });
      }
    }

    // Add note
    if (req.body?.note) {
      const noteText = String(req.body.note).trim().slice(0, 500);
      if (noteText) {
        updates.notes = FieldValue.arrayUnion({ text: noteText, at: nowIso(), by: "agent" });
        await logAgentActivity(agent.id, "note_added", `Note added to lead ${leadSnap.data().name}.`, { leadId, leadName: leadSnap.data().name });
      }
    }

    // Follow-up
    if (req.body?.followUpDate !== undefined) {
      updates.followUpDate = String(req.body.followUpDate || "").trim().slice(0, 10);
      updates.followUpDone = false;
    }
    if (req.body?.followUpDone === true) {
      updates.followUpDone = true;
    }

    await leadRef.set(updates, { merge: true });
    const updated = await leadRef.get();
    sendJson(req, res, 200, { ok: true, lead: { id: leadId, ...updated.data() } });
  } catch (error) {
    logger.error("agentUpdateLead failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to update lead." });
  }
});

// ── Agent: Request Payout (Server-Side Validated) ──
exports.agentRequestPayout = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const { agent } = await verifyAgentUser(req);
    requireActiveAgent(agent);
    await enforceAuthRateLimit("agentRequestPayout:uid", agent.id, 5, 60 * 60 * 1000, "Too many payout requests. Please try again later.");

    if (agent.payoutHold) {
      sendJson(req, res, 403, { message: "Payouts are temporarily held. " + (agent.payoutHoldReason || "Contact admin for details.") });
      return;
    }

    // Check no pending request exists
    const pendingSnap = await db.collection("agentPayoutRequests").where("agentId", "==", agent.id).where("status", "==", "requested").limit(1).get();
    if (!pendingSnap.empty) { sendJson(req, res, 400, { message: "You already have a pending payout request. Wait for admin to process it." }); return; }

    // Server-side balance calculation
    const balance = await computeAgentBalance(agent.id);
    const minimumPayoutAmount = Number(balance.minimumPayoutAmount || AGENT_MIN_PAYOUT);
    if (balance.availableBalance < minimumPayoutAmount) {
      sendJson(req, res, 400, { message: "Minimum payout is Rs " + minimumPayoutAmount + ". Your available balance is Rs " + balance.availableBalance + "." });
      return;
    }

    const upiId = String(req.body?.upiId || agent.upiId || "").trim();
    const note = String(req.body?.note || "").trim().slice(0, 300);

    const payoutDoc = {
      agentId: agent.id,
      agentName: agent.name || "",
      agentMobile: agent.mobile || "",
      amount: balance.availableBalance,
      upiId,
      note,
      status: "requested",
      requestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };
    const docRef = await db.collection("agentPayoutRequests").add(payoutDoc);

    // Save UPI ID to agent profile if provided
    if (upiId && upiId !== agent.upiId) {
      await db.collection(AGENTS_COLLECTION).doc(agent.id).set({ upiId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    await logAgentActivity(agent.id, "payout_requested", `Payout of Rs ${balance.availableBalance} requested.`);
    sendJson(req, res, 200, { ok: true, requestId: docRef.id, amount: balance.availableBalance });
  } catch (error) {
    logger.error("agentRequestPayout failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to submit payout request." });
  }
});

// ── Agent: Update Profile (own UPI, etc.) ──
exports.agentUpdateProfile = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const { agent } = await verifyAgentUser(req);
    requireActiveAgent(agent);
    const updates = { updatedAt: FieldValue.serverTimestamp() };
    if (req.body?.upiId !== undefined) updates.upiId = String(req.body.upiId).trim();
    if (req.body?.area !== undefined) updates.area = String(req.body.area).trim();
    if (req.body?.whatsapp !== undefined) updates.whatsapp = normalizePhone(req.body.whatsapp || "");
    if (req.body?.languages !== undefined) {
      updates.languages = Array.isArray(req.body.languages)
        ? req.body.languages.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
        : String(req.body.languages || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 6);
    }
    if (req.body?.tdsPreference !== undefined) updates.tdsPreference = req.body.tdsPreference === true;
    await db.collection(AGENTS_COLLECTION).doc(agent.id).set(updates, { merge: true });
    const updated = await db.collection(AGENTS_COLLECTION).doc(agent.id).get();
    sendJson(req, res, 200, { ok: true, agent: { id: agent.id, ...updated.data() } });
  } catch (error) {
    logger.error("agentUpdateProfile failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to update profile." });
  }
});

// ── Agent: Change Password ──
exports.agentChangePassword = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const { agent } = await verifyAgentUser(req);
    requireActiveAgent(agent);
    
    const newPassword = String(req.body?.newPassword || "").trim();
    if (!newPassword || newPassword.length < 8) {
      sendJson(req, res, 400, { message: "Password must be at least 8 characters." });
      return;
    }

    await admin.auth().updateUser(agent.id, { password: newPassword });
    const updates = { passwordChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
    await db.collection(AGENTS_COLLECTION).doc(agent.id).set(updates, { merge: true });
    
    await logAgentActivity(agent.id, "password_changed", "Agent securely changed their password.");
    sendJson(req, res, 200, { ok: true, message: "Password updated successfully" });
  } catch (error) {
    logger.error("agentChangePassword failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to update password." });
  }
});

function currentFinancialYearStartMs() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 3, 1).getTime();
}

async function loadMembersForLedger(memberIds) {
  const unique = Array.from(new Set((memberIds || []).filter(Boolean).map(String)));
  if (!unique.length) return new Map();
  const refs = unique.map((id) => db.collection(MEMBERS_COLLECTION).doc(id));
  const docs = await db.getAll(...refs);
  const map = new Map();
  docs.forEach((doc) => {
    if (doc.exists) map.set(doc.id, doc.data() || {});
  });
  return map;
}

async function buildAgentLedger(agentId) {
  const [eventsSnap, payoutsSnap] = await Promise.all([
    db.collection(REVENUE_EVENTS_COLLECTION).where("agentId", "==", agentId).get(),
    db.collection("agentPayoutRequests").where("agentId", "==", agentId).get(),
  ]);
  const events = eventsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((event) => ["agent_commission", "commission_clawback"].includes(String(event.eventType || "")))
    .sort((a, b) => parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt));
  const memberMap = await loadMembersForLedger(events.map((event) => event.memberId));
  const nowMs = Date.now();
  const fyStart = currentFinancialYearStartMs();
  let fyTotal = 0;
  const rows = events.map((event) => {
    const amount = roundMoney(event.agentCommissionAmount || event.amount || 0);
    const rate = Math.round(Number(event.agentCommissionRate || 0) * 10000) / 100;
    const member = memberMap.get(String(event.memberId || "")) || {};
    const createdMs = parseTimestampMs(event.createdAt);
    const lockExpiresMs = parseTimestampMs(event.lockExpiresAt);
    const status = String(event.status || "recorded").toLowerCase();
    const isClawback = String(event.eventType || "") === "commission_clawback";
    if (createdMs >= fyStart && status !== "disputed") fyTotal += amount;
    const memberPayment = Math.max(0, Math.round(Number(event.metadata?.memberPaymentAmount || (rate ? Math.abs(amount) / (rate / 100) : 0)) || 0));
    return {
      id: event.id,
      date: event.createdAt || "",
      memberId: String(event.memberId || ""),
      memberName: firstName(member.name || member.fullName || event.metadata?.memberName || ""),
      tier: String(event.metadata?.memberTier || event.metadata?.agentTierName || ""),
      memberPayment,
      commissionRate: rate,
      commissionAmount: amount,
      lockStatus: isClawback ? "Disputed" : status === "disputed" ? "Disputed" : lockExpiresMs > nowMs ? "Locked" : "Available",
      lockExpiresAt: event.lockExpiresAt || null,
      orderId: String(event.orderId || ""),
      paymentId: String(event.paymentId || ""),
      eventType: String(event.eventType || ""),
      status,
    };
  });
  const payoutHistory = payoutsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .sort((a, b) => parseTimestampMs(b.requestedAt || b.createdAt) - parseTimestampMs(a.requestedAt || a.createdAt));
  return {
    rows,
    payoutHistory,
    taxSummary: {
      financialYearStart: revenueTimestampFromMs(fyStart),
      totalThisFy: roundMoney(fyTotal),
    },
  };
}

exports.agentGetCommissionLedger = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const { agent } = await verifyAgentUser(req);
    const ledger = await buildAgentLedger(agent.id);
    sendJson(req, res, 200, { ok: true, ...ledger });
  } catch (error) {
    logger.error("agentGetCommissionLedger failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load commission ledger." });
  }
});

async function readNotificationCostSummary() {
  const sinceMs = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const snap = await db.collection(NOTIFICATION_LOG_COLLECTION).limit(500).get();
  let count = 0;
  let cost = 0;
  snap.forEach((doc) => {
    const log = doc.data() || {};
    if (parseTimestampMs(log.createdAt) < sinceMs) return;
    count++;
    cost += Number(log.estimatedCost || 0);
  });
  return { last30DaysCount: count, estimatedMonthlyCost: roundMoney(cost) };
}

exports.getAgentSettings = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const [memberSnap, agentSnap] = await Promise.all([
      db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get(),
      db.collection(AGENTS_COLLECTION).doc(authUser.uid).get(),
    ]);
    const isAdminUser = memberSnap.exists && String(memberSnap.data()?.role || "").toUpperCase() === "ADMIN";
    if (!isAdminUser && !agentSnap.exists) {
      sendJson(req, res, 403, { message: "Agent or admin access required." });
      return;
    }
    await ensureAgentDashboardDefaults();
    const [commissionSettings, tiers, leaderboardSettings, whatsappSettings, festivals, whatsappTemplates, marketingMaterials, costSummary, activeAgentsSnap] = await Promise.all([
      readAgentCommissionSettings(),
      readAgentTierConfig(),
      readLeaderboardSettings(),
      readWhatsappNotificationSettings(),
      listSeededCollection(FESTIVALS_COLLECTION, DEFAULT_FESTIVALS),
      listSeededCollection(WHATSAPP_TEMPLATES_COLLECTION, DEFAULT_WHATSAPP_TEMPLATES),
      listSeededCollection(MARKETING_MATERIALS_COLLECTION, DEFAULT_MARKETING_MATERIALS),
      readNotificationCostSummary(),
      db.collection(AGENTS_COLLECTION).where("status", "==", "active").get(),
    ]);
    sendJson(req, res, 200, {
      ok: true,
      commissionSettings,
      tiers,
      leaderboardSettings,
      whatsappSettings,
      festivals,
      whatsappTemplates,
      marketingMaterials,
      notificationCost: costSummary,
      activeAgentCount: activeAgentsSnap.size,
    });
  } catch (error) {
    logger.error("getAgentSettings failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load agent settings." });
  }
});

function cleanDocForAdminCollection(item, defaults) {
  const id = String(item?.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    ...(defaults || {}),
    ...(item || {}),
    id: id || String(defaults?.id || Date.now()),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

exports.adminSaveAgentSettings = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const batch = db.batch();
    if (req.body?.commissionSettings !== undefined) {
      batch.set(db.collection(APP_STATE_COLLECTION).doc(AGENT_COMMISSION_SETTINGS_KEY), {
        value: normalizeAgentCommissionSettings(req.body.commissionSettings),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid,
      }, { merge: true });
    }
    if (req.body?.tiers !== undefined) {
      batch.set(db.collection(APP_STATE_COLLECTION).doc(AGENT_TIERS_KEY), {
        value: { tiers: normalizeAgentTiers(req.body.tiers) },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid,
      }, { merge: true });
    }
    if (req.body?.leaderboardSettings !== undefined) {
      batch.set(db.collection(APP_STATE_COLLECTION).doc(LEADERBOARD_SETTINGS_KEY), {
        value: normalizeLeaderboardSettings(req.body.leaderboardSettings),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid,
      }, { merge: true });
    }
    if (req.body?.whatsappSettings !== undefined) {
      batch.set(db.collection(APP_STATE_COLLECTION).doc(WHATSAPP_NOTIFICATION_SETTINGS_KEY), {
        value: normalizeWhatsappNotificationSettings(req.body.whatsappSettings),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid,
      }, { merge: true });
    }
    (Array.isArray(req.body?.festivals) ? req.body.festivals : []).forEach((festival) => {
      const doc = cleanDocForAdminCollection(festival, {});
      batch.set(db.collection(FESTIVALS_COLLECTION).doc(doc.id), doc, { merge: true });
    });
    (Array.isArray(req.body?.whatsappTemplates) ? req.body.whatsappTemplates : []).forEach((template) => {
      const doc = cleanDocForAdminCollection(template, {});
      batch.set(db.collection(WHATSAPP_TEMPLATES_COLLECTION).doc(doc.id), doc, { merge: true });
    });
    (Array.isArray(req.body?.marketingMaterials) ? req.body.marketingMaterials : []).forEach((material) => {
      const doc = cleanDocForAdminCollection(material, {});
      batch.set(db.collection(MARKETING_MATERIALS_COLLECTION).doc(doc.id), doc, { merge: true });
    });
    await batch.commit();
    await ensureAgentDashboardDefaults();
    sendJson(req, res, 200, { ok: true });
  } catch (error) {
    logger.error("adminSaveAgentSettings failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to save agent settings." });
  }
});

exports.adminSendTestAgentNotification = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const [agentSnap, memberSnap] = await Promise.all([
      db.collection(AGENTS_COLLECTION).doc(adminUser.uid).get(),
      db.collection(MEMBERS_COLLECTION).doc(adminUser.uid).get(),
    ]);
    const agent = agentSnap.exists ? { id: agentSnap.id, ...(agentSnap.data() || {}) } : null;
    const member = memberSnap.exists ? (memberSnap.data() || {}) : {};
    const phone = normalizeWhatsappPhone(req.body?.phone || agent?.whatsapp || agent?.mobile || member.whatsapp || member.phone || "");
    if (!phone) {
      sendJson(req, res, 400, { message: "No WhatsApp number found for this admin. Add one to your agent/member profile or pass phone." });
      return;
    }
    const message = String(req.body?.message || "Parichayam WhatsApp test notification. Credentials are working.").trim();
    const providerResult = await sendWhatsappViaProvider(phone, message, "adminTest");
    await logNotification({
      agentId: agent?.id || adminUser.uid,
      trigger: "adminTest",
      channel: "whatsapp",
      provider: String(process.env.WHATSAPP_API_PROVIDER || "interakt"),
      status: "sent",
      phone,
      messagePreview: message.slice(0, 160),
      estimatedCost: DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS.estimatedCostPerMessage,
      providerResult,
      sentBy: adminUser.uid,
    });
    sendJson(req, res, 200, { ok: true, phone, provider: String(process.env.WHATSAPP_API_PROVIDER || "interakt") });
  } catch (error) {
    logger.error("adminSendTestAgentNotification failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to send test notification." });
  }
});

exports.updateAgentTiers = onSchedule({
  schedule: "15 2 * * *",
  timeZone: "Asia/Kolkata",
  region: "us-central1",
}, async () => {
  const tiers = await readAgentTierConfig();
  const agentsSnap = await db.collection(AGENTS_COLLECTION).get();
  const updates = [];
  for (const doc of agentsSnap.docs) {
    const agent = doc.data() || {};
    const paidReferralCount = await countAgentPaidReferrals(doc.id);
    const { current } = chooseAgentTier(tiers, paidReferralCount);
    const previousTier = String(agent.currentTier || agent.commissionTier || "");
    updates.push(db.collection(AGENTS_COLLECTION).doc(doc.id).set({
      paidReferralCount,
      currentTier: current.name,
      commissionTier: current.name,
      tierId: current.id,
      commissionPercent: current.commissionRate,
      tierMonthlyBonus: current.monthlyBonus,
      tierUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    if (previousTier && previousTier !== current.name) {
      updates.push(logAgentActivity(doc.id, "tier_upgraded", `Congratulations, you're now ${current.name}!`, { previousTier, currentTier: current.name }));
      updates.push(sendAgentNotification(doc.id, "tierUpgrade", {
        agent_name: agent.name || "Agent",
        tier_name: current.name,
      }));
    }
  }
  await Promise.all(updates);
  logger.info("updateAgentTiers completed", { count: agentsSnap.size });
});

// ── Public: Submit Agent Application ──
exports.submitAgentApplication = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const ip = extractClientIp(req);
    await enforceAuthRateLimit("agentApplication:ip", normalizeRateKeyPart(ip), 5, 60 * 60 * 1000, "Too many applications from this network. Try again later.");

    const name = String(req.body?.name || "").trim();
    const mobile = normalizePhone(req.body?.mobile || "");
    const city = String(req.body?.city || "").trim();
    const state = String(req.body?.state || "").trim();
    const network = String(req.body?.network || "").trim();
    const experience = String(req.body?.experience || "").trim().slice(0, 500);
    const source = String(req.body?.source || "").trim();

    if (!name || name.length < 2) { sendJson(req, res, 400, { message: "Enter your full name." }); return; }
    if (mobile.length < 10) { sendJson(req, res, 400, { message: "Enter a valid 10-digit mobile number." }); return; }
    if (!city) { sendJson(req, res, 400, { message: "Enter your city." }); return; }

    // Check duplicate pending application
    const dupeSnap = await db.collection("agentApplications").where("mobile", "==", mobile).where("status", "==", "pending").limit(1).get();
    if (!dupeSnap.empty) { sendJson(req, res, 409, { message: "An application with this mobile is already pending review." }); return; }

    const appDoc = {
      name, mobile, city, state, network, experience, source,
      status: "pending",
      appliedAt: FieldValue.serverTimestamp(),
    };
    const docRef = await db.collection("agentApplications").add(appDoc);
    sendJson(req, res, 200, { ok: true, applicationId: docRef.id, message: "Application submitted! We will review and contact you within 2-3 business days." });
  } catch (error) {
    logger.error("submitAgentApplication failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to submit application." });
  }
});

// ── Admin: Approve Agent Application ──
exports.adminApproveAgentApplication = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const applicationId = String(req.body?.applicationId || "").trim();
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!applicationId) { sendJson(req, res, 400, { message: "Application ID is required." }); return; }
    if (!["approve", "reject"].includes(action)) { sendJson(req, res, 400, { message: "Action must be approve or reject." }); return; }

    const appRef = db.collection("agentApplications").doc(applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) { sendJson(req, res, 404, { message: "Application not found." }); return; }
    const appData = appSnap.data();
    if (appData.status !== "pending") { sendJson(req, res, 400, { message: "This application has already been processed." }); return; }

    if (action === "reject") {
      await appRef.set({
        status: "rejected",
        rejectedAt: FieldValue.serverTimestamp(),
        rejectedBy: adminUser.uid,
        rejectReason: String(req.body?.reason || "").trim(),
      }, { merge: true });
      sendJson(req, res, 200, { ok: true, status: "rejected" });
      return;
    }

    // Approve — create agent using same logic as adminCreateAgent
    const mobile = normalizePhone(appData.mobile || "");
    const existingSnap = await db.collection(AGENTS_COLLECTION).where("mobile", "==", mobile).limit(1).get();
    if (!existingSnap.empty) { sendJson(req, res, 409, { message: "An agent with this mobile already exists." }); return; }

    const email = `${mobile}@agent.parichayam.local`;
    const tempPassword = "Agent" + mobile.slice(-4) + "!" + Math.random().toString(36).slice(-3).toUpperCase();
    let authRecord;
    try {
      authRecord = await admin.auth().createUser({ email, password: tempPassword, displayName: appData.name, disabled: false });
    } catch (authError) {
      if (authError.code === "auth/email-already-exists") { sendJson(req, res, 409, { message: "An account with this email already exists." }); return; }
      throw authError;
    }

    const referralCode = await ensureUniqueReferralCode(generateReferralCode(appData.name, appData.city));
    const commissionSettings = await readAgentCommissionSettings();
    const defaultTier = chooseAgentTier(await readAgentTierConfig(), 0).current;
    const commissionPercent = clampCommissionPercent(
      req.body?.commissionPercent !== undefined ? req.body?.commissionPercent : (defaultTier?.commissionRate ?? commissionSettings.defaultCommissionRate)
    );
    const agentDoc = {
      name: appData.name || "", mobile, email, city: appData.city || "", area: "", state: appData.state || "",
      status: "active",
      referralCode,
      commissionType: "percent",
      commissionPercent,
      commissionTier: defaultTier?.name || "Bronze",
      currentTier: defaultTier?.name || "Bronze",
      tierId: defaultTier?.id || "bronze",
      tierMonthlyBonus: defaultTier?.monthlyBonus || 0,
      paidReferralCount: 0,
      upiId: "", totalEarned: 0, totalPaidOut: 0, totalLeads: 0, totalConversions: 0,
      lastActiveAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUser.uid,
      onboardingPath: "self-apply",
      applicationId,
      statusChangedAt: FieldValue.serverTimestamp(),
      statusChangedBy: adminUser.uid,
      payoutHold: false, notes: "", passwordChangedAt: null,
    };
    await db.collection(AGENTS_COLLECTION).doc(authRecord.uid).set(agentDoc);
    await appRef.set({ status: "approved", approvedAt: FieldValue.serverTimestamp(), approvedBy: adminUser.uid, agentId: authRecord.uid }, { merge: true });
    await logAgentActivity(authRecord.uid, "agent_created", `Agent ${appData.name} approved from application.`);

    sendJson(req, res, 200, {
      ok: true, status: "approved",
      agent: { id: authRecord.uid, ...agentDoc },
      referralCode, tempPassword, loginEmail: email,
    });
  } catch (error) {
    logger.error("adminApproveAgentApplication failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to process application." });
  }
});

// ── Firestore Trigger: Auto-link member registration to agent leads ──
exports.syncAgentLeadOnMemberWrite = onDocumentWritten(
  { document: `${MEMBERS_COLLECTION}/{uid}`, region: "us-central1" },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const memberData = after.data();
    const memberUid = event.params.uid;
    const agentRefCode = String(memberData?.referredByAgentRefId || memberData?.agentRefId || "").trim().toUpperCase();
    if (!agentRefCode) return;

    try {
      // Find agent by referral code
      const agentSnap = await db.collection(AGENTS_COLLECTION).where("referralCode", "==", agentRefCode).limit(1).get();
      if (agentSnap.empty) return;
      const agentDoc = agentSnap.docs[0];
      const agentId = agentDoc.id;
      const agentTierData = await attachAgentTierSnapshot(agentId, agentDoc.data() || {});
      const phone = normalizePhone(memberData?.phone || "");

      // Check if lead already exists for this member
      let leadRef = null;
      let leadData = null;
      const existingByUid = await db.collection(AGENT_LEADS_COLLECTION).where("agentId", "==", agentId).where("memberUid", "==", memberUid).limit(1).get();
      if (!existingByUid.empty) {
        leadRef = existingByUid.docs[0].ref;
        leadData = existingByUid.docs[0].data();
      } else if (phone) {
        const existingByPhone = await db.collection(AGENT_LEADS_COLLECTION).where("agentId", "==", agentId).where("mobile", "==", phone).limit(1).get();
        if (!existingByPhone.empty) {
          leadRef = existingByPhone.docs[0].ref;
          leadData = existingByPhone.docs[0].data();
        }
      }

      // Determine appropriate stage based on member state
      let newStage = "registered";
      const profileFields = ["name", "city", "education", "profession", "dateOfBirth"];
      const filledCount = profileFields.filter(f => String(memberData?.[f] || "").trim()).length;
      if (filledCount >= 4) newStage = "profile_complete";
      if (memberData?.isPaid === true) newStage = "converted";
      else if (newStage === "profile_complete") newStage = "payment_pending";

      const trustedPaidAmount = await getTrustedPaidAmountFromMember(memberData);
      if (newStage === "converted" && trustedPaidAmount <= 0) {
        newStage = "payment_pending";
      }
      if (leadRef && leadData) {
        const agentRef = db.collection(AGENTS_COLLECTION).doc(agentId);
        let creditedConversionNow = false;
        let creditedSnapshot = null;
        await db.runTransaction(async (transaction) => {
          const leadSnap = await transaction.get(leadRef);
          if (!leadSnap.exists) return;
          const currentLead = leadSnap.data() || {};
          const updates = { memberUid, updatedAt: FieldValue.serverTimestamp() };
          if (memberData?.name) updates.name = memberData.name;
          if (phone) updates.mobile = phone;
          if (memberData?.city) updates.city = memberData.city;
          const subscriptionExpiryDate = resolveMemberSubscriptionDate(memberData);
          if (subscriptionExpiryDate) updates.subscriptionExpiryDate = subscriptionExpiryDate;

          const currentStage = String(currentLead.stage || "").trim().toLowerCase();
          const currentIdx = leadStageIndex(currentStage);
          const nextIdx = leadStageIndex(newStage);
          const shouldForceConvert = newStage === "converted" && currentStage !== "converted";
          const shouldAdvanceNormally = nextIdx > currentIdx;
          if (shouldForceConvert || shouldAdvanceNormally) {
            updates.stage = newStage;
          }

          if (newStage === "converted" && currentLead.commissionCredited !== true) {
            creditedSnapshot = computeCommissionSnapshot(agentTierData, trustedPaidAmount);
            creditedConversionNow = true;
            updates.stage = "converted";
            updates.commissionCredited = true;
            updates.commissionType = creditedSnapshot.commissionType;
            updates.commissionPercent = creditedSnapshot.commissionPercent;
            updates.commissionAmount = creditedSnapshot.commissionAmount;
            updates.paidAmount = creditedSnapshot.paidAmount;
            updates.convertedAt = FieldValue.serverTimestamp();
            transaction.set(agentRef, {
              totalEarned: FieldValue.increment(creditedSnapshot.commissionAmount),
              totalConversions: FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }

          transaction.set(leadRef, updates, { merge: true });
        });
        if (creditedConversionNow) {
          await logAgentActivity(
            agentId,
            "lead_converted",
            `Lead ${memberData?.name || phone} converted! ${creditedSnapshot.commissionPercent}% commission on Rs ${creditedSnapshot.paidAmount} credited as Rs ${creditedSnapshot.commissionAmount}.`,
            { leadId: leadRef.id, leadName: memberData?.name || "" }
          );
        }
      } else {
        // Create new lead
        const commissionSnapshot = computeCommissionSnapshot(agentTierData, trustedPaidAmount);
        const isConverted = newStage === "converted";
        const leadDoc = {
          agentId,
          agentName: agentDoc.data()?.name || "",
          name: String(memberData?.name || "").trim(),
          mobile: phone,
          city: String(memberData?.city || "").trim(),
          stage: newStage,
          source: "referral-link",
          memberUid,
          notes: [],
          followUpDate: "",
          followUpDone: false,
          subscriptionExpiryDate: resolveMemberSubscriptionDate(memberData),
          commissionCredited: isConverted,
          commissionType: isConverted ? commissionSnapshot.commissionType : "percent",
          commissionPercent: commissionSnapshot.commissionPercent,
          paidAmount: isConverted ? commissionSnapshot.paidAmount : 0,
          commissionAmount: isConverted ? commissionSnapshot.commissionAmount : 0,
          convertedAt: isConverted ? FieldValue.serverTimestamp() : null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        await db.collection(AGENT_LEADS_COLLECTION).add(leadDoc);
        await db.collection(AGENTS_COLLECTION).doc(agentId).set({
          totalLeads: FieldValue.increment(1),
          ...(isConverted ? { totalConversions: FieldValue.increment(1), totalEarned: FieldValue.increment(commissionSnapshot.commissionAmount) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        if (isConverted) {
          await logAgentActivity(agentId, "lead_converted", `New lead ${memberData?.name || phone} auto-converted! ${commissionSnapshot.commissionPercent}% commission on Rs ${commissionSnapshot.paidAmount} credited as Rs ${commissionSnapshot.commissionAmount}.`);
        } else {
          await logAgentActivity(agentId, "lead_auto_created", `Lead ${memberData?.name || phone} registered via referral link.`);
        }
      }
    } catch (error) {
      logger.error("syncAgentLeadOnMemberWrite failed", { memberUid, agentRefCode, error: error?.message || error });
    }
  }
);

function renderTemplateMessage(template, tokens) {
  const source = String(template?.message || template?.englishMessage || template?.text || "").trim();
  const fallback = String(tokens?.fallbackMessage || "{{agent_name}}, you have a Parichayam agent update.").trim();
  const raw = source || fallback;
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(tokens?.[key] ?? ""));
}

async function loadNotificationTemplate(trigger) {
  const doc = await db.collection(WHATSAPP_TEMPLATES_COLLECTION).doc(trigger).get();
  if (doc.exists) return { id: doc.id, ...(doc.data() || {}) };
  const snap = await db.collection(WHATSAPP_TEMPLATES_COLLECTION).where("trigger", "==", trigger).limit(1).get();
  if (!snap.empty) return { id: snap.docs[0].id, ...(snap.docs[0].data() || {}) };
  return DEFAULT_WHATSAPP_TEMPLATES.find((item) => item.trigger === trigger || item.id === trigger) || null;
}

function normalizeWhatsappPhone(value) {
  const phone = normalizePhone(value || "");
  return phone.length >= 10 ? phone : "";
}

async function sendWhatsappViaProvider(phone, message, trigger) {
  const provider = String(process.env.WHATSAPP_API_PROVIDER || "").trim().toLowerCase();
  const apiKey = String(process.env.WHATSAPP_API_KEY || "").trim();
  const sender = String(process.env.WHATSAPP_SENDER_NUMBER || "").trim();
  if (!provider || !apiKey || !phone) {
    const error = new Error("WhatsApp API is not configured.");
    error.code = "whatsapp/not-configured";
    throw error;
  }
  if (provider === "twilio") {
    const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
    const token = String(process.env.TWILIO_AUTH_TOKEN || apiKey).trim();
    if (!sid || !token || !sender) {
      const error = new Error("Twilio WhatsApp credentials are incomplete.");
      error.code = "whatsapp/not-configured";
      throw error;
    }
    const body = new URLSearchParams();
    body.set("From", sender.startsWith("whatsapp:") ? sender : `whatsapp:${sender}`);
    body.set("To", `whatsapp:+91${phone}`);
    body.set("Body", message);
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) throw new Error(`Twilio WhatsApp failed (${response.status})`);
    return response.json().catch(() => ({ ok: true }));
  }
  const response = await fetch("https://api.interakt.ai/v1/public/message/", {
    method: "POST",
    headers: {
      Authorization: "Basic " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      countryCode: "+91",
      phoneNumber: phone,
      callbackData: trigger,
      type: "Text",
      data: { message },
    }),
  });
  if (!response.ok) throw new Error(`Interakt WhatsApp failed (${response.status})`);
  return response.json().catch(() => ({ ok: true }));
}

async function logNotification(entry) {
  await db.collection(NOTIFICATION_LOG_COLLECTION).add({
    ...entry,
    estimatedCost: Number(entry.estimatedCost || 0),
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function countWhatsappSendsSince(sinceDate, cap) {
  const query = db.collection(NOTIFICATION_LOG_COLLECTION)
    .where("channel", "==", "whatsapp")
    .where("status", "==", "sent")
    .where("createdAt", ">=", sinceDate);
  if (typeof query.count === "function") {
    const aggregateSnap = await query.count().get();
    return Number(aggregateSnap.data().count || 0);
  }
  const snap = await query.limit(Math.max(1, cap + 1)).get();
  return snap.size;
}

async function fallbackEmailNotification(agent, trigger, message, reason) {
  const webhook = String(process.env.FALLBACK_EMAIL_WEBHOOK_URL || "").trim();
  if (!webhook) {
    await writeAdminAlert({
      type: "agent_notification_email_fallback_missing",
      severity: "warning",
      title: "Agent notification email fallback unavailable",
      message: `Trigger ${trigger} could not send WhatsApp and no email webhook is configured. Reason: ${reason}`,
      relatedCollection: AGENTS_COLLECTION,
      relatedId: agent.id || "",
      source: "agent_notifications",
    });
    return { ok: false, skipped: true };
  }
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: agent.email || "",
      subject: `Parichayam agent update: ${trigger}`,
      text: message,
      agentId: agent.id || "",
    }),
  });
  if (!response.ok) throw new Error(`Email fallback failed (${response.status})`);
  return { ok: true };
}

async function sendAgentNotification(agentId, trigger, tokens = {}) {
  const settings = await readWhatsappNotificationSettings();
  const enabled = settings.enabled === true && settings.triggers?.[trigger] !== false;
  const agentSnap = await db.collection(AGENTS_COLLECTION).doc(agentId).get();
  if (!agentSnap.exists) return { ok: false, skipped: true, reason: "agent_missing" };
  const agent = { id: agentSnap.id, ...(agentSnap.data() || {}) };
  const template = await loadNotificationTemplate(trigger);
  const message = String(tokens.messageOverride || renderTemplateMessage(template, {
    fallbackMessage: `${agent.name || "Agent"}, you have a Parichayam update.`,
    agent_name: agent.name || "Agent",
    ...tokens,
  }));
  const phone = normalizeWhatsappPhone(agent.whatsapp || agent.mobile || "");
  if (!enabled) {
    await logNotification({ agentId, trigger, channel: "whatsapp", status: "disabled", phone, messagePreview: message.slice(0, 160) });
    return { ok: false, skipped: true, reason: "disabled" };
  }
  const cap = Number(settings.dailyCap || DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS.dailyCap);
  const since24h = new Date(Date.now() - (24 * 60 * 60 * 1000));
  const sent24h = await countWhatsappSendsSince(since24h, cap);
  if (sent24h >= cap) {
    await logNotification({
      agentId,
      trigger,
      channel: "whatsapp",
      status: "capped",
      phone,
      messagePreview: message.slice(0, 160),
      reason: `Daily cap of ${cap} reached (${sent24h} sent in last 24h)`,
    });
    await writeAdminAlert({
      type: "agent_notification_daily_cap_reached",
      severity: "warning",
      title: "WhatsApp daily cap reached",
      message: `Daily cap of ${cap} WhatsApp sends reached. Notifications paused for 24h.`,
      relatedCollection: NOTIFICATION_LOG_COLLECTION,
      relatedId: "",
      source: "agent_notifications",
    });
    return { ok: false, skipped: true, reason: "daily_cap_reached" };
  }
  try {
    const providerResult = await sendWhatsappViaProvider(phone, message, trigger);
    await logNotification({
      agentId,
      trigger,
      channel: "whatsapp",
      provider: String(process.env.WHATSAPP_API_PROVIDER || "interakt"),
      status: "sent",
      phone,
      messagePreview: message.slice(0, 160),
      estimatedCost: settings.estimatedCostPerMessage,
      providerResult,
    });
    return { ok: true, channel: "whatsapp" };
  } catch (whatsappError) {
    try {
      const emailResult = await fallbackEmailNotification(agent, trigger, message, whatsappError.message || String(whatsappError));
      await logNotification({
        agentId,
        trigger,
        channel: "email",
        status: emailResult.ok ? "sent" : "skipped",
        fallbackFrom: "whatsapp",
        error: whatsappError.message || String(whatsappError),
        messagePreview: message.slice(0, 160),
      });
      return { ok: emailResult.ok, channel: "email", fallback: true };
    } catch (emailError) {
      await logNotification({
        agentId,
        trigger,
        channel: "none",
        status: "failed",
        error: `${whatsappError.message || whatsappError}; ${emailError.message || emailError}`,
        messagePreview: message.slice(0, 160),
      });
      await writeAdminAlert({
        type: "agent_notification_failed",
        severity: "warning",
        title: "Agent notification failed",
        message: `Trigger ${trigger} failed for agent ${agent.name || agentId}.`,
        relatedCollection: AGENTS_COLLECTION,
        relatedId: agentId,
        source: "agent_notifications",
      });
      return { ok: false, error: emailError.message || String(emailError) };
    }
  }
}

async function findAgentForMemberReferral(memberData) {
  const directAgentId = String(memberData?.referredByAgentUid || memberData?.agentUid || memberData?.agentId || "").trim();
  if (directAgentId) {
    const snap = await db.collection(AGENTS_COLLECTION).doc(directAgentId).get();
    if (snap.exists) return { id: snap.id, ...(snap.data() || {}) };
  }
  const code = normalizeAgentRefId(memberData?.referredByAgentRefId || memberData?.agentRefId || "");
  if (!code) return null;
  const snap = await db.collection(AGENTS_COLLECTION).where("referralCode", "==", code).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...(snap.docs[0].data() || {}) };
}

exports.notifyAgentNewSignup = onDocumentWritten(
  { document: `${MEMBERS_COLLECTION}/{uid}`, region: "us-central1" },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (before?.exists || !after?.exists) return;
    const member = after.data() || {};
    const agent = await findAgentForMemberReferral(member);
    if (!agent) return;
    await sendAgentNotification(agent.id, "newSignup", {
      agent_name: agent.name || "Agent",
      member_name: firstName(member.name || member.fullName || "your referral"),
    });
  }
);

exports.notifyAgentPaymentReceived = onDocumentWritten(
  { document: `${MEMBERS_COLLECTION}/{uid}`, region: "us-central1" },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (before.isPaid === true || after.isPaid !== true) return;
    const agent = await findAgentForMemberReferral(after);
    if (!agent) return;
    const paidAmount = Math.max(0, Math.round(Number(after.lastPaymentAmount || 0)));
    const commissionAmount = roundMoney(paidAmount * getAgentCommissionRateForRevenue(await attachAgentTierSnapshot(agent.id, agent)));
    await sendAgentNotification(agent.id, "paymentReceived", {
      agent_name: agent.name || "Agent",
      member_name: firstName(after.name || after.fullName || "your referral"),
      commission_amount: `₹${Math.round(commissionAmount).toLocaleString("en-IN")}`,
    });
  }
);

exports.notifyAgentPayoutProcessed = onDocumentWritten(
  { document: "agentPayoutRequests/{requestId}", region: "us-central1" },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const afterSnap = event.data?.after;
    if (!afterSnap?.exists) return;
    const after = afterSnap.data() || {};
    if (String(before.status || "").toLowerCase() === "paid" || String(after.status || "").toLowerCase() !== "paid") return;
    const agentId = String(after.agentId || "");
    if (!agentId) return;
    await sendAgentNotification(agentId, "payoutProcessed", {
      payout_amount: `₹${Math.round(Number(after.amount || 0)).toLocaleString("en-IN")}`,
      bank_reference: String(after.bankReference || "shared by admin"),
    });
  }
);

exports.notifyAgentCommissionUnlocked = onSchedule({
  schedule: "30 8 * * *",
  timeZone: "Asia/Kolkata",
  region: "us-central1",
}, async () => {
  const nowTs = new Date();
  const snap = await db.collection(REVENUE_EVENTS_COLLECTION)
    .where("eventType", "==", "agent_commission")
    .where("status", "==", "recorded")
    .where("commissionUnlockNotifyAt", "<=", nowTs)
    .where("commissionUnlockedNotifiedAt", "==", null)
    .orderBy("commissionUnlockNotifyAt", "asc")
    .limit(500)
    .get();
  const sends = [];
  for (const doc of snap.docs) {
    const event = doc.data() || {};
    const agentId = String(event.agentId || "");
    if (!agentId) {
      sends.push(doc.ref.set({ commissionUnlockedNotifiedAt: FieldValue.serverTimestamp() }, { merge: true }));
      continue;
    }
    sends.push(sendAgentNotification(agentId, "commissionUnlocked", {
      commission_amount: `₹${Math.round(Number(event.agentCommissionAmount || event.amount || 0)).toLocaleString("en-IN")}`,
    }));
    sends.push(doc.ref.set({ commissionUnlockedNotifiedAt: FieldValue.serverTimestamp() }, { merge: true }));
  }
  await Promise.all(sends);
  logger.info("notifyAgentCommissionUnlocked completed", { batchSize: snap.size });
});

exports.notifyAgentWeeklyDigest = onSchedule({
  schedule: "0 20 * * 0",
  timeZone: "Asia/Kolkata",
  region: "us-central1",
}, async () => {
  const agentsSnap = await db.collection(AGENTS_COLLECTION).where("status", "==", "active").get();
  const since = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const sends = [];
  for (const doc of agentsSnap.docs) {
    const agent = { id: doc.id, ...(doc.data() || {}) };
    const [leadsSnap, eventsSnap] = await Promise.all([
      db.collection(AGENT_LEADS_COLLECTION).where("agentId", "==", doc.id).get(),
      db.collection(REVENUE_EVENTS_COLLECTION).where("agentId", "==", doc.id).where("eventType", "==", "agent_commission").where("status", "==", "recorded").get(),
    ]);
    let signups = 0;
    leadsSnap.forEach((leadDoc) => { if (parseTimestampMs(leadDoc.data()?.createdAt) >= since) signups++; });
    let paid = 0;
    let commission = 0;
    eventsSnap.forEach((eventDoc) => {
      const data = eventDoc.data() || {};
      if (parseTimestampMs(data.createdAt) < since) return;
      paid++;
      commission += Number(data.agentCommissionAmount || data.amount || 0);
    });
    sends.push(sendAgentNotification(doc.id, "weeklyDigest", {
      agent_name: agent.name || "Agent",
      signups,
      paid,
      commission_amount: `₹${Math.round(commission).toLocaleString("en-IN")}`,
    }));
  }
  await Promise.all(sends);
});

exports.notifyAgentFestivalReminder = onSchedule({
  schedule: "0 9 * * *",
  timeZone: "Asia/Kolkata",
  region: "us-central1",
}, async () => {
  await ensureAgentDashboardDefaults();
  const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();
  const festivals = await listSeededCollection(FESTIVALS_COLLECTION, DEFAULT_FESTIVALS);
  const dueFestivals = festivals.filter((festival) => {
    if (festival.enabled === false) return false;
    const dateMs = Date.parse(`${String(festival.date || "").slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isFinite(dateMs)) return false;
    const reminderDays = Math.max(0, parseInt(festival.reminderDaysBefore, 10) || 7);
    return dateMs - (reminderDays * 24 * 60 * 60 * 1000) === todayMs;
  });
  if (!dueFestivals.length) return;
  const agentsSnap = await db.collection(AGENTS_COLLECTION).where("status", "==", "active").get();
  const sends = [];
  dueFestivals.forEach((festival) => {
    agentsSnap.forEach((doc) => {
      const agent = doc.data() || {};
      sends.push(sendAgentNotification(doc.id, "festivalReminder", {
        agent_name: agent.name || "Agent",
        festival_name: festival.name,
        promo_code: festival.promoCode || "",
        messageOverride: festival.teluguMessage || festival.englishMessage || `${festival.name} outreach reminder`,
      }));
    });
  });
  await Promise.all(sends);
});

exports.notifyAgentRefundApplied = onDocumentWritten(
  { document: `${REVENUE_EVENTS_COLLECTION}/{eventId}`, region: "us-central1" },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (before?.exists || !after?.exists) return;
    const data = after.data() || {};
    if (String(data.eventType || "") !== "commission_clawback") return;
    const agentId = String(data.agentId || "");
    if (!agentId) return;
    await sendAgentNotification(agentId, "refundApplied", {
      commission_amount: `₹${Math.abs(Math.round(Number(data.agentCommissionAmount || data.amount || 0))).toLocaleString("en-IN")}`,
      fallbackMessage: "{{agent_name}}, refund applied. Commission {{commission_amount}} has been marked disputed.",
    });
  }
);

// ──────────────────────────────────────────────────────────
// PHASE 3-LEAN: MATCHMAKER OPERATING SYSTEM
// ──────────────────────────────────────────────────────────

function matchmakerError(status, message, code) {
  const error = new Error(message || "Matchmaker request failed.");
  error.status = status || 500;
  if (code) error.code = code;
  return error;
}

function normalizeMemberRole(value) {
  return String(value || "").trim().toUpperCase();
}

function isAdminMemberRole(value) {
  return normalizeMemberRole(value) === "ADMIN";
}

function isMatchmakerMemberRole(value) {
  return normalizeMemberRole(value) === "MATCHMAKER";
}

function normalizeIsoDate(value) {
  const ms = parseTimestampMs(value);
  return ms ? new Date(ms).toISOString() : "";
}

function computeAgeFromValue(value) {
  const ms = parseTimestampMs(value) || Date.parse(String(value || ""));
  if (!ms) return null;
  const dob = new Date(ms);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

function clampMatchScore(value) {
  return Math.max(1, Math.min(100, Math.round(Number(value || 0) || 0)));
}

function sanitizePromptList(value) {
  const items = Array.isArray(value) ? value : [];
  const byId = new Map();
  items.forEach((item, index) => {
    const id = String(item?.id || `prompt_${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    byId.set(id, {
      id,
      enabled: item?.enabled !== false,
      trigger: String(item?.trigger || "").trim().slice(0, 80),
      title: String(item?.title || "").trim().slice(0, 140),
      body: String(item?.body || "").trim().slice(0, 500),
      cta: String(item?.cta || "").trim().slice(0, 80),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return Array.from(byId.values());
}

function normalizeMatchmakerPricing(value) {
  const raw = value || {};
  const normalized = {};
  MATCHMAKER_SUBSCRIPTION_PLANS.forEach((planKey) => {
    const source = raw[planKey] || DEFAULT_MATCHMAKER_PRICING[planKey] || {};
    normalized[planKey] = {
      price: Math.max(0, Math.round(Number(source.price ?? DEFAULT_MATCHMAKER_PRICING[planKey].price) || DEFAULT_MATCHMAKER_PRICING[planKey].price)),
      durationDays: Math.max(1, Math.round(Number(source.durationDays ?? DEFAULT_MATCHMAKER_PRICING[planKey].durationDays) || DEFAULT_MATCHMAKER_PRICING[planKey].durationDays)),
      suggestionsPerWeek: Math.max(1, Math.round(Number(source.suggestionsPerWeek ?? DEFAULT_MATCHMAKER_PRICING[planKey].suggestionsPerWeek) || DEFAULT_MATCHMAKER_PRICING[planKey].suggestionsPerWeek)),
      enabled: source.enabled !== false,
      label: String((source.label ?? DEFAULT_MATCHMAKER_PRICING[planKey].label) || "").trim().slice(0, 40),
    };
  });
  return normalized;
}

function normalizeMatchmakerSettings(value) {
  const raw = value || {};
  return {
    suggestionExpiryDays: Math.max(1, Math.min(60, Math.round(Number(raw.suggestionExpiryDays ?? DEFAULT_MATCHMAKER_SETTINGS.suggestionExpiryDays) || DEFAULT_MATCHMAKER_SETTINGS.suggestionExpiryDays))),
    autoCloseExpired: raw.autoCloseExpired !== false,
    warnSameGotra: raw.warnSameGotra !== false,
    warnAgeDifferenceAbove: Math.max(0, Math.min(25, Math.round(Number(raw.warnAgeDifferenceAbove ?? DEFAULT_MATCHMAKER_SETTINGS.warnAgeDifferenceAbove) || DEFAULT_MATCHMAKER_SETTINGS.warnAgeDifferenceAbove))),
    warnInterStateMatch: raw.warnInterStateMatch === true,
    warnManglikMismatch: raw.warnManglikMismatch !== false,
    revealFullNameOnMutualInterest: raw.revealFullNameOnMutualInterest !== false,
    revealPhoneOnFamilyIntroduction: raw.revealPhoneOnFamilyIntroduction !== false,
    revealPhoneOnMutualInterest: raw.revealPhoneOnMutualInterest === true,
    minimumNoteLength: Math.max(10, Math.min(300, Math.round(Number(raw.minimumNoteLength ?? DEFAULT_MATCHMAKER_SETTINGS.minimumNoteLength) || DEFAULT_MATCHMAKER_SETTINGS.minimumNoteLength))),
    maximumNoteLength: Math.max(100, Math.min(4000, Math.round(Number(raw.maximumNoteLength ?? DEFAULT_MATCHMAKER_SETTINGS.maximumNoteLength) || DEFAULT_MATCHMAKER_SETTINGS.maximumNoteLength))),
    allowMatchmakerMessaging: raw.allowMatchmakerMessaging !== false,
    stickyMatchmakerOnRenewal: raw.stickyMatchmakerOnRenewal !== false,
    enableConflictOfInterestCheck: raw.enableConflictOfInterestCheck !== false,
  };
}

function normalizeMatchmakerProof(value) {
  const raw = value || {};
  return {
    totalCouplesMatched: Math.max(0, Math.round(Number(raw.totalCouplesMatched ?? DEFAULT_MATCHMAKER_PROOF.totalCouplesMatched) || DEFAULT_MATCHMAKER_PROOF.totalCouplesMatched)),
    avgEngagementDays: Math.max(0, Math.round(Number(raw.avgEngagementDays ?? DEFAULT_MATCHMAKER_PROOF.avgEngagementDays) || DEFAULT_MATCHMAKER_PROOF.avgEngagementDays)),
    successRatePercent: Math.max(0, Math.min(100, Math.round(Number(raw.successRatePercent ?? DEFAULT_MATCHMAKER_PROOF.successRatePercent) || DEFAULT_MATCHMAKER_PROOF.successRatePercent))),
    testimonials: (Array.isArray(raw.testimonials) ? raw.testimonials : DEFAULT_MATCHMAKER_PROOF.testimonials).slice(0, 12).map((item) => ({
      name: String(item?.name || "").trim().slice(0, 120),
      city: String(item?.city || "").trim().slice(0, 120),
      quote: String(item?.quote || "").trim().slice(0, 500),
      engagedAt: String(item?.engagedAt || "").trim().slice(0, 30),
    })),
    matchmakerProfile: {
      name: String(raw.matchmakerProfile?.name || DEFAULT_MATCHMAKER_PROOF.matchmakerProfile.name || "").trim().slice(0, 120),
      experience: String(raw.matchmakerProfile?.experience || DEFAULT_MATCHMAKER_PROOF.matchmakerProfile.experience || "").trim().slice(0, 120),
      languages: Array.isArray(raw.matchmakerProfile?.languages) ? raw.matchmakerProfile.languages.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8) : DEFAULT_MATCHMAKER_PROOF.matchmakerProfile.languages.slice(),
      city: String(raw.matchmakerProfile?.city || DEFAULT_MATCHMAKER_PROOF.matchmakerProfile.city || "").trim().slice(0, 120),
      photoUrl: String(raw.matchmakerProfile?.photoUrl || DEFAULT_MATCHMAKER_PROOF.matchmakerProfile.photoUrl || "").trim().slice(0, 500),
    },
  };
}

async function readStateDocValue(key, fallbackValue, normalizer) {
  const doc = await db.collection(APP_STATE_COLLECTION).doc(key).get();
  const source = doc.exists ? (doc.data()?.value ?? doc.data()) : fallbackValue;
  return typeof normalizer === "function" ? normalizer(source) : (source || fallbackValue);
}

async function readMatchmakerPricing() {
  return readStateDocValue(MATCHMAKER_PRICING_KEY, DEFAULT_MATCHMAKER_PRICING, normalizeMatchmakerPricing);
}

async function readMatchmakerSettings() {
  return readStateDocValue(MATCHMAKER_SETTINGS_KEY, DEFAULT_MATCHMAKER_SETTINGS, normalizeMatchmakerSettings);
}

async function readMatchmakerProof() {
  return readStateDocValue(MATCHMAKER_PROOF_KEY, DEFAULT_MATCHMAKER_PROOF, normalizeMatchmakerProof);
}

async function readMatchmakerPrompts() {
  return readStateDocValue(MATCHMAKER_PROMPTS_KEY, DEFAULT_MATCHMAKER_PROMPTS, sanitizePromptList);
}

async function ensureMatchmakerDefaults() {
  const refs = [
    { key: MATCHMAKER_PRICING_KEY, value: normalizeMatchmakerPricing(DEFAULT_MATCHMAKER_PRICING) },
    { key: MATCHMAKER_SETTINGS_KEY, value: normalizeMatchmakerSettings(DEFAULT_MATCHMAKER_SETTINGS) },
    { key: MATCHMAKER_PROOF_KEY, value: normalizeMatchmakerProof(DEFAULT_MATCHMAKER_PROOF) },
    { key: MATCHMAKER_PROMPTS_KEY, value: sanitizePromptList(DEFAULT_MATCHMAKER_PROMPTS) },
  ];
  const snaps = await Promise.all(refs.map((item) => db.collection(APP_STATE_COLLECTION).doc(item.key).get()));
  const batch = db.batch();
  let hasWrites = false;
  refs.forEach((item, index) => {
    if (snaps[index].exists) return;
    batch.set(db.collection(APP_STATE_COLLECTION).doc(item.key), {
      value: item.value,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "system_seed",
    }, { merge: true });
    hasWrites = true;
  });
  if (hasWrites) await batch.commit();
}

async function verifyMatchmakerUser(req) {
  const authUser = await verifyAuthenticatedUser(req);
  const memberSnap = await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get();
  if (!memberSnap.exists) throw matchmakerError(404, "Matchmaker profile not found.");
  const member = { id: memberSnap.id, ...(memberSnap.data() || {}) };
  const role = normalizeMemberRole(member.role);
  if (!["ADMIN", "MATCHMAKER"].includes(role)) throw matchmakerError(403, "Matchmaker or admin access required.");
  return { ...authUser, member };
}

async function verifyAssignedMatchmaker(req, memberUid) {
  const user = await verifyMatchmakerUser(req);
  if (isAdminMemberRole(user.member?.role)) return user;
  const targetSnap = await db.collection(MEMBERS_COLLECTION).doc(String(memberUid || "").trim()).get();
  if (!targetSnap.exists) throw matchmakerError(404, "Member not found.");
  if (String(targetSnap.data()?.assignedMatchmakerUid || "").trim() !== String(user.uid || "").trim()) {
    throw matchmakerError(403, "This member is assigned to another matchmaker.");
  }
  return user;
}

async function getMemberPhotoUrlForViewer(viewerUid, targetMember) {
  const target = targetMember || {};
  const viewerSnap = await db.collection(MEMBERS_COLLECTION).doc(String(viewerUid || "").trim()).get();
  if (!viewerSnap.exists) return null;
  const viewerData = viewerSnap.data() || {};
  const viewerRole = normalizeMemberRole(viewerData.role);
  if (viewerRole === "ADMIN" || viewerRole === "MATCHMAKER") return String(target.profilePhotoUrl || target.photoUrl || "").trim() || null;
  if (String(viewerUid || "") === String(target.uid || target.id || "")) return String(target.profilePhotoUrl || target.photoUrl || "").trim() || null;
  return String(target.profilePhotoUrlBlurred || "").trim() || (target.profilePhotoUrl ? `${target.profilePhotoUrl}?blur=true` : null);
}

function computeDefaultVisibility(eventType) {
  const memberVisible = [
    ACTIVITY_EVENT_TYPES.SUGGESTION_CREATED,
    ACTIVITY_EVENT_TYPES.SUGGESTION_LIKED,
    ACTIVITY_EVENT_TYPES.SUGGESTION_DECLINED,
    ACTIVITY_EVENT_TYPES.MUTUAL_INTEREST_REACHED,
    ACTIVITY_EVENT_TYPES.MATCHMAKER_ASSIGNED,
    ACTIVITY_EVENT_TYPES.MATCHMAKER_REASSIGNED,
    ACTIVITY_EVENT_TYPES.MATCHMAKER_MESSAGE_SENT,
    ACTIVITY_EVENT_TYPES.FAMILY_INTRODUCTION_CREATED,
    ACTIVITY_EVENT_TYPES.MEMBER_PLAN_PURCHASED,
    ACTIVITY_EVENT_TYPES.MEMBER_MATCHMAKER_SUBSCRIBED,
    ACTIVITY_EVENT_TYPES.MEMBER_MATCHMAKER_CANCELLED,
  ];
  const adminOnly = [
    ACTIVITY_EVENT_TYPES.ADMIN_INTERVENTION,
    ACTIVITY_EVENT_TYPES.ADMIN_NOTE_ADDED,
    ACTIVITY_EVENT_TYPES.ADMIN_REFUND_ISSUED,
  ];
  return {
    member: memberVisible.includes(eventType),
    matchmaker: !adminOnly.includes(eventType),
    admin: true,
  };
}

async function logActivity({ memberUid, actor, eventType, details = {}, relatedDocs = [], visibility }) {
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.collection(ACTIVITY_LOG_COLLECTION).doc(eventId).set({
    eventId,
    memberUid: String(memberUid || "").trim(),
    actor: {
      type: String(actor?.type || "system").trim(),
      uid: String(actor?.uid || "system").trim(),
      name: String(actor?.name || "Parichayam").trim(),
    },
    eventType: String(eventType || "").trim(),
    visibility: visibility || computeDefaultVisibility(eventType),
    details: details || {},
    relatedDocs: Array.isArray(relatedDocs) ? relatedDocs : [],
    createdAt: FieldValue.serverTimestamp(),
  });
  return eventId;
}

async function countMatchmakerLoad(uid) {
  const query = db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION)
    .where("assignedMatchmakerUid", "==", String(uid || "").trim())
    .where("status", "==", "active");
  if (typeof query.count === "function") {
    const aggregate = await query.count().get();
    return Number(aggregate.data().count || 0);
  }
  const snap = await query.limit(1000).get();
  return snap.size;
}

async function assignMatchmakerToMember(memberUid, options = {}) {
  const cleanMemberUid = String(memberUid || "").trim();
  if (!cleanMemberUid) throw matchmakerError(400, "Member UID is required.");
  const settings = await readMatchmakerSettings();
  if (settings.stickyMatchmakerOnRenewal && !options.forceNew) {
    const memberSnap = await db.collection(MEMBERS_COLLECTION).doc(cleanMemberUid).get();
    if (memberSnap.exists) {
      const data = memberSnap.data() || {};
      const previousMatchmakerUid = String(data.assignedMatchmakerUid || data.lastMatchmakerUid || "").trim();
      if (previousMatchmakerUid) {
        const prevSnap = await db.collection(MEMBERS_COLLECTION).doc(previousMatchmakerUid).get();
        if (prevSnap.exists) {
          const prev = prevSnap.data() || {};
          if (isMatchmakerMemberRole(prev.role) && ["ACTIVE", "active", ""].includes(String(prev.status || "").trim())) {
            return { matchmakerUid: previousMatchmakerUid, matchmakerName: prev.name || "Matchmaker", isSticky: true };
          }
        }
      }
    }
  }

  const matchmakersSnap = await db.collection(MEMBERS_COLLECTION)
    .where("role", "==", "MATCHMAKER")
    .get();
  const activeDocs = matchmakersSnap.docs.filter((doc) => {
    const data = doc.data() || {};
    const status = String(data.status || data.accountStatus || "ACTIVE").trim().toUpperCase();
    return status !== "SUSPENDED" && status !== "BLOCKED" && status !== "DEACTIVATED";
  });
  if (!activeDocs.length) {
    await writeAdminAlert({
      type: "matchmaker_assignment_unavailable",
      severity: "warning",
      title: "No matchmakers available",
      message: "A member attempted to start a matchmaker subscription, but no active matchmakers were available.",
      memberId: cleanMemberUid,
      relatedCollection: MEMBERS_COLLECTION,
      relatedId: cleanMemberUid,
      source: "matchmaker_subscription",
    });
    throw matchmakerError(503, "No matchmakers available. Please contact admin.");
  }
  const loads = await Promise.all(activeDocs.map(async (doc) => ({
    uid: doc.id,
    name: String(doc.data()?.name || "Matchmaker").trim(),
    load: await countMatchmakerLoad(doc.id),
  })));
  loads.sort((left, right) => {
    if (left.load !== right.load) return left.load - right.load;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
  return { matchmakerUid: loads[0].uid, matchmakerName: loads[0].name, isSticky: false };
}

function computeCompatibilityFactors(memberA, memberB, settings) {
  const ageA = computeAgeFromValue(memberA.dateOfBirth || memberA.dob);
  const ageB = computeAgeFromValue(memberB.dateOfBirth || memberB.dob);
  const ageDiff = ageA !== null && ageB !== null ? Math.abs(ageA - ageB) : null;
  const sameGotra = String(memberA.gotra || "").trim() && String(memberA.gotra || "").trim().toLowerCase() === String(memberB.gotra || "").trim().toLowerCase();
  const sameState = String(memberA.state || "").trim().toLowerCase() && String(memberA.state || "").trim().toLowerCase() === String(memberB.state || "").trim().toLowerCase();
  return {
    gotra: sameGotra ? "same" : "compatible",
    age: ageDiff === null ? "unknown" : (ageDiff <= (settings.warnAgeDifferenceAbove || 7) ? "within_range" : "wide_gap"),
    height: String(memberA.height || "") && String(memberB.height || "") ? "provided" : "unknown",
    education: String(memberA.educationLevel || memberA.education || "").trim() && String(memberB.educationLevel || memberB.education || "").trim() ? "provided" : "unknown",
    location: sameState ? "same_state" : "cross_state",
    manglik: String(memberA.manglik || "").trim().toLowerCase() === String(memberB.manglik || "").trim().toLowerCase() ? "aligned" : "check",
    diet: String(memberA.diet || "").trim().toLowerCase() === String(memberB.diet || "").trim().toLowerCase() ? "aligned" : "check",
  };
}

function computeCompatibilityScore(memberA, memberB, settings) {
  const factors = computeCompatibilityFactors(memberA, memberB, settings);
  let score = 60;
  if (factors.gotra === "compatible") score += 8;
  if (factors.age === "within_range") score += 10;
  if (factors.location === "same_state") score += 6;
  if (factors.manglik === "aligned") score += 6;
  if (factors.diet === "aligned") score += 4;
  if (String(memberA.educationLevel || memberA.education || "").trim() && String(memberB.educationLevel || memberB.education || "").trim()) score += 3;
  if (settings.warnSameGotra && factors.gotra === "same") score -= 14;
  if (settings.warnManglikMismatch && factors.manglik === "check") score -= 8;
  return { score: Math.max(1, Math.min(100, Math.round(score))), factors };
}

async function ensureMemberNameLower(memberUid, data) {
  const cleanUid = String(memberUid || "").trim();
  const nameLower = String(data?.nameLower || "").trim();
  const fallback = String(data?.name || data?.fullName || "").trim().toLowerCase();
  if (!cleanUid || nameLower || !fallback) return fallback || nameLower;
  await db.collection(MEMBERS_COLLECTION).doc(cleanUid).set({ nameLower: fallback, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return fallback;
}

function buildMatchmakerConversationId(matchmakerUid, memberUid) {
  return `${String(matchmakerUid || "").trim()}_${String(memberUid || "").trim()}`;
}

async function buildMatchmakerRevenueEvents(params) {
  const memberId = String(params.memberId || "").trim();
  const memberData = params.memberData || {};
  const orderData = params.orderData || {};
  const orderId = String(params.orderId || orderData.razorpayOrderId || "").trim();
  const paymentId = String(params.paymentId || "").trim();
  const agentInfo = params.agentInfo || { id: "", referralCode: "", data: {} };
  const chargeAmount = Math.max(0, Math.round(Number(orderData.amountInr || params.amountInr || 0)));
  const paidAtMs = Date.now();
  const lockExpiresMs = paidAtMs + REVENUE_LOCK_MS;
  const lockExpiresAt = revenueTimestampFromMs(lockExpiresMs);
  const agentId = String(agentInfo.id || "").trim();
  const agentCommissionRate = agentId ? getAgentCommissionRateForRevenue(agentInfo.data || {}) : 0;
  const agentCommissionAmount = agentId ? roundMoney(chargeAmount * agentCommissionRate) : 0;
  const metadata = {
    memberTier: String(memberData.tier || memberData.plan || "paid").trim(),
    planDurationDays: Math.max(1, Math.round(Number(orderData.durationDays || 30) || 30)),
    basePrice: chargeAmount,
    discountApplied: Math.max(0, Math.round(Number(orderData.discountApplied || 0) || 0)),
    paymentGateway: "razorpay",
    notes: String(params.notes || `Matchmaker subscription activated for ${memberData.name || memberId}`),
    memberPaymentAmount: chargeAmount,
    agentTierName: String(agentInfo.data?.currentTier || agentInfo.data?.commissionTier || ""),
    purchaseType: "matchmaker_subscription",
    plan: String(orderData.plan || "").trim(),
    suggestionsPerWeek: Math.max(1, Math.round(Number(orderData.suggestionsPerWeek || 3) || 3)),
    matchmakerUid: String(params.matchmakerUid || "").trim(),
    matchmakerSubscriptionId: String(params.subscriptionId || "").trim(),
    ...(params.ipAddress ? { ipAddress: String(params.ipAddress) } : {}),
    ...(agentInfo.referralCode ? { agentReferralCode: String(agentInfo.referralCode) } : {}),
  };
  const paymentEventId = safeRevenueEventId("matchmaker_subscription_paid", paymentId || orderId || memberId);
  const paymentEvent = {
    eventType: "matchmaker_subscription_paid",
    memberId,
    amount: chargeAmount,
    currency: "INR",
    orderId,
    paymentId,
    agentId,
    agentCommissionRate,
    agentCommissionAmount,
    refundReason: "",
    relatedEventId: "",
    lockExpiresAt,
    isLocked: lockExpiresMs > Date.now(),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: String(params.createdBy || "system"),
    metadata,
    status: "recorded",
    version: REVENUE_SCHEMA_VERSION,
  };
  const commissionEventId = agentCommissionAmount > 0 ? safeRevenueEventId("agent_commission", `matchmaker_${paymentId || orderId || memberId}`) : "";
  const commissionEvent = commissionEventId ? {
    ...paymentEvent,
    eventType: "agent_commission",
    amount: agentCommissionAmount,
    relatedEventId: paymentEventId,
    commissionUnlockNotifyAt: lockExpiresAt,
    commissionUnlockedNotifiedAt: null,
  } : null;
  return { paymentEventId, paymentEvent, commissionEventId, commissionEvent };
}

function isClosedSuggestionStatus(status) {
  return [SUGGESTION_STATUS_FLOW.CLOSED, SUGGESTION_STATUS_FLOW.ENGAGED].includes(String(status || "").trim().toLowerCase());
}

function resolveSuggestionStatusFromActions(suggestion) {
  const aAction = String(suggestion.memberAAction || "").trim().toLowerCase();
  const bAction = String(suggestion.memberBAction || "").trim().toLowerCase();
  if (aAction === "liked" && bAction === "liked") return SUGGESTION_STATUS_FLOW.MUTUAL_INTEREST;
  if (aAction === "declined") return SUGGESTION_STATUS_FLOW.A_DECLINED;
  if (bAction === "declined") return SUGGESTION_STATUS_FLOW.B_DECLINED;
  if (aAction === "liked") return SUGGESTION_STATUS_FLOW.A_LIKED;
  if (bAction === "liked") return SUGGESTION_STATUS_FLOW.B_LIKED;
  const aViewed = !!parseTimestampMs(suggestion.memberAViewedAt);
  const bViewed = !!parseTimestampMs(suggestion.memberBViewedAt);
  if (aViewed && bViewed) return SUGGESTION_STATUS_FLOW.BOTH_VIEWED;
  if (aViewed) return SUGGESTION_STATUS_FLOW.A_VIEWED;
  if (bViewed) return SUGGESTION_STATUS_FLOW.B_VIEWED;
  return SUGGESTION_STATUS_FLOW.PENDING;
}

function buildSuggestionId() {
  return `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildIntroductionId() {
  return `intro_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildSubscriptionId() {
  return `mmsub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildNoteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function asServerIso(value) {
  const ms = parseTimestampMs(value) || Date.parse(String(value || ""));
  return ms ? new Date(ms).toISOString() : "";
}

async function fetchMemberLean(memberUid) {
  const snap = await db.collection(MEMBERS_COLLECTION).doc(String(memberUid || "").trim()).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  await ensureMemberNameLower(snap.id, data);
  return { uid: snap.id, ...data };
}

function buildLeanMemberCard(member) {
  if (!member) return null;
  return {
    uid: member.uid || member.id || "",
    profileNumber: String(member.profileNumber || "").trim(),
    name: String(member.name || member.fullName || "").trim(),
    firstName: firstName(member.name || member.fullName || ""),
    age: computeAgeFromValue(member.dateOfBirth || member.dob),
    gender: String(member.gender || "").trim(),
    city: String(member.city || member.currentCity || "").trim(),
    state: String(member.state || "").trim(),
    profession: String(member.profession || "").trim(),
    education: String(member.education || "").trim(),
    educationLevel: String(member.educationLevel || "").trim(),
    gotra: String(member.gotra || "").trim(),
    manglik: String(member.manglik || "").trim(),
    diet: String(member.diet || "").trim(),
    tier: String(member.tier || member.plan || "").trim(),
    isPaid: member.isPaid === true,
    assignedMatchmakerUid: String(member.assignedMatchmakerUid || "").trim(),
    assignedMatchmakerName: String(member.assignedMatchmakerName || "").trim(),
    engagementStatus: String(member.engagementStatus || "searching").trim(),
  };
}

function sanitizeMatchmakerAssignmentForViewer(card, viewerUid, viewerRole) {
  if (!card || typeof card !== "object") return card;
  const sanitized = { ...card };
  const normalizedRole = normalizeMemberRole(viewerRole);
  const isAdminViewer = normalizedRole === "ADMIN";
  const isAssignedToMe = String(sanitized.assignedMatchmakerUid || "").trim() === String(viewerUid || "").trim();
  sanitized.isAssignedToMe = isAssignedToMe;
  if (!isAdminViewer) {
    sanitized.assignedMatchmakerUid = isAssignedToMe ? String(viewerUid || "").trim() : "";
    sanitized.assignedMatchmakerName = isAssignedToMe ? String(sanitized.assignedMatchmakerName || "").trim() : "";
  }
  return sanitized;
}

async function enrichSuggestionForViewer(suggestion, viewerUid, viewerRole) {
  const data = suggestion || {};
  const [memberA, memberB] = await Promise.all([
    fetchMemberLean(data.forMemberAUid),
    fetchMemberLean(data.forMemberBUid),
  ]);
  const role = normalizeMemberRole(viewerRole);
  const viewerIsMemberA = String(viewerUid || "") === String(data.forMemberAUid || "");
  const viewerIsMemberB = String(viewerUid || "") === String(data.forMemberBUid || "");
  const forMembers = role !== "ADMIN" && role !== "MATCHMAKER";
  const otherMember = viewerIsMemberA ? memberB : memberA;
  const safeOther = buildLeanMemberCard(otherMember || {});
  if (safeOther) {
    safeOther.photoUrl = otherMember ? await getMemberPhotoUrlForViewer(String(viewerUid || ""), otherMember) : null;
  }
  const memberASummary = buildLeanMemberCard(memberA || {});
  const memberBSummary = buildLeanMemberCard(memberB || {});
  if (memberASummary) memberASummary.photoUrl = memberA ? await getMemberPhotoUrlForViewer(String(viewerUid || ""), memberA) : null;
  if (memberBSummary) memberBSummary.photoUrl = memberB ? await getMemberPhotoUrlForViewer(String(viewerUid || ""), memberB) : null;
  return {
    ...data,
    memberA: forMembers ? undefined : memberASummary,
    memberB: forMembers ? undefined : memberBSummary,
    otherMember: forMembers ? safeOther : undefined,
  };
}

async function loadSuggestionsForMember(memberUid, limitValue) {
  const safeLimit = Math.max(1, Math.min(50, Math.round(Number(limitValue || 20) || 20)));
  const [snapA, snapB] = await Promise.all([
    db.collection(MATCH_SUGGESTIONS_COLLECTION).where("forMemberAUid", "==", String(memberUid || "").trim()).limit(safeLimit).get(),
    db.collection(MATCH_SUGGESTIONS_COLLECTION).where("forMemberBUid", "==", String(memberUid || "").trim()).limit(safeLimit).get(),
  ]);
  const map = new Map();
  [...snapA.docs, ...snapB.docs].forEach((doc) => map.set(doc.id, { suggestionId: doc.id, ...(doc.data() || {}) }));
  return Array.from(map.values()).sort((left, right) => parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt));
}

async function loadSuggestionsCreatedBy(matchmakerUid, limitValue) {
  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limitValue || 50) || 50)));
  const snap = await db.collection(MATCH_SUGGESTIONS_COLLECTION)
    .where("createdBy", "==", String(matchmakerUid || "").trim())
    .limit(safeLimit)
    .get();
  return snap.docs.map((doc) => ({ suggestionId: doc.id, ...(doc.data() || {}) }))
    .sort((left, right) => parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt));
}

async function readActiveMatchmakerSubscription(memberUid) {
  const now = new Date();
  const snap = await db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION)
    .where("memberUid", "==", String(memberUid || "").trim())
    .where("status", "==", "active")
    .where("endDate", ">", now)
    .orderBy("endDate", "desc")
    .limit(5)
    .get()
    .catch(async () => {
      const fallbackSnap = await db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION)
        .where("memberUid", "==", String(memberUid || "").trim())
        .where("status", "==", "active")
        .limit(10)
        .get();
      return {
        docs: fallbackSnap.docs.filter((doc) => parseTimestampMs(doc.data()?.endDate) > now.getTime()),
      };
    });
  const items = snap.docs.map((doc) => ({ subscriptionId: doc.id, ...(doc.data() || {}) }))
    .sort((left, right) => parseTimestampMs(right.endDate) - parseTimestampMs(left.endDate));
  return items[0] || null;
}

exports.createMatchmakerSubscriptionOrder = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    if (!isRazorpayConfigured()) throw matchmakerError(503, "Payment verification is not configured yet.");
    await ensureMatchmakerDefaults();
    const memberSnap = await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get();
    if (!memberSnap.exists) throw matchmakerError(404, "Member profile not found.");
    const member = memberSnap.data() || {};
    if (member.isPaid !== true) throw matchmakerError(403, "Matchmaker plans are available for paid members only.");
    const activeSub = await readActiveMatchmakerSubscription(authUser.uid);
    if (activeSub && parseTimestampMs(activeSub.endDate) > Date.now()) {
      throw matchmakerError(409, "You already have an active matchmaker subscription.");
    }
    const plan = String(req.body?.plan || "").trim().toLowerCase();
    const pricing = await readMatchmakerPricing();
    const planConfig = pricing[plan];
    if (!planConfig || planConfig.enabled === false) throw matchmakerError(400, "This matchmaker plan is not available.");
    const currency = "INR";
    const receipt = `pari-mm-${authUser.uid.slice(0, 8)}-${Date.now()}`;
    const order = await createRazorpayOrder({
      amount: Math.round(Number(planConfig.price || 0) * 100),
      currency,
      receipt,
      notes: {
        uid: authUser.uid,
        purchaseType: "matchmaker",
        plan,
      },
    });
    const orderDoc = {
      uid: authUser.uid,
      purchaseType: "matchmaker",
      plan,
      amountInr: Math.round(Number(planConfig.price || 0)),
      durationDays: Math.round(Number(planConfig.durationDays || 30)),
      suggestionsPerWeek: Math.round(Number(planConfig.suggestionsPerWeek || 3)),
      currency,
      razorpayOrderId: String(order.id || ""),
      status: "created",
      source: String(req.body?.source || "matchmaker_card").trim(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderDoc.razorpayOrderId).set(orderDoc, { merge: true });
    await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).set({
      pendingPaymentOrderId: orderDoc.razorpayOrderId,
      lastOrderId: orderDoc.razorpayOrderId,
      paymentStatus: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    sendJson(req, res, 200, {
      ok: true,
      gateway: "razorpay",
      orderId: orderDoc.razorpayOrderId,
      amount: orderDoc.amountInr * 100,
      currency,
      keyId: razorpayKeyId(),
      plan,
      purchaseType: "matchmaker",
    });
  } catch (error) {
    logger.error("createMatchmakerSubscriptionOrder failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to create matchmaker order." });
  }
});

exports.enrollMatchmakerSubscription = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    if (!isRazorpayConfigured()) throw matchmakerError(503, "Payment verification is not configured yet.");
    const orderId = String(req.body?.razorpay_order_id || req.body?.orderId || "").trim();
    const paymentId = String(req.body?.razorpay_payment_id || req.body?.paymentId || "").trim();
    const signature = String(req.body?.razorpay_signature || req.body?.signature || "").trim();
    if (!orderId || !paymentId || !signature) throw matchmakerError(400, "Payment verification details are incomplete.");
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) throw matchmakerError(400, "Payment verification failed.");

    await ensureMatchmakerDefaults();
    const [orderSnap, memberSnap, existingPaymentSnap] = await Promise.all([
      db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderId).get(),
      db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get(),
      db.collection(PAYMENTS_COLLECTION).doc(paymentId).get(),
    ]);
    if (!orderSnap.exists) throw matchmakerError(404, "Payment order not found.");
    if (!memberSnap.exists) throw matchmakerError(404, "Member profile not found.");
    if (existingPaymentSnap.exists || String(orderSnap.data()?.status || "").toLowerCase() === "paid") {
      const activeSub = await readActiveMatchmakerSubscription(authUser.uid);
      sendJson(req, res, 200, {
        ok: true,
        alreadyProcessed: true,
        subscriptionId: activeSub?.subscriptionId || "",
        matchmakerUid: activeSub?.assignedMatchmakerUid || "",
        matchmakerName: memberSnap.data()?.assignedMatchmakerName || "",
        endDate: activeSub?.endDate || "",
      });
      return;
    }

    const orderData = orderSnap.data() || {};
    if (String(orderData.uid || "") !== String(authUser.uid || "")) throw matchmakerError(403, "This payment order does not belong to your account.");
    if (String(orderData.purchaseType || "").trim().toLowerCase() !== "matchmaker") throw matchmakerError(400, "This payment order is not for a matchmaker plan.");
    const pricing = await readMatchmakerPricing();
    const plan = String(orderData.plan || "").trim().toLowerCase();
    const planConfig = pricing[plan];
    if (!planConfig || planConfig.enabled === false) throw matchmakerError(400, "The selected matchmaker plan is no longer available.");
    if (Math.round(Number(orderData.amountInr || 0)) !== Math.round(Number(planConfig.price || 0))) {
      throw matchmakerError(409, "The payment amount no longer matches the plan.");
    }
    const memberData = memberSnap.data() || {};
    if (memberData.isPaid !== true) throw matchmakerError(403, "Only paid members can activate a matchmaker plan.");
    const activeSub = await readActiveMatchmakerSubscription(authUser.uid);
    if (activeSub && parseTimestampMs(activeSub.endDate) > Date.now()) throw matchmakerError(409, "An active matchmaker subscription already exists.");

    const { matchmakerUid, matchmakerName, isSticky } = await assignMatchmakerToMember(authUser.uid, { memberData });
    const subscriptionId = buildSubscriptionId();
    const now = new Date();
    const endDate = Timestamp.fromDate(new Date(now.getTime() + (Math.round(Number(planConfig.durationDays || 30)) * 24 * 60 * 60 * 1000)));
    const agentInfo = await resolveRevenueAgentForMember(memberData);
    const revenueEvents = await buildMatchmakerRevenueEvents({
      memberId: authUser.uid,
      memberData,
      orderData: {
        amountInr: planConfig.price,
        plan,
        durationDays: planConfig.durationDays,
        suggestionsPerWeek: planConfig.suggestionsPerWeek,
      },
      orderId,
      paymentId,
      agentInfo,
      matchmakerUid,
      subscriptionId,
      createdBy: "system",
      ipAddress: extractClientIp(req),
      notes: `Matchmaker subscription activated for ${memberData.name || authUser.uid}`,
    });

    const paymentDoc = {
      uid: authUser.uid,
      paymentId,
      orderId,
      gateway: "razorpay",
      signature,
      purchaseType: "matchmaker",
      plan,
      amountInr: Number(planConfig.price || 0),
      currency: "INR",
      status: "paid",
      createdAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION).doc(subscriptionId), {
      subscriptionId,
      memberUid: authUser.uid,
      plan,
      price: Number(planConfig.price || 0),
      durationDays: Number(planConfig.durationDays || 30),
      suggestionsPerWeek: Number(planConfig.suggestionsPerWeek || 3),
      startDate: FieldValue.serverTimestamp(),
      endDate,
      status: "active",
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      pausedAt: null,
      pausedReason: "",
      resumedAt: null,
      cancelledAt: null,
      cancelReason: "",
      assignedMatchmakerUid: matchmakerUid,
      assignedAt: FieldValue.serverTimestamp(),
      reassignmentHistory: [],
      suggestionsDelivered: 0,
      isStickyAssignment: isSticky,
      source: String(req.body?.source || orderData.source || "dashboard_card").trim(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      version: 1,
    });
    batch.set(db.collection(MEMBERS_COLLECTION).doc(authUser.uid), {
      matchmakerActive: true,
      matchmakerEndDate: endDate,
      matchmakerSubscriptionId: subscriptionId,
      assignedMatchmakerUid: matchmakerUid,
      assignedMatchmakerName: matchmakerName || "Your Matchmaker",
      matchmakerAssignedAt: FieldValue.serverTimestamp(),
      isStickyMatchmaker: isSticky,
      lastMatchmakerUid: matchmakerUid,
      matchmakerPlan: plan,
      paymentGateway: "razorpay",
      paymentCurrency: "INR",
      lastPaymentId: paymentId,
      lastOrderId: orderId,
      lastPaymentAt: nowIso(),
      lastPaymentAmount: Number(planConfig.price || 0),
      paymentStatus: "paid",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection(PAYMENT_ORDERS_COLLECTION).doc(orderId), {
      status: "paid",
      paymentId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection(PAYMENTS_COLLECTION).doc(paymentId), paymentDoc, { merge: true });
    batch.set(db.collection(REVENUE_EVENTS_COLLECTION).doc(revenueEvents.paymentEventId), revenueEvents.paymentEvent, { merge: true });
    if (revenueEvents.commissionEvent) {
      batch.set(db.collection(REVENUE_EVENTS_COLLECTION).doc(revenueEvents.commissionEventId), revenueEvents.commissionEvent, { merge: true });
    }
    await batch.commit();

    await Promise.all([
      logActivity({
        memberUid: authUser.uid,
        actor: { type: "system", uid: "system", name: "Parichayam" },
        eventType: ACTIVITY_EVENT_TYPES.MEMBER_MATCHMAKER_SUBSCRIBED,
        details: { plan, price: Number(planConfig.price || 0), durationDays: Number(planConfig.durationDays || 30), isSticky },
        relatedDocs: [{ collection: MATCHMAKER_SUBSCRIPTIONS_COLLECTION, id: subscriptionId }],
      }),
      logActivity({
        memberUid: authUser.uid,
        actor: { type: "system", uid: "system", name: "Parichayam" },
        eventType: ACTIVITY_EVENT_TYPES.MATCHMAKER_ASSIGNED,
        details: { matchmakerUid, matchmakerName, isSticky },
        relatedDocs: [{ collection: MATCHMAKER_SUBSCRIPTIONS_COLLECTION, id: subscriptionId }],
      }),
    ]);

    sendJson(req, res, 200, {
      ok: true,
      subscriptionId,
      endDate: endDate.toDate().toISOString(),
      matchmakerUid,
      matchmakerName,
      isSticky,
    });
  } catch (error) {
    logger.error("enrollMatchmakerSubscription failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to activate matchmaker subscription." });
  }
});

exports.cancelMatchmakerSubscription = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const subscription = await readActiveMatchmakerSubscription(authUser.uid);
    if (!subscription) throw matchmakerError(404, "No active matchmaker subscription found.");
    if (subscription.cancelledAt) {
      sendJson(req, res, 200, {
        ok: true,
        alreadyCancelled: true,
        subscriptionId: subscription.subscriptionId,
        activeUntil: subscription.endDate || "",
        cancelsAtEnd: true,
      });
      return;
    }
    await db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION).doc(subscription.subscriptionId).set({
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: String(req.body?.reason || "Cancelled by member").trim().slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await logActivity({
      memberUid: authUser.uid,
      actor: { type: "member", uid: authUser.uid, name: "Member" },
      eventType: ACTIVITY_EVENT_TYPES.MEMBER_MATCHMAKER_CANCELLED,
      details: { subscriptionId: subscription.subscriptionId, reason: String(req.body?.reason || "Cancelled by member").trim().slice(0, 500) },
      relatedDocs: [{ collection: MATCHMAKER_SUBSCRIPTIONS_COLLECTION, id: subscription.subscriptionId }],
    });
    sendJson(req, res, 200, {
      ok: true,
      subscriptionId: subscription.subscriptionId,
      activeUntil: subscription.endDate || "",
      cancelsAtEnd: true,
    });
  } catch (error) {
    logger.error("cancelMatchmakerSubscription failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to cancel subscription." });
  }
});

exports.getMatchmakerEnrollmentInfo = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    await ensureMatchmakerDefaults();
    const [pricing, proof, prompts, memberSnap] = await Promise.all([
      readMatchmakerPricing(),
      readMatchmakerProof(),
      readMatchmakerPrompts(),
      db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get(),
    ]);
    const member = memberSnap.exists ? (memberSnap.data() || {}) : {};
    const subscription = await readActiveMatchmakerSubscription(authUser.uid);
    sendJson(req, res, 200, {
      ok: true,
      pricing,
      proof,
      prompts,
      member: {
        uid: authUser.uid,
        isPaid: member.isPaid === true,
        assignedMatchmakerUid: String(member.assignedMatchmakerUid || "").trim(),
        assignedMatchmakerName: String(member.assignedMatchmakerName || "").trim(),
        matchmakerActive: member.matchmakerActive === true,
        matchmakerPlan: String(member.matchmakerPlan || "").trim(),
        matchmakerEndDate: member.matchmakerEndDate || "",
      },
      subscription: subscription ? {
        ...subscription,
        cancelsAtEnd: Boolean(subscription.cancelledAt),
      } : null,
    });
  } catch (error) {
    logger.error("getMatchmakerEnrollmentInfo failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load matchmaker enrollment details." });
  }
});

exports.searchMembersForMatchmaker = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const user = await verifyMatchmakerUser(req);
    const body = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const limitValue = Math.max(1, Math.min(80, Math.round(Number(body.limit || 24) || 24)));
    const cursor = String(body.cursor || "").trim();
    const filterQuery = String(body.query || "").trim().toLowerCase();
    const minAge = body.minAge !== undefined ? Math.max(18, Math.min(80, Math.round(Number(body.minAge) || 18))) : null;
    const maxAge = body.maxAge !== undefined ? Math.max(18, Math.min(80, Math.round(Number(body.maxAge) || 80))) : null;
    const snap = await db.collection(MEMBERS_COLLECTION).where("isPaid", "==", true).limit(500).get();
    let results = await Promise.all(snap.docs.map(async (doc) => {
      const data = { uid: doc.id, ...(doc.data() || {}) };
      await ensureMemberNameLower(doc.id, data);
      const card = sanitizeMatchmakerAssignmentForViewer(buildLeanMemberCard(data), user.uid, user.member?.role);
      card.photoUrl = await getMemberPhotoUrlForViewer(user.uid, data);
      return { raw: data, card };
    }));
    results = results.filter(({ raw, card }) => {
      if (!card) return false;
      if (normalizeMemberRole(raw.role)) return normalizeMemberRole(raw.role) === "MEMBER";
      return true;
    }).filter(({ raw, card }) => {
      if (body.gender && String(card.gender || "").trim().toLowerCase() !== String(body.gender).trim().toLowerCase()) return false;
      if (body.city && String(card.city || "").trim().toLowerCase() !== String(body.city).trim().toLowerCase()) return false;
      if (body.state && String(card.state || "").trim().toLowerCase() !== String(body.state).trim().toLowerCase()) return false;
      if (body.gotra && String(card.gotra || "").trim().toLowerCase() !== String(body.gotra).trim().toLowerCase()) return false;
      if (body.educationLevel && String(card.educationLevel || card.education || "").trim().toLowerCase() !== String(body.educationLevel).trim().toLowerCase()) return false;
      if (body.profession && !String(card.profession || "").trim().toLowerCase().includes(String(body.profession).trim().toLowerCase())) return false;
      if (body.manglik && String(card.manglik || "").trim().toLowerCase() !== String(body.manglik).trim().toLowerCase()) return false;
      if (body.diet && String(card.diet || "").trim().toLowerCase() !== String(body.diet).trim().toLowerCase()) return false;
      if (body.engagementStatus && String(card.engagementStatus || "").trim().toLowerCase() !== String(body.engagementStatus).trim().toLowerCase()) return false;
      if (body.assignedOnly === true && !card.isAssignedToMe) return false;
      if (minAge !== null && (card.age === null || card.age < minAge)) return false;
      if (maxAge !== null && (card.age === null || card.age > maxAge)) return false;
      if (filterQuery) {
        const haystack = [
          card.name,
          card.profileNumber,
          card.city,
          card.state,
          card.profession,
          card.education,
          card.gotra,
        ].join(" ").toLowerCase();
        if (!haystack.includes(filterQuery)) return false;
      }
      return true;
    });
    results.sort((left, right) => parseTimestampMs(right.raw.paidAt || right.raw.updatedAt) - parseTimestampMs(left.raw.paidAt || left.raw.updatedAt));
    const cards = results.map((item) => item.card);
    const startIndex = cursor ? Math.max(0, cards.findIndex((item) => String(item.uid || "") === cursor) + 1) : 0;
    const slice = cards.slice(startIndex, startIndex + limitValue);
    sendJson(req, res, 200, {
      ok: true,
      results: slice,
      nextCursor: slice.length === limitValue ? String(slice[slice.length - 1].uid || "") : "",
    });
  } catch (error) {
    logger.error("searchMembersForMatchmaker failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Search failed." });
  }
});

exports.universalMemberSearch = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const user = await verifyMatchmakerUser(req);
    const q = String(req.body?.query || req.query?.query || "").trim();
    if (!q || q.length < 2) { sendJson(req, res, 200, { ok: true, results: [] }); return; }
    let results = [];
    if (/^P\d+$/i.test(q)) {
      const snap = await db.collection(MEMBERS_COLLECTION).where("profileNumber", "==", q.toUpperCase()).limit(5).get();
      results = snap.docs.map((doc) => ({ uid: doc.id, type: "pnumber_match", ...(doc.data() || {}) }));
    } else if (/^[+\d\s-]{10,15}$/.test(q)) {
      const normalized = normalizePhone(q);
      const snap = await db.collection(MEMBERS_COLLECTION).where("phone", "==", normalized).limit(5).get();
      results = snap.docs.map((doc) => ({ uid: doc.id, type: "phone_match", ...(doc.data() || {}) }));
    } else if (q.includes("@")) {
      const snap = await db.collection(MEMBERS_COLLECTION).where("email", "==", q.toLowerCase()).limit(5).get();
      results = snap.docs.map((doc) => ({ uid: doc.id, type: "email_match", ...(doc.data() || {}) }));
    } else {
      const qLower = q.toLowerCase();
      let snap = await db.collection(MEMBERS_COLLECTION)
        .where("nameLower", ">=", qLower)
        .where("nameLower", "<=", qLower + "\uf8ff")
        .limit(10)
        .get()
        .catch(() => null);
      if (!snap || snap.empty) {
        const fallbackSnap = await db.collection(MEMBERS_COLLECTION).limit(300).get();
        results = fallbackSnap.docs
          .map((doc) => ({ uid: doc.id, ...(doc.data() || {}) }))
          .filter((item) => String(item.name || item.fullName || "").trim().toLowerCase().includes(qLower))
          .slice(0, 10)
          .map((item) => ({ ...item, type: "name_match" }));
      } else {
        results = snap.docs.map((doc) => ({ uid: doc.id, type: "name_match", ...(doc.data() || {}) }));
      }
    }
    const sanitized = await Promise.all(results.map(async (r) => {
      await ensureMemberNameLower(r.uid, r);
      const isAssignedToMe = String(r.assignedMatchmakerUid || "") === String(user.uid || "");
      return {
        uid: r.uid,
        profileNumber: r.profileNumber || "",
        name: r.name || "",
        firstName: firstName(r.name || ""),
        age: computeAgeFromValue(r.dateOfBirth || r.dob),
        city: r.city || "",
        gender: r.gender || "",
        tier: r.tier || r.plan || "",
        isPaid: r.isPaid === true,
        photoUrl: await getMemberPhotoUrlForViewer(user.uid, r),
        assignedMatchmakerUid: normalizeMemberRole(user.member?.role) === "ADMIN" ? (r.assignedMatchmakerUid || "") : (isAssignedToMe ? String(user.uid || "") : ""),
        isAssignedToMe,
        matchType: r.type,
      };
    }));
    sendJson(req, res, 200, { ok: true, results: sanitized });
  } catch (error) {
    logger.error("universalMemberSearch failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Search failed." });
  }
});

exports.getMemberProfile360 = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const user = await verifyAuthenticatedUser(req);
    const targetMemberUid = String(req.body?.memberUid || req.query?.memberUid || "").trim();
    if (!targetMemberUid) throw matchmakerError(400, "memberUid required.");
    const [viewerSnap, targetSnap] = await Promise.all([
      db.collection(MEMBERS_COLLECTION).doc(user.uid).get(),
      db.collection(MEMBERS_COLLECTION).doc(targetMemberUid).get(),
    ]);
    if (!targetSnap.exists) throw matchmakerError(404, "Member not found.");
    if (!viewerSnap.exists) throw matchmakerError(404, "Viewer profile not found.");
    const viewer = viewerSnap.data() || {};
    const target = { uid: targetSnap.id, ...(targetSnap.data() || {}) };
    await ensureMemberNameLower(target.uid, target);
    const viewerRole = normalizeMemberRole(viewer.role || "MEMBER");
    const isAdminUser = viewerRole === "ADMIN";
    const isMatchmakerUser = viewerRole === "MATCHMAKER";
    const isSelf = String(user.uid || "") === targetMemberUid;
    const isAssignedMatchmaker = isMatchmakerUser && String(target.assignedMatchmakerUid || "") === String(user.uid || "");
    const canViewSensitiveProfile = isAdminUser || isSelf || isAssignedMatchmaker;
    if (!isAdminUser && !isMatchmakerUser && !isSelf) throw matchmakerError(403, "Not authorized to view this profile.");
    const profile = {
      uid: target.uid,
      profileNumber: target.profileNumber || "",
      name: target.name || "",
      firstName: firstName(target.name || ""),
      age: computeAgeFromValue(target.dateOfBirth || target.dob),
      gender: target.gender || "",
      phone: canViewSensitiveProfile ? (target.phone || "") : "",
      email: canViewSensitiveProfile ? (target.email || "") : "",
      city: target.city || "",
      state: target.state || "",
      profession: target.profession || "",
      education: target.education || "",
      educationLevel: target.educationLevel || "",
      gotra: target.gotra || "",
      kulaDeivam: target.kulaDeivam || "",
      nativeVillage: target.nativeVillage || "",
      manglik: target.manglik || "",
      diet: target.diet || "",
      tier: target.tier || target.plan || "",
      isPaid: target.isPaid === true,
      status: target.status || "",
      verificationStatus: target.verificationStatus || {},
      photoUrl: await getMemberPhotoUrlForViewer(user.uid, target),
      family: canViewSensitiveProfile ? {
        fatherName: target.fatherName || "",
        motherName: target.motherName || "",
        siblings: target.siblings || "",
        nativeVillage: target.nativeVillage || "",
      } : null,
      preferences: target.preferences || {},
      matchmaker: target.matchmakerActive ? {
        active: true,
        isAssignedToViewer: isAssignedMatchmaker,
        uid: canViewSensitiveProfile ? (target.assignedMatchmakerUid || "") : "",
        name: canViewSensitiveProfile ? (target.assignedMatchmakerName || "") : "",
        endDate: canViewSensitiveProfile ? (target.matchmakerEndDate || "") : "",
        plan: canViewSensitiveProfile ? (target.matchmakerPlan || "") : "",
      } : null,
    };
    const activitySnap = await db.collection(ACTIVITY_LOG_COLLECTION)
      .where("memberUid", "==", targetMemberUid)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get()
      .catch(() => ({ docs: [] }));
    const activity = activitySnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter((entry) => {
        if (isAdminUser) return true;
        if (isAssignedMatchmaker) return entry.visibility?.matchmaker !== false;
        if (isSelf) return entry.visibility?.member === true;
        if (isMatchmakerUser) return false;
        return false;
      });
    let notes = [];
    if (isAdminUser || isAssignedMatchmaker) {
      const notesSnap = await db.collection(MATCHMAKER_NOTES_COLLECTION)
        .where("memberUid", "==", targetMemberUid)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get()
        .catch(() => ({ docs: [] }));
      notes = notesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    }
    const suggestionsRaw = await loadSuggestionsForMember(targetMemberUid, 40);
    const suggestions = await Promise.all(suggestionsRaw.map((item) => enrichSuggestionForViewer(item, user.uid, viewerRole)));
    sendJson(req, res, 200, {
      ok: true,
      profile,
      activity,
      notes,
      suggestions,
      viewerRole,
      isAssignedMatchmaker,
    });
  } catch (error) {
    logger.error("getMemberProfile360 failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Failed to load profile." });
  }
});

exports.createMatchSuggestion = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const matchmaker = await verifyMatchmakerUser(req);
    const settings = await readMatchmakerSettings();
    const memberAUid = String(req.body?.memberAUid || "").trim();
    const memberBUid = String(req.body?.memberBUid || "").trim();
    const note = String(req.body?.matchmakerNote || "").trim();
    const requestedScore = clampMatchScore(req.body?.matchScore || 70);
    if (!memberAUid || !memberBUid) throw matchmakerError(400, "Both members are required.");
    if (memberAUid === memberBUid) throw matchmakerError(400, "Cannot match member to themselves.");
    if (note.length < settings.minimumNoteLength || note.length > settings.maximumNoteLength) {
      throw matchmakerError(400, `Matchmaker note must be ${settings.minimumNoteLength}-${settings.maximumNoteLength} characters.`);
    }
    const [memberA, memberB] = await Promise.all([fetchMemberLean(memberAUid), fetchMemberLean(memberBUid)]);
    if (!memberA || !memberB) throw matchmakerError(404, "Member(s) not found.");
    if (!isAdminMemberRole(matchmaker.member.role) && String(memberA.assignedMatchmakerUid || "") !== String(matchmaker.uid || "")) {
      throw matchmakerError(403, `Member A (${memberA.profileNumber || memberAUid}) is not assigned to you.`);
    }
    const recentA = await loadSuggestionsForMember(memberAUid, 100);
    const duplicate = recentA.find((item) => {
      const createdMs = parseTimestampMs(item.createdAt);
      if (!createdMs || (Date.now() - createdMs) > (30 * 24 * 60 * 60 * 1000)) return false;
      const pairMatches = (
        (String(item.forMemberAUid || "") === memberAUid && String(item.forMemberBUid || "") === memberBUid) ||
        (String(item.forMemberAUid || "") === memberBUid && String(item.forMemberBUid || "") === memberAUid)
      );
      return pairMatches && !isClosedSuggestionStatus(item.status);
    });
    if (duplicate) throw matchmakerError(409, "This pair already has an active suggestion in the last 30 days.");
    const computed = computeCompatibilityScore(memberA, memberB, settings);
    const suggestionId = buildSuggestionId();
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + (settings.suggestionExpiryDays * 24 * 60 * 60 * 1000)));
    const payload = {
      suggestionId,
      forMemberAUid: memberAUid,
      forMemberBUid: memberBUid,
      createdBy: matchmaker.uid,
      createdByName: String(matchmaker.member?.name || "Matchmaker").trim(),
      createdAt: FieldValue.serverTimestamp(),
      matchmakerNote: note,
      matchScore: Math.max(requestedScore, computed.score),
      compatibilityFactors: computed.factors,
      status: SUGGESTION_STATUS_FLOW.PENDING,
      memberAAction: "",
      memberAActionAt: null,
      memberAViewedAt: null,
      memberADeclineReason: "",
      memberBAction: "",
      memberBActionAt: null,
      memberBViewedAt: null,
      memberBDeclineReason: "",
      mutualInterestAt: null,
      familyIntroducedAt: null,
      closedAt: null,
      closeReason: "",
      expiresAt,
      source: String(req.body?.source || "manual").trim() || "manual",
      matchmakerSubscriptionId: String(req.body?.matchmakerSubscriptionId || memberA.matchmakerSubscriptionId || "").trim(),
      version: 1,
    };
    await db.collection(MATCH_SUGGESTIONS_COLLECTION).doc(suggestionId).set(payload);
    await Promise.all([
      logActivity({
        memberUid: memberAUid,
        actor: { type: "matchmaker", uid: matchmaker.uid, name: matchmaker.member?.name || "Matchmaker" },
        eventType: ACTIVITY_EVENT_TYPES.SUGGESTION_CREATED,
        details: { suggestedMemberUid: memberBUid, matchmakerNote: note, matchScore: payload.matchScore },
        relatedDocs: [{ collection: MATCH_SUGGESTIONS_COLLECTION, id: suggestionId }],
      }),
      logActivity({
        memberUid: memberBUid,
        actor: { type: "matchmaker", uid: matchmaker.uid, name: matchmaker.member?.name || "Matchmaker" },
        eventType: ACTIVITY_EVENT_TYPES.SUGGESTION_CREATED,
        details: { suggestedMemberUid: memberAUid, matchmakerNote: note, matchScore: payload.matchScore },
        relatedDocs: [{ collection: MATCH_SUGGESTIONS_COLLECTION, id: suggestionId }],
      }),
    ]);
    sendJson(req, res, 200, { ok: true, suggestionId, suggestion: { ...payload, createdAt: nowIso(), expiresAt: expiresAt.toDate().toISOString() } });
  } catch (error) {
    logger.error("createMatchSuggestion failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to create suggestion." });
  }
});

exports.markSuggestionViewed = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const suggestionId = String(req.body?.suggestionId || "").trim();
    if (!suggestionId) throw matchmakerError(400, "Suggestion ID is required.");
    const suggestionRef = db.collection(MATCH_SUGGESTIONS_COLLECTION).doc(suggestionId);
    const snap = await suggestionRef.get();
    if (!snap.exists) throw matchmakerError(404, "Suggestion not found.");
    const data = snap.data() || {};
    if (![String(data.forMemberAUid || ""), String(data.forMemberBUid || "")].includes(String(authUser.uid || ""))) {
      throw matchmakerError(403, "This suggestion is not for you.");
    }
    if (parseTimestampMs(data.expiresAt) && parseTimestampMs(data.expiresAt) < Date.now() && !isClosedSuggestionStatus(data.status)) {
      throw matchmakerError(409, "This suggestion has expired.");
    }
    const updates = { updatedAt: FieldValue.serverTimestamp() };
    if (String(data.forMemberAUid || "") === String(authUser.uid || "")) updates.memberAViewedAt = FieldValue.serverTimestamp();
    if (String(data.forMemberBUid || "") === String(authUser.uid || "")) updates.memberBViewedAt = FieldValue.serverTimestamp();
    updates.status = resolveSuggestionStatusFromActions({ ...data, ...updates });
    await suggestionRef.set(updates, { merge: true });
    await logActivity({
      memberUid: authUser.uid,
      actor: { type: "member", uid: authUser.uid, name: "Member" },
      eventType: ACTIVITY_EVENT_TYPES.SUGGESTION_VIEWED,
      details: { suggestionId },
      relatedDocs: [{ collection: MATCH_SUGGESTIONS_COLLECTION, id: suggestionId }],
      visibility: { member: true, matchmaker: true, admin: true },
    });
    sendJson(req, res, 200, { ok: true });
  } catch (error) {
    logger.error("markSuggestionViewed failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to mark suggestion viewed." });
  }
});

exports.respondToMatchSuggestion = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const suggestionId = String(req.body?.suggestionId || "").trim();
    const action = String(req.body?.action || "").trim().toLowerCase();
    const declineReason = String(req.body?.declineReason || "").trim().slice(0, 300);
    if (!suggestionId) throw matchmakerError(400, "Suggestion ID is required.");
    if (!["liked", "declined"].includes(action)) throw matchmakerError(400, "Action must be liked or declined.");
    const suggestionRef = db.collection(MATCH_SUGGESTIONS_COLLECTION).doc(suggestionId);
    const snap = await suggestionRef.get();
    if (!snap.exists) throw matchmakerError(404, "Suggestion not found.");
    const data = snap.data() || {};
    const isMemberA = String(data.forMemberAUid || "") === String(authUser.uid || "");
    const isMemberB = String(data.forMemberBUid || "") === String(authUser.uid || "");
    if (!isMemberA && !isMemberB) throw matchmakerError(403, "This suggestion is not for you.");
    if (parseTimestampMs(data.expiresAt) && parseTimestampMs(data.expiresAt) < Date.now() && !isClosedSuggestionStatus(data.status)) {
      throw matchmakerError(409, "This suggestion has expired.");
    }
    const updates = { updatedAt: FieldValue.serverTimestamp() };
    if (isMemberA) {
      updates.memberAAction = action;
      updates.memberAActionAt = FieldValue.serverTimestamp();
      updates.memberAViewedAt = data.memberAViewedAt || FieldValue.serverTimestamp();
      updates.memberADeclineReason = action === "declined" ? declineReason : "";
    }
    if (isMemberB) {
      updates.memberBAction = action;
      updates.memberBActionAt = FieldValue.serverTimestamp();
      updates.memberBViewedAt = data.memberBViewedAt || FieldValue.serverTimestamp();
      updates.memberBDeclineReason = action === "declined" ? declineReason : "";
    }
    const nextStatus = resolveSuggestionStatusFromActions({ ...data, ...updates });
    updates.status = nextStatus;
    if (nextStatus === SUGGESTION_STATUS_FLOW.MUTUAL_INTEREST) updates.mutualInterestAt = FieldValue.serverTimestamp();
    if ([SUGGESTION_STATUS_FLOW.A_DECLINED, SUGGESTION_STATUS_FLOW.B_DECLINED].includes(nextStatus)) {
      updates.closedAt = FieldValue.serverTimestamp();
      updates.closeReason = declineReason || "declined";
    }
    await suggestionRef.set(updates, { merge: true });
    const actorName = firstName((await fetchMemberLean(authUser.uid))?.name || "Member");
    await logActivity({
      memberUid: authUser.uid,
      actor: { type: "member", uid: authUser.uid, name: actorName || "Member" },
      eventType: action === "liked" ? ACTIVITY_EVENT_TYPES.SUGGESTION_LIKED : ACTIVITY_EVENT_TYPES.SUGGESTION_DECLINED,
      details: { suggestionId, action, declineReason },
      relatedDocs: [{ collection: MATCH_SUGGESTIONS_COLLECTION, id: suggestionId }],
      visibility: { member: true, matchmaker: true, admin: true },
    });
    if (nextStatus === SUGGESTION_STATUS_FLOW.MUTUAL_INTEREST) {
      await Promise.all([
        logActivity({
          memberUid: String(data.forMemberAUid || ""),
          actor: { type: "system", uid: "system", name: "Parichayam" },
          eventType: ACTIVITY_EVENT_TYPES.MUTUAL_INTEREST_REACHED,
          details: { suggestionId, otherMemberUid: String(data.forMemberBUid || "") },
          relatedDocs: [{ collection: MATCH_SUGGESTIONS_COLLECTION, id: suggestionId }],
        }),
        logActivity({
          memberUid: String(data.forMemberBUid || ""),
          actor: { type: "system", uid: "system", name: "Parichayam" },
          eventType: ACTIVITY_EVENT_TYPES.MUTUAL_INTEREST_REACHED,
          details: { suggestionId, otherMemberUid: String(data.forMemberAUid || "") },
          relatedDocs: [{ collection: MATCH_SUGGESTIONS_COLLECTION, id: suggestionId }],
        }),
      ]);
    }
    sendJson(req, res, 200, { ok: true, status: nextStatus });
  } catch (error) {
    logger.error("respondToMatchSuggestion failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to respond to suggestion." });
  }
});

exports.getMemberSuggestions = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const [viewerSnap, settings] = await Promise.all([
      db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get(),
      readMatchmakerSettings(),
    ]);
    const viewerRole = normalizeMemberRole(viewerSnap.data()?.role || "MEMBER");
    const suggestions = await loadSuggestionsForMember(authUser.uid, 40);
    const enriched = await Promise.all(suggestions
      .filter((item) => !isClosedSuggestionStatus(item.status))
      .map(async (item) => {
        const out = await enrichSuggestionForViewer(item, authUser.uid, viewerRole);
        if (out.otherMember) {
          const viewerResponded = (String(item.forMemberAUid || "") === String(authUser.uid || "") && !!String(item.memberAAction || "").trim()) ||
            (String(item.forMemberBUid || "") === String(authUser.uid || "") && !!String(item.memberBAction || "").trim());
          if (viewerResponded) {
            const target = await fetchMemberLean(out.otherMember.uid);
            out.otherMember.photoUrl = target ? (target.profilePhotoUrl || target.photoUrl || out.otherMember.photoUrl || null) : out.otherMember.photoUrl;
          }
          if (String(item.status || "") !== SUGGESTION_STATUS_FLOW.MUTUAL_INTEREST && settings.revealFullNameOnMutualInterest) {
            out.otherMember.name = out.otherMember.firstName || out.otherMember.name;
          }
        }
        return out;
      }));
    sendJson(req, res, 200, { ok: true, suggestions: enriched });
  } catch (error) {
    logger.error("getMemberSuggestions failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load suggestions." });
  }
});

exports.createFamilyIntroduction = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const user = await verifyMatchmakerUser(req);
    const suggestionId = String(req.body?.matchSuggestionId || "").trim();
    if (!suggestionId) throw matchmakerError(400, "matchSuggestionId is required.");
    const suggestionSnap = await db.collection(MATCH_SUGGESTIONS_COLLECTION).doc(suggestionId).get();
    if (!suggestionSnap.exists) throw matchmakerError(404, "Suggestion not found.");
    const suggestion = suggestionSnap.data() || {};
    if (!isAdminMemberRole(user.member.role)) {
      await verifyAssignedMatchmaker(req, suggestion.forMemberAUid);
    }
    if (![SUGGESTION_STATUS_FLOW.MUTUAL_INTEREST, SUGGESTION_STATUS_FLOW.FAMILY_INTRODUCED, SUGGESTION_STATUS_FLOW.IN_DISCUSSION].includes(String(suggestion.status || ""))) {
      throw matchmakerError(409, "Family introduction is allowed after mutual interest.");
    }
    const introductionId = buildIntroductionId();
    const payload = {
      introductionId,
      matchSuggestionId: suggestionId,
      memberAUid: String(suggestion.forMemberAUid || "").trim(),
      memberBUid: String(suggestion.forMemberBUid || "").trim(),
      createdBy: user.uid,
      scheduledCallAt: req.body?.scheduledCallAt ? Timestamp.fromDate(new Date(req.body.scheduledCallAt)) : null,
      memberAFamilyContact: req.body?.memberAFamilyContact || {},
      memberBFamilyContact: req.body?.memberBFamilyContact || {},
      talkingPoints: String(req.body?.talkingPoints || "").trim().slice(0, 2000),
      notesForFamilyA: String(req.body?.notesForFamilyA || "").trim().slice(0, 2000),
      notesForFamilyB: String(req.body?.notesForFamilyB || "").trim().slice(0, 2000),
      status: "scheduled",
      outcome: "",
      outcomeNote: "",
      outcomeAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.collection(FAMILY_INTRODUCTIONS_COLLECTION).doc(introductionId).set(payload);
    await db.collection(MATCH_SUGGESTIONS_COLLECTION).doc(suggestionId).set({
      status: SUGGESTION_STATUS_FLOW.FAMILY_INTRODUCED,
      familyIntroducedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await Promise.all([
      logActivity({
        memberUid: payload.memberAUid,
        actor: { type: "matchmaker", uid: user.uid, name: user.member?.name || "Matchmaker" },
        eventType: ACTIVITY_EVENT_TYPES.FAMILY_INTRODUCTION_CREATED,
        details: { introductionId, otherMemberUid: payload.memberBUid, scheduledCallAt: req.body?.scheduledCallAt || "" },
        relatedDocs: [{ collection: FAMILY_INTRODUCTIONS_COLLECTION, id: introductionId }],
      }),
      logActivity({
        memberUid: payload.memberBUid,
        actor: { type: "matchmaker", uid: user.uid, name: user.member?.name || "Matchmaker" },
        eventType: ACTIVITY_EVENT_TYPES.FAMILY_INTRODUCTION_CREATED,
        details: { introductionId, otherMemberUid: payload.memberAUid, scheduledCallAt: req.body?.scheduledCallAt || "" },
        relatedDocs: [{ collection: FAMILY_INTRODUCTIONS_COLLECTION, id: introductionId }],
      }),
    ]);
    sendJson(req, res, 200, { ok: true, introductionId });
  } catch (error) {
    logger.error("createFamilyIntroduction failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to create family introduction." });
  }
});

exports.updateIntroductionOutcome = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const user = await verifyMatchmakerUser(req);
    const introductionId = String(req.body?.introductionId || "").trim();
    const outcome = String(req.body?.outcome || "").trim().toLowerCase();
    if (!introductionId) throw matchmakerError(400, "introductionId is required.");
    if (!["in_discussion", "engaged", "not_proceeding"].includes(outcome)) throw matchmakerError(400, "Invalid outcome.");
    const ref = db.collection(FAMILY_INTRODUCTIONS_COLLECTION).doc(introductionId);
    const snap = await ref.get();
    if (!snap.exists) throw matchmakerError(404, "Introduction not found.");
    const intro = snap.data() || {};
    if (!isAdminMemberRole(user.member.role)) await verifyAssignedMatchmaker(req, intro.memberAUid);
    await ref.set({
      outcome,
      outcomeNote: String(req.body?.outcomeNote || "").trim().slice(0, 2000),
      outcomeAt: FieldValue.serverTimestamp(),
      status: outcome === "in_discussion" ? "completed" : (outcome === "engaged" ? "completed" : "cancelled"),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const suggestionPatch = outcome === "engaged"
      ? { status: SUGGESTION_STATUS_FLOW.ENGAGED, closedAt: FieldValue.serverTimestamp(), closeReason: "engaged", updatedAt: FieldValue.serverTimestamp() }
      : outcome === "not_proceeding"
        ? { status: SUGGESTION_STATUS_FLOW.CLOSED, closedAt: FieldValue.serverTimestamp(), closeReason: "not_proceeding", updatedAt: FieldValue.serverTimestamp() }
        : { status: SUGGESTION_STATUS_FLOW.IN_DISCUSSION, updatedAt: FieldValue.serverTimestamp() };
    await db.collection(MATCH_SUGGESTIONS_COLLECTION).doc(String(intro.matchSuggestionId || "")).set(suggestionPatch, { merge: true });
    if (outcome === "engaged") {
      const batch = db.batch();
      [intro.memberAUid, intro.memberBUid].forEach((memberUid) => {
        batch.set(db.collection(MEMBERS_COLLECTION).doc(String(memberUid || "").trim()), {
          engagementStatus: "engaged",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
    }
    await Promise.all([
      logActivity({
        memberUid: intro.memberAUid,
        actor: { type: "matchmaker", uid: user.uid, name: user.member?.name || "Matchmaker" },
        eventType: ACTIVITY_EVENT_TYPES.FAMILY_INTRODUCTION_OUTCOME_RECORDED,
        details: { introductionId, outcome },
        relatedDocs: [{ collection: FAMILY_INTRODUCTIONS_COLLECTION, id: introductionId }],
      }),
      logActivity({
        memberUid: intro.memberBUid,
        actor: { type: "matchmaker", uid: user.uid, name: user.member?.name || "Matchmaker" },
        eventType: ACTIVITY_EVENT_TYPES.FAMILY_INTRODUCTION_OUTCOME_RECORDED,
        details: { introductionId, outcome },
        relatedDocs: [{ collection: FAMILY_INTRODUCTIONS_COLLECTION, id: introductionId }],
      }),
    ]);
    sendJson(req, res, 200, { ok: true, outcome });
  } catch (error) {
    logger.error("updateIntroductionOutcome failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to update introduction outcome." });
  }
});

exports.addMatchmakerNote = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const matchmaker = await verifyMatchmakerUser(req);
    const settings = await readMatchmakerSettings();
    const memberUid = String(req.body?.memberUid || "").trim();
    const noteText = String(req.body?.noteText || "").trim();
    const category = MATCHMAKER_NOTE_CATEGORIES.includes(String(req.body?.category || "").trim()) ? String(req.body?.category || "").trim() : "general";
    if (!memberUid) throw matchmakerError(400, "memberUid is required.");
    if (!isAdminMemberRole(matchmaker.member.role)) {
      const targetSnap = await db.collection(MEMBERS_COLLECTION).doc(memberUid).get();
      if (!targetSnap.exists || String(targetSnap.data()?.assignedMatchmakerUid || "") !== String(matchmaker.uid || "")) {
        throw matchmakerError(403, "Not assigned to this member.");
      }
    }
    if (noteText.length < settings.minimumNoteLength) throw matchmakerError(400, `Note must be at least ${settings.minimumNoteLength} characters.`);
    const noteId = buildNoteId();
    await db.collection(MATCHMAKER_NOTES_COLLECTION).doc(noteId).set({
      noteId,
      memberUid,
      authorUid: matchmaker.uid,
      authorName: matchmaker.member?.name || "Matchmaker",
      noteText: noteText.slice(0, 2000),
      category,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logActivity({
      memberUid,
      actor: { type: "matchmaker", uid: matchmaker.uid, name: matchmaker.member?.name || "Matchmaker" },
      eventType: ACTIVITY_EVENT_TYPES.MATCHMAKER_NOTE_ADDED,
      details: { category, preview: noteText.slice(0, 100) },
      visibility: { member: false, matchmaker: true, admin: true },
      relatedDocs: [{ collection: MATCHMAKER_NOTES_COLLECTION, id: noteId }],
    });
    sendJson(req, res, 200, { ok: true, noteId });
  } catch (error) {
    logger.error("addMatchmakerNote failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to save note." });
  }
});

exports.sendMatchmakerMessage = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const viewerSnap = await db.collection(MEMBERS_COLLECTION).doc(authUser.uid).get();
    if (!viewerSnap.exists) throw matchmakerError(404, "Sender profile not found.");
    const sender = viewerSnap.data() || {};
    const senderRole = normalizeMemberRole(sender.role || "MEMBER");
    const memberUid = String(req.body?.memberUid || "").trim();
    const text = String(req.body?.text || "").trim();
    const attachmentUrl = String(req.body?.attachmentUrl || "").trim();
    const attachmentType = MATCHMAKER_MESSAGE_ATTACHMENT_TYPES.includes(String(req.body?.attachmentType || "").trim()) ? String(req.body?.attachmentType || "").trim() : "";
    if (!memberUid) throw matchmakerError(400, "memberUid is required.");
    if (!text && !attachmentUrl) throw matchmakerError(400, "Message text or attachment is required.");
    const memberSnap = await db.collection(MEMBERS_COLLECTION).doc(memberUid).get();
    if (!memberSnap.exists) throw matchmakerError(404, "Member not found.");
    const memberData = memberSnap.data() || {};
    const assignedMatchmakerUid = String(memberData.assignedMatchmakerUid || "").trim();
    let conversationId = "";
    let toUid = "";
    let fromRole = "member";
    if (senderRole === "ADMIN") {
      toUid = String(req.body?.toUid || memberUid).trim();
      conversationId = buildMatchmakerConversationId(String(req.body?.matchmakerUid || assignedMatchmakerUid).trim(), memberUid);
      fromRole = "admin";
    } else if (senderRole === "MATCHMAKER") {
      if (assignedMatchmakerUid !== String(authUser.uid || "")) throw matchmakerError(403, "This member is assigned to another matchmaker.");
      toUid = memberUid;
      conversationId = buildMatchmakerConversationId(authUser.uid, memberUid);
      fromRole = "matchmaker";
    } else {
      if (!assignedMatchmakerUid) throw matchmakerError(409, "You do not have an assigned matchmaker yet.");
      if (String(authUser.uid || "") !== memberUid) throw matchmakerError(403, "Members can only message about their own account.");
      toUid = assignedMatchmakerUid;
      conversationId = buildMatchmakerConversationId(assignedMatchmakerUid, memberUid);
      fromRole = "member";
    }
    const messageId = buildMessageId();
    await db.collection(MATCHMAKER_MESSAGES_COLLECTION).doc(messageId).set({
      messageId,
      conversationId,
      fromUid: authUser.uid,
      toUid,
      fromRole: fromRole === "admin" ? "admin" : (fromRole === "matchmaker" ? "matchmaker" : "member"),
      text: text.slice(0, 4000),
      attachmentUrl: attachmentUrl || null,
      attachmentType,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    await logActivity({
      memberUid,
      actor: { type: fromRole === "matchmaker" ? "matchmaker" : (fromRole === "admin" ? "admin" : "member"), uid: authUser.uid, name: sender.name || "Parichayam" },
      eventType: ACTIVITY_EVENT_TYPES.MATCHMAKER_MESSAGE_SENT,
      details: { conversationId, preview: text.slice(0, 100), attachmentType },
      visibility: { member: true, matchmaker: true, admin: true },
      relatedDocs: [{ collection: MATCHMAKER_MESSAGES_COLLECTION, id: messageId }],
    });
    sendJson(req, res, 200, { ok: true, messageId, conversationId });
  } catch (error) {
    logger.error("sendMatchmakerMessage failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to send message." });
  }
});

exports.getMyConversations = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const [sentSnap, receivedSnap] = await Promise.all([
      db.collection(MATCHMAKER_MESSAGES_COLLECTION).where("fromUid", "==", authUser.uid).limit(200).get().catch(() => ({ docs: [] })),
      db.collection(MATCHMAKER_MESSAGES_COLLECTION).where("toUid", "==", authUser.uid).limit(200).get().catch(() => ({ docs: [] })),
    ]);
    const all = [...sentSnap.docs, ...receivedSnap.docs]
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .sort((left, right) => parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt));
    const map = new Map();
    for (const message of all) {
      const conversationId = String(message.conversationId || "").trim();
      if (!conversationId || map.has(conversationId)) continue;
      const memberUid = conversationId.split("_").slice(-1)[0] || "";
      const member = await fetchMemberLean(memberUid);
      map.set(conversationId, {
        conversationId,
        member: buildLeanMemberCard(member || {}),
        lastMessage: message.text || "",
        lastAttachmentType: message.attachmentType || "",
        lastMessageAt: message.createdAt || "",
        unread: 0,
      });
    }
    all.forEach((message) => {
      if (String(message.toUid || "") !== String(authUser.uid || "")) return;
      if (message.readAt) return;
      const convo = map.get(String(message.conversationId || "").trim());
      if (convo) convo.unread += 1;
    });
    sendJson(req, res, 200, { ok: true, conversations: Array.from(map.values()) });
  } catch (error) {
    logger.error("getMyConversations failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load conversations." });
  }
});

exports.getMessagesForConversation = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const conversationId = String(req.body?.conversationId || req.query?.conversationId || "").trim();
    if (!conversationId) throw matchmakerError(400, "conversationId is required.");
    const snap = await db.collection(MATCHMAKER_MESSAGES_COLLECTION)
      .where("conversationId", "==", conversationId)
      .orderBy("createdAt", "asc")
      .limit(300)
      .get();
    const messages = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    if (messages.length && !messages.some((message) => String(message.fromUid || "") === String(authUser.uid || "") || String(message.toUid || "") === String(authUser.uid || ""))) {
      throw matchmakerError(403, "You are not part of this conversation.");
    }
    const unreadRefs = snap.docs.filter((doc) => {
      const data = doc.data() || {};
      return String(data.toUid || "") === String(authUser.uid || "") && !data.readAt;
    });
    await Promise.all(unreadRefs.map((doc) => doc.ref.set({ readAt: FieldValue.serverTimestamp() }, { merge: true })));
    sendJson(req, res, 200, { ok: true, messages });
  } catch (error) {
    logger.error("getMessagesForConversation failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load messages." });
  }
});

exports.adminReassignMatchmaker = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const memberUid = String(req.body?.memberUid || "").trim();
    const newMatchmakerUid = String(req.body?.newMatchmakerUid || "").trim();
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (!memberUid || !newMatchmakerUid) throw matchmakerError(400, "memberUid and newMatchmakerUid are required.");
    const result = await db.runTransaction(async (transaction) => {
      const memberRef = db.collection(MEMBERS_COLLECTION).doc(memberUid);
      const memberSnap = await transaction.get(memberRef);
      if (!memberSnap.exists) throw matchmakerError(404, "Member not found.");
      const oldMatchmakerUid = String(memberSnap.data()?.assignedMatchmakerUid || "").trim();
      const newMatchmakerRef = db.collection(MEMBERS_COLLECTION).doc(newMatchmakerUid);
      const newMatchmakerSnap = await transaction.get(newMatchmakerRef);
      if (!newMatchmakerSnap.exists || !isMatchmakerMemberRole(newMatchmakerSnap.data()?.role)) throw matchmakerError(400, "Invalid new matchmaker.");
      const newMatchmakerName = String(newMatchmakerSnap.data()?.name || "Matchmaker").trim();
      transaction.set(memberRef, {
        assignedMatchmakerUid: newMatchmakerUid,
        assignedMatchmakerName: newMatchmakerName,
        matchmakerAssignedAt: FieldValue.serverTimestamp(),
        lastMatchmakerUid: newMatchmakerUid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      const subQuery = db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION)
        .where("memberUid", "==", memberUid)
        .where("status", "==", "active")
        .limit(1);
      const subSnap = await transaction.get(subQuery);
      if (!subSnap.empty) {
        const subRef = subSnap.docs[0].ref;
        const subData = subSnap.docs[0].data() || {};
        transaction.set(subRef, {
          assignedMatchmakerUid: newMatchmakerUid,
          reassignmentHistory: [...(Array.isArray(subData.reassignmentHistory) ? subData.reassignmentHistory : []), {
            fromMatchmakerUid: oldMatchmakerUid,
            toMatchmakerUid: newMatchmakerUid,
            byAdminUid: adminUser.uid,
            reason,
            at: nowIso(),
          }],
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return { oldMatchmakerUid, newMatchmakerUid, newMatchmakerName };
    });
    await logActivity({
      memberUid,
      actor: { type: "admin", uid: adminUser.uid, name: "Admin" },
      eventType: ACTIVITY_EVENT_TYPES.MATCHMAKER_REASSIGNED,
      details: result,
      visibility: { member: true, matchmaker: true, admin: true },
    });
    sendJson(req, res, 200, { ok: true, ...result });
  } catch (error) {
    logger.error("adminReassignMatchmaker failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to reassign matchmaker." });
  }
});

exports.getMatchmakerStats = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const user = await verifyMatchmakerUser(req);
    const scope = isAdminMemberRole(user.member.role) && String(req.body?.scope || req.query?.scope || "").trim().toLowerCase() === "global"
      ? "global"
      : "mine";
    const [subsSnap, suggestions] = await Promise.all([
      scope === "global"
        ? db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION).limit(500).get()
        : db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION).where("assignedMatchmakerUid", "==", user.uid).limit(500).get(),
      scope === "global" ? db.collection(MATCH_SUGGESTIONS_COLLECTION).limit(500).get() : db.collection(MATCH_SUGGESTIONS_COLLECTION).where("createdBy", "==", user.uid).limit(500).get(),
    ]);
    const subscriptions = subsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const suggestionRows = suggestions.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const byStatus = {};
    suggestionRows.forEach((row) => {
      const status = String(row.status || "pending").trim().toLowerCase();
      byStatus[status] = (byStatus[status] || 0) + 1;
    });
    const activeSubs = subscriptions.filter((item) => String(item.status || "").toLowerCase() === "active");
    sendJson(req, res, 200, {
      ok: true,
      scope,
      activeSubscriptions: activeSubs.length,
      expiredSubscriptions: subscriptions.filter((item) => String(item.status || "").toLowerCase() === "expired").length,
      suggestionsCreated: suggestionRows.length,
      statusBreakdown: byStatus,
      mutualInterest: byStatus[SUGGESTION_STATUS_FLOW.MUTUAL_INTEREST] || 0,
      engaged: byStatus[SUGGESTION_STATUS_FLOW.ENGAGED] || 0,
      closed: byStatus[SUGGESTION_STATUS_FLOW.CLOSED] || 0,
      myMembers: scope === "global" ? undefined : activeSubs.length,
    });
  } catch (error) {
    logger.error("getMatchmakerStats failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load matchmaker stats." });
  }
});

exports.recordAnalyticsEvent = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const authUser = await verifyAuthenticatedUser(req);
    const eventType = String(req.body?.eventType || "").trim();
    if (!eventType) throw matchmakerError(400, "eventType is required.");
    const sinceMs = Date.now() - 60000;
    const snap = await db.collection(ANALYTICS_EVENTS_COLLECTION)
      .where("memberUid", "==", authUser.uid)
      .where("eventType", "==", eventType)
      .limit(20)
      .get()
      .catch(() => ({ docs: [] }));
    const recent = snap.docs.find((doc) => parseTimestampMs(doc.data()?.createdAt) >= sinceMs);
    if (recent) {
      sendJson(req, res, 200, { ok: true, throttled: true, eventId: recent.id });
      return;
    }
    const eventId = `ae_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.collection(ANALYTICS_EVENTS_COLLECTION).doc(eventId).set({
      eventId,
      memberUid: authUser.uid,
      eventType,
      details: req.body?.details || {},
      source: String(req.body?.source || "").trim(),
      createdAt: FieldValue.serverTimestamp(),
    });
    sendJson(req, res, 200, { ok: true, eventId });
  } catch (error) {
    logger.error("recordAnalyticsEvent failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to record analytics event." });
  }
});

exports.adminSaveMatchmakerSettings = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { sendJson(req, res, 405, { message: "Method not allowed." }); return; }
  try {
    const adminUser = await verifyAdminUser(req);
    const batch = db.batch();
    if (req.body?.pricing !== undefined) {
      batch.set(db.collection(APP_STATE_COLLECTION).doc(MATCHMAKER_PRICING_KEY), {
        value: normalizeMatchmakerPricing(req.body.pricing),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid,
      }, { merge: true });
    }
    if (req.body?.settings !== undefined) {
      batch.set(db.collection(APP_STATE_COLLECTION).doc(MATCHMAKER_SETTINGS_KEY), {
        value: normalizeMatchmakerSettings(req.body.settings),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid,
      }, { merge: true });
    }
    if (req.body?.proof !== undefined) {
      batch.set(db.collection(APP_STATE_COLLECTION).doc(MATCHMAKER_PROOF_KEY), {
        value: normalizeMatchmakerProof(req.body.proof),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid,
      }, { merge: true });
    }
    if (req.body?.prompts !== undefined) {
      batch.set(db.collection(APP_STATE_COLLECTION).doc(MATCHMAKER_PROMPTS_KEY), {
        value: sanitizePromptList(req.body.prompts),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid,
      }, { merge: true });
    }
    await batch.commit();
    await ensureMatchmakerDefaults();
    sendJson(req, res, 200, { ok: true });
  } catch (error) {
    logger.error("adminSaveMatchmakerSettings failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to save matchmaker settings." });
  }
});

exports.adminGetSystemPulse = onRequest({ region: "us-central1" }, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    await verifyAdminUser(req);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [subsSnap, suggestionSnap, complaintSnap] = await Promise.all([
      db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION).limit(500).get().catch(() => ({ docs: [] })),
      db.collection(MATCH_SUGGESTIONS_COLLECTION).limit(500).get().catch(() => ({ docs: [] })),
      db.collection(COMPLAINTS_COLLECTION).limit(200).get().catch(() => ({ docs: [] })),
    ]);
    const subscriptions = subsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const suggestions = suggestionSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const activeSubscriptions = subscriptions.filter((item) => String(item.status || "").toLowerCase() === "active");
    const mrr = activeSubscriptions.reduce((sum, item) => {
      const days = Math.max(1, Math.round(Number(item.durationDays || 30) || 30));
      return sum + roundMoney((Number(item.price || 0) / days) * 30);
    }, 0);
    const suggestionsToday = suggestions.filter((item) => parseTimestampMs(item.createdAt) >= todayStart.getTime()).length;
    const mutual = suggestions.filter((item) => String(item.status || "").toLowerCase() === SUGGESTION_STATUS_FLOW.MUTUAL_INTEREST).length;
    const engaged = suggestions.filter((item) => String(item.status || "").toLowerCase() === SUGGESTION_STATUS_FLOW.ENGAGED).length;
    sendJson(req, res, 200, {
      ok: true,
      activeMembers: activeSubscriptions.length,
      mrr: roundMoney(mrr),
      suggestionsToday,
      mutual,
      engaged,
      complaints: complaintSnap.docs.length,
    });
  } catch (error) {
    logger.error("adminGetSystemPulse failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to load system pulse." });
  }
});

exports.expireOldSuggestions = onSchedule({
  schedule: "0 3 * * *",
  timeZone: "Asia/Kolkata",
  region: "us-central1",
}, async () => {
  const settings = await readMatchmakerSettings();
  if (settings.autoCloseExpired === false) return;
  const now = new Date();
  const snap = await db.collection(MATCH_SUGGESTIONS_COLLECTION)
    .where("expiresAt", "<=", now)
    .limit(500)
    .get()
    .catch(() => ({ docs: [] }));
  const writes = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (isClosedSuggestionStatus(data.status)) continue;
    writes.push(doc.ref.set({
      status: SUGGESTION_STATUS_FLOW.CLOSED,
      closedAt: FieldValue.serverTimestamp(),
      closeReason: "expired",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    writes.push(logActivity({
      memberUid: String(data.forMemberAUid || ""),
      actor: { type: "system", uid: "system", name: "Parichayam" },
      eventType: ACTIVITY_EVENT_TYPES.SYSTEM_SUGGESTION_EXPIRED,
      details: { suggestionId: doc.id },
      relatedDocs: [{ collection: MATCH_SUGGESTIONS_COLLECTION, id: doc.id }],
      visibility: { member: true, matchmaker: true, admin: true },
    }));
    writes.push(logActivity({
      memberUid: String(data.forMemberBUid || ""),
      actor: { type: "system", uid: "system", name: "Parichayam" },
      eventType: ACTIVITY_EVENT_TYPES.SYSTEM_SUGGESTION_EXPIRED,
      details: { suggestionId: doc.id },
      relatedDocs: [{ collection: MATCH_SUGGESTIONS_COLLECTION, id: doc.id }],
      visibility: { member: true, matchmaker: true, admin: true },
    }));
  }
  await Promise.all(writes);
});

exports.expireMatchmakerSubscriptions = onSchedule({
  schedule: "0 4 * * *",
  timeZone: "Asia/Kolkata",
  region: "us-central1",
}, async () => {
  const now = new Date();
  const snap = await db.collection(MATCHMAKER_SUBSCRIPTIONS_COLLECTION)
    .where("status", "==", "active")
    .where("endDate", "<=", now)
    .limit(500)
    .get()
    .catch(() => ({ docs: [] }));
  const writes = [];
  for (const doc of snap.docs) {
    const sub = doc.data() || {};
    writes.push(doc.ref.set({
      status: "expired",
      expiredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    writes.push(db.collection(MEMBERS_COLLECTION).doc(String(sub.memberUid || "")).set({
      matchmakerActive: false,
      matchmakerSubscriptionId: "",
      matchmakerPlan: "",
      matchmakerEndDate: "",
      assignedMatchmakerUid: "",
      assignedMatchmakerName: "",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    writes.push(logActivity({
      memberUid: String(sub.memberUid || ""),
      actor: { type: "system", uid: "system", name: "Parichayam" },
      eventType: ACTIVITY_EVENT_TYPES.SYSTEM_SUBSCRIPTION_EXPIRED,
      details: { subscriptionId: doc.id },
      relatedDocs: [{ collection: MATCHMAKER_SUBSCRIPTIONS_COLLECTION, id: doc.id }],
    }));
  }
  await Promise.all(writes);
});
