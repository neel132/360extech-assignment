// Run: npm run agenttest — drives the real agent + tools with a scripted mock model (no API key needed).
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { createAgent } from "../src/lib/agent.ts";

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } };
let call = 0;
const model = new MockLanguageModelV4({
  doGenerate: async () => {
    call++;
    if (call === 1) // a bad column first, to check the model gets a recoverable tool error
      return { content: [{ type: "tool-call", toolCallId: "t1", toolName: "query_data", input: JSON.stringify({ groupBy: [{ column: "BMI" }] }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] };
    if (call === 2)
      return { content: [{ type: "tool-call", toolCallId: "t2", toolName: "query_data", input: JSON.stringify({ groupBy: [{ column: "bmi", bins: [25, 30] }], metrics: [{ fn: "mean", column: "diagnosed_diabetes" }] }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] };
    return { content: [{ type: "text", text: "Rates rise with BMI." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
  },
});

const toolResults: { name: string; type: string }[] = [];
let ended: { steps: number; input: number } | undefined;
const agent = createAgent({
  onToolExecutionEnd: ({ toolCall, toolOutput }) => { toolResults.push({ name: toolCall.toolName, type: toolOutput.type }); },
  onEnd: ({ steps, totalUsage }) => { ended = { steps: steps.length, input: totalUsage.inputTokens ?? 0 }; },
}, model);

const res = await agent.generate({ prompt: "How does diabetes vary by BMI?" });
assert.equal(res.text, "Rates rise with BMI.");
assert.deepEqual(toolResults.map((t) => t.type), ["tool-error", "tool-result"]);
const out = res.steps[1].toolResults[0].output as { groups: { bmi: string; "mean(diagnosed_diabetes)": number }[] };
assert.equal(out.groups.length, 3);
assert.ok(ended && ended.steps === 3 && ended.input === 300);
console.log("agenttest ok", out.groups);
