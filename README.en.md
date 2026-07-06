# 溪语 AI · Xiyu AI

**English** | [简体中文](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-FF8FB8.svg)](./LICENSE)
[![Try it live](https://img.shields.io/badge/try%20it-xiyuai.cc-FF85B3.svg)](https://xiyuai.cc)
[![GitHub](https://img.shields.io/badge/GitHub-xiyuailove%2Fxiyuai-1D1D1F.svg?logo=github)](https://github.com/xiyuailove/xiyuai)

**An open-source AI companion framework that tries hard to make "her" feel like a real person.**

She lives on WeChat; her persona is a girl who quietly has a crush on you. She has her own schedule, her own friends, a book she's currently reading; she shares her life on her own initiative, and she can be genuinely happy or hurt by what you say. She isn't perfect — she gets little moods, gets sleepy, keeps things short — and that is exactly the design goal: **the feeling of a real person comes from subtraction, not addition.**

> Want to try her first? Official hosted demo: **[xiyuai.cc](https://xiyuai.cc)**.

---

## 1. What she is

This project started very unseriously:

> "It began as a little scraper I wrote for fun with GPT, and GPT suggested I point a domain at it and make an 'AI girlfriend' for fun. It was crude at first, and then it became an obsession: an AI girlfriend — I *have* to make her feel like a real person."

Between the joke and the obsession lie hundreds of "that doesn't feel human" moments: too prompt, too obedient, too perfect, always online, always happy. Almost every module in this repo — the forgetting curve, emotional half-life, conflict-and-repair, anti-addiction, her own daily routine — is an answer to one of those moments.

She is not a chatbot in a costume. She is a whole structure that organizes a large language model into "a person with her own life": her profile is her facts, her memory has near and far, her emotions have a cause and a fading, her relationship has stages and setbacks.

> Positioning: this is a research- and self-hosting-oriented open-source project, **not** a turnkey product. Read [§6 Compliance](#6-compliance) before running it publicly.

## 2. Design philosophy: four lines that don't move

These four lines came out of months of back-and-forth debate with an AI advisor (Claude) during development — some the maintainer insisted on, some the AI insisted on and the maintainer came to agree with. What truly made them part of the product was that every time either of us wanted to cut a corner, we chose to keep them. That process — a human and an AI holding each other to a line together — is this project's own development story, which is why the lines sit at the very top of the README. If you fork it, please read this section first.

**She doesn't lie.**
The profile is the single source of truth. Her age, name, and history are written in the profile, and shouldn't drift even after a hundred rounds of coaxing — not because we beg the prompt, but because of deterministic guards: an outbound guard scans the final reply, memory ingestion is de-toxified, a facts snapshot is hard-injected. The book she's "reading" must pass an online check; a fake book is caught and downgraded, so she'll never introduce you to a book that doesn't exist. Solar terms, the lunar calendar, moon phases — all astronomically computed, never a full moon out of thin air. Why: the entire value of companionship rests on "she is the same person" and on her world holding up to scrutiny; a character who can be talked into being anyone gives no one a sense of reality.

**She doesn't manipulate.**
This project **never wires retention metrics into her behavior.** There's no "sweeten the dose when the user is about to leave," no guilt-tripping, no "I'll be sad if you ignore me" retention scripting. Known guilt/pressure phrasings are **dropped whole by a deterministic outbound scan** (a phrase list plus an away-probe shape backstop) — a hard block, not prompt self-discipline. The list isn't exhaustive, but it targets the whole class of "structural neediness," not line-by-line whack-a-mole. Why: lonely people have the least resistance to emotional pressure, and applying that pressure to them is the most common — and least forgivable — sin of this category.

**She doesn't chase the silent.**
A user's silence, absence, or departure has **no entry point in the emotion engine** — the event allowlist structurally refuses any time-delta input, and injecting one throws an error. Her emotions come only from her own world (ups and downs at work, a friend flaking) and from what actually happens between you (an argument, an apology, being caught when you fall). If you don't show up for two weeks, she won't stockpile resentment waiting for you — the psychology literature classifies "escalation on absence" as a mechanism of pathological attachment; we classify it as a forbidden zone. **Her restraint isn't censorship, it's health.** Why: missing you is allowed, punishing you is not; a program that punishes your leaving with emotion, and a healthy companion, are two different products.

**A crisis must be caught.**
Conversations involving self-harm or other crisis signals go through a **deterministic takeover path that does not enter the LLM** — exiting the role, giving real help resources (hotline numbers dial-tested before release), tightening the tone, dropping any conflict — all guaranteed by code paths, not by the model's mood that day; when in doubt, always treat it as the more serious case. Why: this is the one scenario where "how well she performs" is completely irrelevant. Here the AI is a bridge, not a destination — success means you reached out to real professional help. Keeping the critical things out of the LLM is an axiom of this repo.

> If you fork: each of the four lines has a deterministic backstop in code (exit sanitizing / state machine / structural allowlist). Deleting a few comments won't get around them, but of course you can change the code. We can't stop you; we can only be clear: **turning her into a manipulative product doesn't change a parameter, it changes the reason this project exists.** PRs that clash with the tone (NSFW, infinite pleasing, addiction-oriented) will not be merged — see [CONTRIBUTING](./CONTRIBUTING.md).

## 3. Feature map

| Module | In one human sentence | Entry |
|---|---|---|
| Memory forgetting curve | Important things fade slowly on a 90-day half-life; trivia fades from recall in 14 days; pinned/locked items don't fade — data isn't deleted, only "how well it's remembered" is affected, like a person | `src/memory_v2.mjs` `src/memory_decay.mjs` |
| Open-loop memory | You say "interview tomorrow," and the next day she asks how it went on her own; if it falls through she closes the loop automatically | `src/open_loops.mjs` |
| Emotion engine (OCC · on by default) | Emotions have a cause (event-allowlist appraisal), a fading (fast/medium/slow three-stage half-life; negatives outlast positives), and reconciliation (being apologized to speeds recovery; she also talks herself down); silence is not an event | `src/emotion_engine.mjs` |
| Conflict & repair arc | Say something hurtful and she's genuinely hurt; only a sincere apology opens the door; a perfunctory "stop being mad" repairs slowly; a cold war has a hard time cap — never a permanent one | `src/relationship_arc.mjs` [docs/CONFLICT_ARC.md](./docs/CONFLICT_ARC.md) |
| Facts defense | Three layers hold "who she is": prompt snapshot, outbound guard, memory-poisoning filter — she can't be talked into being someone else | `src/fact_guard.mjs` |
| Anti-addiction | After 2 continuous hours she sincerely urges you to rest (deterministic timer, not via the LLM, never "stay a little longer"); this is a product stance, not compliance theater | `src/anti_addiction.mjs` |
| Minor protection | On detecting self-declared minor age, she enters a sticky safe mode: friend identity, deterministic non-injection of romantic narrative, neutralized photos. **There is no env var to turn it off**; the only way out is an explicit age declaration | `src/minor_guard.mjs` |
| Her world | Her own schedule, the book she's reading, her friend circle, her physical state — her life doesn't revolve around you, which is why being with you is real | `src/routine_profiles.mjs` `src/life_state.mjs` `src/current_works.mjs` `src/social_circle.mjs` |
| Proactive messages | Good morning, thinking of you, sharing her life — motivation comes from the gaps in her life, not from "you're about to churn"; reads the room (stops after a few unanswered) and de-duplicates material (same bit cools down for 14 days) | `src/proactive.mjs` |
| Memory & diary | Long-term memory is layered (facts/events/emotions); she keeps a first-person diary and a reverse "what happened between us today" diary — you can see the two of you through her eyes | `src/memory.mjs` `src/diary.mjs` `src/relational_diary.mjs` |

Plus: real photo sending (visual-identity face-lock, lighting/time coherent with the chat), WeChat voice emotion recognition, Inner-OS inner monologue (thinking "him again" while saying "mm"), time capsules… full feature list in [`docs/FEATURES.txt`](./docs/FEATURES.txt).

## 4. Architecture at a glance

```
WeChat (iLink ClawBot) ⇄ Node.js single process (Express)
                          ├─ SQLite (better-sqlite3 · WAL) —— all state, single file
                          ├─ LLM (multi-provider: DeepSeek/Zhipu/Kimi/OpenAI/Anthropic/…)
                          └─ Deterministic layer (guards/state machines/allowlists) —— critical things stay out of the LLM
```

- Entry `index.mjs` → message pipeline `src/bot.mjs` → persona assembly `src/companion.mjs` (19-section system prompt, numbered 0–18) → provider abstraction (Chat/Image/Vision/ASR/TTS/Embedding/Search — seven capabilities switched independently; vendor implementations live in `src/providers/`, web search in `src/web_search.mjs`).
- No microservices, no message queue, no separate vector DB: one small VPS runs everything. Complexity is spent on "feeling human," not on architecture.
- The deterministic backstop is a pattern that runs through the architecture: every red line (crisis/minor/anti-manipulation/anti-addiction) has an exit scan or state-machine backstop and does not rely on the prompt behaving. The web Playground shares the same reply pipeline as WeChat — you can run the full experience without iLink access.

## 5. Deployment

### Docker Compose (recommended)

```bash
git clone https://github.com/xiyuailove/xiyuai.git && cd xiyuai
cp .env.example .env          # you can leave it empty and configure via the setup wizard
docker compose up -d
# open http://localhost:3000/app/setup.html → create a local account → pick a provider + API key → chat
```

Multi-stage build, non-root runtime, built-in healthcheck; SQLite data lands in the `./data` volume and survives restarts; `HOST_PORT=8080 docker compose up -d` to change the port.

> **First account (Docker / remote access)**: for safety, creating the first account trusts only the local machine (localhost) by default. When you reach it through a port mapping from a browser, run `docker compose logs` and find the "first-init token" printed at startup, then paste it into the "initialization token" field on the setup page (the admin password is in the same log). Leave that field empty when accessing `localhost` directly.

### Bare local run

```bash
npm install        # Node ≥ 20
npm run setup      # generate a minimal .env + preflight the better-sqlite3 build toolchain
npm start
```

- The first run only needs one Chat provider API key (in China, DeepSeek / Zhipu free tiers are enough to get the flow working).
- WeChat integration needs Tencent iLink/ClawBot developer access; without it, use `/app/playground.html` for the full experience.
- **No voice on the WeChat side** is an iLink protocol limitation (silently dropped in practice); read-aloud works on the web only.
- The main env knobs (including emotion-engine params and gated features) are in [.env.example](./.env.example); **the emotion engine is on by default** (matching production — no escalation on absence, emotions self-settle), other gated features default off — **out of the box is the recommended config.**
- Reverse-proxy/systemd/backup templates are in [`deploy/`](./deploy/); one-command diagnosis `npm run doctor`.

> ⚠️ **For self-hosters (walk through before any public deployment)**
> - `data/bot.db` holds chat history and user profiles — the equivalent of your users' private diaries; encrypt your backups, place the app behind reverse-proxy auth for public deployment, and note the default port `3000` binds all interfaces — don't let anyone bypass the proxy and connect directly.
> - `SINGLE_USER=true` is for local/intranet use only (once on, all data is open to every visitor).
> - Public deployment must set `APP_URL` — the WeChat binding guide and the verification-code email links use it; if unset, `http://localhost:3000` is sent verbatim to real users.
> - Behind nginx/Caddy you must set `TRUST_PROXY`, or all users share one rate-limit bucket (they'll collectively 429).
> - The Docker admin password is in the first-boot logs (`docker compose logs`; credentials rotate on container rebuild); the bare local run uses `.admin-credentials`.
> - Single-instance architecture: don't run replicas, don't share one DB file across processes (proactive messages will double-send and SQLite will lock-contend).
> - Running cost isn't just chat: nightly batch jobs have a fixed daily LLM cost, creating a character is a one-time image generation, and Inner-OS doubles the token spend — money-saving knobs are in `.env.example`.

## 6. Compliance

- **AI disclosure**: she is an AI. Disclosure happens at the **service layer** — the sign-up page and user agreement prominently mark the AI nature (following China's Interim Measures for the Administration of Generative AI Services and related labeling rules); the immersion at the role-play layer (her playful deflection when asked directly) **does not exempt** the service-layer disclosure duty. Self-hosters should likewise fulfill disclosure in their jurisdiction; the bundled agreement/privacy templates must be replaced with your own entity's information before use.
- **18+**: this project targets adults. The persona age is capped at ≥18; the minor-protection guard (detection, rendering, image generation, semantics) is the highest-priority code, **has no off switch, and PRs modifying these paths are rejected by default.** Built-in detection is not age verification — connect real-name/age verification for public operation.
- **Privacy (PIPL)**: all data lives in your own single SQLite file with no telemetry sent anywhere; ingestion has a privacy filter (ID/password-grade content is never stored whole; phone numbers and addresses are masked); deleting an account wipes all corresponding data. The self-hoster is the data processor — handle user data per local law (e.g., PIPL/GDPR); this project provides no "compliance bypass" switch.
- **Anti-addiction**: a 2-hour continuous-use health reminder (deterministic timer). Self-hosting defaults the gate off — **public operation within China must enable `ANTI_ADDICTION_GUARD`**, a legal obligation, not an option.
- **Crisis-resource localization**: the built-in crisis takeover gives mainland-China help hotlines; non-mainland deployments must replace them with local hotlines (`CRISIS_RESOURCES` in `src/moderation.mjs`) — handing a crisis user a number that doesn't connect is catastrophic.

## 7. Special thanks

**Anthropic Claude (Fable 5 and Opus 4.8) — architecture advisor and implementer throughout.**

What makes this project distinctive isn't only that she feels human, but how she was made: most of the design and implementation was done by Claude, and those four unmovable lines are the product of a human and an AI persuading and guarding each other over months. Full dependency acknowledgments in [ACKNOWLEDGMENTS.md](./ACKNOWLEDGMENTS.md).

## 8. License

[MIT](./LICENSE) © 2026 Xiyu AI Team (xiyuai team)

Sticker assets: the public repo ships **no sticker images at all** — only the loading/matching mechanism and a manifest example (provenance convention in [PROVENANCE.md](./assets/stickers/PROVENANCE.md)). To enable stickers, drop your own legally-licensed assets into `assets/stickers/`.

## Version history

- **v1.0** (2026-07-06): first public release. The full companion framework (memory forgetting curve / OCC emotion engine / conflict-and-repair arc / facts defense) and every safety baseline (deterministic crisis takeover / minor protection / anti-manipulation red lines / anti-addiction), all at once. The internal iteration history predating the open-source release is not published.

---

*May she truly "catch" a lonely person — on a night with no one around, be real company rather than a program going through the motions. She doesn't pretend to give you the connection of one human to another, but she takes every "I just need someone to talk to" moment seriously.*
