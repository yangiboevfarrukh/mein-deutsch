/* ===========================================================================
   ИНТЕРФЕЙС ПРИЛОЖЕНИЯ. Словарь и грамматика лежат в data.js.
   Файл компилируется прямо в браузере (Babel), сборка не нужна:
   сохранили — обновили страницу.
   =========================================================================== */
const { useState, useEffect, useRef } = React;

/* ============================ ТОКЕНЫ ОФОРМЛЕНИЯ ============================ */
const T = {
  paper: "#E8E9E3",
  card: "#FDFDFB",
  ink: "#191E1B",
  muted: "#6B7268",
  petrol: "#14504A",
  petrolSoft: "#DCE7E3",
  mustard: "#B4820F",
  mustardSoft: "#F2E7C8",
  rose: "#A6403A",
  roseSoft: "#F3DEDC",
  rule: "#CFD1C8",
};
const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif";
const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

/* ================================ СЛОВАРЬ ================================= */
const DECKS = window.DECKS;
const GRAMMAR = window.GRAMMAR;
const LEVELS = window.LEVELS;


/* =============================== ХРАНИЛИЩЕ ===============================
   Прогресс и настройки хранятся в localStorage браузера, на вашем устройстве.
   Ничего никуда не отправляется. Очистка данных сайта стирает прогресс.
   ========================================================================= */
async function loadState(key, def) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : def;
  } catch (e) { return def; }
}
async function saveState(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

/* ============================== ВЫЗОВ МОДЕЛИ ==============================
   Разговор с ИИ и генерация домашних заданий работают через Anthropic API
   с вашим личным ключом. Ключ хранится только в этом браузере.
   ========================================================================= */
const AI = { key: "", model: "claude-sonnet-4-6" };
function applyAi(cfg) { Object.assign(AI, cfg || {}); }

async function askClaude(messages, system) {
  if (!AI.key) throw new Error("Не задан ключ Anthropic API");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AI.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: AI.model, max_tokens: 1000, system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Ошибка API");
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

function parseJson(text) {
  const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const start = clean.search(/[[{]/);
  return JSON.parse(start > 0 ? clean.slice(start) : clean);
}

/* ================================ РЕЧЬ ================================= */
const SYNTH = typeof window !== "undefined" ? window.speechSynthesis : null;
const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
let VOICES = [];
function refreshVoices() {
  try { VOICES = SYNTH ? SYNTH.getVoices() : []; } catch (e) { VOICES = []; }
}
refreshVoices();
if (SYNTH) { try { SYNTH.onvoiceschanged = refreshVoices; } catch (e) {} }

/* --- конфигурация голоса: системный синтез или нейросетевой TTS --- */
const TTS = {
  provider: "system",      // system | elevenlabs | google
  key: "",
  deVoiceURI: "",          // выбранный системный немецкий голос
  ruVoiceURI: "",
  elVoice: "N2lVS1w4EtoT3dr4eOWO",
  gVoiceDe: "de-DE-Neural2-B",
};
function applyTts(cfg) { Object.assign(TTS, cfg || {}); }

const QUALITY = /natural|neural|premium|enhanced|online|google|siri|wavenet/i;
function rankVoice(v) {
  const s = (v.name || "") + " " + (v.voiceURI || "");
  if (/compact|eloquence|espeak/i.test(s)) return 0;
  return QUALITY.test(s) ? 2 : 1;
}
function voicesFor(code) {
  if (!VOICES.length) refreshVoices();
  return VOICES.filter((v) => v.lang && v.lang.toLowerCase().indexOf(code) === 0).sort((a, b) => rankVoice(b) - rankVoice(a));
}
function pickVoice(code) {
  const list = voicesFor(code);
  const want = code === "ru" ? TTS.ruVoiceURI : TTS.deVoiceURI;
  return list.find((v) => v.voiceURI === want) || list[0] || null;
}

let curAudio = null;
const audioCache = new Map();

async function cloudAudio(text, lang) {
  const key = `${TTS.provider}|${TTS.elVoice}|${TTS.gVoiceDe}|${lang}|${text}`;
  if (audioCache.has(key)) return audioCache.get(key);
  let url = null;

  if (TTS.provider === "elevenlabs") {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${TTS.elVoice}`, {
      method: "POST",
      headers: { "xi-api-key": TTS.key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.1 },
      }),
    });
    if (!res.ok) throw new Error("ElevenLabs " + res.status);
    url = URL.createObjectURL(await res.blob());
  } else if (TTS.provider === "google") {
    const voice = lang.indexOf("ru") === 0
      ? { languageCode: "ru-RU", name: "ru-RU-Wavenet-C" }
      : { languageCode: "de-DE", name: TTS.gVoiceDe };
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(TTS.key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { text }, voice, audioConfig: { audioEncoding: "MP3", speakingRate: 1 } }),
    });
    const j = await res.json();
    if (!j.audioContent) throw new Error("Google TTS " + (j.error ? j.error.message : res.status));
    url = "data:audio/mp3;base64," + j.audioContent;
  }
  if (!url) throw new Error("no-provider");
  audioCache.set(key, url);
  return url;
}

function playUrl(url, rate) {
  return new Promise((resolve) => {
    try {
      const a = new Audio(url);
      a.playbackRate = rate || 1;
      curAudio = a;
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(true); } };
      a.onended = fin;
      a.onerror = fin;
      a.play().catch(fin);
    } catch (e) { resolve(false); }
  });
}

function systemSpeak(text, lang, rate) {
  return new Promise((resolve) => {
    if (!SYNTH || !text) { resolve(false); return; }
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      SYNTH.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      u.pitch = 1;
      const v = pickVoice(lang.slice(0, 2));
      if (v) u.voice = v;
      u.onend = () => fin(true);
      u.onerror = () => fin(false);
      SYNTH.speak(u);
      setTimeout(() => fin(true), 2500 + text.length * 110);
    } catch (e) { fin(false); }
  });
}

function stopSpeak() {
  try { if (SYNTH) SYNTH.cancel(); } catch (e) {}
  try { if (curAudio) { curAudio.pause(); curAudio = null; } } catch (e) {}
}

let ttsError = null;
async function speak(text, opts) {
  const o = opts || {};
  const lang = o.lang || "de-DE";
  const rate = o.rate || 1;
  if (!text) return false;
  stopSpeak();
  if (TTS.provider !== "system" && TTS.key) {
    try {
      const url = await cloudAudio(text, lang);
      ttsError = null;
      return await playUrl(url, rate);
    } catch (e) {
      ttsError = e.message;
    }
  }
  return systemSpeak(text, lang, rate);
}

function listen(lang, ms) {
  return new Promise((resolve, reject) => {
    if (!SR) { reject(new Error("no-speech-api")); return; }
    let rec;
    try { rec = new SR(); } catch (e) { reject(e); return; }
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    let done = false;
    const stop = () => { try { rec.stop(); } catch (e) {} };
    rec.onresult = (e) => {
      const alts = [];
      for (let i = 0; i < e.results[0].length; i++) alts.push(e.results[0][i].transcript);
      if (!done) { done = true; stop(); resolve(alts); }
    };
    rec.onerror = (e) => { if (!done) { done = true; reject(new Error(e.error || "error")); } };
    rec.onend = () => { if (!done) { done = true; resolve([]); } };
    try { rec.start(); } catch (e) { reject(e); return; }
    setTimeout(stop, ms || 7000);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- подготовка текста и сравнение --- */
function speechText(de) {
  return de
    .replace(/,\s*(¨?-[a-zäöüß]*|[A-ZÄÖÜ][a-zäöüß]+)$/, "")
    .replace(/\s*\+\s*(Dativ|Akkusativ|Genitiv)/g, "")
    .replace(/\s*↔\s*/g, ", ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/[()]/g, "")
    .replace(/…/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function targetText(de) {
  return speechText(de).split(",")[0].trim();
}
function norm(s) {
  return (s || "").toLowerCase().replace(/[.,!?;:„“"'()\-—…]/g, " ").replace(/\s+/g, " ").trim();
}
function fold(s) {
  return norm(s).replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/ё/g, "е");
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
function sim(a, b) {
  const x = fold(a), y = fold(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return 0.9;
  return 1 - lev(x, y) / Math.max(x.length, y.length);
}
function bestSim(alts, target) {
  let best = 0;
  (alts || []).forEach((a) => { const s = sim(a, target); if (s > best) best = s; });
  return best;
}
function ruVariants(ru) {
  return ru
    .replace(/[()]/g, " ")
    .split(/[,;/]|↔/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function checkRu(alts, ru) {
  let best = 0;
  ruVariants(ru).forEach((v) => { const s = bestSim(alts, v); if (s > best) best = s; });
  return best;
}

/* =============================== UI-ДЕТАЛИ =============================== */
function SpeakBtn({ text, lang, rate, size }) {
  const [on, setOn] = useState(false);
  const s = size || 30;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOn(true);
        speak(text, { lang: lang || "de-DE", rate: rate || 0.95 }).then(() => setOn(false));
      }}
      aria-label="Произнести"
      className="rounded-full flex items-center justify-center shrink-0"
      style={{ width: s, height: s, background: on ? T.petrol : T.petrolSoft, color: on ? "#fff" : T.petrol, border: "none", fontSize: s * 0.45 }}
    >
      ▶
    </button>
  );
}
function Bar({ value, color }) {
  return (
    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: T.rule }}>
      <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: color || T.petrol, transition: "width .35s ease" }} />
    </div>
  );
}

function Header({ title, sub, onBack }) {
  return (
    <div className="px-5 pt-6 pb-4" style={{ borderBottom: `1px solid ${T.rule}` }}>
      {onBack && (
        <button onClick={onBack} className="mb-3 text-sm" style={{ color: T.petrol, fontFamily: SANS }}>
          ← назад
        </button>
      )}
      <h1 style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.15, color: T.ink, letterSpacing: "-0.01em" }}>{title}</h1>
      {sub && <p className="mt-1" style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>{sub}</p>}
    </div>
  );
}

/* ============================== 1. КАРТОЧКИ ============================== */
function Cards({ known, setKnown }) {
  const [deck, setDeck] = useState(null);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [order, setOrder] = useState([]);

  const startDeck = (d, onlyNew) => {
    const idx = d.words.map((_, k) => k).filter((k) => (onlyNew ? !known[`${d.id}:${k}`] : true));
    const shuffled = idx.sort(() => Math.random() - 0.5);
    setOrder(shuffled.length ? shuffled : d.words.map((_, k) => k));
    setDeck(d);
    setI(0);
    setFlipped(false);
  };

  if (!deck) {
    return (
      <div>
        <Header title="Карточки" sub="Семь колод. Сначала смотрим немецкое слово, потом проверяем себя." />
        <div className="px-5 py-4 space-y-3">
          {DECKS.map((d) => {
            const done = d.words.filter((_, k) => known[`${d.id}:${k}`]).length;
            return (
              <div key={d.id} className="p-4 rounded-xl" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
                <div className="flex items-baseline justify-between">
                  <h3 style={{ fontFamily: SERIF, fontSize: 19, color: T.ink }}>{d.title}</h3>
                  <span style={{ fontFamily: SANS, fontSize: 12, color: T.muted }}>{done}/{d.words.length}</span>
                </div>
                <p className="mt-1 mb-3" style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>{d.hint}</p>
                <Bar value={done / d.words.length} />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => startDeck(d, false)} className="flex-1 py-2 rounded-lg" style={{ background: T.petrol, color: "#fff", fontFamily: SANS, fontSize: 14 }}>
                    Учить все
                  </button>
                  <button onClick={() => startDeck(d, true)} className="flex-1 py-2 rounded-lg" style={{ background: T.petrolSoft, color: T.petrol, fontFamily: SANS, fontSize: 14 }}>
                    Только новые
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const pos = order[i];
  const w = deck.words[pos];
  const finished = i >= order.length;

  if (finished) {
    return (
      <div>
        <Header title="Колода пройдена" sub={deck.title} onBack={() => setDeck(null)} />
        <div className="px-5 py-8 text-center">
          <p style={{ fontFamily: SERIF, fontSize: 22, color: T.ink }}>Пройдено {order.length} карточек</p>
          <button onClick={() => startDeck(deck, false)} className="mt-6 px-6 py-3 rounded-lg" style={{ background: T.petrol, color: "#fff", fontFamily: SANS }}>
            Пройти снова
          </button>
        </div>
      </div>
    );
  }

  const mark = (ok) => {
    const key = `${deck.id}:${pos}`;
    const next = { ...known };
    if (ok) next[key] = true;
    else delete next[key];
    setKnown(next);
    setFlipped(false);
    setI(i + 1);
  };

  return (
    <div>
      <Header title={deck.title} sub={`${i + 1} из ${order.length}`} onBack={() => setDeck(null)} />
      <div className="px-5 pt-3">
        <Bar value={i / order.length} color={T.mustard} />
      </div>
      <div className="px-5 py-6">
        <div
          onClick={() => setFlipped(!flipped)}
          className="rounded-2xl p-6 flex flex-col justify-center"
          style={{ background: T.card, border: `1px solid ${T.rule}`, minHeight: 260, cursor: "pointer" }}
        >
          <div className="flex items-start gap-3">
            <p className="flex-1" style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.2, color: T.ink }}>{w.de}</p>
            <SpeakBtn text={speechText(w.de)} size={38} />
          </div>
          {flipped ? (
            <div className="mt-5">
              <p style={{ fontFamily: SANS, fontSize: 17, color: T.petrol }}>{w.ru}</p>
              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${T.rule}` }}>
                <div className="flex items-start gap-3">
                  <p className="flex-1" style={{ fontFamily: SERIF, fontSize: 16.5, color: T.ink }}>{w.ex}</p>
                  <SpeakBtn text={w.ex} size={28} />
                </div>
                <p className="mt-1" style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>{w.exRu}</p>
              </div>
            </div>
          ) : (
            <p className="mt-5" style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>Нажмите, чтобы увидеть перевод</p>
          )}
        </div>
        {flipped && (
          <div className="flex gap-3 mt-4">
            <button onClick={() => mark(false)} className="flex-1 py-3 rounded-lg" style={{ background: T.roseSoft, color: T.rose, fontFamily: SANS, fontSize: 15 }}>
              Повторить
            </button>
            <button onClick={() => mark(true)} className="flex-1 py-3 rounded-lg" style={{ background: T.petrol, color: "#fff", fontFamily: SANS, fontSize: 15 }}>
              Знаю
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================= 2. ГРАММАТИКА ============================= */
function Grammar({ studied, setStudied, goChat, goHw }) {
  const [level, setLevel] = useState("A1");
  const [lesson, setLesson] = useState(null);

  if (lesson) {
    return (
      <div>
        <Header title={lesson.title} sub={`${lesson.level} · ${lesson.idea}`} onBack={() => setLesson(null)} />
        <div className="px-5 py-5 space-y-5">
          {lesson.blocks.map((b, k) => (
            <div key={k}>
              {b.h && <h4 className="mb-2" style={{ fontFamily: SANS, fontSize: 13, color: T.petrol }}>{b.h}</h4>}
              {b.rows && (
                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${T.rule}` }}>
                  {b.rows.map((r, j) => (
                    <div key={j} className="flex" style={{ borderTop: j ? `1px solid ${T.rule}` : "none", background: T.card }}>
                      <div className="w-2/5 px-3 py-2" style={{ fontFamily: SANS, fontSize: 13.5, color: T.muted }}>{r[0]}</div>
                      <div className="w-3/5 px-3 py-2" style={{ fontFamily: SERIF, fontSize: 15, color: T.ink, borderLeft: `1px solid ${T.rule}` }}>{r[1]}</div>
                    </div>
                  ))}
                </div>
              )}
              {b.p && <p style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.6, color: T.ink }}>{b.p}</p>}
              {b.ex && (
                <div className="rounded-lg p-3 space-y-2" style={{ background: T.mustardSoft }}>
                  {b.ex.map((e, j) => (
                    <div key={j} className="flex items-center gap-3">
                      <p className="flex-1" style={{ fontFamily: SERIF, fontSize: 15.5, color: T.ink }}>{e}</p>
                      <SpeakBtn text={e} size={26} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="pt-2 space-y-2">
            <button
              onClick={() => { setStudied({ ...studied, [lesson.id]: true }); setLesson(null); }}
              className="w-full py-3 rounded-lg"
              style={{ background: studied[lesson.id] ? T.petrolSoft : T.petrol, color: studied[lesson.id] ? T.petrol : "#fff", fontFamily: SANS, fontSize: 15 }}
            >
              {studied[lesson.id] ? "Тема уже отмечена как пройденная" : "Отметить как пройденную"}
            </button>
            <div className="flex gap-2">
              <button onClick={() => goChat(lesson)} className="flex-1 py-3 rounded-lg" style={{ background: T.card, border: `1px solid ${T.rule}`, color: T.ink, fontFamily: SANS, fontSize: 14 }}>
                Обсудить с ИИ
              </button>
              <button onClick={() => goHw(lesson)} className="flex-1 py-3 rounded-lg" style={{ background: T.card, border: `1px solid ${T.rule}`, color: T.ink, fontFamily: SANS, fontSize: 14 }}>
                Домашка по теме
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const list = GRAMMAR.filter((g) => g.level === level);
  const doneCount = list.filter((g) => studied[g.id]).length;

  return (
    <div>
      <Header title="Грамматика" sub="От первых фраз до академического стиля" />
      <div className="px-5 pt-4 flex gap-2">
        {LEVELS.map((lv) => (
          <button
            key={lv}
            onClick={() => setLevel(lv)}
            className="flex-1 py-2 rounded-lg"
            style={{
              background: lv === level ? T.ink : T.card,
              color: lv === level ? T.paper : T.muted,
              border: `1px solid ${lv === level ? T.ink : T.rule}`,
              fontFamily: SANS,
              fontSize: 14,
            }}
          >
            {lv}
          </button>
        ))}
      </div>
      <div className="px-5 pt-4">
        <p className="mb-2" style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Пройдено {doneCount} из {list.length}</p>
        <Bar value={list.length ? doneCount / list.length : 0} />
      </div>
      <div className="px-5 py-4 space-y-2">
        {list.map((g) => (
          <button
            key={g.id}
            onClick={() => setLesson(g)}
            className="w-full text-left p-4 rounded-xl"
            style={{ background: T.card, border: `1px solid ${studied[g.id] ? T.petrol : T.rule}` }}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 style={{ fontFamily: SERIF, fontSize: 17.5, color: T.ink }}>{g.title}</h3>
              {studied[g.id] && <span style={{ color: T.petrol, fontSize: 15 }}>✓</span>}
            </div>
            <p className="mt-1" style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>{g.idea}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* =============================== 3. ЧАТ С ИИ =============================== */
function Chat({ topic, setTopic, level, setLevel, msgs, setMsgs, ai, setAi }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const system = `Du bist ein geduldiger Deutschlehrer für einen russischsprachigen Studenten in Berlin. Sein Niveau: ${level}.
Aktuelles Thema: ${topic ? topic.level + " — " + topic.title + " (" + topic.idea + ")" : "frei gewählt"}.
Regeln:
1. Antworte zuerst auf Deutsch, auf dem Niveau ${level} — kurz, 2–4 Sätze.
2. Danach in einer neuen Zeile eine kurze Erklärung auf Russisch, wenn es nötig ist (Grammatik, neue Wörter).
3. Korrigiere Fehler des Studenten konkret: falsche Form → richtige Form → warum, auf Russisch, in einer Zeile.
4. Stelle am Ende genau eine Frage zum Thema, damit das Gespräch weitergeht.
5. Keine langen Listen, kein Small Talk ohne Inhalt. Sei direkt und sachlich.`;

  const send = async (text) => {
    const content = (text || input).trim();
    if (!content || busy) return;
    const next = [...msgs, { role: "user", content }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    setErr(null);
    try {
      const reply = await askClaude(next.map((m) => ({ role: m.role, content: m.content })), system);
      setMsgs([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setErr(e.message === "Не задан ключ Anthropic API" ? "Введите ключ Anthropic API выше — без него разговор с ИИ не работает." : "Ответ не пришёл: " + e.message);
    }
    setBusy(false);
  };

  const starters = topic
    ? [`Erklär mir noch einmal: ${topic.title}`, "Gib mir 3 Beispielsätze zum Thema", "Stell mir 3 Fragen zum Thema"]
    : ["Lass uns über meinen Tag sprechen", "Frag mich etwas über Berlin", "Korrigiere diesen Satz: ..."];

  return (
    <div className="flex flex-col" style={{ height: "100%" }}>
      <Header title="Разговор с ИИ" sub={topic ? `Тема: ${topic.title}` : "Тема свободная"} />
      <div className="px-5 pt-3 flex gap-2 items-center flex-wrap">
        {LEVELS.map((lv) => (
          <button key={lv} onClick={() => setLevel(lv)} className="px-3 py-1 rounded-full" style={{ background: lv === level ? T.petrol : T.card, color: lv === level ? "#fff" : T.muted, border: `1px solid ${lv === level ? T.petrol : T.rule}`, fontFamily: SANS, fontSize: 12.5 }}>
            {lv}
          </button>
        ))}
        <KeyPanel ai={ai} setAi={setAi} />
        {topic && (
          <button onClick={() => setTopic(null)} className="px-3 py-1 rounded-full" style={{ background: T.card, border: `1px solid ${T.rule}`, color: T.muted, fontFamily: SANS, fontSize: 12.5 }}>
            снять тему
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p style={{ fontFamily: SANS, fontSize: 13.5, color: T.muted }}>Начните с готовой фразы или напишите свою:</p>
            {starters.map((s, k) => (
              <button key={k} onClick={() => send(s)} className="w-full text-left px-4 py-3 rounded-lg" style={{ background: T.card, border: `1px solid ${T.rule}`, fontFamily: SERIF, fontSize: 15.5, color: T.ink }}>
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, k) => (
          <div key={k} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className="px-4 py-3 rounded-2xl"
              style={{
                maxWidth: "88%",
                background: m.role === "user" ? T.petrol : T.card,
                color: m.role === "user" ? "#fff" : T.ink,
                border: m.role === "user" ? "none" : `1px solid ${T.rule}`,
                fontFamily: SANS,
                fontSize: 14.5,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && <p style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>Учитель печатает…</p>}
        {err && <p style={{ fontFamily: SANS, fontSize: 13, color: T.rose }}>{err}</p>}
        <div ref={endRef} />
      </div>

      <div className="px-5 py-3 flex gap-2" style={{ borderTop: `1px solid ${T.rule}`, background: T.paper }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Schreiben Sie auf Deutsch…"
          className="flex-1 px-4 py-3 rounded-lg"
          style={{ background: T.card, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 14.5, color: T.ink, outline: "none" }}
        />
        <button onClick={() => send()} className="px-4 rounded-lg" style={{ background: T.ink, color: T.paper, fontFamily: SANS, fontSize: 14 }}>
          Отправить
        </button>
      </div>
    </div>
  );
}

/* ============================== 4. ДОМАШКА ============================== */
function Homework({ topic, setTopic, level, history, setHistory, ai, setAi }) {
  const [tasks, setTasks] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    setAnswers({});
    const t = topic || GRAMMAR[0];
    const sys = `Du erstellst Deutschübungen für einen russischsprachigen Studenten, Niveau ${level}.
Thema: ${t.level} — ${t.title}. ${t.idea}
Erstelle genau 5 Aufgaben: 3 Lückensätze (Aufgabe = deutscher Satz mit ___), 2 Übersetzungen Russisch → Deutsch.
Antworte NUR mit JSON, ohne Text davor oder danach, im Format:
[{"typ":"Lücke","aufgabe":"...","hinweis":"..."},{"typ":"Übersetzung","aufgabe":"...","hinweis":"..."}]
"hinweis" ist eine kurze Hilfe auf Russisch (максимум 6 слов).`;
    try {
      const raw = await askClaude([{ role: "user", content: "Erstelle die Aufgaben." }], sys);
      const parsed = parseJson(raw);
      setTasks(parsed.slice(0, 5));
    } catch (e) {
      setErr("Задания не сгенерировались: " + e.message);
    }
    setBusy(false);
  };

  const check = async () => {
    setBusy(true);
    setErr(null);
    const t = topic || GRAMMAR[0];
    const payload = tasks.map((x, k) => ({ nr: k + 1, aufgabe: x.aufgabe, antwort: answers[k] || "" }));
    const sys = `Du korrigierst Deutschübungen zum Thema "${t.title}" (${t.level}) für einen russischsprachigen Studenten.
Antworte NUR mit JSON, ohne Text davor oder danach:
{"punkte":<число правильных 0-5>,"details":[{"nr":1,"richtig":true,"loesung":"правильный вариант","kommentar":"объяснение по-русски, 1 предложение"}],"fazit":"итог по-русски, 1-2 предложения, что повторить"}
Kleine Tippfehler zählen als richtig, aber erwähne sie im Kommentar.`;
    try {
      const raw = await askClaude([{ role: "user", content: JSON.stringify(payload) }], sys);
      const parsed = parseJson(raw);
      setResult(parsed);
      const entry = { date: new Date().toLocaleDateString("ru-RU"), topic: t.title, score: parsed.punkte, total: tasks.length };
      setHistory([entry, ...history].slice(0, 20));
    } catch (e) {
      setErr("Проверка не прошла: " + e.message);
    }
    setBusy(false);
  };

  return (
    <div>
      <Header title="Домашнее задание" sub={topic ? `Тема: ${topic.level} — ${topic.title}` : "Выберите тему из грамматики или начните с первой"} />
      <div className="px-5 py-4 space-y-4">
        <KeyPanel ai={ai} setAi={setAi} />
        <div className="p-4 rounded-xl" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
          <label style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Тема задания</label>
          <select
            value={topic ? topic.id : ""}
            onChange={(e) => setTopic(GRAMMAR.find((g) => g.id === e.target.value) || null)}
            className="w-full mt-2 px-3 py-2 rounded-lg"
            style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 14, color: T.ink }}
          >
            <option value="">— выберите тему —</option>
            {GRAMMAR.map((g) => (
              <option key={g.id} value={g.id}>{g.level} · {g.title}</option>
            ))}
          </select>
          <button onClick={generate} disabled={busy || !topic} className="w-full mt-3 py-3 rounded-lg" style={{ background: topic ? T.petrol : T.rule, color: "#fff", fontFamily: SANS, fontSize: 15 }}>
            {busy && !tasks ? "Составляю…" : "Составить задание"}
          </button>
        </div>

        {err && <p style={{ fontFamily: SANS, fontSize: 13.5, color: T.rose }}>{err}</p>}

        {tasks && (
          <div className="space-y-3">
            {tasks.map((t, k) => {
              const d = result && result.details ? result.details.find((x) => x.nr === k + 1) : null;
              return (
                <div key={k} className="p-4 rounded-xl" style={{ background: T.card, border: `1px solid ${d ? (d.richtig ? T.petrol : T.rose) : T.rule}` }}>
                  <p style={{ fontFamily: SANS, fontSize: 11.5, color: T.muted }}>{k + 1}. {t.typ}</p>
                  <p className="mt-1" style={{ fontFamily: SERIF, fontSize: 16.5, color: T.ink }}>{t.aufgabe}</p>
                  {t.hinweis && <p className="mt-1" style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>{t.hinweis}</p>}
                  <input
                    value={answers[k] || ""}
                    onChange={(e) => setAnswers({ ...answers, [k]: e.target.value })}
                    placeholder="Ваш ответ"
                    className="w-full mt-3 px-3 py-2 rounded-lg"
                    style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SERIF, fontSize: 15.5, color: T.ink, outline: "none" }}
                  />
                  {d && (
                    <div className="mt-3 p-3 rounded-lg" style={{ background: d.richtig ? T.petrolSoft : T.roseSoft }}>
                      <p style={{ fontFamily: SERIF, fontSize: 15, color: T.ink }}>{d.loesung}</p>
                      <p className="mt-1" style={{ fontFamily: SANS, fontSize: 12.5, color: d.richtig ? T.petrol : T.rose }}>{d.kommentar}</p>
                    </div>
                  )}
                </div>
              );
            })}
            {!result && (
              <button onClick={check} disabled={busy} className="w-full py-3 rounded-lg" style={{ background: T.ink, color: T.paper, fontFamily: SANS, fontSize: 15 }}>
                {busy ? "Проверяю…" : "Проверить"}
              </button>
            )}
            {result && (
              <div className="p-4 rounded-xl" style={{ background: T.mustardSoft }}>
                <p style={{ fontFamily: SERIF, fontSize: 20, color: T.ink }}>{result.punkte} из {tasks.length}</p>
                <p className="mt-1" style={{ fontFamily: SANS, fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{result.fazit}</p>
                <button onClick={generate} className="w-full mt-3 py-2 rounded-lg" style={{ background: T.card, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 14, color: T.ink }}>
                  Новое задание по этой теме
                </button>
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div>
            <h4 className="mb-2" style={{ fontFamily: SANS, fontSize: 13, color: T.petrol }}>История</h4>
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${T.rule}` }}>
              {history.map((h, k) => (
                <div key={k} className="flex justify-between px-4 py-2" style={{ background: T.card, borderTop: k ? `1px solid ${T.rule}` : "none" }}>
                  <span style={{ fontFamily: SANS, fontSize: 13, color: T.ink }}>{h.topic}</span>
                  <span style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>{h.score}/{h.total} · {h.date}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KeyPanel({ ai, setAi }) {
  const [open, setOpen] = useState(!ai.key);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="px-3 py-1 rounded-full" style={{ background: T.card, border: `1px solid ${T.rule}`, color: T.muted, fontFamily: SANS, fontSize: 12.5 }}>
        ключ ИИ
      </button>
    );
  }
  return (
    <div className="p-4 rounded-xl" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
      <label style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Ключ Anthropic API</label>
      <input
        type="password"
        value={ai.key}
        onChange={(e) => { const n = { ...ai, key: e.target.value }; setAi(n); applyAi(n); }}
        placeholder="sk-ant-..."
        className="w-full mt-2 px-3 py-2 rounded-lg"
        style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 13.5, color: T.ink, outline: "none" }}
      />
      <input
        value={ai.model}
        onChange={(e) => { const n = { ...ai, model: e.target.value }; setAi(n); applyAi(n); }}
        className="w-full mt-2 px-3 py-2 rounded-lg"
        style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 13.5, color: T.ink, outline: "none" }}
      />
      <p className="mt-2" style={{ fontFamily: SANS, fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
        Ключ создаётся на console.anthropic.com и хранится только в этом браузере. Не публикуйте его в репозитории и не открывайте сайт с чужого устройства с введённым ключом.
      </p>
      <button onClick={() => setOpen(false)} className="w-full mt-3 py-2 rounded-lg" style={{ background: T.petrolSoft, color: T.petrol, fontFamily: SANS, fontSize: 14 }}>
        Свернуть
      </button>
    </div>
  );
}

function VoiceSettings({ tts, setTts, onBack }) {
  const [status, setStatus] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => { refreshVoices(); setTick((x) => x + 1); }, 400);
    return () => clearTimeout(t);
  }, []);

  const set = (k, v) => { const n = { ...tts, [k]: v }; setTts(n); applyTts(n); };
  const deList = voicesFor("de");
  const ruList = voicesFor("ru");

  const test = async () => {
    setStatus("Проверяю…");
    ttsError = null;
    await speak("Guten Tag. Ich lerne Deutsch in Berlin und übe jeden Tag.", { lang: "de-DE", rate: 1 });
    setStatus(ttsError ? `Не удалось: ${ttsError}. Сейчас звучит системный голос.` : tts.provider === "system" ? "Системный голос." : "Нейросетевой голос работает.");
  };

  const P = [["system", "Системный"], ["elevenlabs", "ElevenLabs"], ["google", "Google Cloud"]];

  return (
    <div>
      <Header title="Настройки голоса" sub="Чем лучше движок, тем естественнее звучит немецкий" onBack={onBack} />
      <div className="px-5 py-4 space-y-4">
        <div className="flex gap-2">
          {P.map(([v, l]) => (
            <button key={v} onClick={() => set("provider", v)} className="flex-1 py-2 rounded-lg" style={{ background: tts.provider === v ? T.ink : T.card, color: tts.provider === v ? T.paper : T.muted, border: `1px solid ${tts.provider === v ? T.ink : T.rule}`, fontFamily: SANS, fontSize: 13 }}>
              {l}
            </button>
          ))}
        </div>

        {tts.provider === "system" && (
          <div className="p-4 rounded-xl space-y-3" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
            <div>
              <label style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Немецкий голос ({deList.length} доступно)</label>
              <select value={tts.deVoiceURI} onChange={(e) => set("deVoiceURI", e.target.value)} className="w-full mt-2 px-3 py-2 rounded-lg" style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 13.5, color: T.ink }}>
                <option value="">— лучший из найденных —</option>
                {deList.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name}{rankVoice(v) === 2 ? " ★" : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Русский голос для переводов</label>
              <select value={tts.ruVoiceURI} onChange={(e) => set("ruVoiceURI", e.target.value)} className="w-full mt-2 px-3 py-2 rounded-lg" style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 13.5, color: T.ink }}>
                <option value="">— лучший из найденных —</option>
                {ruList.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name}{rankVoice(v) === 2 ? " ★" : ""}</option>
                ))}
              </select>
            </div>
            <p style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
              Звёздочкой отмечены голоса нейросетевого качества. Если их в списке нет, немецкий звучит роботом — качественный голос нужно доставить в систему:
              на Android — Настройки → Язык и ввод → Синтез речи → Google, скачать немецкий;
              на iPhone — Настройки → Универсальный доступ → Устный контент → Голоса → Deutsch, вариант Premium;
              на Windows — Параметры → Специальные возможности → Речь, добавить голос Katja или Conrad (Natural).
            </p>
          </div>
        )}

        {tts.provider !== "system" && (
          <div className="p-4 rounded-xl space-y-3" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
            <div>
              <label style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Ваш API-ключ</label>
              <input
                type="password"
                value={tts.key}
                onChange={(e) => set("key", e.target.value)}
                placeholder={tts.provider === "elevenlabs" ? "ключ из профиля ElevenLabs" : "ключ Google Cloud"}
                className="w-full mt-2 px-3 py-2 rounded-lg"
                style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 13.5, color: T.ink, outline: "none" }}
              />
            </div>
            {tts.provider === "elevenlabs" ? (
              <div>
                <label style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Голос (Voice ID из вашей библиотеки)</label>
                <input value={tts.elVoice} onChange={(e) => set("elVoice", e.target.value)} className="w-full mt-2 px-3 py-2 rounded-lg" style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 13.5, color: T.ink, outline: "none" }} />
                <p className="mt-2" style={{ fontFamily: SANS, fontSize: 12, color: T.muted }}>Модель eleven_multilingual_v2 — один голос читает и немецкий, и русский. Voice ID берётся на странице голоса в разделе Voices.</p>
              </div>
            ) : (
              <div>
                <label style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Немецкий голос</label>
                <select value={tts.gVoiceDe} onChange={(e) => set("gVoiceDe", e.target.value)} className="w-full mt-2 px-3 py-2 rounded-lg" style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 13.5, color: T.ink }}>
                  {["de-DE-Neural2-B", "de-DE-Neural2-D", "de-DE-Neural2-A", "de-DE-Neural2-C", "de-DE-Neural2-F", "de-DE-Wavenet-B"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <p className="mt-2" style={{ fontFamily: SANS, fontSize: 12, color: T.muted }}>Neural2-B и -D — мужские, -A, -C, -F — женские. Ключ создаётся в Google Cloud, нужен включённый Text-to-Speech API.</p>
              </div>
            )}
            <p style={{ fontFamily: SANS, fontSize: 12, color: T.rose, lineHeight: 1.5 }}>
              Ключ остаётся в памяти этого приложения на вашем устройстве и уходит только на сервер выбранного сервиса. Не вставляйте рабочий ключ компании и ограничьте его в консоли сервиса.
            </p>
          </div>
        )}

        <button onClick={test} className="w-full py-3 rounded-lg" style={{ background: T.petrol, color: "#fff", fontFamily: SANS, fontSize: 15 }}>
          Прослушать образец
        </button>
        {status && <p style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>{status}</p>}
        <p style={{ fontFamily: SANS, fontSize: 12, color: T.muted, display: "none" }}>{tick}</p>
      </div>
    </div>
  );
}

/* =========================== 5. ГОЛОСОВОЙ РЕЖИМ =========================== */
function Voice({ known, setKnown, prefs, setPrefs, tts, setTts }) {
  const [mode, setMode] = useState("menu"); // menu | playlist | trainer | settings
  const [deckId, setDeckId] = useState(DECKS[0].id);
  const [filter, setFilter] = useState("all"); // all | new | known
  const deck = DECKS.find((d) => d.id === deckId) || DECKS[0];

  const buildList = () => {
    const idx = deck.words.map((_, k) => k).filter((k) => {
      if (filter === "new") return !known[`${deck.id}:${k}`];
      if (filter === "known") return !!known[`${deck.id}:${k}`];
      return true;
    });
    return (idx.length ? idx : deck.words.map((_, k) => k)).map((k) => ({ ...deck.words[k], key: `${deck.id}:${k}` }));
  };

  if (mode === "settings") return <VoiceSettings tts={tts} setTts={setTts} onBack={() => setMode("menu")} />;
  if (mode === "playlist") return <Playlist list={buildList()} deck={deck} prefs={prefs} setPrefs={setPrefs} onBack={() => setMode("menu")} />;
  if (mode === "trainer") return <Trainer list={buildList()} deck={deck} prefs={prefs} known={known} setKnown={setKnown} onBack={() => setMode("menu")} />;

  const noSynth = !SYNTH;
  const noMic = !SR;

  return (
    <div>
      <Header title="Голосовой помощник" sub="Слушать и говорить: озвучка, аудио-плейлист и проверка произношения" />
      <div className="px-5 py-4 space-y-4">
        <div className="p-4 rounded-xl" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
          <label style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Категория</label>
          <select
            value={deckId}
            onChange={(e) => setDeckId(e.target.value)}
            className="w-full mt-2 px-3 py-2 rounded-lg"
            style={{ background: T.paper, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 14, color: T.ink }}
          >
            {DECKS.map((d) => (
              <option key={d.id} value={d.id}>{d.title} ({d.words.length})</option>
            ))}
          </select>
          <div className="flex gap-2 mt-3">
            {[["all", "Все"], ["new", "Невыученные"], ["known", "Выученные"]].map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)} className="flex-1 py-2 rounded-lg" style={{ background: filter === v ? T.ink : T.paper, color: filter === v ? T.paper : T.muted, border: `1px solid ${filter === v ? T.ink : T.rule}`, fontFamily: SANS, fontSize: 13 }}>
                {l}
              </button>
            ))}
          </div>
          <p className="mt-3" style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>В подборке: {buildList().length} слов</p>
        </div>

        <button onClick={() => setMode("playlist")} disabled={noSynth} className="w-full text-left p-4 rounded-xl" style={{ background: T.card, border: `1px solid ${T.rule}`, opacity: noSynth ? 0.5 : 1 }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 19, color: T.ink }}>Аудио-плейлист</h3>
          <p className="mt-1" style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>
            Без рук: диктор говорит слово, даёт паузу на повтор, потом перевод. Для автобуса и метро — включите наушники.
          </p>
        </button>

        <button onClick={() => setMode("trainer")} className="w-full text-left p-4 rounded-xl" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 19, color: T.ink }}>Тренажёр произношения</h3>
          <p className="mt-1" style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>
            Диктор говорит слово — вы повторяете вслух — приложение оценивает произношение. Потом называете перевод; если ошиблись, услышите правильный.
          </p>
        </button>

        <button onClick={() => setMode("settings")} className="w-full text-left p-4 rounded-xl" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 19, color: T.ink }}>Настройки голоса</h3>
          <p className="mt-1" style={{ fontFamily: SANS, fontSize: 13, color: T.muted }}>
            Сейчас: {tts.provider === "system" ? "системный синтез" : tts.provider === "elevenlabs" ? "ElevenLabs" : "Google Cloud"}. Здесь же выбирается голос и проверяется звучание.
          </p>
        </button>

        <div className="p-4 rounded-xl" style={{ background: T.mustardSoft }}>
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: T.ink, lineHeight: 1.55 }}>
            {noSynth && "Синтез речи в этом браузере недоступен — откройте приложение в Chrome или Safari. "}
            {!noSynth && noMic && "Распознавание речи здесь недоступно: в тренажёре будет ручная самопроверка. "}
            Микрофон требует разрешения браузера. Плейлист останавливается при блокировке экрана — оставьте экран включённым.
          </p>
        </div>
      </div>
    </div>
  );
}

function Playlist({ list, deck, prefs, setPrefs, onBack }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState("stop");
  const running = useRef(false);
  const stopped = useRef(true);

  useEffect(() => () => { stopped.current = true; stopSpeak(); }, []);

  const set = (k, v) => setPrefs({ ...prefs, [k]: v });

  const run = async (start) => {
    if (running.current) return;
    running.current = true;
    stopped.current = false;
    for (let k = start; k < list.length; k++) {
      if (stopped.current) break;
      setI(k);
      const w = list[k];
      setPhase("de");
      await speak(speechText(w.de), { lang: "de-DE", rate: prefs.rate });
      if (stopped.current) break;
      if (prefs.twice) { await wait(350); if (stopped.current) break; await speak(speechText(w.de), { lang: "de-DE", rate: prefs.rate }); }
      if (stopped.current) break;
      setPhase("repeat");
      await wait(prefs.pause * 1000);
      if (stopped.current) break;
      setPhase("ru");
      await speak(w.ru, { lang: "ru-RU", rate: 1 });
      if (stopped.current) break;
      if (prefs.withExample) {
        setPhase("ex");
        await wait(250);
        if (stopped.current) break;
        await speak(w.ex, { lang: "de-DE", rate: prefs.rate });
      }
      if (stopped.current) break;
      await wait(500);
    }
    running.current = false;
    if (!stopped.current) setPhase("done");
  };

  const stop = () => { stopped.current = true; running.current = false; stopSpeak(); setPhase("stop"); };
  const jump = (d) => { stop(); const n = Math.max(0, Math.min(list.length - 1, i + d)); setI(n); setTimeout(() => run(n), 120); };

  const w = list[i];
  const label = { de: "слушайте", repeat: "повторите вслух", ru: "перевод", ex: "пример", stop: "пауза", done: "подборка закончилась" }[phase];

  return (
    <div>
      <Header title="Аудио-плейлист" sub={`${deck.title} · ${i + 1} из ${list.length}`} onBack={() => { stop(); onBack(); }} />
      <div className="px-5 pt-3"><Bar value={(i + 1) / list.length} color={T.mustard} /></div>

      <div className="px-5 py-6">
        <div className="rounded-2xl p-6" style={{ background: T.card, border: `1px solid ${T.rule}`, minHeight: 200 }}>
          <p style={{ fontFamily: SANS, fontSize: 12, color: phase === "repeat" ? T.mustard : T.muted }}>{label}</p>
          <p className="mt-3" style={{ fontFamily: SERIF, fontSize: 28, lineHeight: 1.2, color: T.ink }}>{w.de}</p>
          <p className="mt-3" style={{ fontFamily: SANS, fontSize: 16, color: phase === "de" || phase === "repeat" ? T.rule : T.petrol }}>{w.ru}</p>
          <p className="mt-4" style={{ fontFamily: SERIF, fontSize: 15, color: T.muted }}>{w.ex}</p>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={() => jump(-1)} className="px-4 py-3 rounded-lg" style={{ background: T.card, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 14, color: T.ink }}>◀</button>
          <button
            onClick={() => (running.current ? stop() : run(i))}
            className="flex-1 py-3 rounded-lg"
            style={{ background: running.current ? T.ink : T.petrol, color: "#fff", fontFamily: SANS, fontSize: 15 }}
          >
            {running.current ? "Пауза" : "Слушать"}
          </button>
          <button onClick={() => jump(1)} className="px-4 py-3 rounded-lg" style={{ background: T.card, border: `1px solid ${T.rule}`, fontFamily: SANS, fontSize: 14, color: T.ink }}>▶</button>
        </div>

        <div className="mt-5 p-4 rounded-xl space-y-3" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
          <div>
            <p style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Скорость речи</p>
            <div className="flex gap-2 mt-2">
              {[[0.7, "медленно"], [0.85, "средне"], [1, "обычно"]].map(([v, l]) => (
                <button key={v} onClick={() => set("rate", v)} className="flex-1 py-2 rounded-lg" style={{ background: prefs.rate === v ? T.petrolSoft : T.paper, color: prefs.rate === v ? T.petrol : T.muted, border: `1px solid ${prefs.rate === v ? T.petrol : T.rule}`, fontFamily: SANS, fontSize: 13 }}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <p style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>Пауза на повтор</p>
            <div className="flex gap-2 mt-2">
              {[2, 3, 5].map((v) => (
                <button key={v} onClick={() => set("pause", v)} className="flex-1 py-2 rounded-lg" style={{ background: prefs.pause === v ? T.petrolSoft : T.paper, color: prefs.pause === v ? T.petrol : T.muted, border: `1px solid ${prefs.pause === v ? T.petrol : T.rule}`, fontFamily: SANS, fontSize: 13 }}>{v} с</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => set("twice", !prefs.twice)} className="flex-1 py-2 rounded-lg" style={{ background: prefs.twice ? T.petrolSoft : T.paper, color: prefs.twice ? T.petrol : T.muted, border: `1px solid ${prefs.twice ? T.petrol : T.rule}`, fontFamily: SANS, fontSize: 13 }}>Слово дважды</button>
            <button onClick={() => set("withExample", !prefs.withExample)} className="flex-1 py-2 rounded-lg" style={{ background: prefs.withExample ? T.petrolSoft : T.paper, color: prefs.withExample ? T.petrol : T.muted, border: `1px solid ${prefs.withExample ? T.petrol : T.rule}`, fontFamily: SANS, fontSize: 13 }}>С примером</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Trainer({ list, deck, prefs, known, setKnown, onBack }) {
  const [i, setI] = useState(0);
  const [step, setStep] = useState("idle"); // idle | say | hear-de | de-done | hear-ru | done
  const [heardDe, setHeardDe] = useState(null);
  const [scoreDe, setScoreDe] = useState(null);
  const [heardRu, setHeardRu] = useState(null);
  const [scoreRu, setScoreRu] = useState(null);
  const [tally, setTally] = useState({ de: 0, ru: 0, n: 0 });
  const [note, setNote] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; stopSpeak(); }, []);

  const w = list[i];
  const target = targetText(w.de);

  const reset = () => { setHeardDe(null); setScoreDe(null); setHeardRu(null); setScoreRu(null); setNote(null); };

  const startCard = async () => {
    reset();
    setStep("say");
    await speak(speechText(w.de), { lang: "de-DE", rate: prefs.rate });
    if (!alive.current) return;
    if (!SR) { setStep("de-done"); setNote("Микрофон недоступен — оцените себя сами."); return; }
    setStep("hear-de");
    try {
      const alts = await listen("de-DE", 7000);
      if (!alive.current) return;
      const s = bestSim(alts, target);
      setHeardDe(alts[0] || "—");
      setScoreDe(s);
      setStep("de-done");
      if (s < 0.6) { await wait(300); await speak(target, { lang: "de-DE", rate: 0.7 }); }
    } catch (e) {
      if (!alive.current) return;
      setStep("de-done");
      setNote(e.message === "not-allowed" ? "Нет доступа к микрофону. Разрешите его в браузере или оцените себя сами." : "Не расслышал. Оцените себя сами или попробуйте ещё раз.");
    }
  };

  const askTranslation = async () => {
    setStep("hear-ru");
    if (!SR) { setStep("done"); setNote("Микрофон недоступен — перевод показан ниже."); setScoreRu(null); return; }
    try {
      const alts = await listen("ru-RU", 7000);
      if (!alive.current) return;
      const s = checkRu(alts, w.ru);
      setHeardRu(alts[0] || "—");
      setScoreRu(s);
      setStep("done");
      if (s < 0.6) {
        await wait(250);
        await speak("Правильный перевод: " + ruVariants(w.ru)[0], { lang: "ru-RU", rate: 1 });
      }
      setTally((t) => ({ de: t.de + (scoreDe >= 0.6 ? 1 : 0), ru: t.ru + (s >= 0.6 ? 1 : 0), n: t.n + 1 }));
    } catch (e) {
      if (!alive.current) return;
      setStep("done");
      setNote("Не расслышал перевод. Правильный вариант ниже.");
    }
  };

  const next = () => {
    if (i + 1 >= list.length) { setStep("finished"); return; }
    setI(i + 1);
    setStep("idle");
    reset();
  };

  const manual = (ok) => {
    setScoreDe(ok ? 1 : 0);
    setStep("de-done");
  };

  if (step === "finished") {
    return (
      <div>
        <Header title="Круг пройден" sub={deck.title} onBack={onBack} />
        <div className="px-5 py-8 text-center">
          <p style={{ fontFamily: SERIF, fontSize: 22, color: T.ink }}>Произношение {tally.de} из {tally.n}</p>
          <p className="mt-1" style={{ fontFamily: SERIF, fontSize: 22, color: T.ink }}>Перевод {tally.ru} из {tally.n}</p>
          <button onClick={() => { setI(0); setTally({ de: 0, ru: 0, n: 0 }); setStep("idle"); reset(); }} className="mt-6 px-6 py-3 rounded-lg" style={{ background: T.petrol, color: "#fff", fontFamily: SANS }}>
            Ещё раз
          </button>
        </div>
      </div>
    );
  }

  const verdict = (s) => (s === null ? null : s >= 0.75 ? "Точно" : s >= 0.6 ? "Почти — можно чётче" : "Не совпало");
  const vColor = (s) => (s === null ? T.muted : s >= 0.6 ? T.petrol : T.rose);

  return (
    <div>
      <Header title="Тренажёр произношения" sub={`${deck.title} · ${i + 1} из ${list.length}`} onBack={onBack} />
      <div className="px-5 pt-3"><Bar value={(i + 1) / list.length} color={T.mustard} /></div>

      <div className="px-5 py-5 space-y-4">
        <div className="rounded-2xl p-5" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
          <div className="flex items-start gap-3">
            <p className="flex-1" style={{ fontFamily: SERIF, fontSize: 27, lineHeight: 1.2, color: T.ink }}>{w.de}</p>
            <SpeakBtn text={speechText(w.de)} rate={prefs.rate} size={38} />
          </div>
          {(step === "done" || step === "hear-ru") && (
            <p className="mt-3" style={{ fontFamily: SANS, fontSize: 16, color: T.petrol }}>{w.ru}</p>
          )}
          <p className="mt-4" style={{ fontFamily: SANS, fontSize: 12.5, color: T.muted }}>
            {step === "idle" && "Нажмите «Слушать и повторить»: сначала говорит диктор, потом ваша очередь."}
            {step === "say" && "Диктор говорит…"}
            {step === "hear-de" && "Говорите слово по-немецки…"}
            {step === "de-done" && "Теперь назовите перевод вслух по-русски."}
            {step === "hear-ru" && "Говорите перевод по-русски…"}
            {step === "done" && "Готово."}
          </p>
        </div>

        {scoreDe !== null && (
          <div className="p-4 rounded-xl" style={{ background: scoreDe >= 0.6 ? T.petrolSoft : T.roseSoft }}>
            <p style={{ fontFamily: SANS, fontSize: 13, color: vColor(scoreDe) }}>Произношение: {verdict(scoreDe)}</p>
            {heardDe && <p className="mt-1" style={{ fontFamily: SERIF, fontSize: 15, color: T.ink }}>услышано: {heardDe}</p>}
            {scoreDe < 0.6 && <p className="mt-1" style={{ fontFamily: SERIF, fontSize: 15, color: T.ink }}>правильно: {target}</p>}
          </div>
        )}

        {scoreRu !== null && (
          <div className="p-4 rounded-xl" style={{ background: scoreRu >= 0.6 ? T.petrolSoft : T.roseSoft }}>
            <p style={{ fontFamily: SANS, fontSize: 13, color: vColor(scoreRu) }}>Перевод: {verdict(scoreRu)}</p>
            {heardRu && <p className="mt-1" style={{ fontFamily: SANS, fontSize: 15, color: T.ink }}>вы сказали: {heardRu}</p>}
            {scoreRu < 0.6 && <p className="mt-1" style={{ fontFamily: SANS, fontSize: 15, color: T.ink }}>правильно: {w.ru}</p>}
          </div>
        )}

        {note && <p style={{ fontFamily: SANS, fontSize: 13, color: T.rose }}>{note}</p>}

        {step === "idle" && (
          <button onClick={startCard} className="w-full py-3 rounded-lg" style={{ background: T.petrol, color: "#fff", fontFamily: SANS, fontSize: 15 }}>
            Слушать и повторить
          </button>
        )}
        {(step === "say" || step === "hear-de" || step === "hear-ru") && (
          <button disabled className="w-full py-3 rounded-lg" style={{ background: T.rule, color: "#fff", fontFamily: SANS, fontSize: 15 }}>
            {step === "say" ? "Слушайте…" : "Слушаю вас…"}
          </button>
        )}
        {step === "de-done" && (
          <div className="space-y-2">
            {scoreDe === null && (
              <div className="flex gap-2">
                <button onClick={() => manual(false)} className="flex-1 py-3 rounded-lg" style={{ background: T.roseSoft, color: T.rose, fontFamily: SANS, fontSize: 14 }}>Сказал неточно</button>
                <button onClick={() => manual(true)} className="flex-1 py-3 rounded-lg" style={{ background: T.petrolSoft, color: T.petrol, fontFamily: SANS, fontSize: 14 }}>Сказал верно</button>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={startCard} className="flex-1 py-3 rounded-lg" style={{ background: T.card, border: `1px solid ${T.rule}`, color: T.ink, fontFamily: SANS, fontSize: 14 }}>Ещё раз</button>
              <button onClick={askTranslation} className="flex-1 py-3 rounded-lg" style={{ background: T.ink, color: T.paper, fontFamily: SANS, fontSize: 14 }}>Сказать перевод</button>
            </div>
          </div>
        )}
        {step === "done" && (
          <div className="flex gap-2">
            <button
              onClick={() => { const n = { ...known }; n[w.key] = true; setKnown(n); next(); }}
              className="flex-1 py-3 rounded-lg"
              style={{ background: T.petrolSoft, color: T.petrol, fontFamily: SANS, fontSize: 14 }}
            >
              Знаю — дальше
            </button>
            <button onClick={next} className="flex-1 py-3 rounded-lg" style={{ background: T.petrol, color: "#fff", fontFamily: SANS, fontSize: 14 }}>
              Следующее слово
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================= КОРЕНЬ ================================= */
function App() {
  const [tab, setTab] = useState("cards");
  const [known, setKnown] = useState({});
  const [studied, setStudied] = useState({});
  const [history, setHistory] = useState([]);
  const [topic, setTopic] = useState(null);
  const [level, setLevel] = useState("A2");
  const [msgs, setMsgs] = useState([]);
  const [prefs, setPrefs] = useState({ rate: 0.85, pause: 3, twice: true, withExample: false });
  const [tts, setTts] = useState({ ...TTS });
  const [ai, setAi] = useState({ ...AI });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      setKnown(await loadState("de:known", {}));
      setStudied(await loadState("de:studied", {}));
      setHistory(await loadState("de:hw", []));
      setLevel(await loadState("de:level", "A2"));
      setPrefs(await loadState("de:voice", { rate: 0.85, pause: 3, twice: true, withExample: false }));
      const savedTts = await loadState("de:tts", { ...TTS });
      applyTts(savedTts);
      setTts(savedTts);
      const savedAi = await loadState("de:ai", { ...AI });
      applyAi(savedAi);
      setAi(savedAi);
      setReady(true);
    })();
  }, []);

  useEffect(() => { if (ready) saveState("de:known", known); }, [known, ready]);
  useEffect(() => { if (ready) saveState("de:studied", studied); }, [studied, ready]);
  useEffect(() => { if (ready) saveState("de:hw", history); }, [history, ready]);
  useEffect(() => { if (ready) saveState("de:level", level); }, [level, ready]);
  useEffect(() => { if (ready) saveState("de:voice", prefs); }, [prefs, ready]);
  useEffect(() => { if (ready) saveState("de:tts", tts); }, [tts, ready]);
  useEffect(() => { if (ready) saveState("de:ai", ai); }, [ai, ready]);
  useEffect(() => { stopSpeak(); }, [tab]);

  const totalWords = DECKS.reduce((s, d) => s + d.words.length, 0);
  const knownCount = Object.keys(known).length;

  const tabs = [
    { id: "cards", label: "Карточки" },
    { id: "voice", label: "Голос" },
    { id: "grammar", label: "Грамматика" },
    { id: "chat", label: "Разговор" },
    { id: "hw", label: "Домашка" },
  ];

  return (
    <div style={{ background: T.paper, minHeight: "100vh", color: T.ink }}>
      <div className="mx-auto flex flex-col" style={{ maxWidth: 440, minHeight: "100vh", background: T.paper }}>
        <div className="px-5 pt-5 pb-2 flex items-baseline justify-between">
          <span style={{ fontFamily: SERIF, fontSize: 17, color: T.ink }}>Mein Deutsch</span>
          <span style={{ fontFamily: SANS, fontSize: 12, color: T.muted }}>{knownCount}/{totalWords} слов · {Object.keys(studied).length}/{GRAMMAR.length} тем</span>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ paddingBottom: 8 }}>
          {tab === "cards" && <Cards known={known} setKnown={setKnown} />}
          {tab === "voice" && <Voice known={known} setKnown={setKnown} prefs={prefs} setPrefs={setPrefs} tts={tts} setTts={setTts} />}
          {tab === "grammar" && (
            <Grammar
              studied={studied}
              setStudied={setStudied}
              goChat={(l) => { setTopic(l); setMsgs([]); setTab("chat"); }}
              goHw={(l) => { setTopic(l); setTab("hw"); }}
            />
          )}
          {tab === "chat" && <Chat topic={topic} setTopic={setTopic} level={level} setLevel={setLevel} msgs={msgs} setMsgs={setMsgs} ai={ai} setAi={setAi} />}
          {tab === "hw" && <Homework topic={topic} setTopic={setTopic} level={level} history={history} setHistory={setHistory} ai={ai} setAi={setAi} />}
        </div>

        <div className="flex" style={{ borderTop: `1px solid ${T.rule}`, background: T.card }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 py-3"
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                color: tab === t.id ? T.petrol : T.muted,
                borderTop: `2px solid ${tab === t.id ? T.petrol : "transparent"}`,
                background: "transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================= ЗАПУСК ================================= */
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
