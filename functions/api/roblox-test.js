// Cloudflare Pages Function — POST /api/roblox-test
//
// Same rationale as roblox-upload.js: proxies a call to Roblox's Open Cloud
// Users API server-side so the "Cek Koneksi" button in Settings works
// regardless of browser CORS. Nothing here is logged or persisted.

export async function onRequestPost(context) {
  const { request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Body permintaan tidak valid." }, 400);
  }

  const userId = String((body && body.userId) || "").trim();
  const apiKey = String((body && body.apiKey) || "").trim();
  if (!userId || !apiKey) {
    return json({ ok: false, message: "Isi Roblox User ID dan API Key dulu." });
  }

  let res;
  try {
    res = await fetch(`https://apis.roblox.com/cloud/v2/users/${encodeURIComponent(userId)}`, {
      headers: { "x-api-key": apiKey }
    });
  } catch (err) {
    return json({ ok: false, message: "Gagal menghubungi Roblox dari server: " + (err && err.message ? err.message : "network error") });
  }

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    const name = data.displayName || data.name || userId;
    return json({ ok: true, message: `Terhubung ke akun Roblox: ${name}.` });
  }
  if (res.status === 401 || res.status === 403) {
    return json({ ok: false, message: `API key ditolak (HTTP ${res.status}). Cek API key dan pastikan scope Users API / Assets API sudah dicentang.` });
  }
  return json({ ok: false, message: `Roblox membalas HTTP ${res.status}.` });
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
