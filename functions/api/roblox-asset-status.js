// Cloudflare Pages Function — POST /api/roblox-asset-status
//
// Dipanggil dari Library saat sebuah track masih berstatus "pending"
// (operation belum done() waktu /api/roblox-upload tadi polling). Ini
// hanya satu kali GET ke operation yang sama — bukan proxy baru, cuma
// lanjutan pengecekan yang sama seperti di roblox-upload.js — supaya
// assetId yang muncul belakangan (moderasi audio Roblox bisa makan waktu)
// tetap bisa diambil tanpa upload ulang.

export async function onRequestPost(context) {
  const { request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Body permintaan tidak valid (bukan JSON)." }, 400);
  }

  const apiKey = String(body.apiKey || "").trim();
  const operationPath = String(body.operationPath || "").trim();
  if (!apiKey || !operationPath) {
    return json({ ok: false, message: "apiKey dan operationPath wajib diisi." }, 400);
  }
  if (!/^operations\/[\w-]+$/.test(operationPath)) {
    return json({ ok: false, message: "Format operationPath tidak valid." }, 400);
  }

  let res;
  try {
    res = await fetch(`https://apis.roblox.com/assets/v1/${operationPath}`, {
      headers: { "x-api-key": apiKey }
    });
  } catch (err) {
    return json({ ok: false, message: "Gagal menghubungi Roblox dari server: " + (err && err.message ? err.message : "network error") }, 502);
  }

  const bodyText = await res.text();
  let op = {};
  try { op = JSON.parse(bodyText); } catch { /* Roblox didn't return JSON */ }

  if (!res.ok) {
    return json({ ok: false, message: `Roblox membalas HTTP ${res.status} saat cek status.` });
  }
  if (!op.done) {
    return json({ ok: true, done: false, message: "Masih diproses Roblox." });
  }
  if (op.error) {
    return json({ ok: true, done: true, error: true, message: `Roblox menolak asset ini: ${op.error.message || "diblokir moderasi."}` });
  }

  const assetId = op.response && op.response.assetId ? String(op.response.assetId) : null;
  const moderationState = op.response && op.response.moderationResult ? op.response.moderationResult.moderationState : null;
  return json({ ok: true, done: true, assetId, moderationState: moderationState || null });
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
