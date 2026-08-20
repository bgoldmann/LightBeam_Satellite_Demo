import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EncodeSession,
  PROFILES,
  verificationReport,
  type ProfileId,
  type SessionInfo,
} from "./lib/encoder";
import {
  downloadBlob,
  downloadText,
  exportBroadcastVideo,
  PHONE_SAFE_FFMPEG,
  type ExportFormat,
} from "./lib/exportVideo";
import { isSupabaseConfigured, publishTransmissionMetadata } from "./lib/supabase";
import { LoopingQrPlayout, type PlayoutStatus } from "./lib/loopingPlayout";
import { resolveMimeType } from "./lib/mediaTypes";
import "./App.css";

type Step = "file" | "settings" | "estimate" | "preview" | "export";
type Lang = "en" | "fa";

const copy = {
  en: {
    brand: "LightBeam",
    tagline: "Optical broadcast file transfer",
    privacy: "Your file stays on this device. File bytes are never uploaded.",
    catalogOptIn: "Also publish metadata catalog entry (hash, title — not the file)",
    catalogOk: "Metadata published to catalog.",
    catalogSkip: "Catalog skipped (offline / not configured).",
    selectFile: "Select file",
    drop: "Drop a file here or click to browse",
    continue: "Continue",
    back: "Back",
    title: "Title",
    publisher: "Publisher",
    description: "Description",
    language: "Language",
    compression: "Compression",
    profile: "Broadcast profile",
    stopPreview: "Stop",
    export: "Export WebM",
    exportPhoneSafe: "Export H.264 MP4 (phone-safe)",
    exportHint:
      "Phone Decode Video works best with H.264 MP4. WebM is fine for preview; Android is best-effort for WebM.",
    offline: "No Internet connection is required on receivers.",
    scanHelp:
      "Open LightBeam and fill the camera with every QR on screen (Lab shows four at once)",
    loopHelp:
      "Each tick sends unique fountain symbols. Keep scanning until 100% — later codes cover misses.",
    loopStatus: "Pass {n} · {pct}%",
    generatePreview: "Start continuous QR stream",
  },
  fa: {
    brand: "لایت‌بیم",
    tagline: "انتقال فایل از طریق پخش نوری",
    privacy: "فایل روی همین دستگاه می‌ماند. بایت‌های فایل هرگز آپلود نمی‌شوند.",
    catalogOptIn: "ثبت فراداده در کاتالوگ (هش و عنوان — نه خود فایل)",
    catalogOk: "فراداده در کاتالوگ ثبت شد.",
    catalogSkip: "کاتالوگ رد شد (آفلاین / پیکربندی نشده).",
    selectFile: "انتخاب فایل",
    drop: "فایل را اینجا رها کنید یا برای انتخاب کلیک کنید",
    continue: "ادامه",
    back: "بازگشت",
    title: "عنوان",
    publisher: "ناشر",
    description: "توضیحات",
    language: "زبان",
    compression: "فشرده‌سازی",
    profile: "پروفایل پخش",
    stopPreview: "توقف",
    export: "خروجی WebM",
    exportPhoneSafe: "خروجی H.264 MP4 (سازگار با گوشی)",
    exportHint:
      "رمزگشایی ویدیو روی گوشی با H.264 MP4 بهترین نتیجه را می‌دهد. WebM برای پیش‌نمایش مناسب است.",
    offline: "گیرنده به اینترنت، وای‌فای یا بلوتوث نیاز ندارد.",
    scanHelp: "برای دریافت فایل، همهٔ کدهای روی تصویر را داخل کادر دوربین نگه دارید (حالت آزمایشگاهی چهار کد هم‌زمان نشان می‌دهد)",
    loopHelp:
      "جریان QR کدهای یکتا می‌فرستد. تا رسیدن پیشرفت به ۱۰۰٪ اسکن را ادامه دهید.",
    loopStatus: "دور {n} · {pct}٪",
    generatePreview: "شروع پیش‌نمایش حلقه‌ای",
  },
} as const;

export default function App() {
  const [lang, setLang] = useState<Lang>("en");
  const t = copy[lang];
  const rtl = lang === "fa";

  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [title, setTitle] = useState("");
  const [publisher, setPublisher] = useState("Goldmann LLC Demo");
  const [description, setDescription] = useState("");
  const [compress, setCompress] = useState(true);
  const [profile, setProfile] = useState<ProfileId>("lab");
  const [loops, setLoops] = useState(5);
  const [session, setSession] = useState<EncodeSession | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishCatalog, setPublishCatalog] = useState(false);
  const [loopUi, setLoopUi] = useState({ index: 0, pct: 0 });
  const [playoutStatus, setPlayoutStatus] = useState<PlayoutStatus | null>(null);
  const previewTimer = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playoutRef = useRef<LoopingQrPlayout | null>(null);

  const fileMeta = useMemo(() => {
    if (!file || !fileBytes) return null;
    return {
      name: file.name,
      type: resolveMimeType(file.name, file.type),
      size: fileBytes.length,
    };
  }, [file, fileBytes]);

  const onPick = useCallback(async (f: File) => {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) {
      alert("Phase 1 maximum is 25 MB");
      return;
    }
    setFile(f);
    setFileBytes(buf);
    setTitle(f.name.replace(/\.[^.]+$/, "") || "Transmission");
  }, []);

  const buildSession = useCallback(async () => {
    if (!file || !fileBytes) return;
    setBusy(true);
    try {
      const s = await EncodeSession.create(fileBytes, {
        title,
        publisherName: publisher,
        filename: file.name,
        mimeType: resolveMimeType(file.name, file.type),
        language: lang,
        description: description || undefined,
        compress,
        profile,
      });
      setSession(s);
      setInfo(s.info);
      setStep("estimate");
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }, [file, fileBytes, title, publisher, description, compress, profile, lang]);

  const stopPreview = useCallback(() => {
    if (previewTimer.current) {
      window.clearInterval(previewTimer.current);
      previewTimer.current = null;
    }
    void playoutRef.current?.stop();
    playoutRef.current = null;
  }, []);

  const drawFrame = useCallback((loopIndex: number, loopPct: number) => {
    setLoopUi({ index: loopIndex, pct: loopPct });
    const canvas = canvasRef.current;
    const sess = session;
    if (!canvas || !sess) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    sess.paintBroadcastTick(ctx, loopPct / 100, { looping: false });
  }, [session]);

  const startPreview = useCallback(async () => {
    if (!session) return;
    stopPreview();
    setStep("preview");
    const playout = new LoopingQrPlayout(session, {
      onStatus: setPlayoutStatus,
      onPaint: drawFrame,
    });
    playoutRef.current = playout;
    await playout.start();
  }, [session, stopPreview, drawFrame]);

  useEffect(() => () => stopPreview(), [stopPreview]);

  useEffect(() => {
    const onVis = () => {
      // Resume wake lock when tab becomes visible again during playout
      if (document.visibilityState === "visible" && playoutRef.current?.isRunning) {
        /* wake lock re-acquired inside playout tick */
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const doExport = useCallback(
    async (format: ExportFormat) => {
      if (!session || !info) return;
      setStep("export");
      setExportProgress("Preparing…");
      setBusy(true);
      try {
        const fresh = await EncodeSession.create(fileBytes!, {
          title,
          publisherName: publisher,
          filename: file!.name,
          mimeType: resolveMimeType(file!.name, file!.type),
          language: lang,
          description: description || undefined,
          compress,
          profile,
        });
        const { blob, mime, frameCount, note } = await exportBroadcastVideo(
          fresh,
          loops,
          (p) => {
            setExportProgress(`${p.phase}: ${p.current}/${p.total}`);
          },
          format,
        );
        const ext = mime.includes("mp4") ? "mp4" : "webm";
        const name =
          format === "phonesafe" && ext === "mp4"
            ? "transmission-phone-safe.mp4"
            : `transmission.${ext}`;
        downloadBlob(blob, name);
        downloadText(fresh.info.manifestJson, "transmission-manifest.json");
        downloadText(verificationReport(fresh.info), "verification-report.txt");
        downloadText(fresh.info.payloadHash + "  transmission\n", "checksum.sha256");

        let catalogLine: string = t.catalogSkip;
        if (publishCatalog && isSupabaseConfigured) {
          const pub = await publishTransmissionMetadata({
            shortCode: fresh.info.shortCode,
            title,
            publisherName: publisher,
            filename: file!.name,
            mimeType: resolveMimeType(file!.name, file!.type),
            payloadHash: fresh.info.payloadHash,
            originalLen: fresh.info.originalLen,
            encodedLen: fresh.info.encodedLen,
            blockCount: fresh.info.blockCount,
            blockSize: fresh.info.blockSize,
            profileId: profile,
            language: lang,
            description: description || undefined,
          });
          catalogLine = pub.ok ? t.catalogOk : `${t.catalogSkip} (${pub.error})`;
        }

        setExportProgress(
          `Exported ${frameCount} frames (${name}). ${note ?? ""}\n${catalogLine}\nFallback: ${PHONE_SAFE_FFMPEG}`,
        );
        setInfo(fresh.info);
        setSession(fresh);
      } catch (e) {
        setExportProgress(String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      session,
      info,
      fileBytes,
      title,
      publisher,
      file,
      lang,
      description,
      compress,
      profile,
      loops,
      publishCatalog,
      t.catalogOk,
      t.catalogSkip,
    ],
  );

  return (
    <div className={`app ${rtl ? "rtl" : ""}`} dir={rtl ? "rtl" : "ltr"}>
      <header className="hero">
        <div className="hero-bg" />
        <div className="hero-inner">
          <p className="brand">{t.brand}</p>
          <p className="tagline">{t.tagline}</p>
          <p className="offline-pill">{t.offline}</p>
          <div className="lang-toggle">
            <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
              EN
            </button>
            <button type="button" className={lang === "fa" ? "active" : ""} onClick={() => setLang("fa")}>
              فارسی
            </button>
          </div>
        </div>
      </header>

      <nav className="steps">
        {(["file", "settings", "estimate", "preview", "export"] as Step[]).map((s) => (
          <span key={s} className={step === s ? "on" : ""}>
            {s}
          </span>
        ))}
      </nav>

      <main className="panel">
        {step === "file" && (
          <section>
            <h2>{t.selectFile}</h2>
            <p className="privacy">{t.privacy}</p>
            <label className="dropzone">
              <input
                type="file"
                hidden
                onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
              />
              <span>{t.drop}</span>
            </label>
            {fileMeta && (
              <div className="meta">
                <div>
                  <strong>{fileMeta.name}</strong>
                </div>
                <div>{fileMeta.type}</div>
                <div>{(fileMeta.size / 1024).toFixed(1)} KB</div>
              </div>
            )}
            <button type="button" disabled={!file} onClick={() => setStep("settings")}>
              {t.continue}
            </button>
          </section>
        )}

        {step === "settings" && (
          <section className="form">
            <h2>Package settings</h2>
            <label>
              {t.title}
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              {t.publisher}
              <input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            </label>
            <label>
              {t.description}
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </label>
            <label className="row">
              <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />
              {t.compression} (deflate when smaller)
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={publishCatalog}
                onChange={(e) => setPublishCatalog(e.target.checked)}
                disabled={!isSupabaseConfigured}
              />
              {t.catalogOptIn}
              {!isSupabaseConfigured ? " (Supabase env missing)" : ""}
            </label>
            <label>
              {t.profile}
              <select value={profile} onChange={(e) => setProfile(e.target.value as ProfileId)}>
                {Object.values(PROFILES).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{PROFILES[profile].description}</p>
            <label>
              Loop count (exported video repeats the full QR cycle)
              <input
                type="number"
                min={1}
                max={20}
                value={loops}
                onChange={(e) => setLoops(Number(e.target.value))}
              />
            </label>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setStep("file")}>
                {t.back}
              </button>
              <button type="button" disabled={busy} onClick={buildSession}>
                {busy ? "…" : t.continue}
              </button>
            </div>
          </section>
        )}

        {step === "estimate" && info && (
          <section>
            <h2>Estimate</h2>
            <dl className="estimate">
              <div>
                <dt>Original</dt>
                <dd>{(info.originalLen / 1024).toFixed(1)} KB</dd>
              </div>
              <div>
                <dt>Encoded</dt>
                <dd>{(info.encodedLen / 1024).toFixed(1)} KB</dd>
              </div>
              <div>
                <dt>Blocks</dt>
                <dd>
                  {info.blockCount} × {info.blockSize}
                </dd>
              </div>
              <div>
                <dt>Symbols / cycle</dt>
                <dd>~{info.estimatedSymbols}</dd>
              </div>
              <div>
                <dt>Runtime / cycle</dt>
                <dd>~{info.estimatedRuntimeSec}s</dd>
              </div>
              <div>
                <dt>Codes / frame</dt>
                <dd>{session?.profile.tiles ?? 1}</dd>
              </div>
              <div>
                <dt>QR / loop</dt>
                <dd>{info.loopFrameCount}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{info.shortCode}</dd>
              </div>
            </dl>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setStep("settings")}>
                {t.back}
              </button>
              <button type="button" onClick={startPreview}>
                {t.generatePreview}
              </button>
            </div>
          </section>
        )}

        {step === "preview" && (
          <section className="preview">
            <h2>Preview & test</h2>
            <p>{t.scanHelp}</p>
            <p className="hint">{t.loopHelp}</p>
            <p className="progress">
              {playoutStatus?.phase === "preparing"
                ? playoutStatus.message
                : `${t.loopStatus.replace("{n}", String(loopUi.index)).replace("{pct}", String(loopUi.pct))}${
                    info ? ` · ${info.loopFrameCount} QR / loop` : ""
                  }`}
            </p>
            {playoutStatus?.phase === "error" && (
              <p className="hint" style={{ color: "#f87171" }}>
                {playoutStatus.message}
              </p>
            )}
            <canvas ref={canvasRef} width={1920} height={1080} className="broadcast-canvas" />
            <p className="hint">{t.exportHint}</p>
            <div className="actions">
              <button type="button" className="ghost" onClick={stopPreview}>
                {t.stopPreview}
              </button>
              <button
                type="button"
                disabled={busy || playoutStatus?.phase === "preparing"}
                onClick={() => void startPreview()}
              >
                Restart loop
              </button>
              <button type="button" disabled={busy} onClick={() => doExport("webm")}>
                {t.export}
              </button>
              <button type="button" disabled={busy} onClick={() => doExport("phonesafe")}>
                {t.exportPhoneSafe}
              </button>
            </div>
          </section>
        )}

        {step === "export" && (
          <section>
            <h2>Export</h2>
            <p className="hint">{t.exportHint}</p>
            <p className="progress" style={{ whiteSpace: "pre-wrap" }}>
              {exportProgress}
            </p>
            <div className="actions">
              <button type="button" disabled={busy} onClick={() => doExport("webm")}>
                {t.export}
              </button>
              <button type="button" disabled={busy} onClick={() => doExport("phonesafe")}>
                {t.exportPhoneSafe}
              </button>
            </div>
            {info && (
              <pre className="manifest">{info.manifestJson.slice(0, 800)}…</pre>
            )}
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  stopPreview();
                  setStep("file");
                  setSession(null);
                  setInfo(null);
                  setFile(null);
                  setFileBytes(null);
                }}
              >
                New transmission
              </button>
            </div>
          </section>
        )}
      </main>

      <footer>
        <small>LBOP/1 · Phase 1 Satellite Demo · Local processing only</small>
      </footer>
    </div>
  );
}
