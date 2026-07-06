/**
 * timezone_smoke —— 上海时区 helper must-pass 冒烟（getHours 时区 P1·进 CI）。
 *
 * 背景：睡眠窗 / 早安窗 / 夜间静默闸 / 作息固化 03:40 / 照片戳 / 提醒"今天" / 纪念日 /
 * 成年校验 等过去裸用本地时间 API（getHours/getMinutes/getFullYear…），系统 TZ≠Asia/Shanghai
 * （自托管 UTC）即错时/错日。本轮统一走 db.mjs 的 Intl(Asia/Shanghai) 共享 util。
 *
 * 断言（四组）：
 *   ① TZ 无关绝对正确性：对固定 UTC 瞬时，shanghaiHM/YMD/Stamp 返回正确上海值
 *      （含跨午夜 / 跨年 / 03:40 那种）——不依赖本进程 TZ。
 *   ② CST 不变量：本进程 TZ=Asia/Shanghai 时，对 2880 分钟逐点采样 getHours/getMinutes
 *      vs shanghaiHM，mismatch 必须 = 0（脚本探测自身 TZ·只在 Asia/Shanghai 下断言此项）。
 *      → 证明生产（CST 机器）行为逐位不变。
 *   ③ UTC 修正：构造"上海 03:40"等瞬时，断言 shanghaiHM 给 3:40（不是 UTC 的 19:40）。
 *   ④ 成年校验专项：构造生日在 UTC/上海跨日（跨年）边界的临界用户，断言用上海日历
 *      算的成年判定正确（UTC 会错判）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import {
  shanghaiHM, shanghaiHours, shanghaiMinutes, shanghaiYMD, shanghaiStamp, shanghaiDateKey,
} from '../src/db.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

// 本进程探测到的上海小时（独立于被测 helper，用于 TZ 探测与 ③ 锚定）。
const probeShHour = (d) => Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23',
}).format(d));

// ─── ① TZ 无关绝对正确性（固定 UTC 瞬时 → 已知上海值）───────────────────────────
// 上海 = UTC+8（现代无 DST）。
{
  // 普通时刻：2026-06-22 12:00:00 UTC → 上海 20:00:00
  const d1 = new Date('2026-06-22T12:00:00Z');
  const hm1 = shanghaiHM(d1);
  ok(hm1.hour === 20 && hm1.minute === 0, `①普通 12:00Z → 上海 20:00（实测 ${hm1.hour}:${hm1.minute}）`);
  ok(shanghaiHours(d1) === 20, '①shanghaiHours 一致');
  ok(shanghaiMinutes(d1) === 0, '①shanghaiMinutes 一致');
  const ymd1 = shanghaiYMD(d1);
  ok(ymd1.year === 2026 && ymd1.month === 6 && ymd1.day === 22, `①YMD 同日（实测 ${ymd1.year}-${ymd1.month}-${ymd1.day}）`);

  // 跨午夜：2026-06-22 18:30:00 UTC → 上海次日 02:30，日期进位到 06-23
  const d2 = new Date('2026-06-22T18:30:00Z');
  const hm2 = shanghaiHM(d2);
  ok(hm2.hour === 2 && hm2.minute === 30, `②跨午夜 18:30Z → 上海 02:30（实测 ${hm2.hour}:${hm2.minute}）`);
  const ymd2 = shanghaiYMD(d2);
  ok(ymd2.day === 23 && ymd2.month === 6, `②跨午夜日期进位 → 06-23（实测 ${ymd2.month}-${ymd2.day}）`);
  ok(shanghaiDateKey(d2) === '2026-06-23', '②shanghaiDateKey 跨午夜进位一致');

  // 跨年：2025-12-31 16:00:00 UTC → 上海 2026-01-01 00:00
  const d3 = new Date('2025-12-31T16:00:00Z');
  const hm3 = shanghaiHM(d3);
  const ymd3 = shanghaiYMD(d3);
  ok(hm3.hour === 0 && hm3.minute === 0, `③跨年 16:00Z → 上海 00:00（实测 ${hm3.hour}:${hm3.minute}）`);
  ok(ymd3.year === 2026 && ymd3.month === 1 && ymd3.day === 1, `③跨年进位 → 2026-01-01（实测 ${ymd3.year}-${ymd3.month}-${ymd3.day}）`);

  // 03:40 那种（作息固化触发点）：上海 03:40 = 前一天 19:40 UTC
  const d4 = new Date('2026-06-21T19:40:00Z');
  const hm4 = shanghaiHM(d4);
  ok(hm4.hour === 3 && hm4.minute === 40, `④作息固化 03:40：19:40Z → 上海 03:40（实测 ${hm4.hour}:${hm4.minute}）`);

  // 视觉戳含秒：2026-06-22 18:30:07 UTC → 上海 2026-06-23 02:30:07 → '20260623-023007'
  const d5 = new Date('2026-06-22T18:30:07Z');
  ok(shanghaiStamp(d5) === '20260623-023007', `⑤视觉戳 → 20260623-023007（实测 ${shanghaiStamp(d5)}）`);
}

// ─── ③ UTC 修正（上海 03:40 瞬时·不是 UTC 的 19:40）─────────────────────────────
// 重申要点：裸 getHours 在 UTC 机器上会给 19；helper 必须给 3。
{
  const shanghai0340 = new Date('2026-06-21T19:40:00Z');   // = 上海 06-22 03:40
  const hm = shanghaiHM(shanghai0340);
  ok(hm.hour === 3 && hm.minute === 40, `UTC 修正：上海 03:40 → helper=3:40（实测 ${hm.hour}:${hm.minute}）`);
  ok(hm.hour !== 19, 'UTC 修正：helper 不等于 UTC 的 19（裸 getHours 的错值）');
}

// ─── ② CST 不变量（仅在本进程 TZ=Asia/Shanghai 下断言 mismatch=0）─────────────────
{
  // 探测自身 TZ：取一个固定 UTC 瞬时，比本地 getHours 与上海小时是否一致。
  const probe = new Date('2026-06-22T12:00:00Z');
  const selfIsShanghai = probe.getHours() === probeShHour(probe);
  if (selfIsShanghai) {
    let mismatch = 0;
    const base = Date.UTC(2026, 5, 22, 0, 0, 0);   // 任意起点，逐分钟扫 2880 点（48h）
    for (let i = 0; i < 2880; i++) {
      const d = new Date(base + i * 60_000);
      const hm = shanghaiHM(d);
      if (hm.hour !== d.getHours() || hm.minute !== d.getMinutes()) mismatch++;
    }
    ok(mismatch === 0, `CST 不变量：TZ=Asia/Shanghai 下 2880 点 getHours/getMinutes vs shanghaiHM mismatch=0（实测 ${mismatch}）`);
  } else {
    console.log('  ·CST 不变量：本进程 TZ 非 Asia/Shanghai，跳过 mismatch=0 断言（按设计·只在 CST 下断言）');
  }
}

// ─── ④ 成年校验专项（生日在 UTC/上海跨年边界·上海日历算年龄）──────────────────────
// 复刻 api.mjs age-attestation 的判定：nowYear = 上海"今天"的年份；nowYear - birthYear < 18 → 未成年。
// 构造一个临界瞬时：UTC 仍是 2025 年最后一刻，但上海已跨进 2026。
// 用户出生年 2008：
//   · 用上海年份 2026 算：2026 - 2008 = 18 → 成年（正确，应放行）。
//   · 用 UTC 年份 2025 算：2025 - 2008 = 17 → 误判未成年（错误，会卡住已成年用户）。
{
  const boundary = new Date('2025-12-31T16:00:00Z');   // 上海 = 2026-01-01 00:00
  const shYear = shanghaiYMD(boundary).year;
  const utcYear = boundary.getUTCFullYear();
  ok(shYear === 2026, `成年校验：边界瞬时上海年份=2026（实测 ${shYear}）`);
  ok(utcYear === 2025, `成年校验：同瞬时 UTC 年份=2025（对照·实测 ${utcYear}）`);

  const birthYear = 2008;
  const ageByShanghai = shYear - birthYear;   // 18 → 成年
  const ageByUtc = utcYear - birthYear;       // 17 → 误判
  ok(ageByShanghai >= 18, `成年校验：上海日历判定成年（年龄 ${ageByShanghai} ≥ 18）`);
  ok(ageByUtc < 18, `成年校验：UTC 会误判未成年（年龄 ${ageByUtc} < 18·这正是 bug）`);
  ok(ageByShanghai !== ageByUtc, '成年校验：跨年边界 UTC 与上海差一岁（差一天可错判临界用户）');
}

console.log(`\ntimezone_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
