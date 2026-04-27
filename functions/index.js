const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
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
  return String(process.env.RAZORPAY_KEY_ID || "").trim();
}

function razorpayKeySecret() {
  return String(process.env.RAZORPAY_KEY_SECRET || "").trim();
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
      return { id: agentSnap.id, data: agentSnap.data() || {}, referralCode: String(agentSnap.data()?.referralCode || "") };
    }
  }

  const referralCode = normalizeAgentRefId(memberData?.referredByAgentRefId || memberData?.agentRefId || "");
  if (!referralCode) return { id: "", data: null, referralCode: "" };

  const query = db.collection(AGENTS_COLLECTION).where("referralCode", "==", referralCode).limit(1);
  const snap = transaction ? await transaction.get(query) : await query.get();
  if (snap.empty) return { id: "", data: null, referralCode };
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() || {}, referralCode };
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
  const agentCommissionRate = agentId ? REFERRED_AGENT_COMMISSION_RATE : 0;
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
  } : null;

  return { membershipEventId, membershipEvent, commissionEventId, commissionEvent };
}

async function createRazorpayRefund(paymentId, amountInRupees, notes) {
  if (isFunctionsEmulatorRuntime()) {
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
  try {
    const authUser = await verifyAuthenticatedUser(req);
    await enforceAuthRateLimit("verifyPaymentAndActivateMembership:uid", authUser.uid, 40, 60 * 60 * 1000, "Too many verification attempts. Please try again later.");
    if (!isRazorpayConfigured()) {
      sendJson(req, res, 503, { message: "Payment verification is not configured yet." });
      return;
    }
    const orderId = String(req.body?.razorpay_order_id || req.body?.orderId || "").trim();
    const paymentId = String(req.body?.razorpay_payment_id || req.body?.paymentId || "").trim();
    const signature = String(req.body?.razorpay_signature || req.body?.signature || "").trim();
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
    logger.error("verifyPaymentAndActivateMembership failed", error);
    sendJson(req, res, error.status || 500, { message: error.message || "Unable to verify payment right now." });
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
const DEFAULT_AGENT_COMMISSION_PERCENT = 25;
const AGENT_MIN_PAYOUT = 500;
const LEGACY_COMMISSION_PERCENT_BY_TIER = { starter: 20, standard: 25, premium: 30, custom: 25 };

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

    const nowMs = Date.now();
    const snap = await db.collection(REVENUE_EVENTS_COLLECTION)
      .where("agentId", "==", requestedAgentId)
      .where("eventType", "==", "agent_commission")
      .where("status", "==", "recorded")
      .get();

    let lockedAmount = 0;
    let unlockedAmount = 0;
    snap.forEach((doc) => {
      const event = doc.data() || {};
      const commissionAmount = Math.max(0, roundMoney(event.agentCommissionAmount || event.amount || 0));
      const lockExpiresMs = parseTimestampMs(event.lockExpiresAt);
      if (lockExpiresMs > nowMs) lockedAmount += commissionAmount;
      else unlockedAmount += commissionAmount;
    });

    sendJson(req, res, 200, {
      ok: true,
      agentId: requestedAgentId,
      totalUnpaidCommissions: roundMoney(lockedAmount + unlockedAmount),
      lockedAmount: roundMoney(lockedAmount),
      unlockedAmount: roundMoney(unlockedAmount),
      eventCount: snap.size,
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
    const commissionPercent = clampCommissionPercent(
      req.body?.commissionPercent !== undefined ? req.body?.commissionPercent : DEFAULT_AGENT_COMMISSION_PERCENT
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
      .where("eventType", "==", "membership_paid")
      .limit(1)
      .get();
    if (originalSnap.empty) { sendJson(req, res, 404, { message: "Original membership revenue event not found." }); return; }
    const originalDoc = originalSnap.docs[0];
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
      if (!isFunctionsEmulatorRuntime()) throw refundError;
      refundAttemptError = refundError?.message || String(refundError || "Unknown Razorpay emulator error");
      logger.warn("processRefund: Razorpay refund failed in emulator; recording ledger fallback.", {
        orderId,
        paymentId,
        refundAttemptError,
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
        const err = new Error("Original membership revenue event not found.");
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
      agent: { ...agent, ...balance },
      kpi: {
        totalLeads: enrichedLeads.length,
        converted,
        conversionRate,
        thisMonthEarnings: balance.totalEarned, // simplified for now
        availableBalance: balance.availableBalance,
        pendingPayoutAmount: balance.pendingPayoutAmount,
      },
      stageCounts,
      followUps: followUps.slice(0, 10),
      recentActivity: activity,
      payoutHistory: payoutHistory.slice(0, 10),
      minimumPayoutAmount: AGENT_MIN_PAYOUT,
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
    if (balance.availableBalance < AGENT_MIN_PAYOUT) {
      sendJson(req, res, 400, { message: "Minimum payout is Rs " + AGENT_MIN_PAYOUT + ". Your available balance is Rs " + balance.availableBalance + "." });
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
    const commissionPercent = clampCommissionPercent(
      req.body?.commissionPercent !== undefined ? req.body?.commissionPercent : DEFAULT_AGENT_COMMISSION_PERCENT
    );
    const agentDoc = {
      name: appData.name || "", mobile, email, city: appData.city || "", area: "", state: appData.state || "",
      status: "active",
      referralCode,
      commissionType: "percent",
      commissionPercent,
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
            creditedSnapshot = computeCommissionSnapshot(agentDoc.data() || {}, trustedPaidAmount);
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
        const commissionSnapshot = computeCommissionSnapshot(agentDoc.data() || {}, trustedPaidAmount);
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
