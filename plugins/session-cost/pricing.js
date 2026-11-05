/**
 * OpenCode Go token prices in USD per 1M tokens.
 * Source: https://opencode.ai/v2/docs/console/go/ ("Usage limits").
 * DeepSeek V4.1 Flash / V4 Pro use peak/off-peak: peak is 01:00-04:00 and
 * 06:00-10:00 UTC, Monday-Friday. Tiers are chosen by context size.
 */
export const OPENCODE_GO_PRICES = {
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

/** Monthly usage limits (USD) on the Go plan, per model. */
export const GO_MONTHLY_LIMITS = {
  'glm-5.3-flash': 60,
  'glm-5.3': 15,
  'glm-5.2': 60,
  'kimi-k3.1-pro': 15,
  'kimi-k3': 15,
  'kimi-k2.7-code': 60,
  'longcat-2.0': 60,
  'step-5-preview': 15,
  'mimo-v2.6-flash': 60,
  'mimo-v2.6-pro': 15,
  'mimo-v2.5': 60,
  'mimo-v2.5-pro': 15,
  'minimax-m3.1-flash': 20,
  'minimax-m3': 60,
  'muse-spark-1.3-contributor': 60,
  'muse-spark-1.2-contributor': 60,
  'qwen3.8-max': 15,
  'qwen3.8-flash': 30,
  'qwen3.7-plus': 60,
  'deepseek-v4.1-flash': 100,
  'deepseek-v4-pro': 15,
  hy4: 60,
  'hy4-preview': 30,
  hy3: 60,
  'grok-4.7': 15,
  'gpt-6-luna': 15,
  'gpt-5.6-luna': 15,
  'claude-haiku-5-5': 15,
  'gemini-4-argon': 30,
}

const MODEL_ALIASES = {
  'deepseek/deepseek-v4.1-flash': 'deepseek-v4.1-flash',
  'deepseek/deepseek-v4-pro': 'deepseek-v4-pro',
}

export function normalizeModel(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return ''
  const lower = raw.trim().toLowerCase()
  if (MODEL_ALIASES[lower] !== undefined) return MODEL_ALIASES[lower]
  if (OPENCODE_GO_PRICES[lower] !== undefined) return lower
  const tail = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower
  return MODEL_ALIASES[tail] ?? tail
}

export function isDeepSeekPeak(timeMs) {
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

export function mergePrices(overrides) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return OPENCODE_GO_PRICES
  }
  const merged = { ...OPENCODE_GO_PRICES }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      merged[normalizeModel(key)] = value
    }
  }
  return merged
}

/** Price one usage record. Returns { cost, priced } for a model/time/usage triple. */
export function costOf({ model, timeMs, usage, prices }) {
  const normalized = normalizeModel(model)
  const entry = prices[normalized]
  if (entry === undefined) return { cost: 0, priced: false, model: normalized }
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
  const cost = (input * priceIn + output * priceOut + cacheRead * priceRead + cacheWrite * priceWrite) / 1e6
  return { cost, priced: true, model: normalized }
}
