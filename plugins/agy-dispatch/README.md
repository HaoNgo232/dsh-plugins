# AGY Dispatch

Source: <https://github.com/HaoNgo232/dsh-plugins/tree/main/plugins/agy-dispatch>

A DSH Host bundle that registers the `agy_dispatch` tool. The tool runs one
self-contained task through the Antigravity `agy` CLI in non-interactive print
mode and returns agy's answer plus its conversation id.

## Requirements

- `agy` on `PATH` (or set `command` to its full path).
- A signed-in Antigravity CLI. `agy --version` is a safe check; `agy --print`
  performs a real turn.

## Tool

`agy_dispatch`

| Parameter | Type | Notes |
| --- | --- | --- |
| `task` | string, required | Self-contained prompt. agy cannot see this conversation. |
| `model` | string | e.g. `gemini-3.8-flash-high`, `claude-sonnet-4-6`. See `agy models`. |
| `agent` | string | `agy --agent`. |
| `effort` | `low` \| `medium` \| `high` \| `xhigh` \| `max` | |
| `mode` | `accept-edits` \| `auto` \| `plan` | |
| `cwd` | string | Defaults to the session working directory. |
| `add_dirs` | string[] | Repeatable `--add-dir`. |
| `continue` | boolean | Continue agy's latest conversation. |
| `conversation` | string | Resume a specific agy conversation id. |
| `skip_permissions` | boolean | Adds `--dangerously-skip-permissions`. |
| `timeout_ms` | number | Local kill timeout. Default `600000`. |

The call blocks until agy exits. Output is parsed from `agy --print ...
--output-format json`; a plain-text answer is accepted as a fallback for older
agy versions. Non-`SUCCESS` status, a non-zero exit, a timeout, or an abort is
reported as a tool error.

## Config

Edit the entry in the profile's `cordis.patch.yml` (or in this bundle's patch
before installing):

```yaml
- insert:
    - id: agy-dispatch
      name: '@local/agy-dispatch'
      config:
        command: agy              # path to the binary
        defaultModel: gemini-3.8-flash-high
        defaultEffort: medium
        timeoutMs: 600000
        skipPermissions: false
        addDirs: []
```

## Install

From the workspace root:

```
plugin_manager action=install_bundle target=<absolute path to this directory>
```
