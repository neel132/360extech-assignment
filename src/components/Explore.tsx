"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ColumnMeta } from "@/lib/data";
import type { profileColumn } from "@/lib/analytics";

type Profile = ReturnType<typeof profileColumn>;

const GROUPS: [string, string[]][] = [
  [
    "Demographics",
    [
      "age",
      "gender",
      "ethnicity",
      "education_level",
      "income_level",
      "employment_status",
    ],
  ],
  [
    "Lifestyle",
    [
      "smoking_status",
      "alcohol_consumption_per_week",
      "physical_activity_minutes_per_week",
      "diet_score",
      "sleep_hours_per_day",
      "screen_time_hours_per_day",
    ],
  ],
  [
    "Medical history",
    [
      "family_history_diabetes",
      "hypertension_history",
      "cardiovascular_history",
    ],
  ],
  [
    "Body & vitals",
    ["bmi", "waist_to_hip_ratio", "systolic_bp", "diastolic_bp", "heart_rate"],
  ],
  [
    "Lab results",
    [
      "cholesterol_total",
      "hdl_cholesterol",
      "ldl_cholesterol",
      "triglycerides",
      "glucose_fasting",
      "glucose_postprandial",
      "insulin_level",
      "hba1c",
    ],
  ],
  ["Outcomes", ["diabetes_risk_score", "diabetes_stage", "diagnosed_diabetes"]],
];

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const num = (v: number) =>
  Math.abs(v) >= 100
    ? v.toFixed(0)
    : Math.abs(v) >= 10
      ? v.toFixed(1)
      : v.toFixed(2);
const axis = {
  stroke: "var(--muted)",
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: "var(--line)" },
};
const tooltipStyle = {
  contentStyle: {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--ink)",
  },
};

export default function Explore() {
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [selected, setSelected] = useState("bmi");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/column")
      .then((r) => r.json())
      .then((d) => setColumns(d.columns))
      .catch(() => setError("Could not load columns"));
  }, []);

  useEffect(() => {
    setError(null);
    fetch(`/api/column?name=${encodeURIComponent(selected)}`)
      .then(async (r) =>
        r.ok ? setProfile(await r.json()) : setError((await r.json()).error),
      )
      .catch(() => setError("Could not load column"));
  }, [selected]);

  const meta = Object.fromEntries(columns.map((c) => [c.name, c]));

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <aside className="rounded-xl border border-line bg-panel p-2 md:max-h-[calc(100vh-140px)] md:overflow-y-auto">
        <label className="block md:hidden">
          <span className="sr-only">Column</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded-md border border-line bg-panel p-2 text-sm"
          >
            {GROUPS.map(([g, cols]) => (
              <optgroup key={g} label={g}>
                {cols.map((c) => (
                  <option key={c} value={c}>
                    {meta[c]?.label ?? c}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="hidden md:block">
          {GROUPS.map(([g, cols]) => (
            <div key={g} className="mb-2">
              <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                {g}
              </div>
              {cols.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelected(c)}
                  aria-current={selected === c}
                  className={`block w-full rounded-md px-2 py-1 text-left text-sm ${selected === c ? "bg-bg font-medium text-ink" : "text-ink-2 hover:bg-bg"}`}
                >
                  {meta[c]?.label ?? c}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        {error && (
          <div className="rounded-xl border border-bad/40 bg-panel p-4 text-sm text-bad">
            {error}
          </div>
        )}
        {profile && profile.column.name === selected && (
          <ColumnView p={profile} />
        )}
        {!profile && !error && (
          <div className="h-96 animate-pulse rounded-xl border border-line bg-panel" />
        )}
      </section>
    </div>
  );
}

function ColumnView({ p }: { p: Profile }) {
  const c = p.column;
  const isTarget = c.name === "diagnosed_diabetes";
  return (
    <>
      <div className="rounded-xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold">{c.label}</h2>
          <code className="text-xs text-muted">{c.name}</code>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
            {c.kind}
            {c.unit ? ` · ${c.unit}` : ""}
          </span>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
          {p.insights.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-s2">
                ●
              </span>
              {s}
            </li>
          ))}
        </ul>
      </div>

      {"summary" in p && p.summary && p.histogram ? (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(
              [
                ["Mean", p.summary.mean],
                ["Median", p.summary.median],
                ["Std dev", p.summary.std],
                ["Min", p.summary.min],
                ["Max", p.summary.max],
              ] as const
            ).map(([k, v]) => (
              <Stat key={k} label={k} value={num(v)} />
            ))}
            <Stat label="Missing" value={p.summary.missing.toLocaleString()} />
          </div>
          <Card
            title="Distribution"
            subtitle="Number of people per bin (p0.5–p99.5 range)"
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={p.histogram}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                barCategoryGap={2}
              >
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis
                  dataKey="label"
                  {...axis}
                  interval="preserveStartEnd"
                  minTickGap={24}
                  tickFormatter={(l: string) => l.split("–")[0]}
                />
                <YAxis
                  {...axis}
                  width={48}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${v / 1000}k` : String(v)
                  }
                />
                <Tooltip
                  {...tooltipStyle}
                  cursor={{ fill: "var(--line)", opacity: 0.4 }}
                  formatter={(v) => [Number(v).toLocaleString(), "People"]}
                />
                <Bar
                  dataKey="count"
                  fill="var(--s1)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          {!isTarget && (
            <Card
              title="Diabetes rate across the range"
              subtitle={`Share diagnosed in each bin · dashed line = overall ${pct(p.overallRate)}`}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={p.histogram.filter((b) => b.count >= 30)}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis
                    dataKey="label"
                    {...axis}
                    interval="preserveStartEnd"
                    minTickGap={24}
                    tickFormatter={(l: string) => l.split("–")[0]}
                  />
                  <YAxis
                    {...axis}
                    width={48}
                    domain={[0, 1]}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                  />
                  <ReferenceLine
                    y={p.overallRate}
                    stroke="var(--muted)"
                    strokeDasharray="4 4"
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v) => [pct(Number(v)), "Diagnosed"]}
                  />
                  <Line
                    isAnimationActive={false}
                    dataKey="rate"
                    stroke="var(--s2)"
                    strokeWidth={2}
                    dot={{
                      r: 3,
                      fill: "var(--s2)",
                      stroke: "var(--panel)",
                      strokeWidth: 2,
                    }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-xs text-muted">
                Bins with fewer than 30 people are hidden to avoid noisy rates.
              </p>
            </Card>
          )}
          {p.related && p.related.length > 0 && (
            <Card
              title="Most correlated columns"
              subtitle="Pearson r with other numeric columns"
            >
              <ul className="divide-y divide-line text-sm">
                {p.related.map((r) => (
                  <li
                    key={r.column}
                    className="flex items-center justify-between py-1.5"
                  >
                    <code className="text-ink-2">{r.column}</code>
                    <span className="tabular-nums">{r.r?.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : "categories" in p && p.categories ? (
        <Card
          title="Breakdown"
          subtitle={
            isTarget
              ? "People per value"
              : `People per value and the share diagnosed with diabetes (overall ${pct(p.overallRate)})`
          }
        >
          <div className="space-y-3">
            {p.categories.map((cat) => (
              <div
                key={cat.label}
                className="grid grid-cols-[minmax(90px,140px)_1fr] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[140px_1fr_1fr]"
              >
                <div className="font-medium">{cat.label}</div>
                <Meter
                  value={cat.share}
                  color="var(--s1)"
                  text={`${cat.count.toLocaleString()} · ${pct(cat.share)}`}
                />
                {cat.rate !== null && (
                  <div className="col-start-2 sm:col-start-3">
                    <Meter
                      value={cat.rate}
                      color="var(--s2)"
                      text={`${pct(cat.rate)} diagnosed`}
                      marker={p.overallRate}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-3 rounded-sm bg-s1" />
              Share of people
            </span>
            {!isTarget && (
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-3 rounded-sm bg-s2" />
                Diabetes rate (tick = overall)
              </span>
            )}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function Meter({
  value,
  color,
  text,
  marker,
}: {
  value: number;
  color: string;
  text: string;
  marker?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-2 flex-1 rounded-full bg-bg"
        role="img"
        aria-label={text}
      >
        <div
          className="h-2 rounded-full"
          style={{ width: `${Math.max(1, value * 100)}%`, background: color }}
        />
        {marker !== undefined && (
          <div
            className="absolute -top-1 h-4 w-0.5 bg-ink-2"
            style={{ left: `${marker * 100}%` }}
          />
        )}
      </div>
      <span className="w-36 shrink-0 text-xs tabular-nums text-ink-2">
        {text}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="mb-3 text-xs text-muted">{subtitle}</p>}
      {children}
    </div>
  );
}
