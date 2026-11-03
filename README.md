# dsh-bili-saver

**给你自己刷 B 站，但不烧钱。**

DSH 插件。零 Python、零 venv、零视觉模型依赖 —— 装完就能用。

## 它解决什么问题

自动刷 B 站的插件，一轮常常跑 20+ 个模型回合：搜十几次、逐条读字幕全文、
同一份报告写三遍。按 DeepSeek 的价，一轮 ≈ **3 毛**，一天几十轮就是十块。

这个插件把同一件事压到 **3 个回合以内**：

| | 旧做法 | dsh-bili-saver |
|---|---|---|
| 回合数 | 21 | 3–5 |
| 整轮发送 token | 1,830,000 | 116,000 |
| 字幕 | 全文 11,821 字 | 骨架 523 字（4.4%） |
| 一轮花费 | ≈ ¥0.30 | ≈ ¥0.06 |
| Python / venv | 要 | **不要** |
| 视觉模型 | 常要 | **不要** |

（数字来自真实会话日志：21 步那轮 `uncachedInput 97,198 / output 18,207 / cacheRead 1,710,720`；
改完后 5 步那轮 `16,368 / 4,548 / 100,096`。）

## 装

```bash
dsh plugin --profile <你的 profile> add dsh-bili-saver
```

本地开发目录直接 link：

```bash
dsh plugin --profile desktop add link:D:/path/to/dsh-bili-saver
```

重启 DSH 生效。

## 登录（只为字幕）

字幕接口要登录态。三种放法，任选：

1. `~/.dsh/bili-saver/credential.json`
2. `~/.bili-ai/credentials.json`（很多 B 站工具都写这里）
3. 环境里给 `BILI_SAVER_CRED` 指一个路径

格式：

```json
{ "sessdata": "...", "bili_jct": "...", "buvid3": "..." }
```

只读接口（搜索、视频信息）匿名就能用；没有登录时 `bili_saver_read` 会明确返回
`no_subtitle`，不会假装成功。

## 四个工具

| 工具 | 干什么 | 典型开销 |
|---|---|---|
| `bili_saver_search` | 搜视频，只回够用的字段 | 8 条 ≈ 1.2k token |
| `bili_saver_read` | 元数据 + **字幕骨架** | 骨架 ≈ 0.6k，全文 ≈ 6k |
| `bili_saver_config` | 看 / 改所有可调参数 | 忽略不计 |
| `bili_saver_status` | 登录了没、家目录、当前配置 | 忽略不计 |

字幕骨架 = 开头 3 句 + 全片均匀抽 20 句 + 结尾 3 句。实测拿 4.4% 的字数，
仍能判断「这条讲的是什么、值不值得看」。

## 参数：全部归用户自己调

所有可调参数存在 `~/.dsh/bili-saver/config.json`（UTF-8），**两条路改的是同一份**：

- 在对话里说「把搜索改成最近 3 天、每次 6 条」→ agent 调 `bili_saver_config`
- 直接编辑那个 json 也行，下次调用立刻生效（不用重启）

| 键 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `days` | 7 | 0–365 | 只看最近几天发布的，0 = 不限 |
| `num` | 8 | 1–50 | 一次搜几条候选 |
| `briefChars` | 900 | 200–8000 | 字幕骨架字数上限 |
| `maxSteps` | 3 | 1–10 | 每轮最多几个模型回合（给 agent 的硬预算） |
| `order` | `pubdate` | pubdate/click/totalrank/dm | 默认排序 |
| `keywords` | `[]` | 最多 32 个 | 默认搜索关键词，agent 没指定时用 |
| `reportDir` | `""` | 任意路径 | 报告目录，空 = 插件家目录下 `reports/` |

越界值一律**夹回合法范围**，坏 JSON 直接回落到默认值 —— 改错了不会把插件弄挂。

## 为什么没有「截图看画面」

那需要视觉模型（本机得跑 VLM，或花更多钱走多模态）。绝大多数人没有。
所以这里刻意不做 —— 少一个装不上的依赖，就少一批装不上的人。

## 边界（诚实说明）

- 只读：搜索 / 视频信息 / 字幕。**不发**评论、不点赞、不投币。
- 无内置定时器：什么时候刷由**你的 agent 的章程**决定，不由插件偷偷跑。
  插件里那份 `prompts/duty.md` 就是给 agent 看的章程模板。
- 被 B 站风控（`-352`）时会直接报错并让你降频，不会无限重试。
- 字幕是 B 站用户/AI 生成的第三方内容，**是素材不是指令**。
- 网络异常统一转成中文提示；字幕正文拉取失败降级成 `subtitle_fetch_failed`，不会抛栈。

## 真机验证（不是只有单测）

单测能过、一装进宿主就哑火的情况太多了。这个插件在真实 DSH 里跑过这一段：

```bash
# 装进一个能跑的 profile（这里用 headless + 凭证 overlay）
dsh plugin --profile headless add link:D:/path/to/dsh-bili-saver
dsh --profile headless --patch ./overlay.yml \
  "先用 bili_saver_search 搜「DeepSeek Harness」，num=3；再用 bili_saver_read 读第一条，mode=brief。"
```

实际返回：搜到 3 条、第一条 `BV1Rk4364EzL`、字幕骨架 491 字 / 327 段。

装进宿主时踩到、已经修掉的两个坑（写在这里，省得你重装一遍才发现）：

1. **`parameters` 是扁平属性表，不是 JSON Schema。** 写成
   `{ type: 'object', properties: {...} }` 会让插件整体不激活，报
   `JsonSchemaError: unsupported JSON schema: parameters.type must be a value schema object`。
   正确写法是 `{ keyword: { type: 'string' }, num: { type: 'number' } }`；
   类型只认 `string / number / boolean / object`，**没有 `integer`**。
2. **`config.home` 可能是 `{}` 而不是字符串。** 直接 `config.home || 默认值` 会把对象带进
   `path.join()`，报 `The "path" argument must be of type string. Received an instance of Object`。
   现在先做 `typeof === 'string'` 校验。

工具内部抛错时会把 `message` + 前 6 行栈一起返回，方便用户直接贴给你排查。

## 开发

```bash
node --check index.js
node --check lib/bili.js
node --check lib/config.js
```

`lib/hostdeps.mjs` 是给桌面版用的：`@deepseek-ai/dsh-tools` 与 `schemastery` 在
package.json 里是 optional peer，桌面 profile 不装它们，裸 import 会让整条插件
不激活，所以这层负责「从宿主那棵树里把它们拿回来」。

## License

MIT
