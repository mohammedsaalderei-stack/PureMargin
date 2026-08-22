import { memo, useEffect, useRef, useState } from "react";
import { Send, Loader2, ThumbsDown, CheckCircle2, ArrowUpRight, ArrowDownRight, Lightbulb } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";
import FeedbackDialog from "../FeedbackDialog.jsx";
import { useCountUp, prefersReducedMotion } from "../hooks.js";

function greeting(t) {
  const h = new Date().getHours();
  if (h < 12) return t.snapshot.morning;
  if (h < 17) return t.snapshot.afternoon;
  return t.snapshot.evening;
}

/* The first thing you see on opening the app: how today is going, before
   you've asked anything. Most owners open the app for exactly this. */
function Snapshot({ data, onAsk, noticedLine }) {
  const C = useC();
  const { t } = useLang();
  const today = data?.today;
  const sales = useCountUp(today?.sales || 0);
  if (!today) return null;

  const up = (today.delta ?? 0) >= 0;

  return (
    <div className="mb-8">
      <h2 className="display text-2xl md:text-3xl font-extrabold mb-1">
        {greeting(t)}
      </h2>
      <p className="text-sm mb-5" style={{ color: C.slate }}>{t.snapshot.lead}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl p-4 col-span-2 lg:col-span-1" style={{ background: C.irisWash }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold" style={{ color: C.irisDeep }}>
              {t.snapshot.salesToday}
            </span>
            <span
              className="data inline-flex items-center gap-0.5 text-[11px] font-medium"
              style={{ color: up ? C.iris : C.rose }}
              dir="ltr"
            >
              {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {Math.abs(today.delta ?? 0).toFixed(1)}%
            </span>
          </div>
          <div className="display text-2xl font-extrabold leading-none">
            <Money value={Math.round(sales)} />
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: C.slate }}>{t.snapshot.vsYesterday}</div>
        </div>

        <div className="panel p-4">
          <div className="text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{t.snapshot.receiptsToday}</div>
          <div className="display text-2xl font-extrabold leading-none" dir="ltr">{today.receipts}</div>
        </div>

        <div className="panel p-4">
          <div className="text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{t.snapshot.avgToday}</div>
          <div className="display text-2xl font-extrabold leading-none">
            <Money value={today.avgTicket} />
          </div>
        </div>

        <div className="panel p-4">
          <div className="text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{t.snapshot.topToday}</div>
          <div className="font-bold text-sm leading-tight truncate">{today.topItem}</div>
          <div className="text-[11px] mt-1" style={{ color: C.iris }}>
            <span dir="ltr">{today.topItemQty}</span> {t.snapshot.sold}
          </div>
        </div>
      </div>

      {noticedLine && (
        <div className="rounded-xl p-4 mb-5" style={{ background: C.panel }}>
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={14} style={{ color: C.lilac }} />
            <span className="display font-bold text-sm" style={{ color: C.panelText }}>
              {t.snapshot.noticed}
            </span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: C.panelMuted }}>{noticedLine}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {t.ask.suggested.slice(0, 3).map((s) => (
          <button
            key={s}
            onClick={() => onAsk(s)}
            className="text-xs font-medium px-3 py-2 rounded-full"
            style={{ border: `1px solid ${C.hairline}`, background: C.surface }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/* Memoised so a token arriving in the last bubble doesn't re-render every
   message above it. In a long thread that was the difference between one
   cheap update per frame and re-rendering the entire transcript. */
const Message = memo(function Message({ m, index, C, t, reported, onReport, prev }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] px-4 py-3 rounded-xl text-sm"
          style={{ background: C.iris, color: C.onPrimary }}
        >
          {m.content}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="data text-[11px] uppercase tracking-widest mb-2"
        style={{ color: m.failed ? C.rose : C.iris }}
      >
        {m.failed ? t.ask.failed : t.ask.label}
      </div>
      <div
        className="text-sm leading-relaxed whitespace-pre-wrap"
        style={{ color: m.failed ? C.rose : C.ink }}
      >
        {m.content}
        {m.streaming && (
          <span
            className="inline-block w-[2px] h-[1em] align-middle ms-0.5"
            style={{ background: C.iris, animation: "blink 1s steps(2) infinite" }}
          />
        )}
      </div>

      {!m.failed && !m.streaming && m.content && (
        <div className="mt-2.5">
          {reported ? (
            <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: C.iris }}>
              <CheckCircle2 size={13} /> {t.feedback.marked}
            </span>
          ) : (
            <button
              onClick={() => onReport({ index, answer: m.content, question: prev || "" })}
              className="inline-flex items-center gap-1.5 text-xs rounded-md px-2 py-1"
              style={{ color: C.slate, opacity: 0.65 }}
              aria-label={t.feedback.unhelpful}
            >
              <ThumbsDown size={13} /> {t.feedback.unhelpful}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default function Ask({
  token, wide, pending, onPendingUsed,
  messages, onMessagesChange, data, noticedLine,
}) {
  const C = useC();
  const { t, lang } = useLang();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(null);
  const [reported, setReported] = useState(() => new Set());
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const msgs = messages;
  const setMsgs = onMessagesChange;

  /* Smooth scrolling restarts its animation every time it's called. During
     streaming that happened on every token, so the animation never finished
     and the page appeared to stutter rather than scroll. While text is
     arriving we jump instantly instead; the smooth behaviour is kept for
     the moments it can actually complete.

     We also stop following if the reader has scrolled up — yanking someone
     back to the bottom while they're reading an earlier answer is worse
     than not following at all. */
  const scrollerRef = useRef(null);
  const followRef = useRef(true);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (!followRef.current) return;
    const streaming = msgs[msgs.length - 1]?.streaming;
    endRef.current?.scrollIntoView({
      behavior: streaming ? "auto" : "smooth",
      block: "end",
    });
  }, [msgs, busy]);

  async function send(preset) {
    const q = (preset ?? input).trim();
    if (!q || busy) return;
    setInput("");
    const next = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next, lang }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "The request failed.");
      }

      const type = res.headers.get("content-type") || "";

      if (type.includes("text/event-stream") && res.body) {
        /* The network doesn't deliver one token at a time.

           Anthropic sends several deltas per packet, and Vercel's proxy
           batches further, so text arrives in clumps of five or ten words.
           Painting exactly what has arrived reproduces that clumping on
           screen — which is what "a bunch of words at a time" is.

           So the display is decoupled from the network: received text goes
           into a buffer, and a frame loop reveals it at a steady rate. The
           rate scales with the backlog, so it never falls behind a fast
           answer, and it drains fully before the message is marked done. */
        let received = "";
        let shown = 0;
        let finished = false;
        let raf = null;

        const instant = prefersReducedMotion();

        /* Pacing — matched to the typewriter on the landing page.

           That one reveals two characters every eighteen milliseconds and
           never varies. A flat rate is the whole reason it reads as smooth:
           earlier versions here scaled with the backlog, and the variation
           was what looked choppy, even at a sensible average speed.

           So this is the same cadence, and it stays the same cadence whether
           the answer arrives in one packet or twenty.

           The trade-off, stated plainly: a very long answer takes as long to
           reveal as it takes to read. Two thousand characters is about
           eighteen seconds. RELIEF_ABOVE is the one concession — past that
           much backlog the step doubles, so an unusually long reply doesn't
           leave someone waiting on text that has already arrived. */
        const STEP_CHARS = 2;
        const STEP_MS = 18;
        const RELIEF_ABOVE = 1500;

        const drain = () =>
          new Promise((resolve) => {
            let timer = 0;

            const step = () => {
              if (shown < received.length) {
                const backlog = received.length - shown;
                const chars = instant
                  ? backlog
                  : backlog > RELIEF_ABOVE
                  ? STEP_CHARS * 2
                  : STEP_CHARS;

                shown = Math.min(received.length, shown + chars);
                setMsgs(
                  [...next, { role: "assistant", content: received.slice(0, shown), streaming: true }],
                  { streaming: true }
                );
              }

              if (finished && shown >= received.length) {
                timer = 0;
                resolve();
                return;
              }
              timer = setTimeout(step, STEP_MS);
            };

            timer = setTimeout(step, STEP_MS);
            raf = { cancel: () => clearTimeout(timer) };
          });

        setMsgs([...next, { role: "assistant", content: "", streaming: true }], { streaming: true });
        const drained = drain();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.text) {
                received += evt.text;
              } else if (evt.error) {
                throw new Error(evt.error);
              }
            } catch (e) {
              if (e instanceof Error && e.message && !/JSON/.test(e.message)) {
                finished = true;
                raf?.cancel?.();
                throw e;
              }
            }
          }
        }

        finished = true;
        await drained;

        // Fully revealed — persist it.
        setMsgs([...next, { role: "assistant", content: received }]);
        return;
      }

      const json = await res.json();
      setMsgs([...next, { role: "assistant", content: json.text }]);
    } catch (err) {
      setMsgs([...next, { role: "assistant", content: err.message, failed: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    if (!pending) return;
    send(pending);
    onPendingUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const empty = msgs.length === 0;
  const width = wide ? "max-w-3xl" : "max-w-2xl";

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className={`mx-auto px-5 md:px-8 py-6 ${width}`}>
          {empty && <Snapshot data={data} onAsk={send} noticedLine={noticedLine} />}

          <div className="space-y-5">
            {msgs.map((m, i) => (
              <div key={i} className="slide-in">
                <Message
                  m={m}
                  index={i}
                  C={C}
                  t={t}
                  prev={msgs[i - 1]?.content}
                  reported={reported.has(i)}
                  onReport={setReporting}
                />
              </div>
            ))}
          </div>

          {busy && !msgs[msgs.length - 1]?.streaming && (
            <div className="flex items-center gap-2 text-sm mt-5" style={{ color: C.slate }}>
              <Loader2 size={15} className="animate-spin" /> {t.ask.thinking}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.hairline}`, background: C.bone }}>
        <div className={`mx-auto px-5 md:px-8 py-4 ${width}`}>
          <div
            className="flex items-end gap-2 rounded-xl p-2"
            style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t.ask.placeholder}
              className="flex-1 bg-transparent outline-none text-sm px-2 py-2 resize-none max-h-32"
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              className="rounded-lg p-2.5 disabled:opacity-40"
              style={{ background: C.iris, color: C.onPrimary }}
              aria-label={t.ask.send}
            >
              <Send size={16} className="flip-rtl" />
            </button>
          </div>
          <span className="text-xs block mt-2" style={{ color: C.slate }}>{t.ask.hint}</span>
        </div>
      </div>

      <FeedbackDialog
        open={Boolean(reporting)}
        onClose={() => setReporting(null)}
        onSent={() => setReported((prev) => new Set(prev).add(reporting.index))}
        token={token}
        question={reporting?.question || ""}
        answer={reporting?.answer || ""}
      />
    </div>
  );
}
