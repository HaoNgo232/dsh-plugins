# DSH Plugins

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), kept in one repo.

## Plugins

| Plugin | What it does |
| --- | --- |
| [`agy-dispatch`](plugins/agy-dispatch) | Registers `agy_dispatch`: runs a self-contained task through the Antigravity `agy` CLI (print mode), lets agy browse, run commands, edit files and produce images, and returns its final answer plus the agy conversation id. |
| [`session-cost`](plugins/session-cost) | Adds the live `≈$` cost badge to the composer status row (session cost, cost by model, recent tasks, OpenCode Go 5h/week/month windows and month-vs-limit bar), plus the `session_cost` tool for session, per-task (turn), and per-request breakdowns. Prices come from the OpenCode Go table with peak/off-peak and tiered entries. |

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

### From the command line

```sh
./bin/plugin available                   # bundles in this checkout
./bin/plugin list                        # what the desktop profile activates
./bin/plugin --profile desktop add session-cost
./bin/plugin --profile desktop add dshmarket          # any pnpm spec
./bin/plugin --profile desktop add ./plugins/session-cost
./bin/plugin --profile desktop remove session-cost
```

To get a bare `plugin` command, put `bin/plugin.cmd` (Windows) or `bin/plugin`
on `PATH`, or install this repository as a global CLI:

```sh
npm i -g github:HaoNgo232/dsh-plugins
```

What it does that `dsh plugin` does not: `dsh plugin --profile <name> add <pkg>`
only forwards to pnpm inside the profile, so the package lands in `node_modules`
but the profile never activates it. This CLI also appends the package to
`dsh.profile.bundles` in the profile's `package.json`, which is the activation
list, and reports packages without `dsh.bundle.patch` as inactive instead of
pretending they loaded.

Details worth knowing:

- A bare name resolves to `plugins/<name>` in this checkout and installs as a
  `link:`, so editing the bundle takes effect without reinstalling. Set
  `DSH_PLUGINS_DIR` to use a different checkout.
- It prefers the pnpm bundled with the DeepSeek Harness runtime over a global
  pnpm. A profile's `node_modules` pins a pnpm store major version, and another
  pnpm refuses to touch it with `ERR_PNPM_UNEXPECTED_STORE`. Override with
  `DSH_PNPM=<path to pnpm or pnpm.cjs>`.
- Profile resolution: `--profile <name>`, else `$DSH_PROFILE`, else `desktop`.
- Restart the app afterwards to load the new bundle; the in-app Plugin manager
  applies changes without a restart.

### From a dsh session

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
