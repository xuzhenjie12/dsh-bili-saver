/**
 * dsh-bili-saver —— 省钱版「替你刷 B站」
 * ============================================================================
 * 三件小事，每一件都是为了把一轮的 token 压下来：
 *
 *   1. `bili_saver_search`  一次给回「已经筛过」的候选（默认 8 条、近 7 天、按最新）
 *   2. `bili_saver_read`    视频信息 + **字幕骨架**（开头 3 句 + 均匀 20 句 + 结尾 3 句）
 *   3. `bili_saver_config`  看 / 改所有可调参数（用户自己调，不用改代码）
 *   4. `bili_saver_status`  有没有登录 / 家目录在哪
 *
 * 可调参数集中在家目录的 config.json（lib/config.js 负责校验），
 * 用户可以在对话里让 agent 调，也可以直接编辑那个 json —— 两条路改的是同一份。
 * ============================================================================
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadHostDeps } from './lib/hostdeps.mjs'
import { BiliSaver } from './lib/bili.js'
import { DEFAULTS, loadConfig, saveConfig } from './lib/config.js'

export const name = 'bili-saver'
export const inject = ['tools']

const hostDeps = await loadHostDeps()
const z = hostDeps.z
const defineTool = hostDeps.defineTool

export const Config = !z ? undefined : z.object({
  enabled: z.boolean().default(true).description('打开这个插件').extra('volatile', true),
  home: z.string().default('').description('插件家目录，留空用 ~/.dsh/bili-saver').extra('volatile', true),
})

/** 允许的排序方式（schema 之外再做一次白名单，防止宿主跳过校验时把非法值发给 B站） */
const ORDER_OK = new Set(['pubdate', 'click', 'totalrank', 'dm'])

const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
}

export function apply(ctx, config = {}) {
  if (config.enabled === false) return

  // 宿主传进来的 config.home 可能是 {} 之类的非字符串（schemastery 默认值没落成字符串），一律类型校验
  const homeArg = typeof config.home === 'string' ? config.home.trim() : ''
  const home = homeArg || join(homedir(), '.dsh', 'bili-saver')
  const bili = new BiliSaver({ home })
  const tool = (spec) => {
    const inner = spec.execute
    return ctx.tools.register(defineTool({
      ...spec,
      // 出错了也要把栈带回来：宿主默认只回 message，定位不到哪一行
      execute: async (a, c) => {
        try { return await inner(a, c) } catch (e) {
          return {
            ok: false,
            error: String(e?.message ?? e),
            stack: String(e?.stack ?? '').split('\n').slice(0, 6).join('\n'),
          }
        }
      },
      output: textOutput,
    }))
  }
  // 每次调用都重新读，用户改完 json 立刻生效，不用重启
  const cfg = () => loadConfig(home)

  tool({
    name: 'bili_saver_search',
    description: '搜 B站 视频，只回「够用的字段」（BV/标题/UP/播放/时长/发布时间）。'
      + '默认值来自用户配置（近 N 天、N 条、排序）。一次 8 条 ≈ 1.2k token。',
    parameters: {
      keyword: { type: 'string', description: '关键词' },
      num: { type: 'number', description: '几条（默认取配置里的 num）' },
      order: { type: 'string', enum: ['pubdate', 'click', 'totalrank', 'dm'], description: '排序，默认取配置' },
      days: { type: 'number', description: '只要最近几天发布的（0 = 不限）' },
    },
    async execute(args) {
      const c = cfg()
      const keyword = String(args.keyword ?? '').trim()
      if (!keyword) return { ok: false, error: 'keyword 是空的' }
      const num = Math.min(50, Math.max(1, Number(args.num) || c.num))
      // days 一律先转数字再判断：模型/调用方传 "3" 这种字符串时不能被静默丢掉
      const daysNum = Number(args.days)
      const days = args.days === undefined || args.days === null || args.days === ''
        ? c.days
        : (Number.isFinite(daysNum) ? Math.max(0, Math.min(365, Math.trunc(daysNum))) : c.days)
      const orderArg = String(args.order ?? '')
      const order = ORDER_OK.has(orderArg) ? orderArg : c.order
      const list = await bili.search(keyword, { num, order, days })
      return { ok: true, keyword, num, days, order, count: list.length, items: list }
    },
  })

  tool({
    name: 'bili_saver_read',
    description: '读一条视频：元数据 + 字幕骨架（默认取配置里的 briefChars，含开头/中段抽样/结尾）。'
      + '没有字幕会返回 no_subtitle —— **这不等于没内容**。mode="full" 返回全文，只在必须逐句核对时用。',
    parameters: {
      bvid: { type: 'string', description: 'BV 号' },
      mode: { type: 'string', enum: ['brief', 'full'], description: '默认 brief' },
      maxChars: { type: 'number', description: 'brief 字数上限，默认取配置' },
    },
    async execute(args) {
      const c = cfg()
      const bvid = String(args.bvid ?? '').trim()
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return { ok: false, error: 'bvid 格式不对（形如 BV1xx411F7uh）' }
      const meta = await bili.view(bvid)
      const sub = await bili.subtitle(bvid, {
        mode: args.mode === 'full' ? 'full' : 'brief',
        maxChars: Number(args.maxChars) || c.briefChars,
        cid: meta.cid,
      })
      return { ok: true, video: meta, subtitle: sub }
    },
  })

  tool({
    name: 'bili_saver_config',
    description: '看/改这个插件的所有可调参数（days 搜索天数、num 每次几条、briefChars 字幕骨架字数、'
      + 'maxSteps 每轮最多几个模型回合、order 排序、keywords 默认关键词、reportDir 报告目录）。'
      + '不传 set 就是只读；传了 set 就合并进去并原子写盘。越界值会被夹回合法范围。',
    parameters: {
      set: {
        type: 'object',
        additionalProperties: true,
        description: '要改的字段，例如 {"days":3,"num":6}',
      },
    },
    async execute(args) {
      const patch = args.set && typeof args.set === 'object' ? args.set : null
      if (!patch) return { ok: true, config: cfg(), defaults: DEFAULTS, home }
      const r = saveConfig(home, patch)
      return { ...r, home, defaults: DEFAULTS }
    },
  })

  tool({
    name: 'bili_saver_status',
    description: '看这个插件能不能用：是否已登录（字幕需要）、家目录、当前配置。',
    parameters: {},
    async execute() {
      return {
        ok: true,
        loggedIn: bili.loggedIn(),
        home,
        config: cfg(),
        hint: bili.loggedIn()
          ? '已登录，字幕可用'
          : '还没登录：把 B站的 SESSDATA / bili_jct 存成 ' + join(home, 'credential.json'),
      }
    },
  })

  for (const note of hostDeps.notes) {
    try { ctx.logger?.info?.(note) } catch { /* 没有 logger 就算了 */ }
  }
}
