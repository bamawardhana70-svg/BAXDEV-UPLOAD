/*
  BaxDev — player.js
  Small custom audio preview player (play/pause, seek, elapsed/duration) used
  in place of the bare native <audio controls>, which renders inconsistently
  across browsers and doesn't match the app's look. Reused on Upload (right
  after a track is added) and Library — hence its own file/component.
*/
(function (global) {
  "use strict";

  const ICON_PLAY = '<svg class="ic-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg class="ic-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ":" + String(sec).padStart(2, "0");
  }

  /**
   * @param {HTMLElement} container empty element to render into
   * @param {Blob} blob audio blob to preview
   * @param {{initialSpeed?:number}} [opts] initialSpeed: live playbackRate to preview at,
   *   for tracks not yet baked to a fixed-speed file (see setSpeed below).
   * @returns {{destroy:()=>void, setSpeed:(speed:number)=>void}}
   */
  function mount(container, blob, opts) {
    opts = opts || {};
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = "metadata";
    // Real speed preview, not a browser time-stretch: disable native pitch
    // correction so playbackRate shifts pitch the same way the actual
    // OfflineAudioContext render in audio-speed.js does. Without this the
    // preview would sound different (pitch-corrected) from the file that
    // actually gets uploaded.
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;
    if (opts.initialSpeed && opts.initialSpeed !== 1) audio.playbackRate = opts.initialSpeed;

    container.innerHTML = `
      <button type="button" class="player-play" aria-label="Putar preview">${ICON_PLAY}${ICON_PAUSE}</button>
      <div class="player-body">
        <input type="range" class="player-seek" min="0" max="0" step="0.1" value="0" aria-label="Posisi audio">
        <div class="player-time"><span class="player-cur">0:00</span><span class="player-dur">0:00</span></div>
      </div>
    `;

    const playBtn = container.querySelector(".player-play");
    const seek = container.querySelector(".player-seek");
    const curEl = container.querySelector(".player-cur");
    const durEl = container.querySelector(".player-dur");
    let dragging = false;

    audio.addEventListener("loadedmetadata", () => {
      seek.max = isFinite(audio.duration) ? audio.duration : 0;
      durEl.textContent = fmtTime(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      if (dragging) return;
      seek.value = audio.currentTime;
      curEl.textContent = fmtTime(audio.currentTime);
    });
    audio.addEventListener("ended", () => playBtn.classList.remove("playing"));
    audio.addEventListener("pause", () => playBtn.classList.remove("playing"));
    audio.addEventListener("play", () => playBtn.classList.add("playing"));

    playBtn.addEventListener("click", () => {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });
    seek.addEventListener("input", () => {
      dragging = true;
      curEl.textContent = fmtTime(parseFloat(seek.value));
    });
    seek.addEventListener("change", () => {
      audio.currentTime = parseFloat(seek.value);
      dragging = false;
    });

    return {
      setSpeed(speed) {
        audio.playbackRate = speed || 1;
      },
      destroy() {
        audio.pause();
        audio.src = "";
        URL.revokeObjectURL(url);
      }
    };
  }

  global.BaxdevPlayer = { mount };
})(window);
