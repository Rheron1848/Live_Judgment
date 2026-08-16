// 不可见字符集：软连字符 U+00AD、零宽 U+200B-U+200F、方向控制 U+202A-U+202E、词连接符 U+2060-U+2064、BOM U+FEFF。
// 自动化工具用它们绕过平台去重/敏感词，正常输入法不会产出。
// Invisible characters used by automation to evade platform dedup/filters; normal IMEs never produce them.
// 必须写成转义序列，源文件里不得出现字面不可见字符 / Must stay as escape sequences, never literal chars.
const INVISIBLE_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g

/** 列出文本中出现的不可见字符码位（去重）/ List distinct invisible code points present in the text. */
export function findInvisibleChars(text: string): string[] {
  const matches = text.match(INVISIBLE_RE) ?? []
  const codePoints = matches.map(
    (ch) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
  )
  return [...new Set(codePoints)]
}

/** 归一化：剔除不可见字符、折叠空白；跨消息比对一律用它 / Normalize: strip invisible chars and collapse whitespace; basis for all cross-message comparison. */
export function normalizeText(text: string): string {
  return text.replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim()
}
