/** 按时间与条数双上限的滑动窗口 / Sliding window bounded by both age and count. */
export class SlidingWindow<T extends { ts: number }> {
  private items: T[] = []

  constructor(
    private readonly maxAgeMs: number,
    private readonly maxCount = Number.POSITIVE_INFINITY,
  ) {}

  push(item: T): void {
    this.items.push(item)
    this.evict(item.ts)
  }

  values(): readonly T[] {
    return this.items
  }

  /** 当前条数 / Current item count. */
  get size(): number {
    return this.items.length
  }

  /** 按外部时刻主动驱逐过期项（sweep/GC 用，无新事件时也能收缩）/ Evict stale items against an external clock (for sweep/GC without new events). */
  prune(now: number): void {
    this.evict(now)
  }

  private evict(now: number): void {
    const cutoff = now - this.maxAgeMs
    let drop = 0
    while (drop < this.items.length && this.items[drop].ts < cutoff) drop++
    if (this.items.length - drop > this.maxCount) drop = this.items.length - this.maxCount
    if (drop > 0) this.items.splice(0, drop)
  }
}
