/**
 * config.js —— 集中管理 dsh-bili-saver 插件的用户可调参数。
 *
 * 为什么单独抽一个模块：搜索天数、单次条数、字幕骨架字数上限、每轮模型回合上限、
 * 排序方式、默认关键词、报告目录这些参数，插件运行时（采集/总结）和插件自带的
 * 设置页都要读写同一份 config.json。把这些字段的默认值、取值范围、读写逻辑集中
 * 到这一个文件里，可以让插件与设置页共用同一套校验规则，避免两处各写一份默认值
 * 导致行为不一致。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 默认配置：不要在调用方直接修改本对象，需要副本请用 loadConfig 的返回值 */
export const DEFAULTS = Object.freeze({
  days: 7,
  num: 8,
  briefChars: 900,
  maxSteps: 3,
  order: 'pubdate',
  keywords: [],
  reportDir: '',
});

/** 允许的排序方式 */
const ORDERS = new Set(['pubdate', 'click', 'totalrank', 'dm']);
/** 关键词数量上限 */
const MAX_KEYWORDS = 32;

/** 拷贝一份 DEFAULTS 的深拷贝，避免调用方直接改到冻结的 DEFAULTS */
function cloneDefaults() {
  return {
    days: DEFAULTS.days,
    num: DEFAULTS.num,
    briefChars: DEFAULTS.briefChars,
    maxSteps: DEFAULTS.maxSteps,
    order: DEFAULTS.order,
    keywords: [...DEFAULTS.keywords],
    reportDir: DEFAULTS.reportDir,
  };
}

/** 整数字段校验：非数字、非整数、越界都回落到默认值 */
function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

/** 关键词数组校验：必须字符串数组；去空白、去重、最多 MAX_KEYWORDS 个 */
function clampKeywords(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/** 对任意输入对象做完整校验，返回合法配置 */
function clamp(raw) {
  const base = cloneDefaults();
  if (!raw || typeof raw !== 'object') return base;

  base.days = clampInt(raw.days, 0, 365, DEFAULTS.days);
  base.num = clampInt(raw.num, 1, 50, DEFAULTS.num);
  base.briefChars = clampInt(raw.briefChars, 200, 8000, DEFAULTS.briefChars);
  base.maxSteps = clampInt(raw.maxSteps, 1, 10, DEFAULTS.maxSteps);
  base.order = ORDERS.has(raw.order) ? raw.order : DEFAULTS.order;
  base.keywords = clampKeywords(raw.keywords, DEFAULTS.keywords);
  base.reportDir = typeof raw.reportDir === 'string' ? raw.reportDir : DEFAULTS.reportDir;

  return base;
}

/**
 * 读配置：读取 home/config.json；文件不存在、读不到或 JSON 解析失败都返回默认深拷贝；
 * 读到的值逐项过校验，非法字段回落到默认值。
 */
export function loadConfig(home) {
  const file = path.join(home, 'config.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (errRead) {
    return cloneDefaults();
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (errParse) {
    return cloneDefaults();
  }
  return clamp(raw);
}

/**
 * 写配置：把 patch 合并进当前配置、过校验后原子写入（先写 config.json.tmp 再 rename），
 * 返回 { ok, config, changed }。失败时不破坏原文件，ok=false。
 */
export function saveConfig(home, patch) {
  const current = loadConfig(home);
  const merged = clamp({
    ...current,
    ...(patch && typeof patch === 'object' ? patch : {}),
  });
  const changed = JSON.stringify(merged) !== JSON.stringify(current);

  const file = path.join(home, 'config.json');
  const tmp = file + '.tmp';
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true, config: merged, changed };
  } catch (errWrite) {
    try {
      fs.unlinkSync(tmp);
    } catch (errClean) {
      // 忽略清理临时文件时的错误
    }
    return { ok: false, config: current, changed: false };
  }
}