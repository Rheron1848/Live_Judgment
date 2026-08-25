import type { ActionResult } from './http'

const REPORT_MENU_TEXT = '举报选中弹幕'

function clickLike(el: HTMLElement): void {
  // 官方菜单按点击位置定位，合成事件带上元素坐标 / The official menu positions itself by click coords, so pass the element's rect.
  const r = el.getBoundingClientRect()
  el.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: r.x + r.width / 2,
      clientY: r.y + r.height / 2,
    }),
  )
}

async function waitFor<T>(fn: () => T | null, timeoutMs = 2000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 80))
  }
  return null
}

/**
 * 驱动官方举报面板：点弹幕用户名唤出 .danmaku-menu，再点「举报选中弹幕」。
 * 只负责打开面板（.danmaku-report-panel），理由选择与最终提交留给用户在官方 UI 完成——不直调接口（sign/id_str 有逆向风险）。
 * Drive the official report flow: click the danmaku username to open .danmaku-menu, then click "举报选中弹幕".
 * Only opens the panel (.danmaku-report-panel); reason selection and submission stay with the user in the official UI.
 */
export async function openOfficialReport(item: HTMLElement): Promise<ActionResult> {
  const doc = item.ownerDocument
  const name = item.querySelector<HTMLElement>('.user-name')
  if (!name) return { ok: false, message: '未找到弹幕用户名区域' }
  clickLike(name)

  const menuItem = await waitFor(() => {
    const menu = doc.querySelector('.danmaku-menu')
    if (!menu) return null
    return (
      [...menu.querySelectorAll<HTMLElement>('*')].find(
        (e) => e.children.length === 0 && e.textContent?.includes(REPORT_MENU_TEXT),
      ) ?? null
    )
  })
  if (!menuItem) return { ok: false, message: '官方弹幕菜单未出现或没有举报项' }
  clickLike(menuItem)

  const panel = await waitFor(() => doc.querySelector('.danmaku-report-panel'))
  if (!panel) return { ok: false, message: '官方举报面板未出现' }
  return { ok: true, message: '已打开官方举报面板，请在面板内选择理由并自行提交' }
}
