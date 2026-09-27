// Cloudflare Pages Function — POST /api/roblox-upload
//
// Runs server-side (Cloudflare's edge), so unlike a fetch() from the app
// itself, it isn't subject to the browser's CORS restriction. Roblox's Open
// Cloud Assets API is built for server-to-server calls and does not return
// CORS headers to a browser origin, so this function exists to be that
// server: it re-posts the file + credentials the client sends here to
// Roblox and relays back a small JSON result. Nothing is logged, cached, or
// persisted here — the API key only passes through this request.
//
// Create Asset (POST /v1/assets) itself only returns an Operation path
// (operations/{id}) — the actual numeric assetId only shows up once that
// operation is polled to completion via GET /v1/{operationPath}. So this
// function polls that endpoint for a bounded window right after upload and
// returns the resolved assetId when it's ready. If Roblox is still
// processing/moderating past that window, it replies with pending:true and
// the operationPath so the client can resolve it later via
// /api/roblox-asset-status instead of the UI silently showing nothing.

const POLL_ATTEMPTS = 6;
const POLL_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollOperation(operationPath, apiKey) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await sleep(POLL_DELAY_MS);
    let res;
    try {
      res = await fetch(`https://apis.roblox.com/assets/v1/${operationPath}`, {
        headers: { "x-api-key": apiKey }
      });
    } catch {
      continue; // network hiccup mid-poll — try again next tick instead of giving up
    }
    if (!res.ok) continue;
    let op = null;
    try { op = await res.json(); } catch { continue; }
    if (op && op.done) return op;
  }
  return null; // still not done after the poll window
}

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
  if (file.size === 0) {
    return json({ ok: false, message: "File audio kosong (0 byte) — coba upload ulang dari halaman Upload." }, 400);
  }
  const MAX_BYTES = 20 * 1024 * 1024; // sama dengan batas di upload.html (MAX_FILE_MB)
  if (file.size > MAX_BYTES) {
    return json({ ok: false, message: "File audio melebihi batas 20MB." }, 400);
  }

  const requestPayload = {
    assetType,
    displayName,
    description,
    creationContext: { creator: { userId } }
  };

  const upstream = new FormData();
  // PENTING: "request" harus di-append sebagai string biasa, BUKAN dibungkus
  // Blob. FormData.append(name, blobValue) selalu menyertakan atribut
  // `filename` (default "blob") begitu value-nya sebuah Blob — itu membuat
  // Roblox membaca part ini sebagai file, bukan field JSON biasa, sehingga
  // "request" dianggap kosong walau fileContent-nya sendiri valid (persis
  // pesan error "Request body cannot be empty" yang muncul). Contoh resmi
  // Roblox (curl --form 'request={...}') juga mengirim field ini tanpa
  // filename maupun content-type eksplisit.
  upstream.append("request", JSON.stringify(requestPayload));
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

  const operationPath = data.path || null;
  if (!operationPath) {
    // Upload diterima tapi Roblox tidak mengembalikan operation path — tidak
    // ada cara untuk resolve assetId sama sekali.
    return json({ ok: true, message: "Terkirim ke Roblox Open Cloud.", assetId: null, operationPath: null });
  }

  const op = await pollOperation(operationPath, apiKey);
  if (!op) {
    // Masih diproses Roblox setelah jendela polling — bukan gagal, cuma
    // belum selesai. Client menyimpan operationPath untuk dicek lagi nanti.
    return json({
      ok: true,
      pending: true,
      operationPath,
      message: "Terkirim ke Roblox, masih diproses (moderasi audio). ID aset akan muncul begitu selesai."
    });
  }
  if (op.error) {
    return json({ ok: false, message: `Roblox menolak asset ini: ${op.error.message || "diblokir moderasi."}` });
  }

  const assetId = op.response && op.response.assetId ? String(op.response.assetId) : null;
  const moderationState = op.response && op.response.moderationResult ? op.response.moderationResult.moderationState : null;
  return json({
    ok: true,
    assetId,
    moderationState: moderationState || null,
    message: assetId ? `Berhasil dipublish. Asset ID: ${assetId}` : "Terkirim ke Roblox Open Cloud."
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
