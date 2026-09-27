/*
  BaxDev — audio-speed.js
  Applies a real playback-speed change to an audio Blob before it's stored/published.
  Uses OfflineAudioContext + AudioBufferSourceNode.playbackRate (native Web Audio API,
  no external library) to render the sped-up/slowed-down PCM, then encodes that PCM
  straight to MP3 with lamejs — so the output format stays MP3 at every speed, never WAV.
  Speed 1x is a no-op passthrough (original file/bytes untouched).

  Requires <script> tags for lamejs (lame.min.js) to be loaded BEFORE this file.
*/
(function (global) {
  "use strict";

  function floatTo16BitPCM(channelData) {
    const out = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      let s = Math.max(-1, Math.min(1, channelData[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function encodeMp3(buffer) {
    if (typeof lamejs === "undefined") {
      throw new Error("Encoder MP3 (lamejs) belum termuat. Pastikan <script> lame.min.js ada sebelum assets/audio-speed.js.");
    }
    const numChannels = Math.min(2, buffer.numberOfChannels);
    const sampleRate = buffer.sampleRate;
    const kbps = 128;
    const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);

    const left = floatTo16BitPCM(buffer.getChannelData(0));
    const right = numChannels > 1 ? floatTo16BitPCM(buffer.getChannelData(1)) : null;

    const blockSize = 1152; // kelipatan 576, disarankan lamejs
    const chunks = [];
    for (let i = 0; i < left.length; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      let mp3buf;
      if (right) {
        mp3buf = encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize));
      } else {
        mp3buf = encoder.encodeBuffer(leftChunk);
      }
      if (mp3buf.length > 0) chunks.push(new Int8Array(mp3buf));
    }
    const tail = encoder.flush();
    if (tail.length > 0) chunks.push(new Int8Array(tail));

    return new Blob(chunks, { type: "audio/mpeg" });
  }

  /**
   * @param {Blob} sourceBlob original audio blob
   * @param {number} speed 0.25 - 2
   * @returns {Promise<{blob:Blob, mime:string, ext:string, processed:boolean}>}
   */
  async function applySpeed(sourceBlob, speed) {
    if (!speed || speed === 1) {
      return { blob: sourceBlob, mime: sourceBlob.type || "audio/mpeg", ext: guessExt(sourceBlob.type), processed: false };
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("Browser tidak mendukung Web Audio API untuk mengubah kecepatan.");

    const arrayBuffer = await sourceBlob.arrayBuffer();
    const decodeCtx = new AudioCtx();
    let decoded;
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      decodeCtx.close();
    }

    const newFrameCount = Math.max(1, Math.ceil(decoded.length / speed));
    const offlineCtx = new OfflineAudioContext(decoded.numberOfChannels, newFrameCount, decoded.sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = decoded;
    src.playbackRate.value = speed;
    src.connect(offlineCtx.destination);
    src.start(0);

    const rendered = await offlineCtx.startRendering();
    const mp3Blob = encodeMp3(rendered);
    return { blob: mp3Blob, mime: "audio/mpeg", ext: ".mp3", processed: true };
  }

  function guessExt(mime) {
    if (!mime) return ".mp3";
    if (mime.includes("wav")) return ".wav";
    if (mime.includes("ogg")) return ".ogg";
    if (mime.includes("flac")) return ".flac";
    if (mime.includes("aac")) return ".aac";
    return ".mp3";
  }

  global.BaxdevAudio = { applySpeed, guessExt };
})(window);
