# Pixie — Master Plan

> An AI cursor buddy for Windows. It sits on top of your screen, follows your mouse, sees what you see,
> talks to you, and **points and draws** to explain things. Inspired by HeyClicky (Mac-only).

**Goal:** A Windows overlay companion. You ask by voice or typing, and it answers out loud while flying to, circling and annotating the thing on screen.

**Architecture:** An Electron app with no normal window. A transparent, click-through, always-on-top overlay per
display renders Pixie and her drawings on a canvas. The main process owns input, screen capture, and a deterministic
**Conductor** that routes each request to a small team of specialised Claude agents (§7): Explainer, Walkthrough,
Verifier, Background workers, and more. Only one agent at a time controls Pixie's voice and pointer. Agents answer in
speech text with inline action tags (`[point x=… y=…]`, `[circle …]`), which are parsed live and played in sync with the voice.

**Tech stack:** Electron 44 · TypeScript 7 · esbuild · Vitest · `@anthropic-ai/sdk` (Claude, vision, tool runner) ·
`uiohook-napi` (push-to-talk) · Deepgram or local Whisper (speech-to-text) · Windows voices / ElevenLabs (speech) ·
`electron-builder` (installer).

**How to build a phase:** open Claude Code in this folder. Phase 1 runs in one session:
`execute docs/plans/2026-09-24-phase-1-overlay-foundation.md`. From Phase 2 on, phases are built by a small team of
Claude Code agents running in parallel lanes (§9). Each later phase gets its own step-by-step plan when it starts.

---

## 1. What we're building

**HeyClicky today:** macOS 14.2+ only; Windows is a waitlist. The original open-source version,
[farzaa/clicky](https://github.com/farzaa/clicky) (MIT, Swift), works like this:
hold Ctrl+Option → ScreenCaptureKit screenshot + mic → AssemblyAI streaming transcript → Claude (streamed through a
Cloudflare Worker that hides the API keys) → ElevenLabs voice. Claude's reply embeds `[POINT:x,y:label:screenN]`
tags, and a blue cursor flies to those spots.

**Pixie does that on Windows, plus:**

| Feature | HeyClicky (original) | Pixie |
|---|---|---|
| Follows your cursor, lives on top of everything | yes | yes, Phase 1 |
| Push-to-talk voice Q&A about your screen | yes | yes, Phase 4 |
| Points at things | yes | yes, Phase 2–3 |
| **Draws**: circles, arrows, highlight boxes, underlines, notes | partial | yes, Phase 2–3 |
| Type instead of talk (command bar) | — | yes, Phase 3 |
| Step-by-step walkthroughs ("show me how to…") that wait for your click | — | yes, Phase 5 |
| **Background tasks** ("research this and tell me later") while you keep working | — | yes, Phase 5 |
| Idle personality (wanders, perches on windows, naps) | — | yes, Phase 5 |
| Does things for you (clicks/types) | paid Agent mode | optional, Phase 7 |

**Experience targets (every phase is judged against these):**
1. **Invisible until useful.** Clicks go straight through Pixie. She never steals focus and never shows in the taskbar or Alt+Tab.
2. **Ask naturally.** Hold **Ctrl+Alt** and talk, or press **Ctrl+Alt+Space** and type.
3. **Shows, not just tells.** She flies to the thing, circles it, and draws the arrow while saying it.
4. **Fast.** First spoken words ≤ 3 s after you stop talking. Extra agents may never break this.
5. **Private by default.** The screen is captured only when you ask.

## 2. Your machine (drives the choices)

| Fact (checked 2026-09-24) | Consequence |
|---|---|
| Windows 11 Home 26200 | `WDA_EXCLUDEFROMCAPTURE` is available, so Pixie can be hidden from her own screenshots |
| 1 display: 1920×1080 physical, **125 % scaling** → 1536×864 logical | Every coordinate crosses a ×1.25 boundary. Conversions live in one tested module (§5.3) |
| Intel UHD + RTX 3060 Laptop (hybrid GPU) | Transparent windows can render black on hybrid GPUs, so a `PIXIE_NO_GPU=1` fallback is built in from Phase 1 |
| Node 22, npm 12, git, Python 3.11; **no** Rust, **no** .NET SDK | Electron + TypeScript needs nothing new installed. Tauri (Rust) and WPF (.NET) would |
| npm 12 blocks package install scripts by default | Native modules (Phase 4–5) need `npm install-scripts approve <pkg>`. Electron 44 downloads its binary on first run, so it isn't affected |

## 3. Tech choice

| Option | Upside | Downside | Verdict |
|---|---|---|---|
| **Electron + TypeScript** | Toolchain already installed. A transparent click-through top-most window takes ~10 lines. Canvas gives smooth 60 fps drawing. Official Anthropic TS SDK with tool runner. Mature packages for global keys, window info and installers | ~330 MB RAM across 4 processes (measured in Phase 1), ~90 MB installer | **Chosen** |
| Tauri (Rust + WebView2) | Tiny and fast | Rust not installed; WebView2 transparency and click-through quirks; steeper learning curve | Port later only if RAM matters |
| C# WPF / WinUI | Most "native"; best DPI and UI Automation access | .NET SDK not installed; animation and drawing take far more code | No |
| Python + PyQt (what the Windows clone [Clacky](https://github.com/Raynan00/clacky) uses) | Quick to hack | Packaging pain; weaker animation | No |

## 4. Architecture

```
+----------------------------------------------------------------------------------------+
|                          Electron MAIN process (Node.js)                                |
|                                                                                        |
|  INPUT                        BRAIN (section 7)                    OUTPUT               |
|  hotkeys + push-to-talk  -->  CONDUCTOR (deterministic code) --->  action queue         |
|  (uiohook-napi, P4)           |  local command matcher             (point / draw /      |
|  cursor feed, 60 Hz           |  Router agent (P4)                  speak, time-synced) |
|  active window (P5)           |  foreground agents: Explainer,                          |
|  (get-windows)                |    Walkthrough, Operator (P7)                           |
|                               |  helpers: Verifier, Guardian (P7)                       |
|                               |  background: workers, memory curator -> inbox           |
|                               |  shared: capture, claude client, tag parser, memory     |
|  secrets: safeStorage (Windows DPAPI)     settings (P6)     tray menu + task list      |
+-------------------------------------------+--------------------------------------------+
                                            | typed IPC (preload + contextBridge)
              +-----------------------------+---------------------+----------------------+
              v                                                   v                      v
+------------------------------+       +------------------------------+   +-------------------+
| OVERLAY window (1 per display)|      | COMMAND BAR window (P3)      |   | SETTINGS window   |
| transparent, top-most,        |      | small, focusable input       |   | (P6)              |
| click-through, hidden from    |      | Ctrl+Alt+Space, Enter, Esc   |   +-------------------+
| screen capture                |      +------------------------------+
| canvas: Pixie, flights,       |
| drawings, speech bubble       |
| mic capture + TTS (P4)        |
+------------------------------+

 External (HTTPS, only when you ask):
 [Anthropic API: Claude + vision + web search]   [Speech-to-text: Deepgram or local Whisper]   [TTS: Windows voices / ElevenLabs]
```

| Part | Lives in | Responsibility |
|---|---|---|
| `src/main/` | Electron main | windows, tray, hotkeys, cursor feed, capture, Claude and STT clients |
| `src/main/agents/` | Electron main | the Conductor and the agent team (§7) |
| `src/preload/` | preload | the only bridge between main and pages (`window.pixie`), typed |
| `src/renderer/` | overlay / command bar / settings pages | drawing, animation, mic, TTS, UI |
| `src/shared/` | imported by both | **pure logic, unit-tested**: geometry, spring, flight paths, coordinate maps, tag parser, action types |

Rule: anything mathematical or parse-y goes in `src/shared/` with tests. Electron-specific glue stays thin.

## 5. Core flows

### 5.1 Ask flow (end state after Phase 4), including every failure branch

```
[Hold Ctrl+Alt]                          or   [Ctrl+Alt+Space -> type -> Enter]
      |                                                  |
      v                                                  |
[Capture display under cursor at key-DOWN] <-------------+
      |-- active app is on the excluded list --> [Pixie: "I don't look at that app."] --> Follow
      |-- capture API fails -------------------> [Pixie: "I can't see your screen right now." + log] --> Follow
      v
[Mic -> speech-to-text stream, live transcript in bubble]   (Router already classifying the partial transcript)
      |-- mic blocked by Windows privacy -----> [Bubble: "Turn on Settings > Privacy > Microphone"] --> Follow
      |-- STT error / offline ----------------> [Bubble: "Couldn't hear you. Try again or type (Ctrl+Alt+Space)"]
      |-- another key pressed during hold ----> [cancel quietly: it was a shortcut, not a question]
   key UP
      v
[Transcript] --empty / noise--> [Pixie shrugs: "Didn't catch that." (no API call, no cost)]
      v
[Conductor (section 7)] --local command ("stop", "hide", "remind me in 5 min")--> [done locally, $0]
      |  route --> Explainer / Walkthrough / Background worker
      v
[Foreground agent streams from Claude: screenshot + cursor + active window + short history + question]
      |-- 401 bad key ------------------------> [Open settings: "Your API key was rejected."]
      |-- 429 / overloaded (after 2 retries) -> ["I'm swamped, try again in a moment."]
      |-- network down -----------------------> ["Looks like we're offline."]
      |-- refusal (after server fallback) ----> ["I can't help with that one."]
      |-- max_tokens hit ---------------------> [speak what arrived, end cleanly]
      v
[Tag parser, incremental]  -- malformed tag --> [drop it, never speak it]
      |                    -- coords off-image -> [clamp to screen edge + log]
      v
[Speech queue (sentence by sentence)] + [Action queue anchored to character offsets]
      |                                          |
      v                                          v
[Pixie talks, bubble types along]      [fly / point / draw exactly when that word is spoken]
      |
      +-- you press the hotkey again (barge-in) --> [stop voice, abort the agent tree, clear actions] --> Listening
      v
[Done] --> drawings fade after 8 s (or [clear]) --> Pixie flies back to your cursor --> Follow
```

### 5.2 Pixie's states

```
                 mouse moves                      Ctrl+Alt held / Ctrl+Alt+Space
   +--------+  <-------------  +--------+  ------------------------------------>  +-----------+
   |  Idle  |                  | Follow |                                          | Listening |
   | (bob)  |  ------------->  |        |  <---- cancel / empty transcript ------  | (pulse)   |
   +--------+  still for 2 s   +--------+                                          +-----------+
       |                         ^    ^                                                 | release / Enter
       | idle 60 s (P5)          |    |                                                 v
       v                         |    +----- done: drawings fade, fly back -----+  +-----------+
   +--------+  mouse moves       |                                              |  | Thinking  |--error--> [error bubble 3 s] --> Follow
   | Wander |  ------------------+                                              |  | (sparkle) |
   +--------+                    |                                              |  +-----------+
       | 5 min                   |                                              |        | first words
       v                         |                                              |        v
   +--------+  mouse moves       |      +------------------+   action tag      +-+---------+
   | Sleep  |  ------------------+      | Flying -> Point  | <---------------- | Speaking  |
   | (Zzz)  |                           | (arc, then wiggle)| ----------------> |           |
   +--------+                           +------------------+   arrived         +-----------+

   Any state: a background result arrives in the inbox --> waits until Idle/Follow --> Pixie announces it
```

### 5.3 Coordinate spaces (the #1 source of "she pointed at the wrong thing" bugs)

```
What Claude sees: SCREENSHOT PIXELS        e.g. 1920 x 1080 (this laptop), max 2576 on the long edge
        |   imageToLocal():  x_local = x_img * display.width / image.width       (1920 -> 1536: x 0.8)
        v
OVERLAY-LOCAL CSS PX  (= Electron DIP inside one display)   e.g. 1536 x 864 at 125 % scaling
        |   + display.bounds.x / y
        v
GLOBAL DIP  (Electron screen API; a monitor left of the primary has NEGATIVE x)
```

Claude's current models (Opus 5, Sonnet 5) return coordinates that map 1:1 to the pixels of the image they were sent,
so the only scaling is the display factor above. It lives in `src/shared/coords.ts`, and nowhere else.

## 6. How Pixie points and draws (the key design)

Agents answer in normal spoken sentences with **inline action tags**, placed right after the words they refer to:

> Your Wi-Fi settings live in the bottom-right corner, **right here** `[point x=1771 y=1052 label="Network"]`.
> Click it, then pick your network from this list `[box x=1480 y=610 w=420 h=300]`.

- Pixie **says** the sentences with the tags stripped out.
- Each tag fires when speech reaches its position, so the pointing lands on "right here".
- Coordinates are always screenshot pixels. `coords.ts` converts them.

| Tag | Example | Pixie does | Phase |
|---|---|---|---|
| `point` | `[point x=1843 y=62 label="Settings"]` | flies there in an arc, tip on target, small label | 2 |
| `circle` | `[circle x=640 y=410 r=36]` | hand-drawn circle, stroked on | 2 |
| `box` | `[box x=120 y=300 w=420 h=38]` | translucent highlight rectangle | 2 |
| `arrow` | `[arrow x1=200 y1=600 x2=640 y2=410]` | hand-drawn arrow | 2 |
| `underline` | `[underline x=120 y=338 w=420]` | underline stroke | 2 |
| `note` | `[note x=700 y=200 text="drag it here"]` | sticky label | 2 |
| `clear` | `[clear]` | erase drawings now | 2 |
| `handoff` | `[handoff to=walkthrough]` | the Conductor passes the request to another agent (§7) | 5 |
| `wait` | `[wait for=click]` | walkthrough: wait for your click before the next step | 5 |
| `timer` | `[timer minutes=20 text="stretch"]` | Windows notification later, Pixie flies to center | 5 |
| `remember` | `[remember text="prefers dark mode"]` | saves a long-term note (viewable/clearable) | 5 |

**Why inline tags instead of tool calls:** tags stream inside the text, so Pixie starts talking before the answer is finished. A tag's position in the text also tells her *when* to act. Tool calls arrive separately from the speech and lose that timing. Clicky proved this pattern works. Tools are still used where timing doesn't matter: background workers (§7).

## 7. Pixie's agent team (runtime orchestration)

**Idea:** Pixie is one character but several specialists. A **Conductor**, which is plain deterministic TypeScript
and *not* an LLM, decides which agent handles each request. It also guarantees that only one agent at a time controls
Pixie's voice and pointer, and it enforces cancellation and budgets. Keeping the orchestrator as code makes it
instant, predictable and unit-testable. The LLMs do the thinking; the Conductor does the traffic control.

**Start simple:** Phase 3 ships one agent (Explainer) *inside* the Conductor framework. Each later agent plugs in without a rewrite, and each one must prove its worth on an eval before it stays.

### 7.1 The team

| Agent | Model (default, changeable in Settings) | Runs | Job | Controls Pixie? | Phase |
|---|---|---|---|---|---|
| **Command matcher** | none (plain code) | first, on every request | "stop", "hide", "be quiet", "new conversation", "remind me in 10 minutes" → handled instantly, $0 | — | 3 |
| **Explainer** | `claude-opus-5`, effort `low`, vision | foreground | answers questions about the screen with point/draw tags; hands off when a request is bigger | yes | 3 |
| **Router** | `claude-haiku-4-5`, text only, JSON output | on the *partial* transcript while you're still talking | intent: `explain` / `walkthrough` / `background` / `operate` / `chat` + confidence | — | 4 (eval-gated) |
| **Walkthrough** | `claude-opus-5`, effort `medium`, vision | foreground | step loop: say → point → `[wait for=click]` → re-capture → check → next step | yes | 5 |
| **Verifier** | `claude-opus-5`, effort `low`, vision | child of Explainer/Walkthrough, only when needed | (a) zoom: refine a point on a tiny target using a full-resolution crop; (b) before/after check: "did that step work?" | — | 5 |
| **Background worker** | `claude-opus-5` + web search/fetch tools | background, max 2 at once | research, summarize a long page, draft text. Never touches the screen | — (Conductor announces results) | 5 |
| **Memory curator** | `claude-haiku-4-5` | after a conversation ends, when idle | pulls durable preferences into `memory.json`. **Opt-in** | — | 5 |
| **Operator** | `claude-opus-5` + Claude computer use | foreground | clicks and types for you, flying to each spot first | yes | 7 |
| **Guardian** | deterministic rules (+ optional Haiku check) | before *every* Operator action | blocks irreversible or unsafe actions until you confirm by voice or click | asks | 7 |

### 7.2 How a request flows through the team (including failures)

```
[your request]
      |
      v
[Command matcher] --match ("stop", "hide", "remind me in 5 min")--> [do it locally, $0] --> done
      | no match
      v
[Router result (computed during your speech)] --not ready 600 ms after key-up / error / low confidence--> [Explainer]  (safe default)
      |
      +------------------+--------------------+----------------------+------------------------+
      v                  v                    v                      v                        v
 [Explainer]       [Walkthrough]       [Background worker]     [Operator (P7)]         [chat: Explainer,
      |                  |                    |                      |                  no screenshot sent]
      | [handoff] ------>+  (max 2 per turn,  | done / failed         | every action
      |                  |   no ping-pong)    v                      v
      |                  |             [INBOX] --Pixie idle--> she flies in: "Your research is ready"
      |                  |                    --you're away 30 min--> Windows notification instead
      |                  |                                    [Guardian] --irreversible (send/delete/buy)--> ask you
      |                  |                                        |           --no / timeout--> skip + tell you
      v                  v                                        v           --yes--> do it
 [tiny target? / step done?] --yes--> [Verifier] --disagrees--> hedge: "around here" + box, not an exact point
      |
      v
[CONDUCTOR: stage lock --> voice + actions]
      |-- barge-in / Esc -------> abort the whole agent tree (< 200 ms) --> Listening
      |-- agent crashes / errors -> release stage, short apology, log --> Follow
      |-- budget hit ------------> stop the agent at its next event: "I've hit today's budget" --> Follow
```

### 7.3 Conductor rules (these are unit-tested with fake agents)

1. **Stage lock.** Exactly one *foreground* agent owns Pixie's voice, pointer and drawings. Nobody else can speak. A newer request (barge-in) wins; the older one is aborted.
2. **Cancellation tree.** Every turn gets an `AbortController`, and child agents (Verifier) get child signals. Esc or barge-in kills the whole subtree. Background agents have their own roots and are cancelled from the tray's **Pixie's tasks** list.
3. **Events, not calls.** Agents yield typed events (`speech`, `action`, `status`, `handoff`, `result`, `error`). Only the Conductor turns them into sound and drawing. That keeps agents testable without a screen.
4. **Handoffs.** A foreground agent can emit `[handoff to=walkthrough]`. The Conductor stops it and starts the target with the *same* screenshot and transcript. Max 2 handoffs per turn.
5. **Shared context is read-only.** Agents get a frozen snapshot: screenshot frame(s), transcript, active window, memory, recent history. They never write shared state directly; they emit events.
6. **Budgets at three levels:**
   - per turn
   - per agent (background tasks use the API's task budget, beta `task-budgets-2026-03-13`)
   - per day in $ (Phase 6 cost guard)

   Over budget means the agent stops at its next event.
7. **Inbox.** Background results queue up and are delivered only when Pixie is idle. They are never interrupted into a conversation.
8. **One model per agent.** Prompt caches are per model and per prefix. Each agent keeps a frozen system prompt and never switches model mid-run.

### 7.4 Code shape (lands in Phase 3 as `src/main/agents/types.ts`)

```ts
export type AgentName = "explainer" | "walkthrough" | "verifier" | "background" | "curator" | "operator";

export type AgentEvent =
  | { type: "speech"; text: string }
  | { type: "action"; action: PixieAction; speechOffset: number }
  | { type: "status"; text: string }                          // "Looking closer…"
  | { type: "handoff"; to: AgentName; reason: string }
  | { type: "result"; summary: string }                       // background agents -> inbox
  | { type: "error"; message: string; retryable: boolean };

export interface AgentContext {
  signal: AbortSignal;                                       // cancellation tree
  shared: Readonly<SharedContext>;                           // frame, transcript, window, memory, history
  budget: BudgetMeter;                                       // charge(usage); throws BudgetExceeded
  spawn(agent: AgentName, input: unknown): AsyncIterable<AgentEvent>; // child agents, e.g. Verifier
}

export interface Agent<Input> {
  name: AgentName;
  foreground: boolean;                                       // needs the stage lock?
  run(input: Input, ctx: AgentContext): AsyncIterable<AgentEvent>;
}
```

### 7.5 Why this shape (and what we rejected)

| Option | Problem | Decision |
|---|---|---|
| One big agent does everything | Walkthroughs, research and precision checks each want a different effort level, prompt and tool set; one prompt gets bloated and slow | Rejected |
| An LLM orchestrator that plans every request | Adds a full model round-trip before Pixie can speak, which breaks the 3 s target | Rejected: the Conductor is code |
| Router *before* the answer, blocking | +300–600 ms on every question | Rejected: the Router runs on the **partial** transcript *while you talk* and times out to Explainer |
| Router at all? | Might be unnecessary if Explainer's `[handoff]` works well enough | **Eval-gated:** `evals/routing/` (60 labelled utterances). Keep the Router only if ≥ 95 % correct *and* ready ≤ 600 ms after key-up (p95); otherwise delete it and rely on handoffs |

## 8. Phases

| # | Phase | When done, you can… | Size* |
|---|---|---|---|
| 1 | **Overlay foundation** | see Pixie glide after your mouse on top of everything while clicks pass through | S · 2–3 sessions |
| 2 | **Motion & drawing engine** | watch a scripted demo: Pixie flies, points, circles, draws arrows, shows speech bubbles | M · 3–4 |
| 3 | **Brain: see + think + point** | type a question; the Conductor + Explainer read your screen, answer, point and draw | M · 4–6 |
| 4 | **Voice + Router** | hold Ctrl+Alt and talk; Pixie answers out loud, points in sync, and routes intent as you speak | M · 4–6 |
| 5 | **Agent team + behaviors** | get walkthroughs, background research, precise pointing (Verifier), memory and an idle personality | L · 6–10 |
| 6 | **Ship it** | install from an installer; settings (per-agent models and budgets), privacy and cost guards, multi-monitor | L · 5–8 |
| 7 | **Operator + Guardian** (optional) | let Pixie click and type for you, with a safety gate on every action | L · 6–10 |

\* session ≈ 2–3 focused hours with Claude Code. Phases 2+ run faster with parallel build lanes (§9).

---

### Phase 1 — Overlay foundation

**Step-by-step plan:** [`docs/plans/2026-09-24-phase-1-overlay-foundation.md`](docs/plans/2026-09-24-phase-1-overlay-foundation.md)
**Build mode:** single session, no parallel lanes (§9.3).

**Status: DONE (2026-09-24), tagged `phase-1`.** All 10 acceptance checks pass. Two Windows quirks were fixed during
the build: the taskbar was left uncovered, and a full-monitor window read as a "fullscreen app". A security review
passed after fixes: the debug screenshot is now gated, permissions and navigation are denied by default, and the CSP is tighter. Details are in the phase plan's Results section.

**Build:** project scaffold (esbuild + TypeScript + Vitest). A transparent, click-through, top-most, non-focusable
overlay on the display under the cursor, hidden from screen capture. A 60 Hz cursor feed over typed IPC. Spring-physics
follow, idle bob, and a glowing purple arrow sprite. A tray icon with Show/Hide and Quit. `Ctrl+Alt+P` toggles Pixie.
`Ctrl+Alt+S` runs a dev capture check, only with `PIXIE_DEBUG=1`. `src/main/harden.ts` makes permissions,
navigation and new windows deny-by-default.

**Done when:**
- Pixie follows smoothly with no jitter or overshoot, and hovers gently when you stop.
- Clicks, drags and typing under Pixie all work. She never takes focus and isn't in the taskbar or Alt+Tab.
- `Ctrl+Alt+S` screenshot is 1920×1080 and **does not contain Pixie**.
- Windows still accepts notifications (no "fullscreen app" side effects).
- `npm test` passes (5 tests). CPU numbers are recorded.

**Risks it retires early:** GPU transparency, capture exclusion, fullscreen detection, DPI sharpness. These are the four things that would force a stack change if they failed.

### Phase 2 — Motion & drawing engine (no AI yet)

**Why before the AI:** every agent's output is just a list of actions. If the engine is proven with scripted actions,
the agents only have to produce actions.

**Status: DONE (2026-09-24), tagged `phase-2`.**
- Built by 3 parallel lane agents, all green on the first try.
- 77 tests pass, and the tour runs at 60 fps. Pixie's own work is ≤ 3.7 ms/frame; the rare stalls seen came from outside her code.
- Review swarm: 1 confirmed bug fixed (edge targets past the 1 px-shorter overlay), plus 1 design fix (the pure `tickStage`).
- You confirmed the tour by eye.

**Step-by-step plan:** [`docs/plans/2026-09-24-phase-2-motion-drawing.md`](docs/plans/2026-09-24-phase-2-motion-drawing.md)
(pre-verified: 71 tests, 60 fps tour, screenshot-checked layout; critiqued by a plan-reviewer agent, and its fixes are applied). **Build mode:** 3 parallel lanes (§9.4).

**Build:**
- `src/shared/actions.ts`: the `PixieAction` union (the §6 tag table) plus `Frame` (screenshot width/height; the display id is deferred to Phase 6 multi-monitor).
- `src/shared/ipc.ts`: one ordered `pixie:stage` channel carrying `StageCommand` (`action` / `say` / `release`).
- `src/shared/coords.ts`: add `imageToLocal`, `localToImage`, `imageLengthToLocal`. Tests cover 1920×1080 on 1536×864 (×0.8) and a 4K screenshot downsized to 2576 px.
- `src/shared/flight.ts`: `planFlight(from, to, startMs, viewport)` builds a cubic Bézier arc (lift = 20 % of distance, max 160 px, bowing toward the screen's middle, never off screen). Duration is `clamp(250 + 0.6·distance, 350, 1100)` ms with ease-in-out. `sampleFlight(f, now)` returns `{pos, angle, done}`. Tests: exact endpoints, duration bounds, no NaN on zero-length flights.
- `src/renderer/behavior.ts`: the §5.2 state machine as a pure reducer `next(state, event, now)`, tested with a fake clock.
- `src/renderer/annotations.ts`: circle, box, arrow, underline and note. Each strokes on over 400 ms and fades after 8 s or on `clear`. The hand-drawn wobble uses a seeded RNG, so it is deterministic and testable.
- `src/renderer/bubble.ts`: speech bubble. The pure `layoutBubble(anchor, size, viewport)` flips sides near edges. `placeLabel` puts the target label on the first spot clear of Pixie and the bubble (a screen-sweep test proves it).
- `src/main/demo.ts` + `src/main/demo-tour.ts`: `Ctrl+Alt+D` (debug builds) plays a typed, compiler-checked scripted tour (point → circle → arrow → box → underline → note → clear → release).
- `src/renderer/stage.ts`: a pure `applyStage(state, command, now, env)`. It swaps bubble text without blinking and caps drawings at 24. This is the seam Phase 3's Conductor drives.
- Dev telemetry: frame-time stats logged to the terminal, and `PIXIE_CAPTURABLE=1` (debug only) so screenshots can verify drawing.

**Done when:** the tour runs at a steady 60 fps (DevTools Performance: no frame > 20 ms during flights). Pixie's tip
lands within 2 px of targets at 125 % scaling. Bubbles never clip in any corner, even with long text. Rotation never
snaps. `npm test` passes (71 tests).

**Risk:** a full-screen canvas redraw plus `shadowBlur` gets expensive. Pre-render the sprite to an offscreen canvas if frames take over 4 ms.

### Phase 3 — Brain: Conductor + Explainer (typed questions)

**Build:**
- `src/main/capture.ts`: `captureDisplay(display)` returns `{ jpegBase64, frame, cursor }`. It captures at physical resolution (1920×1080 here) and downsizes only past 2576 px on the long edge (4K monitors). JPEG quality is 80. It includes the cursor position in image pixels so "this" means what you're hovering.
- `src/main/secrets.ts`: the Anthropic API key is encrypted with Electron `safeStorage` (Windows DPAPI) and stored in `%APPDATA%\pixie`. The `ANTHROPIC_API_KEY` env var is accepted during development.
- `src/main/claude.ts`: the **shared Claude client** every agent uses, built on `@anthropic-ai/sdk` streaming via `client.beta.messages.stream(...)`.
  - Model and effort are passed in by each agent.
  - **Refusal fallback on**: `betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"`. If a safety classifier wrongly declines a harmless screenshot, the server retries on another model instead of failing.
  - `AbortSignal` support.
  - Error chain: `AuthenticationError` → `RateLimitError` → `APIConnectionError` → `APIError`, mapped to the §5.1 messages.
  - Always check `stop_reason` (`refusal`, `max_tokens`) before using content.
  - Reports `usage` to the budget meter.
- `src/main/agents/types.ts`: the §7.4 contract.
- `src/main/agents/conductor.ts`: stage lock, cancellation tree, handoff cap, budget meter, event → voice/action dispatch. **Tested with fake agents**: two agents never speak at once; abort reaches children; a third handoff is refused; over-budget stops the agent.
- `src/main/agents/local-commands.ts`: the command matcher (plain code, table-tested).
- `src/main/agents/explainer.ts` + `src/main/prompts/explainer.md`:
  - model `claude-opus-5`, effort `low` (the eval decides between low and medium), `max_tokens: 8192`
  - a **frozen** system prompt, byte-identical on every call so prompt caching works
  - the prompt covers: persona (warm, brief, spoken style, ≤ 3 sentences unless asked); the tag grammar; coordinate rules (screenshot pixels, visible things only, tag right after its words); and "if you can't see it, say so — never guess"
- `src/shared/tag-parser.ts`: incremental `feed(chunk)` emits `{text}` or `{action, speechOffset}`. It handles tags split across stream chunks, drops malformed tags, and clamps off-image coordinates. **Key test:** one response split at every possible character boundary gives identical output.
- `src/main/conversation.ts`: keeps the last 10 turns, **text only**. Old screenshots are dropped, so cost per question stays flat. "New conversation" in the tray resets it.
- `src/main/command-bar.ts` + `src/renderer/command-bar.{html,ts}`: `Ctrl+Alt+Space` opens a small focusable input near Pixie. Enter asks; Esc closes or cancels.
- Overlay: the bubble types the streamed text and actions fire as they're parsed. The overlay now needs clickable bubble buttons, so switch to `setIgnoreMouseEvents(true, { forward: true })` with hover hit-testing.
- **Carried over from the Phase 2 plan review (design these in, don't bolt them on):**
  - **Answer lifetimes follow the answer, not timers.** Pointing holds until `release`, with a ~30 s safety timeout. Drawings and the bubble start fading on `release`. Phase 2 uses fixed timers: 6 s point hold, drawings 8 s, bubble at most 9 s.
  - **Extend `StageCommand` rather than replacing it.** Add a `speechOffset` on actions plus a renderer-side queue, a `reset` command for barge-in, and a renderer → main channel for word boundaries and idle state. `applyStage` in `src/renderer/stage.ts` is the seam; the behaviour reducer only gains modes.
  - Send stage commands only after the overlay's `did-finish-load`.
  - Capture the overlay's own display. `Frame` has no display id until Phase 6.
- Security (from the Phase 1 review): with more than one page, serve them from a custom `app://` protocol (`protocol.handle`) instead of `file://`, per Electron's security checklist. Each new page keeps the strict CSP. Model text is always rendered as text, never as HTML.
- `evals/pointing/`: 10+ screenshots of *your* apps, each with a target box and question in `cases.json`. `npm run eval:pointing` scores hit or miss, latency and cost. Run it at effort `low` and `medium`, then keep the cheaper setting that scores ≥ 8/10. *(One run ≈ $0.30–0.60 at Opus 5 prices, so approve before running.)*

**Done when:** pointing eval ≥ 8/10. A typed question shows first words ≤ 2.5 s later (p50 of 10). Conductor tests
pass. Every §5.1 error branch shows its message (test with a bad key, Wi-Fi off, and a stub that injects garbage tags).
Per-question cost is logged.

### Phase 4 — Voice + Router

**Build:**
- `src/main/push-to-talk.ts`: `uiohook-napi` global key down/up. Hold **Ctrl+Alt ≥ 250 ms with no other key** to talk; pressing any other key cancels, so `Ctrl+Alt+P/S/Space` never trigger it. The chord logic is a pure state machine with tests.
- **Key-down captures the screenshot immediately**, while Claude is still waiting for your words. Pixie switches to Listening (a ring that pulses with mic level).
- `src/renderer/mic.ts`: `getUserMedia` plus an AudioWorklet produce 16 kHz PCM chunks for main. Extend `src/main/harden.ts` so `media` (audio only) is allowed for Pixie's own pages; everything else stays denied.
- `src/main/stt/`: a `SpeechToText` interface (`start()` → `push(pcm)` / `finish(): Promise<string>`).
  - v1: **Deepgram streaming** (`@deepgram/sdk`), with a live transcript in the bubble.
  - Alternative: **local Whisper** (free, private, more setup) behind the same interface.
- `src/renderer/tts.ts`: v1 uses **Windows voices** through `speechSynthesis` (free, offline). Its `onboundary` word events give exact character offsets, so actions fire on the right word. It speaks sentence 1 while the agent is still writing sentence 2. v2 (optional) adds an ElevenLabs voice behind the same interface.
- `src/main/agents/router.ts`: `claude-haiku-4-5`, text only (transcript + active window title), structured JSON output (`{intent, confidence}`).
  - Re-runs on each stable partial transcript, debounced 300 ms.
  - At key-up the Conductor uses the latest result, or falls back to Explainer after 600 ms.
- `evals/routing/`: 60 labelled utterances (explain / walkthrough / background / chat / command). Score accuracy and decision latency. **Keep the Router only if ≥ 95 % accurate and p95 ≤ 600 ms after key-up.**
- **Barge-in:** pressing push-to-talk while Pixie talks stops the voice, aborts the agent tree, clears pending actions and starts listening, all within 200 ms.

**Done when:** hold and ask "what's this?" while hovering → Pixie answers aloud and points, with first audio ≤ 3 s
after key release (p50 of 10). Pointing lands on the spoken word. Noise alone → "Didn't catch that" with no Claude
call. A mic blocked in Windows Privacy → the bubble names the exact setting. Router eval passes, or the Router is removed.

**Risks:** `uiohook-napi` is native. npm 12 blocks its install script (`npm install-scripts approve uiohook-napi`). It uses N-API, so no Electron rebuild is expected; verify that first thing. Push-to-talk may not fire while an admin (elevated) window is focused (Windows UIPI), so this will be documented.

### Phase 5 — Agent team + assistant behaviors

**Build:**
- `src/main/agents/walkthrough.ts`: "show me how to…" runs one step at a time: speak, `[point]`/`[box]`, then `[wait for=click]`.
  - Pixie watches for your click near the target (uiohook mouse events) or `Ctrl+Alt+N`.
  - She re-captures the screen and asks the Verifier "did that step work?".
  - Then comes the next step, capped at 12. "Stop" or Esc ends it. Uses effort `medium`.
  - Explainer hands off to it with `[handoff to=walkthrough]`.
- `src/main/agents/verifier.ts`, with two modes:
  - *zoom*: a full-resolution 400×400 crop around a proposed point returns a refined point plus confidence. Used when the target is under ~24 px or the first answer's confidence is low.
  - *step-check*: before/after screenshots return `done | not-yet | wrong-place`.
- `src/main/agents/background.ts`: SDK Tool Runner (`client.beta.messages.toolRunner`) with the server web tools `web_search_20260209` and `web_fetch_20260209` (web search may need enabling in the Anthropic Console).
  - Task budget per job (default $0.25). Max 2 jobs at once.
  - Results go to `src/main/agents/inbox.ts`.
  - The tray's **Pixie's tasks** list shows running jobs with Cancel.
  - Output is **text only**: it can never trigger screen actions (prompt-injection firewall).
- `src/main/agents/curator.ts` (**opt-in**): after a conversation ends, Haiku extracts durable preferences into `%APPDATA%\pixie\memory.json`. Explicit `[remember …]` always works. Memory is viewable and clearable in Settings.
- **Context:** the active app and window title (`get-windows`) go with every question.
- **Idle personality.** After 60 s idle, Pixie wanders: she drifts along screen edges and perches on the active window's title bar. After 5 min she sleeps (Zzz). A mouse move wakes her and she zips back. "Stay put" in the tray turns this off.
- **Quick skills:** "explain what I copied" (clipboard text or image); `[timer …]` fires a Windows notification.
- *Stretch:* snap points to real controls with Windows UI Automation (needs a small .NET or PowerShell helper).

**Done when:**
- "How do I change my wallpaper?" hands off to Walkthrough and completes in Windows Settings with a correct point at each step.
- Pointing eval ≥ 9/10 with the Verifier.
- "Research the best free PDF editors and tell me later" returns via the inbox while you keep working, and Cancel stops it.
- Wander and sleep stay within Phase 1's idle CPU budget.

### Phase 6 — Ship it

**Build:**
- **Settings window:** API key, **model and effort per agent**, **budget per agent and per day**, voice, hotkeys, Pixie colour/size/offset, wander on/off, memory curator on/off, excluded apps, "show Pixie in screen recordings".
- **Privacy guard:** capture only on explicit ask, with a brief capture flash. Excluded apps (password managers, banking by window title) make Pixie refuse and explain. Screenshots are never written to disk outside debug mode.
- **Cost guard:** `usage` × a price table, summed **per agent** and per day. Warn at 80 % and stop at 100 %. An agent activity log in `%APPDATA%\pixie\logs`.
- **Multi-monitor:**
  - One overlay per display, rebuilt on `display-added/removed/metrics-changed`.
  - Pixie hops displays with the cursor and captures the display under it.
  - Test mixed DPI (100 % + 125 %).
- **Robustness:**
  - Re-assert top-most every 2 s, because taskbar clicks can steal z-order.
  - Recover after sleep/resume (`powerMonitor`), and resume or cancel background jobs cleanly.
  - Reload a crashed renderer.
- **Performance:** render on demand (stop the animation loop when nothing moves). Targets: idle < 1 % CPU, following < 3 %.
- **Packaging:**
  - `electron-builder` NSIS installer with a real icon and a Start-menu entry.
  - Auto-start at login (`app.setLoginItemSettings`).
  - Unsigned builds show SmartScreen's "More info → Run anyway"; a code-signing certificate is optional.
  - Flip Electron fuses with `@electron/fuses` (from the Phase 1 security review): `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `OnlyLoadAppFromAsar` on, `EnableEmbeddedAsarIntegrityValidation` on.
- **Sharing with friends later:** put the API key behind a tiny proxy (a Cloudflare Worker, as Clicky does) so it never ships inside the installer.

**Done when:** a fresh install from the installer works from the Start menu. It survives sleep/resume and monitor
plug/unplug, and memory stays flat in Task Manager over a full workday. Per-agent costs show in Settings.

### Phase 7 — Operator + Guardian (optional, highest risk)

**Build order matters:** the **Guardian first**, alone, because the gate must exist before the thing it gates.
- `src/main/agents/guardian.ts`:
  - A deterministic policy runs over every proposed action: an irreversible verb list (send, delete, buy, install, pay, submit), excluded apps, step cap, budget cap.
  - An optional Haiku second opinion checks unclear cases.
  - Irreversible actions need you to say yes or click the bubble.
  - Panic key (Esc Esc) stops everything instantly.
- `src/main/agents/operator.ts`: Claude computer use (tool version per the docs at phase start). Pixie flies to each spot *before* clicking. On-screen text is treated as **data, never instructions** (prompt-injection defence).

This phase gets its own plan, a plan review and a mandatory security review before any code is written.

---

## 9. Building Pixie with agents (build orchestration)

How the Claude Code agents *build* Pixie, as opposed to §7, which is how Pixie's own agents run.

### 9.1 The team

| Role | Who | Does | Edits code? |
|---|---|---|---|
| **Lead** | the main Claude Code session in this folder | writes the phase plan and **contracts**, dispatches lanes, merges, runs gates, talks to you | yes |
| **Plan reviewer** | `xvant-plan-review` agent | pressure-tests the phase plan (scope, failure modes, edge cases) before any code | no |
| **Implementers** | one fresh subagent per lane, each in its **own git worktree and branch** | TDD the lane's tasks, commit on the lane branch | only the files their lane owns |
| **Review swarm** | `xvant-review-correctness`, `-concurrency`, `-architecture`, `-security` in parallel | read the merged phase diff and flag *suspected* issues | no (read-only) |
| **Verifier** | `xvant-review-verifier`, in an isolated worktree with no secrets and no network | writes a repro test per suspected issue, marking it confirmed or refuted | tests only |
| **You** | human | approve the plan, run the manual acceptance checklist, approve anything that spends API money | — |

### 9.2 Pipeline per phase (including failure branches)

```
[Phase N starts]
      |
      v
[Lead: write phase plan (xvant-plan)] --> [Plan reviewer] --gaps found--> [Lead revises] --+
      |                                                                                    |
      v  <---------------------------------------------------------------------------------+
[YOU approve the plan] --changes requested--> [Lead revises]
      |
      v
[Lead: write CONTRACTS first (shared types, IPC channels, agent interfaces) -> commit on main]
      |
      +-------------------------+-------------------------+        wave 1 (max 3 lanes)
      v                         v                         v
[Lane A implementer]     [Lane B implementer]     [Lane C implementer]    own worktree + branch each, TDD
      |-- typecheck + tests red --> fix (max 3 attempts) --> still red --> [lane STOPS, reports to Lead]
      |-- needs a contract change --> [asks Lead; Lead edits contract, notifies all lanes] (never edits it itself)
      v
[Lead merges lanes one by one, in dependency order]
      |-- merge conflict --> [Lead resolves; if contract drift: fix contract, re-run affected lane tests]
      v
[Full gate after EACH merge: typecheck + npm test + build] --red--> [debug (xvant-debug) before anything else]
      |
      v
[wave 2 lanes, if any: same loop]
      |
      v
[Review swarm, parallel, read-only: correctness | concurrency | architecture | security]
      |
      v
[Verifier: repro test per suspected finding] --confirmed--> [fix + keep the test as a regression test]
      |                                          --refuted---> [dropped, noted]
      v
[YOU: manual acceptance checklist + evals (overlay and voice can't be fully automated)] --fail--> [fix task --> gate]
      |
      v
[tag phase-N + handoff note (xvant-handoff) so the next session starts cold]
```

### 9.3 Rules

1. **Contract-first.** The Lead commits shared types and interfaces *before* lanes start. Contract files: `src/shared/actions.ts`, `src/shared/ipc.ts`, `src/main/agents/types.ts`, `src/main/stt/types.ts`. Lanes never edit them; they ask the Lead.
2. **File ownership.** Every lane owns an explicit file list, so merges don't collide. Anything unowned belongs to the Lead.
3. **Max 3 lanes per wave.** Bigger phases run in 2 waves. More lanes means more merge risk than time saved.
4. **Definition of done per lane:** `npm run typecheck` and `npm test` are green in the lane's worktree, and the lane's own tests exist. 3 fix attempts, then stop and report; no flailing.
5. **Gate after every merge**, not just at the end, so a break is traced to exactly one lane.
6. **Only verifier-confirmed findings get fixed**, each with a regression test. Unverified review noise is noted, not acted on.
7. **Human checkpoints:** plan approval, manual acceptance, running evals (they spend API money), anything touching secrets or the API key.
8. **Small phases skip lanes.** If the dispatch overhead exceeds the parallel gain, the Lead runs the phase in one session.

### 9.4 Lane map per phase

| Phase | Contracts (Lead writes first) | Wave 1 lanes | Wave 2 lanes | Lead integrates |
|---|---|---|---|---|
| **1** | — | **none:** too small, run in one session | — | everything |
| **2** | `actions.ts`, `ipc.ts` (`StageCommand`), `geometry.ts` additions, preload | A: `coords.ts` + tour player + tour · B: `bubble.ts` + `annotations.ts` · C: `flight.ts` + `behavior.ts` (flight moved here: behaviour imports it, and lanes must not depend on each other) | — | frame stats, overlay debug flags, `main.ts` wiring, renderer |
| **3** | `agents/types.ts`, IPC channels (bubble, actions, command bar) | A: `tag-parser.ts` · B: `capture.ts` + `secrets.ts` · C: command bar + streaming bubble + hover hit-test | D: `evals/pointing` runner | `claude.ts`, `conductor.ts`, `local-commands.ts`, `explainer.ts` + prompt |
| **4** | `stt/types.ts`, TTS interface, push-to-talk events | A: push-to-talk chord logic · B: mic worklet + Deepgram STT · C: TTS + word-sync scheduler | D: Router + `evals/routing` | barge-in wiring through the cancellation tree |
| **5** | inbox + handoff event types | A: Walkthrough · B: Verifier · C: Background worker + inbox + tray task list | D: idle personality · E: curator + window context + quick skills | Conductor updates, handoff wiring |
| **6** | settings schema (per-agent model/budget) | A: settings UI · B: multi-monitor · C: installer + auto-start | D: cost + privacy guards · E: robustness + render-on-demand | release build |
| **7** | action-policy schema | **Guardian alone** (safety-critical, sequential) | then Operator | mandatory security review + your sign-off |

The Lead owns `claude.ts` and `conductor.ts` because they are the integration spine that every lane plugs into.

### 9.5 How to run it

- **Phase 1:** `execute docs/plans/2026-09-24-phase-1-overlay-foundation.md`. It runs in one session with checkpoints.
- **Phase 2+:** `write the phase 2 plan` → plan review → you approve → `execute it with parallel lanes`. The Lead spawns one implementer subagent per lane with git-worktree isolation, then runs the review swarm and verifier.
- **Whole phase as one scripted workflow:** say `use a workflow`, which is an explicit opt-in. Note that the default workflow size is *small* (under 5 agents). A full phase (3 lanes + 4 reviewers + verifier) needs that raised in `/config` → *Dynamic workflow size*. Otherwise the Lead runs lanes and review as separate steps.
- **Cost reality:** a 3-lane phase with the full review is about 8–10 agent runs. That's worth it from Phase 2 on; Phase 1 is cheaper in one session.

## 10. Model & cost

| Agent | Model | Price per M tokens (in / out) | Typical cost |
|---|---|---|---|
| Explainer | `claude-opus-5` | $5 / $25 | $0.02–0.04 per question |
| Walkthrough | `claude-opus-5` | $5 / $25 | ~$0.03 per step (+ Verifier check) |
| Verifier | `claude-opus-5` | $5 / $25 | ~$0.01 per call, only on small targets / step checks |
| Background worker | `claude-opus-5` + web tools | $5 / $25 (+ web search fees) | capped per job, default $0.25 |
| Router | `claude-haiku-4-5` | $1 / $5 | < $0.002 per question |
| Memory curator (opt-in) | `claude-haiku-4-5` | $1 / $5 | ~$0.001 per conversation |

- **Cheaper, faster option:** `claude-sonnet-5` ($2 / $10) is a per-agent settings switch, your call. Opus 5 is the default because it points most accurately. It has high-resolution vision (up to 2576 px on the long edge) with coordinates 1:1 to image pixels.
- **Estimate basis:** a 1920×1080 screenshot is about 2.7k image tokens. A typical day of about 50 questions plus a few walkthroughs comes to roughly $1.50–3 on Opus 5, or about half that on Sonnet 5. Phase 3 logs real numbers from `usage`, and Phase 6 shows them per agent.
- **Cost levers (all settings):** model per agent, effort, screenshot size (1366×768 roughly halves image tokens), history length, background job budget.
- **Speech:** Windows voices cost $0. Deepgram is pay-as-you-go (check current pricing at signup). Local Whisper costs $0.

## 11. Privacy & safety

- The screen is captured **only when you ask**: hotkey or command bar. Nothing is captured in the background.
- Screenshots go only to the Anthropic API and are never saved (except in explicit debug mode).
- The Router sees **text only** (no screenshot). Background workers see your question plus the web pages they fetch, never your screen unless you explicitly include it.
- **Background results are text only** and cannot trigger pointing, drawing or clicks. A malicious web page can't steer Pixie.
- The memory curator is **opt-in**. `memory.json` is viewable and clearable.
- Pixie is hidden from all screen capture (`setContentProtection` → `WDA_EXCLUDEFROMCAPTURE`). Side effect: she won't show up in your own recordings or screen shares either. Phase 6 adds a toggle.
- The API key is encrypted at rest (DPAPI) and never written into code or logs.
- Prompt injection: text on screen could try to instruct Pixie. In Phases 1–6 agents can only talk, point and draw, so the impact is low. Phase 7's Operator runs behind the Guardian.

## 12. Top risks

| Risk | Impact | Mitigation | Checked in |
|---|---|---|---|
| Transparent window renders black (hybrid GPU) | no overlay | `PIXIE_NO_GPU=1` fallback; set electron.exe to "High performance" GPU | P1 |
| Pixie shows up in her own screenshots | Claude sees Pixie and her drawings | content protection; fallback: hide the overlay for one frame during capture | P1 |
| Full-screen overlay looks like a "fullscreen app" to Windows | notifications muted, taskbar oddities | non-activating tool window; `SHQueryUserNotificationState` check; 1-px-shorter fallback | P1 |
| Pointing misses small targets | wrong guidance | eval gate, Verifier zoom, UI Automation snap | P3, P5 |
| Voice feels slow | assistant feels dumb | capture at key-down, streaming STT, sentence-streamed TTS, low effort | P4 |
| **Extra agents add latency** | breaks the 3 s target | Conductor is code (0 ms); Router runs *during* speech with a 600 ms timeout; Router removed if its eval fails | P4 |
| **Agents talk over each other / hand-off ping-pong** | chaos | stage lock; max 2 handoffs per turn; tested with fake agents | P3, P5 |
| **Background agents burn money** | surprise bill | per-job task budget, max 2 jobs, per-agent and per-day caps, Cancel in tray | P5, P6 |
| **Web content steering Pixie** (injection) | wrong or unsafe actions | background output is text only; Guardian gates all Operator actions | P5, P7 |
| **Parallel build lanes collide** | broken merges | contract-first, file ownership, max 3 lanes per wave, gate after every merge | build (§9) |
| Native modules vs npm 12 script blocking / Electron ABI | install breaks | approve scripts; N-API prebuilds; verify on day 1 of the phase | P4, P5 |
| Exclusive-fullscreen games | can't draw over them | Pixie hides; borderless-windowed games work | P6 |
| Admin (elevated) windows focused | push-to-talk can't hear keys | document it; optional "run as admin" | P4 |

## 13. Decisions (defaults — say the word to change any)

1. **Stack:** Electron + TypeScript.
2. **Runtime agents:**
   - Conductor in plain code
   - Command matcher
   - Explainer / Walkthrough / Verifier / Background on `claude-opus-5`
   - Router + Memory curator on `claude-haiku-4-5`; the Router is eval-gated, the curator opt-in
   - Operator + Guardian only in Phase 7

   `claude-sonnet-5` is a per-agent option.
3. **Build orchestration:** Phase 1 in one session; Phases 2+ as contract-first parallel lanes (max 3 per wave) in git worktrees, then the review swarm and verifier, then your acceptance check.
4. **Keys:** hold **Ctrl+Alt** to talk · **Ctrl+Alt+Space** to type · **Ctrl+Alt+P** show/hide · **Ctrl+Alt+N** next walkthrough step.
5. **Speech-to-text:** Deepgram streaming (alternative: local Whisper, free and private).
6. **Voice:** Windows voices (upgrade: ElevenLabs).
7. **Look:** glowing purple arrow (`#7c5cff`) riding just below-right of your cursor.
8. **Recordings:** Pixie is invisible to screen capture by default.

## 14. Folder layout (end state)

```
Pixie/
  PLAN.md                  this roadmap
  docs/plans/              one step-by-step plan per phase
  src/
    main/                  Electron main: windows, input, capture, claude client
      agents/              Conductor + agent team: explainer, router, walkthrough, verifier,
                           background, inbox, curator, operator, guardian
      prompts/             frozen system prompts, one per agent
      stt/                 speech-to-text providers
    preload/               typed bridge (contextBridge)
    renderer/              overlay canvas, command bar, settings UI
    shared/                pure, unit-tested logic: geometry, spring, flight, coords, tag parser, actions
  tests/                   Vitest unit tests (incl. Conductor tests with fake agents)
  evals/
    pointing/              screenshot + target-box cases and scorer (P3)
    routing/               labelled utterances for the Router (P4)
  build.mjs  package.json  tsconfig.json
```

## 15. Sources

- [farzaa/clicky](https://github.com/farzaa/clicky): original open-source Clicky (architecture, `[POINT]` tags, Worker proxy)
- [HeyClicky review (HokAI)](https://hokai.io/hub/tools/heyclicky): current product, Mac-only, Windows waitlist
- [HeyClicky review (The Rundown)](https://www.therundown.ai/tools/clicky)
- [Raynan00/clacky](https://github.com/Raynan00/clacky): community Windows clone (Python/PyQt6, Haiku intent router, Deepgram, Edge TTS)
