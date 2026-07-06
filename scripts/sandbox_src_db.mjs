/**
 * fail-closed 源库解析（chip①·2026-07-03·PIPL 结构修）。
 *
 * 起因：sandbox.mjs / burst_eval.mjs / stress_chat.mjs（本机 local·.git/info/exclude）历史默认
 *   兜底到 `/opt/xiyu-ai-new/data/bot.db`——忘带参数即把生产真实对话拷进 /tmp（超授权·PIPL 敞口）。
 *
 * 本模块**入库**（durable·公开仓受益；untracked 的护栏挡不住 fresh clone 的下一个人）：任何
 *   sandbox / eval 工具解析"要拷哪个源库"都过这里——**无显式 `SANDBOX_SRC_DB`（sandbox 亦接受
 *   `DB_PATH`）即抛错**，绝不默认指生产。调用方在 catch 里打印用法并退出（fail-closed）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
export class SandboxSrcError extends Error {
  constructor(msg) { super(msg); this.name = 'SandboxSrcError'; }
}

/**
 * 解析 sandbox/eval 工具的源库路径（fail-closed）。
 * @param {object} env  通常 process.env
 * @param {{allowDbPath?: boolean, script?: string}} opts  allowDbPath: 是否接受 DB_PATH 作源（sandbox.mjs = true；burst_eval/stress_chat = false）
 * @returns {string} 显式指定的源库路径
 * @throws {SandboxSrcError} 未显式指定即抛（绝不默认生产）
 */
export function resolveSandboxSrcDb(env = {}, { allowDbPath = false, script = '<脚本>' } = {}) {
  // SANDBOX_SRC_DB = 唯一无条件显式入口。
  // 🔴 DB_PATH 兜底（仅 allowDbPath）**只在指向 /tmp/ 时接受**——否则生产机 .env 的
  //    DB_PATH=生产库（sandbox.mjs 走 dotenv 会加载它）会变成新的隐式兜底（Fable5 chip①
  //    复核指出的坑口）。非 /tmp/ 的 DB_PATH 一律视同未设 → 走 fail-closed。
  const dbPathOk = allowDbPath && typeof env.DB_PATH === 'string' && env.DB_PATH.startsWith('/tmp/');
  const src = env.SANDBOX_SRC_DB || (dbPathOk ? env.DB_PATH : null);
  if (!src) {
    throw new SandboxSrcError(
      '未指定源 DB — fail-closed：绝不默认指向生产库（防误拷 PIPL 真实对话到 /tmp）。\n' +
      `  用法：SANDBOX_SRC_DB=/path/to/合成或临时.db node scripts/${script}` +
      (allowDbPath ? '\n  （本脚本亦接受 DB_PATH，但**仅当其指向 /tmp/**——防生产机 .env 的 DB_PATH 成隐式兜底）' : '') +
      '\n  🔴 如确需用生产库，须显式 SANDBOX_SRC_DB=/opt/xiyu-ai-new/data/bot.db（PIPL：拷生产=超授权，慎用）。'
    );
  }
  return src;
}
