import { readFileSync } from "node:fs";
import path from "node:path";

export type Kind = "numeric" | "categorical" | "binary";
export type ColumnMeta = { name: string; label: string; kind: Kind; unit?: string; note?: string };

export const TARGET = "diagnosed_diabetes";

// Hand-written labels; anything not listed is numeric with a title-cased label.
const META: Record<string, Omit<ColumnMeta, "name">> = {
  age: { label: "Age", kind: "numeric", unit: "years" },
  gender: { label: "Gender", kind: "categorical" },
  ethnicity: { label: "Ethnicity", kind: "categorical" },
  education_level: { label: "Education level", kind: "categorical" },
  income_level: { label: "Income level", kind: "categorical" },
  employment_status: { label: "Employment status", kind: "categorical" },
  smoking_status: { label: "Smoking status", kind: "categorical" },
  alcohol_consumption_per_week: { label: "Alcohol (drinks/week)", kind: "numeric", unit: "drinks/wk" },
  physical_activity_minutes_per_week: { label: "Physical activity", kind: "numeric", unit: "min/wk" },
  diet_score: { label: "Diet score", kind: "numeric", note: "0–10, higher is healthier" },
  sleep_hours_per_day: { label: "Sleep", kind: "numeric", unit: "h/day" },
  screen_time_hours_per_day: { label: "Screen time", kind: "numeric", unit: "h/day" },
  family_history_diabetes: { label: "Family history of diabetes", kind: "binary" },
  hypertension_history: { label: "Hypertension history", kind: "binary" },
  cardiovascular_history: { label: "Cardiovascular history", kind: "binary" },
  bmi: { label: "BMI", kind: "numeric", unit: "kg/m²" },
  waist_to_hip_ratio: { label: "Waist-to-hip ratio", kind: "numeric" },
  systolic_bp: { label: "Systolic BP", kind: "numeric", unit: "mmHg" },
  diastolic_bp: { label: "Diastolic BP", kind: "numeric", unit: "mmHg" },
  heart_rate: { label: "Resting heart rate", kind: "numeric", unit: "bpm" },
  cholesterol_total: { label: "Total cholesterol", kind: "numeric", unit: "mg/dL" },
  hdl_cholesterol: { label: "HDL cholesterol", kind: "numeric", unit: "mg/dL" },
  ldl_cholesterol: { label: "LDL cholesterol", kind: "numeric", unit: "mg/dL" },
  triglycerides: { label: "Triglycerides", kind: "numeric", unit: "mg/dL" },
  glucose_fasting: { label: "Fasting glucose", kind: "numeric", unit: "mg/dL", note: "diagnostic marker" },
  glucose_postprandial: { label: "Post-meal glucose", kind: "numeric", unit: "mg/dL", note: "diagnostic marker" },
  insulin_level: { label: "Insulin level", kind: "numeric", unit: "µU/mL" },
  hba1c: { label: "HbA1c", kind: "numeric", unit: "%", note: "diagnostic marker" },
  diabetes_risk_score: { label: "Diabetes risk score", kind: "numeric" },
  diabetes_stage: { label: "Diabetes stage", kind: "categorical", note: "derived outcome" },
  diagnosed_diabetes: { label: "Diagnosed diabetes", kind: "binary", note: "the outcome (1 = yes)" },
};

// Natural orderings for ordinal categories; others are sorted by frequency.
const ORDER: Record<string, string[]> = {
  education_level: ["No formal", "Highschool", "Graduate", "Postgraduate"],
  income_level: ["Low", "Lower-Middle", "Middle", "Upper-Middle", "High"],
  smoking_status: ["Never", "Former", "Current"],
  diabetes_stage: ["No Diabetes", "Pre-Diabetes", "Gestational", "Type 1", "Type 2"],
};

export type Dataset = {
  rows: number;
  columns: ColumnMeta[];
  num: Record<string, Float64Array>; // numeric + binary columns
  cat: Record<string, string[]>; // categorical columns
  categories: Record<string, string[]>;
  loadMs: number;
  invalidCells: number;
};

function load(): Dataset {
  const t0 = performance.now();
  const text = readFileSync(path.join(process.cwd(), "data", "diabetes_dataset.csv"), "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  const columns = header.map((name) => ({ name, ...(META[name] ?? { label: name, kind: "numeric" as Kind }) }));
  const n = lines.length - 1;
  const num: Dataset["num"] = {};
  const cat: Dataset["cat"] = {};
  for (const c of columns) c.kind === "categorical" ? (cat[c.name] = new Array(n)) : (num[c.name] = new Float64Array(n));
  let invalidCells = 0;
  for (let i = 0; i < n; i++) {
    const cells = lines[i + 1].split(",");
    for (let j = 0; j < columns.length; j++) {
      const c = columns[j];
      if (c.kind === "categorical") cat[c.name][i] = cells[j];
      else {
        const v = Number(cells[j]);
        if (cells[j] === "" || Number.isNaN(v)) invalidCells++;
        num[c.name][i] = cells[j] === "" ? NaN : v;
      }
    }
  }
  const categories: Dataset["categories"] = {};
  for (const name of Object.keys(cat)) {
    const counts = new Map<string, number>();
    for (const v of cat[name]) counts.set(v, (counts.get(v) ?? 0) + 1);
    const order = ORDER[name] ?? [];
    categories[name] = [...counts.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return counts.get(b)! - counts.get(a)!;
    });
  }
  return { rows: n, columns, num, cat, categories, loadMs: Math.round(performance.now() - t0), invalidCells };
}

// Loaded once per server process and shared by every route.
let cached: Dataset | undefined;
export function getDataset(): Dataset {
  return (cached ??= load());
}

export function getColumn(name: string): ColumnMeta | undefined {
  return getDataset().columns.find((c) => c.name === name);
}
