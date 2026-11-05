# DSH Plugins

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), kept in one repo.

## Plugins

| Plugin | What it does |
| --- | --- |
| [`agy-dispatch`](plugins/agy-dispatch) | Registers `agy_dispatch`: runs a self-contained task through the Antigravity `agy` CLI (print mode), lets agy browse, run commands, edit files and produce images, and returns its final answer plus the agy conversation id. |
| [`session-cost`](plugins/session-cost) | Adds the live `≈$` cost badge to the composer status row (session cost, cost by model, recent tasks, OpenCode Go 5h/week/month windows and month-vs-limit bar), plus the `session_cost` tool for session, per-task (turn), and per-request breakdowns. Prices come from the OpenCode Go table with peak/off-peak and tiered entries. |
| [`auto-compact`](plugins/auto-compact) | Compacts the context at an absolute token budget instead of the shipped window ratio (`thresholdTokens`, default `200000`): a pre-step listener measures the session, trims oversized tool output first, and condenses the oldest region until pressure is back under budget. Tune it live with the `auto_compact` tool (`status` / `set` / `compact`), persisted to `$DSH_HOME/auto-compact.json`. |

## Layout

```
plugins/
  <name>/              an installable dsh bundle
    package.json       dsh.bundle.patch + exports (runtime, client, locale, icon)
    cordis.patch.yml   the Loader row(s) the bundle inserts
    index.js           Host plugin (plain ESM, no build step)
    client.js          optional Web UI half (window.__ModuleLoader__ factory)
    locale/*.json      meta.title / meta.description per locale
    icon.svg           plugin icon
    README.md          usage, parameters, config
```

A plugin folder is a complete bundle: no dependencies on `dsh` internals are
needed for Host-only plugins, so every folder stays installable on its own.

## Install a plugin

From a dsh session (this installs into the current profile and activates it):

```
plugin_manager action=install_bundle target=<absolute path to plugins/<name>>
```

Or point `install_bundle` at a Git checkout of this repo. To tune a plugin,
edit its `config` in the profile's `cordis.patch.yml` (see each plugin's README).

## Add a new plugin

1. `plugins/<name>/` with `package.json`, `cordis.patch.yml`, `index.js`,
   `locale/en.json`, `icon.svg`, `README.md`.
2. Give the row a unique `id` and the package a unique name (`@local/<name>`).
3. Run `node --check plugins/<name>/index.js` and validate the JSON files.
4. `install_bundle` it, then verify the capability from a fresh dsh session.

## License

MIT — see [LICENSE](LICENSE). Each plugin keeps its own license file.
