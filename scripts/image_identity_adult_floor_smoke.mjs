#!/usr/bin/env node
/**
 * image_identity_adult_floor_smoke —— 生图 P0（child-safety·红线#4）坏版本验红（确定性·无出图·DB_PATH=/tmp）。
 *
 * P0：buildVisualIdentitySpec(visual_identity.mjs) age-blind 硬编码 baby-faced/大一新生 +
 *   ageVibePrompt(visual_identity_candidates.mjs) 下限 freshman → 叠加照片写实对所有 companion 默认
 *   渲染"看着未成年"的脸。这是 child-safety 红线在图像层的反向缺口(文字层守 18+·图像层默认未成年观感)。
 *
 * 修(方案1·P0)：身份描述符锚定【明确成年】+ 引入 age 入参 + ageVibe 抬下限。
 *   🔴 age≥18/缺失 → clearly adult(age-aware)；🔴 冻结存量未成年(14≤age<18) → 原描述符 byte-identical(不碰)。
 *
 * 🔴 红基线(旧版本必失败)：旧 buildVisualIdentitySpec 对成年 companion 仍返 baby-faced/freshman/round cheeks/
 *   delicate chin → block①②③ 断言"成年描述符无未成年词"失败。验证：git stash 改动后跑本 smoke 应 🔴 红。
 *
 * 🔴 注：本 smoke 只覆盖 buildVisualIdentitySpec(已完整修)与 buildIdentityCandidatePrompt 的 ageVibePrompt 部分；
 *   候选 prompt 仍有硬编码 'small delicate chin'/'innocent-looking'(:122/126/127)未在 ageVibePrompt 内——
 *   是否需一并改由【真出图 A/B】定夺(child-safety 不靠"改了词"算成年·靠看图)。
 *
 * 跑：DB_PATH=/tmp/img.db node scripts/image_identity_adult_floor_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/img.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/img_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { buildVisualIdentitySpec, buildIdentityPrompt } = await import('../src/visual_identity.mjs');
const { buildIdentityCandidatePrompt } = await import('../src/visual_identity_candidates.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

// 未成年观感强信号词（成年描述符里绝不该出现）
const MINOR_WORDS = ['baby-faced', 'baby face', 'freshman', 'round full cheeks', 'doe eyes', 'doe-eyed',
  'delicate chin', 'just turned 18', 'just-out-of-school', 'student-like', 'petite youthful', 'petite delicate'];
const hasMinor = (s) => MINOR_WORDS.filter((w) => String(s).toLowerCase().includes(w.toLowerCase()));
const specBlob = (sp) => [sp.ageLook, sp.face, sp.body].join(' | ');
const baseComp = (age) => ({ age, hair_color: '黑色', hair_style: '长发', eye_color: '棕色', clothing_style: '清新', personality_tags: '["温柔"]', hobbies: '["看书"]' });

console.log('── ① 🔴 复现缺口红基线：成年 companion 身份描述符无未成年词 + 有成年锚 ──');
{
  const sp = buildVisualIdentitySpec({ companion: baseComp(24) });
  const hits = hasMinor(specBlob(sp));
  ok(hits.length === 0, `age24 身份描述符零未成年词（命中=${JSON.stringify(hits)}）← 旧码含 baby-faced/round cheeks/delicate chin=红`);
  ok(/clearly adult/i.test(specBlob(sp)) && /natural adult facial proportions/i.test(specBlob(sp)), 'age24 描述符含明确成年锚(clearly adult + natural adult facial proportions·v1.23.1 调词后的成年锚)');
}

console.log('── ② 🔴 age 入参生效：多 age 各成年观感·零未成年词；缺失→成年 fallback ──');
{
  for (const age of [19, 24, 30, 45]) {
    const sp = buildVisualIdentitySpec({ companion: baseComp(age) });
    ok(hasMinor(specBlob(sp)).length === 0 && /\badult\b/i.test(specBlob(sp)), `age${age} → 明确成年·零未成年词`);
  }
  // 🔴 age 缺失/异常(两处 id-only 调用方) → 成年 fallback(非 baby-faced)
  const noAge = buildVisualIdentitySpec({ companion: { id: 1 } });
  ok(hasMinor(specBlob(noAge)).length === 0 && /\badult\b/i.test(specBlob(noAge)), 'age 缺失 → 成年 fallback(零未成年词)← 旧码 age-blind 返 baby-faced=红');
  const badAge = buildVisualIdentitySpec({ companion: baseComp(0) });
  ok(hasMinor(specBlob(badAge)).length === 0, 'age=0(异常) → 成年 fallback(零未成年词)');
}

console.log('── ③ 🔴 候选锁脸明确成年：成年候选零低龄锚(ageVibe freshman + 硬编码 innocent/delicate chin/innocent gaze)·有成年锚 ──');
{
  // 🔴 真出图 A/B 实证 ageVibe 单独不够 → 同步删硬编码低龄锚；本断言覆盖两者(旧码两类都在=红)。
  const MINOR_ANCHORS = ['freshman', 'just turned 18', 'baby-faced', 'innocent-looking', 'small delicate chin', 'innocent natural gaze'];
  for (const age of [19, 22, 26]) {
    const p = buildIdentityCandidatePrompt(baseComp(age), 's1');
    const bad = MINOR_ANCHORS.filter((w) => p.toLowerCase().includes(w.toLowerCase()));
    ok(bad.length === 0 && /clearly\s+(an\s+)?adult/i.test(p) && /natural adult facial proportions/i.test(p), `候选 age${age} → 零低龄锚·有成年锚(clearly adult + natural adult facial proportions)（命中低龄锚=${JSON.stringify(bad)}）← 旧码 freshman+delicate chin+innocent=红`);
  }
  const pNo = buildIdentityCandidatePrompt({ hair_color: '黑色' }, 's1');  // 无 age → 成年
  ok(/clearly\s+(an\s+)?adult/i.test(pNo) && !MINOR_ANCHORS.some((w) => pNo.toLowerCase().includes(w.toLowerCase())), '候选 age 缺失 → 成年(零低龄锚)');
}

console.log('── ④ 🔴 护栏不削弱：BLOCKED_RE 仍拦未成年/nsfw·新成年描述符不被误拒·avoid 仍在 ──');
{
  const sp = buildVisualIdentitySpec({ companion: baseComp(24) });
  const idp = buildIdentityPrompt({ identitySpec: sp });
  ok(idp.length > 0 && /\badult\b/i.test(idp), '新成年描述符过 buildIdentityPrompt 非空且含 adult(没被 BLOCKED_RE 误拒·证未用 minor/teen 等被剥词)');
  ok(hasMinor(idp).length === 0, 'buildIdentityPrompt 输出零未成年词');
  // BLOCKED_RE 仍拦：含 nsfw/minor 的 spec → buildIdentityPrompt 拒(剥词后该 clause 不含原意/整体拦)
  ok(buildIdentityPrompt({ identitySpec: { ...sp, face: 'nsfw nude sexual content' } }) === '', 'BLOCKED_RE 仍拦 nsfw/nude/sexual → 返 ""(护栏在)');
  ok(Array.isArray(sp.avoid) && sp.avoid.length > 0, 'SAFE_AVOID(spec.avoid) 仍非空(护栏未删)');
}

console.log('── ⑤ 🔴 冻结存量未成年(age16) byte-identical：仍返 v1.10.42 原描述符·不碰 ──');
{
  const sp16 = buildVisualIdentitySpec({ companion: baseComp(16) });
  ok(sp16.ageLook === 'very youthful first-year university freshman vibe, soft baby-faced look', '冻结存量未成年 ageLook 原样(baby-faced 保留·不碰)');
  ok(sp16.face === 'soft round full cheeks, large warm doe eyes, small delicate chin, dewy clear skin, gentle warm natural smile, fresh makeup-free complexion', '冻结存量未成年 face 原样');
  ok(sp16.body === 'slim petite youthful frame, natural proportions, modest casual styling', '冻结存量未成年 body 原样');
  // 候选路径 冻结存量未成年 也保留原 ≤17 档 + 原硬编码锚(small delicate chin/innocent)·byte-identical
  const p16 = buildIdentityCandidatePrompt(baseComp(16), 's1');
  ok(/just turned 18/i.test(p16) && !/clearly adult/i.test(p16), '冻结存量未成年 候选保留原 ≤17 档(just-turned-18·非 clearly adult)');
  ok(/small delicate chin/i.test(p16) && /innocent-looking/i.test(p16), '冻结存量未成年 候选保留原硬编码低龄锚(small delicate chin/innocent-looking)·byte-identical·不碰');
}

console.log('── ⑥ 🔴 v1.23.1 调词回归闸：成年描述符无"加骨相/加成熟"老态词·防"老态线条配年轻皮肤"割裂复发·仍明确成年 ──');
{
  // 🔴 红基线(c32a8db 旧词必失败)：旧成年描述符含 defined jawline/mature facial structure/grown adult →
  //    出图脸部凹凸阴影=老态(维护者 看图实证割裂)。本闸断言成年描述符零这类词；旧码命中=红。
  const OLD_AGE_WORDS = ['jawline', 'cheekbones', 'grown adult', 'fully grown', 'grown-up',
    'mature adult facial', 'mature defined', 'defined adult facial', 'mature facial structure', 'defined features'];
  const hitsOld = (s) => OLD_AGE_WORDS.filter((w) => String(s).toLowerCase().includes(w.toLowerCase()));
  for (const age of [18, 22, 29, 35]) {
    const h = hitsOld(specBlob(buildVisualIdentitySpec({ companion: baseComp(age) })));
    ok(h.length === 0, `spec age${age} 无老态/骨相词（命中=${JSON.stringify(h)}）← 旧码 defined jawline/mature structure/grown=红`);
  }
  for (const age of [18, 22, 29]) {
    const h = hitsOld(buildIdentityCandidatePrompt(baseComp(age), 's1'));
    ok(h.length === 0, `候选 age${age} 无老态/骨相词（命中=${JSON.stringify(h)}）← 旧码 defined jawline=红`);
  }
  // 🔴 调词不滑回未成年：成年描述符仍含 clearly adult + 零未成年词（年轻柔和≠未成年）
  for (const age of [18, 22, 29]) {
    const sp = buildVisualIdentitySpec({ companion: baseComp(age) });
    ok(/clearly adult/i.test(specBlob(sp)) && hasMinor(specBlob(sp)).length === 0, `spec age${age} 仍 clearly adult·零未成年词(调词不滑回未成年)`);
  }
}

console.log('── ⑦ 🔴 v1.23.2 调词回归闸：成年所有出脸路径有中国脸族裔锚 + 真人质感单一来源(spec 路径补接入)·冻结存量未成年 不沾 ──');
{
  const CN = /chinese/i;
  const REAL = /fine pores|candid|not an idealized|beauty-filter/i;   // REALISTIC_SKIN_TERMS 标记词
  // 🔴 红基线(8e885c2 旧码)：spec 路径无族裔锚(出西方脸)+无真人质感单一来源；候选只 East Asian 无 Chinese → 全红。
  for (const age of [18, 22, 29]) {
    const idp = buildIdentityPrompt({ identitySpec: buildVisualIdentitySpec({ companion: baseComp(age) }) });
    ok(CN.test(idp), `spec/selfie age${age} 有中国脸族裔锚← 旧码 spec 路径无族裔锚→西方脸=红`);
    ok(REAL.test(idp), `spec/selfie age${age} 接入真人质感单一来源(去塑料感)← 旧码 spec 路径无=红`);
    const cand = buildIdentityCandidatePrompt(baseComp(age), 's1');
    ok(CN.test(cand) && REAL.test(cand), `候选 age${age} 有中国脸族裔锚 + 真人质感← 旧码候选只 East Asian 无 Chinese=红`);
  }
  // 🔴 冻结存量未成年 不被新字段波及：buildIdentityPrompt 输出零新增 Chinese 族裔锚(minor 分支不设 subject/realism)
  const idp16 = buildIdentityPrompt({ identitySpec: buildVisualIdentitySpec({ companion: baseComp(16) }) });
  ok(!CN.test(idp16), '冻结存量未成年 buildIdentityPrompt 不含新增 Chinese 族裔锚(冻结存量不被 v1.23.2 新字段波及)');
}

console.log('── ⑧ 🔴 v1.23.3 调词回归闸：成年颜值锚(beautiful/high facial harmony) + 头发去假发感(messy/flyaway)·🔴推颜值仍不滑未成年·冻结存量未成年 头发原样 ──');
{
  const PRETTY = /beautiful|very pretty|facial harmony/i;          // spec(全身/镜子)强颜值
  const PRETTY_CAND = /good-looking|refined natural adult/i;       // v1.23.4 候选(近景)颜值稍收后的锚
  const MESSY = /slightly messy|flyaway|tousled/i;
  for (const age of [18, 22, 29]) {
    const sp = buildVisualIdentitySpec({ companion: baseComp(age) });
    const blob = specBlob(sp) + ' | ' + (sp.subject || '') + ' | ' + (sp.hair || '');
    ok(PRETTY.test(blob), `spec age${age} 有强颜值锚(beautiful/high facial harmony·全身/镜子保留)← 旧码温和 good-looking=红`);
    ok(MESSY.test(sp.hair || ''), `spec age${age} 头发去假发感(messy/flyaway)← 旧码 stable across photos 无碎发=红`);
    const cand = buildIdentityCandidatePrompt(baseComp(age), 's1');
    ok(PRETTY_CAND.test(cand) && MESSY.test(cand), `候选 age${age} 有(近景稍收)颜值锚 + 头发去假发感`);
    // 🔴 v1.23.4 近景候选稍收后仍明确成年：clearly adult + 近景成年年龄锚 + 零未成年词
    ok(/clearly adult/i.test(blob) && /mid-to-late twenties/i.test(cand) && hasMinor(blob).length === 0, `spec/候选 age${age} 仍明确成年(spec clearly adult + 候选"mid-to-late twenties ~25"安全余量锚·GPT 23-28 原则)·零未成年词`);
  }
  // 🔴 冻结存量未成年 头发 byte-identical（成年侧 hairLine 改·minor 侧不改）
  const c16 = buildIdentityCandidatePrompt(baseComp(16), 's1');
  ok(/soft and natural with a few loose strands/i.test(c16) && !/slightly messy|flyaway|not a perfectly neat wig/i.test(c16), '冻结存量未成年 候选头发原样(soft and natural·无 messy/flyaway·byte-identical)');
  const sp16 = buildVisualIdentitySpec({ companion: baseComp(16) });
  ok(/stable across photos/i.test(sp16.hair) && !/slightly messy|flyaway/i.test(sp16.hair), '冻结存量未成年 spec 头发原样(stable·无 messy/flyaway)');
}

console.log('── ⑨ 🔴🔴 v1.23.4 child-safety 结构闸：成年(≥18)候选绝不穿校服/学生装(对抗复审 FAIL 根因)·冻结存量未成年 仍校服 ──');
{
  // 🔴 红基线(旧码 8aa8f31)：age18 uniform 位 = 校服 polo(student/polo with blue trim)·19-22 = campus/academic → 命中=红。
  const STUDENT = /\bschool\b|schoolgirl|\bstudent\b|campus|academic|polo shirt with blue trim|\bpreppy\b/i;
  for (const age of [18, 19, 22, 26, 30]) {
    const p = buildIdentityCandidatePrompt(baseComp(age), 's1');   // s1 = uniform 服装位
    const hits = STUDENT.test(p) ? (p.match(new RegExp(STUDENT, 'gi')) || []) : [];
    ok(!STUDENT.test(p), `成年 age${age} 候选(uniform位)无校服/学生装词← 旧码 age18 校服polo/19-22 campus academic=红（命中=${JSON.stringify(hits)}）`);
  }
  // 成年 + 学生编码 clothing_style(学院风) → casual 位也不出"student daily style"(去学生编码)
  const pAcad = buildIdentityCandidatePrompt({ age: 24, clothing_style: '学院风', hair_color: '黑色' }, 's3');
  ok(!STUDENT.test(pAcad), `成年 age24 学院风 clothing_style 候选(casual位)也无学生编码← 旧码 "student daily style"=红（命中=${JSON.stringify(STUDENT.test(pAcad) ? pAcad.match(new RegExp(STUDENT, 'gi')) : [])}）`);
  // 🔴 v1.23.5 候选背景去校园/宿舍/走廊学生编码场景(对抗复审:campus 走廊背景=学生码)
  const SETTING = /corridor|walkway|stairwell|hallway|classroom|\bdorm\b|\bschool\b|campus/i;
  for (const seed of ['s1', 's2', 's3', 's4']) {
    const p = buildIdentityCandidatePrompt(baseComp(22), seed);
    ok(!SETTING.test(p), `候选 ${seed} 背景无校园/宿舍/走廊学生场景← 旧码 s1 stairwell/corridor·s2 walkway·s3 dorm=红`);
  }
  // 🔴 冻结存量未成年(冻结存量未成年·age<18) 仍走校服 polo(本就该穿·此修正不误伤)
  const p16 = buildIdentityCandidatePrompt(baseComp(16), 's1');
  ok(/polo shirt with blue trim/i.test(p16), '冻结存量未成年 候选(uniform位)仍校服 polo(冻结存量未成年·a<18 分支不变)');
}

console.log(`\n══ image identity adult-floor smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
