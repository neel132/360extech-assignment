// Run: npm run selftest — sanity checks for the data layer and query engine against known dataset counts.
import assert from "node:assert/strict";
import { runQuery, correlations, profileColumn, cohort } from "../src/lib/analytics.ts";
import { getDataset } from "../src/lib/data.ts";

const ds = getDataset();
assert.equal(ds.rows, 100000);
assert.equal(ds.columns.length, 31);
assert.equal(ds.invalidCells, 0);

// counts known from `cut | sort | uniq -c` on the raw CSV
const byGender = runQuery({ groupBy: [{ column: "gender" }] });
assert.equal(byGender.groups.find((g) => g.gender === "Male")?.count, 47771);
assert.equal(byGender.groups.reduce((s, g) => s + Number(g.count), 0), 100000);
assert.equal(runQuery({ filters: [{ column: "gender", op: "eq", value: "Male" }] }).matchedRows, 47771);
assert.equal(runQuery({ metrics: [{ fn: "mean", column: "diagnosed_diabetes" }] }).groups[0]["mean(diagnosed_diabetes)"], 0.6);

// ordinal categories come back in natural order
const smoke = runQuery({ groupBy: [{ column: "smoking_status" }] }).groups.map((g) => g.smoking_status);
assert.deepEqual(smoke, ["Never", "Former", "Current"]);

// numeric binning: explicit edges partition all rows, in ascending order
const bmi = runQuery({ groupBy: [{ column: "bmi", bins: [25, 30] }], metrics: [{ fn: "mean", column: "diagnosed_diabetes" }] });
assert.equal(bmi.groups.length, 3);
assert.equal(bmi.groups[0].bmi, "< 25");
assert.equal(bmi.groups.reduce((s, g) => s + Number(g.count), 0), 100000);

// between is inclusive and composes with other filters
const n = runQuery({ filters: [{ column: "age", op: "between", value: [40, 49] }, { column: "smoking_status", op: "in", value: ["Current"] }] }).matchedRows;
let manual = 0;
for (let i = 0; i < ds.rows; i++) if (ds.num.age[i] >= 40 && ds.num.age[i] <= 49 && ds.cat.smoking_status[i] === "Current") manual++;
assert.equal(n, manual);

// bad input produces a helpful error the model can recover from
assert.throws(() => runQuery({ groupBy: [{ column: "bogus" }] }), /Unknown column "bogus"/);
assert.throws(() => runQuery({ filters: [{ column: "gender", op: "eq", value: "male" }] }), /Valid: /);
assert.throws(() => runQuery({ metrics: [{ fn: "mean", column: "gender" }] }), /categorical/);

const corr = correlations("diagnosed_diabetes");
assert.ok(corr[0].r !== null && Math.abs(corr[0].r) <= 1);

const p = profileColumn("bmi");
assert.ok("histogram" in p && p.histogram!.reduce((s, b) => s + b.count, 0) === 100000);
const pc = profileColumn("income_level");
assert.ok("categories" in pc && pc.categories![0].label === "Low");

const t0 = performance.now();
const c = cohort({ age: 50, gender: "Male", bmi: 31, physical_activity_minutes_per_week: 60, diet_score: 5, sleep_hours_per_day: 6, screen_time_hours_per_day: 6, alcohol_consumption_per_week: 4, smoking_status: "Current", family_history_diabetes: 1, hypertension_history: 0 });
assert.equal(c.cohort.size, 1000);
assert.ok(c.cohort.rate >= 0 && c.cohort.rate <= 1 && c.levers.length > 0);

console.log("selftest ok", { loadMs: ds.loadMs, cohortMs: Math.round(performance.now() - t0), topCorr: corr.slice(0, 5), cohortRate: c.cohort.rate, levers: c.levers });
