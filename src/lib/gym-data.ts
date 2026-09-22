export type PlanType = "workout" | "nutrition";

export type MemberStatus = "active" | "due-soon" | "overdue";

export type Member = {
  id: string;
  full_name: string;
  phone: string;
  address: string;
  joined_date: string;
  // Nullable: a member imported from a paper register has no weight on file,
  // and 0 kg would be a lie rather than a blank.
  current_weight: number | null;
  target_weight: number | null;
  monthly_fee: number;
  is_active: boolean;
  valid_until: string;
  // Plans are referenced by id, mirroring `member_plans`, so renaming a plan in
  // the library does not orphan everyone assigned to it.
  workout_plan_id: string | null;
  nutrition_plan_id: string | null;
};

/** The gym itself, mirroring the `gyms` table. Appears in member-facing copy. */
export type GymProfile = {
  gym_name: string;
  owner_name: string;
  phone: string;
  email: string;
  /** Where members are told to send money. Empty until the owner sets it. */
  upi_id: string;
};

export const seedProfile: GymProfile = {
  gym_name: "Iron House Fitness",
  owner_name: "",
  phone: "",
  email: "",
  // Deliberately blank: a placeholder here would tell real members to pay a
  // stranger. Reminders leave payment details out until this is filled in.
  upi_id: "",
};

export type Product = {
  id: string;
  title: string;
  category: string;
  price: number;
  /** Percent of the sale price the owner keeps. Never shown to members. */
  commission_rate: number;
  product_url: string;
  is_active: boolean;
};

/**
 * One collection of money, mirroring the `payments` table. Renewals append a
 * row rather than only moving `valid_until`, so there is a record that money
 * came in, a month's revenue can be totalled, and a mis-tapped renewal can be
 * undone.
 */
export type Payment = {
  id: string;
  member_id: string;
  amount: number;
  payment_date: string;
  valid_from: string;
  valid_until: string;
  /** Previous expiry, so undoing a renewal restores exactly what was there. */
  previous_valid_until: string;
  payment_mode: "cash" | "upi" | "other";
};

/** Local stand-in for `affiliate_clicks` until there is a backend to post to. */
export type Recommendation = {
  id: string;
  member_id: string;
  product_id: string;
  sent_at: string;
};

export type TemplatePlan = {
  id: string;
  title: string;
  type: PlanType;
  content: string;
};

export const templatePlans: TemplatePlan[] = [
  {
    id: "tpl-w1",
    title: "Beginner PPL 6-Day",
    type: "workout",
    content:
      "Day 1: Push - Bench, OHP, Dips\nDay 2: Pull - Rows, Pulldowns, Curls\nDay 3: Legs - Squat, RDL, Calves\nDay 4: Upper\nDay 5: Lower\nDay 6: Conditioning\nDay 7: Rest",
  },
  {
    id: "tpl-w2",
    title: "Upper/Lower",
    type: "workout",
    content:
      "Upper A: Bench, Rows, OHP, Curls\nLower A: Squat, Romanian Deadlift, Lunges\nUpper B: Incline Press, Pullups, Lateral Raises\nLower B: Deadlift, Leg Press, Calves",
  },
  {
    id: "tpl-w3",
    title: "Powerlifting Base",
    type: "workout",
    content:
      "Day 1: Squat 5x5 + accessories\nDay 2: Bench 5x5 + triceps\nDay 3: Deadlift 3x5 + back\nDay 4: Overhead Press 5x5\nKeep 2 reps in reserve on every top set.",
  },
  {
    id: "tpl-w4",
    title: "Strength Hybrid",
    type: "workout",
    content:
      "Day 1: Full body strength\nDay 2: Zone 2 cardio 40 min\nDay 3: Upper hypertrophy\nDay 4: Intervals 8x400m\nDay 5: Lower hypertrophy\nWeekend: Active recovery walk",
  },
  {
    id: "tpl-n1",
    title: "High Protein Cut 2000 kcal",
    type: "nutrition",
    content:
      "- 2000 kcal total\n- 180g protein\n- 2.5L water\n- 2 big meals + 2 snacks\n- Lean proteins and greens at every meal\n- No liquid calories",
  },
  {
    id: "tpl-n2",
    title: "Lean Bulk 2600 kcal",
    type: "nutrition",
    content:
      "- 2600 kcal total\n- 180g protein\n- 220g carbs\n- 60g healthy fats\n- 1 post-workout shake\n- Carbs weighted around training",
  },
  {
    id: "tpl-n3",
    title: "Muscle Gain 2800 kcal",
    type: "nutrition",
    content:
      "- 2800 kcal total\n- 200g protein\n- 300g carbs\n- 3L water\n- 4 meals + 1 bedtime casein\n- Creatine 5g daily",
  },
  {
    id: "tpl-n4",
    title: "Protein Sustain 2200 kcal",
    type: "nutrition",
    content:
      "- 2200 kcal total\n- 150g protein\n- 2.5L water\n- 3 balanced meals + 1 snack\n- One flexible meal per week",
  },
];

export const memberData: Member[] = [
  {
    id: "m1",
    full_name: "Arjun Patel",
    phone: "+919876543210",
    address: "Powai, Mumbai",
    joined_date: "2026-01-05",
    current_weight: 78,
    target_weight: 72,
    monthly_fee: 1800,
    is_active: true,
    valid_until: "2026-09-30",
    workout_plan_id: "tpl-w1",
    nutrition_plan_id: "tpl-n1",
  },
  {
    id: "m2",
    full_name: "Riya Sharma",
    phone: "+919220112233",
    address: "Andheri East, Mumbai",
    joined_date: "2026-07-19",
    current_weight: 61,
    target_weight: 56,
    monthly_fee: 2200,
    is_active: true,
    valid_until: "2026-09-25",
    workout_plan_id: "tpl-w2",
    nutrition_plan_id: "tpl-n2",
  },
  {
    id: "m3",
    full_name: "Kabir Singh",
    phone: "+919900776655",
    address: "Bandra West, Mumbai",
    joined_date: "2026-05-03",
    current_weight: 86,
    target_weight: 80,
    monthly_fee: 2500,
    is_active: true,
    valid_until: "2026-09-10",
    workout_plan_id: "tpl-w3",
    nutrition_plan_id: "tpl-n3",
  },
  {
    id: "m4",
    full_name: "Neha Verma",
    phone: "+918899001122",
    address: "Khar, Mumbai",
    joined_date: "2026-08-02",
    current_weight: 68,
    target_weight: 60,
    monthly_fee: 2000,
    is_active: true,
    valid_until: "2026-10-05",
    workout_plan_id: "tpl-w4",
    nutrition_plan_id: "tpl-n4",
  },
  {
    id: "m5",
    full_name: "Sana Qureshi",
    phone: "+919867452310",
    address: "Chembur, Mumbai",
    joined_date: "2026-02-14",
    current_weight: 64,
    target_weight: 58,
    monthly_fee: 2000,
    is_active: true,
    valid_until: "2026-10-12",
    workout_plan_id: "tpl-w1",
    nutrition_plan_id: "tpl-n1",
  },
  {
    id: "m6",
    full_name: "Rohan Iyer",
    phone: "+919833120945",
    address: "Goregaon West, Mumbai",
    joined_date: "2025-11-08",
    current_weight: 92,
    target_weight: 82,
    monthly_fee: 2500,
    is_active: true,
    valid_until: "2026-08-15",
    workout_plan_id: "tpl-w3",
    nutrition_plan_id: "tpl-n3",
  },
  {
    id: "m7",
    full_name: "Priya Menon",
    phone: "+919920887431",
    address: "Malad East, Mumbai",
    joined_date: "2026-06-21",
    current_weight: 58,
    target_weight: 54,
    monthly_fee: 1800,
    is_active: true,
    valid_until: "2026-09-23",
    workout_plan_id: "tpl-w2",
    nutrition_plan_id: "tpl-n4",
  },
  {
    id: "m8",
    full_name: "Aditya Kulkarni",
    phone: "+919845003217",
    address: "Vile Parle East, Mumbai",
    joined_date: "2026-03-30",
    current_weight: 75,
    target_weight: 70,
    monthly_fee: 2200,
    is_active: true,
    valid_until: "2026-11-02",
    workout_plan_id: "tpl-w4",
    nutrition_plan_id: "tpl-n2",
  },
  {
    // Joined last month, nothing set up yet: exercises the "Not set" and
    // "Not assigned" states a real new sign-up starts in.
    id: "m9",
    full_name: "Fatima Shaikh",
    phone: "+919702556188",
    address: "Borivali West, Mumbai",
    joined_date: "2026-08-11",
    current_weight: null,
    target_weight: null,
    monthly_fee: 1500,
    is_active: true,
    valid_until: "2026-09-24",
    workout_plan_id: null,
    nutrition_plan_id: null,
  },
  {
    id: "m10",
    full_name: "Vikas Rane",
    phone: "+919869334702",
    address: "Dadar East, Mumbai",
    joined_date: "2025-09-02",
    current_weight: 88,
    target_weight: 79,
    monthly_fee: 3000,
    is_active: true,
    valid_until: "2026-07-30",
    workout_plan_id: "tpl-w3",
    nutrition_plan_id: "tpl-n3",
  },
  {
    id: "m11",
    full_name: "Ishita Bhattacharya",
    phone: "+919004771265",
    address: "Matunga, Mumbai",
    joined_date: "2026-05-17",
    current_weight: 55,
    target_weight: 52,
    monthly_fee: 2000,
    is_active: true,
    valid_until: "2026-10-28",
    workout_plan_id: "tpl-w2",
    nutrition_plan_id: "tpl-n1",
  },
  {
    id: "m12",
    full_name: "Karan Malhotra",
    phone: "+919930418856",
    address: "Kandivali West, Mumbai",
    joined_date: "2026-01-23",
    current_weight: 81,
    target_weight: 74,
    monthly_fee: 2400,
    is_active: true,
    valid_until: "2026-12-01",
    workout_plan_id: "tpl-w1",
    nutrition_plan_id: "tpl-n2",
  },
  {
    id: "m13",
    full_name: "Divya Pillai",
    phone: "+919820664319",
    address: "Lower Parel, Mumbai",
    joined_date: "2026-07-05",
    current_weight: 67,
    target_weight: 60,
    monthly_fee: 2600,
    is_active: true,
    valid_until: "2026-09-18",
    workout_plan_id: "tpl-w4",
    nutrition_plan_id: "tpl-n4",
  },
  {
    // Workout assigned but no nutrition plan yet: a half-set-up member.
    id: "m14",
    full_name: "Sameer Ansari",
    phone: "+919167290544",
    address: "Mulund West, Mumbai",
    joined_date: "2026-09-01",
    current_weight: null,
    target_weight: null,
    monthly_fee: 1700,
    is_active: true,
    valid_until: "2026-10-18",
    workout_plan_id: "tpl-w1",
    nutrition_plan_id: null,
  },
];

export const affiliateProducts: Product[] = [
  {
    id: "p1",
    title: "Whey Protein Concentrate",
    category: "Supplements",
    price: 2499,
    commission_rate: 12,
    product_url: "https://example.com/protein",
    is_active: true,
  },
  {
    id: "p2",
    title: "Fitness Tracker Pro",
    category: "Wearables",
    price: 3999,
    commission_rate: 9,
    product_url: "https://example.com/tracker",
    is_active: true,
  },
  {
    id: "p3",
    title: "Creatine Monohydrate",
    category: "Supplements",
    price: 1899,
    commission_rate: 14,
    product_url: "https://example.com/creatine",
    is_active: true,
  },
  {
    id: "p4",
    title: "Gym Bag Essentials Kit",
    category: "Accessories",
    price: 1299,
    commission_rate: 8,
    product_url: "https://example.com/bag-kit",
    is_active: true,
  },
];
