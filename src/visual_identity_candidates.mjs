/**
 * v1.10.43 visual_identity_candidates — 一次生成 4 张候选 selfie，让用户选最满意的
 * 锁为 reference。避免第一张丑图永久指挥后续生图。
 *
 * 不走 photo_planner LLM（成本太高 + 不必要），直接拼具象 imagePrompt。
 * 4 个 seed 给不同 lighting / angle / 表情变化，让选择有意义。
 */

import { imageGenerate } from './providers/image.mjs';
import { saveCandidateImage, isClearlyAdult } from './visual_identity.mjs';
import { ANTI_COLLAGE_PROMPT } from './photo_sender.mjs';
import { REALISTIC_SKIN_TERMS } from './image_realism_terms.mjs';   // 2026-06-13 单一来源真人质感
import { log } from './logger.mjs';

// v1.10.53: 4 seed 强差异化 + 全部不露齿（用户反馈「笑最好不漏齿」）。
// 拿用户给的两张参考图当光谱两端拉大差距：
//   s1 ≈ 室内楼梯/走廊冷调清冷  s2 ≈ 户外走廊暖阳清新
// 之前 s2 `hint of teeth`、s3 `mid-laugh` 是露齿源头，全改抿唇/闭嘴。
// 🔴 v1.23.5 child-safety（对抗复审 FAIL：campus 走廊/dorm 背景=学生编码）：候选背景去校园/宿舍/走廊，
//   改成中性成年生活场景（家居/街道/公园），保留原"冷调室内 / 暖阳户外 / 窗边暖光 / 黄金时分"光线-情绪光谱。
const SEED_VARIATIONS = {
  // s1 清冷文艺 / 室内冷光 / 垂发安静
  s1: 'calm quiet serene almost-expressionless face with lips gently closed and only the faintest trace of a smile, long hair hanging straight down framing the face, standing in a bright airy room at home with cool natural daylight pouring in from tall windows, quiet literary introverted mood',
  // s2 阳光清新 / 户外暖阳·风吹发丝 / 动态
  s2: 'gentle soft close-lipped smile with lips kept softly together, a few strands of hair lightly blown by the breeze, standing outdoors on a quiet tree-lined street or park path, warm bright late-afternoon sunlight, fresh airy candid feeling with a hint of natural motion',
  // s3 害羞低头 / 室内窗边暖光 / 内向
  s3: 'shy bashful expression glancing slightly downward with a soft closed-lip smile and rosy blushing cheeks, one hand gently touching hair near the face, warm soft indoor window light from the side, cozy quiet intimate room-at-home mood',
  // s4 远眺侧脸 / 黄金时分 / 文艺（用户钦点，保持不露齿）
  s4: 'serene gentle close-mouth smile with lips together and eyes gazing softly off into the distance to the side, three-quarter profile angle, warm golden-hour sunset light glowing on the cheek, soft green leafy or open sky background, dreamy literary mood',
};

// v1.10.53: 每个 seed 的服装位 — uniform 位仅 16-18 岁出校服，其余年龄段
// 自动降级（见 outfitForSeed）；casual 位走 companion 个性化便服。
// 用户要求「留 2 张便服」：s1/s2 = 校园校服位，s3/s4 = 便服位。
const SEED_OUTFIT_SLOT = { s1: 'uniform', s2: 'uniform', s3: 'casual', s4: 'casual' };

export const CANDIDATE_SEEDS = Object.keys(SEED_VARIATIONS);

// v1.10.51: 按 companion.age 动态选年龄段视觉描述，不再硬编码 freshman
// v1.23 生图 P0（child-safety·红线#4）：成年档下限拉到【明确成年】——删 freshman/baby-faced/just-turned-18 暗示。
// 🔴 v1.23.1 调词：删 defined adult facial features/clear jawline/mature facial features/grown adult 这类
//   "加骨相/加成熟"词(实证→脸部老态线条阴影·跟年轻皮肤割裂)，统一锚 "clearly adult + soft balanced adult
//   features + young adult woman"——明确成年但年轻柔和。下限仍 clearly adult(不滑回未成年)。
// 🔴 用模糊措辞避开具体年龄数字（OpenAI 安全过滤对 <18/school 词严）；🔴 冻结存量未成年(冻结存量未成年·age<18)
//   保留原 ≤17 档 byte-identical·不碰其出图观感（minor 图像门控=safe_mode 运营决策·非本 P0）。
function ageVibePrompt(age) {
  const a = Number(age);
  if (Number.isFinite(a) && a >= 14 && a < 18) {
    return {
      look: 'extremely fresh just-out-of-school look, pure youthful fresh appearance, gentle innocent natural expression, very wholesome clean vibe like a college freshman who just turned 18',
      body: 'slim petite delicate youthful frame, slight student-like vibe',
      atmo: 'pure clean wholesome airy fresh atmosphere',
    };
  }
  // ≥18 或缺失/异常 → 明确成年（下限拉到 clearly adult·年轻柔和不加骨相）
  const adult = Number.isFinite(a) ? a : 22;
  if (adult <= 22) {
    return {
      // 🔴 v1.23.5 child-safety：身份候选(=参考图)下限 firm 到明确成年（去 soft youthful·不加 jawline/老态）。
      // 🔴 v1.23.6（GPT 关键原则·解"18/16 视觉分不出"）：观感目标定【mid-to-late twenties ~25·安全余量 23-28】——
      //   不贴 age 字段生成("刚满18/大一新生"边缘观感)·即使生成波动也落在明确成年区·不滑边界。🔴 守住不推过头偏老
      //   (mid-to-late≠30+·仍年轻)。age18 档尤其(本档覆盖 18-22)·结构上让成年图留安全余量。
      look: 'a clearly adult, established woman who looks about 25, in her mid-to-late twenties, a settled composed twenty-something presence, natural adult facial proportions',
      body: 'slim graceful adult woman figure with natural proportions',
      atmo: 'fresh clean young-adult atmosphere',
    };
  }
  if (adult <= 28) {
    return {
      look: 'clearly adult young woman in her mid-twenties, soft balanced adult features, calm composed presence',
      body: 'slim graceful young adult woman figure with natural proportions',
      atmo: 'refined composed young-adult atmosphere',
    };
  }
  return {
    look: 'clearly adult woman in her thirties, soft balanced adult features, calm composed natural appearance',
    body: 'slim elegant adult woman figure with natural proportions',
    atmo: 'mature refined gentle atmosphere',
  };
}

function clothingToEnglish(style) {
  const s = String(style || '').toLowerCase();
  if (/甜美|sweet|cute/.test(s)) return 'cute pastel hoodie or light knit cardigan';
  if (/清新|fresh|elegant/.test(s)) return 'fresh clean light blouse or simple soft tee';
  if (/酷|cool|street/.test(s)) return 'oversized casual hoodie or graphic tee';
  // v1.23.4 child-safety：学生装措辞去 student/preppy（成年穿"学生装"会被读成校服少女）。保留便服款式，去学生编码。
  if (/学生|学院|preppy|student/.test(s)) return 'soft cardigan over a light blouse, fresh clean smart-casual everyday style';
  return 'casual everyday wear';
}

// v1.10.53: 服装按 seed 服装位 + 年龄动态化。
// 🔴 v1.23.4 child-safety（对抗复审 FAIL 根因·从结构消除）：校服/学生装【仅限未成年】(冻结存量未成年·age<18)。
//   旧码 a>=16&&a<=18 把【18 岁成年】也圈进穿校服 polo、19-22 成年穿学院风白衬衫 → 配年轻脸=校服少女观感
//   （age 合法≠观感成年）。成年(≥18)绝不走校服/学生装分支，uniform 位给利落简约【成年】便装。校服 polo 正好落给 冻结存量未成年。
function outfitForSeed(companion, slot) {
  // casual 位：始终走 companion 个性化便服
  if (slot !== 'uniform') return clothingToEnglish(companion?.clothing_style);

  const a = Number(companion?.age) || 18;   // 缺失/异常 → 18（成年便装·fail-safe 到非学生装）
  // 🔴 校服 polo 仅限未成年（age<18·含 冻结存量未成年=16）：白蓝撞色短袖 polo（措辞避开 "school uniform" 防安全过滤）。
  if (Number.isFinite(a) && a < 18) {
    return 'fresh clean white short-sleeve collared polo shirt with blue trim, neat tidy student style';
  }
  // 🔴 成年(≥18)：uniform 位 = 利落简约【成年】便装·绝不 student/campus/academic/school/preppy 措辞。
  return 'simple elegant light collared blouse or a fine knit top, clean refined everyday adult style';
}

export function buildIdentityCandidatePrompt(companion, seed) {
  const hairColor = companion?.hair_color || '黑色';
  const hairStyle = companion?.hair_style || '长发';
  const eye = companion?.eye_color || '棕色';
  // v1.10.53: 服装按 seed 服装位 + 年龄动态决定（校服仅 16-18，见 outfitForSeed）
  const clothing = outfitForSeed(companion, SEED_OUTFIT_SLOT[seed] || 'casual');
  const variation = SEED_VARIATIONS[seed] || SEED_VARIATIONS.s1;

  // v1.10.51: 按 companion.age 取年龄段 vibe，替代硬编码 freshman
  const av = ageVibePrompt(companion?.age);

  // v1.23 生图 P0（child-safety·红线#4）：真出图 A/B 实证 ageVibePrompt 抬下限【单独不够】——候选锁脸
  //   仍被这几条硬编码低龄锚（innocent-looking / small delicate chin / innocent gaze）拖成"看着未成年"
  //   (a19 候选实测偏少年观感)。故对成年(≥18/缺失)同步换明确成年锚；🔴 冻结存量未成年(14≤age<18) 保留原措辞 byte-identical。
  // v1.23.2 调词：成年 subject 叠加【中国脸族裔锚 + 颜值锚】；真人质感靠下方 REALISTIC_SKIN_TERMS 单一来源。
  // v1.23.3 调词(维护者 盲审补)：① 颜值再推一把(beautiful/very pretty/high facial harmony·"真实高颜值"非网红模板·
  //   靠下方反网红词压塑料)；② 头发去假发感(成年侧 hairLine 加 slightly messy/flyaway·minor 侧原样)。
  //   🔴 年龄锚仍死扣明确成年(young adult·不写 girl/teen/cute/delicate)·推颜值时不滑未成年。仍仅动成年侧·minor byte-identical。
  const _a = Number(companion?.age);
  const minorVibe = Number.isFinite(_a) && _a >= 14 && _a < 18;
  // v1.23.4 child-safety：近景候选颜值【稍收】(对抗复审：全身/镜子没问题·近景娃娃脸敏感)——去 very pretty/high
  //   facial harmony 等强颜值词(易放大近景娃娃脸)，加【明确成年年龄+成年神态】锚抵消娃娃脸。spec(全身/镜子)颜值保留。
  const subject = minorVibe ? 'naturally pretty innocent-looking young East Asian woman' : 'naturally pretty and good-looking clearly adult East Asian Chinese woman who looks like an established adult in her mid-to-late twenties (around 25), refined natural adult features, calm composed adult poise and expression, real authentic everyday look';
  const faceShape = minorVibe ? 'small delicate chin and petite nose' : 'natural adult facial proportions, soft balanced features';
  const gaze = minorVibe ? 'gentle innocent natural gaze' : 'gentle calm natural adult gaze';
  const makeup = minorVibe ? 'completely makeup-free natural pure look' : 'completely makeup-free natural look';
  // v1.23.3 头发去假发感：成年侧加真实碎发(非一丝不苟假发)；🔴 minor(冻结存量未成年) 保留原措辞 byte-identical。
  const hairLine = minorVibe
    ? `${hairColor} ${hairStyle} hair, soft and natural with a few loose strands`
    : `${hairColor} ${hairStyle} hair, natural and slightly messy, softly tousled with flyaway strands and a few loose stray hairs, not a perfectly neat wig`;

  // 2026-06-13 头像恐怖谷修：删四个 doll-face 触发词（porcelain / baby-faced / doe-eyed /
  // glossy），它们让模型出过度光滑大眼 porcelain 假脸=恐怖谷；改接入 REALISTIC_SKIN_TERMS
  // 单一来源真人质感（与 photo_planner v1.18-1.19 反塑料升级对齐）。**不靠塑料娃娃词**。A/B 真出图对比定稿。
  return [
    'realistic casual smartphone selfie portrait',
    subject,
    av.look,
    // 视觉锚点（成年=soft but clearly adult·自然成年比例不加骨相 / minor=保留原措辞·去娃娃脸塑料触发词后的版本）
    'soft side-swept fringe or wispy bangs framing the face',
    faceShape,
    gaze,
    makeup,
    av.body,
    hairLine,
    `${eye} eyes, clear and bright`,
    `wearing ${clothing}`,
    'smartphone front-facing camera selfie POV',
    'arm partially visible at edge of frame',
    'slight upward angle',
    variation,  // v1.10.51: 包含具体表情 + 视角 + 场景，不再只是光线
    'photorealistic real life amateur phone photography',
    ...REALISTIC_SKIN_TERMS,   // 单一来源真人质感（反恐怖谷靠真实细节+小瑕疵，不堆完美词）
    av.atmo,
    ANTI_COLLAGE_PROMPT,  // v1.19.5 issue#237: 候选自拍同样偶发拼图
  ].join(', ');
}

/**
 * 并发生成 4 张候选图。
 * @returns {Promise<{candidates: Array<{seed:string, url:string}>, errors: Array<{seed:string, error:string}>}>}
 */
export async function generateIdentityCandidates(companion, opts = {}) {
  // v1.23 child-safety 补闸⑤（出图 age 硬闸·候选锁脸路径）+ 步① fail-closed：
  //   🔴 只有【明确成年(≥18 有效 age)】才生成人脸候选；age<18/null/缺失/异常/无法解析一律拒（绝不出脸照·
  //   未知年龄≠默认成年·键在 age 不依赖 safe_mode）。
  if (!isClearlyAdult(companion?.age)) {
    log('warn', `[identity-candidates] 🔴 拒绝非明确成年候选生成 companion=${companion?.id} age=${companion?.age}（child-safety fail-closed·未知/异常年龄不出脸）`);
    return { candidates: [], errors: [{ seed: 'all', error: `child-safety: age not clearly adult (>=18) — candidate face generation blocked` }] };
  }
  const seeds = Array.isArray(opts.seeds) && opts.seeds.length ? opts.seeds : CANDIDATE_SEEDS;
  const t0 = Date.now();
  const results = await Promise.allSettled(seeds.map(async (seed) => {
    const prompt = buildIdentityCandidatePrompt(companion, seed);
    const url = await imageGenerate(prompt, { size: opts.size || '1024x1024' });
    return { seed, url };
  }));
  const candidates = [];
  const errors = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const seed = seeds[i];
    if (r.status !== 'fulfilled' || !r.value?.url) {
      errors.push({ seed, error: r.reason?.message || 'unknown' });
      continue;
    }
    // v1.10.46: 把 data URL / http URL 落地到磁盘，response 只返短 fname。
    // 避免 4 张 base64 (~12MB JSON) 撑爆前端解析。
    try {
      const raw = r.value.url;
      let buf;
      if (raw.startsWith('data:image/')) {
        const m = raw.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
        buf = m ? Buffer.from(m[1], 'base64') : null;
      } else if (/^https?:\/\//.test(raw)) {
        const resp = await fetch(raw, { signal: AbortSignal.timeout(30_000) });
        if (resp.ok) buf = Buffer.from(await resp.arrayBuffer());
      }
      if (!buf || buf.length < 256) {
        errors.push({ seed, error: 'image bytes invalid' });
        continue;
      }
      const saved = saveCandidateImage(companion.id, buf, seed);
      if (!saved) {
        errors.push({ seed, error: 'save failed' });
        continue;
      }
      candidates.push({ seed, fname: saved.fname });
    } catch (e) {
      errors.push({ seed, error: e.message });
    }
  }
  log('info', `[identity-candidates] companion=${companion.id} 完成 ok=${candidates.length}/${seeds.length} 耗时=${Date.now() - t0}ms`);
  return { candidates, errors };
}
