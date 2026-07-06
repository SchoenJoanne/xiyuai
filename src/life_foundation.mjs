/**
 * life_foundation.mjs —— 她的「静态生活地基」：现居城市 / 城内片区 / 学校·职业槽位，
 * 确定性查表派生（🔴 不调 LLM）。同 voice 枚举智慧：把「每次现编」从结构上消除——
 * 生成一次存字段、之后永远读同一个值、跨对话恒定。系统派生·用户不可选（a）。
 *
 * 🔴 灰度闸 LIFE_FOUNDATION 默认关 = 零变更先验（派生/回填/注入三处同门控）。
 * 🔴 绝不报真实专名（池子都是城市通名/职业类型/大学类型，无「浙江大学」「腾讯」）。
 * 🔴 现居城市避开老家省份（companion5「没回老家·留在这座城市」的离家在外质感）。
 *
 * 边界：本模块只管 derive-side（picks home_city/life_district/life_field_idx）。
 * 真正的措辞组合（idx→专业/职业、按 live life_identity 自适应）在 companion.mjs（零依赖纯函数）内联，
 * 故「专业池/职业池」只活在 companion.mjs；本模块不持有，杜绝词表双源。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

export function isLifeFoundationOn() {
  return /^(1|true|on|yes)$/i.test(process.env.LIFE_FOUNDATION || '');
}

// 🔴 纯新一线 12 城（去一线 cliché：北上广深作「她的城市」悬浮——房价/压力联想太重，用户会算她怎么负担；
//    新一线对「读书/刚工作的年轻女孩」最可信有质感）。都是城市通名，无任何校名/公司名。
export const CITY_POOL = Object.freeze(['杭州', '成都', '南京', '武汉', '西安', '苏州', '长沙', '重庆', '青岛', '厦门', '天津', '郑州']);
// 城→省（仅「现居避开老家省」用，只需覆盖池内城市）
const CITY_PROVINCE = Object.freeze({
  杭州: '浙江', 成都: '四川', 南京: '江苏', 武汉: '湖北', 西安: '陕西', 苏州: '江苏',
  长沙: '湖南', 重庆: '重庆', 青岛: '山东', 厦门: '福建', 天津: '天津', 郑州: '河南',
});
export const DISTRICT_POOL = Object.freeze(['城东', '城西', '城南', '城北', '老城区', '大学城']);
// life_field_idx 槽位数 = 专业池/职业池长度（companion.mjs 两池须同长，smoke 锁）。
export const FIELD_SLOTS = 6;

// 省份名（从 persona_fact 抽老家省·避开）。
const PROVINCES = Object.freeze(['浙江', '江苏', '广东', '山东', '河南', '四川', '湖北', '湖南', '河北',
  '福建', '安徽', '江西', '陕西', '山西', '云南', '贵州', '广西', '辽宁', '黑龙江', '吉林', '甘肃',
  '内蒙古', '新疆', '重庆', '天津', '上海', '北京', '海南', '宁夏', '青海', '西藏']);

// id-seeded 确定性抽（同 routine_profiles 个体落点风格：防「一个样」+ 可复现可测 + 跨对话恒定）。
// 🔴 P3-15（有限池碰撞=设计内可接受·勿"修"）：有限池 %poolLen 必然产生跨 companion 落点重复（城市
//   1/12、地区/字段类同）。判定=无感：companion 跨用户不可见（用户看不到彼此的她）；同用户多 companion
//   撞同城也不违和（两人可同城·池为城市通名无专名）。加熵/去相关会改动【存量已派生地基】（LIFE_FOUNDATION
//   本就默认关的 cosmetic 层）=churn>value → 保持确定性有限池派生不动，仅此注释存档处置。
function pick(poolLen, id, salt) {
  const h = (((Number(id) || 0) * 2654435761 + salt * 40503) >>> 0);
  return h % poolLen;
}

/** 从 persona_facts 抽老家省（family 类或含老家/家乡词的 fact 里的省名）·没有返 null。 */
export function extractHometownProvince(facts = []) {
  const blob = (Array.isArray(facts) ? facts : [])
    .filter(f => f && (f.category === 'family' || /老家|家乡|出生|长大/.test(String(f.content || ''))))
    .map(f => String(f.content || '')).join(' ');
  for (const p of PROVINCES) if (blob.includes(p)) return p;
  return null;
}

/**
 * 确定性派生地基（纯函数·id-seeded·跨对话恒定）。
 * @returns {{home_city, life_district, life_field_idx}}  life_field_idx=0..5（措辞在 companion.mjs 按 identity 切池组合）
 */
export function deriveLifeFoundation(companion, { avoidProvince = null } = {}) {
  const id = Number(companion?.id) || 0;
  // 城市：避开老家省（离家在外质感）；过滤后为空则退回全池（绝不卡死）。
  let cities = CITY_POOL;
  if (avoidProvince) {
    const filtered = CITY_POOL.filter(c => CITY_PROVINCE[c] !== avoidProvince);
    if (filtered.length) cities = filtered;
  }
  const home_city = cities[pick(cities.length, id, 17)];
  const life_district = DISTRICT_POOL[pick(DISTRICT_POOL.length, id, 29)];
  const life_field_idx = pick(FIELD_SLOTS, id, 53);   // 0..5·身份无关槽位；具体专业/职业词由 companion.mjs 按 live identity 切池组合（防漂移=满足验红#6）
  return { home_city, life_district, life_field_idx };
}
