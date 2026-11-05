# @local/auto-compact

Condense a DeepSeek Harness conversation when the live context reaches an
**absolute token budget** — 200 000 by default — instead of waiting for the
shipped engine's window-ratio trigger.

## Why this exists

`@deepseek-ai/dsh-compaction-basic` triggers at

```
floor(min(W × thresholdRatio, W − outputReservation − headroomTokens))
```

with `thresholdRatio = 0.8` and `headroomTokens = 65536`. That is a *fraction of
the model window*: on a 1M-token route the first automatic condensation happens
around 800k, and on a smaller route a fixed 200k budget never fires at all. This
plugin adds the missing policy layer: it prices the request **before each model
step** with `ctx.tokenMeter.measure(session)` and condenses as soon as the
absolute budget is reached.

Nothing is reimplemented beyond *when*:

| Concern | Owner |
| --- | --- |
| Pressure measurement | `ctx.tokenMeter` |
| Span selection, tool-pairing edges, retention | this plugin (mirrors `selectCompactableRange`) |
| Summarization prompt, checkpoint framing | the mounted backend (`compaction-basic`) |
| Durable lock, whole-surface stability, `/compact` | the mounted backend |

The backend is resolved with `ctx.agentPresets.serviceFor(agent, 'compaction')`,
because agent presets mount capability rows (including compaction) inside a
mounted subtree, not in the profile realm.

## Effective threshold

```
effective = min(thresholdTokens, floor(contextWindow × capRatio))
```

`contextWindow` comes from the session's `request/context` event, so a 200k
budget stays exactly 200k on a large-window route and degrades to a safe
fraction on a route that cannot hold it. The configured value, the clamped value
and the current pressure are all reported by the tool.

## Settings page (GUI)

The bundle ships a Client half, so the trigger is configurable without chat or
YAML: **Settings** (sidebar foot) → **Compaction**. The page shows the effective
budget, the model window, live context pressure of the busiest session, and the
trigger/compaction/prune counters; it edits the trigger budget (with presets),
the retained tail, `enabled` and `pruneFirst`, and offers **Compact now** and
**Reset to defaults**.

Transport: the Host half registers three same-origin routes and the page fetches
them — no RPC plumbing in the bundle:

| Route | Method | Meaning |
| --- | --- | --- |
| `/auto-compact/status` | GET | config, defaults, effective budget, per-session pressure, counters, last trigger/compaction |
| `/auto-compact/config` | POST | write the runtime override (`thresholdTokens`, `retainTokens`, `enabled`, `pruneFirst`, or `reset: true`) — validated before it touches disk |
| `/auto-compact/compact` | POST | condense the busiest live session now |

Writes are guarded by a loopback-Host + same-origin check (the same CSRF rule
the harness settings routes apply), and both the page and the `auto_compact`
tool write the same override document, so there is one source of truth.

## Runtime tuning (no restart)

The trigger re-reads `$DSH_HOME/auto-compact.json` at most once per second:

```json
{ "enabled": true, "thresholdTokens": 300000, "retainTokens": 40000 }
```

`$DSH_HOME` defaults to `~/.dsh`. The `auto_compact` tool can write that file for
you (`action: "set"`), and `action: "status"` reports the live state.

## Tool: `auto_compact`

| Action | Meaning |
| --- | --- |
| `status` (default) | configured vs effective budget, context pressure, service availability, trigger/compaction counters, last condensation, override file |
| `set` | write the runtime override: `threshold_tokens`, `retain_tokens`, `enabled`, or `reset: true` to clear |
| `compact` | condense immediately through the mounted backend (same path as `/compact`) |

## Config (bundle row)

```yaml
- insert:
    - id: auto-compact
      name: '@local/auto-compact'
      config:
        thresholdTokens: 200000   # absolute budget
        retainTokens: 30000       # recent tail kept verbatim
        maxAttempts: 2            # condensation rounds per step while over budget
        capRatio: 0.9             # clamp vs the model window
        pruneFirst: true          # trim oversized tool output before summarizing
        enabled: true
        debug: false
```

`retainTokens` must stay below `thresholdTokens`; invalid values fail the row at
load instead of silently misbehaving.

## Behaviour notes

- Runs before request derivation (`agent/pre-step`), so the step sees the
  condensed surface immediately.
- Tool-result pruning (`ctx.compaction-tool-result-pruner`) runs first when the
  session composition exposes it and `pruneFirst` is on: trimming makes no model
  call, so a prune that brings the surface back under the budget skips
  summarization entirely. `auto_compact` reports `prunes` separately from
  `compactions`; set `pruneFirst: false` when you want a summary at the budget
  regardless of how much tool output could be reclaimed.
- A failed attempt is retried at most once per new surface state (`15s`
  cooldown) so a permanently indivisible surface cannot burn a summary call on
  every step.
- The shipped engine keeps its own ratio listener. If its threshold is *lower*
  than yours it wins (it compacts first); the tool reports both budgets, so set
  `thresholdTokens` below the shipped trigger when you want this plugin to own
  the decision.
