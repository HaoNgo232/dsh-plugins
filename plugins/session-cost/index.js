import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { z } from 'zod'
import { GO_MONTHLY_LIMITS, costOf, mergePrices, normalizeModel } from './pricing.js'

const TOOL_NAME = 'session_cost'
const PLUGIN_PACKAGE_NAME = '@local/session-cost'
const PROJECTION_KEY = 'sessionCost'
const DEFAULT_REQUESTS_LIMIT = 40
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export const name = 'session-cost'
export const inject = ['tools']

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function startOfUtcMonth(timeMs) {
  const date = new Date(timeMs)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

function tokensOf(usage) {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
  }
}

function totalOf(tokens) {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

function messageText(message) {
  if (message === null || typeof message !== 'object') return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join(' ')
}

function preview(text, max = 90) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function fmtUsd(value) {
  if (!Number.isFinite(value)) return '$0'
  if (value === 0) return '$0'
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`
  if (Math.abs(value) < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

function fmtTokens(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

function fmtTime(timeMs) {
  try {
    return new Date(timeMs).toISOString().slice(11, 16)
  } catch {
    return ''
  }
}

//#region session log scan (whole-machine Go usage baseline)

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const baselineCache = new Map()

function decodeSessionLog(file) {
  const buffer = readFileSync(file)
  const offsets = []
  for (let i = 0; i < buffer.length - 3; i += 1) {
    if (buffer[i] === ZSTD_MAGIC[0] && buffer[i + 1] === ZSTD_MAGIC[1] && buffer[i + 2] === ZSTD_MAGIC[2] && buffer[i + 3] === ZSTD_MAGIC[3]) {
      offsets.push(i)
    }
  }
  const parts = []
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index]
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length
    try {
      parts.push(zstdDecompressSync(buffer.subarray(start, end)))
    } catch {
      // Not a real frame boundary.
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

/**
 * Fold every other session's recent usage into machine-wide Go windows.
 * Files are read only when touched within the last 35 days, and the result is
 * cached per sessions directory for a short while.
 */
function scanBaseline({ sessionsDir, excludeSessionId, prices, now }) {
  const cacheKey = `${sessionsDir}|${excludeSessionId}|${Math.floor(now / 60000)}`
  const cached = baselineCache.get(cacheKey)
  if (cached !== undefined) return cached

  const result = {
    fiveHourUsd: 0,
    weekUsd: 0,
    monthUsd: 0,
    modelMonth: new Map(),
    unpriced: new Set(),
  }
  const monthStart = startOfUtcMonth(now)
  const recentFloor = Math.max(monthStart, now - WEEK_MS - 24 * 60 * 60 * 1000)
  let workspaces = []
  try {
    workspaces = readdirSync(sessionsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch {
    baselineCache.set(cacheKey, result)
    return result
  }

  for (const workspace of workspaces) {
    const workspacePath = path.join(sessionsDir, workspace.name)
    let sessionDirs = []
    try {
      sessionDirs = readdirSync(workspacePath, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    } catch {
      continue
    }
    for (const sessionDir of sessionDirs) {
      if (isNonEmptyString(excludeSessionId) && sessionDir.name.includes(excludeSessionId)) continue
      const file = path.join(workspacePath, sessionDir.name, 'session.v4.jsonl.zstd')
      let stats
      try {
        stats = statSync(file)
      } catch {
        continue
      }
      if (stats.mtimeMs < recentFloor) continue
      let text
      try {
        text = decodeSessionLog(file)
      } catch {
        continue
      }
      for (const line of text.split('\n')) {
        if (line.length === 0) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (event.type !== 'assistant/message') continue
        const usage = event.data?.usage
        if (usage === null || usage === undefined) continue
        const timeMs = typeof event.time === 'number' ? event.time : stats.mtimeMs
        if (timeMs < recentFloor) continue
        const model = normalizeModel(event.data?.message?.source?.model ?? '')
        const priced = costOf({ model, timeMs, usage, prices })
        if (!priced.priced) {
          result.unpriced.add(model.length > 0 ? model : '(unknown)')
        }
        if (timeMs >= now - FIVE_HOUR_MS) result.fiveHourUsd += priced.cost
        if (timeMs >= now - WEEK_MS) result.weekUsd += priced.cost
        if (timeMs >= monthStart) {
          result.monthUsd += priced.cost
          const key = model.length > 0 ? model : '(unknown)'
          result.modelMonth.set(key, (result.modelMonth.get(key) ?? 0) + priced.cost)
        }
      }
    }
  }

  if (baselineCache.size > 20) baselineCache.clear()
  baselineCache.set(cacheKey, result)
  return result
}

//#endregion

//#region session fold (tool)

export function collectSessionCost(session, options = {}) {
  const events = typeof session.ownEvents === 'function' ? session.ownEvents() : session.snapshotEvents?.() ?? []
  const prices = options.prices ?? mergePrices(undefined)
  const turnPreview = new Map()
  let pendingPreview = ''
  const requests = []
  const unpriced = new Set()

  for (const event of events) {
    const data = event?.data
    if (data === null || data === undefined) continue
    switch (event.type) {
      case 'user/message': {
        const text = messageText(data)
        if (text.trim().length > 0) pendingPreview = preview(text)
        break
      }
      case 'turn/start': {
        if (typeof data.turn === 'number' && pendingPreview.length > 0 && !turnPreview.has(data.turn)) {
          turnPreview.set(data.turn, pendingPreview)
        }
        pendingPreview = ''
        break
      }
      case 'assistant/message': {
        const usage = data.usage
        if (usage === null || usage === undefined) break
        const source = data.message?.source ?? {}
        const provider = isNonEmptyString(source.provider) ? source.provider : ''
        const model = isNonEmptyString(source.model) ? source.model : ''
        const timeMs = typeof event.time === 'number' ? event.time : Date.now()
        const tokens = tokensOf(usage)
        const priced = costOf({ model, timeMs, usage, prices })
        if (!priced.priced) unpriced.add(model.length > 0 ? model : '(unknown)')
        requests.push({
          turn: typeof data.turn === 'number' ? data.turn : 0,
          step: typeof data.step === 'number' ? data.step : 0,
          time: timeMs,
          provider,
          model,
          tokens,
          cost: priced.cost,
          priced: priced.priced,
        })
        break
      }
      default:
        break
    }
  }

  const modelMap = new Map()
  const turnMap = new Map()
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  for (const request of requests) {
    totals.input += request.tokens.input
    totals.output += request.tokens.output
    totals.cacheRead += request.tokens.cacheRead
    totals.cacheWrite += request.tokens.cacheWrite
    totals.cost += request.cost

    const key = request.model.length > 0 ? request.model : '(unknown)'
    const modelEntry = modelMap.get(key) ?? {
      model: key, provider: request.provider, requests: 0,
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
    }
    modelEntry.requests += 1
    modelEntry.input += request.tokens.input
    modelEntry.output += request.tokens.output
    modelEntry.cacheRead += request.tokens.cacheRead
    modelEntry.cacheWrite += request.tokens.cacheWrite
    modelEntry.cost += request.cost
    modelMap.set(key, modelEntry)

    const turnEntry = turnMap.get(request.turn) ?? { turn: request.turn, requests: 0, tokens: 0, cost: 0 }
    turnEntry.requests += 1
    turnEntry.tokens += totalOf(request.tokens)
    turnEntry.cost += request.cost
    turnMap.set(request.turn, turnEntry)
  }

  const turns = [...turnMap.values()].sort((a, b) => a.turn - b.turn).map((entry) => ({
    turn: entry.turn,
    preview: turnPreview.get(entry.turn) ?? '',
    requests: entry.requests,
    total_tokens: entry.tokens,
    cost_usd: entry.cost,
  }))

  return {
    totalTokens: totalOf(totals),
    totals,
    requests,
    turns,
    models: [...modelMap.values()].sort((a, b) => b.cost - a.cost).map((entry) => ({
      model: entry.model,
      provider: entry.provider,
      requests: entry.requests,
      input_tokens: entry.input,
      output_tokens: entry.output,
      cache_read_tokens: entry.cacheRead,
      cache_write_tokens: entry.cacheWrite,
      total_tokens: entry.input + entry.output + entry.cacheRead + entry.cacheWrite,
      cost_usd: entry.cost,
    })),
    unpricedModels: [...unpriced],
  }
}

//#endregion

//#region projection fold (client badge)

const MODEL_STATE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string' },
    provider: { type: 'string' },
    requests: { type: 'integer' },
    inputTokens: { type: 'integer' },
    outputTokens: { type: 'integer' },
    cacheReadTokens: { type: 'integer' },
    cacheWriteTokens: { type: 'integer' },
    costUsd: { type: 'number' },
  },
  required: ['model', 'provider', 'requests', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd'],
}

const TURN_STATE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    turn: { type: 'integer' },
    requests: { type: 'integer' },
    costUsd: { type: 'number' },
  },
  required: ['turn', 'requests', 'costUsd'],
}

const MODEL_MONTH_STATE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string' },
    costUsd: { type: 'number' },
  },
  required: ['model', 'costUsd'],
}

const STATE_SCHEMA = z.object({
  baselineAt: z.number(),
  sessionUsd: z.number(),
  requests: z.number(),
  turnsCount: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  fiveHourUsd: z.number(),
  weekUsd: z.number(),
  monthUsd: z.number(),
  models: z.array(z.object({
    model: z.string(),
    provider: z.string(),
    requests: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    costUsd: z.number(),
  })),
  turns: z.array(z.object({ turn: z.number(), requests: z.number(), costUsd: z.number() })),
  modelMonth: z.array(z.object({ model: z.string(), costUsd: z.number() })),
  unpriced: z.array(z.string()),
})

const VIEW_SCHEMA = z.object({
  totalUsd: z.number(),
  requests: z.number(),
  turns: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  cacheHit: z.number(),
  models: z.array(z.object({
    model: z.string(),
    provider: z.string(),
    requests: z.number(),
    costUsd: z.number(),
  })),
  turnsDetail: z.array(z.object({ turn: z.number(), costUsd: z.number(), requests: z.number() })),
  windows: z.object({ fiveHourUsd: z.number(), weekUsd: z.number(), monthUsd: z.number() }),
  monthly: z.array(z.object({
    model: z.string(),
    costUsd: z.number(),
    limitUsd: z.number(),
    ratio: z.number(),
  })),
  unpriced: z.array(z.string()),
})

function emptyProjectionState(baselineAt, baseline) {
  return {
    baselineAt,
    sessionUsd: 0,
    requests: 0,
    turnsCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    fiveHourUsd: baseline.fiveHourUsd,
    weekUsd: baseline.weekUsd,
    monthUsd: baseline.monthUsd,
    models: [],
    turns: [],
    modelMonth: [...baseline.modelMonth.entries()].map(([model, costUsd]) => ({ model, costUsd })),
    unpriced: [...baseline.unpriced],
  }
}

function applyProjectionEvent(state, event, prices) {
  if (event?.type !== 'assistant/message') return state
  const data = event.data
  const usage = data?.usage
  if (usage === null || usage === undefined) return state
  const source = data.message?.source ?? {}
  const provider = isNonEmptyString(source.provider) ? source.provider : ''
  const model = isNonEmptyString(source.model) ? source.model : ''
  const key = model.length > 0 ? model : '(unknown)'
  const timeMs = typeof event.time === 'number' ? event.time : state.baselineAt
  const priced = costOf({ model, timeMs, usage, prices })
  const tokens = tokensOf(usage)

  const monthEntry = state.modelMonth.find((entry) => entry.model === key)
  const inFiveHour = timeMs >= state.baselineAt - FIVE_HOUR_MS
  const inWeek = timeMs >= state.baselineAt - WEEK_MS
  const inMonth = timeMs >= startOfUtcMonth(state.baselineAt)

  const next = {
    ...state,
    sessionUsd: state.sessionUsd + priced.cost,
    requests: state.requests + 1,
    inputTokens: state.inputTokens + tokens.input,
    outputTokens: state.outputTokens + tokens.output,
    cacheReadTokens: state.cacheReadTokens + tokens.cacheRead,
    cacheWriteTokens: state.cacheWriteTokens + tokens.cacheWrite,
    fiveHourUsd: state.fiveHourUsd + (inFiveHour ? priced.cost : 0),
    weekUsd: state.weekUsd + (inWeek ? priced.cost : 0),
    monthUsd: state.monthUsd + (inMonth ? priced.cost : 0),
    models: state.models.map((entry) => entry.model === key
      ? {
          ...entry,
          requests: entry.requests + 1,
          inputTokens: entry.inputTokens + tokens.input,
          outputTokens: entry.outputTokens + tokens.output,
          cacheReadTokens: entry.cacheReadTokens + tokens.cacheRead,
          cacheWriteTokens: entry.cacheWriteTokens + tokens.cacheWrite,
          costUsd: entry.costUsd + priced.cost,
        }
      : entry),
    turns: state.turns.map((entry) => entry.turn === data.turn
      ? { ...entry, requests: entry.requests + 1, costUsd: entry.costUsd + priced.cost }
      : entry),
    modelMonth: monthEntry === undefined
      ? [...state.modelMonth, { model: key, costUsd: priced.cost }]
      : state.modelMonth.map((entry) => entry.model === key
        ? { ...entry, costUsd: entry.costUsd + priced.cost }
        : entry),
    unpriced: priced.priced || state.unpriced.includes(key) ? state.unpriced : [...state.unpriced, key],
  }
  if (!next.models.some((entry) => entry.model === key)) {
    next.models = [...next.models, {
      model: key,
      provider,
      requests: 1,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      costUsd: priced.cost,
    }]
  }
  if (!next.turns.some((entry) => entry.turn === data.turn)) {
    next.turns = [...next.turns, { turn: data.turn, requests: 1, costUsd: priced.cost }]
  }
  next.turnsCount = next.turns.length
  return next
}

function viewOf(state, limits) {
  return {
    totalUsd: state.sessionUsd,
    requests: state.requests,
    turns: state.turnsCount,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens,
    totalTokens: state.inputTokens + state.outputTokens + state.cacheReadTokens + state.cacheWriteTokens,
    cacheHit: state.inputTokens + state.cacheReadTokens > 0
      ? state.cacheReadTokens / (state.inputTokens + state.cacheReadTokens)
      : 0,
    models: state.models.map((entry) => ({
      model: entry.model,
      provider: entry.provider,
      requests: entry.requests,
      costUsd: entry.costUsd,
    })),
    turnsDetail: state.turns.map((entry) => ({ turn: entry.turn, costUsd: entry.costUsd, requests: entry.requests })),
    windows: {
      fiveHourUsd: state.fiveHourUsd,
      weekUsd: state.weekUsd,
      monthUsd: state.monthUsd,
    },
    monthly: state.modelMonth
      .map((entry) => {
        const limitUsd = limits[entry.model] ?? 0
        return {
          model: entry.model,
          costUsd: entry.costUsd,
          limitUsd,
          ratio: limitUsd > 0 ? entry.costUsd / limitUsd : 0,
        }
      })
      .sort((a, b) => b.costUsd - a.costUsd),
    unpriced: state.unpriced,
  }
}

//#endregion

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    currency: { type: 'string' },
    total_usd: { type: 'number' },
    requests: { type: 'integer' },
    turns: { type: 'integer' },
    input_tokens: { type: 'integer' },
    output_tokens: { type: 'integer' },
    cache_read_tokens: { type: 'integer' },
    cache_write_tokens: { type: 'integer' },
    total_tokens: { type: 'integer' },
    five_hour_usd: { type: 'number' },
    week_usd: { type: 'number' },
    month_usd: { type: 'number' },
    models: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string' },
          provider: { type: 'string' },
          requests: { type: 'integer' },
          input_tokens: { type: 'integer' },
          output_tokens: { type: 'integer' },
          cache_read_tokens: { type: 'integer' },
          cache_write_tokens: { type: 'integer' },
          total_tokens: { type: 'integer' },
          cost_usd: { type: 'number' },
        },
        required: ['model', 'provider', 'requests', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'total_tokens', 'cost_usd'],
      },
    },
    turns_detail: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          turn: { type: 'integer' },
          preview: { type: 'string' },
          requests: { type: 'integer' },
          total_tokens: { type: 'integer' },
          cost_usd: { type: 'number' },
        },
        required: ['turn', 'preview', 'requests', 'total_tokens', 'cost_usd'],
      },
    },
    requests_detail: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          turn: { type: 'integer' },
          step: { type: 'integer' },
          time: { type: 'integer' },
          provider: { type: 'string' },
          model: { type: 'string' },
          input_tokens: { type: 'integer' },
          output_tokens: { type: 'integer' },
          cache_read_tokens: { type: 'integer' },
          cache_write_tokens: { type: 'integer' },
          total_tokens: { type: 'integer' },
          cost_usd: { type: 'number' },
        },
        required: ['turn', 'step', 'time', 'provider', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'total_tokens', 'cost_usd'],
      },
    },
    monthly_usage: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string' },
          month_usd: { type: 'number' },
          limit_usd: { type: 'number' },
          ratio: { type: 'number' },
        },
        required: ['model', 'month_usd', 'limit_usd', 'ratio'],
      },
    },
    unpriced_models: { type: 'array', items: { type: 'string' } },
    projection_check: { type: 'string' },
  },
  required: [
    'currency', 'total_usd', 'requests', 'turns',
    'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'total_tokens',
    'five_hour_usd', 'week_usd', 'month_usd',
    'models', 'turns_detail', 'requests_detail', 'monthly_usage', 'unpriced_models',
  ],
}

function renderReport(report, args) {
  const detail = isNonEmptyString(args?.detail) ? args.detail : 'all'
  const limit = Number.isInteger(args?.requests_limit) ? Math.min(Math.max(args.requests_limit, 1), 500) : DEFAULT_REQUESTS_LIMIT
  const requestCount = typeof report.requestCount === 'number' ? report.requestCount : report.requests.length
  const turnCount = typeof report.turnCount === 'number' ? report.turnCount : report.turns.length
  const lines = []
  lines.push(`Session cost: ${fmtUsd(report.totals.cost)} · ${requestCount} requests · ${turnCount} tasks`)
  lines.push(
    `Tokens: ${fmtTokens(report.totalTokens)} total (in ${fmtTokens(report.totals.input)}, out ${fmtTokens(report.totals.output)}` +
    `, cache read ${fmtTokens(report.totals.cacheRead)}, cache write ${fmtTokens(report.totals.cacheWrite)})`,
  )
  if (typeof report.windows === 'object' && report.windows !== null) {
    lines.push(
      `Go usage (all sessions, est.): 5h ${fmtUsd(report.windows.fiveHourUsd)}` +
      ` · week ${fmtUsd(report.windows.weekUsd)}` +
      ` · month ${fmtUsd(report.windows.monthUsd)}`,
    )
    for (const row of report.monthlyUsage ?? []) {
      if (!(row.limit_usd > 0)) continue
      lines.push(`  ${row.model}: ${fmtUsd(row.month_usd)} / ${fmtUsd(row.limit_usd)} this month (${Math.round(row.ratio * 100)}%)`)
    }
  }
  if (report.unpricedModels.length > 0) {
    lines.push(`Unpriced models (cost excluded): ${report.unpricedModels.join(', ')}`)
  }

  if (detail === 'summary' || detail === 'all' || detail === 'turns' || detail === 'requests') {
    if (report.models.length > 0) {
      lines.push('', 'By model:')
      for (const model of report.models) {
        lines.push(`  ${model.model}  ${fmtUsd(model.cost_usd)}  ${model.requests} req  ${fmtTokens(model.total_tokens)} tok`)
      }
    }
  }

  if (detail === 'turns' || detail === 'all') {
    if (report.turns.length > 0) {
      lines.push('', 'Per task (turn):')
      for (const turn of report.turns) {
        const label = turn.preview.length > 0 ? ` ${turn.preview}` : ''
        lines.push(`  #${turn.turn}${label}  ${fmtUsd(turn.cost_usd)}  ${turn.requests} req  ${fmtTokens(turn.total_tokens)} tok`)
      }
    }
  }

  if (detail === 'requests' || detail === 'all') {
    if (report.requests.length > 0) {
      lines.push('', 'Per request (newest last):')
      for (const request of report.requests.slice(-limit)) {
        lines.push(
          `  #${request.turn}.${request.step} ${fmtTime(request.time)} ${request.model || '(unknown)'}` +
          `  in ${request.tokens.input} out ${request.tokens.output} cacheR ${request.tokens.cacheRead} cacheW ${request.tokens.cacheWrite}` +
          `  ${request.priced ? fmtUsd(request.cost) : 'unpriced'}`,
        )
      }
      if (requestCount > report.requests.length) {
        lines.push(`  (${requestCount - report.requests.length} older requests omitted)`)
      }
    }
  }

  if (report.projectionCheck !== undefined) {
    lines.push('', `Projection check: ${report.projectionCheck}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function outputValue(report) {
  return {
    currency: 'USD',
    total_usd: report.totals.cost,
    requests: report.requests.length,
    turns: report.turns.length,
    input_tokens: report.totals.input,
    output_tokens: report.totals.output,
    cache_read_tokens: report.totals.cacheRead,
    cache_write_tokens: report.totals.cacheWrite,
    total_tokens: report.totalTokens,
    five_hour_usd: report.windows?.fiveHourUsd ?? 0,
    week_usd: report.windows?.weekUsd ?? 0,
    month_usd: report.windows?.monthUsd ?? 0,
    models: report.models,
    turns_detail: report.turns,
    requests_detail: report.requests.map((request) => ({
      turn: request.turn,
      step: request.step,
      time: request.time,
      provider: request.provider,
      model: request.model,
      input_tokens: request.tokens.input,
      output_tokens: request.tokens.output,
      cache_read_tokens: request.tokens.cacheRead,
      cache_write_tokens: request.tokens.cacheWrite,
      total_tokens: totalOf(request.tokens),
      cost_usd: request.cost,
    })),
    monthly_usage: report.monthlyUsage ?? [],
    unpriced_models: report.unpricedModels,
  }
}

export function apply(ctx, config = {}) {
  const prices = mergePrices(config.prices)
  const limits = { ...GO_MONTHLY_LIMITS, ...(config.goLimits ?? {}) }
  const sessionsDir = isNonEmptyString(config.sessionsDir)
    ? config.sessionsDir
    : path.join(homedir(), '.dsh', 'sessions')

  ctx.tools.register({
    name: TOOL_NAME,
    description: 'Report token usage and estimated USD cost for the current session: total, per task (turn), and per request, plus machine-wide OpenCode Go usage for the 5-hour, weekly, and monthly windows. Costs come from logged token usage multiplied by the configured price table, so they are estimates, not provider billing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        detail: {
          type: 'string',
          enum: ['summary', 'turns', 'requests', 'all'],
          description: "How much of the report to render: 'summary' (totals and models), 'turns' (adds per-task rows), 'requests' (adds per-request rows), or 'all'. Defaults to 'all'.",
        },
        requests_limit: {
          type: 'number',
          description: 'How many of the newest request rows to render. Defaults to 40.',
        },
        debug: {
          type: 'boolean',
          description: 'Include a raw client-projection snapshot for diagnosing the live cost badge.',
        },
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => renderReport({
        requestCount: value.requests,
        turnCount: value.turns,
        totalTokens: value.total_tokens,
        windows: {
          fiveHourUsd: value.five_hour_usd,
          weekUsd: value.week_usd,
          monthUsd: value.month_usd,
        },
        monthlyUsage: value.monthly_usage,
        projectionCheck: value.projection_check,
        totals: {
          input: value.input_tokens,
          output: value.output_tokens,
          cacheRead: value.cache_read_tokens,
          cacheWrite: value.cache_write_tokens,
          cost: value.total_usd,
        },
        requests: value.requests_detail.map((request) => ({
          turn: request.turn,
          step: request.step,
          time: request.time,
          provider: request.provider,
          model: request.model,
          tokens: {
            input: request.input_tokens,
            output: request.output_tokens,
            cacheRead: request.cache_read_tokens,
            cacheWrite: request.cache_write_tokens,
          },
          cost: request.cost_usd,
          priced: !value.unpriced_models.includes(request.model),
        })),
        turns: value.turns_detail,
        models: value.models,
        unpricedModels: value.unpriced_models,
      }, args),
    },
    presentCall: () => ({ card: 'generic', title: 'Session cost', kind: 'other' }),
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined || agent.session === undefined) {
        throw new Error('session_cost requires an agent with a session')
      }
      const report = collectSessionCost(agent.session, { prices })
      const now = Date.now()
      const baseline = scanBaseline({
        sessionsDir,
        excludeSessionId: agent.session.id,
        prices,
        now,
      })
      const monthlyMap = new Map(baseline.modelMonth)
      for (const model of report.models) {
        monthlyMap.set(model.model, (monthlyMap.get(model.model) ?? 0) + model.cost_usd)
      }
      report.windows = {
        fiveHourUsd: baseline.fiveHourUsd + report.totals.cost,
        weekUsd: baseline.weekUsd + report.totals.cost,
        monthUsd: baseline.monthUsd + report.totals.cost,
      }
      report.monthlyUsage = [...monthlyMap.entries()]
        .map(([model, monthUsd]) => ({
          model,
          month_usd: monthUsd,
          limit_usd: limits[model] ?? 0,
          ratio: (limits[model] ?? 0) > 0 ? monthUsd / limits[model] : 0,
        }))
        .sort((a, b) => b.month_usd - a.month_usd)
      const value = outputValue(report)
      if (args?.debug === true) {
        try {
          const projections = ctx.get('sessionProjections')
          if (projections === undefined) {
            value.projection_check = 'sessionProjections service is not composed'
          } else {
            const snapshot = projections.snapshot(agent.session, [PROJECTION_KEY])
            value.projection_check = JSON.stringify(snapshot.values ?? null)
          }
        } catch (error) {
          value.projection_check = `projection read failed: ${error instanceof Error ? error.message : String(error)}`
        }
        try {
          const modules = ctx.get('clientModules')
          if (modules !== undefined && typeof modules.clientPath === 'function') {
            if (typeof modules.rebuilt === 'function') modules.rebuilt(PLUGIN_PACKAGE_NAME)
            value.projection_check += ` | client bundle: ${modules.clientPath(PLUGIN_PACKAGE_NAME) ?? 'not registered'}`
          }
        } catch (error) {
          value.projection_check += ` | client bundle read failed: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      const limit = Number.isInteger(args?.requests_limit) ? Math.min(Math.max(args.requests_limit, 1), 500) : DEFAULT_REQUESTS_LIMIT
      value.requests_detail = value.requests_detail.slice(-Math.max(limit, 1))
      return value
    },
  })

  const projections = ctx.get('sessionProjections')
  if (projections !== undefined) {
    try {
      ctx.effect(() => projections.register({
        key: PROJECTION_KEY,
        stateSchema: STATE_SCHEMA,
        init: (header) => {
          const now = Date.now()
          let baseline = { fiveHourUsd: 0, weekUsd: 0, monthUsd: 0, modelMonth: new Map(), unpriced: new Set() }
          try {
            baseline = scanBaseline({ sessionsDir, excludeSessionId: header.id, prices, now })
          } catch {
            // Usage quota stays session-local when the log directory is unavailable.
          }
          return emptyProjectionState(now, baseline)
        },
        apply: (state, event) => applyProjectionEvent(state, event, prices),
        stateVersion: 1,
        wire: {
          viewSchema: VIEW_SCHEMA,
          view: (state) => viewOf(state, limits),
        },
      }), 'session-cost: projection')
    } catch {
      // The tool remains available when the projection registry rejects the unit.
    }
  }
}
