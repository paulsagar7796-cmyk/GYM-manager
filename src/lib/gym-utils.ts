import type {
  GymProfile,
  Member,
  MemberStatus,
  Payment,
  PlanType,
  Product,
  TemplatePlan,
} from "@/lib/gym-data";

const MS_PER_DAY = 86_400_000;
const DUE_SOON_DAYS = 3;
const RENEWAL_DAYS = 30;
const DEFAULT_COUNTRY_CODE = "91";

// Intl constructors are expensive, so build each formatter once instead of on
// every render of every member card.
const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const monthFormatter = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
});

const dueDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const shortMonthFormatter = new Intl.DateTimeFormat("en-IN", { month: "short" });

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Reads a `YYYY-MM-DD` string as local midnight. `new Date(iso)` parses it as
 * UTC midnight instead, which lands on the previous calendar day for anyone
 * west of Greenwich and shifts every due-date comparison by a day.
 */
export function parseISODate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  // Rejects impossible dates like 2026-02-31, which Date silently rolls over.
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    return null;
  }

  return date;
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Whole calendar days from `today` until `iso`; negative once it has passed. */
export function daysUntil(iso: string, today: Date): number | null {
  const due = parseISODate(iso);
  if (!due) return null;

  // Rounded because a DST changeover makes a calendar day 23 or 25 hours long.
  return Math.round((due.getTime() - startOfDay(today).getTime()) / MS_PER_DAY);
}

export function getMemberStatus(validUntil: string, today: Date): MemberStatus {
  const days = daysUntil(validUntil, today);

  // An unreadable date is surfaced as overdue so it gets looked at, rather than
  // quietly passing as a paid-up membership.
  if (days === null || days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due-soon";
  return "active";
}

export function getMemberStatusMeta(status: MemberStatus) {
  switch (status) {
    case "active":
      return { label: "Active", color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" };
    case "due-soon":
      return { label: "Due Soon", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
    case "overdue":
      return { label: "Overdue", color: "bg-rose-500/15 text-rose-600 border-rose-500/30" };
  }
}

export function getCurrentMonthLabel(today: Date): string {
  return monthFormatter.format(today);
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatDueDate(iso: string): string {
  const date = parseISODate(iso);
  return date ? dueDateFormatter.format(date) : iso;
}

/**
 * Extends the membership by a month from whichever is later: the date it runs
 * out, or today. Always adding to `valid_until` would leave a member who lapsed
 * two months ago still expired right after you took their money.
 */
/** For timestamps, which unlike due dates carry a time of day. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormatter.format(date);
}

export function renewMember(member: Member, today: Date): Member {
  const start = startOfDay(today);
  const current = parseISODate(member.valid_until);
  const base = current && current.getTime() > start.getTime() ? current : start;

  return {
    ...member,
    valid_until: toISODate(addDays(base, RENEWAL_DAYS)),
    is_active: true,
  };
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Money actually collected this calendar month, from the payment record.
 *
 * This replaces the old estimate, which summed the fees of everyone currently
 * paid up. That answered "what is this roster worth" and called it income: it
 * counted a member who paid in March every month afterwards, and missed a
 * member who paid twice.
 */
export function getMonthIncome(payments: Payment[], today: Date): number {
  const key = monthKey(toISODate(today));
  return payments.reduce(
    (sum, payment) => (monthKey(payment.payment_date) === key ? sum + payment.amount : sum),
    0,
  );
}

/** Rolling totals, newest month last, for the income chart. */
export function getMonthlyIncomeSeries(
  payments: Payment[],
  today: Date,
  months = 6,
): { key: string; label: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    const key = monthKey(payment.payment_date);
    totals.set(key, (totals.get(key) ?? 0) + payment.amount);
  }

  const series: { key: string; label: string; total: number }[] = [];
  const cursor = startOfDay(today);
  cursor.setDate(1);

  for (let i = months - 1; i >= 0; i -= 1) {
    const month = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const key = monthKey(toISODate(month));
    series.push({
      key,
      label: shortMonthFormatter.format(month),
      total: totals.get(key) ?? 0,
    });
  }

  return series;
}

export function paymentsForMember(payments: Payment[], memberId: string): Payment[] {
  return payments
    .filter((payment) => payment.member_id === memberId)
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
}

export function lastPayment(payments: Payment[], memberId: string): Payment | null {
  return paymentsForMember(payments, memberId)[0] ?? null;
}

/** Builds the payment row a renewal represents, alongside the updated member. */
export function buildRenewal(
  member: Member,
  today: Date,
  mode: Payment["payment_mode"] = "cash",
): { member: Member; payment: Payment } {
  const renewed = renewMember(member, today);

  return {
    member: renewed,
    payment: {
      id: createId("pay"),
      member_id: member.id,
      amount: member.monthly_fee,
      payment_date: toISODate(startOfDay(today)),
      valid_from: member.valid_until,
      valid_until: renewed.valid_until,
      previous_valid_until: member.valid_until,
      payment_mode: mode,
    },
  };
}

export function getMemberCounts(statuses: MemberStatus[]) {
  const counts = { total: statuses.length, active: 0, dueSoon: 0, overdue: 0 };

  for (const status of statuses) {
    if (status === "active") counts.active += 1;
    else if (status === "due-soon") counts.dueSoon += 1;
    else counts.overdue += 1;
  }

  return counts;
}

/**
 * Normalises to the digits wa.me expects. A bare 10-digit Indian number has no
 * country code, and wa.me silently fails on links that are missing one.
 */
export function sanitizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length === 10 ? `${DEFAULT_COUNTRY_CODE}${digits}` : digits;
}

/** Null when the number is too short to dial, so callers can disable the link. */
export function buildWhatsAppLink(phone: string, message: string): string | null {
  const cleaned = sanitizePhone(phone);
  if (cleaned.length < 10) return null;

  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

/**
 * Payment details come from the owner's own profile. If no UPI id is set the
 * line is left out entirely rather than printing a placeholder, which would
 * point members at an account that is not the gym's.
 */
export function buildReminderMessage(member: Member, profile: GymProfile): string {
  const gym = profile.gym_name.trim() || "gym";

  const parts = [
    `Hello ${member.full_name}, a friendly reminder that your ${gym} membership is due on ${formatDueDate(member.valid_until)}.`,
    `Fee: ${formatCurrency(member.monthly_fee)}.`,
    "Please renew to continue training.",
  ];

  if (profile.upi_id.trim()) parts.push(`UPI ID: ${profile.upi_id.trim()}`);

  return parts.join(" ");
}

/** True when reminders would go out with no way for the member to pay. */
export function isPayableProfile(profile: GymProfile): boolean {
  return profile.upi_id.trim().length > 0;
}

export type ProfileInput = GymProfile;

export function validateProfile(input: GymProfile): Partial<Record<keyof GymProfile, string>> {
  const errors: Partial<Record<keyof GymProfile, string>> = {};

  if (!input.gym_name.trim()) errors.gym_name = "Members see this name, so it is required";
  if (input.phone.trim() && sanitizePhone(input.phone).length < 10) {
    errors.phone = "Enter a valid phone number";
  }
  if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = "Enter a valid email";
  }
  // A UPI id is name@handle. Getting this wrong means payments bounce.
  if (input.upi_id.trim() && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(input.upi_id.trim())) {
    errors.upi_id = "Looks like name@bank, e.g. ironhouse@okhdfcbank";
  }

  return errors;
}

export function normalizeProfile(input: GymProfile): GymProfile {
  return {
    gym_name: input.gym_name.trim(),
    owner_name: input.owner_name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    upi_id: input.upi_id.trim(),
  };
}

export type PlanIndex = Map<string, TemplatePlan>;

export function indexPlans(plans: TemplatePlan[]): PlanIndex {
  return new Map(plans.map((plan) => [plan.id, plan]));
}

export function getPlan(plans: PlanIndex, planId: string | null): TemplatePlan | null {
  return planId ? plans.get(planId) ?? null : null;
}

export function plansOfType(plans: TemplatePlan[], type: PlanType): TemplatePlan[] {
  return plans
    .filter((plan) => plan.type === type)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function hasAssignedPlan(member: Member): boolean {
  return member.workout_plan_id !== null || member.nutrition_plan_id !== null;
}

/** Sends the member's own assigned plans, not one hard-coded body for everyone. */
export function buildPlanMessage(
  member: Member,
  workout: TemplatePlan | null,
  nutrition: TemplatePlan | null,
  profile: GymProfile,
): string {
  const gym = profile.gym_name.trim();
  const lines = [
    gym
      ? `Hi ${member.full_name}, here is your current plan from ${gym}.`
      : `Hi ${member.full_name}, here is your current plan.`,
  ];

  if (workout) lines.push("", `*Workout - ${workout.title}*`, workout.content);
  if (nutrition) lines.push("", `*Nutrition - ${nutrition.title}*`, nutrition.content);

  // Only claim a goal when one is actually on file.
  if (member.current_weight !== null && member.target_weight !== null) {
    lines.push("", `Goal: ${member.current_weight} kg -> ${member.target_weight} kg. Keep going!`);
  } else {
    lines.push("", "Keep going!");
  }

  return lines.join("\n");
}

export type MemberFormInput = {
  full_name: string;
  phone: string;
  address: string;
  current_weight: string;
  target_weight: string;
  monthly_fee: string;
  valid_until: string;
};

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyMemberForm(today: Date): MemberFormInput {
  return {
    full_name: "",
    phone: "",
    address: "",
    current_weight: "",
    target_weight: "",
    monthly_fee: "",
    valid_until: toISODate(addDays(today, RENEWAL_DAYS)),
  };
}

export function memberToForm(member: Member): MemberFormInput {
  return {
    full_name: member.full_name,
    phone: member.phone,
    address: member.address,
    current_weight: member.current_weight === null ? "" : String(member.current_weight),
    target_weight: member.target_weight === null ? "" : String(member.target_weight),
    monthly_fee: String(member.monthly_fee),
    valid_until: member.valid_until,
  };
}

export function validateMemberForm(
  input: MemberFormInput,
  existing: Member[] = [],
  editingId: string | null = null,
): Partial<Record<keyof MemberFormInput, string>> {
  const errors: Partial<Record<keyof MemberFormInput, string>> = {};

  if (!input.full_name.trim()) errors.full_name = "Name is required";

  // Optional, because an imported member may genuinely have no number on file.
  // Anything typed in, though, has to be dialable.
  const typed = sanitizePhone(input.phone);
  if (input.phone.trim() && typed.length < 10) {
    errors.phone = "Enter a valid phone number";
  } else if (typed.length >= 10) {
    // Import already refuses duplicates; adding by hand has to match, or the
    // same person ends up on the list twice with divergent renewal dates.
    const clash = existing.find(
      (member) => member.id !== editingId && sanitizePhone(member.phone) === typed,
    );
    if (clash) errors.phone = `${clash.full_name} already has this number`;
  }

  const fee = Number(input.monthly_fee);
  if (!input.monthly_fee.trim() || !Number.isFinite(fee) || fee < 0) {
    errors.monthly_fee = "Enter the monthly fee";
  }

  // Weights stay blank-able: a paper register rarely records them.
  for (const field of ["current_weight", "target_weight"] as const) {
    if (!input[field].trim()) continue;
    const value = Number(input[field]);
    if (!Number.isFinite(value) || value <= 0) errors[field] = "Enter a number above 0";
  }

  if (!parseISODate(input.valid_until)) errors.valid_until = "Pick the date the membership ends";

  return errors;
}

const optionalNumber = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Builds a member from the form. With `base`, it edits in place: the id,
 * join date and plan assignments are carried over so an edit never detaches a
 * member from their plans or silently re-dates their membership.
 */
export function memberFromForm(
  input: MemberFormInput,
  today: Date,
  base?: Member,
): Member {
  return {
    id: base?.id ?? createId("m"),
    full_name: input.full_name.trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
    joined_date: base?.joined_date ?? toISODate(today),
    current_weight: optionalNumber(input.current_weight),
    target_weight: optionalNumber(input.target_weight),
    monthly_fee: Number(input.monthly_fee),
    is_active: base?.is_active ?? true,
    valid_until: input.valid_until,
    workout_plan_id: base?.workout_plan_id ?? null,
    nutrition_plan_id: base?.nutrition_plan_id ?? null,
  };
}

export type PlanInput = {
  title: string;
  type: PlanType;
  content: string;
};

export function validatePlan(
  input: PlanInput,
  existing: TemplatePlan[],
  editingId: string | null,
): Partial<Record<keyof PlanInput, string>> {
  const errors: Partial<Record<keyof PlanInput, string>> = {};
  const title = input.title.trim();

  if (!title) {
    errors.title = "Give the plan a name";
  } else if (
    existing.some(
      (plan) =>
        plan.id !== editingId &&
        plan.type === input.type &&
        plan.title.trim().toLowerCase() === title.toLowerCase(),
    )
  ) {
    // Duplicate names make the dropdown ambiguous for the owner.
    errors.title = "A plan of this type already uses that name";
  }

  if (!input.content.trim()) errors.content = "Add the plan details to send";

  return errors;
}

/** Reuses `editingId` so an edit updates in place and keeps every assignment. */
export function createPlan(input: PlanInput, editingId: string | null): TemplatePlan {
  return {
    id: editingId ?? createId("tpl"),
    title: input.title.trim(),
    type: input.type,
    content: input.content.trim(),
  };
}

export type ProductInput = {
  title: string;
  category: string;
  price: string;
  commission_rate: string;
  product_url: string;
};

/** What the owner keeps on one sale. Owner-facing only. */
export function commissionPerSale(product: Product): number {
  return Math.round((product.price * product.commission_rate) / 100);
}

export function totalCommissionPotential(products: Product[]): number {
  return products
    .filter((product) => product.is_active)
    .reduce((sum, product) => sum + commissionPerSale(product), 0);
}

/**
 * Tags the outgoing link so clicks can be attributed later, per the
 * `affiliate_clicks` table. Deliberately carries no member identifier: that
 * would hand the merchant a way to single out one of the gym's members.
 */
export function buildProductLink(product: Product): string {
  try {
    const url = new URL(product.product_url);
    url.searchParams.set("utm_source", "gym-manager");
    url.searchParams.set("utm_medium", "whatsapp");
    url.searchParams.set("utm_campaign", product.id);
    return url.toString();
  } catch {
    // A link the owner typed by hand may not parse; send it through untouched
    // rather than dropping the recommendation entirely.
    return product.product_url;
  }
}

/**
 * Member-facing copy. CLAUDE.md requires commission details stay hidden from
 * members, so neither the rate nor the owner's cut appears here.
 */
export function buildRecommendationMessage(
  member: Member,
  product: Product,
  profile: GymProfile,
): string {
  const gym = profile.gym_name.trim();
  const opener =
    member.target_weight !== null
      ? `Hi ${member.full_name}, this one should help with your goal of ${member.target_weight} kg.`
      : `Hi ${member.full_name}, this one should help with your training.`;

  return [
    opener,
    "",
    `*${product.title}*`,
    `${product.category} - ${formatCurrency(product.price)}`,
    "",
    buildProductLink(product),
    ...(gym ? ["", `- ${gym}`] : []),
  ].join("\n");
}

export function validateProduct(input: ProductInput): Partial<Record<keyof ProductInput, string>> {
  const errors: Partial<Record<keyof ProductInput, string>> = {};

  if (!input.title.trim()) errors.title = "Product name is required";
  if (!input.category.trim()) errors.category = "Category is required";

  const price = Number(input.price);
  if (!input.price.trim() || !Number.isFinite(price) || price <= 0) {
    errors.price = "Enter a price above 0";
  }

  const rate = Number(input.commission_rate);
  if (!input.commission_rate.trim() || !Number.isFinite(rate) || rate <= 0 || rate > 100) {
    errors.commission_rate = "Enter a rate between 1 and 100";
  }

  const url = input.product_url.trim();
  if (!url) {
    errors.product_url = "Add the product link";
  } else {
    try {
      const parsed = new URL(url);
      // A member tapping a non-web scheme in WhatsApp gets nothing useful.
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.product_url = "Link must start with http or https";
      }
    } catch {
      errors.product_url = "Enter a full link, e.g. https://...";
    }
  }

  return errors;
}

export function createProduct(input: ProductInput, editingId: string | null): Product {
  return {
    id: editingId ?? createId("p"),
    title: input.title.trim(),
    category: input.category.trim(),
    price: Number(input.price),
    commission_rate: Number(input.commission_rate),
    product_url: input.product_url.trim(),
    is_active: true,
  };
}

export type SortOrder = "due" | "name";

export const SORT_LABEL: Record<SortOrder, string> = {
  due: "Due first",
  name: "A to Z",
};

/**
 * "due" puts the people who need chasing at the top: furthest overdue first,
 * then whoever expires soonest. Members with an unreadable date sort first
 * rather than vanishing to the bottom.
 */
export function sortMembers<T extends { member: Member }>(rows: T[], order: SortOrder): T[] {
  const sorted = [...rows];

  if (order === "name") {
    sorted.sort((a, b) => a.member.full_name.localeCompare(b.member.full_name));
    return sorted;
  }

  sorted.sort((a, b) => {
    const left = a.member.valid_until;
    const right = b.member.valid_until;
    if (left === right) return a.member.full_name.localeCompare(b.member.full_name);
    return left < right ? -1 : 1;
  });

  return sorted;
}
