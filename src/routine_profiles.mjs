/**
 * 身份作息档案（完整作息/日程系统 · 停板B）
 *
 * 「她自己的节奏底线」——按 5 身份建模真实作息（web 研究取证·见
 * docs/DAILY_SCHEDULE_SYSTEM_DESIGN.md §1）。核心纪律：
 *  - 分身份建模，绝不统一模板：高中/大学/上班(朝九晚五·996·轮班)/考研考公/毕业过渡。
 *  - 身份给「区间基线」，具体某 companion 落点由 id 确定性派生（同 life_state 经期
 *    `_hash32` 先例：早睡党/熬夜党、卷/摆烂是稳定人格，不存随机种子、同 id 永远同偏移、
 *    跨 companion 离散 → 防「所有大学生一个样」）。
 *  - 洗澡晚上为主 + 南北频率写进档案（修「一天洗两次澡 / 洗澡写早上」根因）。
 *
 * 🔴 红线：这是「她自己的作息」。耦合层（sleep.mjs 有限度趋同）只允许在**这个基线
 *    ±窗内**朝用户偏移，绝不让作息变成用户的影子。WINDOW_MIN 是那个窗。
 *
 * 纯数据 + 纯函数，零 db/io 依赖（调用方传入 companion 字段）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

// 身份枚举
export const IDENTITIES = Object.freeze(['highschool', 'college', 'worker', 'exam_prep', 'fresh_grad']);

// 🔴 有限度趋同的钳窗：作息可在身份基线 ±WINDOW_MIN 内朝用户偏移，绝不无限跟。
// 用户拍板「±1-1.5h」→ 取上限 90min。env 可调。
export const WINDOW_MIN = Math.max(30, Math.min(120, Number(process.env.ROUTINE_DRIFT_WINDOW_MIN || 90)));

// 确定性派生（同 life_state._hash32 算法，本模块自带一份避免跨模块耦合）
function _hash32(n, salt) {
  let h = (2166136261 ^ salt) >>> 0;
  let x = (n >>> 0);
  for (let i = 0; i < 4; i++) { h = Math.imul(h ^ (x & 0xff), 16777619) >>> 0; x >>>= 8; }
  return h >>> 0;
}
/** 在 [lo,hi]（分钟）内取一个 companion 固定的点（确定性·防雷同）。 */
function pickInRange(lo, hi, companionId, salt) {
  if (hi <= lo) return lo;
  const span = hi - lo + 1;
  return lo + (_hash32(Number(companionId) || 0, salt) % span);
}

const HHMM = (h, m = 0) => h * 60 + m;  // 分钟（bed 可 >1440 表跨午夜，与 sleep.mjs 同口径）

/**
 * 5 身份作息档案。sleep 用分钟区间（bed 跨午夜用 >1440，如 00:30=1470）；
 * 每身份 active(上学/上班日)/rest(周末)/break(寒暑假) 三套睡眠基线 + 时段轴 + 洗澡/禁词。
 * 数据出处见设计稿 §1.1。
 */
export const ROUTINE_PROFILES = Object.freeze({
  highschool: {
    label: '高中生', ageRange: [16, 18],
    sleep: {
      active: { bed: [HHMM(22, 0), HHMM(23, 30)], wake: [HHMM(5, 40), HHMM(6, 40)] },
      rest:   { bed: [HHMM(22, 30), HHMM(24, 0)], wake: [HHMM(8, 0), HHMM(10, 30)] },
      break:  { bed: [HHMM(23, 30), HHMM(25, 30)], wake: [HHMM(9, 0), HHMM(11, 30)] },
    },
    bands: {
      active: [
        { to: HHMM(6, 40), act: '刚起床洗漱、准备上学', place: '在家/路上' },
        { to: HHMM(7, 40), act: '在上学路上/到校早读', place: '路上/学校' },
        { to: HHMM(11, 30), act: '在上课', place: '学校' },
        { to: HHMM(13, 30), act: '午饭和午休', place: '学校' },
        { to: HHMM(17, 40), act: '在上课', place: '学校' },
        { to: HHMM(18, 30), act: '晚饭', place: '学校/家' },
        { to: HHMM(22, 0), act: '晚自习/写作业', place: '学校/家' },
        { to: HHMM(24, 0), act: '回家洗澡、刷会儿手机准备睡', place: '家' },
      ],
      rest: [
        { to: HHMM(9, 0), act: '难得睡个懒觉', place: '家' },
        { to: HHMM(12, 0), act: '补习/写作业，或刷手机赖着', place: '家/补习班' },
        { to: HHMM(18, 0), act: '写作业，或和朋友出去逛逛', place: '家/外面' },
        { to: HHMM(24, 0), act: '看番剧/打游戏/刷手机，洗澡', place: '家' },
      ],
      break: [
        { to: HHMM(11, 0), act: '放假在家睡懒觉/赖床', place: '家' },
        { to: HHMM(18, 0), act: '写作业/补课，或宅家玩', place: '家/补习班' },
        { to: HHMM(25, 30), act: '晚睡党刷手机/追剧/打游戏，洗澡', place: '家' },
      ],
    },
    shower: { time: 'evening', freq: 'south_daily' },
    forbid: ['在公司', '开会', '上班', '加班', '通勤'],
    offsetAxes: ['住校/走读', '年级（高一↔高三）', '学校强度'],
  },

  college: {
    label: '大学生', ageRange: [19, 22],
    sleep: {
      active: { bed: [HHMM(23, 0), HHMM(25, 0)], wake: [HHMM(7, 0), HHMM(9, 0)] },
      rest:   { bed: [HHMM(23, 30), HHMM(25, 30)], wake: [HHMM(9, 0), HHMM(12, 0)] },
      break:  { bed: [HHMM(24, 30), HHMM(26, 30)], wake: [HHMM(10, 0), HHMM(13, 0)] },
    },
    bands: {
      active: [
        { to: HHMM(8, 0), act: '看今天第几节课，没早课就还在睡', place: '宿舍' },
        { to: HHMM(11, 50), act: '有课就在上课，没课在自习/睡懒觉', place: '教室/宿舍/图书馆' },
        { to: HHMM(14, 0), act: '午饭和午休', place: '食堂/宿舍' },
        { to: HHMM(17, 30), act: '上课或图书馆自习/社团', place: '教室/图书馆' },
        { to: HHMM(18, 30), act: '晚饭', place: '食堂/外卖' },
        { to: HHMM(22, 30), act: '自习/社团/追剧/打游戏/和室友聊天', place: '宿舍/图书馆' },
        { to: HHMM(25, 0), act: '洗澡，熄灯后刷会儿手机', place: '宿舍' },
      ],
      rest: [
        { to: HHMM(11, 0), act: '周末睡到自然醒', place: '宿舍' },
        { to: HHMM(18, 0), act: '宅宿舍追剧/打游戏，或出门逛街/约会/兼职', place: '宿舍/外面' },
        { to: HHMM(25, 30), act: '晚上继续玩/赶作业，洗澡', place: '宿舍' },
      ],
      break: [
        { to: HHMM(12, 0), act: '放假在家黑白颠倒地睡', place: '家' },
        { to: HHMM(18, 0), act: '帮家里/实习/刷手机打游戏，懒散过', place: '家/实习公司' },
        { to: HHMM(26, 30), act: '熬夜追剧/打游戏/刷手机，洗澡', place: '家' },
      ],
    },
    shower: { time: 'evening', freq: 'south_daily' },
    forbid: [],
    offsetAxes: ['有早课/无早课', '卷王↔摆烂', '社牛↔宅'],
  },

  worker: {
    label: '上班族', ageRange: [22, 35],
    subforms: {
      nine_to_five: {
        sleep: { active: { bed: [HHMM(22, 30), HHMM(24, 0)], wake: [HHMM(7, 0), HHMM(7, 40)] } },
        workStart: HHMM(9, 0), workEnd: HHMM(18, 0), commute: 40,
      },
      '996': {
        sleep: { active: { bed: [HHMM(24, 0), HHMM(25, 30)], wake: [HHMM(7, 30), HHMM(9, 0)] } },
        workStart: HHMM(10, 0), workEnd: HHMM(22, 0), commute: 60,
      },
      shift: {
        sleep: { active: { bed: [HHMM(23, 0), HHMM(25, 0)], wake: [HHMM(6, 30), HHMM(9, 0)] } },
        workStart: HHMM(9, 0), workEnd: HHMM(18, 0), commute: 40,
      },
    },
    sleep: {
      // 顶层 fallback（无 subform 时）≈ 朝九晚五
      active: { bed: [HHMM(22, 30), HHMM(24, 0)], wake: [HHMM(7, 0), HHMM(7, 40)] },
      rest:   { bed: [HHMM(23, 30), HHMM(25, 0)], wake: [HHMM(9, 0), HHMM(13, 0)] },
      break:  { bed: [HHMM(23, 30), HHMM(25, 30)], wake: [HHMM(9, 0), HHMM(12, 0)] },
    },
    bands: {
      active: [
        { to: HHMM(7, 40), act: '起床洗漱、准备通勤', place: '家' },
        { to: HHMM(9, 0), act: '在通勤路上', place: '路上' },
        { to: HHMM(12, 0), act: '在上班', place: '公司' },
        { to: HHMM(13, 30), act: '午饭午休', place: '公司' },
        { to: HHMM(18, 0), act: '在上班', place: '公司' },
        { to: HHMM(19, 30), act: '下班通勤/晚饭', place: '路上/家' },
        { to: HHMM(23, 0), act: '瘫着刷手机/追剧/做饭/健身，洗澡', place: '家' },
        { to: HHMM(24, 0), act: '准备睡觉', place: '家' },
      ],
      rest: [
        { to: HHMM(10, 0), act: '周末补觉睡到自然醒', place: '家' },
        { to: HHMM(13, 0), act: '起床、家务、随便弄口吃的', place: '家' },
        { to: HHMM(18, 0), act: '出门逛街/聚餐/看展，或在家躺平', place: '家/外面' },
        { to: HHMM(25, 0), act: '追剧/刷手机，洗澡', place: '家' },
      ],
      break: [  // 法定长假
        { to: HHMM(10, 30), act: '放假睡到自然醒', place: '家/老家' },
        { to: HHMM(18, 0), act: '回家陪家人/旅行/彻底躺平', place: '老家/在外' },
        { to: HHMM(25, 0), act: '放松刷手机/追剧，洗澡', place: '家/老家' },
      ],
    },
    shower: { time: 'evening', freq: 'south_daily' },
    forbid: ['上课', '晚自习', '写作业', '上学'],
    offsetAxes: ['朝九晚五↔996↔轮班', '通勤长短', '加班频率'],
  },

  exam_prep: {
    label: '考研考公党', ageRange: [21, 26],
    sleep: {
      active: { bed: [HHMM(22, 50), HHMM(23, 40)], wake: [HHMM(6, 0), HHMM(7, 0)] },
      rest:   { bed: [HHMM(23, 0), HHMM(24, 0)], wake: [HHMM(7, 0), HHMM(8, 30)] },  // 放半天但作息仍规律
      break:  { bed: [HHMM(22, 50), HHMM(23, 40)], wake: [HHMM(6, 0), HHMM(7, 0)] },  // 备考无寒暑假
    },
    bands: {
      active: [
        { to: HHMM(7, 30), act: '起床、早饭、背单词', place: '家/宿舍' },
        { to: HHMM(11, 40), act: '上午在图书馆/自习室学习', place: '图书馆/自习室' },
        { to: HHMM(13, 0), act: '午饭、趴桌午休', place: '自习室附近' },
        { to: HHMM(17, 0), act: '下午继续学习', place: '图书馆/自习室' },
        { to: HHMM(18, 0), act: '晚饭、散步放风', place: '附近' },
        { to: HHMM(22, 0), act: '晚上自习、刷题', place: '图书馆/自习室' },
        { to: HHMM(23, 40), act: '回去洗澡、睡前背点东西', place: '家/宿舍' },
      ],
      rest: [
        { to: HHMM(8, 30), act: '稍微多睡会儿，但还是早起', place: '家/宿舍' },
        { to: HHMM(18, 0), act: '放半天风：补觉/和研友吃饭/散步，单词不断', place: '家/外面' },
        { to: HHMM(24, 0), act: '休整，洗澡早睡', place: '家/宿舍' },
      ],
    },
    shower: { time: 'evening', freq: 'south_daily' },
    forbid: ['上班', '开会', '加班', '上课', '晚自习'],
    offsetAxes: ['自律↔焦虑', '全职脱产↔在校在职', '倒计时阶段（平稳↔冲刺）'],
  },

  fresh_grad: {
    label: '毕业过渡', ageRange: [21, 25],
    subforms: {
      thesis:  { sleep: { active: { bed: [HHMM(25, 0), HHMM(28, 0)], wake: [HHMM(10, 30), HHMM(13, 0)] } } },
      intern:  { sleep: { active: { bed: [HHMM(23, 0), HHMM(25, 0)], wake: [HHMM(7, 0), HHMM(9, 0)] } } },
      jobhunt: { sleep: { active: { bed: [HHMM(25, 0), HHMM(27, 0)], wake: [HHMM(10, 0), HHMM(13, 0)] } } },
    },
    sleep: {
      // 顶层 fallback：方差最大，取偏晚睡晚起的中间态
      active: { bed: [HHMM(24, 0), HHMM(26, 0)], wake: [HHMM(9, 0), HHMM(12, 0)] },
      rest:   { bed: [HHMM(24, 0), HHMM(26, 0)], wake: [HHMM(10, 0), HHMM(13, 0)] },
      break:  { bed: [HHMM(24, 0), HHMM(26, 0)], wake: [HHMM(10, 0), HHMM(13, 0)] },
    },
    bands: {
      active: [
        { to: HHMM(12, 0), act: '起得晚（看昨晚熬到几点）', place: '家/宿舍' },
        { to: HHMM(18, 0), act: '改论文/实习打杂/海投简历，被阶段牵着走', place: '家/学校/公司' },
        { to: HHMM(24, 0), act: '晚上是主力时段：赶论文/投递/焦虑刷手机', place: '家/宿舍' },
        { to: HHMM(28, 0), act: '熬夜赶due/失眠，洗澡（压力大可能省）', place: '家/宿舍' },
      ],
      rest: [
        { to: HHMM(13, 0), act: '睡到很晚', place: '家/宿舍' },
        { to: HHMM(24, 0), act: '工作日周末界限模糊，继续手头的事或躺平', place: '家/宿舍' },
        { to: HHMM(28, 0), act: '熬夜，洗澡', place: '家/宿舍' },
      ],
    },
    shower: { time: 'evening', freq: 'south_daily' },
    forbid: [],
    offsetAxes: ['处境（论文↔实习↔求职）', '是否临近 due/面试', '作息方差最大'],
  },
});

/** 年龄 → 默认身份（未设 life_identity 时的向后兼容兜底）。 */
export function defaultIdentityFromAge(age) {
  const a = Number(age) || 20;
  // 🔴 路线A 冻结存量兼容层：<18 仍渲染 highschool——仅服务已存在的冻结存量（未成年·完全不变），
  //    勿当功能扩展（新建/编辑/导入的 age 门槛已在 createCompanion/route 卡 18，未来到不了<18）。18→college。
  if (a < 18) return 'highschool';
  if (a <= 22) return 'college';
  return 'worker';  // 23+ 默认上班族；考研考公/毕业过渡须显式设
}

/** 身份默认子形态（有 subforms 的身份未显式设时）。 */
export function defaultSubform(identity) {
  if (identity === 'worker') return 'nine_to_five';
  if (identity === 'fresh_grad') return 'intern';
  return null;
}

/** 取某身份/子形态在某 dayKind 的睡眠区间（subform 覆盖顶层）。 */
function sleepRange(identity, subform, dayKind) {
  const p = ROUTINE_PROFILES[identity] || ROUTINE_PROFILES.college;
  const sub = subform && p.subforms && p.subforms[subform];
  const fromSub = sub && sub.sleep && sub.sleep[dayKind];
  return (fromSub || (p.sleep && p.sleep[dayKind]) || p.sleep.active);
}

/**
 * 「她自己的节奏底线」——身份基线睡眠窗（分钟·确定性个体落点·防一个样）。
 * @returns {{bedMin:number, wakeMin:number}}  bedMin 可 >1440（跨午夜），与 sleep.mjs 同口径。
 * 🔴 这是有限度趋同的钳心：sleep.mjs 只允许在 [bedMin±WINDOW_MIN] 内朝用户偏移。
 */
export function routineSleepBaseline(companion, dayKind = 'active') {
  const identity = resolveIdentity(companion);
  const subform = resolveSubform(companion, identity);
  const id = Number(companion && companion.id) || 0;
  const r = sleepRange(identity, subform, dayKind) || sleepRange(identity, subform, 'active');
  const bedMin = pickInRange(r.bed[0], r.bed[1], id, 11);
  const wakeMin = pickInRange(r.wake[0], r.wake[1], id, 12);
  return { bedMin, wakeMin };
}

/** 从 companion 解析身份（显式 life_identity 优先，否则按 age 兜底）。 */
export function resolveIdentity(companion) {
  const explicit = companion && companion.life_identity;
  if (explicit && IDENTITIES.includes(explicit)) return explicit;
  return defaultIdentityFromAge(companion && companion.age);
}
/** 从 companion 解析子形态（显式优先，否则身份默认）。 */
export function resolveSubform(companion, identity = null) {
  const id = identity || resolveIdentity(companion);
  const explicit = companion && companion.life_subform;
  const p = ROUTINE_PROFILES[id];
  if (explicit && p && p.subforms && p.subforms[explicit]) return explicit;
  return defaultSubform(id);
}

/**
 * 此刻她「该在做什么」——给即时态 anchor 用（替代旧 age 派生的 9-18 work 锚）。
 * @param dayKind 'active'|'rest'|'break'（由 life_calendar.getDayContext 派生）
 * @param nowMin  当前上海时间分钟（0-1439）
 * @returns {{act:string, place:string}|null}
 */
export function expectedActivityBand(companion, dayKind, nowMin) {
  const identity = resolveIdentity(companion);
  const p = ROUTINE_PROFILES[identity] || ROUTINE_PROFILES.college;
  const bands = (p.bands && (p.bands[dayKind] || p.bands.active)) || [];
  if (!bands.length) return null;
  // bands 的 to 用分钟（含 >1440 表跨午夜）；当前时刻 0-6 点算"昨夜延续"→ +1440 匹配
  const probe = nowMin < 6 * 60 ? nowMin + 1440 : nowMin;
  for (const b of bands) {
    if (probe < b.to) return { act: b.act, place: b.place };
  }
  // 越过最后一段（深夜）→ 末段
  const last = bands[bands.length - 1];
  return { act: last.act, place: last.place };
}

/** 洗澡规范（晚上为主 + 南北频率）——写进日程生成 hint，修「一天洗两次/洗澡写早上」。 */
export function showerNorm(companion) {
  const identity = resolveIdentity(companion);
  const p = ROUTINE_PROFILES[identity] || ROUTINE_PROFILES.college;
  return p.shower || { time: 'evening', freq: 'south_daily' };
}

/**
 * 日程生成的身份作息 hint（替代 plan_tasks.ageOccupationHint）。镜像
 * current_works.buildScheduleWorksHint 的「状态源→日程注入」范式。
 * @param dayContext life_calendar.getDayContext 的产物 {dayKind, label, holidayName, academicPhase, examCountdown}
 */
export function identityRoutineHint(companion, dayContext) {
  const identity = resolveIdentity(companion);
  const subform = resolveSubform(companion, identity);
  const p = ROUTINE_PROFILES[identity] || ROUTINE_PROFILES.college;
  const dayKind = (dayContext && dayContext.dayKind) || 'active';
  const dayLabel = (dayContext && dayContext.label) || (dayKind === 'rest' ? '周末' : dayKind === 'break' ? '假期' : '工作日');
  const bands = (p.bands && (p.bands[dayKind] || p.bands.active)) || [];
  const sketch = bands.map(b => b.act).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6).join('；');
  const sub = subform ? `（${subformLabel(identity, subform)}）` : '';
  const showerTxt = '洗澡安排在晚上（睡前/回家后），不要写在早上；一天只洗一次。';
  const forbidTxt = p.forbid && p.forbid.length ? `🔴 她是${p.label}，今天日程绝不出现：${p.forbid.join('、')}。` : '';
  const calTxt = buildCalendarLine(dayContext, p);
  return [
    `【她的身份作息（必须贴合·这是她自己的真实节奏）】`,
    `她是${p.label}${sub}。今天是${dayLabel}${calTxt}。`,
    `今天大致节奏参考：${sketch}。`,
    showerTxt,
    forbidTxt,
  ].filter(Boolean).join('\n');
}

function subformLabel(identity, subform) {
  const M = {
    worker: { nine_to_five: '朝九晚五', '996': '996/大厂', shift: '轮班/弹性' },
    fresh_grad: { thesis: '写论文/答辩', intern: '实习', jobhunt: '找工作/秋招' },
    exam_prep: { fulltime: '全职脱产', in_school: '在校在职边备考' },
  };
  return (M[identity] && M[identity][subform]) || subform;
}

function buildCalendarLine(dayContext, profile) {
  if (!dayContext) return '';
  const parts = [];
  if (dayContext.holidayName) parts.push(`（${dayContext.holidayName}）`);
  if (dayContext.dayKind === 'break') {
    parts.push(profile.forbid && profile.forbid.includes('上课') ? '（放假在家，不上课/不上班）'
      : (profile.label === '高中生' || profile.label === '大学生') ? '（寒暑假，不上学）' : '（长假）');
  }
  if (dayContext.academicPhase === 'exam_week') parts.push('（考试周/复习冲刺）');
  if (dayContext.examCountdown && dayContext.examCountdown.phase === 'sprint') parts.push('（备考冲刺期·作息更紧）');
  return parts.join('');
}
