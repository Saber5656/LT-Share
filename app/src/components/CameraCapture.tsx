import { useEffect, useRef, useState } from "react";
import { ArrowsClockwiseIcon, CameraRotateIcon, ImagesIcon, XIcon } from "@phosphor-icons/react";
import { Sheet } from "./chrome.tsx";
import type { MediaKind } from "../lib/draft.ts";

/** A live preview avoids delegating capture to the opaque native file-picker camera. */
export function CameraCapture({ kind, onClose, onFile, onLibrary }: {
  kind: MediaKind;
  onClose: () => void;
  onFile: (file: File) => void;
  onLibrary: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    setReady(false); setError("");
    const element = video.current!;
    const release = () => {
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = null;
      element.srcObject = null;
    };
    const fail = (message: string) => {
      if (cancelled) return;
      cancelled = true;
      setError(message); setReady(false); release();
    };
    const timer = window.setTimeout(() => fail("カメラの映像を取得できませんでした。他のカメラを閉じて再試行するか、写真・動画を選んでください。"), 15000);
    const loaded = () => {
      if (cancelled || !element.videoWidth || !element.videoHeight) return;
      clearTimeout(timer); setReady(true);
    };
    element.addEventListener("loadeddata", loaded);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        if (kind === "video" && typeof MediaRecorder === "undefined") throw new Error("recorder");
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: kind === "video",
        });
        if (cancelled) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream.current = acquired;
        element.srcObject = acquired;
        acquired.getVideoTracks().forEach(track => track.addEventListener("ended", () => fail("カメラとの接続が切れました。再試行してください。"), { once: true }));
        await element.play();
        loaded();
      } catch (e) {
        const denied = e instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(e.name);
        fail(denied
          ? `カメラ${kind === "video" ? "・マイク" : ""}の許可が必要です。ブラウザの設定で許可して再試行するか、写真・動画を選んでください。`
          : "カメラを起動できませんでした。他のカメラを閉じて再試行するか、写真・動画を選んでください。");
      }
    })();
    const hidden = () => { if (document.hidden) onClose(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelled = true; alive.current = false; clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
      element.removeEventListener("loadeddata", loaded);
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      recorder.current = null;
      release();
    };
    // onClose is the parent state setter; reacquire only for an explicit retry or flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, facing, attempt]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => { if (recording && seconds >= 180) recorder.current?.stop(); }, [recording, seconds]);

  const takePhoto = async () => {
    if (!ready || busy.current || !video.current) return;
    busy.current = true; setWorking(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.current.videoWidth; canvas.height = video.current.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas");
      context.drawImage(video.current, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("image")), "image/jpeg", 0.92));
      if (alive.current) onFile(new File([blob], `lt-photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
    } catch { if (alive.current) setError("撮影できませんでした。もう一度お試しください。"); }
    finally { busy.current = false; if (alive.current) setWorking(false); }
  };
  const startRecording = () => {
    if (!ready || busy.current || !stream.current) return;
    busy.current = true;
    try {
      const mime = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find(value => MediaRecorder.isTypeSupported(value));
      const next = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      let bytes = 0;
      let failed = false;
      next.ondataavailable = event => {
        bytes += event.data.size;
        if (bytes > 60 * 1024 * 1024) {
          failed = true;
          if (next.state !== "inactive") next.stop();
          if (alive.current) setError("動画が60MBを超えました。短く撮り直すか、写真・動画を選んでください。");
        } else if (event.data.size) chunks.push(event.data);
      };
      next.onerror = () => { failed = true; if (alive.current) { setError("録画できませんでした。再試行してください。"); setRecording(false); busy.current = false; } };
      next.onstop = () => {
        if (!alive.current) return;
        busy.current = false; setRecording(false); setWorking(false);
        if (failed || !chunks.length) return;
        const type = next.mimeType || chunks[0]!.type;
        onFile(new File(chunks, `lt-video-${Date.now()}.${type.includes("mp4") ? "mp4" : "webm"}`, { type }));
      };
      recorder.current = next;
      next.start(1000); setSeconds(0); setRecording(true);
    } catch { busy.current = false; setError("このブラウザでは録画を開始できません。写真・動画を選んでください。"); }
  };
  const chooseLibrary = () => {
    stream.current?.getTracks().forEach(track => track.stop());
    onLibrary(); // Preserve synchronous user activation for the file picker.
  };

  return <Sheet open onClose={onClose} title={kind === "photo" ? "写真を撮る" : "動画を撮る"}>
    <div className="camera-capture">
      <div className="camera-toolbar">
        <button type="button" className="text-button" onClick={onClose}><XIcon size={20} aria-hidden="true" />閉じる</button>
        <button type="button" className="text-button" disabled={recording || working} onClick={() => setFacing(value => value === "environment" ? "user" : "environment")} aria-label="カメラを切り替える"><CameraRotateIcon size={24} aria-hidden="true" /></button>
      </div>
      <div className="camera-preview">
        <video ref={video} autoPlay playsInline muted aria-label="カメラの映像" />
        {!ready && !error ? <p className="camera-loading" role="status">カメラを起動しています…</p> : null}
        {recording ? <span className="camera-timer" role="status">録画中 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span> : null}
      </div>
      {error ? <div className="camera-error" role="alert"><p>{error}</p><button type="button" className="outline-button" onClick={() => setAttempt(value => value + 1)} disabled={recording || working}><ArrowsClockwiseIcon size={18} aria-hidden="true" />再試行</button></div> : null}
      <button type="button" className={`primary-button camera-shutter${recording ? " is-recording" : ""}`} disabled={!ready || working} onClick={kind === "photo" ? () => void takePhoto() : recording ? () => { setWorking(true); recorder.current?.stop(); } : startRecording}>
        {working ? "取り込み中…" : kind === "photo" ? "撮影する" : recording ? "録画を停止" : "録画を開始"}
      </button>
      {kind === "video" ? <p className="hint is-center">最大3分・60MB。画面を離れると録画は取り消されます。</p> : null}
      <button type="button" className="outline-button library-button" disabled={recording || working} onClick={chooseLibrary}><ImagesIcon size={20} aria-hidden="true" />写真・動画を選ぶ</button>
    </div>
  </Sheet>;
}
