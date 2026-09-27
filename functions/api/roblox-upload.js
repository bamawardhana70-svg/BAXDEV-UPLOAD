// Cloudflare Pages Function — POST /api/roblox-upload
//
// Runs server-side (Cloudflare's edge), so unlike a fetch() from the app
// itself, it isn't subject to the browser's CORS restriction. Roblox's Open
// Cloud Assets API is built for server-to-server calls and does not return
// CORS headers to a browser origin, so this function exists to be that
// server: it re-posts the file + credentials the client sends here to
// Roblox and relays back a small JSON result. Nothing is logged, cached, or
// persisted here — the API key only passes through this request.

export async function onRequestPost(context) {
  const { request } = context;

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, message: "Body permintaan tidak valid (bukan multipart/form-data)." }, 400);
  }

  const file = form.get("file");
  const userId = String(form.get("userId") || "").trim();
  const apiKey = String(form.get("apiKey") || "").trim();
  const assetType = String(form.get("assetType") || "Audio");
  // Clamped to 30 chars here too (not just client-side) so this endpoint is
  // safe even if something else calls it directly.
  const displayName = String(form.get("displayName") || "Untitled").trim().slice(0, 30) || "Untitled";
  const description = String(form.get("description") || "");

  if (!(file instanceof File)) {
    return json({ ok: false, message: "File audio tidak ditemukan di request." }, 400);
  }
  if (!userId || !apiKey) {
    return json({ ok: false, message: "userId dan apiKey wajib diisi." }, 400);
  }

  const requestPayload = {
    assetType,
    displayName,
    description,
    creationContext: { creator: { userId } }
  };

  const upstream = new FormData();
  upstream.append("request", new Blob([JSON.stringify(requestPayload)], { type: "application/json" }));
  upstream.append("fileContent", file, file.name || "audio");

  let res;
  try {
    res = await fetch("https://apis.roblox.com/assets/v1/assets", {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: upstream
    });
  } catch (err) {
    return json({ ok: false, message: "Gagal menghubungi Roblox dari server: " + (err && err.message ? err.message : "network error") }, 502);
  }

  const bodyText = await res.text();
  let data = {};
  try { data = JSON.parse(bodyText); } catch { /* Roblox didn't return JSON */ }

  if (!res.ok) {
    const detail = data.message || bodyText.slice(0, 200) || `HTTP ${res.status}`;
    return json({ ok: false, message: `Roblox menolak upload (HTTP ${res.status}): ${detail}` });
  }

  return json({
    ok: true,
    message: data.path ? `Terkirim ke Roblox. Operasi: ${data.path}` : "Terkirim ke Roblox Open Cloud.",
    operationPath: data.path || null
  });
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
