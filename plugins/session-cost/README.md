# Session Cost

Source: <https://github.com/HaoNgo232/dsh-plugins/tree/main/plugins/session-cost>

A DSH Host bundle that registers the `session_cost` tool. It folds the current
session log and reports token usage plus estimated USD cost at three levels:

- **session** — one total for the whole session
- **per task (turn)** — each user prompt/turn, with a preview of the prompt
- **per request** — every model call, with model, tokens, and cost

## How the numbers are derived

- Tokens come from the durable `assistant/message` events (`usage` field:
  input, output, cache read, cache write) and the model/provider recorded in
  the same event's `source`.
- Cost = tokens × price per model, where prices are per 1M tokens from the
  OpenCode Go price table (<https://opencode.ai/v2/docs/console/go/>).
- DeepSeek V4.1 Flash / V4 Pro use their peak/off-peak prices. Peak is
  **01:00–04:00 and 06:00–10:00 UTC, Monday–Friday**; everything else is
  off-peak. The event timestamp decides the band.
- Tiered models (MiniMax M3, Qwen3.7 Plus, Grok 4.7, GPT Luna, Claude Haiku)
  pick a tier from the request's context size (input + cache tokens).
- Models without a price entry are reported with tokens and no cost
  (`unpriced_models`), never silently guessed.

## Tool parameters

| Parameter | Type | Notes |
| --- | --- | --- |
| `detail` | `summary` \| `turns` \| `requests` \| `all` | How much to render. Default `all`. |
| `requests_limit` | number | Newest request rows to render. Default 40. |

The tool returns the full session totals, per-model totals, per-turn rows, and
the newest request rows. It reports the current session only.

## Config

Override or add prices without touching code. A key replaces the whole entry
for that model id:

```yaml
- insert:
    - id: session-cost
      name: '@local/session-cost'
      config:
        prices:
          deepseek-v4.1-flash:
            peak: { input: 0.30, output: 1.20, cacheRead: 0.006 }
            offPeak: { input: 0.15, output: 0.60, cacheRead: 0.003 }
          my-custom-model: { input: 1, output: 3, cacheRead: 0.1 }
```

An entry is one of:

- `{ input, output, cacheRead, cacheWrite }` — flat prices per 1M tokens
- `{ peak: {...}, offPeak: {...} }` — time-banded prices (DeepSeek)
- `{ tiers: [{ upTo: 262144, ...prices }, { ...prices }] }` — context tiers
- `{ free: true }` — always zero

## Notes and limits

- **Estimates, not billing.** The provider may report a different number
  (rounding, routing, discounts). OpenCode Go includes an `opencode.allowance`
  field per response, which this plugin does not read.
- The session log's `assistant/message` events carry the usage this plugin
  folds; aborted requests with no `usage` contribute nothing.
- Subagent sessions are separate logs and are not included.
- The current plan's monthly allowance (Go / Go Plus / Go Teams) is not
  modelled; only API-equivalent cost is.

## Install

```
plugin_manager action=install_bundle target=<absolute path to plugins/session-cost>
```
