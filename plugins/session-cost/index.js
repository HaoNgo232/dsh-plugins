const TOOL_NAME = 'session_cost'
const DEFAULT_REQUESTS_LIMIT = 40

/**
 * OpenCode Go token prices in USD per 1M tokens, from
 * https://opencode.ai/v2/docs/console/go/ ("Usage limits").
 * Peak/off-peak applies to DeepSeek V4.1 Flash / V4 Pro: peak is 01:00-04:00
 * and 06:00-10:00 UTC, Monday-Friday; everything else is off-peak.
 * Tiers are chosen by the request's context size (input + cache tokens).
 */
const OPENCODE_GO_PRICES = {
  'glm-5.3-flash': { input: 0.15, output: 0.5, cacheRead: 0.03 },
  'glm-5.3': { input: 1.4, output: 4.4, cacheRead: 0.26 },
  'glm-5.2': { input: 1.4, output: 4.4, cacheRead: 0.26 },
  'kimi-k3.1-pro': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2 },
  'kimi-k3': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
  'kimi-k2.7-code': { input: 0.95, output: 4, cacheRead: 0.19 },
  'longcat-2.0': { input: 0.3, output: 1.2, cacheRead: 0.006 },
  'step-5-preview': { input: 1, output: 2.7, cacheRead: 0.1 },
  'beam-free': { free: true },
  'iceman-contributor-free': { free: true },
  'mimo-v2.6-flash': { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  'mimo-v2.6-pro': { input: 0.435, output: 0.87, cacheRead: 0.003625 },
  'mimo-v2.5': { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  'mimo-v2.5-pro': { input: 0.435, output: 0.87, cacheRead: 0.003625 },
  'minimax-m3.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.015 },
  'minimax-m3': {
    tiers: [
      { upTo: 512000, input: 0.3, output: 1.2, cacheRead: 0.06 },
      { input: 0.6, output: 2.4, cacheRead: 0.12 },
    ],
  },
  'muse-spark-1.3-contributor': { input: 0.1, output: 0.2, cacheRead: 0.002 },
  'muse-spark-1.2-contributor': { input: 0.1, output: 0.2, cacheRead: 0.002 },
  'qwen3.8-max': { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
  'qwen3.8-flash': { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 },
  'qwen3.7-plus': {
    tiers: [
      { upTo: 256000, input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 },
      { input: 1.2, output: 4.8, cacheRead: 0.12, cacheWrite: 1.5 },
    ],
  },
  'deepseek-v4.1-flash': {
    peak: { input: 0.3, output: 1.2, cacheRead: 0.006 },
    offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003 },
  },
  'deepseek-v4-pro': {
    peak: { input: 1.32, output: 3.96, cacheRead: 0.044 },
    offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022 },
  },
  hy4: { input: 0.834, output: 2.501, cacheRead: 0.042 },
  'hy4-preview': { input: 0.834, output: 2.501, cacheRead: 0.042 },
  hy3: { input: 0.14, output: 0.58, cacheRead: 0.035 },
  'grok-4.7': {
    tiers: [
      { upTo: 200000, input: 2, output: 6, cacheRead: 0.5 },
      { input: 4, output: 12, cacheRead: 1 },
    ],
  },
  'gpt-6-luna': {
    tiers: [
      { upTo: 272000, input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      { input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 },
    ],
  },
  'gpt-5.6-luna': {
    tiers: [
      { upTo: 272000, input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
      { input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 },
    ],
  },
  'claude-haiku-5-5': {
    tiers: [
      { upTo: 100000, input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
    ],
  },
  'gemini-4-argon': { input: 2, output: 10, cacheRead: 0.1 },
}

const MODEL_ALIASES = {
  'deepseek/deepseek-v4.1-flash': 'deepseek-v4.1-flash',
  'deepseek/deepseek-v4-pro': 'deepseek-v4-pro',
}

export const name = 'session-cost'
export const inject = ['tools']

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeModel(raw) {
  if (!isNonEmptyString(raw)) return ''
  const lower = raw.trim().toLowerCase()
  if (MODEL_ALIASES[lower] !== undefined) return MODEL_ALIASES[lower]
  if (OPENCODE_GO_PRICES[lower] !== undefined) return lower
  const tail = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower
  return MODEL_ALIASES[tail] ?? tail
}

function isDeepSeekPeak(timeMs) {
  const date = new Date(timeMs)
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

function pickBand(entry, contextTokens, timeMs) {
  if (entry.free === true) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  if (entry.peak !== undefined && entry.offPeak !== undefined) {
    return isDeepSeekPeak(timeMs) ? entry.peak : entry.offPeak
  }
  if (Array.isArray(entry.tiers) && entry.tiers.length > 0) {
    for (const tier of entry.tiers) {
      if (typeof tier.upTo !== 'number' || contextTokens <= tier.upTo) return tier
    }
    return entry.tiers[entry.tiers.length - 1]
  }
  return entry
}

function requestCost({ model, timeMs, usage, prices }) {
  const normalized = normalizeModel(model)
  const entry = prices[normalized]
  if (entry === undefined) return { cost: 0, priced: false }
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const contextTokens = input + cacheRead + cacheWrite
  const band = pickBand(entry, contextTokens, timeMs)
  const priceIn = band.input ?? 0
  const priceOut = band.output ?? 0
  const priceRead = band.cacheRead ?? 0
  const priceWrite = band.cacheWrite ?? priceIn
  const cost = (
    input * priceIn +
    output * priceOut +
    cacheRead * priceRead +
    cacheWrite * priceWrite
  ) / 1e6
  return { cost, priced: true }
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

export function collectSessionCost(session, options = {}) {
  const events = typeof session.ownEvents === 'function' ? session.ownEvents() : session.snapshotEvents?.() ?? []
  const prices = options.prices ?? OPENCODE_GO_PRICES
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
        const priced = requestCost({ model, timeMs, usage, prices })
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
    unpriced_models: report.unpricedModels,
  }
}

const TOKENS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    input_tokens: { type: 'integer' },
    output_tokens: { type: 'integer' },
    cache_read_tokens: { type: 'integer' },
    cache_write_tokens: { type: 'integer' },
  },
  required: ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'],
}

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
    unpriced_models: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'currency', 'total_usd', 'requests', 'turns',
    'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'total_tokens',
    'models', 'turns_detail', 'requests_detail', 'unpriced_models',
  ],
}

function mergePrices(overrides) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return OPENCODE_GO_PRICES
  const merged = { ...OPENCODE_GO_PRICES }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      merged[normalizeModel(key)] = value
    }
  }
  return merged
}

export function apply(ctx, config = {}) {
  const prices = mergePrices(config.prices)

  ctx.tools.register({
    name: TOOL_NAME,
    description: 'Report token usage and estimated USD cost for the current session: total, per task (turn), and per request. Costs come from logged token usage multiplied by the configured per-model price table, so they are estimates, not provider billing. Unpriced models are listed with their tokens and no cost.',
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
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => renderReport({
        requestCount: value.requests,
        turnCount: value.turns,
        totalTokens: value.total_tokens,
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
      const value = outputValue(report)
      // Keep the rendered request list bounded without changing the reported totals.
      const limit = Number.isInteger(args?.requests_limit) ? Math.min(Math.max(args.requests_limit, 1), 500) : DEFAULT_REQUESTS_LIMIT
      value.requests_detail = value.requests_detail.slice(-Math.max(limit, 1))
      return value
    },
  })
}
