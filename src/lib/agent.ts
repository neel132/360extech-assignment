import { ToolLoopAgent, tool, isStepCount } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { getDataset } from "./data.ts";
import { runQuery, correlations } from "./analytics.ts";

export const MODEL = process.env.CHAT_MODEL ?? "claude-opus-5-5";

function schemaText() {
  const ds = getDataset();
  return ds.columns
    .map((c) => {
      let detail: string;
      if (c.kind === "categorical") detail = `values: ${ds.categories[c.name].join(" | ")}`;
      else if (c.kind === "binary") detail = "0 = no, 1 = yes";
      else {
        const col = ds.num[c.name];
        let lo = Infinity, hi = -Infinity;
        for (const v of col) { if (v < lo) lo = v; if (v > hi) hi = v; }
        detail = `range ${lo}–${hi}`;
      }
      return `- ${c.name} (${c.kind}${c.unit ? `, ${c.unit}` : ""}): ${c.label}; ${detail}${c.note ? `; ${c.note}` : ""}`;
    })
    .join("\n");
}

const filterSchema = z.object({
  column: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "between"]),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).describe("Scalar, array for `in`, or [min, max] for inclusive `between`"),
});

export const tools = {
  query_data: tool({
    description:
      "Filter, group and aggregate the diabetes dataset (100k rows). Returns one row per group with the requested metrics plus `count`. " +
      "The mean of a 0/1 column (e.g. diagnosed_diabetes) is a rate. Numeric groupBy columns are auto-binned into quintiles unless you pass `bins` (ascending edges).",
    inputSchema: z.object({
      filters: z.array(filterSchema).optional(),
      groupBy: z.array(z.object({ column: z.string(), bins: z.array(z.number()).optional() })).max(3).optional(),
      metrics: z.array(z.object({ fn: z.enum(["count", "mean", "median", "min", "max", "sum", "std"]), column: z.string().optional() })).optional()
        .describe("Defaults to count. Every fn except count needs a numeric/binary column."),
      sortBy: z.string().optional().describe("A group column or metric name like 'mean(bmi)'"),
      descending: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (spec) => runQuery(spec),
  }),
  correlate: tool({
    description: "Pearson correlation of every numeric/binary column (or the listed ones) with a target column, sorted by strength. Optional filters restrict the rows.",
    inputSchema: z.object({
      target: z.string().default("diagnosed_diabetes"),
      columns: z.array(z.string()).optional(),
      filters: z.array(filterSchema).optional(),
    }),
    execute: async ({ target, columns, filters }) => correlations(target, columns, filters).slice(0, 15),
  }),
};

type Settings = ConstructorParameters<typeof ToolLoopAgent<never, typeof tools>>[0];

export function createAgent(callbacks: Pick<Settings, "onEnd" | "onToolExecutionEnd">, model: Settings["model"] = anthropic(MODEL)) {
  return new ToolLoopAgent({
    model,
    instructions: `You are a data analyst answering questions about a diabetes health indicators dataset (Kaggle, ${getDataset().rows.toLocaleString()} people, one row each).
Columns:
${schemaText()}

How to answer:
- Always get numbers from the tools; never guess or rely on outside statistics. Make several tool calls if needed.
- Lead with the direct answer in one or two sentences, then a compact markdown table or bullets with the key numbers. Report rates as percentages with one decimal and mention group sizes when they are small (<500).
- Correlation is not causation; say so when a user implies cause. HbA1c, glucose, diabetes_stage and diabetes_risk_score are diagnostic or derived from the outcome, so point that out when they "predict" diabetes.
- The data looks synthetic (very clean, 60% diagnosed rate), so don't generalise findings to real populations without that caveat.
- If a question can't be answered from these columns, say which columns exist that come closest.
- This is not medical advice; for personal health questions, suggest talking to a clinician.`,
    tools,
    stopWhen: isStepCount(10),
    ...callbacks,
  });
}
