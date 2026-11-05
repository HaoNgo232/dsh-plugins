# Session Cost

Source: <https://github.com/HaoNgo232/dsh-plugins/tree/main/plugins/session-cost>

A DSH bundle with two halves:

- a **Host** plugin that registers the `session_cost` tool and a `sessionCost`
  session projection (the live numbers), and
- a **Client** plugin that renders the live cost badge in the composer status
  row.

It folds the current session log and reports token usage plus estimated USD
cost at three levels:

- **session** — one total for the whole session
- **per task (turn)** — each user prompt/turn, with a preview of the prompt
- **per request** — every model call, with model, tokens, and cost

## Live badge

The composer status row (`conversation.composer.dock`) gets a `≈$0.513` button
next to the shipped `usage` entry. Clicking it opens a panel with:

- session total, request count, tokens, cache-hit rate
- cost by model
- the five most recent tasks with their cost
- OpenCode Go usage windows (5-hour / weekly / monthly, all sessions)
- this month's per-model spend against the Go monthly limit, with a bar

The badge is driven by the `sessionCost` projection, so it updates from the
session log as turns run instead of re-scanning files. It stays hidden until
the session has made at least one priced request.

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
| `debug` | boolean | Appends the live `sessionCost` projection value and the registered client bundle path; also refreshes the served client bundle when its bytes changed. |

The tool returns the full session totals, per-model totals, per-turn rows, and
the newest request rows, plus OpenCode Go plan windows (`5h`, `week`, `month`)
folded over every session log on the machine (subagents excluded). It reports
the current session for the per-level numbers.

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
- The monthly limit is the published Go allowance per model
  (`deepseek-v4.1-flash` = $100), not the live allowance on your account;
  treat the bar as a planning estimate.

## Install

```
plugin_manager action=install_bundle target=<absolute path to plugins/session-cost>
```
