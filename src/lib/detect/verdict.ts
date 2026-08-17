/** 检测规则编号 / Detection rule ids. */
export type RuleId = 'D1' | 'D2' | 'D4' | 'D8'

/** 置信度：中为单信号，高为多信号或强信号 / Confidence: medium = single signal, high = multiple or strong signals. */
export type Confidence = 'medium' | 'high'

/** 一条规则命中 / A single rule hit. */
export interface RuleHit {
  rule: RuleId
  confidence: Confidence
  /** 人读证据，供悬停展示与日志 / Human-readable evidence for tooltips and logs. */
  evidence: string[]
}

/** 一个用户的判定结果 / Verdict for one user. */
export interface UserVerdict {
  uid: number
  uname: string
  hits: RuleHit[]
  updatedAt: number
}

/** D1 阈值 / D1 thresholds. */
export interface D1Config {
  /** 复读：窗口内同文本最少出现次数 / Repeat: min occurrences of the same normalized text in the window. */
  repeatMin: number
  /** 节拍：间隔下限，贴平台限速地板 / Cadence: interval floor, hugging the platform rate limit. */
  intervalMinMs: number
  /** 节拍：参与统计的最近间隔数 / Cadence: number of recent intervals sampled. */
  intervalSamples: number
  /** 节拍：变异系数上限 / Cadence: max coefficient of variation. */
  maxCv: number
  cycleMinLen: number
  cycleMaxLen: number
  cycleMinRounds: number
}

/** D4 阈值 / D4 thresholds. */
export interface D4Config {
  /** 趋势统计回看窗 / Trend look-back window. */
  trendWindowMs: number
  /** 趋势资格：最少不同发送者 / Trend qualification: min distinct senders. */
  trendMinUids: number
  /** 趋势资格：最少总条数 / Trend qualification: min total messages. */
  trendMinCount: number
  /** 趋势达成后计入跟风的时限 / How long after qualification a send still counts as a join. */
  joinWindowMs: number
  joinsForMedium: number
  joinsForHigh: number
  /** 平均跟风延迟上限 / Max average join latency. */
  maxAvgLatencyMs: number
}

/** 引擎配置；默认值未经真实数据校准（spec 002 决策 5）/ Engine config; defaults are uncalibrated (spec 002 decision 5). */
export interface DetectConfig {
  userWindowMs: number
  userWindowMax: number
  globalWindowMs: number
  d1: D1Config
  d4: D4Config
  d8: D8Config
}

/** D8 阈值 / D8 thresholds. */
export interface D8Config {
  /** 长文绝对长度下限（字）/ Absolute minimum length for a "long" message. */
  minLen: number
  /** 长文相对房间中位数的倍数 / Multiple of the room median length. */
  lengthRatio: number
  /** 与上下文二元组覆盖度上限，低于判无关 / Max context bigram containment; below means off-topic. */
  overlapMax: number
  /** 窗口内长文无关消息的最少条数 / Min long-off-topic messages in the user window. */
  consecutiveMin: number
  /** 参与上下文的消息条数 / How many recent messages form the context. */
  contextSize: number
}

export const defaultDetectConfig: DetectConfig = {
  userWindowMs: 10 * 60 * 1000,
  userWindowMax: 100,
  globalWindowMs: 60 * 1000,
  d1: {
    repeatMin: 3,
    intervalMinMs: 900,
    intervalSamples: 4,
    maxCv: 0.15,
    cycleMinLen: 2,
    cycleMaxLen: 6,
    cycleMinRounds: 2,
  },
  d4: {
    trendWindowMs: 15 * 1000,
    trendMinUids: 3,
    trendMinCount: 3,
    joinWindowMs: 10 * 1000,
    joinsForMedium: 3,
    joinsForHigh: 5,
    maxAvgLatencyMs: 2000,
  },
  d8: {
    minLen: 30,
    lengthRatio: 2,
    overlapMax: 0.05,
    consecutiveMin: 3,
    contextSize: 50,
  },
}
