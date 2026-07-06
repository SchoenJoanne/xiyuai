#!/usr/bin/env bash
# 发布前自检脚本：7 项基础 + 8 项发布副本强项(--release·闸 8-15)
#   1) forbidden files
#   2) secret patterns
#   3) production paths/domains
#   4) package.json JSON syntax
#   5) large files (>5MB)
#   6) .env is not git-tracked
#   7) stickers: 锁发布只发原创（无非 CC0 表情包图片被跟踪 + PROVENANCE 在场）
#
# 任何一项失败立刻退出非零。
#
# Copyright (c) 2026 溪语 AI Contributors. MIT License.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 🔴 发布工序②·机械闸第8项：--release=发布副本闸形态（仅对 scrub+squash 后的公开副本跑·非 dev 闸；
#   dev 会因存量泄漏项[HANDOFF/私邮历史/未 scrub B 类]而红=预期，故默认不跑闸 8–15）。
RELEASE=0; for a in "$@"; do [ "$a" = "--release" ] && RELEASE=1; done

pass=0; fail=0
check() {
  local name="$1"; local ok="$2"; local detail="${3:-}"
  if [ "$ok" = "1" ]; then
    printf "  ✓ %s\n" "$name"
    pass=$((pass+1))
  else
    printf "  ✗ %s\n" "$name"
    [ -n "$detail" ] && printf "      %s\n" "$detail"
    fail=$((fail+1))
  fi
}

echo "==> 1) forbidden files (must not be tracked by git)"
FORBIDDEN_FOUND=$(git ls-files 2>/dev/null | grep -E '^\.env$|\.auth-secret|\.admin-secret|\.admin-credentials|\.weixin-credentials|/bot\.db$|_backup_billing_v1/' || true)
if [ -z "$FORBIDDEN_FOUND" ]; then check "no forbidden files in git" 1
else check "no forbidden files in git" 0 "$FORBIDDEN_FOUND"
fi

echo "==> 2) secret patterns (literal keys, not \${var} placeholders)"
SECRETS=$(grep -RInE "(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{20,})" \
  . --exclude-dir=node_modules --exclude-dir=.git --exclude='*.md' \
  --exclude='.env' --exclude='.env.*' 2>/dev/null || true)
if [ -z "$SECRETS" ]; then check "no literal API keys" 1
else check "no literal API keys" 0 "$(echo "$SECRETS" | head -5)"
fi

echo "==> 3) production paths/domains"
# 排除：
#   · .gitignore 里的 _backup_billing_v1/ 是防御性忽略规则
#   · public/robots.txt / public/sitemap.xml 里的 xiyuai.cc 是示例域名（顶部已注明 deployment 时替换）
#   · public/llms.txt / public/llms-full.txt 引用了 GitHub 链接和 README 摘要，作为 AI 爬虫元数据可以保留
#   · bug_report.yml 的「官方托管（xiyuai.cc）」部署选项是面向用户的文档（#279：托管用户误填自部署）
#   · public/app/{terms,privacy}{,.en}.html 是官方托管服务的正式协议/隐私政策——按法律要求
#     须写明适用主体域名 xiyuai.cc（公开信息，非泄漏）；自托管者须替换为自己的条款
PROD=$(grep -RInE "/opt/zhaohy-wechat-poc|/var/www/zhaohy\.xyz|xiyuai\.cc|zhaohy\.xyz|_backup_billing_v1" \
  . --exclude-dir=node_modules --exclude-dir=.git --exclude='*.md' \
  --exclude='opensource_check.sh' --exclude='.gitignore' \
  --exclude='robots.txt' --exclude='sitemap.xml' \
  --exclude='llms.txt' --exclude='llms-full.txt' \
  --exclude='bug_report.yml' \
  --exclude='terms.html' --exclude='privacy.html' \
  --exclude='terms.en.html' --exclude='privacy.en.html' \
  --exclude='index.html' 2>/dev/null || true)
if [ -z "$PROD" ]; then check "no production paths/domains" 1
else check "no production paths/domains" 0 "$(echo "$PROD" | head -5)"
fi

echo "==> 4) package.json valid JSON + has MIT + start script"
if node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); if(p.license!=='MIT')process.exit(2); if(!p.scripts||!p.scripts.start)process.exit(3); process.exit(0)" 2>/dev/null; then
  check "package.json (JSON + MIT + scripts.start)" 1
else
  check "package.json (JSON + MIT + scripts.start)" 0
fi

echo "==> 5) no files >5MB"
LARGE=$(find . -type f -size +5M -not -path './.git/*' -not -path './node_modules/*' 2>/dev/null || true)
if [ -z "$LARGE" ]; then check "no files larger than 5MB" 1
else check "no files larger than 5MB" 0 "$LARGE"
fi

echo "==> 6) .env not in git tracking"
if git ls-files 2>/dev/null | grep -qE "^\.env$"; then
  check ".env not git-tracked" 0
else
  check ".env not git-tracked" 1
fi

echo "==> 7) stickers: 锁发布只发原创（no non-CC0 sticker image tracked + PROVENANCE present）"
# 只有 CC0 原创集允许被公开仓跟踪。当前唯一允许路径前缀 = assets/stickers/xiyu2/。
# 任何其它被 git 跟踪的表情包图片（zh/* 商用图、根目录素材等）一旦误进公开仓副本即拦。
# 见 assets/stickers/PROVENANCE.md（xiyu2=CC0·zh=opensource:false 不开源）。
STICKER_BIN=$(git ls-files -- assets/stickers 2>/dev/null | grep -iE '\.(jpe?g|png|gif|webp|bmp|svg)$' || true)
DISALLOWED=$(printf '%s\n' "$STICKER_BIN" | grep -vE '^assets/stickers/xiyu2/' | grep -v '^$' || true)
if [ -n "$DISALLOWED" ]; then
  check "stickers: only CC0-original binaries tracked" 0 "非 CC0 表情包被跟踪（应 gitignore 或移入 xiyu2/）：$(echo "$DISALLOWED" | head -5)"
elif [ ! -f assets/stickers/PROVENANCE.md ]; then
  check "stickers: only CC0-original binaries tracked" 0 "assets/stickers/PROVENANCE.md 缺失（来源声明必须在场）"
else
  check "stickers: only CC0-original binaries tracked" 1
fi

# ═══════════════ 🔴 发布副本强项（8–12·仅 --release·跑于 scrub+squash 后的公开副本）═══════════════
if [ "$RELEASE" = 1 ]; then
  echo
  echo "==> 🔴 发布副本闸（--release·dev 会因存量泄漏项而红=预期·此模式验的是 scrub 后的干净副本）"

  echo "==> 8) design-archive 白名单化（非白名单 tracked 文件即红·从严默认删）"
  # 🔴 维护者 scrub 时维护此白名单：只列"自托管者需要的设计意图"文件；攻防细节/缺陷讨论/生产 prompt
  #    逐字（prompt_diag_*/image_gen/samples/full_*/realism_provider_* 等）一律删=不入白名单。
  DESIGN_ALLOW='^docs/design-archive/prompt_design_20260628/(01_image_gen|02_self_facts|02b_self_facts_A3_patch|03_daily_schedule|README|SUMMARY)\.md$'
  DA_BAD=$(git ls-files 'docs/design-archive/**' 2>/dev/null | grep -vE "$DESIGN_ALLOW" | grep -v '^$' || true)
  if [ -z "$DA_BAD" ]; then check "design-archive 仅白名单（无攻防细节/prompt逐字）" 1
  else check "design-archive 仅白名单（无攻防细节/prompt逐字）" 0 "非白名单 tracked（删或加白名单）：$(echo "$DA_BAD" | head -8)"; fi

  echo "==> 9) 生产路径 /opt/xiyu-ai-new（sandbox 守卫白名单外即红·含注释示例·从严泛化）"
  # 🔴 自排除本脚本：闸 9 的检测串 '/opt/xiyu-ai-new' 就写在 opensource_check.sh 里，不排除会自咬→结构不可达。
  OPT_BAD=$(git grep -lF '/opt/xiyu-ai-new' -- 'scripts/**' 'src/**' 'docs/**' 2>/dev/null | grep -vE 'scripts/sandbox_src_(db|failclosed_smoke)\.mjs|scripts/opensource_check\.sh' || true)
  if [ -z "$OPT_BAD" ]; then check "no /opt/xiyu-ai-new（sandbox 守卫外）" 1
  else check "no /opt/xiyu-ai-new（sandbox 守卫外）" 0 "泛化为 env/占位（sandbox 守卫已白名单）：$(echo "$OPT_BAD" | head -8)"; fi

  echo "==> 10) git author 仅 deploy 身份（私人邮箱即红·squash 须重签 xiyu-deploy）"
  BAD_EMAIL=$(git log --format='%ae' 2>/dev/null | sort -u | grep -vE '^deploy@xiyuai\.cc$' || true)
  if [ -z "$BAD_EMAIL" ]; then check "git author 仅 deploy@xiyuai.cc（无私人邮箱）" 1
  else check "git author 仅 deploy@xiyuai.cc（无私人邮箱）" 0 "squash 重签灭之：$(echo "$BAD_EMAIL" | head -8)"; fi

  echo "==> 11) docs/HANDOFF.md 未跟踪（scrub 已删）"
  if [ -z "$(git ls-files docs/HANDOFF.md 2>/dev/null)" ]; then check "HANDOFF.md 已 scrub（不跟踪）" 1
  else check "HANDOFF.md 已 scrub（不跟踪）" 0 "docs/HANDOFF.md 仍跟踪（副本里须 rm）"; fi

  echo "==> 12) 工作树净（副本=git clone·非 cp -a·防未跟踪泄漏脚本随 cp 混入）"
  DIRTY=$(git status --porcelain 2>/dev/null | grep -v '^$' || true)
  if [ -z "$DIRTY" ]; then check "工作树净（clone 非 cp）" 1
  else check "工作树净（clone 非 cp）" 0 "有未跟踪/改动（cp -a 会带未跟踪 /opt 探针）：$(echo "$DIRTY" | head -5)"; fi

  echo "==> 13) git tag 须空（clone --no-tags·防 tag 可达 HANDOFF blob→push --tags 泄整条 dev 史）"
  TAGS=$(git tag -l 2>/dev/null | grep -v '^$' || true)
  if [ -z "$TAGS" ]; then check "git tag 空（--no-tags 克隆）" 1
  else check "git tag 空（--no-tags 克隆）" 0 "副本须 git clone --no-tags：$(echo "$TAGS" | head -5)"; fi

  echo "==> 14) 真实痕迹黑名单 grep 副本零命中（PIPL/child-safety）"
  # 🔴 黑名单外置到 gitignored 文件 scripts/.release_pii_blacklist——含真实姓名/私邮 handle，
  #    绝不内联进 tracked 脚本（否则 grep 探测器自身就把 PII 再泄漏进公开仓·对抗审查逮出）。
  #    公开仓不含该文件→本闸优雅跳过（发布前已在 dev/scrub 侧验过零命中）。
  #    小满=节气·内联（常见词·非 PII）·白名单 solar_terms.mjs；数字/id 排除 package-lock 哈希假阳。
  BLFILE="$ROOT/scripts/.release_pii_blacklist"
  XM=$(git grep -nI '小满' -- . ':!scripts/opensource_check.sh' ':!src/utils/solar_terms.mjs' 2>/dev/null || true)
  if [ ! -f "$BLFILE" ]; then
    if [ -z "$XM" ]; then check "真实痕迹黑名单（外置文件缺=公开仓正常·仅验小满零）" 1
    else check "真实痕迹黑名单（小满命中·非白名单处）" 0 "$XM"; fi
  else
    BLACK=$(grep -vE '^#|^$' "$BLFILE" | paste -sd'|')
    BL=$(git grep -nIE "$BLACK" -- . ':!scripts/opensource_check.sh' ':!package-lock.json' 2>/dev/null || true)
    if [ -z "$BL" ] && [ -z "$XM" ]; then check "真实痕迹黑名单零命中" 1
    else check "真实痕迹黑名单零命中" 0 "$(printf '%s\n%s' "$BL" "$XM" | grep -v '^$' | head -8)"; fi
  fi

  echo "==> 15) /opt/.env + /root/* 泛化（闸9 盲区扩展·sandbox 白名单外即红·自排除本脚本）"
  P15=$(git grep -lnE '/opt/\.env|/root/' -- 'scripts/**' 'src/**' 'docs/**' 2>/dev/null \
    | grep -vE 'scripts/sandbox_src_(db|failclosed_smoke)\.mjs|scripts/opensource_check\.sh' || true)
  if [ -z "$P15" ]; then check "no /opt/.env + no /root/*（sandbox 守卫外）" 1
  else check "no /opt/.env + no /root/*（sandbox 守卫外）" 0 "泛化为占位：$(echo "$P15" | head -8)"; fi
fi

echo
echo "================================================"
echo "  Pass: $pass / Fail: $fail$([ "$RELEASE" = 1 ] && echo '  (--release 发布副本模式)')"
echo "================================================"
[ "$fail" -eq 0 ]
