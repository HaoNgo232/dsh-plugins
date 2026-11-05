/**
 * auto-compact — absolute-token auto compaction for DeepSeek Harness sessions.
 *
 * The shipped `@deepseek-ai/dsh-compaction-basic` engine triggers on a WINDOW
 * RATIO: `floor(min(W * thresholdRatio, W - outputReservation - headroom))`,
 * which for a large-window route is far above what a user may want (and for a
 * small-window route never fires at a fixed absolute budget). This plugin adds
 * the missing policy layer: before each model step it prices the live request
 * pressure with `ctx.tokenMeter`, and when that pressure reaches an ABSOLUTE
 * token budget (200000 by default) it condenses the oldest balanced span
 * through the very same engine's `compactRegion()`.
 *
 * Nothing is reimplemented beyond selection: summarization, retention,
 * tool-pairing edges, the durable `compaction/start` … `compaction/end` lock,
 * whole-surface stability checks and the `/compact` command all keep running on
 * the preset's own backend. The engine is reached through
 * `ctx.agentPresets.serviceFor(agent, 'compaction')`, because agent presets
 * mount their capability rows (including compaction) inside a mounted subtree
 * rather than in the profile realm.
 *
 * Threshold resolution:
 *   effective = min(configured thresholdTokens, floor((W - O) * capRatio))
 * so a 200k budget stays 200k on a large-window route and degrades to a
 * safe fraction on a route whose window cannot hold it.
 *
 * Runtime tuning: `$DSH_HOME/auto-compact.json`
 *   { "enabled": true, "thresholdTokens": 200000, "retainTokens": 30000 }
 * is re-read (1s cache) on every step, and the `auto_compact` tool can write it.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'auto-compact'
export const inject = ['tools']

const TOOL_NAME = 'auto_compact'
const OVERRIDE_FILE_NAME = 'auto-compact.json'
const OVERRIDE_CACHE_MS = 1000
const ATTEMPT_COOLDOWN_MS = 15000

const DEFAULT_CONFIG = {
  thresholdTokens: 200000,
  retainTokens: 30000,
  maxAttempts: 2,
  capRatio: 0.9,
  pruneFirst: true,
  enabled: true,
  debug: false,
}

const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string' },
    enabled: { type: 'boolean' },
    threshold_tokens: { type: 'integer' },
    effective_threshold_tokens: { type: 'integer' },
    cap_ratio: { type: 'number' },
    retain_tokens: { type: 'integer' },
    max_attempts: { type: 'integer' },
    prune_first: { type: 'boolean' },
    context_window: { type: 'integer' },
    pressure_tokens: { type: 'integer' },
    pressure_percent: { type: 'number' },
    compaction_service: { type: 'boolean' },
    token_meter_service: { type: 'boolean' },
    pre_step_checks: { type: 'integer' },
    triggers: { type: 'integer' },
    compactions: { type: 'integer' },
    pruned: { type: 'integer' },
    skipped: { type: 'integer' },
    last_trigger: {
      type: 'object',
      additionalProperties: true,
      properties: {},
    },
    last_compaction: {
      type: 'object',
      additionalProperties: true,
      properties: {},
    },
    last_error: { type: 'string' },
    override_path: { type: 'string' },
    override: { type: 'object', additionalProperties: true, properties: {} },
  },
}

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv
  return path.join(homedir(), '.dsh')
}

function overridePath() {
  return path.join(dshHome(), OVERRIDE_FILE_NAME)
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** Validate one raw config object; throw on a value the trigger cannot honor. */
function normalizeConfig(raw, label) {
  const config = { ...DEFAULT_CONFIG }
  if (raw === undefined || raw === null) return config
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`auto-compact: ${label} must be an object`)
  }
  if (raw.thresholdTokens !== undefined) {
    if (!isPositiveInteger(raw.thresholdTokens)) {
      throw new TypeError('auto-compact: thresholdTokens must be a positive integer')
    }
    config.thresholdTokens = raw.thresholdTokens
  }
  if (raw.retainTokens !== undefined) {
    if (!isNonNegativeInteger(raw.retainTokens)) {
      throw new TypeError('auto-compact: retainTokens must be a non-negative integer')
    }
    config.retainTokens = raw.retainTokens
  }
  if (raw.maxAttempts !== undefined) {
    if (!isPositiveInteger(raw.maxAttempts) || raw.maxAttempts > 5) {
      throw new TypeError('auto-compact: maxAttempts must be an integer from 1 to 5')
    }
    config.maxAttempts = raw.maxAttempts
  }
  if (raw.capRatio !== undefined) {
    if (typeof raw.capRatio !== 'number' || !(raw.capRatio > 0) || !(raw.capRatio <= 1)) {
      throw new TypeError('auto-compact: capRatio must be a number in (0, 1]')
    }
    config.capRatio = raw.capRatio
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') throw new TypeError('auto-compact: enabled must be a boolean')
    config.enabled = raw.enabled
  }
  if (raw.pruneFirst !== undefined) {
    if (typeof raw.pruneFirst !== 'boolean') throw new TypeError('auto-compact: pruneFirst must be a boolean')
    config.pruneFirst = raw.pruneFirst
  }
  if (raw.debug !== undefined) {
    if (typeof raw.debug !== 'boolean') throw new TypeError('auto-compact: debug must be a boolean')
    config.debug = raw.debug
  }
  if (config.retainTokens >= config.thresholdTokens) {
    throw new TypeError('auto-compact: retainTokens must stay below thresholdTokens')
  }
  return config
}

let overrideCache = { at: 0, value: null, error: undefined, path: '' }

/** Read (at most once per second) the runtime override document. */
function readOverride() {
  const now = Date.now()
  const file = overridePath()
  if (overrideCache.at !== 0 && overrideCache.path === file && now - overrideCache.at < OVERRIDE_CACHE_MS) {
    return overrideCache
  }
  const loaded = { at: now, value: null, error: undefined, path: file }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    loaded.value = normalizeConfig(parsed, `override ${file}`)
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      loaded.error = error instanceof Error ? error.message : String(error)
    }
  }
  overrideCache = loaded
  return loaded
}

/** Merge the static row config with the live override document. */
function currentConfig(config) {
  const override = readOverride()
  if (override.value === null) return { config, override }
  const merged = { ...config, ...override.value }
  if (merged.retainTokens >= merged.thresholdTokens) {
    merged.retainTokens = Math.max(0, Math.floor(merged.thresholdTokens * 0.15))
  }
  return { config: merged, override }
}

function serviceFor(ctx, agent, serviceName) {
  const presets = ctx.get('agentPresets')
  if (presets !== undefined) {
    try {
      const fromPreset = presets.serviceFor(agent, serviceName)
      if (fromPreset !== undefined && fromPreset !== null) return fromPreset
    } catch {
      /* preset membership is best effort: fall back to the profile realm below */
    }
  }
  try {
    const fromAgent = agent.ctx?.get?.(serviceName)
    if (fromAgent !== undefined && fromAgent !== null) return fromAgent
  } catch {
    /* ignore */
  }
  try {
    return ctx.get(serviceName) ?? undefined
  } catch {
    return undefined
  }
}

function eventToolCallCount(event) {
  if (event === undefined) return 0
  if (event.type === 'tool/result') return -1
  if (event.type !== 'assistant/message') return 0
  const content = event.data?.message?.content
  if (!Array.isArray(content)) return 0
  let calls = 0
  for (const block of content) if (block?.type === 'tool-call') calls += 1
  return calls
}

/**
 * Balanced cuts over the current surface: `balanced[i]` is true when the cut
 * immediately BEFORE surface node `i` splits no assistant tool call from its
 * result. Mirrors the compaction engine's per-cut balance cache.
 */
function cutBalances(session, nodes) {
  const balanced = new Array(nodes.length + 1)
  balanced[0] = true
  let open = 0
  for (let index = 0; index < nodes.length; index += 1) {
    const event = session.eventAt(nodes[index])
    if (event === undefined) throw new Error(`auto-compact: surface seq ${nodes[index]} has no log event`)
    open += eventToolCallCount(event)
    if (open < 0) throw new Error(`auto-compact: tool/result at surface seq ${nodes[index]} has no matching tool call`)
    balanced[index + 1] = open === 0
  }
  return balanced
}

/**
 * Select the oldest contiguous span that leaves a priced recent tail: start at
 * the first non-system surface node (the system prompt is never shadowed) and
 * end just before the retained nodes, snapped back to a tool-pairing balanced
 * cut. Mirrors `selectCompactableRange` in the shipped engine.
 */
function selectCompactableRange(session, measurement, retainTokens) {
  const pricedNodes = measurement.nodes
  const surfaceNodes = session.surface.nodes
  if (pricedNodes.length !== surfaceNodes.length) return null
  if (pricedNodes.length === 0) return null
  const head = session.eventAt(surfaceNodes[0])
  if (head === undefined) return null
  const firstIndex = head.type === 'system/message' ? 1 : 0
  let accumulated = 0
  let keepFromIndex = pricedNodes.length
  for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
    accumulated += pricedNodes[index]?.tokens ?? 0
    keepFromIndex = index
    if (accumulated >= retainTokens) break
  }
  if (keepFromIndex <= firstIndex) return null
  const balanced = cutBalances(session, surfaceNodes)
  while (keepFromIndex > firstIndex && balanced[keepFromIndex] !== true) keepFromIndex -= 1
  if (keepFromIndex <= firstIndex) return null
  return { start: surfaceNodes[firstIndex], end: surfaceNodes[keepFromIndex - 1] }
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig, 'config')
  const state = {
    checks: 0,
    triggers: 0,
    compactions: 0,
    pruned: 0,
    skipped: 0,
    lastCompaction: undefined,
    lastTrigger: undefined,
    lastError: undefined,
    lastAttempt: { key: '', at: 0 },
    warnedNoService: false,
    warnedNoMeter: false,
  }

  const log = (...args) => {
    if (currentConfig(config).config.debug) console.warn('[auto-compact]', ...args)
  }

  /** Price one session and condense when the absolute budget is reached. */
  async function maybeCompact(agent, signal) {
    const { config: live } = currentConfig(config)
    if (!live.enabled) return
    state.checks += 1
    const session = agent.session
    if (session === undefined) return
    const meter = serviceFor(ctx, agent, 'tokenMeter')
    if (meter === undefined) {
      if (!state.warnedNoMeter) {
        state.warnedNoMeter = true
        console.warn('[auto-compact] ctx.tokenMeter is unavailable; auto compaction is idle')
      }
      return
    }
    let measurement = meter.measure(session)
    const requestContext = session.requestContext?.()
    const contextWindow = isPositiveInteger(requestContext?.contextWindow) ? requestContext.contextWindow : undefined
    const effectiveThreshold = contextWindow === undefined
      ? live.thresholdTokens
      : Math.min(live.thresholdTokens, Math.floor(contextWindow * live.capRatio))
    if (measurement.totalTokens < effectiveThreshold) return

    const attemptKey = `${session.id}:${session.surface.nodes.length}`
    if (state.lastAttempt.key === attemptKey && Date.now() - state.lastAttempt.at < ATTEMPT_COOLDOWN_MS) return

    const compaction = serviceFor(ctx, agent, 'compaction')
    if (compaction === undefined) {
      if (!state.warnedNoService) {
        state.warnedNoService = true
        console.warn('[auto-compact] no compaction backend in this session composition; auto compaction is idle')
      }
      return
    }

    state.triggers += 1
    state.lastAttempt = { key: attemptKey, at: Date.now() }
    state.lastTrigger = {
      at: Date.now(),
      session_id: session.id,
      pressure_tokens: measurement.totalTokens,
      threshold_tokens: effectiveThreshold,
      context_window: contextWindow ?? null,
      action: 'pending',
    }
    log(`trigger at ${measurement.totalTokens} tokens (threshold ${effectiveThreshold}, window ${contextWindow ?? 'unknown'})`)

    if (live.pruneFirst) {
      const pruner = serviceFor(ctx, agent, 'toolResultPruner')
      if (pruner !== undefined) {
        const nodesBefore = session.surface.nodes.length
        try {
          pruner.pruneSession(session)
          measurement = meter.measure(session)
        } catch (error) {
          log('tool-result pruning failed', error)
        }
        if (session.surface.nodes.length !== nodesBefore) {
          state.pruned += 1
          state.lastTrigger.action = 'pruned'
          state.lastTrigger.pressure_after_prune = measurement.totalTokens
        }
      }
      if (measurement.totalTokens < effectiveThreshold) return
    }

    for (let attempt = 0; attempt < live.maxAttempts; attempt += 1) {
      signal?.throwIfAborted()
      const range = selectCompactableRange(session, measurement, live.retainTokens)
      if (range === null) {
        state.skipped += 1
        state.lastTrigger.action = 'skipped'
        log('no compactable range: the surface is a single indivisible unit')
        return
      }
      const before = measurement.totalTokens
      const result = await compaction.compactRegion(range.start, range.end, agent, signal)
      measurement = meter.measure(session)
      state.compactions += 1
      state.lastTrigger.action = 'compacted'
      state.lastTrigger.pressure_after_compaction = measurement.totalTokens
      state.lastCompaction = {
        at: Date.now(),
        session_id: session.id,
        tokens_before: before,
        tokens_after: measurement.totalTokens,
        freed_tokens: Math.max(0, before - measurement.totalTokens),
        shadowed_tokens: result?.shadowedTokenCount ?? null,
        summary_seq: result?.summarySeq ?? null,
      }
      log(`compacted ${before} -> ${measurement.totalTokens} tokens`)
      if (measurement.totalTokens < effectiveThreshold) return
    }
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      await maybeCompact(payload.agent, payload.signal)
    } catch (error) {
      if (error?.name === 'ManualCompactionError' || error?.code === 'busy') {
        log('compaction backend busy; skipping this step')
      } else {
        state.lastError = error instanceof Error ? error.message : String(error)
        console.warn('[auto-compact] compaction failed:', state.lastError)
      }
    }
    return next()
  })

  ctx.tools.register({
    name: TOOL_NAME,
    description: 'Inspect or tune the absolute-token auto compaction trigger for this session composition. Reports the configured budget, the window-clamped effective budget, current context pressure, and how many condensations this plugin has run. `set` writes the runtime override document (no restart, applies from the next step); `compact` condenses now through the same engine the /compact command uses.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'set', 'compact'],
          description: "What to do: 'status' (default) reports the trigger state, 'set' updates the runtime override document, 'compact' condenses immediately through the mounted backend.",
        },
        threshold_tokens: {
          type: 'integer',
          description: 'New absolute trigger budget in tokens. Used by `set`.',
        },
        retain_tokens: {
          type: 'integer',
          description: 'New recent-tail budget kept verbatim, in tokens. Used by `set`.',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the trigger. Used by `set`.',
        },
        reset: {
          type: 'boolean',
          description: 'Delete the runtime override document and fall back to the bundle config. Used by `set`.',
        },
      },
    },
    output: {
      schema: STATUS_SCHEMA,
      render: (args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    presentCall: () => ({ card: 'generic', title: 'Auto compaction', kind: 'other' }),
    async execute(args, exec) {
      const agent = exec.agent
      const action = args?.action ?? 'status'
      if (action === 'set') {
        if (args?.reset === true) {
          writeOverride({}, true)
        } else {
          const previous = readOverride().value ?? {}
          const next = {
            ...previous,
            ...(args?.threshold_tokens === undefined ? {} : { thresholdTokens: args.threshold_tokens }),
            ...(args?.retain_tokens === undefined ? {} : { retainTokens: args.retain_tokens }),
            ...(args?.enabled === undefined ? {} : { enabled: args.enabled }),
          }
          normalizeConfig(next, 'override')
          writeOverride(next, false)
        }
      }
      if (action === 'compact') {
        if (agent === undefined) throw new Error('auto_compact compact requires a calling agent')
        const compaction = serviceFor(ctx, agent, 'compaction')
        if (compaction === undefined) throw new Error('auto-compact: no compaction backend in this session composition')
        const controller = new AbortController()
        const result = await compaction.compactNow(agent, controller.signal)
        state.compactions += 1
        state.lastCompaction = {
          at: Date.now(),
          session_id: agent.session?.id ?? null,
          tokens_before: null,
          tokens_after: null,
          freed_tokens: null,
          shadowed_tokens: result?.shadowedTokenCount ?? null,
          summary_seq: result?.summarySeq ?? null,
        }
      }
      return collectStatus(ctx, agent, config, overridePath(), args)
    },
  })

  // -- Settings page transport (Client half fetches these same-origin routes) --

  function pageSnapshot() {
    const { config: live, override } = currentConfig(config)
    const sessions = []
    const agents = ctx.get('agents')
    if (agents !== undefined && typeof agents.list === 'function') {
      for (const agent of agents.list()) {
        const session = agent?.session
        const meter = session === undefined ? undefined : serviceFor(ctx, agent, 'tokenMeter')
        if (session === undefined || meter === undefined) continue
        let pressure = 0
        try {
          pressure = meter.measure(session).totalTokens
        } catch {
          continue
        }
        const requestContext = session.requestContext?.()
        sessions.push({
          session_id: session.id ?? '',
          pressure_tokens: pressure,
          context_window: isPositiveInteger(requestContext?.contextWindow) ? requestContext.contextWindow : null,
        })
      }
    }
    sessions.sort((a, b) => b.pressure_tokens - a.pressure_tokens)
    const busiest = sessions[0]
    const contextWindow = busiest?.context_window ?? undefined
    const effectiveThreshold = contextWindow === undefined
      ? live.thresholdTokens
      : Math.min(live.thresholdTokens, Math.floor(contextWindow * live.capRatio))
    return {
      config: {
        threshold_tokens: live.thresholdTokens,
        retain_tokens: live.retainTokens,
        max_attempts: live.maxAttempts,
        cap_ratio: live.capRatio,
        prune_first: live.pruneFirst,
        enabled: live.enabled,
      },
      defaults: {
        threshold_tokens: DEFAULT_CONFIG.thresholdTokens,
        retain_tokens: DEFAULT_CONFIG.retainTokens,
        prune_first: DEFAULT_CONFIG.pruneFirst,
        enabled: DEFAULT_CONFIG.enabled,
      },
      effective_threshold_tokens: effectiveThreshold,
      pressure_tokens: busiest?.pressure_tokens ?? null,
      context_window: contextWindow ?? null,
      sessions: sessions.slice(0, 5),
      counters: {
        checks: state.checks,
        triggers: state.triggers,
        compactions: state.compactions,
        pruned: state.pruned,
        skipped: state.skipped,
      },
      last_trigger: state.lastTrigger ?? null,
      last_compaction: state.lastCompaction ?? null,
      last_error: state.lastError ?? null,
      override_path: overridePath(),
      override_active: override.value !== null,
      override_error: override.error ?? null,
    }
  }

  async function compactNowFromUi() {
    const agents = ctx.get('agents')
    const candidates = typeof agents?.list === 'function' ? agents.list() : []
    const target = candidates.find((agent) => agent?.session !== undefined)
    if (target === undefined) throw new Error('no live session to compact')
    const compaction = serviceFor(ctx, target, 'compaction')
    if (compaction === undefined) throw new Error('no compaction backend in this session composition')
    const result = await compaction.compactNow(target, new AbortController().signal)
    state.compactions += 1
    state.lastCompaction = {
      at: Date.now(),
      session_id: target.session?.id ?? null,
      tokens_before: null,
      tokens_after: null,
      freed_tokens: null,
      shadowed_tokens: result?.shadowedTokenCount ?? null,
      summary_seq: result?.summarySeq ?? null,
    }
    return { ok: true, shadowed_tokens: result?.shadowedTokenCount ?? null, summary_seq: result?.summarySeq ?? null }
  }

  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const disposers = [
        host.webServer.register({
          kind: 'exact',
          path: '/auto-compact/status',
          handler: async (request, response) => {
            if (request.method !== 'GET') {
              sendJson(response, 405, { error: 'method not allowed' })
              return
            }
            sendJson(response, 200, pageSnapshot())
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/auto-compact/config',
          handler: async (request, response) => {
            if (!trustedPost(request, response)) return
            try {
              const body = await readJsonBody(request)
              const document = typeof body === 'object' && body !== null ? body : {}
              if (document.reset === true) {
                writeOverride({}, true)
                sendJson(response, 200, pageSnapshot())
                return
              }
              const patch = {}
              for (const key of ['thresholdTokens', 'retainTokens', 'pruneFirst', 'enabled']) {
                if (document[key] !== undefined) patch[key] = document[key]
              }
              if (Object.keys(patch).length === 0) {
                sendJson(response, 400, { error: 'no recognized field in the request body' })
                return
              }
              normalizeConfig({ ...(readOverride().value ?? {}), ...patch }, 'override')
              writeOverride(patch, false)
              sendJson(response, 200, pageSnapshot())
            } catch (error) {
              sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/auto-compact/compact',
          handler: async (request, response) => {
            if (!trustedPost(request, response)) return
            try {
              sendJson(response, 200, await compactNowFromUi())
            } catch (error) {
              sendJson(response, 409, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
      ]
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'auto-compact: settings routes')
  })

  function collectStatus(ctxValue, agent, configValue, file, args) {
    const { config: live, override } = currentConfig(configValue)
    const session = agent?.session
    const meter = agent === undefined ? undefined : serviceFor(ctxValue, agent, 'tokenMeter')
    const compaction = agent === undefined ? undefined : serviceFor(ctxValue, agent, 'compaction')
    let pressure = 0
    let contextWindow
    if (meter !== undefined && session !== undefined) {
      pressure = meter.measure(session).totalTokens
      const requestContext = session.requestContext?.()
      if (isPositiveInteger(requestContext?.contextWindow)) contextWindow = requestContext.contextWindow
    } else if (session !== undefined && typeof session.snapshotEvents === 'function') {
      pressure = 0
    }
    const effectiveThreshold = contextWindow === undefined
      ? live.thresholdTokens
      : Math.min(live.thresholdTokens, Math.floor(contextWindow * live.capRatio))
    const value = {
      action: args?.action ?? 'status',
      enabled: live.enabled,
      threshold_tokens: live.thresholdTokens,
      effective_threshold_tokens: effectiveThreshold,
      cap_ratio: live.capRatio,
      retain_tokens: live.retainTokens,
      max_attempts: live.maxAttempts,
      prune_first: live.pruneFirst,
      context_window: contextWindow,
      pressure_tokens: pressure,
      pressure_percent: contextWindow === undefined ? 0 : Math.round((pressure / contextWindow) * 1000) / 10,
      compaction_service: compaction !== undefined,
      token_meter_service: meter !== undefined,
      pre_step_checks: state.checks,
      triggers: state.triggers,
      compactions: state.compactions,
      pruned: state.pruned,
      skipped: state.skipped,
      last_trigger: state.lastTrigger,
      last_compaction: state.lastCompaction,
      last_error: state.lastError ?? '',
      override_path: file,
      override: override.value === null ? {} : { active: true, ...override.value, ...(override.error === undefined ? {} : { error: override.error }) },
    }
    for (const key of Object.keys(value)) {
      if (value[key] === null || value[key] === undefined) delete value[key]
    }
    return value
  }
}

/** Merge `patch` into the override document and persist it; `reset` removes the document. */
function writeOverride(patch, reset) {
  const file = overridePath()
  const next = reset === true ? {} : { ...(readOverride().value ?? {}), ...patch }
  try {
    if (reset === true) {
      rmSync(file, { force: true })
    } else {
      writeFileSync(file, Object.keys(next).length === 0 ? '{}\n' : `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    }
  } catch (error) {
    throw new Error(`auto-compact: cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  overrideCache = { at: 0, value: null, error: undefined, path: '' }
  return next
}

const BODY_LIMIT_BYTES = 8192
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function sendJson(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function loopbackAuthority(authority) {
  try {
    const parsed = new URL(`http://${authority}`)
    if (!LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) return null
    return `loopback:${parsed.port === '' ? '80' : parsed.port}`
  } catch {
    return null
  }
}

/**
 * Source check for state-changing writes: loopback Host plus same-port Origin,
 * the Electron `dsh-app:` page protocol, or no Origin at all (native clients).
 * This is the whole CSRF defense, mirroring what the harness settings routes do.
 */
function isTrustedRequest(request) {
  const host = request.headers.host
  const hostKey = host === undefined ? null : loopbackAuthority(host)
  if (hostKey === null) return false
  const origin = request.headers.origin
  if (origin === undefined || origin === '') return true
  try {
    const url = new URL(origin)
    if (url.protocol === 'dsh-app:') return true
    return loopbackAuthority(url.host) === hostKey
  } catch {
    return false
  }
}

function trustedPost(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'method not allowed' })
    return false
  }
  if (isTrustedRequest(request)) return true
  sendJson(response, 403, { error: 'untrusted origin' })
  return false
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > BODY_LIMIT_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  return JSON.parse(text)
}

function formatTokens(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function renderStatus(value) {
  const lines = []
  lines.push(`Auto compaction: ${value.enabled ? 'enabled' : 'disabled'}`)
  lines.push(`Trigger: ${formatTokens(value.effective_threshold_tokens)} tokens (configured ${formatTokens(value.threshold_tokens)})`)
  if (typeof value.context_window === 'number') {
    lines.push(`Context: ${formatTokens(value.pressure_tokens)} / ${formatTokens(value.context_window)} (${value.pressure_percent}%)`)
  } else {
    lines.push(`Context: ${formatTokens(value.pressure_tokens)} tokens (window unknown until the first request)`)
  }
  lines.push(`Retain tail: ${formatTokens(value.retain_tokens)} · attempts/step: ${value.max_attempts} · prune first: ${value.prune_first ? 'yes' : 'no'}`)
  lines.push(`Services: tokenMeter ${value.token_meter_service ? 'ok' : 'missing'} · compaction ${value.compaction_service ? 'ok' : 'missing'}`)
  lines.push(`Checks ${value.pre_step_checks} · triggers ${value.triggers} · compactions ${value.compactions} · prunes ${value.pruned} · skipped ${value.skipped}`)
  if (value.last_trigger !== null && value.last_trigger !== undefined) {
    const trigger = value.last_trigger
    const outcome = trigger.action === 'compacted'
      ? `compacted ${formatTokens(trigger.pressure_tokens)} → ${formatTokens(trigger.pressure_after_compaction)}`
      : trigger.action === 'pruned'
        ? `pruned tool output ${formatTokens(trigger.pressure_tokens)} → ${formatTokens(trigger.pressure_after_prune)}`
        : trigger.action
    lines.push(`Last trigger: ${formatTokens(trigger.pressure_tokens)} vs ${formatTokens(trigger.threshold_tokens)} · ${outcome} at ${new Date(trigger.at).toISOString()}`)
  }
  if (value.last_compaction !== null && value.last_compaction !== undefined) {
    const last = value.last_compaction
    lines.push(`Last compaction: ${last.freed_tokens === null || last.freed_tokens === undefined ? 'manual' : `${formatTokens(last.tokens_before)} → ${formatTokens(last.tokens_after)} (freed ${formatTokens(last.freed_tokens)})`} at ${new Date(last.at).toISOString()}`)
  }
  if (value.last_error) lines.push(`Last error: ${value.last_error}`)
  lines.push(`Override: ${value.override_path}${value.override?.active === true ? ' (active)' : ' (not set)'}`)
  if (value.action === 'set') lines.push('Override written; the next model step uses it.')
  return lines.join('\n')
}
