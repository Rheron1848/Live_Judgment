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

  private evict(now: number): void {
    const cutoff = now - this.maxAgeMs
    let drop = 0
    while (drop < this.items.length && this.items[drop].ts < cutoff) drop++
    if (this.items.length - drop > this.maxCount) drop = this.items.length - this.maxCount
    if (drop > 0) this.items.splice(0, drop)
  }
}
