import { spawn } from 'node:child_process'
import path from 'node:path'

const TOOL_NAME = 'agy_dispatch'
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const MAX_TIMEOUT_MS = 60 * 60 * 1000
const MAX_CAPTURE_CHARS = 4 * 1024 * 1024
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MODES = ['accept-edits', 'auto', 'plan']

export const name = 'agy-dispatch'
export const inject = ['tools']

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function pick(value, allowed) {
  return isNonEmptyString(value) && allowed.includes(value) ? value : undefined
}

function buildSettings(config = {}) {
  const effort = pick(config.defaultEffort, EFFORTS)
  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
    ? Math.min(Math.max(Math.round(config.timeoutMs), 1000), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS
  return {
    command: isNonEmptyString(config.command) ? config.command : 'agy',
    defaultModel: isNonEmptyString(config.defaultModel) ? config.defaultModel : undefined,
    defaultEffort: effort,
    timeoutMs,
    skipPermissions: config.skipPermissions === true,
    addDirs: Array.isArray(config.addDirs) ? config.addDirs.filter(isNonEmptyString) : [],
  }
}

function resolveTimeoutMs(args, settings) {
  const raw = args.timeout_ms
  if (raw === undefined) return settings.timeoutMs
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error('timeout_ms must be a number of milliseconds')
  }
  return Math.min(Math.max(Math.round(raw), 1000), MAX_TIMEOUT_MS)
}

async function resolveBaseCwd(ctx, exec) {
  const workingDirectory = ctx.get('workingDirectory')
  if (workingDirectory !== undefined && exec.agent !== undefined) {
    try {
      const directory = await workingDirectory.ensure(exec.agent, exec.signal)
      if (isNonEmptyString(directory)) return directory
    } catch {
      // Fall through to the process directory.
    }
  }
  return process.cwd()
}

function resolveDir(dir, base) {
  return path.isAbsolute(dir) ? path.normalize(dir) : path.resolve(base, dir)
}

function buildArgv(args, settings, cwd) {
  const task = typeof args.task === 'string' ? args.task.trim() : ''
  if (task.length === 0) throw new Error('task must be a non-empty string')
  if (args.effort !== undefined && !EFFORTS.includes(args.effort)) {
    throw new Error(`effort must be one of ${EFFORTS.join(', ')}`)
  }
  if (args.mode !== undefined && !MODES.includes(args.mode)) {
    throw new Error(`mode must be one of ${MODES.join(', ')}`)
  }
  if (args.continue === true && isNonEmptyString(args.conversation)) {
    throw new Error('continue and conversation cannot be combined')
  }

  const argv = ['--print', task, '--output-format', 'json']
  const model = isNonEmptyString(args.model) ? args.model : settings.defaultModel
  if (model !== undefined) argv.push('--model', model)
  if (isNonEmptyString(args.agent)) argv.push('--agent', args.agent)
  const effort = pick(args.effort, EFFORTS) ?? settings.defaultEffort
  if (effort !== undefined) argv.push('--effort', effort)
  if (isNonEmptyString(args.mode)) argv.push('--mode', args.mode)
  if (args.continue === true) argv.push('--continue')
  if (isNonEmptyString(args.conversation)) argv.push('--conversation', args.conversation)
  if (args.skip_permissions === true || settings.skipPermissions) {
    argv.push('--dangerously-skip-permissions')
  }
  const addDirs = [
    ...settings.addDirs,
    ...(Array.isArray(args.add_dirs) ? args.add_dirs.filter(isNonEmptyString) : []),
  ]
  for (const dir of addDirs) argv.push('--add-dir', resolveDir(dir, cwd))
  return argv
}

function killQuietly(child) {
  try {
    child.kill()
  } catch {
    // The process may already have exited.
  }
}

function runProcess({ command, argv, cwd, timeoutMs, signal }) {
  return new Promise((resolve) => {
    let settled = false
    let child
    let timer
    let killTimer
    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let aborted = false
    let onAbort = () => {}

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      signal.removeEventListener('abort', onAbort)
      child?.removeAllListeners('close')
      child?.removeAllListeners('error')
    }

    const finish = (outcome) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(outcome)
    }

    const append = (chunk, into) => {
      const text = chunk.toString()
      if (into === 'out') {
        if (stdout.length >= MAX_CAPTURE_CHARS) {
          truncated = true
          return
        }
        stdout += text.slice(0, MAX_CAPTURE_CHARS - stdout.length)
        if (stdout.length >= MAX_CAPTURE_CHARS) truncated = true
      } else {
        if (stderr.length >= 20000) return
        stderr += text.slice(0, 20000 - stderr.length)
      }
    }

    try {
      child = spawn(command, argv, {
        cwd,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ spawnError: error })
      return
    }

    onAbort = () => {
      aborted = true
      killQuietly(child)
      killTimer = setTimeout(() => killQuietly(child), 3000)
    }
    signal.addEventListener('abort', onAbort, { once: true })

    timer = setTimeout(() => {
      timedOut = true
      killQuietly(child)
      killTimer = setTimeout(() => killQuietly(child), 3000)
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => append(chunk, 'out'))
    child.stderr?.on('data', (chunk) => append(chunk, 'err'))
    child.on('error', (error) => finish({ spawnError: error }))
    child.on('close', (code, closeSignal) => {
      finish({ code, closeSignal, stdout, stderr, timedOut, aborted, truncated })
    })
  })
}

function parsePayload(raw) {
  const text = raw.trim()
  if (text.length === 0) return undefined
  const tryParse = (candidate) => {
    try {
      const value = JSON.parse(candidate)
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  const whole = tryParse(text)
  if (whole !== undefined) return whole
  const lines = text.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    const value = tryParse(line)
    if (value !== undefined) return value
  }
  return undefined
}

function failureDetail(outcome, payload) {
  const pieces = []
  if (payload !== undefined) {
    if (isNonEmptyString(payload.error)) pieces.push(payload.error.trim())
    if (isNonEmptyString(payload.status)) pieces.push(`status ${payload.status}`)
  }
  if (outcome.timedOut) pieces.push('agy did not finish within the timeout')
  else if (outcome.aborted) pieces.push('agy task was aborted')
  else if (outcome.code !== 0) pieces.push(`agy exited with code ${outcome.code}`)
  const stderrTail = (outcome.stderr ?? '').trim()
  if (stderrTail.length > 0) pieces.push(`stderr: ${stderrTail.slice(-1500)}`)
  const stdoutTail = (outcome.stdout ?? '').trim()
  if (pieces.length === 0 && stdoutTail.length > 0) pieces.push(stdoutTail.slice(-1500))
  if (pieces.length === 0) pieces.push('agy returned no result')
  return pieces.join('; ')
}

function buildValue(payload, outcome, requestedModel) {
  const value = {
    response: isNonEmptyString(payload.response) ? payload.response : '',
    status: isNonEmptyString(payload.status) ? payload.status : 'SUCCESS',
  }
  if (isNonEmptyString(payload.conversation_id)) value.conversation_id = payload.conversation_id
  if (Number.isFinite(payload.duration_seconds)) value.duration_seconds = payload.duration_seconds
  if (Number.isFinite(payload.num_turns)) value.num_turns = payload.num_turns
  if (isNonEmptyString(requestedModel)) value.model = requestedModel
  if (payload.usage !== null && typeof payload.usage === 'object' && !Array.isArray(payload.usage)) {
    const usage = {}
    for (const [key, entry] of Object.entries(payload.usage)) {
      if (Number.isFinite(entry)) usage[key] = entry
    }
    if (Object.keys(usage).length > 0) value.usage = usage
  }
  if (outcome.truncated) value.truncated = true
  return value
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    response: { type: 'string', description: "agy's final answer text." },
    status: { type: 'string' },
    conversation_id: { type: 'string' },
    duration_seconds: { type: 'number' },
    num_turns: { type: 'integer' },
    model: { type: 'string' },
    truncated: { type: 'boolean' },
    usage: { type: 'object', additionalProperties: true },
  },
  required: ['response'],
}

function renderResult(_args, value) {
  const parts = [value.response.length > 0 ? value.response : '(agy returned no text response)']
  const notes = []
  if (value.conversation_id !== undefined) notes.push(`conversation ${value.conversation_id}`)
  if (value.model !== undefined) notes.push(value.model)
  if (value.duration_seconds !== undefined) notes.push(`${value.duration_seconds.toFixed(1)}s`)
  if (notes.length > 0) parts.push(`\n\n[agy: ${notes.join(' · ')}]`)
  if (value.truncated === true) parts.push('\n\n[agy output truncated]')
  return [{ type: 'text', text: parts.join('') }]
}

function presentCall(args) {
  const task = args !== null && typeof args === 'object' && typeof args.task === 'string' ? args.task.trim() : ''
  const title = task.length > 90 ? `${task.slice(0, 87)}...` : task.length > 0 ? task : 'agy task'
  return { card: 'generic', title, kind: 'execute', rawInput: task }
}

export function apply(ctx, config = {}) {
  const settings = buildSettings(config)

  ctx.tools.register({
    name: TOOL_NAME,
    description: "Run one task through the Antigravity `agy` CLI in non-interactive print mode and return agy's final answer. Use it to delegate a self-contained coding, research, or analysis task to agy instead of doing it here. The call blocks until agy finishes, and agy may modify files in the chosen working directory. Returns agy's response text and the agy conversation id.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task: {
          type: 'string',
          description: 'Self-contained task prompt for agy. agy cannot see this conversation, so include every relevant path, requirement, and expected result.',
        },
        model: {
          type: 'string',
          description: "agy model id, e.g. gemini-3.8-flash-high, claude-sonnet-4-6, or gpt-oss-120b-medium. Any id printed by `agy models` works. Omit to use agy's default model.",
        },
        agent: {
          type: 'string',
          description: "agy agent name to run the task with (agy --agent). Omit for agy's default agent.",
        },
        effort: {
          type: 'string',
          enum: EFFORTS,
          description: 'Reasoning effort for the agy session.',
        },
        mode: {
          type: 'string',
          enum: MODES,
          description: "agy execution mode: 'accept-edits', 'auto', or 'plan'.",
        },
        cwd: {
          type: 'string',
          description: 'Working directory for agy. Relative paths resolve against the session working directory; defaults to the session working directory.',
        },
        add_dirs: {
          type: 'array',
          items: { type: 'string' },
          description: "Extra directories to add to agy's workspace (repeatable --add-dir).",
        },
        continue: {
          type: 'boolean',
          description: "Continue agy's most recent conversation instead of starting a new one.",
        },
        conversation: {
          type: 'string',
          description: 'Resume a specific agy conversation id. Cannot be combined with continue.',
        },
        skip_permissions: {
          type: 'boolean',
          description: "Pass agy's --dangerously-skip-permissions flag to auto-approve its tool requests. Leave false unless the task must run unattended.",
        },
        timeout_ms: {
          type: 'number',
          description: 'Maximum time to wait for agy before terminating it. Default 600000 (10 minutes).',
        },
      },
      required: ['task'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: renderResult,
    },
    presentCall,
    async execute(args, exec) {
      const values = args !== null && typeof args === 'object' ? args : {}
      const timeoutMs = resolveTimeoutMs(values, settings)
      const base = await resolveBaseCwd(ctx, exec)
      const cwd = isNonEmptyString(values.cwd) ? resolveDir(values.cwd, base) : base
      const argv = buildArgv(values, settings, cwd)
      const requestedModel = isNonEmptyString(values.model) ? values.model : settings.defaultModel

      if (exec.signal.aborted) throw new Error('agy task aborted before dispatch')
      const outcome = await runProcess({
        command: settings.command,
        argv,
        cwd,
        timeoutMs,
        signal: exec.signal,
      })

      if (outcome.spawnError !== undefined) {
        const reason = outcome.spawnError.code === 'ENOENT'
          ? `cannot find the agy executable "${settings.command}"`
          : outcome.spawnError.message
        throw new Error(`failed to start agy: ${reason}. Install agy or set the plugin's command config to its full path.`)
      }

      const payload = parsePayload(outcome.stdout ?? '')
      if (payload === undefined) {
        if (outcome.timedOut || outcome.aborted || outcome.code !== 0) {
          throw new Error(`agy failed: ${failureDetail(outcome, undefined)}`)
        }
        const text = (outcome.stdout ?? '').trim()
        if (text.length === 0) throw new Error('agy produced no output')
        return { response: text, status: 'SUCCESS', ...(outcome.truncated ? { truncated: true } : {}) }
      }

      const failed = outcome.timedOut || outcome.aborted || outcome.code !== 0 ||
        (isNonEmptyString(payload.status) && payload.status !== 'SUCCESS') ||
        isNonEmptyString(payload.error)
      if (failed) throw new Error(`agy failed: ${failureDetail(outcome, payload)}`)

      return buildValue(payload, outcome, requestedModel)
    },
  })
}
