#!/usr/bin/env node
/**
 * plugin â€” install plugin bundles from this repository into a DeepSeek Harness
 * profile from the command line.
 *
 * `dsh plugin --profile <name> add <pkg>` already exists, but it only forwards
 * to pnpm inside the profile directory: the package lands in node_modules and
 * the profile never activates it, because activation lives in
 * `dsh.profile.bundles` of the profile's package.json. This CLI performs the
 * pnpm call *and* the activation step, and resolves bare names against
 * `plugins/` in this checkout so a bundle installs as a `link:` and stays live
 * while you edit it.
 *
 *   plugin list
 *   plugin --profile desktop add auto-compact
 *   plugin --profile desktop add auto-compact session-cost
 *   plugin --profile desktop add ./some/local/bundle
 *   plugin --profile desktop add dshmarket            # any pnpm spec
 *   plugin --profile desktop remove auto-compact
 *   plugin --profile desktop install
 *
 * Environment:
 *   DSH_HOME          harness home (default: ~/.dsh)
 *   DSH_PROFILE       default profile name (default: desktop)
 *   DSH_PLUGINS_DIR   directory holding bundles (default: plugins/ next to this CLI)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(cliDir, '..')
const isCheckout = existsSync(join(repoRoot, '.git'))
const pluginDir = process.env.DSH_PLUGINS_DIR ?? (isCheckout ? join(repoRoot, 'plugins') : undefined)

const tty = process.stdout.isTTY === true
const paint = (code) => (text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : String(text))
const red = paint(31)
const green = paint(32)
const yellow = paint(33)
const dim = paint(2)
const bold = paint(1)

function die(message) {
  process.stderr.write(`${red('plugin:')} ${message}\n`)
  process.exit(1)
}

function say(message) {
  process.stdout.write(`${message}\n`)
}

function usage() {
  say(`${bold('plugin')} â€” install DeepSeek Harness plugin bundles into a profile

${bold('Usage')}
  plugin [--profile <name>] list
  plugin [--profile <name>] add <name|path|spec>...
  plugin [--profile <name>] remove <package>...
  plugin [--profile <name>] install

${bold('Profile')}
  --profile <name>   profile under $DSH_HOME/profiles
                     (default: $DSH_PROFILE, else "desktop")

${bold('Targets for add')}
  auto-compact       a bundle from ${pluginDir ?? '<this repository>/plugins'}
  ./my-bundle        a local bundle directory (installed as link:)
  dshmarket          any pnpm spec: registry name, name@version, github:, file:, link:

${bold('Behavior')}
  A target with dsh.bundle.patch in its package.json is installed and appended to
  the profile's dsh.profile.bundles, so it activates on the next start. A target
  without that field is installed as a plain dependency and reported as inactive.
  Short names install as link:, so editing this checkout changes the bundle.`)
}

function parseArgs(argv) {
  let profile = process.env.DSH_PROFILE || 'desktop'
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--profile' || arg === '-p') {
      if (i + 1 >= argv.length) die('--profile needs a name')
      profile = argv[i + 1]
      i += 1
      continue
    }
    if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
      continue
    }
    rest.push(arg)
  }
  return { profile, rest }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function isDirectory(target) {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

/**
 * pnpm candidates in preference order: an explicit override, the pnpm bundled
 * with the DeepSeek Harness runtime, then whatever PATH offers. The bundled one
 * matters because a profile's node_modules pins a pnpm store major version, and
 * a different global pnpm refuses to touch it (ERR_PNPM_UNEXPECTED_STORE).
 */
function pnpmCandidates() {
  const candidates = []
  const override = process.env.DSH_PNPM
  if (override) candidates.push(override)
  const runtimeRoots = []
  if (process.env.DSH_RUNTIME_DIR) runtimeRoots.push(process.env.DSH_RUNTIME_DIR)
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) runtimeRoots.push(join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime'))
    if (process.env.ProgramFiles) runtimeRoots.push(join(process.env.ProgramFiles, 'DeepSeek Harness', 'resources', 'runtime'))
  } else if (process.platform === 'darwin') {
    runtimeRoots.push('/Applications/DeepSeek Harness.app/Contents/Resources/runtime')
  } else {
    runtimeRoots.push('/opt/DeepSeek Harness/resources/runtime')
    runtimeRoots.push(join(homedir(), '.local', 'share', 'deepseek-harness', 'resources', 'runtime'))
  }
  for (const root of runtimeRoots) {
    candidates.push(join(root, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))
  }
  const pathEnv = process.env.PATH || process.env.Path || ''
  const separator = process.platform === 'win32' ? ';' : ':'
  const names = process.platform === 'win32' ? ['pnpm.exe', 'pnpm.cmd', 'pnpm.bat'] : ['pnpm']
  for (const entry of pathEnv.split(separator)) {
    const dir = entry.trim()
    if (dir === '') continue
    for (const name of names) candidates.push(join(dir, name))
  }
  return candidates.filter((candidate) => existsSync(candidate))
}

/** A candidate plus the argv prefix needed to run it (a .cjs runs on node). */
function pnpmInvocation(candidate) {
  return /\.(c?js|mjs)$/i.test(candidate)
    ? { command: process.execPath, args: [candidate], file: candidate }
    : { command: candidate, args: [], file: candidate }
}

function pnpmVersion(invocation) {
  const result = spawnSync(invocation.command, [...invocation.args, '--version'], { encoding: 'utf8' })
  if (result.status !== 0) return undefined
  const major = Number.parseInt(String(result.stdout).trim().split('.')[0], 10)
  return Number.isFinite(major) ? major : undefined
}

/** The store major version a profile's node_modules was installed with. */
function profileStoreMajor(profileDir) {
  const modulesYaml = join(profileDir, 'node_modules', '.modules.yaml')
  if (!existsSync(modulesYaml)) return undefined
  const match = /store[\\/]+v(\d+)/.exec(readFileSync(modulesYaml, 'utf8'))
  return match === null ? undefined : Number.parseInt(match[1], 10)
}

function resolvePnpm(profileDir) {
  const storeMajor = profileStoreMajor(profileDir)
  const scored = []
  for (const candidate of pnpmCandidates()) {
    const invocation = pnpmInvocation(candidate)
    const major = pnpmVersion(invocation)
    if (major !== undefined) scored.push({ ...invocation, major })
  }
  if (scored.length === 0) die('pnpm not found; set DSH_PNPM to a pnpm executable')
  const matching = scored.find((entry) => storeMajor !== undefined && entry.major === storeMajor)
  if (matching !== undefined) return matching
  const newest = scored.sort((left, right) => right.major - left.major)[0]
  if (storeMajor !== undefined) {
    say(`${yellow('warning')} profile node_modules uses pnpm store v${storeMajor} but the available pnpm is v${newest.major}`)
    say(dim('        install pnpm ' + `v${storeMajor}` + ' or set DSH_PNPM to the harness-bundled pnpm.cjs'))
  }
  return newest
}

function runPnpm(pnpm, args, profileDir) {
  return spawnSync(pnpm.command, [...pnpm.args, ...args], { cwd: profileDir, stdio: 'inherit' })
}

function resolveTarget(target) {
  const fromRepo = pluginDir === undefined ? undefined : join(pluginDir, target)
  const local = isDirectory(target) ? resolve(target) : fromRepo !== undefined && isDirectory(fromRepo) ? resolve(fromRepo) : undefined
  if (local === undefined) return { spec: target, name: undefined, local: undefined }
  const manifestPath = join(local, 'package.json')
  if (!existsSync(manifestPath)) die(`${local} has no package.json, so it is not a bundle`)
  const manifest = readJson(manifestPath)
  if (typeof manifest.name !== 'string' || manifest.name === '') die(`${manifestPath} has no package name`)
  return { spec: `link:${local}`, name: manifest.name, local }
}

function installedManifest(profileDir, packageName) {
  const manifestPath = join(profileDir, 'node_modules', packageName, 'package.json')
  return existsSync(manifestPath) ? readJson(manifestPath) : undefined
}

function bundleList(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles
  return Array.isArray(bundles) ? bundles : []
}

function commandList(context) {
  const manifest = readJson(context.manifestPath)
  const bundles = bundleList(manifest)
  const dependencies = manifest.dependencies ?? {}
  say(`${bold(`profile ${context.profile}`)} ${dim(context.profileDir)}`)
  if (bundles.length === 0) {
    say(dim('  no bundles activated in this profile'))
  } else {
    const width = bundles.reduce((max, name) => Math.max(max, name.length), 0)
    for (const name of bundles) {
      const version = installedManifest(context.profileDir, name)?.version
      const spec = dependencies[name]
      const state = version !== undefined
        ? green(`v${version}`)
        : spec === undefined
          ? dim('shipped with dsh')
          : red('missing â€” run plugin install')
      say(`  ${name.padEnd(width)}  ${state}  ${dim(spec ?? '')}`)
    }
  }
  const inactive = Object.keys(dependencies).filter((name) => !bundles.includes(name))
  if (inactive.length > 0) say(dim(`  installed but not activated: ${inactive.join(', ')}`))
}

function commandAdd(context, targets) {
  if (targets.length === 0) die('add needs at least one target; try: plugin add auto-compact')
  const pnpm = resolvePnpm(context.profileDir)
  for (const target of targets) {
    const resolvedTarget = resolveTarget(target)
    const before = Object.keys(readJson(context.manifestPath).dependencies ?? {})
    say(`${dim('pnpm add')} ${resolvedTarget.spec}`)
    const result = runPnpm(pnpm, ['add', resolvedTarget.spec], context.profileDir)
    if (result.status !== 0) die(`pnpm add ${resolvedTarget.spec} failed with exit code ${result.status}`)
    const manifest = readJson(context.manifestPath)
    const dependencies = Object.keys(manifest.dependencies ?? {})
    const packageName = resolvedTarget.name ?? dependencies.find((name) => !before.includes(name))
    if (packageName === undefined) die(`cannot tell which package ${target} installed`)
    const installed = installedManifest(context.profileDir, packageName)
    if (installed === undefined) die(`${packageName} is missing from ${join(context.profileDir, 'node_modules')}`)
    if (installed?.dsh?.bundle?.patch === undefined) {
      say(`${yellow('inactive')} ${packageName}@${installed.version} ${dim('â€” no dsh.bundle.patch in its manifest')}`)
      continue
    }
    const bundles = bundleList(manifest)
    if (bundles.includes(packageName)) {
      say(`${green('ok')} ${packageName}@${installed.version} ${dim('already activated')}`)
      continue
    }
    manifest.dsh ??= {}
    manifest.dsh.profile ??= {}
    manifest.dsh.profile.bundles = [...bundles, packageName]
    writeJson(context.manifestPath, manifest)
    say(`${green('activated')} ${packageName}@${installed.version} ${dim(resolvedTarget.spec)}`)
  }
  say(dim('restart the app to load it (the in-app Plugin manager applies without a restart)'))
}

function commandRemove(context, targets) {
  if (targets.length === 0) die('remove needs at least one package name; try: plugin remove auto-compact')
  const pnpm = resolvePnpm(context.profileDir)
  const before = readJson(context.manifestPath)
  const dependencies = before.dependencies ?? {}
  const names = targets.map((target) => {
    if (dependencies[target] !== undefined) return target
    return Object.keys(dependencies).find((name) => name === target || name.endsWith(`/${target}`)) ?? target
  })
  say(`${dim('pnpm remove')} ${names.join(' ')}`)
  const result = runPnpm(pnpm, ['remove', ...names], context.profileDir)
  if (result.status !== 0) die(`pnpm remove failed with exit code ${result.status}`)
  const after = readJson(context.manifestPath)
  const bundles = bundleList(after)
  const remaining = bundles.filter((name) => !names.includes(name))
  if (remaining.length !== bundles.length) {
    after.dsh.profile.bundles = remaining
    writeJson(context.manifestPath, after)
  }
  for (const name of names) say(`${green('removed')} ${name}`)
  say(dim('restart the app to unload it'))
}

function commandInstall(context) {
  const pnpm = resolvePnpm(context.profileDir)
  say(`${dim('pnpm install')} ${context.profileDir}`)
  const result = runPnpm(pnpm, ['install'], context.profileDir)
  if (result.status !== 0) die(`pnpm install failed with exit code ${result.status}`)
  say(green('dependencies restored'))
}

function commandAvailable() {
  if (pluginDir === undefined) {
    say(dim('no plugins/ directory next to this CLI; set DSH_PLUGINS_DIR to a bundle checkout'))
    return
  }
  if (!isDirectory(pluginDir)) die(`${pluginDir} is not a directory`)
  say(`${bold('bundles in this checkout')} ${dim(pluginDir)}`)
  for (const entry of readdirSync(pluginDir).sort()) {
    const manifestPath = join(pluginDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = readJson(manifestPath)
    const kind = manifest?.dsh?.bundle?.patch === undefined ? dim('(not a bundle)') : ''
    say(`  ${entry.padEnd(20)} ${dim(`${manifest.name ?? '?'}@${manifest.version ?? '?'}`)} ${kind}`)
  }
}

const { profile, rest } = parseArgs(process.argv.slice(2))
if (rest.length === 0) {
  usage()
  process.exit(1)
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)
const manifestPath = join(profileDir, 'package.json')
if (!existsSync(manifestPath)) die(`profile "${profile}" not found at ${profileDir}`)
const context = { profile, profileDir, manifestPath }

const [verb, ...targets] = rest
switch (verb) {
  case 'add':
    commandAdd(context, targets)
    break
  case 'remove':
  case 'rm':
    commandRemove(context, targets)
    break
  case 'list':
  case 'ls':
    commandList(context)
    break
  case 'install':
  case 'sync':
    commandInstall(context)
    break
  case 'available':
  case 'search':
    commandAvailable()
    break
  default:
    die(`unknown command "${verb}"; try list, add, remove, install, available`)
}
