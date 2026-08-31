import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import litellmCostPlugin from "./plugin.js";

let tmpDir;
let originalXdgDataHome;
let originalFetch;
let originalConsoleError;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litellm-cost-test-"));
  originalXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = tmpDir;
  originalFetch = globalThis.fetch;
  originalConsoleError = console.error;
  console.error = () => {};
}

function teardown() {
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdgDataHome;
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeAuth(auth) {
  const dir = path.join(tmpDir, "opencode");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify(auth));
}

function mockFetch(handler) {
  globalThis.fetch = async (url, options) => handler(url, options);
}

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

function baseCfg(models = { "claude-sonnet-5": {} }) {
  return {
    provider: {
      anthropic: {
        options: { baseURL: "https://litellm.example.com" },
        models,
      },
    },
  };
}

test("config: missing auth.json leaves cfg untouched", async () => {
  setup();
  try {
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.equal(
      cfg.provider.anthropic.models["claude-sonnet-5"].cost,
      undefined,
    );
  } finally {
    teardown();
  }
});

test("config: malformed auth.json leaves cfg untouched", async () => {
  setup();
  try {
    fs.mkdirSync(path.join(tmpDir, "opencode"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "opencode", "auth.json"), "{not json");
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.equal(
      cfg.provider.anthropic.models["claude-sonnet-5"].cost,
      undefined,
    );
  } finally {
    teardown();
  }
});

test("config: provider without baseURL is skipped", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    let called = false;
    mockFetch(() => {
      called = true;
      return jsonResponse({ data: [] });
    });
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = {
      provider: {
        anthropic: { options: {}, models: { "claude-sonnet-5": {} } },
      },
    };
    await plugin.config(cfg);
    assert.equal(called, false);
    assert.equal(
      cfg.provider.anthropic.models["claude-sonnet-5"].cost,
      undefined,
    );
  } finally {
    teardown();
  }
});

test("config: provider with no models object is skipped", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    let called = false;
    mockFetch(() => {
      called = true;
      return jsonResponse({ data: [] });
    });
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = {
      provider: {
        anthropic: {
          options: { baseURL: "https://litellm.example.com" },
          models: {},
        },
      },
    };
    await plugin.config(cfg);
    assert.equal(called, false);
  } finally {
    teardown();
  }
});

test("config: provider missing from auth.json is skipped", async () => {
  setup();
  try {
    writeAuth({});
    let called = false;
    mockFetch(() => {
      called = true;
      return jsonResponse({ data: [] });
    });
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.equal(called, false);
  } finally {
    teardown();
  }
});

test("config: auth entry with type !== 'api' is skipped", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "oauth", key: "sk-test" } });
    let called = false;
    mockFetch(() => {
      called = true;
      return jsonResponse({ data: [] });
    });
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.equal(called, false);
  } finally {
    teardown();
  }
});

test("config: auth entry with non-string key is skipped", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: 12345 } });
    let called = false;
    mockFetch(() => {
      called = true;
      return jsonResponse({ data: [] });
    });
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.equal(called, false);
  } finally {
    teardown();
  }
});

test("config: non-ok HTTP response results in no cost assigned", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() => jsonResponse({}, false));
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.equal(
      cfg.provider.anthropic.models["claude-sonnet-5"].cost,
      undefined,
    );
  } finally {
    teardown();
  }
});

test("config: fetch rejection is caught and results in no cost assigned", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await assert.doesNotReject(() => plugin.config(cfg));
    assert.equal(
      cfg.provider.anthropic.models["claude-sonnet-5"].cost,
      undefined,
    );
  } finally {
    teardown();
  }
});

test("config: fetch is called with an AbortSignal (timeout wiring present)", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    let capturedOptions;
    mockFetch((url, options) => {
      capturedOptions = options;
      return jsonResponse({ data: [] });
    });
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    await plugin.config(baseCfg());
    assert.ok(capturedOptions.signal instanceof AbortSignal);
  } finally {
    teardown();
  }
});

test("config: unmatched model key is skipped", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "some-other-model",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
            },
          },
        ],
      }),
    );
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.equal(
      cfg.provider.anthropic.models["claude-sonnet-5"].cost,
      undefined,
    );
  } finally {
    teardown();
  }
});

test("config: non-numeric cost fields are skipped", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: "0.000003",
              output_cost_per_token: 0.000015,
            },
          },
        ],
      }),
    );
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.equal(
      cfg.provider.anthropic.models["claude-sonnet-5"].cost,
      undefined,
    );
  } finally {
    teardown();
  }
});

test("config: computes basic input/output cost per million tokens", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
            },
          },
        ],
      }),
    );
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.deepEqual(cfg.provider.anthropic.models["claude-sonnet-5"].cost, {
      input: 3,
      output: 15,
    });
  } finally {
    teardown();
  }
});

test("config: computes cache_read and cache_write costs when present", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
              cache_read_input_token_cost: 0.0000003,
              cache_creation_input_token_cost: 0.00000375,
            },
          },
        ],
      }),
    );
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.deepEqual(cfg.provider.anthropic.models["claude-sonnet-5"].cost, {
      input: 3,
      output: 15,
      cache_read: 0.3,
      cache_write: 3.75,
    });
  } finally {
    teardown();
  }
});

test("config: computes context_over_200k costs when present", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
              input_cost_per_token_above_200k_tokens: 0.000006,
              output_cost_per_token_above_200k_tokens: 0.0000225,
              cache_read_input_token_cost_above_200k_tokens: 0.0000006,
              cache_creation_input_token_cost_above_200k_tokens: 0.0000075,
            },
          },
        ],
      }),
    );
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = baseCfg();
    await plugin.config(cfg);
    assert.deepEqual(cfg.provider.anthropic.models["claude-sonnet-5"].cost, {
      input: 3,
      output: 15,
      context_over_200k: {
        input: 6,
        output: 22.5,
        cache_read: 0.6,
        cache_write: 7.5,
      },
    });
  } finally {
    teardown();
  }
});

test("config: multi-provider isolation - one failing provider does not affect another", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch((url) => {
      if (url.startsWith("https://litellm.example.com")) {
        return jsonResponse({
          data: [
            {
              model_name: "claude-sonnet-5",
              model_info: {
                input_cost_per_token: 0.000003,
                output_cost_per_token: 0.000015,
              },
            },
          ],
        });
      }
      throw new Error("network down");
    });
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    const cfg = {
      provider: {
        anthropic: {
          options: { baseURL: "https://litellm.example.com" },
          models: { "claude-sonnet-5": {} },
        },
        broken: {
          options: { baseURL: "https://broken.example.com" },
          models: { "some-model": {} },
        },
      },
    };
    await assert.doesNotReject(() => plugin.config(cfg));
    assert.deepEqual(cfg.provider.anthropic.models["claude-sonnet-5"].cost, {
      input: 3,
      output: 15,
    });
    assert.equal(cfg.provider.broken.models["some-model"].cost, undefined);
  } finally {
    teardown();
  }
});

test("event: delivers toast with exact formatted message after successful load", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
            },
          },
        ],
      }),
    );
    const toastCalls = [];
    const client = {
      tui: {
        showToast: (args) => {
          toastCalls.push(args);
          return Promise.resolve();
        },
      },
    };
    const plugin = await litellmCostPlugin({ client, directory: "/my/dir" });
    await plugin.config(baseCfg());
    await plugin.event({ event: { type: "some.event" } });
    assert.equal(toastCalls.length, 1);
    assert.deepEqual(toastCalls[0].query, { directory: "/my/dir" });
    assert.equal(toastCalls[0].body.title, "LiteLLM costs loaded");
    assert.equal(
      toastCalls[0].body.message,
      "anthropic/claude-sonnet-5: $3.00/$15.00",
    );
    assert.equal(toastCalls[0].body.variant, "success");
    assert.equal(toastCalls[0].body.duration, 8000);
  } finally {
    teardown();
  }
});

test("event: $0-cost models are omitted from the toast message text", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "free-model",
            model_info: {
              input_cost_per_token: 0,
              output_cost_per_token: 0,
            },
          },
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
            },
          },
        ],
      }),
    );
    const toastCalls = [];
    const client = {
      tui: {
        showToast: (args) => {
          toastCalls.push(args);
          return Promise.resolve();
        },
      },
    };
    const plugin = await litellmCostPlugin({ client, directory: "/tmp" });
    const cfg = baseCfg({
      "free-model": {},
      "claude-sonnet-5": {},
    });
    await plugin.config(cfg);
    await plugin.event({ event: { type: "some.event" } });
    assert.equal(toastCalls.length, 1);
    assert.equal(
      toastCalls[0].body.message,
      "anthropic/claude-sonnet-5: $3.00/$15.00",
    );
    assert.deepEqual(cfg.provider.anthropic.models["free-model"].cost, {
      input: 0,
      output: 0,
    });
  } finally {
    teardown();
  }
});

test("event: a provider whose only loaded model is $0-cost still toasts, with an empty message", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: 0,
              output_cost_per_token: 0,
            },
          },
        ],
      }),
    );
    const toastCalls = [];
    const client = {
      tui: {
        showToast: (args) => {
          toastCalls.push(args);
          return Promise.resolve();
        },
      },
    };
    const plugin = await litellmCostPlugin({ client, directory: "/tmp" });
    await plugin.config(baseCfg());
    await plugin.event({ event: { type: "some.event" } });
    assert.equal(toastCalls.length, 1);
    assert.equal(toastCalls[0].body.message, "");
  } finally {
    teardown();
  }
});

test("event: does not deliver a toast when no providers loaded", async () => {
  setup();
  try {
    const toastCalls = [];
    const client = {
      tui: {
        showToast: (args) => {
          toastCalls.push(args);
          return Promise.resolve();
        },
      },
    };
    const plugin = await litellmCostPlugin({ client, directory: "/tmp" });
    await plugin.config(baseCfg());
    await plugin.event({ event: { type: "some.event" } });
    assert.equal(toastCalls.length, 0);
  } finally {
    teardown();
  }
});

test("event: delivers the pending toast only once", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
            },
          },
        ],
      }),
    );
    const toastCalls = [];
    const client = {
      tui: {
        showToast: (args) => {
          toastCalls.push(args);
          return Promise.resolve();
        },
      },
    };
    const plugin = await litellmCostPlugin({ client, directory: "/tmp" });
    await plugin.config(baseCfg());
    await plugin.event({ event: { type: "first" } });
    await plugin.event({ event: { type: "second" } });
    assert.equal(toastCalls.length, 1);
  } finally {
    teardown();
  }
});

test("event: does not throw when client.tui.showToast is unavailable", async () => {
  setup();
  try {
    writeAuth({ anthropic: { type: "api", key: "sk-test" } });
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            model_name: "claude-sonnet-5",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
            },
          },
        ],
      }),
    );
    const plugin = await litellmCostPlugin({ directory: "/tmp" });
    await plugin.config(baseCfg());
    await assert.doesNotReject(() =>
      plugin.event({ event: { type: "some.event" } }),
    );
  } finally {
    teardown();
  }
});

test("event: does not throw when event has no type", async () => {
  setup();
  try {
    const client = {
      tui: { showToast: () => Promise.resolve() },
    };
    const plugin = await litellmCostPlugin({ client, directory: "/tmp" });
    await assert.doesNotReject(() => plugin.event({ event: {} }));
  } finally {
    teardown();
  }
});
