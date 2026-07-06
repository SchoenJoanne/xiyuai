/**
 * A刀 红验②：away_probe gate（normalizeAttachmentBucket + shouldSendAwayProbe）。
 * 钉死决议：slow_warm=6h(非4.5h) / 暧昧+secure skip(端着) / safe_mode skip(含「shared」) /
 *          avoidant skip / affection<35 skip / 21h 不与 lastcall 重叠 / 一离开周期一次。
 * 运行：PROACTIVE_AWAY_PROBE_ENABLED=true DB_PATH=/tmp/awayprobe_gate.db node scripts/away_probe_gate_smoke.mjs
 */
import { shouldSendAwayProbe, normalizeAttachmentBucket } from '../src/proactive_engine.mjs';

const NOW = new Date('2026-06-20T15:00:00+08:00');
const ctx = { now: NOW };
let fail = 0;
function chk(name, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}  got=${got} want=${want}`);
}
const comp = (over = {}) => ({
  relationship_stage: '恋人', attachment_style: 'closeness_seeking',
  affection_level: 60, safe_mode: 0, last_user_reply_at: null, last_away_probe_at: 0, ...over,
});
const idle = (h) => new Date(NOW.getTime() - h * 3600_000).toISOString();

console.log('— 桶映射（4 新 + legacy → 3+1）—');
chk('closeness_seeking→anxious', normalizeAttachmentBucket('closeness_seeking'), 'anxious');
chk('independent_boundaries→avoidant', normalizeAttachmentBucket('independent_boundaries'), 'avoidant');
chk('slow_warm_exclusive→slow_warm', normalizeAttachmentBucket('slow_warm_exclusive'), 'slow_warm');
chk('warm_direct→secure', normalizeAttachmentBucket('warm_direct'), 'secure');
chk('legacy secure→secure', normalizeAttachmentBucket('secure'), 'secure');

console.log('— gate 时刻矩阵 —');
chk('恋人+anxious idle3.0h 触发', shouldSendAwayProbe(comp({ last_user_reply_at: idle(3.0) }), ctx), true);
chk('恋人+anxious idle2.9h 不触发', shouldSendAwayProbe(comp({ last_user_reply_at: idle(2.9) }), ctx), false);
chk('恋人+secure idle4.5h 触发', shouldSendAwayProbe(comp({ attachment_style: 'warm_direct', last_user_reply_at: idle(4.5) }), ctx), true);
chk('恋人+secure idle4.0h 不触发', shouldSendAwayProbe(comp({ attachment_style: 'warm_direct', last_user_reply_at: idle(4.0) }), ctx), false);
chk('🔴恋人+slow_warm idle6.0h 触发', shouldSendAwayProbe(comp({ attachment_style: 'slow_warm_exclusive', last_user_reply_at: idle(6.0) }), ctx), true);
chk('🔴恋人+slow_warm idle5.0h 不触发(证慢热=6h更端着)', shouldSendAwayProbe(comp({ attachment_style: 'slow_warm_exclusive', last_user_reply_at: idle(5.0) }), ctx), false);
chk('🔴暧昧+secure skip(端着)', shouldSendAwayProbe(comp({ relationship_stage: '暧昧', attachment_style: 'warm_direct', last_user_reply_at: idle(6.0) }), ctx), false);
chk('暧昧+anxious idle5h 触发', shouldSendAwayProbe(comp({ relationship_stage: '暧昧', attachment_style: 'closeness_seeking', last_user_reply_at: idle(5.0) }), ctx), true);
chk('恋人+avoidant skip', shouldSendAwayProbe(comp({ attachment_style: 'independent_boundaries', last_user_reply_at: idle(6.0) }), ctx), false);

console.log('— 硬闸 —');
chk('safe_mode skip(含 shared)', shouldSendAwayProbe(comp({ safe_mode: 1, last_user_reply_at: idle(3.0) }), ctx), false);
chk('affection<35 skip', shouldSendAwayProbe(comp({ affection_level: 30, last_user_reply_at: idle(3.0) }), ctx), false);
chk('朋友 stage skip', shouldSendAwayProbe(comp({ relationship_stage: '朋友', last_user_reply_at: idle(3.0) }), ctx), false);
chk('idle21h 与 lastcall 不重叠 skip', shouldSendAwayProbe(comp({ last_user_reply_at: idle(21) }), ctx), false);
const probedSec = Math.floor((NOW.getTime() - 1 * 3600_000) / 1000); // 1h 前探过（晚于 3h 前的 last_user）
chk('本离开周期已探 skip', shouldSendAwayProbe(comp({ last_user_reply_at: idle(3.0), last_away_probe_at: probedSec }), ctx), false);

console.log('— 🔴④ SILENCE_LIMIT=2 熔断（away_probe 非豁免·防绕过后门）—');
chk('unanswered=0 可探', shouldSendAwayProbe(comp({ last_user_reply_at: idle(3.0), proactive_unanswered: 0 }), ctx), true);
chk('unanswered=1 仍可探', shouldSendAwayProbe(comp({ last_user_reply_at: idle(3.0), proactive_unanswered: 1 }), ctx), true);
chk('🔴unanswered=2 熔断 skip', shouldSendAwayProbe(comp({ last_user_reply_at: idle(3.0), proactive_unanswered: 2 }), ctx), false);
chk('🔴unanswered=3 熔断 skip', shouldSendAwayProbe(comp({ last_user_reply_at: idle(3.0), proactive_unanswered: 3 }), ctx), false);

console.log(fail ? `\n✗ FAIL ${fail}` : '\n✓ ALL PASS');
process.exit(fail ? 1 : 0);
