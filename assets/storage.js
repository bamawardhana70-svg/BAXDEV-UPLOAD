/*
  BaxDev — storage.js
  Shared across every page. Handles:
  - localStorage for settings / VIP list / owner password hash / track metadata / upload quota
  - IndexedDB for the actual audio blobs (localStorage's ~5-10MB cap is not enough for audio,
    especially after speed-processing bakes a track down to raw WAV)

  Quota upload: FREE_UPLOAD_LIMIT (10) adalah batas TOTAL seumur akun untuk
  user biasa (bukan reset harian) — dihitung per Roblox User ID yang diisi
  di Pengaturan, bukan per perangkat, supaya ganti-ganti User ID di
  perangkat yang sama tidak "reset" jatah. VIP tidak kena batas ini sama
  sekali.
*/
(function (global) {
  "use strict";

  const LS = {
    settings: "baxdev_settings",
    vip: "baxdev_vip_list",
    ownerHash: "baxdev_owner_hash",
    library: "baxdev_library",
    quota: "baxdev_quota"
  };

  const FREE_UPLOAD_LIMIT = 10;
  const FREE_YT_LINKS = 1;
  const VIP_YT_LINKS = 5;
  const MAX_FILE_MB = 20;
  const MAX_ASSET_NAME = 30;

  function clampAssetName(name) {
    return String(name || "Untitled").trim().slice(0, MAX_ASSET_NAME) || "Untitled";
  }

  function readJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  // uploadMode dikunci ke "builtin" (Cloudflare Pages Function bawaan) —
  // mode proxy sendiri sengaja dihapus supaya jalur upload tidak bisa
  // diganti-ganti dari Pengaturan. Field lama di localStorage (kalau ada,
  // dari versi sebelumnya) diabaikan, bukan dihapus paksa.
  function getSettings() {
    const s = readJSON(LS.settings, { userId: "", apiKey: "" });
    s.uploadMode = "builtin";
    return s;
  }
  function saveSettings(s) {
    writeJSON(LS.settings, s);
  }
  function getVipList() {
    return readJSON(LS.vip, []);
  }
  function saveVipList(list) {
    writeJSON(LS.vip, list);
  }
  function getLibrary() {
    return readJSON(LS.library, []);
  }
  function saveLibrary(list) {
    writeJSON(LS.library, list);
  }
  function getOwnerHash() {
    return localStorage.getItem(LS.ownerHash);
  }
  function setOwnerHash(h) {
    localStorage.setItem(LS.ownerHash, h);
  }

  // Total upload seumur akun, per Roblox User ID — BUKAN reset harian.
  // Disimpan sebagai map { [userId]: count } supaya kalau perangkat yang
  // sama pernah dipakai untuk User ID lain, jatah masing-masing akun tetap
  // terpisah dan tidak saling memotong.
  function currentAccountKey() {
    const uid = String(getSettings().userId || "").trim();
    return uid || "_no_account_";
  }
  function getQuota() {
    const totals = readJSON(LS.quota, {});
    const key = currentAccountKey();
    return { userId: key, count: totals[key] || 0 };
  }
  function incrementQuota() {
    const totals = readJSON(LS.quota, {});
    const key = currentAccountKey();
    totals[key] = (totals[key] || 0) + 1;
    writeJSON(LS.quota, totals);
    return { userId: key, count: totals[key] };
  }

  function isVIP() {
    const s = getSettings();
    if (!s.userId) return false;
    return getVipList().some((v) => String(v.id) === String(s.userId));
  }

  async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function statusLabel(s) {
    return { draft: "Draft", publishing: "Publishing…", published: "Published", failed: "Gagal" }[s] || s;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- toast ---------------- */
  let toastTimer;
  function toast(msg, isErr) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("err", !!isErr);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  /* ---------------- IndexedDB blob store ---------------- */
  const DB_NAME = "baxdev_audio_db";
  const DB_STORE = "audioBlobs";
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function saveBlob(id, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put({ id, blob });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadBlob(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteBlob(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------------- shared plan/stat badges ---------------- */
  function renderPlanBadges() {
    const vip = isVIP();
    const q = getQuota();
    const library = getLibrary();

    const planName = document.getElementById("planName");
    if (planName) {
      planName.textContent = vip ? "Premium" : "Free Plan";
      planName.classList.toggle("vip", vip);
    }
    const planQuota = document.getElementById("planQuota");
    if (planQuota) {
      planQuota.textContent = vip ? "Upload tanpa batas" : `${q.count}/${FREE_UPLOAD_LIMIT} upload terpakai`;
    }
    const statPlanShort = document.getElementById("statPlanShort");
    if (statPlanShort) statPlanShort.textContent = vip ? "VIP" : "Free";

    const statTotal = document.getElementById("statTotal");
    if (statTotal) statTotal.textContent = library.length;

    const statPublished = document.getElementById("statPublished");
    if (statPublished) statPublished.textContent = library.filter((t) => t.status === "published").length;
  }

  /* ---------------- bottom-nav active state safeguard ---------------- */
  // Cloudflare Pages bisa nampilin "clean URL" di address bar (mis. "/upload"
  // tanpa akhiran .html), jadi bandingkan pathname vs href TANPA peduli ada/
  // tidaknya ".html" di keduanya — root "/" otomatis dianggap index.html.
  // Kalau ini nggak di-normalize, perbandingan strict lama bisa gagal match
  // dan malah MENGHAPUS class "active" yang sudah benar dari HTML.
  function highlightActiveNav() {
    let file = location.pathname.split("/").pop() || "index.html";
    file = file.replace(/\.html$/i, "") || "index";
    document.querySelectorAll(".nav-item").forEach((a) => {
      const href = (a.getAttribute("href") || "").replace(/\.html$/i, "");
      a.classList.toggle("active", href === file);
    });
  }

  /* ---------------- profil Roblox (nama + avatar), sekali fetch per halaman ---------------- */
  // Dipakai bareng oleh mountAccountIcon dan mountWelcomeCard supaya cuma
  // satu request /api/roblox-profile per page load, bukan dua.
  let profilePromise = null;
  function loadRobloxProfile() {
    if (profilePromise) return profilePromise;
    const settings = getSettings();
    const uid = String(settings.userId || "").trim();
    if (!settings.apiKey || !/^\d+$/.test(uid)) {
      profilePromise = Promise.resolve(null); // belum "login"
      return profilePromise;
    }
    profilePromise = fetch("/api/roblox-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: uid, apiKey: settings.apiKey })
    })
      .then((res) => res.json())
      .then((data) => (data && data.ok ? data : null))
      .catch(() => null);
    return profilePromise;
  }

  /* ---------------- account icon: avatar Roblox kalau sudah login ---------------- */
  const ACCOUNT_DEFAULT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8.4" r="3.6"/><path d="M4.6 19.6c1.15-3.55 4.05-5.6 7.4-5.6s6.25 2.05 7.4 5.6"/></svg>';

  function mountAccountIcon() {
    // [data-account-icon] bisa ada lebih dari satu node sekaligus per halaman
    // (tombol akun di topbar buat tampilan HP, plus slot akun di sidebar buat
    // tampilan desktop) — keduanya di-mount dari satu fetch profil yang sama.
    const btns = document.querySelectorAll("[data-account-icon]");
    if (!btns.length) return; // halaman ini (mis. settings/owner topbar lama) nggak punya slot akun

    function showDefault(btn) {
      btn.innerHTML = ACCOUNT_DEFAULT_SVG;
      btn.title = "Akun Roblox";
      btn.setAttribute("aria-label", "Akun Roblox");
      btn.classList.remove("has-avatar");
    }
    function showAvatar(btn, url) {
      const img = document.createElement("img");
      img.className = "account-avatar-img";
      img.alt = "Avatar Roblox";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => showDefault(btn); // link putus/avatar dihapus -> balik ke ikon default, jangan biarin broken image
      img.src = url;
      btn.innerHTML = "";
      btn.appendChild(img);
      btn.classList.add("has-avatar");
      btn.title = "Akun Roblox";
    }

    btns.forEach(showDefault); // state awal: ikon avatar generik, bukan gear
    loadRobloxProfile().then((profile) => {
      if (profile && profile.avatarUrl) btns.forEach((btn) => showAvatar(btn, profile.avatarUrl));
    });
  }

  /* ---------------- dashboard welcome card: avatar + nama kalau sudah login ---------------- */
  function mountWelcomeCard() {
    const card = document.getElementById("welcomeCard");
    if (!card) return; // cuma ada di index.html

    loadRobloxProfile().then((profile) => {
      if (!profile) return; // belum login / gagal ambil profil -> dashboard tetap bersih, card tetap disembunyikan
      const avatarWrap = document.getElementById("welcomeAvatar");
      if (avatarWrap) {
        if (profile.avatarUrl) {
          const img = document.createElement("img");
          img.alt = "Avatar Roblox";
          img.referrerPolicy = "no-referrer";
          img.onerror = () => { avatarWrap.innerHTML = ACCOUNT_DEFAULT_SVG; };
          img.src = profile.avatarUrl;
          avatarWrap.innerHTML = "";
          avatarWrap.appendChild(img);
        } else {
          avatarWrap.innerHTML = ACCOUNT_DEFAULT_SVG;
        }
      }
      const nameEl = document.getElementById("welcomeName");
      if (nameEl) nameEl.textContent = profile.displayName || profile.username || "";
      const handleEl = document.getElementById("welcomeHandle");
      if (handleEl) handleEl.textContent = profile.username ? "@" + profile.username : "";
      card.style.display = "flex";
    });
  }

  /* ---------------- generic menu-sheet plumbing ---------------- */
  function wireMenuSheet() {
    const btn = document.getElementById("btnMenu");
    const veil = document.getElementById("veilMenu");
    if (!btn || !veil) return;
    btn.addEventListener("click", () => veil.classList.add("open"));
    veil.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => veil.classList.remove("open")));
    veil.addEventListener("click", (e) => {
      if (e.target === veil) veil.classList.remove("open");
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderPlanBadges();
    highlightActiveNav();
    wireMenuSheet();
    mountAccountIcon();
    mountWelcomeCard();
  });

  global.Baxdev = {
    LS, FREE_UPLOAD_LIMIT, FREE_YT_LINKS, VIP_YT_LINKS, MAX_FILE_MB, MAX_ASSET_NAME, clampAssetName,
    getSettings, saveSettings, getVipList, saveVipList, getLibrary, saveLibrary,
    getOwnerHash, setOwnerHash, getQuota, incrementQuota, isVIP, sha256, escapeHtml, statusLabel, toast,
    saveBlob, loadBlob, deleteBlob, renderPlanBadges
  };
})(window);
