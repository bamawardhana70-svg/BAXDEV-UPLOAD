/*
  BaxDev — audio-speed.js
  Applies a real playback-speed change to an audio Blob before it's stored/published.
  Uses OfflineAudioContext + AudioBufferSourceNode.playbackRate (native Web Audio API,
  no external library). Speed 1x is a no-op passthrough. Output is 16-bit PCM WAV.
*/
(function (global) {
  "use strict";

  function audioBufferToWavBlob(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numFrames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const bufferSize = 44 + dataSize;

    const ab = new ArrayBuffer(bufferSize);
    const view = new DataView(ab);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    const channelData = [];
    for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));

    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = channelData[ch][i];
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([ab], { type: "audio/wav" });
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
    const wavBlob = audioBufferToWavBlob(rendered);
    return { blob: wavBlob, mime: "audio/wav", ext: ".wav", processed: true };
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
