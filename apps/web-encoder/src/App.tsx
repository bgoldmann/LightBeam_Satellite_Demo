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
    scanHelp: "Open LightBeam and point your camera at this code",
    loopHelp:
      "QR codes loop continuously. If the phone misses a code, it will catch it on the next pass.",
    loopStatus: "Loop {n} · {pct}% of cycle",
    generatePreview: "Start looping preview",
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
    scanHelp: "برای دریافت فایل، دوربین را روبه‌روی تصویر تلویزیون ثابت نگه دارید",
    loopHelp:
      "کدهای QR به‌صورت حلقه‌ای تکرار می‌شوند. اگر کدی از دست برود، در دور بعدی گرفته می‌شود.",
    loopStatus: "حلقه {n} · {pct}٪ از دوره",
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
  const [profile, setProfile] = useState<ProfileId>("satellite_safe");
  const [loops, setLoops] = useState(5);
  const [session, setSession] = useState<EncodeSession | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishCatalog, setPublishCatalog] = useState(false);
  const [loopUi, setLoopUi] = useState({ index: 0, pct: 0 });
  const previewTimer = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewBusy = useRef(false);

  const fileMeta = useMemo(() => {
    if (!file || !fileBytes) return null;
    return {
      name: file.name,
      type: file.type || "application/octet-stream",
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
        mimeType: file.type || "application/octet-stream",
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
  }, []);

  const startPreview = useCallback(async () => {
    if (!session) return;
    stopPreview();
    setStep("preview");
    previewBusy.current = false;
    const tick = async () => {
      if (previewBusy.current) return;
      previewBusy.current = true;
      try {
        const url = await session.nextQrDataUrl({ looping: true });
        setPreviewUrl(url);
        setLoopUi({
          index: session.loopIndex() + 1,
          pct: Math.round(session.loopProgress() * 100),
        });
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const img = new Image();
            img.onload = () => {
              session.drawBroadcastFrame(ctx, img, session.loopProgress());
            };
            img.src = url;
          }
        }
      } catch (e) {
        console.error(e);
        stopPreview();
      } finally {
        previewBusy.current = false;
      }
    };
    await tick();
    const interval = (1000 / session.profile.fps) * session.profile.holdFrames;
    previewTimer.current = window.setInterval(tick, Math.max(80, interval));
  }, [session, stopPreview]);

  useEffect(() => () => stopPreview(), [stopPreview]);

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
          mimeType: file!.type || "application/octet-stream",
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

        let catalogLine = t.catalogSkip;
        if (publishCatalog && isSupabaseConfigured) {
          const pub = await publishTransmissionMetadata({
            shortCode: fresh.info.shortCode,
            title,
            publisherName: publisher,
            filename: file!.name,
            mimeType: file!.type || "application/octet-stream",
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
              {t.loopStatus.replace("{n}", String(loopUi.index)).replace("{pct}", String(loopUi.pct))}
              {info ? ` · ${info.loopFrameCount} QR / loop` : ""}
            </p>
            <canvas ref={canvasRef} width={1920} height={1080} className="broadcast-canvas" />
            {previewUrl && <img src={previewUrl} alt="QR" className="qr-thumb" />}
            <p className="hint">{t.exportHint}</p>
            <div className="actions">
              <button type="button" className="ghost" onClick={stopPreview}>
                {t.stopPreview}
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
