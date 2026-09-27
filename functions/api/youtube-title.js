// Cloudflare Pages Function — POST /api/youtube-title
//
// Sumber nama asset YouTube yang dulu dipakai (field "title" dari respons
// API convert pihak ketiga di fytaan.vercel.app) tidak terdokumentasi resmi
// dan kadang tidak ada, sehingga upload.html jatuh ke nama generik
// "YouTube Audio ...". Function ini memanggil oEmbed resmi YouTube
// (www.youtube.com/oembed) dari server — endpoint publik resmi milik
// YouTube sendiri, bukan tebakan — untuk dapat judul video yang asli dan
// akurat, lepas dari apa pun yang dibalas API convert pihak ketiga.

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

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

  let res;
  try {
    res = await fetch(oembedUrl);
  } catch (err) {
    return json({ ok: false, message: "Gagal menghubungi YouTube: " + (err && err.message ? err.message : "network error") });
  }

  if (!res.ok) {
    // 404/401 dari oEmbed = video privat/age-restricted/tidak ada — bukan error server.
    return json({ ok: false, message: `YouTube membalas HTTP ${res.status} untuk oEmbed.` });
  }

  let data;
  try { data = await res.json(); } catch {
    return json({ ok: false, message: "Respons oEmbed YouTube bukan JSON." });
  }

  if (!data.title) return json({ ok: false, message: "oEmbed tidak mengembalikan judul." });
  return json({ ok: true, title: data.title, authorName: data.author_name || null });
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
