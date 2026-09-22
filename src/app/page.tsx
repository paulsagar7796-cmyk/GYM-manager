"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IMPORT_FIELDS,
  buildImportRows,
  detectDateOrder,
  guessMapping,
  importableRows,
  parseFlexibleDate,
  parseImportFile,
  type DateOrder,
  type ImportRow,
  type ImportTable,
  type Mapping,
} from "@/lib/gym-import";
import type {
  GymProfile,
  Member,
  Payment,
  MemberStatus,
  PlanType,
  Product,
  TemplatePlan,
} from "@/lib/gym-data";
import {
  assignPlan,
  deleteMember,
  deletePlan,
  deleteProduct,
  recordRecommendation,
  recordRenewal,
  savePlan,
  undoPayment,
  saveProduct,
  replaceState,
  clearAllData,
  isUntouched,
  loadSampleData,
  saveMember,
  saveProfile,
  toggleProduct,
  updateMembers,
  useAppState,
  useHydrated,
  useOnline,
  usePersistentStorage,
} from "@/lib/gym-store";
import {
  buildBackup,
  loadLastBackupAt,
  parseBackup,
  saveLastBackupAt,
  type BackupSummary,
  type PersistedState,
} from "@/lib/gym-storage";
import {
  buildPlanMessage,
  buildRecommendationMessage,
  buildReminderMessage,
  buildWhatsAppLink,
  commissionPerSale,
  createPlan,
  createProduct,
  formatCurrency,
  formatDateTime,
  formatDueDate,
  isPayableProfile,
  normalizeProfile,
  validateProfile,
  emptyMemberForm,
  memberFromForm,
  memberToForm,
  getCurrentMonthLabel,
  getMemberCounts,
  getMemberStatus,
  getMemberStatusMeta,
  getMonthIncome,
  getMonthlyIncomeSeries,
  getPlan,
  indexPlans,
  plansOfType,
  buildRenewal,
  toISODate,
  totalCommissionPotential,
  validateMemberForm,
  sortMembers,
  SORT_LABEL,
  type SortOrder,
  validatePlan,
  validateProduct,
  type MemberFormInput,
  type PlanInput,
  type ProductInput,
} from "@/lib/gym-utils";

const FILTERS = ["All", "Overdue", "Active", "Plans Library", "Products", "Settings"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_BY_FILTER: Partial<Record<Filter, MemberStatus>> = {
  Overdue: "overdue",
  Active: "active",
};

type Row = {
  member: Member;
  status: MemberStatus | null;
  workout: TemplatePlan | null;
  nutrition: TemplatePlan | null;
  reminderUrl: string | null;
  planUrl: string | null;
};

export default function HomePage() {
  const { profile, members, payments, plans, products, recommendations } = useAppState();
  const hydrated = useHydrated();
  const online = useOnline();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [sort, setSort] = useState<SortOrder>("due");
  const [memberSheet, setMemberSheet] = useState<{ member: Member | null } | null>(null);
  const [planSheet, setPlanSheet] = useState<{ plan: TemplatePlan | null } | null>(null);
  const [productSheet, setProductSheet] = useState<{ product: Product | null } | null>(null);
  const [recommendFor, setRecommendFor] = useState<Member | null>(null);
  const [remindRun, setRemindRun] = useState(false);

  // Null until hydration finishes, so nothing clock-dependent reaches the
  // prerendered HTML.
  const today = useMemo(() => (hydrated ? new Date() : null), [hydrated]);

  const planIndex = useMemo(() => indexPlans(plans), [plans]);
  const workoutPlans = useMemo(() => plansOfType(plans, "workout"), [plans]);
  const nutritionPlans = useMemo(() => plansOfType(plans, "nutrition"), [plans]);

  // Status, resolved plans and both message links are derived once per data
  // change rather than on every keystroke in the search box.
  const rows = useMemo<Row[]>(
    () =>
      members.map((member) => {
        const workout = getPlan(planIndex, member.workout_plan_id);
        const nutrition = getPlan(planIndex, member.nutrition_plan_id);

        return {
          member,
          workout,
          nutrition,
          status: today ? getMemberStatus(member.valid_until, today) : null,
          reminderUrl: buildWhatsAppLink(member.phone, buildReminderMessage(member, profile)),
          planUrl:
            workout || nutrition
              ? buildWhatsAppLink(member.phone, buildPlanMessage(member, workout, nutrition, profile))
              : null,
        };
      }),
    [members, planIndex, profile, today],
  );

  // Keeps typing responsive: the list re-filters at a lower priority.
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const visibleRows = useMemo(
    () =>
      sortMembers(
      rows.filter(({ member, status }) => {
        const matchesQuery =
          needle.length === 0 ||
          member.full_name.toLowerCase().includes(needle) ||
          member.phone.toLowerCase().includes(needle);

        const matchesFilter = filter === "All" || status === STATUS_BY_FILTER[filter];

        return matchesQuery && matchesFilter;
      }),
      sort,
      ),
    [filter, needle, rows, sort],
  );

  const overdueRows = useMemo(
    () => sortMembers(rows.filter((row) => row.status === "overdue"), "due"),
    [rows],
  );

  const counts = useMemo(
    () => (today ? getMemberCounts(rows.map((row) => row.status as MemberStatus)) : null),
    [rows, today],
  );

  const monthIncome = useMemo(
    () => (today ? getMonthIncome(payments, today) : null),
    [payments, today],
  );

  const incomeSeries = useMemo(
    () => (today ? getMonthlyIncomeSeries(payments, today) : null),
    [payments, today],
  );

  const lastPaymentByMember = useMemo(() => {
    const latest = new Map<string, Payment>();
    for (const payment of payments) {
      const held = latest.get(payment.member_id);
      if (!held || payment.payment_date > held.payment_date) latest.set(payment.member_id, payment);
    }
    return latest;
  }, [payments]);

  const activeProducts = useMemo(
    () => products.filter((product) => product.is_active),
    [products],
  );

  const sentByProduct = useMemo(() => {
    const sent = new Map<string, number>();
    for (const item of recommendations) {
      sent.set(item.product_id, (sent.get(item.product_id) ?? 0) + 1);
    }
    return sent;
  }, [recommendations]);

  const usageByPlan = useMemo(() => {
    const usage = new Map<string, number>();
    for (const member of members) {
      for (const id of [member.workout_plan_id, member.nutrition_plan_id]) {
        if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
      }
    }
    return usage;
  }, [members]);

  const handleRenew = useCallback((member: Member) => {
    const { member: renewed, payment } = buildRenewal(member, new Date());
    recordRenewal(renewed, payment);
  }, []);

  const handleSaveMember = useCallback((input: MemberFormInput, base: Member | null) => {
    const member = memberFromForm(input, new Date(), base ?? undefined);

    if (base) saveMember(member);
    else updateMembers((prev) => [member, ...prev]);

    setMemberSheet(null);
  }, []);

  const handleDeleteMember = useCallback((memberId: string) => {
    deleteMember(memberId);
    setMemberSheet(null);
  }, []);

  const handleSavePlan = useCallback((input: PlanInput, editingId: string | null) => {
    savePlan(createPlan(input, editingId));
    setPlanSheet(null);
  }, []);

  const handleSaveProduct = useCallback((input: ProductInput, editingId: string | null) => {
    saveProduct(createProduct(input, editingId));
    setProductSheet(null);
  }, []);

  const firstRun = isUntouched({ profile, members, payments, plans, products, recommendations });
  const showingLibrary = filter === "Plans Library";
  const showingProducts = filter === "Products";
  const showingBackup = filter === "Settings";
  const showingMembers = !showingLibrary && !showingProducts && !showingBackup;

  return (
    <div className="min-h-screen bg-[#f3f5f7] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col bg-[#f8fafc] shadow-2xl shadow-slate-200/60">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-[#f8fafc]/90 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+16px)] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Gym Manager
              </p>
              <h1 className="mt-1 text-xl font-black tracking-tight text-slate-900">
                {today ? getCurrentMonthLabel(today) : " "}
              </h1>
            </div>
            {!showingBackup && (
              <button
                type="button"
                onClick={() => {
                  if (showingLibrary) setPlanSheet({ plan: null });
                  else if (showingProducts) setProductSheet({ product: null });
                  else setMemberSheet({ member: null });
                }}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-slate-300 transition active:scale-[0.98]"
              >
                {showingLibrary ? "Add Plan" : showingProducts ? "Add Product" : "Add Member"}
              </button>
            )}
          </div>

          <div className="mt-4 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-4 text-white shadow-lg shadow-slate-300/50">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
              Collected This Month
            </p>
            <div className="mt-2 flex items-baseline justify-between">
              <p className="text-3xl font-black tracking-tight">
                {monthIncome === null ? " " : formatCurrency(monthIncome)}
              </p>
            </div>
            {incomeSeries && <IncomeChart series={incomeSeries} />}

            <div className="mt-4 flex flex-wrap gap-2">
              <MetricPill
                label="Total Members"
                value={counts ? String(counts.total) : "--"}
                onClick={() => setFilter("All")}
              />
              <MetricPill
                label="Active"
                value={counts ? String(counts.active) : "--"}
                tone="green"
                onClick={() => setFilter("Active")}
              />
              <MetricPill label="Due Soon" value={counts ? String(counts.dueSoon) : "--"} tone="amber" />
              <MetricPill
                label="Overdue"
                value={counts ? String(counts.overdue) : "--"}
                tone="red"
                onClick={() => setFilter("Overdue")}
              />
            </div>
          </div>
        </header>

        {!online && (
          <p
            role="status"
            className="bg-amber-100 px-4 py-2 text-center text-[11px] font-bold text-amber-900"
          >
            Offline &mdash; everything still works. WhatsApp will send once you reconnect.
          </p>
        )}

        <main className="flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4">
          {!showingBackup && (
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/40">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                showingLibrary
                  ? "Search plans"
                  : showingProducts
                    ? "Search products"
                    : "Search name or phone"
              }
              type="search"
              aria-label={
                showingLibrary
                  ? "Search plans"
                  : showingProducts
                    ? "Search products"
                    : "Search members by name or phone"
              }
              className="w-full border-0 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          )}

          <div
            role="tablist"
            aria-label="Filter members"
            className="mt-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {FILTERS.map((chip) => {
              const active = filter === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(chip)}
                  className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-[0.98] ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {chip}
                </button>
              );
            })}
          </div>

          {showingMembers && (
            <div className="mt-3 flex items-center justify-between gap-2 px-1">
              <p className="text-[11px] font-bold text-slate-400">
                {visibleRows.length} shown
              </p>
              <div className="flex gap-1">
                {(["due", "name"] as SortOrder[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={sort === option}
                    onClick={() => setSort(option)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                      sort === option
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    {SORT_LABEL[option]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showingMembers && filter === "Overdue" && overdueRows.length > 0 && (
            <button
              type="button"
              onClick={() => setRemindRun(true)}
              className="mt-3 w-full rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white transition active:scale-[0.99]"
            >
              &#128172; Remind All {overdueRows.length} Overdue
            </button>
          )}

          {showingBackup ? (
            <>
              <GymProfilePanel profile={profile} />
              <InstallPanel />
              <BackupPanel state={{ profile, members, payments, plans, products, recommendations }} />
              <ImportPanel existing={members} today={today} />
              <DangerPanel memberCount={members.length} />
            </>
          ) : showingProducts ? (
            <ProductsCatalog
              products={products}
              sentByProduct={sentByProduct}
              needle={needle}
              onEdit={(product) => setProductSheet({ product })}
              onToggle={toggleProduct}
              onDelete={deleteProduct}
            />
          ) : showingLibrary ? (
            <PlansLibrary
              workoutPlans={workoutPlans}
              nutritionPlans={nutritionPlans}
              usageByPlan={usageByPlan}
              needle={needle}
              onEdit={(plan) => setPlanSheet({ plan })}
              onDelete={deletePlan}
            />
          ) : (
            <div className="mt-4 space-y-3">
              {showingMembers && visibleRows.length === 0 ? (
                firstRun ? (
                  <FirstRun
                    onAdd={() => setMemberSheet({ member: null })}
                    onImport={() => setFilter("Settings")}
                  />
                ) : (
                  <EmptyState
                    title={members.length > 0 ? "No members match this view" : "No members yet"}
                    hint={
                      members.length > 0
                        ? "Try a different filter or clear the search."
                        : "Tap Add Member to get started."
                    }
                  />
                )
              ) : (
                visibleRows.map((row) => (
                  <MemberCard
                    key={row.member.id}
                    row={row}
                    workoutPlans={workoutPlans}
                    nutritionPlans={nutritionPlans}
                    canRecommend={activeProducts.length > 0}
                    onRenew={handleRenew}
                    onRecommend={setRecommendFor}
                    onEdit={(member) => setMemberSheet({ member })}
                    lastPayment={lastPaymentByMember.get(row.member.id) ?? null}
                  />
                ))
              )}
            </div>
          )}
        </main>
      </div>

      {memberSheet && (
        <MemberSheet
          editing={memberSheet.member}
          existing={members}
          today={today}
          onClose={() => setMemberSheet(null)}
          onSave={handleSaveMember}
          onDelete={handleDeleteMember}
        />
      )}

      {planSheet && (
        <PlanSheet
          editing={planSheet.plan}
          existing={plans}
          onClose={() => setPlanSheet(null)}
          onSave={handleSavePlan}
        />
      )}

      {productSheet && (
        <ProductSheet
          editing={productSheet.product}
          onClose={() => setProductSheet(null)}
          onSave={handleSaveProduct}
        />
      )}

      {remindRun && (
        <RemindRunSheet rows={overdueRows} onClose={() => setRemindRun(false)} />
      )}

      {recommendFor && (
        <RecommendSheet
          member={recommendFor}
          products={activeProducts}
          profile={profile}
          onClose={() => setRecommendFor(null)}
        />
      )}
    </div>
  );
}

function MemberCard({
  row,
  workoutPlans,
  nutritionPlans,
  canRecommend,
  onRenew,
  onRecommend,
  onEdit,
  lastPayment,
}: {
  row: Row;
  lastPayment: Payment | null;
  workoutPlans: TemplatePlan[];
  nutritionPlans: TemplatePlan[];
  canRecommend: boolean;
  onRenew: (member: Member) => void;
  onRecommend: (member: Member) => void;
  onEdit: (member: Member) => void;
}) {
  const { member, status, reminderUrl, planUrl } = row;
  const statusMeta = status ? getMemberStatusMeta(status) : null;
  const [undoing, setUndoing] = useState(false);

  return (
    <article className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">{member.full_name}</h2>
          <div className="mt-1 flex flex-col gap-0.5">
            <a
              href={`tel:${member.phone}`}
              className="text-sm font-medium text-slate-600 underline decoration-slate-400 underline-offset-4"
            >
              {member.phone}
            </a>
            <p className="text-[11px] font-semibold text-slate-400">
              Valid till {formatDueDate(member.valid_until)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
              statusMeta ? statusMeta.color : "border-slate-200 bg-slate-100 text-slate-400"
            }`}
          >
            {statusMeta ? statusMeta.label : "––"}
          </span>
          <button
            type="button"
            onClick={() => onEdit(member)}
            aria-label={`Edit ${member.full_name}`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-600 transition active:scale-[0.95]"
          >
            &#9998;
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <InfoTile
          label="Current Weight"
          value={member.current_weight === null ? "Not set" : `${member.current_weight} kg`}
        />
        <InfoTile
          label="Goal Weight"
          value={member.target_weight === null ? "Not set" : `${member.target_weight} kg`}
        />
      </div>

      <div className="mt-3 space-y-3">
        <PlanSelect
          label="Workout"
          plans={workoutPlans}
          value={member.workout_plan_id}
          onChange={(planId) => assignPlan(member.id, "workout", planId)}
        />
        <PlanSelect
          label="Nutrition"
          plans={nutritionPlans}
          value={member.nutrition_plan_id}
          onChange={(planId) => assignPlan(member.id, "nutrition", planId)}
        />
      </div>

      <div className="mt-4 flex gap-2">
        <LinkButton href={reminderUrl} label="&#128172; Remind Dues" disabledHint="No valid phone number on file" />
        <button
          type="button"
          onClick={() => onRenew(member)}
          className="flex-1 rounded-2xl bg-slate-900 px-3 py-3 text-xs font-black text-white shadow-sm shadow-slate-200 transition active:scale-[0.98]"
        >
          &#9889; Renew ({formatCurrency(member.monthly_fee)})
        </button>
      </div>

      {lastPayment && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-bold text-slate-500">
            Paid {formatCurrency(lastPayment.amount)} on {formatDueDate(lastPayment.payment_date)}
          </p>
          <button
            type="button"
            onClick={() => (undoing ? undoPayment(lastPayment.id) : setUndoing(true))}
            onBlur={() => undoing && setUndoing(false)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black transition ${
              undoing ? "bg-rose-500 text-white" : "text-slate-500 underline underline-offset-2"
            }`}
          >
            {undoing ? "Confirm undo" : "Undo"}
          </button>
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <LinkButton
          href={planUrl}
          label="&#128203; Send Plan"
          disabledHint="Assign a workout or nutrition plan first"
        />
        {canRecommend ? (
          <button
            type="button"
            onClick={() => onRecommend(member)}
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-black text-slate-700 transition active:scale-[0.98]"
          >
            &#128717; Recommend
          </button>
        ) : (
          <span
            title="Add an active product in the Products tab first"
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-3 text-center text-xs font-black text-slate-400"
          >
            &#128717; Recommend
          </span>
        )}
      </div>
    </article>
  );
}

/** Native select on purpose: it gets the OS picker on a phone for free. */
function PlanSelect({
  label,
  plans,
  value,
  onChange,
}: {
  label: string;
  plans: TemplatePlan[];
  value: string | null;
  onChange: (planId: string | null) => void;
}) {
  const id = useId();

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
      <label htmlFor={id} className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </label>
      <div className="relative mt-1">
        <select
          id={id}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          className={`w-full appearance-none truncate bg-transparent pr-6 text-sm font-bold outline-none ${
            value ? "text-slate-800" : "text-slate-400"
          }`}
        >
          <option value="">Not assigned</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.title}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
        >
          &#9660;
        </span>
      </div>
    </div>
  );
}

function PlansLibrary({
  workoutPlans,
  nutritionPlans,
  usageByPlan,
  needle,
  onEdit,
  onDelete,
}: {
  workoutPlans: TemplatePlan[];
  nutritionPlans: TemplatePlan[];
  usageByPlan: Map<string, number>;
  needle: string;
  onEdit: (plan: TemplatePlan) => void;
  onDelete: (planId: string) => void;
}) {
  // Reset on every change of what is listed, so a pending confirm cannot carry
  // over onto a different plan.
  const [confirming, setConfirming] = useState<string | null>(null);

  const match = (plan: TemplatePlan) =>
    needle.length === 0 ||
    plan.title.toLowerCase().includes(needle) ||
    plan.content.toLowerCase().includes(needle);

  const workout = workoutPlans.filter(match);
  const nutrition = nutritionPlans.filter(match);

  if (workout.length === 0 && nutrition.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title={needle ? "No plans match that search" : "No plans yet"}
          hint={needle ? "Try a different word." : "Tap Add Plan to build your first template."}
        />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-5">
      <PlanSection
        title="Workout Plans"
        plans={workout}
        usageByPlan={usageByPlan}
        confirming={confirming}
        setConfirming={setConfirming}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <PlanSection
        title="Nutrition Plans"
        plans={nutrition}
        usageByPlan={usageByPlan}
        confirming={confirming}
        setConfirming={setConfirming}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

function PlanSection({
  title,
  plans,
  usageByPlan,
  confirming,
  setConfirming,
  onEdit,
  onDelete,
}: {
  title: string;
  plans: TemplatePlan[];
  usageByPlan: Map<string, number>;
  confirming: string | null;
  setConfirming: (id: string | null) => void;
  onEdit: (plan: TemplatePlan) => void;
  onDelete: (planId: string) => void;
}) {
  if (plans.length === 0) return null;

  return (
    <section>
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
        {title} ({plans.length})
      </h2>
      <div className="mt-2 space-y-3">
        {plans.map((plan) => {
          const inUse = usageByPlan.get(plan.id) ?? 0;
          const isConfirming = confirming === plan.id;

          return (
            <article
              key={plan.id}
              className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-black text-slate-900">{plan.title}</h3>
                <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                  {inUse === 0 ? "Unused" : `${inUse} assigned`}
                </span>
              </div>

              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs font-medium leading-relaxed text-slate-600">
                {plan.content}
              </pre>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(plan)}
                  className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-black text-slate-700 transition active:scale-[0.98]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => (isConfirming ? onDelete(plan.id) : setConfirming(plan.id))}
                  onBlur={() => isConfirming && setConfirming(null)}
                  className={`flex-1 rounded-2xl border px-3 py-3 text-xs font-black transition active:scale-[0.98] ${
                    isConfirming
                      ? "border-rose-500 bg-rose-500 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {isConfirming
                    ? inUse > 0
                      ? `Remove from ${inUse}?`
                      : "Confirm delete"
                    : "Delete"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The only thing standing between a lost phone and a lost gym. Storage here is
 * device-local, so the owner needs a file they can carry to the next device.
 */
function BackupPanel({ state }: { state: PersistedState }) {
  const storage = usePersistentStorage();
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Read after mount only: this page is prerendered, and storage is not
    // readable on the server.
    const read = async () => setLastBackup(loadLastBackupAt());
    void read();
  }, []);

  const filename = `gym-manager-backup-${toISODate(new Date())}.json`;
  const json = () => JSON.stringify(buildBackup(state), null, 2);

  const markSaved = () => {
    const now = new Date().toISOString();
    saveLastBackupAt(now);
    setLastBackup(now);
  };

  const handleSave = async () => {
    const text = json();

    // Share first: on an installed iOS web app this is the only reliable way
    // to get a file out, and it lands straight in WhatsApp or Files.
    try {
      const file = new File([text], filename, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Gym Manager backup" });
        markSaved();
        setNotice("Backup shared.");
        return;
      }
    } catch (error) {
      // A cancelled share is not a failure; fall through to the download.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      markSaved();
      setNotice("Backup downloaded.");
    } catch {
      setNotice("Could not save the file. Use Copy as text instead.");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json());
      markSaved();
      setNotice("Backup copied. Paste it somewhere safe.");
    } catch {
      setNotice("Clipboard blocked. Use Save Backup instead.");
    }
  };

  const offerRestore = (text: string) => {
    const parsed = parseBackup(text);
    setNotice(parsed ? null : "That file is not a readable Gym Manager backup.");
    setPending(parsed);
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => offerRestore(String(reader.result ?? ""));
    reader.onerror = () => setNotice("Could not read that file.");
    reader.readAsText(file);

    // Lets the same file be picked again after a cancelled restore.
    event.target.value = "";
  };

  const confirmRestore = () => {
    if (!pending) return;
    replaceState(pending.state);
    setPending(null);
    setPasted("");
    setNotice("Restored. Everything on this device now matches the backup.");
  };

  const storageLabel: Record<typeof storage, string> = {
    unknown: "Checking...",
    protected: "Protected from automatic cleanup",
    unprotected: "Browser may clear this data to free space",
    unsupported: "This browser cannot protect stored data",
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-[26px] border border-amber-300 bg-amber-50 p-4">
        <p className="text-sm font-black text-amber-900">Data lives on this device only</p>
        <p className="mt-1 text-xs font-medium leading-relaxed text-amber-800">
          There is no account and no server copy yet. Changing phone, switching browser or clearing
          site data loses every member and renewal date. Save a backup file and keep it somewhere
          you would still have after losing this phone.
        </p>
      </div>

      <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
        <div className="grid grid-cols-2 gap-3">
          <InfoTile label="Members" value={String(state.members.length)} />
          <InfoTile label="Plans" value={String(state.plans.length)} />
          <InfoTile label="Products" value={String(state.products.length)} />
          <InfoTile label="Recommendations" value={String(state.recommendations.length)} />
        </div>

        <p className="mt-3 text-[11px] font-bold text-slate-500">
          Last backup: {lastBackup ? formatDateTime(lastBackup) : "never"}
        </p>
        <p className="mt-1 text-[11px] font-medium text-slate-400">
          Storage: {storageLabel[storage]}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-2xl bg-slate-900 px-3 py-3 text-xs font-black text-white transition active:scale-[0.98]"
          >
            &#128190; Save Backup
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-black text-slate-700 transition active:scale-[0.98]"
          >
            Copy as text
          </button>
        </div>
      </div>

      <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
        <h2 className="text-sm font-black text-slate-900">Restore on a new phone</h2>
        <p className="mt-1 text-xs font-medium text-slate-500">
          Pick the backup file, or paste its text. This replaces everything currently on this
          device.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 transition active:scale-[0.99]"
        >
          Choose Backup File
        </button>

        <textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          rows={3}
          aria-label="Paste backup text"
          placeholder="...or paste backup text here"
          className="mt-3 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs outline-none"
        />
        <button
          type="button"
          disabled={pasted.trim().length === 0}
          onClick={() => offerRestore(pasted)}
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 transition active:scale-[0.99] disabled:opacity-40"
        >
          Read Pasted Backup
        </button>
      </div>

      {notice && (
        <p role="status" className="px-1 text-xs font-bold text-slate-600">
          {notice}
        </p>
      )}

      {pending && (
        <div className="rounded-[26px] border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-black text-rose-900">Replace everything on this device?</p>
          <p className="mt-1 text-xs font-medium text-rose-800">
            This backup holds {pending.state.members.length} members, {pending.state.plans.length}{" "}
            plans and {pending.state.products.length} products
            {pending.exported_at ? `, saved ${formatDateTime(pending.exported_at)}` : ""}. Your
            current {state.members.length} members will be discarded.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-black text-slate-700 transition active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmRestore}
              className="flex-1 rounded-2xl bg-rose-600 px-3 py-3 text-xs font-black text-white transition active:scale-[0.98]"
            >
              Replace Everything
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ISSUE_LABEL: Record<ImportRow["issues"][number], string> = {
  "no-name": "No name in this row",
  "bad-date": "Date could not be read",
  "no-phone": "No usable phone number",
  duplicate: "Already in your list",
};

/**
 * Installing differs by platform and neither path is discoverable on its own:
 * Android fires `beforeinstallprompt` which we can trigger from a button, while
 * iOS has no prompt API at all and can only be installed through the Share
 * sheet, so it gets written instructions instead.
 */
function InstallPanel() {
  const [prompt, setPrompt] = useState<Event | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone));

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Read after mount: none of this exists during the prerender.
    const settle = async () => {
      setIsIOS(ios);
      setInstalled(standalone);
    };
    void settle();

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
      <h2 className="text-sm font-black text-slate-900">Put it on your home screen</h2>
      <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
        Installed, it opens full screen and keeps working without a signal.
      </p>

      {prompt ? (
        <button
          type="button"
          onClick={async () => {
            const deferred = prompt as Event & {
              prompt: () => Promise<void>;
              userChoice: Promise<{ outcome: string }>;
            };
            await deferred.prompt();
            await deferred.userChoice;
            setPrompt(null);
          }}
          className="mt-3 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition active:scale-[0.99]"
        >
          Install App
        </button>
      ) : (
        <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-600">
          {isIOS ? (
            <>
              In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. iOS
              has no install button for websites.
            </>
          ) : (
            <>
              Use your browser menu and choose <strong>Install app</strong> or{" "}
              <strong>Add to Home screen</strong>.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The gym's own details. These end up in the messages members receive, so the
 * UPI id in particular is not cosmetic: a wrong or missing one sends payments
 * to the wrong place or leaves the member with no way to pay at all.
 */
function GymProfilePanel({ profile }: { profile: GymProfile }) {
  const [form, setForm] = useState<GymProfile>(profile);
  const [errors, setErrors] = useState<Partial<Record<keyof GymProfile, string>>>({});
  const [saved, setSaved] = useState(false);

  const dirty = (Object.keys(form) as (keyof GymProfile)[]).some(
    (key) => form[key].trim() !== profile[key].trim(),
  );

  const update = (field: keyof GymProfile) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    setSaved(false);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validateProfile(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    saveProfile(normalizeProfile(form));
    setSaved(true);
  };

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
      <h2 className="text-sm font-black text-slate-900">Your gym</h2>
      <p className="mt-1 text-xs font-medium text-slate-500">
        These details appear in the WhatsApp messages your members receive.
      </p>

      {!isPayableProfile(profile) && (
        <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-black text-amber-900">Reminders cannot collect payment yet</p>
          <p className="mt-1 text-[11px] font-medium leading-relaxed text-amber-800">
            Without a UPI id, dues reminders go out with no way for the member to pay. Add yours
            below.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-3 space-y-3">
        <Field
          placeholder="Gym name"
          value={form.gym_name}
          onChange={update("gym_name")}
          error={errors.gym_name}
        />
        <Field
          placeholder="Owner name"
          value={form.owner_name}
          onChange={update("owner_name")}
          autoComplete="name"
        />
        <Field
          placeholder="UPI ID, e.g. ironhouse@okhdfcbank"
          value={form.upi_id}
          onChange={update("upi_id")}
          error={errors.upi_id}
          autoCapitalize="none"
          spellCheck={false}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            placeholder="Your phone"
            value={form.phone}
            onChange={update("phone")}
            error={errors.phone}
            type="tel"
            inputMode="tel"
          />
          <Field
            placeholder="Email"
            value={form.email}
            onChange={update("email")}
            error={errors.email}
            type="email"
            inputMode="email"
            autoCapitalize="none"
          />
        </div>

        <button
          type="submit"
          disabled={!dirty}
          className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition active:scale-[0.99] disabled:opacity-40"
        >
          Save Gym Details
        </button>
      </form>

      {saved && !dirty && (
        <p role="status" className="mt-2 px-1 text-[11px] font-bold text-emerald-700">
          Saved. Messages now go out as {profile.gym_name}
          {isPayableProfile(profile) ? ` with UPI ${profile.upi_id}` : ""}.
        </p>
      )}
    </div>
  );
}

/**
 * Onboarding an existing gym. Nothing is written until the owner has seen the
 * first rows rendered exactly as they would land, because the dangerous failure
 * here is silent: 05/10/2026 parses cleanly as either 5 October or 10 May.
 */
function ImportPanel({ existing, today }: { existing: Member[]; today: Date | null }) {
  const [table, setTable] = useState<ImportTable | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [order, setOrder] = useState<DateOrder>("day-first");
  const [orderCertain, setOrderCertain] = useState(true);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = (text: string, name: string) => {
    const parsed = parseImportFile(text);

    if (!parsed) {
      setError("Could not read that as a spreadsheet or JSON export. It needs a header row and at least one member.");
      setTable(null);
      return;
    }

    const guessed = guessMapping(parsed.headers);
    const dateColumn = guessed.valid_until ?? guessed.joined_date;
    const detected =
      dateColumn === undefined
        ? { order: "day-first" as DateOrder, certain: true }
        : detectDateOrder(parsed.rows.map((row) => row[dateColumn] ?? ""));

    setError(null);
    setDone(null);
    setTable(parsed);
    setFileName(name);
    setMapping(guessed);
    setOrder(detected.order);
    setOrderCertain(detected.certain);
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => accept(String(reader.result ?? ""), file.name);
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
    event.target.value = "";
  };

  const rows = useMemo(
    () => (table && today ? buildImportRows(table, mapping, order, existing, today) : []),
    [existing, mapping, order, table, today],
  );

  const ready = useMemo(() => importableRows(rows), [rows]);
  const problems = useMemo(() => rows.filter((row) => !ready.includes(row)), [ready, rows]);
  const nameMapped = mapping.full_name !== undefined;

  const dateSample = useMemo(() => {
    const column = mapping.valid_until;
    if (table === null || column === undefined) return null;

    const raw = table.rows.map((row) => row[column]).find((value) => /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test((value ?? "").trim()));
    if (!raw) return null;

    return {
      raw: raw.trim(),
      dayFirst: parseFlexibleDate(raw, "day-first"),
      monthFirst: parseFlexibleDate(raw, "month-first"),
    };
  }, [mapping.valid_until, table]);

  const reset = () => {
    setTable(null);
    setMapping({});
    setPasted("");
    setFileName("");
  };

  const runImport = () => {
    const members = ready.map((row) => row.member as Member);
    updateMembers((prev) => [...members, ...prev]);
    setDone(members.length);
    reset();
  };

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
      <h2 className="text-sm font-black text-slate-900">Import from another app</h2>
      <p className="mt-1 text-xs font-medium text-slate-500">
        Bring a gym over from a spreadsheet, a paper register you have typed up, or another app&apos;s
        export. CSV or JSON. Members are added to your list, nothing is replaced.
      </p>

      {table === null ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,text/csv,application/json"
            onChange={handleFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 transition active:scale-[0.99]"
          >
            Choose CSV or JSON File
          </button>
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={3}
            aria-label="Paste member data"
            placeholder="...or paste rows here, header line first"
            className="mt-3 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs outline-none"
          />
          <button
            type="button"
            disabled={pasted.trim().length === 0}
            onClick={() => accept(pasted, "pasted data")}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 transition active:scale-[0.99] disabled:opacity-40"
          >
            Read Pasted Data
          </button>
        </>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-[11px] font-bold text-slate-500">
            {table.rows.length} rows, {table.headers.length} columns in {fileName}
          </p>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Match the columns
            </p>
            <div className="mt-2 space-y-2">
              {IMPORT_FIELDS.map((field) => (
                <ColumnPicker
                  key={field.key}
                  field={field}
                  headers={table.headers}
                  value={mapping[field.key]}
                  onChange={(index) =>
                    setMapping((prev) => {
                      const next = { ...prev };
                      if (index === undefined) delete next[field.key];
                      else next[field.key] = index;
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </div>

          {dateSample && (
            <div className={`rounded-2xl border p-3 ${orderCertain ? "border-slate-200 bg-slate-50" : "border-amber-300 bg-amber-50"}`}>
              <p className="text-[11px] font-bold text-slate-700">
                Dates look like &ldquo;{dateSample.raw}&rdquo;. Which is it?
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["day-first", "month-first"] as DateOrder[]).map((option) => {
                  const resolved = option === "day-first" ? dateSample.dayFirst : dateSample.monthFirst;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={order === option}
                      onClick={() => setOrder(option)}
                      className={`rounded-xl border px-2 py-2 text-[11px] font-black transition ${
                        order === option
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      {resolved ? formatDueDate(resolved) : "--"}
                    </button>
                  );
                })}
              </div>
              {!orderCertain && (
                <p className="mt-2 text-[11px] font-medium text-amber-800">
                  This file does not say which. Check the preview below before importing.
                </p>
              )}
            </div>
          )}

          {!nameMapped ? (
            <p className="rounded-2xl border border-rose-300 bg-rose-50 p-3 text-xs font-bold text-rose-800">
              Pick which column holds the member&apos;s name to continue.
            </p>
          ) : (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Preview
              </p>
              <div className="mt-2 space-y-2">
                {ready.slice(0, 4).map((row) => (
                  <div key={row.index} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-black text-slate-900">{row.member!.full_name}</span>
                      <span className="shrink-0 text-[11px] font-bold text-slate-500">
                        {formatCurrency(row.member!.monthly_fee)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                      {row.member!.phone || "no phone"} &middot; valid till{" "}
                      {formatDueDate(row.member!.valid_until)}
                    </p>
                  </div>
                ))}
                {ready.length === 0 && (
                  <p className="text-xs font-bold text-slate-500">No rows are ready to import.</p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Tally label="Will be added" value={ready.length} tone="good" />
                {problems.length > 0 && <Tally label="Skipped" value={problems.length} tone="warn" />}
              </div>

              {problems.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {problems.slice(0, 5).map((row) => (
                    <li key={row.index} className="text-[11px] font-medium text-slate-500">
                      Row {row.index + 2}: {row.issues.map((issue) => ISSUE_LABEL[issue]).join(", ")}
                      {row.member ? ` (${row.member.full_name})` : ""}
                    </li>
                  ))}
                  {problems.length > 5 && (
                    <li className="text-[11px] font-medium text-slate-400">
                      and {problems.length - 5} more
                    </li>
                  )}
                </ul>
              )}

              {mapping.valid_until === undefined && (
                <p className="mt-2 text-[11px] font-medium text-amber-700">
                  No expiry column mapped, so everyone imports as due today rather than being given a
                  free month.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-black text-slate-700 transition active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!nameMapped || ready.length === 0}
              onClick={runImport}
              className="flex-1 rounded-2xl bg-slate-900 px-3 py-3 text-xs font-black text-white transition active:scale-[0.98] disabled:opacity-40"
            >
              Add {ready.length} Member{ready.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-xs font-bold text-rose-600">{error}</p>}
      {done !== null && (
        <p role="status" className="mt-3 text-xs font-bold text-emerald-700">
          Imported {done} member{done === 1 ? "" : "s"}. They are in your list now.
        </p>
      )}
    </div>
  );
}

/**
 * Erasing and demo-loading are both destructive, so they live together, last,
 * behind two taps each. "Load Sample Data" is deliberately not the default
 * state of a fresh install any more.
 */
function DangerPanel({ memberCount }: { memberCount: number }) {
  const [confirming, setConfirming] = useState<"sample" | "clear" | null>(null);

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
      <h2 className="text-sm font-black text-slate-900">Start over</h2>
      <p className="mt-1 text-xs font-medium text-slate-500">
        Both of these erase your {memberCount} member{memberCount === 1 ? "" : "s"}, payment history
        and settings. Save a backup first.
      </p>

      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={() => (confirming === "clear" ? clearAllData() : setConfirming("clear"))}
          onBlur={() => confirming === "clear" && setConfirming(null)}
          className={`w-full rounded-2xl border px-4 py-3 text-sm font-black transition active:scale-[0.99] ${
            confirming === "clear"
              ? "border-rose-500 bg-rose-500 text-white"
              : "border-slate-200 bg-slate-50 text-rose-600"
          }`}
        >
          {confirming === "clear" ? "Tap again to erase everything" : "Erase All Data"}
        </button>

        <button
          type="button"
          onClick={() => (confirming === "sample" ? loadSampleData() : setConfirming("sample"))}
          onBlur={() => confirming === "sample" && setConfirming(null)}
          className={`w-full rounded-2xl border px-4 py-3 text-sm font-black transition active:scale-[0.99] ${
            confirming === "sample"
              ? "border-rose-500 bg-rose-500 text-white"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {confirming === "sample" ? "Tap again to load the demo gym" : "Load Sample Data"}
        </button>
      </div>
    </div>
  );
}

function ColumnPicker({
  field,
  headers,
  value,
  onChange,
}: {
  field: (typeof IMPORT_FIELDS)[number];
  headers: string[];
  value: number | undefined;
  onChange: (index: number | undefined) => void;
}) {
  const id = useId();

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
      <label htmlFor={id} className="flex-1 text-xs font-bold text-slate-700">
        {field.label}
        <span className="ml-1 font-medium text-slate-400">{field.hint}</span>
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        className={`max-w-[45%] truncate bg-transparent text-right text-xs font-bold outline-none ${
          value === undefined ? "text-slate-400" : "text-slate-800"
        }`}
      >
        <option value="">Skip</option>
        {headers.map((header, index) => (
          <option key={`${header}-${index}`} value={index}>
            {header}
          </option>
        ))}
      </select>
    </div>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone: "good" | "warn" }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
        tone === "good"
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700"
          : "border-amber-500/30 bg-amber-500/15 text-amber-700"
      }`}
    >
      {label}: {value}
    </span>
  );
}

function ProductsCatalog({
  products,
  sentByProduct,
  needle,
  onEdit,
  onToggle,
  onDelete,
}: {
  products: Product[];
  sentByProduct: Map<string, number>;
  needle: string;
  onEdit: (product: Product) => void;
  onToggle: (productId: string) => void;
  onDelete: (productId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  const visible = products.filter(
    (product) =>
      needle.length === 0 ||
      product.title.toLowerCase().includes(needle) ||
      product.category.toLowerCase().includes(needle),
  );

  const potential = totalCommissionPotential(products);
  const activeCount = products.filter((product) => product.is_active).length;

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
          Your Commission Per Full Round
        </p>
        <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
          {formatCurrency(potential)}
        </p>
        <p className="mt-1 text-[11px] font-medium text-slate-500">
          If one member buys each of your {activeCount} live product
          {activeCount === 1 ? "" : "s"}. Members never see these numbers.
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={needle ? "No products match that search" : "No products yet"}
          hint={
            needle ? "Try a different word." : "Tap Add Product to start your recommendation list."
          }
        />
      ) : (
        visible.map((product) => {
          const sent = sentByProduct.get(product.id) ?? 0;
          const isConfirming = confirming === product.id;

          return (
            <article
              key={product.id}
              className={`rounded-[26px] border bg-white p-4 shadow-sm shadow-slate-200/50 ${
                product.is_active ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-black text-slate-900">{product.title}</h3>
                  <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    {product.category}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                    product.is_active
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600"
                      : "border-slate-200 bg-slate-100 text-slate-500"
                  }`}
                >
                  {product.is_active ? "Live" : "Hidden"}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <InfoTile label="Price" value={formatCurrency(product.price)} />
                <InfoTile
                  label={`You Earn (${product.commission_rate}%)`}
                  value={formatCurrency(commissionPerSale(product))}
                />
              </div>

              <p className="mt-3 truncate text-[11px] font-medium text-slate-400">
                {product.product_url}
              </p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">
                {sent === 0 ? "Not recommended yet" : `Recommended ${sent} time${sent === 1 ? "" : "s"}`}
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(product)}
                  className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-black text-slate-700 transition active:scale-[0.98]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onToggle(product.id)}
                  className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-black text-slate-700 transition active:scale-[0.98]"
                >
                  {product.is_active ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  onClick={() => (isConfirming ? onDelete(product.id) : setConfirming(product.id))}
                  onBlur={() => isConfirming && setConfirming(null)}
                  className={`flex-1 rounded-2xl border px-3 py-3 text-xs font-black transition active:scale-[0.98] ${
                    isConfirming
                      ? "border-rose-500 bg-rose-500 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {isConfirming ? "Confirm" : "Delete"}
                </button>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

/**
 * Picking a product opens WhatsApp straight away. Each row is a real anchor so
 * the hand-off survives popup blockers; the click only records that it was sent.
 */
/**
 * Chasing dues, one tap at a time.
 *
 * WhatsApp can only open one chat per tap, and firing twenty links at once is
 * blocked by every popup blocker, so this is a worklist instead: send, come
 * back, the row is ticked, move to the next.
 */
function RemindRunSheet({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  const [sent, setSent] = useState<Set<string>>(new Set());
  const remaining = rows.filter((row) => !sent.has(row.member.id));

  return (
    <Sheet title={`Remind ${rows.length} overdue`} onClose={onClose}>
      <p className="mb-3 px-1 text-[11px] font-medium text-slate-500">
        Each one opens WhatsApp with their own dues message. Come back here and the next is ready.
      </p>

      <div className="mb-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${rows.length ? (sent.size / rows.length) * 100 : 0}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] font-black text-slate-500">
          {sent.size} of {rows.length}
        </span>
      </div>

      {remaining.length === 0 ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-6 text-center">
          <p className="text-sm font-black text-emerald-700">All reminders sent</p>
          <p className="mt-1 text-[11px] font-medium text-emerald-800">
            Renew each member from their card once they pay.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const done = sent.has(row.member.id);

            return (
              <div
                key={row.member.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 ${
                  done ? "border-slate-200 bg-slate-100 opacity-60" : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-900">
                    {row.member.full_name}
                  </p>
                  <p className="text-[11px] font-bold text-slate-500">
                    {formatCurrency(row.member.monthly_fee)} &middot; due{" "}
                    {formatDueDate(row.member.valid_until)}
                  </p>
                </div>

                {done ? (
                  <span className="shrink-0 text-[11px] font-black text-emerald-600">Sent</span>
                ) : row.reminderUrl ? (
                  <a
                    href={row.reminderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      setSent((prev) => new Set(prev).add(row.member.id))
                    }
                    className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white"
                  >
                    Send
                  </a>
                ) : (
                  <span
                    title="No valid phone number on file"
                    className="shrink-0 rounded-full bg-slate-200 px-3 py-1.5 text-[11px] font-black text-slate-400"
                  >
                    No phone
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

function RecommendSheet({
  member,
  products,
  profile,
  onClose,
}: {
  member: Member;
  products: Product[];
  profile: GymProfile;
  onClose: () => void;
}) {
  return (
    <Sheet title={`Recommend to ${member.full_name}`} onClose={onClose}>
      <p className="mb-3 px-1 text-[11px] font-medium text-slate-500">
        Opens WhatsApp with the product and your tracked link. Your commission is never included.
      </p>

      <div className="space-y-3">
        {products.map((product) => {
          const href = buildWhatsAppLink(
            member.phone,
            buildRecommendationMessage(member, product, profile),
          );

          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-black text-slate-900">{product.title}</span>
                <span className="shrink-0 text-sm font-black text-slate-900">
                  {formatCurrency(product.price)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {product.category}
                </span>
                <span className="text-[11px] font-bold text-emerald-600">
                  You earn {formatCurrency(commissionPerSale(product))}
                </span>
              </div>
            </>
          );

          if (!href) {
            return (
              <div
                key={product.id}
                title="No valid phone number on file"
                className="rounded-2xl border border-slate-200 bg-slate-100 p-3 opacity-60"
              >
                {body}
              </div>
            );
          }

          return (
            <a
              key={product.id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                recordRecommendation(member.id, product.id);
                onClose();
              }}
              className="block rounded-2xl border border-slate-200 bg-slate-50 p-3 transition active:scale-[0.99]"
            >
              {body}
            </a>
          );
        })}
      </div>
    </Sheet>
  );
}

function ProductSheet({
  editing,
  onClose,
  onSave,
}: {
  editing: Product | null;
  onClose: () => void;
  onSave: (input: ProductInput, editingId: string | null) => void;
}) {
  const [form, setForm] = useState<ProductInput>({
    title: editing?.title ?? "",
    category: editing?.category ?? "",
    price: editing ? String(editing.price) : "",
    commission_rate: editing ? String(editing.commission_rate) : "",
    product_url: editing?.product_url ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ProductInput, string>>>({});

  const update = (field: keyof ProductInput) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const preview = Number(form.price) * (Number(form.commission_rate) / 100);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validateProduct(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    onSave(form, editing?.id ?? null);
  };

  return (
    <Sheet title={editing ? "Edit Product" : "Add Product"} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <Field
          placeholder="Product name"
          value={form.title}
          onChange={update("title")}
          error={errors.title}
        />
        <Field
          placeholder="Category, e.g. Supplements"
          value={form.category}
          onChange={update("category")}
          error={errors.category}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            placeholder="Price"
            value={form.price}
            onChange={update("price")}
            error={errors.price}
            inputMode="numeric"
          />
          <Field
            placeholder="Commission %"
            value={form.commission_rate}
            onChange={update("commission_rate")}
            error={errors.commission_rate}
            inputMode="decimal"
          />
        </div>
        <Field
          placeholder="https://store.example.com/product"
          value={form.product_url}
          onChange={update("product_url")}
          error={errors.product_url}
          type="url"
          inputMode="url"
        />

        {Number.isFinite(preview) && preview > 0 && (
          <p className="px-1 text-[11px] font-bold text-emerald-600">
            You earn {formatCurrency(Math.round(preview))} per sale.
          </p>
        )}
        <p className="px-1 text-[11px] font-medium text-slate-500">
          Members see the name, price and link only, never your commission.
        </p>

        <button
          type="submit"
          className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition active:scale-[0.99]"
        >
          {editing ? "Save Changes" : "Add Product"}
        </button>
      </form>
    </Sheet>
  );
}

/**
 * A real anchor rather than `window.open`, so the link survives popup blockers
 * and still supports long-press, copy and assistive tech.
 */
function LinkButton({
  href,
  label,
  full = false,
  disabledHint,
}: {
  href: string | null;
  label: string;
  full?: boolean;
  disabledHint?: string;
}) {
  const base = `rounded-2xl border px-3 py-3 text-center text-xs font-black transition ${
    full ? "block w-full px-4 text-sm" : "flex-1"
  }`;

  if (!href) {
    return (
      <span title={disabledHint} className={`${base} border-slate-200 bg-slate-100 text-slate-400`}>
        {label}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} border-slate-200 bg-slate-50 text-slate-700 active:scale-[0.98]`}
    >
      {label}
    </a>
  );
}

/**
 * What a brand new install opens on. It offers the two real ways to begin -
 * type one member, or bring an existing list over - and puts the sample gym
 * behind the Settings tab rather than pre-filling someone else's members.
 */
function FirstRun({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-5 text-center shadow-sm shadow-slate-200/50">
      <p className="text-base font-black text-slate-900">Set up your gym</p>
      <p className="mx-auto mt-1 max-w-[16rem] text-xs font-medium leading-relaxed text-slate-500">
        Add your members one at a time, or bring your existing register across from a spreadsheet.
      </p>

      <div className="mt-5 space-y-2">
        <button
          type="button"
          onClick={onAdd}
          className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition active:scale-[0.99]"
        >
          Add Your First Member
        </button>
        <button
          type="button"
          onClick={onImport}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 transition active:scale-[0.99]"
        >
          Import From a Spreadsheet
        </button>
      </div>

      <p className="mt-4 text-[11px] font-medium text-slate-400">
        Set your gym name and UPI id in Settings so reminders can collect dues.
      </p>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-[26px] border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center">
      <p className="text-sm font-bold text-slate-700">{title}</p>
      <p className="mt-1 text-xs font-medium text-slate-500">{hint}</p>
    </div>
  );
}

/**
 * Six months of collections. One series, so no legend: the card heading names
 * it. Only the current month is direct-labelled; the rest carry their value in
 * the tooltip and in the container's text alternative.
 *
 * Colour is a single validated step (#1baf7a) against this navy surface, which
 * clears the dark-mode lightness band and 3:1 contrast.
 */
function IncomeChart({ series }: { series: { key: string; label: string; total: number }[] }) {
  const peak = Math.max(...series.map((month) => month.total));
  const current = series[series.length - 1];

  const spoken = series
    .map((month) => `${month.label} ${formatCurrency(month.total)}`)
    .join(", ");

  if (peak === 0) {
    return (
      <p className="mt-3 text-[11px] font-medium text-slate-400">
        No payments recorded yet. Renewals will show up here.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <div
        role="img"
        aria-label={`Money collected over the last six months: ${spoken}`}
        className="flex h-16 items-end gap-[3px]"
      >
        {series.map((month) => {
          const isCurrent = month.key === current.key;
          // Zero months keep a sliver so the month is present, not missing.
          const height = month.total === 0 ? 2 : Math.max(4, (month.total / peak) * 64);

          return (
            <div
              key={month.key}
              title={`${month.label}: ${formatCurrency(month.total)}`}
              style={{ height: `${height}px` }}
              className={`flex-1 rounded-t-[4px] transition-all ${
                isCurrent ? "bg-[#1baf7a]" : "bg-[#1baf7a]/45"
              }`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {series.map((month) => (
          <span
            key={month.key}
            className={`flex-1 text-center text-[9px] font-bold uppercase tracking-wide ${
              month.key === current.key ? "text-slate-200" : "text-slate-500"
            }`}
          >
            {month.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function MetricPill({
  label,
  value,
  tone = "slate",
  onClick,
}: {
  label: string;
  value: string;
  tone?: "slate" | "green" | "amber" | "red";
  onClick?: () => void;
}) {
  const toneClass = {
    slate: "bg-white/10 text-slate-100",
    green: "bg-emerald-500/20 text-emerald-200",
    amber: "bg-amber-500/20 text-amber-200",
    red: "bg-rose-500/20 text-rose-200",
  }[tone];

  const content = `${label}: ${value}`;

  // The counts are the obvious place to tap to see that group.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition active:scale-[0.97] ${toneClass}`}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${toneClass}`}>{content}</span>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold break-words text-slate-800">{value}</p>
    </div>
  );
}

/** Shared sheet shell: one place for Escape, backdrop, focus and scroll lock. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const field = panelRef.current?.querySelector<HTMLElement>("input, textarea, select");
    field?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    // The sheet scrolls on its own; without this the list behind it moves too.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/35 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-10"
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-t-[30px] border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-300/60"
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="mb-4 flex items-center justify-between">
          <h3 id={titleId} className="text-xl font-black text-slate-900">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-700"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MemberSheet({
  editing,
  existing,
  today,
  onClose,
  onSave,
  onDelete,
}: {
  editing: Member | null;
  existing: Member[];
  today: Date | null;
  onClose: () => void;
  onSave: (input: MemberFormInput, base: Member | null) => void;
  onDelete: (memberId: string) => void;
}) {
  const [form, setForm] = useState<MemberFormInput>(() =>
    editing ? memberToForm(editing) : emptyMemberForm(today ?? new Date()),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof MemberFormInput, string>>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const update = (field: keyof MemberFormInput) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validateMemberForm(form, existing, editing?.id ?? null);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    onSave(form, editing);
  };

  return (
    <Sheet title={editing ? "Edit Member" : "Add Member"} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <Field
          placeholder="Full name"
          value={form.full_name}
          onChange={update("full_name")}
          error={errors.full_name}
          autoComplete="name"
        />
        <Field
          placeholder="Phone number"
          value={form.phone}
          onChange={update("phone")}
          error={errors.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
        />
        <Field
          placeholder="Address"
          value={form.address}
          onChange={update("address")}
          autoComplete="street-address"
        />

        <div className="grid grid-cols-2 gap-3">
          <Field
            placeholder="Current weight"
            value={form.current_weight}
            onChange={update("current_weight")}
            error={errors.current_weight}
            inputMode="decimal"
          />
          <Field
            placeholder="Goal weight"
            value={form.target_weight}
            onChange={update("target_weight")}
            error={errors.target_weight}
            inputMode="decimal"
          />
        </div>

        <Field
          placeholder="Monthly fee"
          value={form.monthly_fee}
          onChange={update("monthly_fee")}
          error={errors.monthly_fee}
          inputMode="numeric"
        />

        <div>
          <label className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Membership valid until
          </label>
          <Field
            type="date"
            value={form.valid_until}
            onChange={update("valid_until")}
            error={errors.valid_until}
          />
        </div>

        <p className="px-1 text-[11px] font-medium text-slate-500">
          Weights and phone can be left blank. Plans are assigned from the member card.
        </p>

        <button
          type="submit"
          className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition active:scale-[0.99]"
        >
          {editing ? "Save Changes" : "Save Member"}
        </button>
      </form>

      {editing && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => (confirmingDelete ? onDelete(editing.id) : setConfirmingDelete(true))}
            onBlur={() => confirmingDelete && setConfirmingDelete(false)}
            className={`w-full rounded-2xl border px-4 py-3 text-sm font-black transition active:scale-[0.99] ${
              confirmingDelete
                ? "border-rose-500 bg-rose-500 text-white"
                : "border-slate-200 bg-slate-50 text-rose-600"
            }`}
          >
            {confirmingDelete
              ? `Tap again to delete ${editing.full_name}`
              : "Delete Member"}
          </button>
          <p className="mt-2 px-1 text-[11px] font-medium text-slate-400">
            Removes them from your list. Their renewal history goes with them.
          </p>
        </div>
      )}
    </Sheet>
  );
}

function PlanSheet({
  editing,
  existing,
  onClose,
  onSave,
}: {
  editing: TemplatePlan | null;
  existing: TemplatePlan[];
  onClose: () => void;
  onSave: (input: PlanInput, editingId: string | null) => void;
}) {
  const [form, setForm] = useState<PlanInput>({
    title: editing?.title ?? "",
    type: editing?.type ?? "workout",
    content: editing?.content ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof PlanInput, string>>>({});

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validatePlan(form, existing, editing?.id ?? null);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    onSave(form, editing?.id ?? null);
  };

  return (
    <Sheet title={editing ? "Edit Plan" : "Add Plan"} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <Field
          placeholder="Plan name, e.g. Beginner PPL 6-Day"
          value={form.title}
          onChange={(event) => {
            const title = event.target.value;
            setForm((prev) => ({ ...prev, title }));
            setErrors((prev) => (prev.title ? { ...prev, title: undefined } : prev));
          }}
          error={errors.title}
        />

        <div className="grid grid-cols-2 gap-3">
          {(["workout", "nutrition"] as PlanType[]).map((type) => {
            const active = form.type === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => setForm((prev) => ({ ...prev, type }))}
                className={`rounded-2xl border px-3 py-3 text-sm font-black capitalize transition active:scale-[0.98] ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {type}
              </button>
            );
          })}
        </div>

        <div>
          <textarea
            value={form.content}
            onChange={(event) => {
              const content = event.target.value;
              setForm((prev) => ({ ...prev, content }));
              setErrors((prev) => (prev.content ? { ...prev, content: undefined } : prev));
            }}
            rows={8}
            aria-label="Plan details"
            aria-invalid={Boolean(errors.content)}
            placeholder={"Day 1: Push\nDay 2: Pull\nDay 3: Legs"}
            className={`w-full resize-y rounded-2xl border bg-slate-50 px-3 py-3 text-sm leading-relaxed outline-none ${
              errors.content ? "border-rose-400" : "border-slate-200"
            }`}
          />
          {errors.content && (
            <p className="mt-1 px-1 text-[11px] font-semibold text-rose-600">{errors.content}</p>
          )}
        </div>

        <p className="px-1 text-[11px] font-medium text-slate-500">
          This text is sent to the member on WhatsApp, exactly as written here.
        </p>

        <button
          type="submit"
          className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition active:scale-[0.99]"
        >
          {editing ? "Save Changes" : "Add Plan"}
        </button>
      </form>
    </Sheet>
  );
}

function Field({
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <div>
      <input
        {...props}
        aria-invalid={Boolean(error)}
        className={`w-full rounded-2xl border bg-slate-50 px-3 py-3 text-sm outline-none ${
          error ? "border-rose-400" : "border-slate-200"
        }`}
      />
      {error && <p className="mt-1 px-1 text-[11px] font-semibold text-rose-600">{error}</p>}
    </div>
  );
}
