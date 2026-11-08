import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * Register the plugin against a throwaway profile and return the tool, so tests
 * talk to the same `execute` seam a real agent uses.
 */
function loadTool() {
  let tool
  const ctx = {
    tools: {
      register(definition) {
        tool = definition
      },
    },
    get() {
      return undefined
    },
    effect() {
      throw new Error('this test does not compose session projections')
    },
  }
  apply(ctx, { sessionsDir: mkdtempSync(path.join(tmpdir(), 'session-cost-test-')) })
  return tool
}

/** `hy3` is flat-priced, so a request costs the same at any wall-clock time. */
function request({ time, model = 'hy3', input = 0, turn = 1, step = 1 }) {
  return {
    type: 'assistant/message',
    time,
    data: {
      turn,
      step,
      usage: { inputTokens: input, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      message: { source: { provider: 'opencode-go', model } },
    },
  }
}

async function run(events) {
  const tool = loadTool()
  return tool.execute({ detail: 'summary' }, {
    agent: { session: { id: 'session-under-test', ownEvents: () => events } },
  })
}

test('five-hour window excludes requests made more than five hours ago', async () => {
  const now = Date.now()
  const value = await run([
    request({ time: now - 6 * HOUR_MS, input: 1_000_000, step: 1 }),
    request({ time: now - 10 * 60 * 1000, input: 1_000_000, step: 2 }),
  ])

  // $0.14 per 1M input tokens on hy3: only the request inside the window counts.
  assert.ok(
    Math.abs(value.five_hour_usd - 0.14) < 1e-9,
    `expected 5h window to exclude the 6h-old request, got $${value.five_hour_usd}`,
  )
  // Both requests still happened this week and this month.
  assert.ok(Math.abs(value.week_usd - 0.28) < 1e-9, `week: $${value.week_usd}`)
  assert.ok(Math.abs(value.month_usd - 0.28) < 1e-9, `month: $${value.month_usd}`)
})

test('weekly window excludes requests made more than seven days ago', async () => {
  const now = Date.now()
  const value = await run([
    request({ time: now - 8 * DAY_MS, input: 1_000_000, step: 1 }),
    request({ time: now - 10 * 60 * 1000, input: 1_000_000, step: 2 }),
  ])

  assert.ok(
    Math.abs(value.week_usd - 0.14) < 1e-9,
    `expected week window to exclude the 8-day-old request, got $${value.week_usd}`,
  )
  // The 8-day-old request is last month when today is early in the month, so the
  // monthly assertion deliberately only pins the recent request.
  assert.ok(value.month_usd >= 0.14 - 1e-9, `month: $${value.month_usd}`)
})

test('monthly window excludes usage from the previous calendar month', async () => {
  const now = Date.now()
  const nowDate = new Date(now)
  const monthStart = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1)
  const value = await run([
    request({ time: monthStart - HOUR_MS, input: 1_000_000, step: 1 }),
    request({ time: now - 10 * 60 * 1000, input: 1_000_000, step: 2 }),
  ])

  assert.ok(
    Math.abs(value.month_usd - 0.14) < 1e-9,
    `expected month window to exclude last month's request, got $${value.month_usd}`,
  )
})

test('monthly limit is applied to provider-prefixed model names', async () => {
  const now = Date.now()
  const value = await run([
    request({ time: now - 60_000, model: 'deepseek/deepseek-v4.1-flash', input: 1_000_000 }),
  ])

  const rows = value.monthly_usage.filter((entry) => entry.model.includes('v4.1-flash'))
  assert.equal(rows.length, 1, `expected one monthly row, got ${JSON.stringify(value.monthly_usage)}`)
  const [row] = rows
  assert.equal(row.limit_usd, 100, 'GO_MONTHLY_LIMITS entry must apply to the prefixed model')
  assert.ok(row.month_usd > 0, `expected a priced month total, got $${row.month_usd}`)
  assert.ok(Math.abs(row.ratio - row.month_usd / 100) < 1e-12, `ratio: ${row.ratio}`)
})

