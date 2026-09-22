// Additive OMP/Pi extension. Auto-discovered from ~/.omp/agent/extensions/.
// Does not replace orca-agent-status, orca-prefill, or jarvis-memory.
// Future sessions load it at start. A running session needs /reload.
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

const HEARTBEAT_MS = 15000
const MAX_RECORDS = 64
const TOOL = /^[A-Za-z0-9_.:-]{1,40}$/
const WORK: Record<string, true> = {
  before_agent_start: true,
  agent_start: true,
  tool_execution_start: true,
  tool_call: true,
  tool_execution_end: true,
  tool_approval_resolved: true,
}
const APPROVAL: Record<string, true> = {
  tool_approval_requested: true,
  ui_prompt_start: true,
}

export interface SessionIdentity {
  host: string
  sessionId: string
  sessionFile: string
  pid: number
  incarnation: string
  worktreeId: string
  terminalHandle: string
}

export interface LifecycleRecord {
  v: 1
  host: string
  sessionId: string
  sessionFile: string
  pid: number
  incarnation: string
  worktreeId: string
  terminalHandle: string
  phase: string
  lastEvent: string
  lastEventAt: number
  tool: string
  heartbeatAt: number
  closed: boolean
  willContinue: boolean
}

interface SessionManagerLike {
  getSessionId?: () => string
  getSessionFile?: () => string | undefined
}

function managerOf(ctx: unknown): SessionManagerLike | null {
  if (!ctx || typeof ctx !== 'object' || !('sessionManager' in ctx)) return null
  const manager = ctx.sessionManager
  if (!manager || typeof manager !== 'object') return null
  return manager
}

function textOf(value: unknown, max: number): string {
  return typeof value === 'string' && value.length <= max ? value : ''
}

export function stateDir(): string {
  return process.env.CC_OMP_LIFECYCLE_DIR || join(process.env.USERPROFILE || process.env.HOME || '.', '.command-center', 'omp-lifecycle')
}

export function incarnation(): string {
  // /reload re-evaluates this file in the same process; globalThis keeps the incarnation.
  const bag = globalThis as unknown as Record<string, unknown>
  const existing = bag.__ccOmpLifecycleIncarnation
  if (typeof existing === 'string') return existing
  const created = `${process.pid}:${Date.now()}`
  bag.__ccOmpLifecycleIncarnation = created
  return created
}

export function toolName(event: unknown): string {
  if (!event || typeof event !== 'object' || !('toolName' in event)) return ''
  return typeof event.toolName === 'string' && TOOL.test(event.toolName) ? event.toolName : ''
}

export function identity(ctx: unknown): SessionIdentity | null {
  const manager = managerOf(ctx)
  const sessionId = textOf(manager?.getSessionId?.(), 200)
  const sessionFile = textOf(manager?.getSessionFile?.(), 1024)
  if (!sessionId && !sessionFile) return null
  return {
    host: hostname().slice(0, 128),
    sessionId: sessionId || sessionFile,
    sessionFile,
    pid: process.pid,
    incarnation: incarnation(),
    worktreeId: textOf(process.env.ORCA_WORKTREE_ID, 512),
    terminalHandle: textOf(process.env.ORCA_TERMINAL_HANDLE, 128),
  }
}

export function reduce(state: Record<string, unknown>, name: string, event: unknown, now = Date.now()): Record<string, unknown> {
  const next: Record<string, unknown> = { ...state, lastEvent: name, lastEventAt: now, heartbeatAt: now }
  const tool = toolName(event)
  if (name === 'session_start') {
    next.phase = 'unknown'
    next.closed = false
    next.willContinue = false
    next.tool = ''
  } else if (WORK[name]) {
    next.phase = 'working'
    next.closed = false
    next.willContinue = false
    if (tool) next.tool = tool
  } else if (APPROVAL[name]) {
    next.phase = 'action_required'
    next.closed = false
    next.willContinue = false
    next.priorPhase = state.phase || 'unknown'
    if (tool) next.tool = tool
  } else if (name === 'ui_prompt_end') {
    next.phase = state.phase === 'action_required' ? (state.priorPhase || 'unknown') : state.phase
    next.closed = false
  } else if (name === 'agent_end') {
    const cont = !!(event && typeof event === 'object' && 'willContinue' in event && event.willContinue === true)
    next.willContinue = cont
    next.closed = false
    next.phase = cont ? 'working' : 'idle'
    if (!cont) next.tool = ''
  } else if (name === 'session_shutdown') {
    next.phase = 'exited'
    next.closed = true
    next.willContinue = false
  }
  return next
}

export function beat(state: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
  return { ...state, heartbeatAt: now }
}

function fileId(id: SessionIdentity): string {
  return createHash('sha256').update(`${id.host}\0${id.sessionId}\0${id.incarnation}`).digest('hex').slice(0, 16)
}

export function recordBody(id: SessionIdentity, state: Record<string, unknown>): LifecycleRecord {
  const tool = typeof state.tool === 'string' && TOOL.test(state.tool) ? state.tool : ''
  return {
    v: 1,
    host: id.host,
    sessionId: id.sessionId,
    sessionFile: id.sessionFile,
    pid: id.pid,
    incarnation: id.incarnation,
    worktreeId: id.worktreeId,
    terminalHandle: id.terminalHandle,
    phase: typeof state.phase === 'string' ? state.phase : 'unknown',
    lastEvent: typeof state.lastEvent === 'string' ? state.lastEvent : '',
    lastEventAt: typeof state.lastEventAt === 'number' ? state.lastEventAt : 0,
    tool,
    heartbeatAt: typeof state.heartbeatAt === 'number' ? state.heartbeatAt : 0,
    closed: state.closed === true,
    willContinue: state.willContinue === true,
  }
}

function replaceFile(tmp: string, dest: string): void {
  for (let i = 0; i < 5; i++) {
    try {
      renameSync(tmp, dest)
      return
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? err.code : ''
      if (code !== 'EEXIST' && code !== 'EPERM') throw err
      try { unlinkSync(dest) } catch { /* previous file already gone */ }
    }
  }
let timer: NodeJS.Timeout | null = null
}

export function writeRecord(dir: string, body: LifecycleRecord): string {
  mkdirSync(dir, { recursive: true })
  const name = `${fileId(body)}.json`
  const dest = join(dir, name)
  const tmp = `${dest}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, JSON.stringify(body))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    replaceFile(tmp, dest)
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* temp already moved */ }
    throw err
  }
  const names = readdirSync(dir).filter((entry) => entry.endsWith('.json'))
  if (names.length > MAX_RECORDS) {
    const ranked = names
      .map((entry) => ({ entry, mtime: statSync(join(dir, entry)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime)
    for (const old of ranked.slice(0, names.length - MAX_RECORDS)) {
      if (old.entry === name) continue
      try { unlinkSync(join(dir, old.entry)) } catch { /* lost the race */ }
    }
  }
  return dest
}

let timer: ReturnType<typeof setInterval> | null = null
let current: { id: SessionIdentity; state: Record<string, unknown> } | null = null

function publish(ctx: unknown, name: string, event: unknown): void {
  const id = identity(ctx)
  if (!id) return
  current = { id, state: reduce(current?.state || {}, name, event) }
  try { writeRecord(stateDir(), recordBody(current.id, current.state)) } catch { /* status must not block the agent */ }
}

function startBeat(): void {
  if (timer) return
  timer = setInterval(() => {
    if (!current) return
    current = { id: current.id, state: beat(current.state) }
    try { writeRecord(stateDir(), recordBody(current.id, current.state)) } catch { /* next beat retries */ }
  }, HEARTBEAT_MS)
  timer.unref?.()
}

interface ExtensionHost {
  on: (name: string, fn: (event: unknown, ctx: unknown) => void) => void
}

export default function (pi: ExtensionHost): void {
  const names = [
    'session_start', 'before_agent_start', 'agent_start', 'tool_execution_start', 'tool_call',
    'tool_execution_end', 'tool_approval_requested', 'tool_approval_resolved', 'ui_prompt_start',
    'ui_prompt_end', 'agent_end', 'session_shutdown',
  ]
  for (const name of names) {
    try {
      pi.on(name, (event, ctx) => {
        publish(ctx, name, event)
        if (name === 'session_shutdown') {
          if (timer) clearInterval(timer)
          timer = null
          return
        }
        startBeat()
      })
    } catch { /* this runtime does not emit that event */ }
  }
}
