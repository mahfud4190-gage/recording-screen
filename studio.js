"use strict";

const byId = (id) => document.getElementById(id);
const canvas = byId("canvas");
const drawing = canvas.getContext("2d", { alpha: false });
const screenVideo = byId("screen-video");
const cameraVideo = byId("camera-video");
const fileVideo = byId("file-video");
const playback = byId("playback");
const source = byId("source");
const overlay = byId("overlay");
const camera = byId("camera");
const mic = byId("mic");
const media = byId("media");
const prepareButton = byId("prepare");
const recordButton = byId("record");
const releaseButton = byId("release");
const pauseButton = byId("pause");
const displayCapture = typeof navigator.mediaDevices?.getDisplayMedia === "function";
const userCapture = typeof navigator.mediaDevices?.getUserMedia === "function";
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const canRecord = typeof MediaRecorder === "function" && typeof canvas.captureStream === "function";
const lockedSettings = [source, byId("file"), byId("quality"), overlay, camera, mic, media];
const states = { idle: "Siaga", loading: "Menyiapkan", ready: "Siap", recording: "Merekam", paused: "Jeda", finishing: "Menyimpan" };
const sourceHints = {
  screen: "Pilih layar, jendela, atau tab dari dialog browser. Untuk audio tab, aktifkan Bagikan audio tab.",
  file: "Gunakan video dari perangkat, termasuk hasil perekam layar bawaan HP. Video mulai dari awal saat perekaman dimulai.",
  camera: "Rekam langsung dari kamera yang dipilih."
};

let phase = "idle";
let session = null;
let audioContext;
let fileAudioNode;
let recordingUrl;
let recordingDownloaded = true;

function announce(message, warning = false) {
  byId("message").textContent = message;
  byId("message").dataset.tone = warning ? "warning" : "normal";
}

function updateUI() {
  const ready = phase === "ready";
  const active = phase === "recording" || phase === "paused";
  const cameraOnly = source.value === "camera";
  const locked = phase !== "idle";
  const hasOverlay = !cameraOnly && overlay.checked && userCapture;
  byId("state").textContent = states[phase];
  byId("state").dataset.state = phase;
  const unavailable = displayCapture ? "" : "Perekaman layar langsung tidak tersedia di browser ini. ";
  byId("source-hint").textContent = unavailable + sourceHints[source.value];
  byId("file-field").hidden = source.value !== "file";
  byId("overlay-controls").hidden = !hasOverlay;
  for (const control of lockedSettings) control.disabled = locked;
  overlay.disabled = locked || cameraOnly || !userCapture;
  camera.disabled = locked || (!cameraOnly && !hasOverlay);
  mic.disabled = locked || !userCapture || !AudioContextClass;
  media.disabled = locked || cameraOnly || !AudioContextClass;
  byId("mic-volume").disabled = !mic.checked || !userCapture || !AudioContextClass;
  byId("media-volume").disabled = !media.checked || cameraOnly || !AudioContextClass;
  prepareButton.hidden = ready || active || phase === "finishing";
  prepareButton.disabled = !canRecord || !window.isSecureContext || locked;
  releaseButton.hidden = !ready;
  pauseButton.hidden = !active;
  pauseButton.textContent = phase === "paused" ? "Lanjutkan" : "Jeda";
  recordButton.disabled = !ready && !active;
  recordButton.classList.toggle("stop", active);
  byId("record-label").textContent = active ? "Stop rekam" : "Mulai rekam";
  canvas.hidden = !ready && !active && phase !== "finishing";
  byId("empty").hidden = !canvas.hidden;
}

function setPhase(next) {
  phase = next;
  updateUI();
}

function updateTimer(ms = 0) {
  const seconds = Math.floor(ms / 1000);
  byId("timer").textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
}

function elapsed(current) {
  return current.elapsed + (current.startedAt === null ? 0 : performance.now() - current.startedAt);
}

function connectVideo(video, stream) {
  video.srcObject = stream;
  return video.play();
}

function loadFile(video, url) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const { signal } = controller;
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Video terlalu lama dimuat. Coba file lain atau nonaktifkan penghemat data browser."));
    }, 15000);
    function complete() {
      clearTimeout(timeout);
      controller.abort();
    }
    video.addEventListener("loadeddata", () => { complete(); resolve(); }, { once: true, signal });
    video.addEventListener("error", () => {
      complete();
      reject(new Error("File video tidak bisa dibuka. Coba file MP4 (H.264/AAC) atau WebM yang didukung browser."));
    }, { once: true, signal });
    video.src = url;
    video.load();
  });
}

function keepStream(current, stream) {
  current.streams.push(stream);
  return stream;
}

function addAudio(current, key, node) {
  const gain = audioContext.createGain();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  node.connect(gain);
  gain.connect(analyser);
  analyser.connect(current.audioMix);
  current.audio[key] = { node, gain, analyser, samples: new Float32Array(analyser.fftSize) };
  updateGain(key);
}

function updateGain(key) {
  const channel = session?.audio[key];
  if (channel) channel.gain.gain.value = Number(byId(key + "-volume").value) / 100;
}

function describeAudio(current) {
  const micStatus = current.audio.mic ? "Mikrofon aktif." : "Mikrofon nonaktif.";
  let mediaStatus = "Audio media nonaktif.";
  if (current.audio.media) {
    mediaStatus = current.source === "file" ? "Audio file diproses saat video berjalan." :
      current.mediaTrack.readyState === "live" ? "Audio media tersambung." : "Audio media terputus.";
  } else if (current.wantsMedia) {
    mediaStatus = "Audio media tidak diterima. Buka ulang pratinjau dan pilih sumber yang mengizinkan berbagi audio.";
  }
  byId("audio-status").textContent = micStatus + " " + mediaStatus;
}

function updateMeters(current) {
  for (const key of ["mic", "media"]) {
    const channel = current.audio[key];
    let level = 0;
    if (channel) {
      channel.analyser.getFloatTimeDomainData(channel.samples);
      for (const value of channel.samples) level += value * value;
      level = Math.min(1, Math.sqrt(level / channel.samples.length) * 3);
    }
    byId(key + "-meter").value = level;
  }
}

function setCanvasSize(video, limit) {
  const { videoWidth: width, videoHeight: height } = video;
  if (!width || !height) throw new Error("Sumber video belum menghasilkan gambar.");
  const portrait = height > width;
  const shortLimit = limit;
  const longLimit = Math.round(limit * 16 / 9);
  const ratio = Math.min(1, (portrait ? shortLimit : longLimit) / width, (portrait ? longLimit : shortLimit) / height);
  canvas.width = Math.max(2, Math.floor(width * ratio / 2) * 2);
  canvas.height = Math.max(2, Math.floor(height * ratio / 2) * 2);
}

function drawVideo(video, x, y, width, height, cover = false, mirror = false) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  const widthScale = width / video.videoWidth;
  const heightScale = height / video.videoHeight;
  const scale = cover ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale);
  const scaledWidth = video.videoWidth * scale;
  const scaledHeight = video.videoHeight * scale;
  drawing.save();
  drawing.translate(x + width / 2, y + height / 2);
  if (mirror) drawing.scale(-1, 1);
  drawing.drawImage(video, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
  drawing.restore();
}

function overlayPath(x, y, width, height, radius) {
  drawing.beginPath();
  if (typeof drawing.roundRect === "function") drawing.roundRect(x, y, width, height, radius);
  else drawing.rect(x, y, width, height);
}

function drawFrame(current) {
  const { width, height } = canvas;
  drawing.fillStyle = "#0b0e10";
  drawing.fillRect(0, 0, width, height);
  drawVideo(current.mainVideo, 0, 0, width, height, false, current.source === "camera" && current.mirror);
  if (current.overlay && current.cameraTrack?.readyState === "live" && cameraVideo.readyState >= 2) {
    const size = Math.round(width * Number(byId("size").value));
    const boxHeight = Math.round(size * 0.75);
    const inset = Math.round(Math.min(width, height) * 0.025);
    const corner = byId("corner").value;
    const x = corner.endsWith("l") ? inset : width - size - inset;
    const y = corner.startsWith("t") ? inset : height - boxHeight - inset;
    const radius = Math.max(3, Math.round(size * 0.06));
    drawing.save();
    overlayPath(x, y, size, boxHeight, radius);
    drawing.clip();
    drawVideo(cameraVideo, x, y, size, boxHeight, true, current.mirror);
    drawing.restore();
    overlayPath(x, y, size, boxHeight, radius);
    drawing.lineWidth = Math.max(2, Math.round(width * 0.0025));
    drawing.strokeStyle = "#eff7eb";
    drawing.stroke();
  }
}

function onSourceEnded(current, reason) {
  if (session !== current) return;
  if (phase === "loading") {
    current.endedReason = reason;
  } else if (phase === "ready") {
    cleanup(current);
    setPhase("idle");
    announce(reason, true);
  } else if (phase === "recording" || phase === "paused") {
    stopRecording(reason);
  }
}

function watchVideoTrack(current, track, primary) {
  track.addEventListener("ended", () => {
    if (primary) onSourceEnded(current, "Sumber video berhenti.");
    else if (session === current) announce("Kamera overlay terputus. Sumber utama tetap berjalan.", true);
  }, { once: true });
}

function cleanup(current) {
  clearInterval(current.frameClock);
  clearInterval(current.uiClock);
  current.events.abort();
  for (const stream of current.streams) for (const track of stream.getTracks()) track.stop();
  for (const channel of Object.values(current.audio)) {
    channel.node.disconnect(channel.gain);
    channel.gain.disconnect();
    channel.analyser.disconnect();
  }
  current.audioMix?.disconnect();
  screenVideo.srcObject = null;
  cameraVideo.srcObject = null;
  fileVideo.pause();
  fileVideo.removeAttribute("src");
  fileVideo.load();
  if (current.fileUrl) URL.revokeObjectURL(current.fileUrl);
  byId("audio-status").textContent = "Status audio muncul setelah pratinjau siap.";
  for (const key of ["mic", "media"]) byId(key + "-meter").value = 0;
  if (session === current) session = null;
}

function explainError(error, step) {
  switch (error.name) {
    case "NotAllowedError":
      return step === "layar" ? "Pemilihan layar dibatalkan atau diblokir. Coba pilih sumber lagi." : "Izin " + step + " ditolak. Izinkan melalui pengaturan situs atau nonaktifkan opsi tersebut.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Perangkat atau sumber " + step + " yang dipilih tidak tersedia.";
    case "NotReadableError":
      return "Sumber " + step + " tidak bisa diakses. Periksa izin sistem dan apakah perangkat sedang dipakai aplikasi lain.";
    default:
      return error.message || "Terjadi kesalahan saat menyiapkan " + step + ".";
  }
}

async function prepare() {
  if (phase !== "idle") return;
  const file = byId("file").files[0];
  if (source.value === "file" && !file) {
    announce("Pilih file video terlebih dahulu.", true);
    byId("file").focus();
    return;
  }
  const current = {
    source: source.value, overlay: source.value !== "camera" && overlay.checked && userCapture,
    wantsMedia: media.checked && source.value !== "camera" && Boolean(AudioContextClass),
    wantsMic: mic.checked && userCapture && Boolean(AudioContextClass),
    streams: [], audio: {}, events: new AbortController(), elapsed: 0, startedAt: null
  };
  session = current;
  setPhase("loading");
  updateTimer();
  announce("Menyiapkan sumber dan meminta izin perangkat.");
  let step = "layar";
  try {
    // Request screen capture before any await so the browser sees the button's user activation.
    const capture = current.source === "screen" ? navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: current.wantsMedia,
      ...(current.wantsMedia ? { systemAudio: "include" } : {})
    }) : null;

    if (current.wantsMedia || current.wantsMic || (current.source === "file" && AudioContextClass)) {
      try {
        audioContext ||= new AudioContextClass();
        // Resume immediately in the click handler, then check again before starting the recorder.
        audioContext.resume().catch(() => {});
      } catch (error) {
        // A pending screen picker can still return a stream. Stop it if setup cannot continue.
        capture?.then((stream) => stream.getTracks().forEach((track) => track.stop()), () => {});
        throw error;
      }
    }

    let screenStream;
    if (capture) {
      screenStream = keepStream(current, await capture);
      watchVideoTrack(current, screenStream.getVideoTracks()[0], true);
      current.mainVideo = screenVideo;
      await connectVideo(screenVideo, screenStream);
    }

    if (current.source === "file") {
      step = "file video";
      current.fileUrl = URL.createObjectURL(file);
      current.mainVideo = fileVideo;
      if (audioContext && !fileAudioNode) fileAudioNode = audioContext.createMediaElementSource(fileVideo);
      fileVideo.muted = !fileAudioNode;
      await loadFile(fileVideo, current.fileUrl);
      fileVideo.addEventListener("ended", () => onSourceEnded(current, "Video sumber selesai."), { signal: current.events.signal });
      fileVideo.addEventListener("error", () => onSourceEnded(current, "Pemutaran video sumber terhenti."), { signal: current.events.signal });
    }

    if (current.overlay || current.source === "camera") {
      step = "kamera";
      const rear = camera.value === "rear";
      const facingMode = rear ? { exact: "environment" } : { ideal: "user" };
      const cameraStream = keepStream(current, await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false
      }));
      current.cameraTrack = cameraStream.getVideoTracks()[0];
      current.mirror = (current.cameraTrack.getSettings().facingMode || (rear ? "environment" : "user")) === "user";
      watchVideoTrack(current, current.cameraTrack, current.source === "camera");
      await connectVideo(cameraVideo, cameraStream);
      if (current.source === "camera") current.mainVideo = cameraVideo;
    }

    if (current.wantsMic || current.wantsMedia) {
      step = "audio";
      current.audioOutput = audioContext.createMediaStreamDestination();
      current.audioMix = audioContext.createDynamicsCompressor();
      current.audioMix.threshold.value = -8;
      current.audioMix.ratio.value = 12;
      current.audioMix.connect(current.audioOutput);
      current.streams.push(current.audioOutput.stream);
      if (current.wantsMic) {
        step = "mikrofon";
        const micStream = keepStream(current, await navigator.mediaDevices.getUserMedia({
          video: false, audio: { echoCancellation: true, noiseSuppression: true }
        }));
        addAudio(current, "mic", audioContext.createMediaStreamSource(micStream));
        micStream.getAudioTracks()[0].addEventListener("ended", () => {
          if (session === current) {
            byId("audio-status").textContent = "Mikrofon terputus.";
            announce("Mikrofon terputus. Sumber video tetap berjalan.", true);
          }
        }, { signal: current.events.signal });
      }
      if (current.wantsMedia && current.source === "file") addAudio(current, "media", fileAudioNode);
      if (current.wantsMedia && screenStream) {
        current.mediaTrack = screenStream.getAudioTracks()[0];
        if (current.mediaTrack?.readyState === "live") {
          addAudio(current, "media", audioContext.createMediaStreamSource(new MediaStream([current.mediaTrack])));
          current.mediaTrack.addEventListener("ended", () => {
            if (session === current) describeAudio(current);
          }, { signal: current.events.signal });
        }
      }
    }

    if (current.endedReason) throw new Error(current.endedReason);
    setCanvasSize(current.mainVideo, Number(byId("quality").value));
    drawFrame(current);
    current.frameClock = setInterval(() => drawFrame(current), 1000 / 30);
    current.uiClock = setInterval(() => {
      updateMeters(current);
      if (current.recorder) updateTimer(elapsed(current));
    }, 100);
    describeAudio(current);
    setPhase("ready");
    const missing = current.wantsMedia && !current.audio.media;
    announce(missing ? "Video siap. Audio media tidak diterima dari sumber yang dipilih." : "Pratinjau siap. Tekan Mulai rekam untuk menyimpan komposisi ini.", missing);
  } catch (error) {
    cleanup(current);
    setPhase("idle");
    announce(explainError(error, step), true);
  }
}

function makeRecorder(stream, hasAudio) {
  const candidates = hasAudio ?
    ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"] :
    ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/mp4", "video/webm"];
  for (const mimeType of candidates) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: canvas.height > 720 || canvas.width > 1280 ? 6_000_000 : 3_500_000 });
    } catch (error) {
      if (error.name !== "NotSupportedError") throw error;
    }
  }
  return new MediaRecorder(stream);
}

async function startRecording() {
  const current = session;
  if (recordingUrl && !recordingDownloaded &&
      !window.confirm("Rekaman sebelumnya belum diunduh. Ganti setelah rekaman baru selesai?")) return;
  setPhase("loading");
  playback.pause();
  let stream;
  try {
    const hasAudio = Boolean(current.audio.mic || current.audio.media);
    const resumeAudio = hasAudio ? audioContext.resume() : undefined;
    // Observe a rejection even if recorder creation fails before the await below.
    resumeAudio?.catch(() => {});
    if (current.endedReason) throw new Error(current.endedReason);
    drawFrame(current);
    stream = keepStream(current, canvas.captureStream(30));
    if (hasAudio) stream.addTrack(current.audioOutput.stream.getAudioTracks()[0]);
    const recorder = makeRecorder(stream, hasAudio);
    const chunks = [];
    current.recorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      current.stopReason = "Perekam mengalami gangguan.";
      fileVideo.pause();
      setPhase("finishing");
    });
    recorder.addEventListener("stop", () => finish(current, chunks), { once: true });
    recorder.start(500);
    current.startedAt = performance.now();
    setPhase("recording");
    announce(current.wantsMedia && !current.audio.media ?
      "Sedang merekam. Audio media tidak tersambung." : "Sedang merekam. Biarkan halaman ini tetap terbuka.",
    current.wantsMedia && !current.audio.media);
    await Promise.all([resumeAudio, current.source === "file" ? fileVideo.play() : undefined]);
  } catch (error) {
    if (session !== current || phase === "finishing") return;
    if (current.recorder && current.recorder.state !== "inactive") {
      stopRecording(explainError(error, "video"));
    } else {
      cleanup(current);
      setPhase("idle");
      announce(explainError(error, "rekaman"), true);
    }
  }
}

function freezeTimer(current) {
  current.elapsed = elapsed(current);
  current.startedAt = null;
  updateTimer(current.elapsed);
}

async function togglePause() {
  const current = session;
  const recorder = current.recorder;
  if (phase === "recording") {
    recorder.pause();
    fileVideo.pause();
    freezeTimer(current);
    setPhase("paused");
    announce("Rekaman dijeda.");
  } else if (phase === "paused") {
    recorder.resume();
    current.startedAt = performance.now();
    setPhase("recording");
    announce("Rekaman dilanjutkan.");
    if (current.source === "file") {
      try {
        await fileVideo.play();
      } catch (error) {
        stopRecording(explainError(error, "file video"));
      }
    }
  }
}

function stopRecording(reason = "") {
  const current = session;
  if (!current || !["recording", "paused"].includes(phase)) return;
  current.stopReason = reason;
  freezeTimer(current);
  fileVideo.pause();
  setPhase("finishing");
  if (current.recorder.state !== "inactive") current.recorder.stop();
}

function finish(current, chunks) {
  freezeTimer(current);
  const type = chunks[0]?.type || current.recorder.mimeType || "video/webm";
  const blob = new Blob(chunks, { type });
  cleanup(current);
  setPhase("idle");
  if (!blob.size) {
    announce("Tidak ada data video tersimpan. Coba rekam ulang dengan sumber berbeda.", true);
    return;
  }
  playback.removeAttribute("src");
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = URL.createObjectURL(blob);
  recordingDownloaded = false;
  const extension = type.includes("mp4") ? "mp4" : "webm";
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  playback.src = recordingUrl;
  byId("download").href = recordingUrl;
  byId("download").download = "layar-studio-" + timestamp + "." + extension;
  byId("result-info").textContent = extension.toUpperCase() + " · " + (blob.size / 1048576).toFixed(2) + " MB";
  byId("result").hidden = false;
  announce((current.stopReason ? current.stopReason + " " : "") + "Video siap. Gunakan Unduh video untuk menyimpannya.");
}

prepareButton.addEventListener("click", prepare);
recordButton.addEventListener("click", () => {
  if (phase === "ready") startRecording();
  else stopRecording();
});
releaseButton.addEventListener("click", () => {
  cleanup(session);
  setPhase("idle");
  announce("Pratinjau ditutup. Pengaturan bisa diubah.");
});
pauseButton.addEventListener("click", togglePause);
source.addEventListener("change", updateUI);
overlay.addEventListener("change", updateUI);
mic.addEventListener("change", updateUI);
media.addEventListener("change", updateUI);
for (const key of ["mic", "media"]) {
  byId(key + "-volume").addEventListener("input", () => updateGain(key));
}
byId("download").addEventListener("click", () => { recordingDownloaded = true; });
window.addEventListener("beforeunload", (event) => {
  if (["recording", "paused", "finishing"].includes(phase) || !recordingDownloaded) {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (!displayCapture) {
  source.querySelector('[value="screen"]').disabled = true;
  source.value = "file";
}
if (!userCapture) source.querySelector('[value="camera"]').disabled = true;
updateUI();
if (!window.isSecureContext) announce("Buka aplikasi melalui HTTPS atau localhost untuk memberi izin kamera, layar, dan mikrofon.", true);
else if (!canRecord) announce("Browser ini belum mendukung pembuatan file rekaman. Coba Chrome, Edge, atau Safari versi terbaru.", true);
else if (!displayCapture) announce("Pilih file hasil rekam layar perangkat atau gunakan mode Kamera saja.");
