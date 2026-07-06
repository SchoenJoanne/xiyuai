/**
 * social_bestie_unify_smoke.mjs —— 闺蜜名单一事实源统一（SOCIAL_CIRCLE 前置·D3 穿帮雷·确定性零 LLM）
 *
 * ① unify：seedMetaToFactItems(meta,{friendNick}) → profile.friend 用 friendNick（非存量 '小敏'）
 * ② 一致性：character_seed 友名(override) == social_circle.pickFriendAnchor 名（同 companion 同源·穿帮解）
 * ③ 向后兼容：无 opts → 用存量 nickname（旧行为不破）
 * ④ reword：buildSocialPromptHint 指令 '他问起'（非穿帮词 '用户问起'）·guard 死文本 '用户' 保留
 *
 * 🔴 坏版本红验：seedMetaToFactItems 去 opts.friendNick 覆盖 → 友名仍存量'小敏'≠social 名（①②红=穿帮复现）。
 */
import { readFileSync } from 'node:fs';
import { seedMetaToFactItems } from '../src/character_seed.mjs';
import { pickFriendAnchor } from '../src/social_circle.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const meta = { self_facts: { close_friend_anchor: { nickname: '小敏', knows_current_chat_partner: false } } };
const comp = { id: 9001 };
const socialName = pickFriendAnchor(comp).nickname;
const friendOf = (items) => (items.find(i => i.slot === 'profile.friend') || {}).value;

console.log('── ① unify（友名覆盖为 social 源）──');
{
  const items = seedMetaToFactItems(meta, { friendNick: socialName });
  ok(friendOf(items) === socialName, `① override → 友名=social 名「${socialName}」(非'小敏')`);
  ok(friendOf(items) !== '小敏', '① 存量穿帮名「小敏」已被统一覆盖');
}

console.log('── ② 一致性（character_seed 名 == social_circle 名·穿帮解）──');
{
  // 多 companion 各自 id-seeded·两侧同源恒一致
  let allConsistent = true;
  for (const id of [1, 42, 9001, 12345, 88888]) {
    const c = { id };
    const cs = friendOf(seedMetaToFactItems(meta, { friendNick: pickFriendAnchor(c).nickname }));
    if (cs !== pickFriendAnchor(c).nickname) allConsistent = false;
  }
  ok(allConsistent, '② 5 companion：character_seed 友名 == social_circle pickFriendAnchor 名（恒一致·零穿帮）');
}

console.log('── ③ 向后兼容（无 opts → 存量名）──');
{
  ok(friendOf(seedMetaToFactItems(meta)) === '小敏', '③ 无 opts → 用存量 nickname（旧行为字节不破）');
}

console.log('── ④ reword（用户问起 → 他问起·死文本用户保留）──');
{
  const src = readFileSync(new URL('../src/social_circle.mjs', import.meta.url), 'utf8');
  ok(src.includes('他问起你的生活/朋友时'), '④ buildSocialPromptHint 指令已 reword 为「他问起」');
  ok(!src.includes('用户问起你的生活'), '🔴④ 穿帮词「用户问起」已消（真 prompt 文本不豁免）');
  ok(/SOCIAL_USER_LITERAL_RE = \/用户/.test(src), '④ guard 检测 regex 的死文本「用户」保留（guard 豁免只收死文本）');
}

console.log(`\n══ social_bestie_unify smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
