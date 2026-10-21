import { getDataset, getColumn, TARGET, type Dataset } from "./data.ts";

// ---------- small stats helpers ----------
const round = (v: number, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function quantile(sorted: Float64Array | number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function pearson(a: Float64Array, b: Float64Array, idx?: number[]) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const len = idx ? idx.length : a.length;
  for (let k = 0; k < len; k++) {
    const i = idx ? idx[k] : k, x = a[i], y = b[i];
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  const cov = sab - (sa * sb) / n, va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN;
}

function strength(r: number) {
  const a = Math.abs(r);
  return a >= 0.5 ? "strong" : a >= 0.3 ? "moderate" : a >= 0.1 ? "weak" : "negligible";
}

function assertColumn(name: string) {
  const c = getColumn(name);
  if (!c) throw new Error(`Unknown column "${name}". Valid columns: ${getDataset().columns.map((c) => c.name).join(", ")}`);
  return c;
}

// ---------- structured query engine (used by the chat agent) ----------
export type Filter = { column: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "between"; value: string | number | (string | number)[] };
export type GroupBy = { column: string; bins?: number[] };
export type Metric = { fn: "count" | "mean" | "median" | "min" | "max" | "sum" | "std"; column?: string };
export type QuerySpec = { filters?: Filter[]; groupBy?: GroupBy[]; metrics?: Metric[]; sortBy?: string; descending?: boolean; limit?: number };

function valueAt(ds: Dataset, col: string, i: number): string | number {
  return col in ds.cat ? ds.cat[col][i] : ds.num[col][i];
}

function matchFilter(v: string | number, f: Filter) {
  const val = f.value;
  const asNum = (x: unknown) => (typeof v === "number" ? Number(x) : String(x));
  switch (f.op) {
    case "eq": return v === asNum(val);
    case "neq": return v !== asNum(val);
    case "gt": return v > asNum(val);
    case "gte": return v >= asNum(val);
    case "lt": return v < asNum(val);
    case "lte": return v <= asNum(val);
    case "in": return (Array.isArray(val) ? val : [val]).map(asNum).includes(v);
    case "between": {
      if (!Array.isArray(val) || val.length !== 2) throw new Error(`"between" on ${f.column} needs [min, max]`);
      return v >= asNum(val[0]) && v <= asNum(val[1]);
    }
  }
}

export function filterRows(filters: Filter[] = []): number[] {
  const ds = getDataset();
  for (const f of filters) {
    const c = assertColumn(f.column);
    if (c.kind === "categorical") {
      const vals = (Array.isArray(f.value) ? f.value : [f.value]).map(String);
      const bad = vals.filter((v) => !ds.categories[c.name].includes(v));
      if (bad.length && ["eq", "neq", "in"].includes(f.op))
        throw new Error(`Unknown value(s) ${bad.join(", ")} for ${c.name}. Valid: ${ds.categories[c.name].join(", ")}`);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < ds.rows; i++) if (filters.every((f) => matchFilter(valueAt(ds, f.column, i), f))) out.push(i);
  return out;
}

function autoEdges(col: Float64Array, idx: number[]) {
  const vals = Float64Array.from(idx, (i) => col[i]).filter((v) => !Number.isNaN(v)).sort();
  const uniq = new Set(vals);
  if (uniq.size <= 12) return null; // group by exact value
  const edges = [0.2, 0.4, 0.6, 0.8].map((q) => round(quantile(vals, q), 2)!);
  return [...new Set(edges)];
}

function binLabel(v: number, edges: number[]) {
  if (Number.isNaN(v)) return "missing";
  let k = 0;
  while (k < edges.length && v >= edges[k]) k++;
  return k === 0 ? `< ${edges[0]}` : k === edges.length ? `≥ ${edges[k - 1]}` : `${edges[k - 1]} – <${edges[k]}`;
}

function metricValue(m: Metric, idx: number[]) {
  if (m.fn === "count") return idx.length;
  const c = assertColumn(m.column ?? "");
  if (c.kind === "categorical") throw new Error(`${m.fn} needs a numeric column; ${c.name} is categorical (use groupBy + count instead)`);
  const col = getDataset().num[c.name];
  const vals = idx.map((i) => col[i]).filter((v) => !Number.isNaN(v));
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0), mean = sum / vals.length;
  switch (m.fn) {
    case "sum": return round(sum);
    case "mean": return round(mean, 3);
    case "min": return vals.reduce((a, b) => Math.min(a, b));
    case "max": return vals.reduce((a, b) => Math.max(a, b));
    case "median": return round(quantile(vals.sort((a, b) => a - b), 0.5), 3);
    case "std": return round(Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length), 3);
  }
}

export function runQuery(spec: QuerySpec) {
  const ds = getDataset();
  const idx = filterRows(spec.filters);
  const metrics = spec.metrics?.length ? spec.metrics : [{ fn: "count" as const }];
  const name = (m: Metric) => (m.fn === "count" ? "count" : `${m.fn}(${m.column})`);
  const groupBy = spec.groupBy ?? [];
  const keyFns = groupBy.map((g) => {
    const c = assertColumn(g.column);
    if (c.kind === "categorical") return (i: number) => ds.cat[c.name][i];
    const col = ds.num[c.name];
    const edges = g.bins?.length ? [...g.bins].sort((a, b) => a - b) : autoEdges(col, idx);
    return edges ? (i: number) => binLabel(col[i], edges) : (i: number) => String(col[i]);
  });
  const groups = new Map<string, number[]>();
  for (const i of idx) {
    const key = JSON.stringify(keyFns.map((f) => f(i)));
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(i);
  }
  let rows = [...groups.entries()].map(([key, members]) => {
    const keyVals: string[] = JSON.parse(key);
    const row: Record<string, string | number | null> = {};
    groupBy.forEach((g, k) => (row[g.column] = keyVals[k]));
    for (const m of metrics) row[name(m)] = metricValue(m, members);
    if (!metrics.some((m) => m.fn === "count")) row.count = members.length;
    return row;
  });
  const sortKey = spec.sortBy;
  if (sortKey) rows.sort((a, b) => ((a[sortKey] ?? 0) > (b[sortKey] ?? 0) ? 1 : -1) * (spec.descending ? -1 : 1));
  else if (groupBy.length) {
    // keep natural category / bin order
    const c0 = getColumn(groupBy[0].column)!;
    const order = ds.categories[c0.name];
    rows.sort((a, b) => {
      const x = String(a[c0.name]), y = String(b[c0.name]);
      if (order) return order.indexOf(x) - order.indexOf(y);
      const nx = parseFloat(x.replace(/^[<≥]\s*/, "")), ny = parseFloat(y.replace(/^[<≥]\s*/, ""));
      return x.startsWith("<") ? -1 : y.startsWith("<") ? 1 : nx - ny;
    });
  }
  const limit = Math.min(spec.limit ?? 50, 200);
  return { matchedRows: idx.length, totalRows: ds.rows, groups: rows.slice(0, limit), truncated: rows.length > limit };
}

export function correlations(target: string, columns?: string[], filters?: Filter[]) {
  const ds = getDataset();
  const t = assertColumn(target);
  if (t.kind === "categorical") throw new Error(`${target} is categorical; correlations need a numeric or binary column`);
  const idx = filters?.length ? filterRows(filters) : undefined;
  const cols = (columns?.length ? columns.map((c) => assertColumn(c)) : ds.columns).filter((c) => c.kind !== "categorical" && c.name !== target);
  return cols
    .map((c) => ({ column: c.name, r: round(pearson(ds.num[target], ds.num[c.name], idx), 3) }))
    .sort((a, b) => Math.abs(b.r ?? 0) - Math.abs(a.r ?? 0));
}

// ---------- column profile (Explore tab) ----------
export function profileColumn(name: string) {
  const ds = getDataset();
  const c = assertColumn(name);
  const target = ds.num[TARGET];
  const overallRate = mean(target);
  const isTarget = name === TARGET;
  const insights: string[] = [];
  if (c.note) insights.push(`Note: ${c.label} is a ${c.note}.`);

  if (c.kind === "numeric") {
    const col = ds.num[name];
    const sorted = col.filter((v) => !Number.isNaN(v)).sort();
    const missing = ds.rows - sorted.length;
    const m = mean(sorted), sd = Math.sqrt(mean(sorted.map((v) => (v - m) ** 2)));
    const [p25, med, p75] = [0.25, 0.5, 0.75].map((q) => quantile(sorted, q));
    const iqr = p75 - p25;
    const outliers = sorted.filter((v) => v < p25 - 1.5 * iqr || v > p75 + 1.5 * iqr).length;
    // histogram over p0.5–p99.5 so a few extreme values don't flatten the chart
    const lo = quantile(sorted, 0.005), hi = quantile(sorted, 0.995);
    const uniq = new Set(sorted).size;
    const nb = Math.min(24, Math.max(4, uniq));
    const w = (hi - lo) / nb || 1;
    const bins = Array.from({ length: nb }, (_, k) => ({ x0: lo + k * w, x1: lo + (k + 1) * w, count: 0, pos: 0 }));
    for (let i = 0; i < ds.rows; i++) {
      const v = col[i];
      if (Number.isNaN(v)) continue;
      const b = bins[Math.min(nb - 1, Math.max(0, Math.floor((v - lo) / w)))];
      b.count++; b.pos += target[i];
    }
    const r = pearson(col, target);
    const unit = c.unit ? ` ${c.unit}` : "";
    insights.push(`Median is ${fmt(med)}${unit}; the middle 50% of people fall between ${fmt(p25)} and ${fmt(p75)}${unit}.`);
    const skew = sd ? (m - med) / sd : 0;
    if (Math.abs(skew) > 0.1) insights.push(`The distribution is ${skew > 0 ? "right" : "left"}-skewed (mean ${fmt(m)} vs median ${fmt(med)}).`);
    if (outliers / sorted.length > 0.01) insights.push(`${pct(outliers / sorted.length)} of values are outliers (beyond 1.5×IQR).`);
    if (!isTarget) {
      const qEdges = [p25, med, p75];
      const qRates = [0, 1, 2, 3].map((q) => {
        let n = 0, s = 0;
        for (let i = 0; i < ds.rows; i++) {
          const v = col[i];
          if (Number.isNaN(v)) continue;
          const k = v < qEdges[0] ? 0 : v < qEdges[1] ? 1 : v < qEdges[2] ? 2 : 3;
          if (k === q) { n++; s += target[i]; }
        }
        return n ? s / n : NaN;
      });
      insights.push(`Correlation with diagnosed diabetes is ${strength(Math.round(r * 100) / 100)} (r = ${fmt(r, 2)}).`);
      if (Math.abs(qRates[3] - qRates[0]) >= 0.03)
        insights.push(`Diabetes rate ${qRates[3] > qRates[0] ? "rises" : "falls"} from ${pct(qRates[0])} in the lowest quartile to ${pct(qRates[3])} in the highest.`);
      else insights.push(`Diabetes rate barely changes across quartiles (${pct(qRates[0])} → ${pct(qRates[3])}), so this column alone says little about risk.`);
    }
    const related = correlations(name).filter((x) => x.column !== TARGET).slice(0, 3);
    return {
      column: c, overallRate,
      summary: { count: sorted.length, missing, mean: m, std: sd, min: sorted[0], p25, median: med, p75, max: sorted[sorted.length - 1], outliers },
      histogram: bins.map((b) => ({ label: `${fmt(b.x0)}–${fmt(b.x1)}`, x0: b.x0, x1: b.x1, count: b.count, rate: b.count && !isTarget ? b.pos / b.count : null })),
      related, insights,
    };
  }

  // categorical or binary
  const labels = c.kind === "binary" ? ["0", "1"] : ds.categories[name];
  const counts = labels.map((label) => ({ label: c.kind === "binary" ? (label === "1" ? "Yes" : "No") : label, count: 0, pos: 0 }));
  for (let i = 0; i < ds.rows; i++) {
    const k = c.kind === "binary" ? ds.num[name][i] : labels.indexOf(ds.cat[name][i]);
    counts[k].count++; counts[k].pos += target[i];
  }
  const cats = counts.map((x) => ({ label: x.label, count: x.count, share: x.count / ds.rows, rate: isTarget ? null : x.pos / x.count }));
  const top = [...cats].sort((a, b) => b.count - a.count)[0];
  insights.push(`Most common: ${top.label} (${pct(top.share)} of people).`);
  if (!isTarget) {
    const byRate = cats.filter((x) => x.count >= 100).sort((a, b) => b.rate! - a.rate!);
    const hiC = byRate[0], loC = byRate[byRate.length - 1];
    const gap = hiC.rate! - loC.rate!;
    insights.push(
      gap >= 0.03
        ? `Highest diabetes rate: ${hiC.label} at ${pct(hiC.rate!)}, vs ${pct(loC.rate!)} for ${loC.label} (${fmt(gap * 100, 1)} pt gap).`
        : `Diabetes rate is nearly identical across groups (${pct(loC.rate!)}–${pct(hiC.rate!)}), so this column is not a meaningful risk differentiator here.`,
    );
  }
  return { column: c, overallRate, categories: cats, insights };
}

function mean(a: ArrayLike<number>) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (!Number.isNaN(a[i])) { s += a[i]; n++; }
  return s / n;
}
const fmt = (v: number, d?: number) => (d !== undefined ? v.toFixed(d) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// ---------- cohort twin (People Like You tab) ----------
export type Profile = {
  age: number; gender: string; bmi: number; physical_activity_minutes_per_week: number; diet_score: number;
  sleep_hours_per_day: number; screen_time_hours_per_day: number; alcohol_consumption_per_week: number;
  smoking_status: string; family_history_diabetes: number; hypertension_history: number;
};
const COHORT_NUM = ["age", "bmi", "physical_activity_minutes_per_week", "diet_score", "sleep_hours_per_day", "screen_time_hours_per_day", "alcohol_consumption_per_week", "family_history_diabetes", "hypertension_history"] as const;
const SMOKE = { Never: 0, Former: 1, Current: 2 } as Record<string, number>;
export const COHORT_K = 1000;

let scales: Record<string, number> | undefined;
function getScales() {
  const ds = getDataset();
  return (scales ??= Object.fromEntries(COHORT_NUM.map((c) => {
    const m = mean(ds.num[c]);
    return [c, Math.sqrt(mean(Array.from(ds.num[c], (v) => (v - m) ** 2))) || 1];
  })));
}

function nearest(p: Profile, k = COHORT_K) {
  const ds = getDataset(), sc = getScales();
  const d = new Float64Array(ds.rows);
  const smoke = SMOKE[p.smoking_status] ?? 0;
  for (let i = 0; i < ds.rows; i++) {
    let s = 0;
    for (const c of COHORT_NUM) s += ((ds.num[c][i] - p[c]) / sc[c]) ** 2;
    s += ((SMOKE[ds.cat.smoking_status[i]] - smoke) / 0.8) ** 2;
    if (ds.cat.gender[i] !== p.gender) s += 1;
    d[i] = s;
  }
  const order = Array.from({ length: ds.rows }, (_, i) => i).sort((a, b) => d[a] - d[b]);
  return order.slice(0, k);
}

function cohortStats(idx: number[]) {
  const ds = getDataset();
  const avg = (c: string) => idx.reduce((s, i) => s + ds.num[c][i], 0) / idx.length;
  const stage: Record<string, number> = {};
  for (const i of idx) stage[ds.cat.diabetes_stage[i]] = (stage[ds.cat.diabetes_stage[i]] ?? 0) + 1;
  return { rate: avg(TARGET), size: idx.length, hba1c: avg("hba1c"), glucose_fasting: avg("glucose_fasting"), age: avg("age"), bmi: avg("bmi"), stages: stage };
}

// Modifiable levers; each returns a changed profile or null if it doesn't apply.
const LEVERS: { id: string; label: string; apply: (p: Profile) => Profile | null }[] = [
  { id: "activity", label: "+60 min of activity per week", apply: (p) => ({ ...p, physical_activity_minutes_per_week: p.physical_activity_minutes_per_week + 60 }) },
  { id: "bmi", label: "BMI 2 points lower", apply: (p) => (p.bmi > 20 ? { ...p, bmi: p.bmi - 2 } : null) },
  { id: "diet", label: "Diet score +2", apply: (p) => (p.diet_score <= 8 ? { ...p, diet_score: p.diet_score + 2 } : null) },
  { id: "sleep", label: "Sleep 7.5 h/day", apply: (p) => (Math.abs(p.sleep_hours_per_day - 7.5) >= 0.75 ? { ...p, sleep_hours_per_day: 7.5 } : null) },
  { id: "screen", label: "2 h less screen time", apply: (p) => (p.screen_time_hours_per_day >= 3 ? { ...p, screen_time_hours_per_day: p.screen_time_hours_per_day - 2 } : null) },
  { id: "alcohol", label: "Half the alcohol", apply: (p) => (p.alcohol_consumption_per_week >= 2 ? { ...p, alcohol_consumption_per_week: Math.round(p.alcohol_consumption_per_week / 2) } : null) },
  { id: "smoking", label: "Quit smoking", apply: (p) => (p.smoking_status === "Current" ? { ...p, smoking_status: "Former" } : null) },
];

let popStats: ReturnType<typeof cohortStats> | undefined;

export function cohort(p: Profile) {
  const baseIdx = nearest(p);
  const base = cohortStats(baseIdx);
  const inBase = new Set(baseIdx);
  const levers = LEVERS.flatMap((l) => {
    const q = l.apply(p);
    if (!q) return [];
    const idx = nearest(q);
    const rate = cohortStats(idx).rate;
    const delta = rate - base.rate;
    // cohorts overlap, so only swapped-out members add noise: SE(diff) ≈ sqrt(2m·p(1-p)) / k
    const swapped = idx.filter((i) => !inBase.has(i)).length;
    const noise = (2 * Math.sqrt(2 * swapped * base.rate * (1 - base.rate))) / COHORT_K;
    return [{ id: l.id, label: l.label, rate, delta, noise, clear: Math.abs(delta) > noise }];
  }).sort((a, b) => a.delta - b.delta);
  popStats ??= cohortStats(Array.from({ length: getDataset().rows }, (_, i) => i));
  // sampling noise of the cohort rate itself vs the population
  return { population: popStats, cohort: base, levers, noise: 2 * Math.sqrt((base.rate * (1 - base.rate)) / COHORT_K) };
}
