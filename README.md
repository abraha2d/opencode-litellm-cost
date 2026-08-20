# opencode-litellm-cost

An [opencode](https://opencode.ai) plugin that feeds real [LiteLLM](https://www.litellm.ai/) per-token pricing into opencode's model `cost` config, so cost tracking reflects what your LiteLLM proxy actually charges instead of opencode's built-in defaults.

## What it does

The plugin implements opencode's `config` hook. On config load, for every provider in your opencode config that has:

- an `options.baseURL` pointing at a LiteLLM proxy, and
- a matching entry in opencode's `auth.json` with `"type": "api"`,

it calls that proxy's `/model/info` endpoint, matches models by name against your configured `models` map, and writes `input`/`output`/`cache_read`/`cache_write` costs (and, where available, `context_over_200k` tiered pricing) onto each matching model's `cost` field.

It never throws — any failure (missing auth, unreachable proxy, malformed response) is caught and logged, and config loading continues normally.

## Install

Add the plugin to your `opencode.json`/`opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-litellm-cost"]
}
```

Or, if running from a local checkout, reference the file path directly:

```jsonc
{
  "plugin": ["./plugins/opencode-litellm-cost/plugin.js"]
}
```

## Requirements

- A provider entry with `options.baseURL` set to your LiteLLM proxy base URL.
- An entry for that same provider ID in `~/.local/share/opencode/auth.json` (or `$XDG_DATA_HOME/opencode/auth.json`) with `"type": "api"` and a valid `key`.
- Model keys in your provider's `models` map that match the `model_name` values LiteLLM reports from `/model/info`.

## License

MIT — see [LICENSE](./LICENSE).
