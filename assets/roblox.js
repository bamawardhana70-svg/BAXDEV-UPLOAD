/*
  BaxDev — roblox.js

  Publish talks to Roblox's Open Cloud Assets API through a same-origin
  Cloudflare Pages Function (/api/roblox-upload, /api/roblox-test) by default.
  Roblox's Open Cloud API is built for server-to-server calls and does not
  send back CORS headers for a browser origin, so a raw fetch() from this
  page straight to apis.roblox.com fails. Routing through a Function on the
  same origin sidesteps that: the Function calls Roblox server-side, the
  browser only ever talks to its own origin. This only works once the site
  is deployed to Cloudflare Pages (the functions/ folder is Cloudflare's own
  convention and deploys automatically with it) — on a host without
  Functions, publish fails with a clear "endpoint not found" message instead
  of pretending to work.

  Jalur upload dikunci ke satu mode saja (builtin/Cloudflare Function) —
  mode "proxy sendiri" sengaja dihapus dari sini supaya perilaku publish
  tidak bisa berubah-ubah tergantung isi localStorage/Pengaturan.

  publishTrackById() is the shared orchestrator both upload.html (publish
  right after a track is added) and library.html (publish from the list) call,
  so status/quota bookkeeping lives in one place instead of two.
*/
(function (global) {
  "use strict";

  async function testConnection(settings) {
    if (!settings.apiKey || !settings.userId) {
      return { ok: false, message: "Isi Roblox User ID dan API Key dulu." };
    }
    try {
      const res = await fetch("/api/roblox-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: settings.userId, apiKey: settings.apiKey })
      });
      if (res.status === 404) {
        return { ok: false, message: "Endpoint /api/roblox-test tidak ditemukan. Fitur ini aktif otomatis setelah situs di-deploy ke Cloudflare Pages (folder functions/ ikut ter-deploy)." };
      }
      // Read as text first: a JSON-parse failure alone doesn't say *why* it
      // failed, so we inspect the body to give an actionable message instead
      // of a bare "invalid response".
      const bodyText = await res.text();
      let data = null;
      try { data = JSON.parse(bodyText); } catch { /* not JSON, handled below */ }
      if (data && typeof data.ok === "boolean") return data;

      const looksHtml = /^\s*<(!doctype html|html)/i.test(bodyText);
      if (looksHtml) {
        return {
          ok: false,
          message: `Server membalas halaman HTML (HTTP ${res.status}), bukan JSON dari /api/roblox-test. Biasanya artinya: situs ini belum ter-deploy sebagai Cloudflare Pages dengan folder functions/ aktif (bukan Workers), atau ada proteksi Cloudflare (mis. Bot Fight Mode/security check) yang memblokir permintaan ke /api/*.`
        };
      }
      return { ok: false, message: `Respons server tidak dikenali (HTTP ${res.status}).` };
    } catch (err) {
      return { ok: false, message: "Gagal menghubungi server: " + (err.message || "network error") };
    }
  }

  function xhrUpload(url, form, onProgress) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        if (xhr.status === 404) {
          resolve({ ok: false, message: `Endpoint ${url} tidak ditemukan (HTTP 404). Deploy situs ini ke Cloudflare Pages (folder functions/ ikut ter-upload) supaya endpoint ini aktif.` });
          return;
        }
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
        if (xhr.status >= 200 && xhr.status < 300 && data && typeof data.ok === "boolean") {
          resolve(data);
        } else if (!data && /^\s*<(!doctype html|html)/i.test(xhr.responseText || "")) {
          resolve({ ok: false, message: `Server membalas halaman HTML (HTTP ${xhr.status}), bukan JSON. Pastikan situs ini di-deploy ke Cloudflare Pages (bukan Workers) dengan folder functions/ ikut ter-upload.` });
        } else {
          resolve({ ok: false, message: (data && data.message) || `Server membalas HTTP ${xhr.status}.` });
        }
      };
      xhr.onerror = () => resolve({ ok: false, message: "Gagal terhubung ke server upload. Cek koneksi internet kamu." });
      xhr.send(form);
    });
  }

  function buildForm(track, blob, settings) {
    const form = new FormData();
    form.append("file", blob, (track.name || "audio") + BaxdevAudio.guessExt(blob.type));
    form.append("userId", settings.userId);
    form.append("apiKey", settings.apiKey || "");
    form.append("assetType", "Audio");
    form.append("displayName", Baxdev.clampAssetName(track.name));
    form.append("description", track.description || "");
    return form;
  }

  /**
   * @param {Object} track library track metadata
   * @param {Blob} blob audio blob to upload
   * @param {Object} settings
   * @param {(pct:number)=>void} [onProgress]
   * @returns {Promise<{ok:boolean, message:string, assetId?:string|null, pending?:boolean, operationPath?:string|null}>}
   */
  async function publish(track, blob, settings, onProgress) {
    if (!settings.userId) return { ok: false, message: "Roblox User ID belum diisi di Pengaturan." };
    if (!settings.apiKey) return { ok: false, message: "Roblox API Key belum diisi di Pengaturan." };
    return xhrUpload("/api/roblox-upload", buildForm(track, blob, settings), onProgress);
  }

  /**
   * Cek ulang status operation Roblox untuk track yang tadi publish-nya
   * "pending" (assetId belum keluar karena masih diproses/dimoderasi).
   * @param {string} id track id di Baxdev.getLibrary()
   * @returns {Promise<{ok:boolean, done?:boolean, assetId?:string|null, message?:string}>}
   */
  async function checkAssetStatus(id) {
    const settings = Baxdev.getSettings();
    let library = Baxdev.getLibrary();
    const track = library.find((t) => t.id === id);
    if (!track || !track.operationPath) return { ok: false, message: "Tidak ada operation yang perlu dicek." };
    if (!settings.apiKey) return { ok: false, message: "API Key belum diisi di Pengaturan." };

    let data;
    try {
      const res = await fetch("/api/roblox-asset-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: settings.apiKey, operationPath: track.operationPath })
      });
      data = await res.json();
    } catch (err) {
      return { ok: false, message: "Gagal menghubungi server: " + (err.message || "network error") };
    }

    if (!data.ok) return data;
    if (!data.done) return { ok: true, done: false, message: data.message };

    library = Baxdev.getLibrary();
    const t = library.find((x) => x.id === id);
    if (t) {
      if (data.error) {
        t.status = "failed";
        t.message = data.message;
      } else {
        t.assetId = data.assetId || null;
        t.operationPath = null;
      }
      Baxdev.saveLibrary(library);
    }
    return data;
  }

  /**
   * Shared publish flow: validates settings/quota, flips status to
   * "publishing", uploads with progress, then persists the final status.
   * @param {string} id track id in Baxdev.getLibrary()
   * @param {{onStart?:(track:Object)=>void, onProgress?:(pct:number)=>void}} [hooks]
   * @returns {Promise<{ok:boolean, code:string, message:string}>}
   */
  async function publishTrackById(id, hooks) {
    hooks = hooks || {};
    const settings = Baxdev.getSettings();
    let library = Baxdev.getLibrary();
    const track = library.find((t) => t.id === id);
    if (!track) return { ok: false, code: "not_found", message: "Track tidak ditemukan." };

    if (!settings.userId || !settings.apiKey) {
      return { ok: false, code: "missing_settings", message: "Lengkapi Pengaturan (User ID / API Key) dulu." };
    }

    if (!Baxdev.isVIP()) {
      const q = Baxdev.getQuota();
      if (q.count >= Baxdev.FREE_UPLOAD_LIMIT) return { ok: false, code: "quota", message: `Batas ${Baxdev.FREE_UPLOAD_LIMIT} upload akun Free tercapai. Jadi VIP lewat Owner Panel untuk upload tanpa batas.` };
    }

    track.status = "publishing";
    track.message = "Mengirim ke Roblox...";
    Baxdev.saveLibrary(library);
    if (hooks.onStart) hooks.onStart(track);

    try {
      const blob = await Baxdev.loadBlob(id);
      if (!blob) throw new Error("Audio untuk track ini tidak ditemukan di penyimpanan lokal.");
      const result = await publish(track, blob, settings, hooks.onProgress);
      library = Baxdev.getLibrary();
      const t = library.find((x) => x.id === id);
      if (t) {
        t.status = result.ok ? "published" : "failed";
        t.message = result.message;
        if (result.ok) {
          t.assetId = result.assetId || null;
          t.operationPath = result.pending ? result.operationPath : null;
        }
      }
      if (result.ok && !Baxdev.isVIP()) Baxdev.incrementQuota();
      Baxdev.saveLibrary(library);
      return { ok: result.ok, code: result.ok ? "done" : "failed", message: result.message };
    } catch (err) {
      library = Baxdev.getLibrary();
      const t = library.find((x) => x.id === id);
      const message = err.message || "Publish gagal.";
      if (t) { t.status = "failed"; t.message = message; }
      Baxdev.saveLibrary(library);
      return { ok: false, code: "error", message };
    }
  }

  /**
   * Publish flow untuk track yang BELUM ada di Library (dipanggil dari
   * staging di halaman Upload). Beda dengan publishTrackById: di sini
   * track baru ditulis ke Library (dan blob-nya baru disimpan ke
   * IndexedDB) kalau upload ke Roblox berhasil — jadi Library isinya
   * murni audio yang sudah beneran ter-publish, bukan draft.
   * @param {{name:string, description?:string, source:string, speed:number}} meta
   * @param {Blob} blob audio final (sudah diproses kecepatan)
   * @param {{onProgress?:(pct:number)=>void}} [hooks]
   * @returns {Promise<{ok:boolean, code:string, message:string, track?:Object}>}
   */
  async function publishNewTrack(meta, blob, hooks) {
    hooks = hooks || {};
    const settings = Baxdev.getSettings();

    if (!settings.userId || !settings.apiKey) {
      return { ok: false, code: "missing_settings", message: "Lengkapi Pengaturan (User ID / API Key) dulu." };
    }
    if (!Baxdev.isVIP()) {
      const q = Baxdev.getQuota();
      if (q.count >= Baxdev.FREE_UPLOAD_LIMIT) return { ok: false, code: "quota", message: `Batas ${Baxdev.FREE_UPLOAD_LIMIT} upload akun Free tercapai. Jadi VIP lewat Owner Panel untuk upload tanpa batas.` };
    }

    const name = Baxdev.clampAssetName(meta.name);
    const result = await publish({ name, description: meta.description || "" }, blob, settings, hooks.onProgress);

    if (!result.ok) {
      return { ok: false, code: "failed", message: result.message };
    }

    const track = {
      id: "trk_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      name,
      description: meta.description || "",
      source: meta.source,
      speed: meta.speed || 1,
      status: "published",
      message: result.message,
      assetId: result.assetId || null,
      operationPath: result.pending ? result.operationPath : null
    };
    await Baxdev.saveBlob(track.id, blob);
    const library = Baxdev.getLibrary();
    library.unshift(track);
    Baxdev.saveLibrary(library);
    if (!Baxdev.isVIP()) Baxdev.incrementQuota();

    return { ok: true, code: "done", message: result.message, track };
  }

  global.BaxdevRoblox = { testConnection, publish, publishTrackById, publishNewTrack, checkAssetStatus };
})(window);
