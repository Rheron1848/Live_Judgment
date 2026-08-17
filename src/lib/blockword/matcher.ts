import type { BlockWordEntry } from '../store/blockwords'

/** 编译后的屏蔽词匹配器 / Compiled block-word matcher. */
export interface BlockWordMatcher {
  test(text: string): boolean
}

/**
 * 编译全局组（roomId=0）∪ 当前房间组的词条；其他房间的词条不参与匹配（跨房间语义可能相反）。
 * 普通词按大小写不敏感的包含匹配；正则编译失败时降级为字面包含（决策 6）。
 * Compile entries from the global group (roomId=0) and the current room; other rooms never match.
 * Plain words match case-insensitively by inclusion; invalid regexes degrade to literal inclusion.
 */
export function compileBlockWords(
  entries: BlockWordEntry[],
  currentRoomId: number,
): BlockWordMatcher {
  const testers: Array<(text: string) => boolean> = []
  for (const entry of entries) {
    if (entry.roomId !== 0 && entry.roomId !== currentRoomId) continue
    if (!entry.word) continue
    if (entry.isRegex) {
      try {
        const re = new RegExp(entry.word, 'i')
        testers.push((text) => re.test(text))
        continue
      } catch (err) {
        console.warn(
          `[LiveJudgment] invalid block-word regex "${entry.word}", falling back to literal match`,
          err,
        )
      }
    }
    const needle = entry.word.toLowerCase()
    testers.push((text) => text.toLowerCase().includes(needle))
  }
  return { test: (text) => testers.some((t) => t(text)) }
}
