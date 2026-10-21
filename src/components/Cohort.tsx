"use client";

import { useEffect, useState } from "react";
import type { cohort, Profile } from "@/lib/analytics";
import { Card } from "./Explore";

type Result = ReturnType<typeof cohort>;

const DEFAULT: Profile = {
  age: 45,
  gender: "Female",
  bmi: 27,
  physical_activity_minutes_per_week: 90,
  diet_score: 5.5,
  sleep_hours_per_day: 6.5,
  screen_time_hours_per_day: 6,
  alcohol_consumption_per_week: 2,
  smoking_status: "Never",
  family_history_diabetes: 0,
  hypertension_history: 0,
};

const SLIDERS: {
  key: keyof Profile;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}[] = [
  { key: "age", label: "Age", min: 18, max: 90, step: 1 },
  { key: "bmi", label: "BMI", min: 15, max: 45, step: 0.5 },
  {
    key: "physical_activity_minutes_per_week",
    label: "Activity",
    min: 0,
    max: 600,
    step: 10,
    unit: "min/wk",
  },
  {
    key: "diet_score",
    label: "Diet quality",
    min: 0,
    max: 10,
    step: 0.5,
    unit: "/10",
  },
  {
    key: "sleep_hours_per_day",
    label: "Sleep",
    min: 3,
    max: 11,
    step: 0.5,
    unit: "h",
  },
  {
    key: "screen_time_hours_per_day",
    label: "Screen time",
    min: 0,
    max: 16,
    step: 0.5,
    unit: "h/day",
  },
  {
    key: "alcohol_consumption_per_week",
    label: "Alcohol",
    min: 0,
    max: 15,
    step: 1,
    unit: "drinks/wk",
  },
];

const STAGES = [
  "No Diabetes",
  "Pre-Diabetes",
  "Gestational",
  "Type 1",
  "Type 2",
];
const STAGE_COLORS = [
  "var(--s1)",
  "var(--s2)",
  "var(--s3)",
  "var(--s4)",
  "var(--s5)",
];
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const pts = (v: number) =>
  `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} pts`;

export default function Cohort() {
  const [p, setP] = useState<Profile>(DEFAULT);
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/cohort", {
          method: "POST",
          body: JSON.stringify(p),
          signal: ctl.signal,
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setRes(body);
        setError(null);
      } catch (e) {
        if (!ctl.signal.aborted)
          setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 350); // debounce slider drags
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [p]);

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) =>
    setP((x) => ({ ...x, [k]: v }));

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <div className="rounded-xl border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold">Describe yourself (or anyone)</h2>
        <p className="mb-4 text-xs text-muted">
          We find the 1,000 people in the dataset most similar to this profile.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Gender"
              value={p.gender}
              options={["Female", "Male", "Other"]}
              onChange={(v) => set("gender", v)}
            />
            <Select
              label="Smoking"
              value={p.smoking_status}
              options={["Never", "Former", "Current"]}
              onChange={(v) => set("smoking_status", v)}
            />
          </div>
          {SLIDERS.map((s) => (
            <label key={s.key} className="block">
              <div className="flex justify-between text-xs">
                <span className="text-ink-2">{s.label}</span>
                <span className="tabular-nums">
                  {p[s.key]} {s.unit}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={p[s.key] as number}
                onChange={(e) => set(s.key, Number(e.target.value) as never)}
                className="w-full accent-[var(--s1)]"
              />
            </label>
          ))}
          <Toggle
            label="Parent or sibling with diabetes"
            checked={!!p.family_history_diabetes}
            onChange={(v) => set("family_history_diabetes", v ? 1 : 0)}
          />
          <Toggle
            label="History of high blood pressure"
            checked={!!p.hypertension_history}
            onChange={(v) => set("hypertension_history", v ? 1 : 0)}
          />
        </div>
      </div>

      <div
        className={`min-w-0 space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}
      >
        {error && (
          <div className="rounded-xl border border-bad/40 bg-panel p-4 text-sm text-bad">
            {error}
          </div>
        )}
        {res ? (
          <Results r={res} />
        ) : (
          <div className="h-96 animate-pulse rounded-xl border border-line bg-panel" />
        )}
        <p className="text-xs text-muted">
          Not medical advice. This compares you with similar people in a (likely
          synthetic) dataset — it shows association, not cause or your personal
          risk. A clinician and a real HbA1c test are the way to know.
        </p>
      </div>
    </div>
  );
}

function Results({ r }: { r: Result }) {
  const diff = r.cohort.rate - r.population.rate;
  const clear = r.levers.filter((l) => l.clear && l.delta < 0);
  return (
    <>
      <div className="rounded-xl border border-line bg-panel p-5">
        <div className="text-xs uppercase tracking-wide text-muted">
          People like you
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="text-4xl font-semibold tabular-nums">
            {pct(r.cohort.rate)}
          </span>
          <span className="text-sm text-ink-2">have diagnosed diabetes</span>
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {Math.abs(diff) < r.noise / 2 ? (
            <>
              About the same as everyone in the dataset (
              {pct(r.population.rate)}).
            </>
          ) : (
            <>
              <span className={diff > 0 ? "text-bad" : "text-good"}>
                {pts(diff)}
              </span>{" "}
              vs. everyone in the dataset ({pct(r.population.rate)}).
            </>
          )}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini
            label="Avg HbA1c"
            value={`${r.cohort.hba1c.toFixed(2)}%`}
            base={`${r.population.hba1c.toFixed(2)}% overall`}
          />
          <Mini
            label="Avg fasting glucose"
            value={`${r.cohort.glucose_fasting.toFixed(0)}`}
            base={`${r.population.glucose_fasting.toFixed(0)} overall`}
          />
          <Mini
            label="Avg age"
            value={r.cohort.age.toFixed(0)}
            base={`${r.population.age.toFixed(0)} overall`}
          />
          <Mini
            label="Avg BMI"
            value={r.cohort.bmi.toFixed(1)}
            base={`${r.population.bmi.toFixed(1)} overall`}
          />
        </div>
      </div>

      <Card
        title="Where your cohort sits"
        subtitle="Diabetes stage among the 1,000 most similar people"
      >
        <div
          className="flex h-4 w-full gap-[2px] overflow-hidden rounded"
          role="img"
          aria-label="Stage breakdown"
        >
          {STAGES.map((s, i) => {
            const share = (r.cohort.stages[s] ?? 0) / r.cohort.size;
            return share > 0 ? (
              <div
                key={s}
                title={`${s}: ${pct(share)}`}
                style={{
                  width: `${share * 100}%`,
                  background: STAGE_COLORS[i],
                }}
              />
            ) : null;
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {STAGES.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <i
                className="inline-block h-2 w-3 rounded-sm"
                style={{ background: STAGE_COLORS[i] }}
              />
              {s}{" "}
              <span className="tabular-nums text-ink">
                {pct((r.cohort.stages[s] ?? 0) / r.cohort.size)}
              </span>
            </span>
          ))}
        </div>
      </Card>

      <Card
        title="What if you changed one thing?"
        subtitle="Diabetes rate among the 1,000 people most like the changed profile. Grey = within sampling noise (±2 standard errors)."
      >
        {r.levers.length === 0 ? (
          <p className="text-sm text-ink-2">
            No lifestyle changes apply to this profile.
          </p>
        ) : (
          <ul className="space-y-2">
            {r.levers.map((l) => (
              <li
                key={l.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm sm:grid-cols-[200px_1fr_90px]"
              >
                <span>{l.label}</span>
                <DeltaBar
                  delta={l.delta}
                  clear={l.clear}
                  max={Math.max(
                    0.05,
                    ...r.levers.map((x) => Math.abs(x.delta)),
                  )}
                />
                <span
                  title={`noise ±${(l.noise * 100).toFixed(1)} pts`}
                  className={`text-right tabular-nums ${!l.clear ? "text-muted" : l.delta < 0 ? "text-good" : "text-bad"}`}
                >
                  {pts(l.delta)}
                  {!l.clear && <span className="sr-only"> (within noise)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          {clear.length
            ? `Clearest lever for this profile: ${clear[0].label.toLowerCase()}.`
            : "None of the single changes moves the rate beyond noise — in this dataset, lifestyle factors are weak signals compared with family history and lab markers."}
        </p>
      </Card>
    </>
  );
}

function DeltaBar({
  delta,
  clear,
  max,
}: {
  delta: number;
  clear: boolean;
  max: number;
}) {
  const w = (Math.abs(delta) / max) * 50;
  const color = !clear
    ? "var(--muted)"
    : delta < 0
      ? "var(--good)"
      : "var(--bad)";
  return (
    <div
      className="relative col-span-2 h-2 rounded-full bg-bg sm:col-span-1"
      aria-hidden
    >
      <div
        className="absolute top-[-3px] h-3.5 w-px bg-ink-2"
        style={{ left: "50%" }}
      />
      <div
        className="absolute h-2 rounded-full"
        style={{
          width: `${w}%`,
          background: color,
          opacity: clear ? 1 : 0.5,
          ...(delta < 0 ? { right: "50%" } : { left: "50%" }),
        }}
      />
    </div>
  );
}

function Mini({
  label,
  value,
  base,
}: {
  label: string;
  value: string;
  base: string;
}) {
  return (
    <div className="rounded-lg bg-bg px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted">{base}</div>
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded-md border border-line bg-bg p-1.5 text-sm"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--s1)]"
      />
      {label}
    </label>
  );
}
