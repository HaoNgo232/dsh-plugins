# DSH Plugins

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), kept in one repo.

## Plugins

| Plugin | What it does |
| --- | --- |
| [`agy-dispatch`](plugins/agy-dispatch) | Registers `agy_dispatch`: runs a self-contained task through the Antigravity `agy` CLI (print mode), lets agy browse, run commands, edit files and produce images, and returns its final answer plus the agy conversation id. |

## Layout

```
plugins/
  <name>/              an installable dsh bundle
    package.json       dsh.bundle.patch + exports (runtime, locale, icon)
    cordis.patch.yml   the Loader row(s) the bundle inserts
    index.js           Host plugin (plain ESM, no build step)
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
