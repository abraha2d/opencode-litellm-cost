import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * opencode plugin: feed real LiteLLM per-token pricing into model cost config.
 * Only implements the `config` hook. Never throws.
 */
export default async function litellmCostPlugin() {
  return {
    config: async (cfg) => {
      try {
        const dataDir =
          process.env.XDG_DATA_HOME ||
          path.join(os.homedir(), ".local", "share");
        const authPath = path.join(dataDir, "opencode", "auth.json");

        if (!fs.existsSync(authPath)) return;

        let auth;
        try {
          auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
        } catch {
          return;
        }

        const updateProvider = async (providerID, providerCfg) => {
          try {
            if (!providerCfg?.options?.baseURL) return;
            if (
              !providerCfg?.models ||
              typeof providerCfg.models !== "object" ||
              Object.keys(providerCfg.models).length === 0
            )
              return;

            const providerAuth = auth?.[providerID];
            if (
              !providerAuth ||
              providerAuth.type !== "api" ||
              typeof providerAuth.key !== "string"
            )
              return;

            const base = providerCfg.options.baseURL.replace(/\/+$/, "");
            const url = base + "/model/info";

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            let res;
            try {
              res = await fetch(url, {
                headers: { Authorization: `Bearer ${providerAuth.key}` },
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timeout);
            }
            if (!res.ok) return;

            const body = await res.json();
            const infoList = Array.isArray(body?.data) ? body.data : [];
            const priceByName = new Map(
              infoList.map((m) => [m.model_name, m.model_info ?? {}]),
            );

            for (const [modelKey, modelCfg] of Object.entries(
              providerCfg.models,
            )) {
              const info = priceByName.get(modelKey);
              if (!info) continue;

              const input = info.input_cost_per_token;
              const output = info.output_cost_per_token;
              if (typeof input !== "number" || typeof output !== "number")
                continue;

              const cost = {
                input: input * 1_000_000,
                output: output * 1_000_000,
              };

              if (typeof info.cache_read_input_token_cost === "number")
                cost.cache_read = info.cache_read_input_token_cost * 1_000_000;
              if (typeof info.cache_creation_input_token_cost === "number")
                cost.cache_write =
                  info.cache_creation_input_token_cost * 1_000_000;

              const over200kInput = info.input_cost_per_token_above_200k_tokens;
              const over200kOutput =
                info.output_cost_per_token_above_200k_tokens;
              if (
                typeof over200kInput === "number" &&
                typeof over200kOutput === "number"
              ) {
                const over = {
                  input: over200kInput * 1_000_000,
                  output: over200kOutput * 1_000_000,
                };
                if (
                  typeof info.cache_read_input_token_cost_above_200k_tokens ===
                  "number"
                )
                  over.cache_read =
                    info.cache_read_input_token_cost_above_200k_tokens *
                    1_000_000;
                if (
                  typeof info.cache_creation_input_token_cost_above_200k_tokens ===
                  "number"
                )
                  over.cache_write =
                    info.cache_creation_input_token_cost_above_200k_tokens *
                    1_000_000;
                cost.context_over_200k = over;
              }

              modelCfg.cost = cost;
            }
          } catch (err) {
            console.error(
              `litellm-cost: provider ${providerID} failed: ${
                err?.name ?? "Error"
              }: ${err?.message ?? String(err)}`,
            );
          }
        };

        await Promise.allSettled(
          Object.entries(cfg.provider ?? {}).map(([providerID, providerCfg]) =>
            updateProvider(providerID, providerCfg),
          ),
        );
      } catch (err) {
        console.error("litellm-cost: config hook failed:", err);
      }
    },
  };
}
