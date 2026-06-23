import type { OpsTask } from '../opsDispatch/api'

const TZ = 'Europe/Rome'

export function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return null
  }
}

export function todayKey(): string {
  return dayKey(new Date().toISOString()) || ''
}

export function taskWeeklyEur(task: OpsTask): number {
  const direct = Number(task.payload?.projectedPerWeek)
  if (Number.isFinite(direct) && direct > 0) return direct
  const imp = task.payload?.impact
  if (imp) return ((imp.min + imp.max) / 2) * 7
  return 0
}

export function taskDailyEur(task: OpsTask): number {
  return taskWeeklyEur(task) / 7
}

export function taskEarnedDaily(task: OpsTask): number {
  if (task.status !== 'verified') return 0
  if (task.verification?.verdict !== 'improved') return 0
  return taskDailyEur(task)
}

export function taskEarnedWeekly(task: OpsTask): number {
  return taskEarnedDaily(task) * 7
}

export function taskZoneLabel(task: OpsTask): string {
  const zone = task.payload?.zoneName
  if (zone) return zone.replace(/^.*? — /, '').slice(0, 42)
  return (task.title || 'Action').split(' — ')[0].slice(0, 42)
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export interface TaskStage {
  key: string
  label: string
  pill: string
  bar: string
  text: string
  earned: boolean
}

export function taskStage(task: OpsTask): TaskStage {
  const earned = taskEarnedDaily(task) > 0
  if (task.status === 'verified') {
    if (earned) {
      return {
        key: 'earned',
        label: 'EARNED',
        pill: 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300',
        bar: 'bg-emerald-400',
        text: 'text-emerald-300',
        earned: true,
      }
    }
    return {
      key: 'verified',
      label: 'NO CHANGE',
      pill: 'bg-gray-700/40 border-gray-600 text-gray-400',
      bar: 'bg-gray-500',
      text: 'text-gray-400',
      earned: false,
    }
  }
  if (task.status === 'completed') {
    return {
      key: 'done',
      label: 'DONE',
      pill: 'bg-green-500/15 border-green-400/50 text-green-300',
      bar: 'bg-green-400',
      text: 'text-green-300',
      earned: false,
    }
  }
  if (task.status === 'acknowledged') {
    return {
      key: 'ack',
      label: 'ON IT',
      pill: 'bg-violet-500/15 border-violet-400/50 text-violet-300',
      bar: 'bg-violet-400',
      text: 'text-violet-300',
      earned: false,
    }
  }
  return {
    key: 'dispatched',
    label: 'DISPATCHED',
    pill: 'bg-amber-500/15 border-amber-400/50 text-amber-300',
    bar: 'bg-amber-400',
    text: 'text-amber-300',
    earned: false,
  }
}

export function taskEvidenceLine(task: OpsTask): string {
  const who = task.assignedName || task.roleLabel
  if (task.status === 'verified' && task.verification?.summary) {
    return task.verification.summary
  }
  if (task.status === 'completed' || task.status === 'verified') {
    const proof = task.proof?.note
    return proof ? `${who} · "${proof.slice(0, 60)}"` : `${who} marked done`
  }
  if (task.status === 'acknowledged') {
    return `${who} acknowledged on Telegram`
  }
  return `${who} · sent via Telegram`
}

export function tasksToday(tasks: OpsTask[]): OpsTask[] {
  const today = todayKey()
  return tasks
    .filter(t => t.status !== 'open' && dayKey(t.createdAt) === today)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}
