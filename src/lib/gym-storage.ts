import {
  affiliateProducts,
  memberData,
  seedProfile,
  templatePlans,
  type GymProfile,
  type Member,
  type Payment,
  type Product,
  type Recommendation,
  type TemplatePlan,
} from "@/lib/gym-data";

const STATE_KEY = "gym-manager:state:v4";
const LEGACY_V3_KEY = "gym-manager:state:v3";
const LEGACY_STATE_KEY = "gym-manager:state:v2";
const LEGACY_MEMBERS_KEY = "gym-manager:members:v1";
const LAST_BACKUP_KEY = "gym-manager:last-backup";

/** Bumped with the persisted shape, so a restore knows what it is holding. */
export const BACKUP_VERSION = 4;

export type PersistedState = {
  profile: GymProfile;
  members: Member[];
  payments: Payment[];
  plans: TemplatePlan[];
  products: Product[];
  recommendations: Recommendation[];
};

/**
 * What a brand new install starts as: the owner's own empty gym.
 *
 * The demo roster is NOT the default. Shipping it as the default would hand a
 * real owner fourteen invented members called Arjun and Riya and make them
 * delete strangers before they could begin.
 */
export const emptyState: PersistedState = {
  profile: { ...seedProfile, gym_name: "" },
  members: [],
  payments: [],
  plans: templatePlans,
  products: [],
  recommendations: [],
};

/** The demo gym, loaded only when the owner explicitly asks for sample data. */
export const seedState: PersistedState = {
  profile: seedProfile,
  members: memberData,
  payments: [],
  plans: templatePlans,
  products: affiliateProducts,
  recommendations: [],
};

function isPlan(value: unknown): value is TemplatePlan {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.content === "string" &&
    (record.type === "workout" || record.type === "nutrition")
  );
}

function isMember(value: unknown): value is Member {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const planRef = (field: unknown) => field === null || typeof field === "string";
  const optionalNumber = (field: unknown) => field === null || Number.isFinite(field);

  return (
    typeof record.id === "string" &&
    typeof record.full_name === "string" &&
    typeof record.phone === "string" &&
    typeof record.address === "string" &&
    typeof record.joined_date === "string" &&
    typeof record.valid_until === "string" &&
    typeof record.is_active === "boolean" &&
    planRef(record.workout_plan_id) &&
    planRef(record.nutrition_plan_id) &&
    optionalNumber(record.current_weight) &&
    optionalNumber(record.target_weight) &&
    Number.isFinite(record.monthly_fee)
  );
}

function isPayment(value: unknown): value is Payment {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.member_id === "string" &&
    typeof record.payment_date === "string" &&
    typeof record.valid_until === "string" &&
    typeof record.previous_valid_until === "string" &&
    Number.isFinite(record.amount)
  );
}

function isProduct(value: unknown): value is Product {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.category === "string" &&
    typeof record.product_url === "string" &&
    typeof record.is_active === "boolean" &&
    Number.isFinite(record.price) &&
    Number.isFinite(record.commission_rate)
  );
}

function isRecommendation(value: unknown): value is Recommendation {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.member_id === "string" &&
    typeof record.product_id === "string" &&
    typeof record.sent_at === "string"
  );
}

/** Tolerant: any missing field falls back, so a partial profile never blanks the app. */
function readProfile(value: unknown): GymProfile {
  if (typeof value !== "object" || value === null) return seedProfile;
  const record = value as Record<string, unknown>;
  const text = (field: unknown, fallback: string) =>
    typeof field === "string" ? field : fallback;

  return {
    gym_name: text(record.gym_name, seedProfile.gym_name),
    owner_name: text(record.owner_name, ""),
    phone: text(record.phone, ""),
    email: text(record.email, ""),
    upi_id: text(record.upi_id, ""),
  };
}

function readJSON(key: string): unknown {
  const raw = window.localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

/** v1 kept the plan's title on the member; re-points those onto plan ids. */
function fromV1(): PersistedState | null {
  const parsed = readJSON(LEGACY_MEMBERS_KEY);
  if (!Array.isArray(parsed)) return null;

  const idByTitle = new Map(templatePlans.map((plan) => [plan.title.trim().toLowerCase(), plan.id]));

  const members = parsed.flatMap((entry): Member[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;

    const resolve = (title: unknown) =>
      typeof title === "string" ? idByTitle.get(title.trim().toLowerCase()) ?? null : null;

    const candidate = {
      ...record,
      workout_plan_id: resolve(record.workout_plan),
      nutrition_plan_id: resolve(record.nutrition_plan),
    };

    return isMember(candidate) ? [candidate] : [];
  });

  return members.length > 0
    ? {
        profile: seedProfile,
        members,
        payments: [],
        plans: templatePlans,
        products: affiliateProducts,
        recommendations: [],
      }
    : null;
}

/** v2 had members and plans but no affiliate catalog; seed one in. */
function fromV2(): PersistedState | null {
  const parsed = readJSON(LEGACY_STATE_KEY);
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const members = Array.isArray(record.members) ? record.members.filter(isMember) : [];
  if (members.length === 0) return null;

  return {
    profile: seedProfile,
    members,
    payments: [],
    plans: Array.isArray(record.plans) ? record.plans.filter(isPlan) : [],
    products: affiliateProducts,
    recommendations: [],
  };
}

/** v3 had no gym profile; everything else carries over untouched. */
function fromVersioned(key: string): PersistedState | null {
  const parsed = readJSON(key);
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const members = Array.isArray(record.members) ? record.members.filter(isMember) : [];

  // Plans and products can legitimately be emptied by the owner; members cannot,
  // or the app looks wiped and we are better off falling back to the seed.
  if (members.length === 0) return null;

  return {
    profile: readProfile(record.profile),
    members,
    payments: Array.isArray(record.payments) ? record.payments.filter(isPayment) : [],
    plans: Array.isArray(record.plans) ? record.plans.filter(isPlan) : [],
    products: Array.isArray(record.products) ? record.products.filter(isProduct) : [],
    recommendations: Array.isArray(record.recommendations)
      ? record.recommendations.filter(isRecommendation)
      : [],
  };
}

/**
 * Null whenever nothing usable is stored. Guarded end to end: storage throws
 * outright in some private-browsing modes, and a half-written entry must not be
 * able to take the app down on load.
 */
export function loadState(): PersistedState | null {
  try {
    return fromVersioned(STATE_KEY) ?? fromVersioned(LEGACY_V3_KEY) ?? fromV2() ?? fromV1();
  } catch {
    return null;
  }
}

/** Best effort: a full quota must not break a renewal or a plan edit. */
export function saveState(state: PersistedState): void {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignored on purpose; in-memory state stays correct for this session.
  }
}

export type Backup = {
  app: "gym-manager";
  version: number;
  exported_at: string;
  state: PersistedState;
};

export function buildBackup(state: PersistedState): Backup {
  return {
    app: "gym-manager",
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    state,
  };
}

export type BackupSummary = {
  state: PersistedState;
  exported_at: string | null;
  version: number;
};

/**
 * Accepts a backup envelope or a bare state object, from this version or an
 * older one. Returns null rather than throwing: a restore is driven by a file
 * the owner picked, which may be anything at all.
 *
 * Members are required because a file with none would silently wipe the gym.
 */
export function parseBackup(text: string): BackupSummary | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;

    const envelope = parsed as Record<string, unknown>;
    const isEnvelope = typeof envelope.state === "object" && envelope.state !== null;

    const body = (isEnvelope ? envelope.state : envelope) as Record<string, unknown>;
    const version = Number.isFinite(envelope.version) ? Number(envelope.version) : BACKUP_VERSION;

    const members = Array.isArray(body.members) ? body.members.filter(isMember) : [];
    if (members.length === 0) return null;

    return {
      version,
      exported_at: typeof envelope.exported_at === "string" ? envelope.exported_at : null,
      state: {
        profile: readProfile(body.profile),
        members,
        payments: Array.isArray(body.payments) ? body.payments.filter(isPayment) : [],
        plans: Array.isArray(body.plans) ? body.plans.filter(isPlan) : [],
        // A v2 backup predates the catalog; seed it rather than leaving it empty.
        products: Array.isArray(body.products)
          ? body.products.filter(isProduct)
          : affiliateProducts,
        recommendations: Array.isArray(body.recommendations)
          ? body.recommendations.filter(isRecommendation)
          : [],
      },
    };
  } catch {
    return null;
  }
}

export function loadLastBackupAt(): string | null {
  try {
    return window.localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

export function saveLastBackupAt(iso: string): void {
  try {
    window.localStorage.setItem(LAST_BACKUP_KEY, iso);
  } catch {
    // Ignored on purpose; failing to note the date must not fail the backup.
  }
}
