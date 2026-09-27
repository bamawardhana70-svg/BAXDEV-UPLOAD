// Cloudflare Pages Function — POST /api/youtube-download
//
// Proxy convert YouTube -> MP3 lewat api.theresav.eu, dipanggil dari server
// (bukan langsung dari browser) karena dua alasan: (1) API-nya butuh header
// "x-apikey" custom, yang berarti browser akan mengirim CORS preflight
// (OPTIONS) lebih dulu — kalau api.theresav.eu tidak membalas header CORS
// yang tepat untuk preflight itu, fetch dari client selalu gagal duluan
// sebelum request GET-nya sendiri sempat terkirim; (2) API key jadi tidak
// pernah ikut ter-expose di bundle/network tab browser, sama seperti
// /api/roblox-upload menyembunyikan API key Roblox.
//
// Function ini SELALU membalas byte audio langsung (content-type audio/*)
// kalau berhasil, supaya client cuma perlu satu request same-origin dan
// tidak perlu tahu bentuk respons upstream. Kalau upstream ternyata cuma
// memberi link download terpisah (JSON, bukan file langsung) — bentuk yang
// umum dipakai API convert pihak ketiga tapi tidak terdokumentasi resmi di
// mana pun yang bisa kita verifikasi — function ini yang mengambil link itu
// lagi di server (request kedua, tetap di server) lalu meneruskan byte-nya.
// Judul (kalau upstream sediakan) dititipkan lewat header X-Audio-Title,
// di-URL-encode karena header HTTP cuma boleh berisi ASCII.

const API_KEY = "U8LwW";

export async function onRequestPost(context) {
  const { request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Body permintaan tidak valid (bukan JSON)." }, 400);
  }

  const url = String(body.url || "").trim();
  if (!url) return json({ ok: false, message: "url wajib diisi." }, 400);

  const apiUrl = `https://api.theresav.eu/api/download/ytmp3?url=${encodeURIComponent(url)}&format=mp3&bitrate=64k`;

  let upstream;
  try {
    upstream = await fetch(apiUrl, { headers: { "x-apikey": API_KEY } });
  } catch (err) {
    return json({ ok: false, message: "Gagal menghubungi API convert: " + (err && err.message ? err.message : "network error") }, 502);
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return json({ ok: false, message: `API convert membalas HTTP ${upstream.status}${errText ? ": " + errText.slice(0, 200) : ""}` });
  }

  const contentType = upstream.headers.get("content-type") || "";

  // Kasus 1: upstream langsung membalas file audio — teruskan apa adanya.
  if (/^audio\//i.test(contentType) || /^application\/octet-stream/i.test(contentType)) {
    return new Response(upstream.body, {
      status: 200,
      headers: { "content-type": contentType || "audio/mpeg" }
    });
  }

  // Kasus 2: upstream membalas JSON berisi link download terpisah. Nama
  // field-nya diprobe defensif dengan beberapa kemungkinan umum karena
  // bentuk respons API ini tidak ada dokumentasi resminya.
  let data;
  try { data = await upstream.json(); } catch {
    return json({ ok: false, message: "Respons API convert bukan audio maupun JSON yang dikenali." });
  }

  const downloadUrl = data.url || data.downloadUrl || data.download_url
    || (data.result && (data.result.url || data.result.downloadUrl))
    || (data.data && (data.data.url || data.data.downloadUrl));
  const title = data.title || (data.result && data.result.title) || (data.data && data.data.title) || null;

  if (!downloadUrl) {
    return json({ ok: false, message: "Tidak menemukan URL audio di respons API convert." });
  }

  let fileRes;
  try {
    fileRes = await fetch(downloadUrl);
  } catch (err) {
    return json({ ok: false, message: "Gagal mengunduh hasil convert: " + (err && err.message ? err.message : "network error") });
  }
  if (!fileRes.ok) {
    return json({ ok: false, message: `Gagal mengunduh hasil convert (HTTP ${fileRes.status}).` });
  }

  const fileContentType = fileRes.headers.get("content-type") || "audio/mpeg";
  const headers = { "content-type": fileContentType };
  if (title) headers["x-audio-title"] = encodeURIComponent(title);
  return new Response(fileRes.body, { status: 200, headers });
}

export async function onRequestGet() {
  return json({ ok: false, message: "Gunakan POST." }, 405);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" }
  });
}
