import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Live Judgment - B站直播弹幕治理助手',
        namespace: 'live-judgment',
        description: '识别并标记直播间内的独轮车、自动融入等异常发言行为，支持弹幕记录、快捷处置与屏蔽词过滤',
        match: ['*://live.bilibili.com/*'],
        'run-at': 'document-idle',
      },
    }),
  ],
})
