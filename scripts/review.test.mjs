// AI 审核的解析/门禁形状：不调真实模型，mock fetch。
import test from "node:test";
import assert from "node:assert/strict";
import { reviewPackage } from "./review.mjs";

const withFetch = async (reply, run) => {
  const oldKey = process.env.LLM_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.LLM_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: reply } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    return await run();
  } finally {
    if (oldKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = oldKey;
    globalThis.fetch = oldFetch;
  }
};

test("解析 pass / warn / reject", async () => {
  for (const verdict of ["pass", "warn", "reject"]) {
    const result = await withFetch(
      `\`\`\`json\n{"verdict":"${verdict}","risk":"low","reasons":["r"],"summary":"s"}\n\`\`\``,
      () => reviewPackage({ repo: "a/b", ref: "v1", kind: "plugins", manifest: {}, code: "activate" }),
    );
    assert.equal(result.status, verdict);
    assert.equal(result.risk, "low");
    assert.deepEqual(result.reasons, ["r"]);
  }
});

test("未配置 key 时 skipped", async () => {
  const oldKey = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  try {
    const result = await reviewPackage({ repo: "a/b", ref: "v1", kind: "plugins", manifest: {}, code: "" });
    assert.equal(result.status, "skipped");
  } finally {
    if (oldKey !== undefined) process.env.LLM_API_KEY = oldKey;
  }
});

test("模型返回非法 JSON 时 error（扫描器据此不收录）", async () => {
  const result = await withFetch("not json", () =>
    reviewPackage({ repo: "a/b", ref: "v1", kind: "plugins", manifest: {}, code: "" }));
  assert.equal(result.status, "error");
});
