// Cloudflare Pages Function — POST /api/roblox-profile
//
// Same rationale as roblox-test.js / roblox-upload.js: proxies Roblox calls
// server-side so the browser never has to talk to Roblox's APIs directly.
// The account-icon avatar previously called thumbnails.roblox.com straight
// from the browser via fetch() — Roblox doesn't send CORS headers back for
// that, so the fetch always failed and silently fell back to a legacy
// "headshot-thumbnail" image endpoint that Roblox retired, which is why the
// avatar never showed up. Routing both the username lookup and the avatar
// lookup through this one Function (in parallel) fixes that at the root and
// also gives the dashboard's welcome card a single place to pull name +
// avatar from. Nothing here is logged or persisted.

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

  const [userResult, avatarResult] = await Promise.allSettled([
    fetch(`https://apis.roblox.com/cloud/v2/users/${encodeURIComponent(userId)}`, {
      headers: { "x-api-key": apiKey }
    }),
    // Thumbnails API tidak butuh API key, publik — tapi tetap lewat sini
    // supaya satu request saja dan tidak kena CORS dari browser.
    fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(userId)}&size=150x150&format=Png&isCircular=true`)
  ]);

  if (userResult.status !== "fulfilled") {
    return json({ ok: false, message: "Gagal menghubungi Roblox dari server: " + (userResult.reason && userResult.reason.message ? userResult.reason.message : "network error") });
  }
  const userRes = userResult.value;
  if (!userRes.ok) {
    if (userRes.status === 401 || userRes.status === 403) {
      return json({ ok: false, message: `API key ditolak (HTTP ${userRes.status}). Cek API key dan pastikan scope Users API sudah dicentang.` });
    }
    return json({ ok: false, message: `Roblox membalas HTTP ${userRes.status}.` });
  }
  const userData = await userRes.json().catch(() => ({}));

  let avatarUrl = null;
  if (avatarResult.status === "fulfilled" && avatarResult.value.ok) {
    const avatarData = await avatarResult.value.json().catch(() => null);
    const entry = avatarData && avatarData.data && avatarData.data[0];
    // state "Completed" berarti gambar beneran siap; kalau masih diproses
    // Roblox tetap ngasih imageUrl (kadang placeholder), jadi cek dulu.
    if (entry && entry.imageUrl && entry.state !== "Error") avatarUrl = entry.imageUrl;
  }

  return json({
    ok: true,
    username: userData.name || null,
    displayName: userData.displayName || userData.name || userId,
    avatarUrl
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
