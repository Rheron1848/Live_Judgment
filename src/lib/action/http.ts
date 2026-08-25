/** 官方处置的统一结果：ok + B 站原始 message 透传（spec 008 风险控制：失败不静默）。
 *  Unified result for official actions: ok + Bilibili's raw message passed through (never silent on failure). */
export interface ActionResult {
  ok: boolean
  code?: number
  message: string
}

/** 从页面 cookie 读 csrf（bili_jct）；仅在页面内使用，不打日志、不出页面。
 *  Read csrf (bili_jct) from the page cookie; used in-page only, never logged or sent elsewhere. */
export function readCsrf(): string {
  return document.cookie.match(/bili_jct=([^;]+)/)?.[1] ?? ''
}

/** 构造 x-www-form-urlencoded body：业务字段 + 自动补 csrf/csrf_token（B 站写接口惯例两个都要）。
 *  Build a form body: business fields + csrf/csrf_token appended (Bilibili write APIs expect both). */
export function buildFormBody(fields: Record<string, string | number>, csrf: string): string {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) body.set(k, String(v))
  body.set('csrf', csrf)
  body.set('csrf_token', csrf)
  return body.toString()
}

/** B 站响应归一化：code===0 成功；失败透传 message（msg 兜底）；异常结构不抛错。
 *  Normalize a Bilibili response: code===0 means ok; failures pass message through (msg as fallback); never throws on odd shapes. */
export function normalizeResult(json: unknown): ActionResult {
  const obj = (json ?? {}) as { code?: number; message?: string; msg?: string }
  const code = typeof obj.code === 'number' ? obj.code : undefined
  const message = obj.message || obj.msg || (code === 0 ? '' : '未知错误')
  return { ok: code === 0, code, message }
}

/** POST 表单并归一化；网络层错误（含被拦截）也归一为失败结果，不向调用方抛异常。
 *  POST a form and normalize; network-level errors (incl. interception) also normalize to a failure result. */
export async function postForm(
  url: string,
  fields: Record<string, string | number>,
): Promise<ActionResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildFormBody(fields, readCsrf()),
    })
    return normalizeResult(await res.json())
  } catch (err) {
    return { ok: false, message: String(err) }
  }
}

/** GET JSON（只读接口）；失败返回 null 由调用方按「查询失败」处理。
 *  GET JSON (read-only endpoints); returns null on failure so callers can treat it as "query failed". */
export async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    return await res.json()
  } catch {
    return null
  }
}
