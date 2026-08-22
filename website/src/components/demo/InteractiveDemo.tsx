"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Sparkles,
  Send,
  Shield,
  Zap,
  Wrench,
  ListChecks,
  ChevronRight,
  ChevronLeft,
  Play,
  Pause,
  Check,
  AlertTriangle,
  ShieldCheck,
  RotateCcw,
  FileDiff,
  Loader2,
  CheckCircle2,
  Terminal,
  GitPullRequest,
  ClipboardCheck,
  Boxes,
  Smartphone,
  MessageSquarePlus,
  Trash2,
  Mic,
} from "lucide-react";

/**
 * A guided replica of the actual Orbitae workspace UI — not an abstraction of
 * it. Every class string here mirrors `TerminalTab.tsx` / `PlanReviewPanel.tsx`
 * / `DiffReview.tsx` / `ResultCard.tsx` in the real app, scoped to the app's
 * real dark theme tokens (see `APP_THEME_VARS`), so what a visitor sees here is
 * what the product actually looks like — just played out on canned prompts.
 * Fully scripted; no backend.
 */

// The app's real `.dark` CSS custom properties (src/index.css), scoped to this
// component only via inline style so the rest of the marketing site is unaffected.
const APP_THEME_VARS: CSSProperties = {
  ["--background" as string]: "20 10% 7%",
  ["--foreground" as string]: "30 10% 90%",
  ["--card" as string]: "20 8% 10%",
  ["--card-foreground" as string]: "30 10% 90%",
  ["--muted" as string]: "20 6% 13%",
  ["--muted-foreground" as string]: "20 5% 55%",
  ["--border" as string]: "20 6% 17%",
};

const MODEL_COLORS: Record<string, string> = {
  haiku: "bg-sky-500/15 text-sky-400",
  sonnet: "bg-violet-500/15 text-violet-400",
  opus: "bg-amber-500/15 text-amber-400",
};

const SCENES = ["Chat", "Plan", "Execute", "Review", "Receipt"] as const;

// ── Scripted content ─────────────────────────────────────────────────────────

/** The chat scene plays through these turns in order — two plain Q&A turns
 *  first (proving the chat is a real, memory-carrying conversation, not just a
 *  planner) before a build request the agent decides, on its own, to plan. */
const CHAT_TURNS = [
  {
    user: "what does /health currently do?",
    assistant:
      'It\'s a bare liveness check — `GET /health` returns `{"status": "ok"}`. No DB or Redis check yet.',
  },
  {
    user: "is that endpoint used anywhere in CI?",
    assistant:
      "Yes — the deploy workflow polls it before flipping traffic, so today it only confirms the process is up.",
    // Captured via the mic instead of typed — shows off local voice dictation
    // (roadmap: an on-device Whisper model, installed on demand from Settings).
    voice: true,
  },
  {
    user: "add a /health/ready endpoint that checks DB and Redis",
    assistant:
      "Right now /health is a bare liveness check. I'll add real readiness — verifying DB + Redis connectivity — and surface it on the health page.",
    plan: true,
  },
];
// 4 stages per turn: 0 typing, 1 user bubble shown, 2 assistant thinking,
// 3 assistant reply shown. Stage TOTAL_TURN_STAGES = tool-call chip; +1 = plan
// card. A stage past a turn's own range is simply "fully resolved" — no special
// casing needed for jump-to-end navigation.
const TOTAL_TURN_STAGES = CHAT_TURNS.length * 4;

type TurnPhase = "hidden" | "typing" | "user-only" | "thinking" | "replied";
function turnPhase(i: number, stage: number): TurnPhase {
  const start = i * 4;
  if (stage < start) return "hidden";
  const local = stage - start;
  if (local === 0) return "typing";
  if (local === 1) return "user-only";
  if (local === 2) return "thinking";
  return "replied";
}

const PLAN_STEPS = [
  {
    id: "s1",
    title: "Add readiness route",
    model: "sonnet",
    detail:
      "Add `GET /health/ready` that pings the DB and Redis and returns 200/503 accordingly.",
    files: ["backend/app/api/routes/ops.py"],
  },
  {
    id: "s2",
    title: "Show status on the health page",
    model: "haiku",
    detail:
      "Fetch `/health/ready` on mount and render a colored status badge next to the existing liveness check.",
    files: ["frontend/app/health/page.tsx"],
  },
];

const EXEC_LOG = [
  "▸ executing (model: sonnet)",
  "[1·sonnet] ▸ Read  ops.py",
  "[2·haiku] ▸ executing (model: haiku)",
  "[1·sonnet] ▸ Edit  ops.py",
  "[2·haiku] ▸ Read  page.tsx",
  "[1·sonnet] ▸ Bash  cargo check",
  "[2·haiku] ▸ Edit  page.tsx",
  "[1·sonnet] ━━ done · 4.1s · $0.0091",
  "[2·haiku] ━━ done · 2.6s · $0.0011",
];

const CHANGED_FILES = [
  { status: "M", path: "backend/app/api/routes/ops.py", adds: 14, dels: 1 },
  { status: "M", path: "frontend/app/health/page.tsx", adds: 9, dels: 2 },
];

const CHECKS = [
  { name: "build", passed: true },
  { name: "typecheck", passed: true },
  { name: "tests", passed: true, note: "12 passed" },
];

const DIFF_ROWS: {
  kind: "hunk" | "context" | "add" | "del";
  text: string;
  line: number | null;
}[] = [
  { kind: "hunk", text: "@@ -12,6 +12,20 @@ router = APIRouter()", line: null },
  { kind: "context", text: '@router.get("/health")', line: 12 },
  { kind: "context", text: "async def health():", line: 13 },
  { kind: "context", text: '    return {"status": "ok"}', line: 14 },
  { kind: "add", text: "", line: 15 },
  { kind: "add", text: '@router.get("/health/ready")', line: 16 },
  { kind: "add", text: "async def readiness():", line: 17 },
  { kind: "add", text: '    await db.execute("SELECT 1")', line: 18 },
  { kind: "add", text: "    await redis.ping()", line: 19 },
  { kind: "add", text: '    return {"status": "ready"}', line: 20 },
];

const FINDING = {
  severity: "warning" as const,
  title: "Readiness check has no timeout",
  detail:
    "A hung DB connection would hang the probe indefinitely. Wrap both calls in a short timeout.",
  anchorLine: 18,
};

// A human annotation — Google-Docs-style highlight-to-comment on the diff,
// distinct from the agent's own finding above. Pinned to a different line so
// the two visually contrast: amber = what the gate found, sky = what you said.
const ANNOTATION = {
  line: 19,
  comment: "Can we log the latency here for the dashboards?",
};

const ROADMAP = [
  {
    icon: Boxes,
    title: "Multi-provider routing",
    desc: "Route each step to the right engine — Claude, Codex, Gemini, or a local model — so cheap work runs cheap and hard reasoning goes frontier.",
  },
  {
    icon: Smartphone,
    title: "One-click remote sandbox",
    desc: "Sandbox and host your project as a secure remote environment. Scan a QR code and steer your agents from your phone — no heavy laptop.",
  },
];

// ── Small shared bits (mirroring the app 1:1) ────────────────────────────────

const ModelPill: React.FC<{ model: string }> = ({ model }) => (
  <span
    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${MODEL_COLORS[model] ?? "bg-muted/50 text-muted-foreground"}`}
  >
    {model}
  </span>
);

const StatusDot: React.FC<{ approved: boolean }> = ({ approved }) => (
  <span
    className={`w-2 h-2 rounded-full shrink-0 ${approved ? "bg-emerald-400" : "bg-muted-foreground/30"}`}
  />
);

// ── Typewriter hook ──────────────────────────────────────────────────────────

/** Reveals `text` one character at a time while `active`; instant when not. */
function useTypewriter(text: string, active: boolean, speedMs = 22): string {
  const [n, setN] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = setInterval(() => {
      setN((v) => (v >= text.length ? v : v + 1));
    }, speedMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, active]);
  return text.slice(0, n);
}

// ── Scene 1 — Chat (replica of TerminalTab's thread + composer) ─────────────

type VoicePhase = "listening" | "transcribing" | "done";

const ChatScene: React.FC<{
  stage: number;
  setMaxStage: (n: number) => void;
}> = ({ stage, setMaxStage }) => {
  const currentTurn = Math.min(Math.floor(stage / 4), CHAT_TURNS.length - 1);
  const isTyping = stage < TOTAL_TURN_STAGES && stage % 4 === 0;
  const isVoiceTurn = isTyping && !!CHAT_TURNS[currentTurn].voice;
  const typed = useTypewriter(
    isTyping && !isVoiceTurn ? CHAT_TURNS[currentTurn].user : "",
    isTyping && !isVoiceTurn,
  );

  // Typed turns advance once the typewriter finishes (not a fixed timer).
  useEffect(() => {
    if (!isTyping || isVoiceTurn || typed.length < CHAT_TURNS[currentTurn].user.length) return;
    const t = setTimeout(() => setMaxStage(stage + 1), 350);
    return () => clearTimeout(t);
  }, [isTyping, isVoiceTurn, typed, currentTurn, stage, setMaxStage]);

  // Voice-captured turns act out listening → transcribing → done on a fixed
  // timeline, then advance the same way a finished typewriter would.
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("listening");
  useEffect(() => {
    if (!isVoiceTurn) {
      const reset = setTimeout(() => setVoicePhase("listening"), 0);
      return () => clearTimeout(reset);
    }
    const t0 = setTimeout(() => setVoicePhase("listening"), 0);
    const t1 = setTimeout(() => setVoicePhase("transcribing"), 900);
    const t2 = setTimeout(() => setVoicePhase("done"), 1500);
    const t3 = setTimeout(() => setMaxStage(stage + 1), 1900);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isVoiceTurn, stage, setMaxStage]);

  // Every other beat (user-shown → thinking → replied → next turn's typing,
  // or the final reply → tool chip → plan card) advances on a fixed timer.
  useEffect(() => {
    if (isTyping || stage > TOTAL_TURN_STAGES) return;
    const local = stage % 4;
    const delay =
      stage === TOTAL_TURN_STAGES
        ? 700 // chip → plan card
        : local === 1
          ? 500 // user shown → thinking
          : local === 2
            ? 900 // thinking → reply shown
            : 800; // reply shown → next turn / chip
    const t = setTimeout(() => setMaxStage(stage + 1), delay);
    return () => clearTimeout(t);
  }, [isTyping, stage, setMaxStage]);

  return (
    <div className="max-w-2xl mx-auto p-5 space-y-3 min-h-[280px]">
      {CHAT_TURNS.map((turn, i) => {
        const phase = turnPhase(i, stage);
        if (phase === "hidden" || phase === "typing") return null;
        return (
          <React.Fragment key={i}>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-foreground text-background px-3.5 py-2 text-[13px] whitespace-pre-wrap">
                {turn.voice && (
                  <Mic className="w-3 h-3 inline-block mr-1.5 mb-0.5 opacity-60" />
                )}
                {turn.user}
              </div>
            </div>
            {phase !== "user-only" && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl bg-muted/40 px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground/85">
                  {phase === "thinking" ? (
                    <span className="text-muted-foreground/50 animate-pulse">
                      Thinking…
                    </span>
                  ) : (
                    turn.assistant
                  )}
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
      {stage >= TOTAL_TURN_STAGES && (
        <div className="flex justify-center pt-1">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-medium text-violet-400"
          >
            <Wrench className="w-3 h-3" /> called{" "}
            <span className="font-mono">create_plan</span>
          </motion.div>
        </div>
      )}
      {stage >= TOTAL_TURN_STAGES + 1 && (
        <motion.button
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="w-full text-left flex items-center gap-3 rounded-xl border border-foreground/30 bg-foreground/[0.03] px-4 py-2.5"
        >
          <ListChecks className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-foreground truncate">
              Add a /health/ready endpoint that checks DB and Redis
            </div>
            <div className="text-[10px] text-muted-foreground/50">
              reviewing
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
        </motion.button>
      )}
      {/* The composer — always visible; shows the live typewriter while a
                turn is being "typed", a listening/transcribing sequence for the
                voice turn, idle placeholder otherwise. */}
      <div className="pt-2">
        <div className="relative flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
          <Sparkles className="w-4 h-4 text-amber-400/70 shrink-0" />
          <span className="flex-1 text-[13px] text-foreground/90">
            {isVoiceTurn ? (
              voicePhase === "listening" ? (
                <span className="inline-flex items-center gap-2 text-sky-400">
                  <Mic className="w-3.5 h-3.5 animate-pulse" /> Listening…
                  <span className="inline-flex items-end gap-0.5 h-3">
                    {[0, 1, 2, 3, 4].map((b) => (
                      <span
                        key={b}
                        className="w-0.5 bg-sky-400/70 rounded-full animate-pulse"
                        style={{ height: `${4 + (b % 3) * 3}px`, animationDelay: `${b * 0.12}s` }}
                      />
                    ))}
                  </span>
                </span>
              ) : voicePhase === "transcribing" ? (
                <span className="text-muted-foreground/60 animate-pulse">Transcribing locally…</span>
              ) : (
                CHAT_TURNS[currentTurn].user
              )
            ) : (
              <>
                {isTyping && typed.length === 0 && (
                  <span className="text-muted-foreground/40">
                    Ask anything — git status, debug, boot dev, or a full task...
                  </span>
                )}
                {isTyping ? typed : ""}
                {isTyping && (
                  <span className="inline-block w-[1px] h-3.5 bg-foreground/60 align-middle animate-pulse ml-0.5" />
                )}
              </>
            )}
          </span>
          <span
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
              isVoiceTurn && voicePhase === "listening"
                ? "text-sky-400 bg-sky-500/10"
                : "text-muted-foreground/50"
            }`}
          >
            <Mic className="w-3 h-3" />
          </span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-muted-foreground/50">
            <Zap className="w-3 h-3" /> Lean
          </span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-muted-foreground/50">
            <Shield className="w-3 h-3" /> Safe
          </span>
          <Send className="w-4 h-4 text-muted-foreground/40" />
        </div>
        <p className="text-center text-[11px] text-muted-foreground/50 pt-2">
          {isVoiceTurn
            ? voicePhase === "listening"
              ? "Voice input — talk to it, no need to type."
              : voicePhase === "transcribing"
                ? "Running local speech-to-text…"
                : "Transcribed fully on-device — no audio ever leaves your machine."
            : "A real conversation first — the agent decides on its own when to plan, no button, no keyword matching."}
        </p>
      </div>
    </div>
  );
};

// ── Scene 2 — Plan (replica of PlanReviewPanel) ──────────────────────────────

const PlanScene: React.FC<{
  stage: number;
  setMaxStage: (n: number) => void;
}> = ({ stage, setMaxStage }) => {
  useEffect(() => {
    if (stage >= PLAN_STEPS.length) return;
    const t = setTimeout(() => setMaxStage(stage + 1), 750);
    return () => clearTimeout(t);
  }, [stage, setMaxStage]);

  const approvedCount = Math.min(stage, PLAN_STEPS.length);
  const allApproved = approvedCount === PLAN_STEPS.length;

  return (
    <div className="max-w-2xl mx-auto flex flex-col min-h-[340px]">
      <div className="px-1 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-medium capitalize">
            reviewing
          </span>
          <span className="text-[10px] text-muted-foreground/60">plan v1</span>
        </div>
        <h2 className="text-[15px] font-semibold text-foreground leading-snug">
          Add a /health/ready endpoint that checks DB and Redis
        </h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          add a /health/ready endpoint that checks DB and Redis
        </p>
      </div>

      <div className="flex-1 space-y-2.5">
        {PLAN_STEPS.map((step, i) => {
          const approved = i < approvedCount;
          return (
            <div
              key={step.id}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
                <StatusDot approved={approved} />
                <span className="text-[11px] text-muted-foreground/50 font-mono">
                  {i + 1}
                </span>
                <span className="text-[13px] font-medium text-foreground flex-1 min-w-0 truncate">
                  {step.title}
                </span>
                <ModelPill model={step.model} />
              </div>
              <div className="px-4 py-3 space-y-2.5">
                <p className="text-[13px] leading-relaxed text-foreground/85">
                  {step.detail}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {step.files.map((f) => (
                    <span
                      key={f}
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted/40 text-foreground/60"
                    >
                      {f}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground/70">
                    <ChevronRight className="w-3 h-3 rotate-180 opacity-0" />{" "}
                    Edit
                  </span>
                  {approved ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 px-2 py-1">
                      <Check className="w-3 h-3" /> Approved
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-emerald-400">
                      <Check className="w-3 h-3" /> Approve
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-3 flex items-center gap-2 border-t border-border/60 mt-3">
        <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] text-muted-foreground/70 bg-foreground/10">
          <Check className="w-3.5 h-3.5" /> Approve all
        </span>
        <div className="flex-1" />
        <span
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium transition-colors ${
            allApproved
              ? "bg-emerald-500 text-white"
              : "bg-emerald-500/30 text-white/60"
          }`}
        >
          {allApproved ? (
            <>
              <Play className="w-3.5 h-3.5" /> Confirm & Execute
            </>
          ) : (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Confirm & Execute
            </>
          )}
        </span>
      </div>
    </div>
  );
};

// ── Scene 3 — Execute (replica of the live exec log) ─────────────────────────

const ExecuteScene: React.FC<{
  stage: number;
  setMaxStage: (n: number) => void;
}> = ({ stage, setMaxStage }) => {
  useEffect(() => {
    if (stage >= EXEC_LOG.length) return;
    const t = setTimeout(() => setMaxStage(stage + 1), 380);
    return () => clearTimeout(t);
  }, [stage, setMaxStage]);

  const lines = EXEC_LOG.slice(0, stage);
  const done = stage >= EXEC_LOG.length;

  return (
    <div className="max-w-2xl mx-auto p-5 space-y-3 min-h-[300px]">
      <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] overflow-hidden">
        <div className="w-full flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
          {done ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
          )}
          <Terminal className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[12px] font-medium text-zinc-200 flex-1">
            {done
              ? `Execution log · ${EXEC_LOG.length} lines`
              : "Executing plan…"}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300">
            2 steps in parallel
          </span>
        </div>
        <div className="px-4 py-3 max-h-64 overflow-y-auto">
          <pre className="text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words min-h-[1.4em]">
            {lines.join("\n")}
            {!done && (
              <span className="inline-block w-1.5 h-3 bg-zinc-500 ml-0.5 animate-pulse" />
            )}
          </pre>
        </div>
      </div>
      {done && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] overflow-hidden"
        >
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-[13px] font-semibold text-foreground flex-1 min-w-0 truncate">
              Add a /health/ready endpoint that checks DB and Redis
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-emerald-500/15 text-emerald-400">
              Done
            </span>
          </div>
          <div className="px-4 py-3 space-y-2">
            <div className="space-y-0.5">
              {CHANGED_FILES.map((f) => (
                <div
                  key={f.path}
                  className="flex items-center gap-2 text-[12px] font-mono"
                >
                  <span className="w-3 text-center font-semibold shrink-0 text-amber-400">
                    {f.status}
                  </span>
                  <span className="text-foreground/85 flex-1 min-w-0 truncate">
                    {f.path}
                  </span>
                  <span className="text-[10px] shrink-0">
                    <span className="text-emerald-400/70">+{f.adds}</span>{" "}
                    <span className="text-red-400/70">−{f.dels}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70 pt-2 border-t border-border/30">
              <span>2 steps</span>
              <span>
                <span className="text-emerald-400/70">+23</span>{" "}
                <span className="text-red-400/70">−3</span>
              </span>
              <span>6s</span>
              <span>$0.0102</span>
            </div>
          </div>
        </motion.div>
      )}
      <p className="text-center text-[11px] text-muted-foreground/50">
        Each step ran in its own git worktree — agents can&apos;t clobber each
        other — then merged back, single-committer.
      </p>
    </div>
  );
};

// ── Scene 4 — Review (replica of DiffReview) ─────────────────────────────────

const ROW_STYLES: Record<string, string> = {
  add: "bg-emerald-500/10 text-emerald-300",
  del: "bg-red-500/10 text-red-300/90",
  context: "text-foreground/60",
  hunk: "bg-sky-500/5 text-sky-400/70 select-none",
};

const ReviewScene: React.FC<{
  stage: number;
  setMaxStage: (n: number) => void;
}> = ({ stage, setMaxStage }) => {
  // Stages 0-3 build up checks/findings/diff at a fixed pace. Stages 4-6 act
  // out the annotation: highlight → floating "Comment" bubble → composer
  // (typed) → pinned. The composing stage (5) waits for the typewriter to
  // finish rather than a fixed delay.
  const composingText = useTypewriter(ANNOTATION.comment, stage === 5);
  useEffect(() => {
    if (stage >= 3) return;
    const t = setTimeout(() => setMaxStage(stage + 1), 550);
    return () => clearTimeout(t);
  }, [stage, setMaxStage]);
  useEffect(() => {
    if (stage !== 3) return;
    const t = setTimeout(() => setMaxStage(4), 900); // pause on the diff, then select
    return () => clearTimeout(t);
  }, [stage, setMaxStage]);
  useEffect(() => {
    if (stage !== 4) return;
    const t = setTimeout(() => setMaxStage(5), 750); // bubble → open composer
    return () => clearTimeout(t);
  }, [stage, setMaxStage]);
  useEffect(() => {
    if (stage !== 5 || composingText.length < ANNOTATION.comment.length) return;
    const t = setTimeout(() => setMaxStage(6), 500); // comment typed → submit
    return () => clearTimeout(t);
  }, [stage, composingText, setMaxStage]);

  return (
    <div className="max-w-2xl mx-auto p-5 min-h-[340px] space-y-3">
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-medium text-violet-400">
          <Wrench className="w-3 h-3" /> called{" "}
          <span className="font-mono">adversarial_review</span>
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground/50">
        A fresh agent — not the one that wrote the diff — inspects it against
        the intent and tries to find faults.
      </p>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[12px] font-semibold text-foreground">
            Review
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            Low risk — evidence is clean
          </span>
          <div className="flex-1" />
          <RotateCcw className="w-3.5 h-3.5 text-muted-foreground/40" />
        </div>

        <div className="px-4 py-3 space-y-3">
          {stage >= 1 && (
            <div className="space-y-1">
              {CHECKS.map((c) => (
                <div
                  key={c.name}
                  className="flex items-start gap-2 text-[12px]"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  <span className="font-medium text-foreground/90 w-20 shrink-0">
                    {c.name}
                  </span>
                  <span className="text-emerald-400/70">
                    {c.note ?? "passed"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {stage >= 2 && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">
                <span className="text-amber-400">1 warning</span> to review
              </div>
              <div className="flex items-start gap-1.5 text-left w-full">
                <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                <span className="text-[11px] text-foreground/80 flex-1 min-w-0">
                  {FINDING.title}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">
                  ops.py
                </span>
              </div>
            </div>
          )}

          {stage >= 3 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-lg border border-border/60 overflow-hidden"
            >
              <div className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border/50">
                <FileDiff className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                <span className="text-[11px] font-mono text-foreground/80 truncate flex-1">
                  backend/app/api/routes/ops.py
                </span>
                <span className="text-[10px] text-muted-foreground/70 shrink-0">
                  1 finding
                </span>
                <span className="text-[10px] font-mono shrink-0">
                  <span className="text-emerald-400/70">+14</span>{" "}
                  <span className="text-red-400/70">−1</span>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
                  <tbody>
                    {DIFF_ROWS.map((row, i) => {
                      const isAnnotated = row.line === ANNOTATION.line;
                      const selected = isAnnotated && stage >= 4 && stage < 6;
                      return (
                        <React.Fragment key={i}>
                          <tr
                            className={
                              selected
                                ? "bg-sky-500/20 text-foreground"
                                : ROW_STYLES[row.kind]
                            }
                          >
                            <td className="w-10 text-right pr-2 select-none text-muted-foreground/30 align-top tabular-nums">
                              {row.line ?? ""}
                            </td>
                            <td className="pr-3 whitespace-pre-wrap break-all align-top">
                              <span className="select-none text-muted-foreground/40">
                                {row.kind === "add"
                                  ? "+"
                                  : row.kind === "del"
                                    ? "-"
                                    : row.kind === "hunk"
                                      ? ""
                                      : " "}
                              </span>
                              {row.text}
                            </td>
                          </tr>
                          {row.line === FINDING.anchorLine && (
                            <tr>
                              <td colSpan={2} className="p-0">
                                <div className="px-2 py-1.5 bg-card border-y border-border/40">
                                  <div className="rounded-md border p-2.5 border-amber-500/20 bg-amber-500/5">
                                    <div className="flex items-start gap-1.5">
                                      <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                                      <span className="text-[9px] px-1 py-0.5 rounded uppercase font-semibold shrink-0 bg-amber-500/15 text-amber-400">
                                        warning
                                      </span>
                                      <span className="text-[11px] text-foreground/85 flex-1">
                                        {FINDING.detail}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          {isAnnotated && stage >= 4 && (
                            <tr>
                              <td colSpan={2} className="p-0">
                                <div className="px-2 py-2 bg-card border-y border-border/40 flex justify-center">
                                  {stage === 4 ? (
                                    <motion.span
                                      initial={{ opacity: 0, y: -4 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-sky-500 text-white text-[11px] font-medium shadow-lg"
                                    >
                                      <MessageSquarePlus className="w-3 h-3" />{" "}
                                      Comment
                                    </motion.span>
                                  ) : stage === 5 ? (
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.96 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      className="rounded-lg border border-sky-500/40 bg-card shadow-xl p-2.5 space-y-1.5 w-[280px]"
                                    >
                                      <div className="text-[10px] text-muted-foreground/70 border-l-2 border-sky-500/40 pl-2 italic line-clamp-2">
                                        &ldquo;{row.text.trim()}&rdquo;
                                      </div>
                                      <div className="w-full bg-background/60 rounded px-2 py-1.5 text-[12px] border border-border min-h-[2.2em]">
                                        {composingText}
                                        <span className="inline-block w-[1px] h-3 bg-foreground/60 align-middle animate-pulse ml-0.5" />
                                      </div>
                                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-sky-500 text-white">
                                        <Send className="w-3 h-3" /> Comment
                                      </span>
                                    </motion.div>
                                  ) : (
                                    <motion.div
                                      initial={{ opacity: 0, y: 4 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      className="rounded-md border border-sky-500/25 bg-sky-500/5 p-2.5 font-sans w-full"
                                    >
                                      <div className="flex items-start gap-1.5">
                                        <MessageSquarePlus className="w-3 h-3 text-sky-400 mt-0.5 shrink-0" />
                                        <span className="text-[11px] text-foreground/85 flex-1 min-w-0">
                                          {ANNOTATION.comment}
                                        </span>
                                        <Trash2 className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                                      </div>
                                    </motion.div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground/50 pt-3">
        {stage >= 4
          ? "Highlight any line to comment — Google-Docs-style, pinned right where you're looking."
          : "Findings are pinned to the exact diff line — not a floating list you have to reconcile."}
      </p>
    </div>
  );
};

// ── Scene 5 — Receipt (replica of the evidence receipt + PR card) ───────────

const ReceiptScene: React.FC<{
  stage: number;
  setMaxStage: (n: number) => void;
}> = ({ stage, setMaxStage }) => {
  useEffect(() => {
    if (stage >= 1) return;
    const t = setTimeout(() => setMaxStage(1), 700);
    return () => clearTimeout(t);
  }, [stage, setMaxStage]);

  return (
    <div className="max-w-2xl mx-auto p-5 space-y-3 min-h-[300px]">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[12px] font-semibold text-foreground">
            Evidence receipt
          </span>
        </div>
        <div className="divide-y divide-border/40">
          {[
            ["Intent", "Add /health/ready checking DB + Redis"],
            ["Boundary", "ops.py · health/page.tsx (2 files)"],
            ["Checks", "build ✓ · type ✓ · tests ✓ 12 passed"],
            ["Findings", "1 warning (no timeout)"],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex items-start gap-3 px-4 py-2 text-[12px]"
            >
              <span className="w-20 shrink-0 text-muted-foreground">{k}</span>
              <span className="text-foreground/85">{v}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-20 shrink-0 text-muted-foreground text-[12px]">
              Verdict
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              Low risk — evidence is clean
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[13px] font-medium text-muted-foreground/80">
          <ClipboardCheck className="w-4 h-4" /> Copy receipt
        </span>
      </div>

      {stage >= 1 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2"
        >
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <GitPullRequest className="w-4 h-4 text-emerald-400" /> Opened pull
            request
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            branch: orbitae/add-health-ready
          </div>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-sky-400">
            View pull request
          </span>
        </motion.div>
      )}
      <p className="text-center text-[11px] text-muted-foreground/50 pt-1">
        Reproducible evidence you can inspect — not a proof of correctness.
        Orbitae never merges; you&apos;re the gate.
      </p>
    </div>
  );
};

const SCENE_MAX_STAGE = [
  TOTAL_TURN_STAGES + 1,
  PLAN_STEPS.length,
  EXEC_LOG.length,
  6,
  1,
];

// ── Roadmap teasers (clearly not-yet-shipped) ────────────────────────────────

const RoadmapStrip = () => (
  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
    {ROADMAP.map((r) => (
      <div
        key={r.title}
        className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 opacity-70"
      >
        <div className="flex items-center gap-2 mb-2">
          <r.icon className="w-4 h-4 text-neutral-400" />
          <span className="text-[13px] font-semibold text-white">
            {r.title}
          </span>
          <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-white/15 text-neutral-400">
            Coming soon
          </span>
        </div>
        <p className="text-[12px] text-neutral-500 leading-relaxed">{r.desc}</p>
      </div>
    ))}
  </div>
);

// ── Shell ────────────────────────────────────────────────────────────────────

const SCENE_BODY: Record<
  number,
  React.ComponentType<{ stage: number; setMaxStage: (n: number) => void }>
> = {
  0: ChatScene,
  1: PlanScene,
  2: ExecuteScene,
  3: ReviewScene,
  4: ReceiptScene,
};

export const InteractiveDemo = () => {
  const [scene, setScene] = useState(0);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const advancingRef = useRef(false);

  const atEnd = scene >= SCENES.length - 1 && stage >= SCENE_MAX_STAGE[scene];

  const goto = useCallback((i: number, fullyRevealed: boolean) => {
    setPlaying(false);
    setScene(i);
    setStage(fullyRevealed ? SCENE_MAX_STAGE[i] : 0);
  }, []);

  const next = useCallback(() => {
    setScene((s) => Math.min(s + 1, SCENES.length - 1));
    setStage(0);
  }, []);

  // Auto-play: once a scene finishes building up, wait a beat then advance.
  useEffect(() => {
    if (!playing || advancingRef.current) return;
    if (stage < SCENE_MAX_STAGE[scene]) return;
    const atLastScene = scene >= SCENES.length - 1;
    advancingRef.current = true;
    const t = setTimeout(
      () => {
        advancingRef.current = false;
        if (atLastScene) {
          setPlaying(false);
          return;
        }
        setScene((s) => s + 1);
        setStage(0);
      },
      atLastScene ? 0 : 1400,
    );
    return () => {
      clearTimeout(t);
      advancingRef.current = false;
    };
  }, [playing, scene, stage]);

  const Body = SCENE_BODY[scene];

  return (
    <div style={APP_THEME_VARS}>
      <div className="w-full bg-background border border-border rounded-xl overflow-hidden shadow-2xl flex flex-col">
        {/* Window chrome — matches the app's persistent header */}
        <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5 mr-1">
              <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
            </div>
            <div className="text-sm font-medium flex items-center gap-2 text-foreground/80">
              <Bot className="w-3.5 h-3.5 text-muted-foreground/60" />
              Orbitae
            </div>
          </div>
          <div className="text-xs text-muted-foreground hidden sm:block">
            Interactive Demo
          </div>
        </div>

        {/* Scene stepper */}
        <div className="px-4 py-2.5 border-b border-border/40 bg-muted/10 flex items-center gap-1.5 overflow-x-auto">
          {SCENES.map((label, i) => (
            <button
              key={label}
              onClick={() => goto(i, true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                i === scene
                  ? "bg-violet-500/15 text-violet-400"
                  : i < scene
                    ? "text-emerald-400/80"
                    : "text-muted-foreground/50 hover:text-foreground/70"
              }`}
            >
              {i < scene ? (
                <Check className="w-3 h-3" />
              ) : (
                <span className="opacity-60">{i + 1}</span>
              )}
              {label}
            </button>
          ))}
        </div>

        {/* Scene body */}
        <div className="bg-background">
          <AnimatePresence mode="wait">
            <motion.div
              key={scene}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <Body stage={stage} setMaxStage={setStage} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Controls */}
        <div className="px-4 py-3 border-t border-border bg-muted/10 flex items-center justify-between shrink-0">
          <button
            onClick={() => goto(Math.max(scene - 1, 0), true)}
            disabled={scene === 0}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <button
            onClick={() => {
              if (atEnd) {
                setScene(0);
                setStage(0);
                setPlaying(true);
              } else setPlaying((p) => !p);
            }}
            className="inline-flex items-center gap-1.5 text-[12px] text-foreground/80 hover:text-foreground transition-colors"
          >
            {atEnd ? (
              <>
                <Play className="w-3.5 h-3.5" /> Replay
              </>
            ) : playing ? (
              <>
                <Pause className="w-3.5 h-3.5" /> Pause
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" /> Auto-play
              </>
            )}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              next();
            }}
            disabled={scene >= SCENES.length - 1}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <RoadmapStrip />
    </div>
  );
};
