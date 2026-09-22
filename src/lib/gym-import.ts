import type { Member } from "@/lib/gym-data";
import { sanitizePhone, startOfDay, toISODate } from "@/lib/gym-utils";

export type ImportField =
  | "full_name"
  | "phone"
  | "address"
  | "joined_date"
  | "valid_until"
  | "current_weight"
  | "target_weight"
  | "monthly_fee";

export const IMPORT_FIELDS: {
  key: ImportField;
  label: string;
  hint: string;
  kind: "text" | "date" | "number";
}[] = [
  { key: "full_name", label: "Full name", hint: "Required", kind: "text" },
  { key: "phone", label: "Phone", hint: "Needed for WhatsApp", kind: "text" },
  { key: "valid_until", label: "Valid until / expiry", hint: "When membership runs out", kind: "date" },
  { key: "monthly_fee", label: "Monthly fee", hint: "Shown on the Renew button", kind: "number" },
  { key: "joined_date", label: "Joined date", hint: "Optional", kind: "date" },
  { key: "address", label: "Address", hint: "Optional", kind: "text" },
  { key: "current_weight", label: "Current weight", hint: "Optional", kind: "number" },
  { key: "target_weight", label: "Goal weight", hint: "Optional", kind: "number" },
];

export type ImportTable = {
  headers: string[];
  rows: string[][];
  format: "csv" | "json";
};

export type Mapping = Partial<Record<ImportField, number>>;

export type DateOrder = "day-first" | "month-first";

/* -------------------------------------------------------------------------- */
/* file parsing                                                               */
/* -------------------------------------------------------------------------- */

/** Picks the separator by which one yields the most columns on the first line. */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? undefined : text.indexOf("\n"));
  const candidates = [",", ";", "\t", "|"];

  let best = ",";
  let bestCount = 0;

  for (const candidate of candidates) {
    // Counts only separators outside quotes, so "Powai, Mumbai" does not win.
    let count = 0;
    let inQuotes = false;
    for (const char of firstLine) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }

  return best;
}

/**
 * A real CSV reader, not a split on commas: quoted fields may contain the
 * delimiter, newlines, and doubled quotes as an escape.
 */
export function parseDelimited(text: string): ImportTable | null {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!clean.trim()) return null;

  const delimiter = detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === delimiter) {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  rows.push(row);

  const cleaned = rows
    .map((entry) => entry.map((cell) => cell.trim()))
    .filter((entry) => entry.some((cell) => cell.length > 0));

  if (cleaned.length < 2) return null;

  const [headers, ...body] = cleaned;
  const width = headers.length;

  return {
    format: "csv",
    headers: headers.map((header, index) => header || `Column ${index + 1}`),
    // Pads short rows so a trailing empty cell never shifts a column.
    rows: body.map((entry) => Array.from({ length: width }, (_, i) => entry[i] ?? "")),
  };
}

function flatten(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Finds the array of records inside an unknown JSON shape. */
function findRecordArray(value: unknown): Record<string, unknown>[] | null {
  const isRecordArray = (candidate: unknown): candidate is Record<string, unknown>[] =>
    Array.isArray(candidate) &&
    candidate.length > 0 &&
    candidate.every((item) => typeof item === "object" && item !== null && !Array.isArray(item));

  if (isRecordArray(value)) return value;

  if (typeof value === "object" && value !== null) {
    // Walks one level in, so {members:[...]} or {data:{rows:[...]}} both work.
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (isRecordArray(nested)) return nested;
      if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
        for (const deeper of Object.values(nested as Record<string, unknown>)) {
          if (isRecordArray(deeper)) return deeper;
        }
      }
    }
  }

  return null;
}

export function parseJSONTable(text: string): ImportTable | null {
  try {
    const records = findRecordArray(JSON.parse(text));
    if (!records) return null;

    // Union of keys: exports often omit empty fields on some rows.
    const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
    if (headers.length === 0) return null;

    return {
      format: "json",
      headers,
      rows: records.map((record) => headers.map((header) => flatten(record[header]))),
    };
  } catch {
    return null;
  }
}

export function parseImportFile(text: string): ImportTable | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJSONTable(trimmed) ?? parseDelimited(trimmed);
  }

  return parseDelimited(trimmed) ?? parseJSONTable(trimmed);
}

/* -------------------------------------------------------------------------- */
/* column guessing                                                            */
/* -------------------------------------------------------------------------- */

const SYNONYMS: Record<ImportField, string[]> = {
  full_name: ["fullname", "name", "membername", "member", "customername", "clientname", "client"],
  phone: ["phone", "mobile", "mobileno", "phoneno", "contact", "contactno", "whatsapp", "number", "cell"],
  address: ["address", "area", "locality", "city", "location"],
  joined_date: ["joineddate", "joindate", "joiningdate", "doj", "startdate", "membersince", "registrationdate", "joined", "enrolled"],
  valid_until: ["validuntil", "validtill", "expirydate", "expiry", "expires", "expireson", "enddate", "duedate", "nextduedate", "renewaldate", "paiduntil", "membershipend"],
  current_weight: ["currentweight", "weight", "presentweight", "startweight", "weightkg"],
  target_weight: ["targetweight", "goalweight", "desiredweight", "target"],
  monthly_fee: ["monthlyfee", "fee", "fees", "amount", "charges", "price", "plancost", "monthlyamount", "subscriptionfee"],
};

const normalize = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best-effort auto-map. Exact synonym hits win over partial ones. */
export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const taken = new Set<number>();
  const normalized = headers.map(normalize);

  for (const pass of ["exact", "partial"] as const) {
    for (const field of Object.keys(SYNONYMS) as ImportField[]) {
      if (mapping[field] !== undefined) continue;

      const index = normalized.findIndex((header, i) => {
        if (taken.has(i) || !header) return false;
        return pass === "exact"
          ? SYNONYMS[field].includes(header)
          : SYNONYMS[field].some((word) => header.includes(word));
      });

      if (index !== -1) {
        mapping[field] = index;
        taken.add(index);
      }
    }
  }

  return mapping;
}

/* -------------------------------------------------------------------------- */
/* value parsing                                                              */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function buildISO(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return toISODate(date);
}

/**
 * Handles the shapes a gym export actually contains: ISO, slash/dot/dash
 * numerics, "5 Oct 2026", and Excel's day-serial numbers.
 *
 * `order` decides 05/10/2026 — there is no way to know from the value alone,
 * which is exactly why the owner is shown a preview before anything is written.
 */
export function parseFlexibleDate(raw: string, order: DateOrder): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (iso) return buildISO(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const named = /^(\d{1,2})[\s-]+([a-zA-Z]{3,9})[\s-]+(\d{2,4})$/.exec(value);
  if (named) {
    const month = MONTHS[named[2].toLowerCase().slice(0, 4)] ?? MONTHS[named[2].toLowerCase().slice(0, 3)];
    if (month) return buildISO(expandYear(Number(named[3])), month, Number(named[1]));
  }

  const reverseNamed = /^([a-zA-Z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{2,4})$/.exec(value);
  if (reverseNamed) {
    const month = MONTHS[reverseNamed[1].toLowerCase().slice(0, 4)] ?? MONTHS[reverseNamed[1].toLowerCase().slice(0, 3)];
    if (month) return buildISO(expandYear(Number(reverseNamed[3])), month, Number(reverseNamed[2]));
  }

  const numeric = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(value);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = expandYear(Number(numeric[3]));

    // A component above 12 can only be the day, whatever the chosen order.
    if (first > 12) return buildISO(year, second, first);
    if (second > 12) return buildISO(year, first, second);

    return order === "day-first" ? buildISO(year, second, first) : buildISO(year, first, second);
  }

  // Excel stores dates as days since 1899-12-30.
  if (/^\d{5}$/.test(value)) {
    const serial = Number(value);
    if (serial > 20000 && serial < 60000) {
      const base = new Date(1899, 11, 30);
      base.setDate(base.getDate() + serial);
      return toISODate(base);
    }
  }

  return null;
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

/** True when every numeric date in the column is ambiguous either way. */
export function detectDateOrder(values: string[]): { order: DateOrder; certain: boolean } {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;

  for (const value of values) {
    const numeric = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(value.trim());
    if (!numeric) continue;

    if (Number(numeric[1]) > 12) dayFirstEvidence += 1;
    if (Number(numeric[2]) > 12) monthFirstEvidence += 1;
  }

  if (dayFirstEvidence > 0 && monthFirstEvidence === 0) return { order: "day-first", certain: true };
  if (monthFirstEvidence > 0 && dayFirstEvidence === 0) return { order: "month-first", certain: true };

  // Nothing decisive, or contradictory evidence: default to the Indian
  // convention and make the owner confirm it against the preview.
  return { order: "day-first", certain: false };
}

/**
 * Strips currency symbols, thousands separators and trailing units.
 *
 * Deliberately not a blanket strip of non-digits: "Rs. 1 500" would keep the
 * period from "Rs." and come out as 0.15. Separators are removed only where
 * they sit between two digits, which also handles the Indian 2,00,000 grouping.
 *
 * Negative values are rejected: every field this feeds (weights, fee) is a
 * quantity that cannot be below zero.
 */
export function parseNumber(raw: string): number | null {
  if (!raw) return null;

  const cleaned = raw.replace(/(?<=\d)[,\s](?=\d)/g, "");
  const match = /\d+(?:\.\d+)?/.exec(cleaned);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/* -------------------------------------------------------------------------- */
/* row building                                                               */
/* -------------------------------------------------------------------------- */

export type ImportIssue = "no-name" | "bad-date" | "no-phone" | "duplicate";

export type ImportRow = {
  index: number;
  member: Member | null;
  issues: ImportIssue[];
  raw: string[];
};

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `m-${crypto.randomUUID()}`;
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Turns mapped rows into members. Nothing is invented: an unmapped expiry
 * becomes today, which reads as "Due Soon" rather than quietly granting a
 * month nobody paid for.
 */
export function buildImportRows(
  table: ImportTable,
  mapping: Mapping,
  order: DateOrder,
  existing: Member[],
  today: Date,
): ImportRow[] {
  const existingPhones = new Set(
    existing.map((member) => sanitizePhone(member.phone)).filter((phone) => phone.length >= 10),
  );
  const seenInFile = new Set<string>();
  const todayISO = toISODate(startOfDay(today));

  const cell = (row: string[], field: ImportField) => {
    const index = mapping[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  return table.rows.map((row, index) => {
    const issues: ImportIssue[] = [];

    const name = cell(row, "full_name");
    if (!name) {
      return { index, member: null, issues: ["no-name"], raw: row };
    }

    const rawPhone = cell(row, "phone");
    const phone = sanitizePhone(rawPhone);
    if (phone.length < 10) issues.push("no-phone");

    if (phone.length >= 10) {
      if (existingPhones.has(phone) || seenInFile.has(phone)) issues.push("duplicate");
      seenInFile.add(phone);
    }

    const rawValid = cell(row, "valid_until");
    const validUntil = rawValid ? parseFlexibleDate(rawValid, order) : null;
    if (rawValid && !validUntil) issues.push("bad-date");

    const rawJoined = cell(row, "joined_date");
    const joined = rawJoined ? parseFlexibleDate(rawJoined, order) : null;

    const member: Member = {
      id: createId(),
      full_name: name,
      phone: rawPhone,
      address: cell(row, "address"),
      joined_date: joined ?? todayISO,
      current_weight: parseNumber(cell(row, "current_weight")),
      target_weight: parseNumber(cell(row, "target_weight")),
      monthly_fee: parseNumber(cell(row, "monthly_fee")) ?? 0,
      is_active: true,
      valid_until: validUntil ?? todayISO,
      workout_plan_id: null,
      nutrition_plan_id: null,
    };

    return { index, member, issues, raw: row };
  });
}

export function importableRows(rows: ImportRow[]): ImportRow[] {
  return rows.filter(
    (row) => row.member !== null && !row.issues.includes("duplicate") && !row.issues.includes("bad-date"),
  );
}
