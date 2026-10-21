# Diabetes Insights

A Next.js app over the [Kaggle diabetes health indicators dataset](https://www.kaggle.com/datasets/mohankrishnathalla/diabetes-health-indicators-dataset) (100,000 people, 31 columns, in `data/`).

| Route | What it is |
|---|---|
| `/#explore` | **Explore columns** – pick any column: summary stats, distribution, diabetes rate across its range or per category, auto-generated insights, most-correlated columns. |
| `/#chat` | **Ask the data** – chat with an analyst agent (Vercel AI SDK `ToolLoopAgent` + Claude). It answers by calling `query_data` (filter / group / aggregate) and `correlate` tools over all 100k rows; each tool call is shown and expandable. Thumbs up/down on every answer. |
| `/#cohort` | **People like you** – describe a profile with sliders; we find the 1,000 most similar people (k-nearest neighbours), show their diabetes rate and stage mix vs. everyone, and test single lifestyle changes ("+60 min activity", "BMI −2") with an honest noise band so you can tell signal from chance. |
| `/ops` | **Internal ops dashboard** (24h / 7d / 30d) – pass/warn/fail health checks, chat volume and errors, p50/p95 latency, tokens and LLM cost, thumbs-up rate, tool usage, tab usage, and a "needs review" list of failed and thumbs-down answers. |

## Run

```bash
npm install
echo ANTHROPIC_API_KEY=sk-ant-... > .env.local   # optional: CHAT_MODEL=claude-sonnet-5-5, OPS_PASSWORD=...
npm run dev
```

- `OPS_PASSWORD` set → `/ops` asks for HTTP basic auth (any username).
- `npm run selftest` checks the data layer and query engine against counts from the raw CSV.
- `npm run agenttest` runs the real agent and tools against a scripted mock model (no key needed).

## Notes

- Telemetry is appended to `.data/events.jsonl` (page views, API timings, every chat turn with tokens/steps/tool errors, feedback). That is fine for one server; on Vercel or multiple instances, swap `src/lib/events.ts` for a database.
- The dataset looks synthetic (60% diagnosed, no missing values, lifestyle factors barely move the rate). The app and agent say so instead of overclaiming. HbA1c, glucose, stage and risk score are diagnostic/derived columns and are flagged as such.
