import type { Confidence, RuleId } from '../detect/verdict'
import type { DanmakuRecord } from '../store/danmaku'
import type { IncidentRecord } from '../store/incidents'

/** 一条违规档案的视图模型 / View model for one incident. */
export interface IncidentView {
  ts: number
  rule: RuleId
  ruleName: string
  confidence: Confidence
  evidence: string[]
  roomId: number
  timeText: string
}

/** 一条弹幕记录的视图模型 / View model for one danmaku record. */
export interface DanmakuView {
  ts: number
  text: string
  timeText: string
}

/** 用户页数据 / Data for the user tab. */
export interface UserViewModel {
  uid: number
  uname: string
  /** 最新在前 / Newest first. */
  incidents: IncidentView[]
  danmaku: DanmakuView[]
}

const RULE_NAMES: Record<RuleId, string> = {
  D1: '独轮车复读',
  D2: '不可见字符规避',
  D4: '自动融入跟风',
  D8: '长文无关刷屏',
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 固定格式时间（不用 toLocaleString，避免环境差异）/ Fixed-format time (no toLocaleString, to stay environment-independent). */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** incidents/danmaku → 用户页视图模型；档案按时间倒序 / Build the user-tab view model; incidents sorted newest first. */
export function buildUserViewModel(
  uid: number,
  uname: string,
  incidents: IncidentRecord[],
  danmaku: DanmakuRecord[],
): UserViewModel {
  const incidentViews = [...incidents]
    .sort((a, b) => b.ts - a.ts)
    .map((i) => ({
      ts: i.ts,
      rule: i.rule,
      ruleName: RULE_NAMES[i.rule],
      confidence: i.confidence,
      evidence: i.evidence,
      roomId: i.roomId,
      timeText: formatTime(i.ts),
    }))
  const danmakuViews = danmaku.map((d) => ({
    ts: d.ts,
    text: d.text,
    timeText: formatTime(d.ts),
  }))
  return { uid, uname, incidents: incidentViews, danmaku: danmakuViews }
}
