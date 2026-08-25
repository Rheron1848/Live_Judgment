import { type ActionResult, getJson, postForm } from './http'

const MODIFY_URL = 'https://api.bilibili.com/x/relation/modify'
const RELATION_URL = 'https://api.bilibili.com/x/relation'

// act 枚举来自官方 space bundle 反解（spec 008 接口实测第 2 条）。
// The act enum was reversed from the official space bundle (spec 008, verified endpoints §2).
export const ACT_BLOCK = 5
export const ACT_UNBLOCK = 6
const ATTRIBUTE_BLOCKED = 128

/** 拉黑/解除拉黑的表单字段；re_src/gaia_source/spmid 沿用直播间 bundle 的关系类调用惯例（埋点参数，无语义）。
 *  Form fields for block/unblock; re_src/gaia_source/spmid mirror the live-room bundle's relation calls (tracking only). */
export function buildBlockFields(fid: number, block: boolean): Record<string, string | number> {
  return {
    fid,
    act: block ? ACT_BLOCK : ACT_UNBLOCK,
    re_src: 0,
    gaia_source: 'web_main',
    spmid: '444.8',
  }
}

/** 解析单用户关系查询：attribute=128 即已拉黑；查询失败返回 undefined（调用方按「状态未知」处理）。
 *  Parse a single-user relation query: attribute=128 means blocked; undefined on query failure ("state unknown"). */
export function parseBlocked(json: unknown): boolean | undefined {
  const obj = (json ?? {}) as { code?: number; data?: { attribute?: number } }
  if (obj.code !== 0 || typeof obj.data?.attribute !== 'number') return undefined
  return obj.data.attribute === ATTRIBUTE_BLOCKED
}

export async function setBlock(fid: number, block: boolean): Promise<ActionResult> {
  return postForm(MODIFY_URL, buildBlockFields(fid, block))
}

export async function getBlocked(fid: number): Promise<boolean | undefined> {
  const json = await getJson(`${RELATION_URL}?fid=${fid}`)
  return parseBlocked(json)
}
