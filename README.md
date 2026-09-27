# BaxDev — Roblox Audio Studio

Static site + 2 Cloudflare Pages Functions, tanpa build step dan tanpa login.
Semua state (settings, VIP list, password owner, metadata track) di `localStorage`;
audio blob-nya sendiri di `IndexedDB` (localStorage cuma ~5-10MB, tidak cukup untuk
audio — apalagi setelah diproses ulang jadi WAV oleh fitur speed).

**Library cuma berisi audio yang sudah berhasil di-publish ke Roblox.** Di halaman
Upload, tombol staging bernama **Publish ke Roblox** (bukan "Tambah ke Library") —
menekannya langsung memproses kecepatan lalu upload ke Roblox. Track baru ditulis
ke Library (dan blob-nya baru disimpan ke IndexedDB) kalau upload itu sukses; kalau
gagal, kartu preview tetap di staging dengan pesan error dan tombol "Coba Lagi",
tidak pernah masuk Library sebagai draft basi.

**Jalur upload dikunci ke satu mode** (Cloudflare Pages Function bawaan,
`/api/roblox-upload`) — opsi "Proxy Sendiri" yang dulu ada di Pengaturan sudah
dihapus dari UI maupun dari `roblox.js`/`storage.js`, jadi tidak ada lagi cara
mengganti jalur upload dari luar kode.

## Struktur

```
index.html      Dashboard (splash loader + stats + plan)
upload.html     Upload file / YouTube URL + speed preset + upload langsung ke Roblox
library.html    Daftar track + Publish ke Roblox
settings.html   User ID, API Key, mode upload, Cek Koneksi
owner.html      Terkunci password lokal — kelola daftar VIP User ID
assets/
  style.css
  storage.js      localStorage + IndexedDB + toast + VIP/quota
  audio-speed.js  pemroses kecepatan audio (Web Audio API, nyata — bukan label kosong)
  player.js       preview audio custom (play/pause, seek, waktu)
  roblox.js       publish + test koneksi (mode bawaan Cloudflare / proxy sendiri)
functions/api/
  roblox-upload.js   Function: proxy upload ke Roblox Open Cloud Assets API
  roblox-test.js     Function: proxy cek kredensial ke Roblox Users API
  roblox-profile.js  Function: proxy nama + avatar Roblox (dipakai ikon akun & welcome card dashboard)
```

## Deploy — harus Cloudflare Pages

Upload ke Roblox lewat mode bawaan (default) butuh folder `functions/` ikut ter-deploy,
dan itu konvensi khusus **Cloudflare Pages**:

- Dashboard → Workers & Pages → Create → Pages → Direct Upload, upload isi folder
  `baxdev/` ini (bukan cuma HTML-nya) — Functions terdeteksi dan aktif otomatis, tidak
  perlu `wrangler.toml` atau build command.
- Lokal: `npx wrangler pages dev baxdev` dari luar folder ini untuk coba dengan Functions aktif.

Kalau di-deploy ke host statis lain (Netlify, Vercel, GitHub Pages) atau dibuka langsung
dari `file://`, folder `functions/` tidak akan berjalan — tombol Upload akan gagal dengan
pesan jelas ("endpoint tidak ditemukan"), bukan pura-pura berhasil. Untuk host selain
Cloudflare, isi *Proxy Base URL* kamu sendiri di Pengaturan (lihat bawah).

## Soal upload ke Roblox — satu jalur, dikunci

Browser mengirim file ke `/api/roblox-upload` (satu origin dengan situs ini, jadi
CORS tidak masalah), lalu Function itu yang meneruskan ke
`https://apis.roblox.com/assets/v1/assets` dari server memakai kontrak resmi Roblox
(`x-api-key` header, multipart `request` + `fileContent`). Roblox Open Cloud API dibuat
untuk pemanggilan server-ke-server dan tidak mengirim header CORS ke origin browser,
makanya pemanggilan langsung dari browser gagal — Function ini yang jadi "server" itu.
Tidak ada mode lain (mode "Proxy Sendiri" yang dulu ada sudah dihapus) — kalau situs
belum ter-deploy ke Cloudflare Pages, publish gagal dengan pesan jelas ("endpoint
tidak ditemukan"), bukan pura-pura berhasil dan bukan pula diam-diam lari ke jalur lain.

Tombol **Cek Koneksi** di Pengaturan memanggil `/api/roblox-test` (Function ini yang
lalu memanggil `GET https://apis.roblox.com/cloud/v2/users/{userId}` di server) untuk
verifikasi kredensial asli.

Avatar di ikon akun (topbar) dan kartu "Selamat datang kembali" di Dashboard sama-sama
lewat `/api/roblox-profile`, yang di server memanggil Users API (nama) dan Thumbnails
API (avatar) sekaligus. Ini juga proxy server-side seperti dua di atas — thumbnails.roblox.com
tidak mengirim header CORS ke browser, jadi kalau dipanggil langsung dari client selalu
gagal diam-diam. Kartu welcome cuma muncul kalau User ID + API Key di Pengaturan valid
dan Roblox berhasil dihubungi; kalau belum "login" atau gagal, kartu tetap disembunyikan
(tidak menampilkan state error di Dashboard).

## Publish langsung dari halaman Upload

Setiap file/hasil convert YouTube masuk dulu ke staging sebagai kartu preview dengan
tombol **Publish ke Roblox**. Menekannya memproses kecepatan (kalau bukan 1×, jadi WAV),
lalu langsung upload ke Roblox dengan progress bar real-time. Track **baru ditulis ke
Library setelah upload sukses** — orkestratornya `BaxdevRoblox.publishNewTrack`. Kalau
gagal, kartu tetap di staging dengan pesan error dan tombol "Coba Lagi"; tidak pernah ada
entri "draft" yang nongkrong di Library tanpa pernah ter-upload. Publish ulang track yang
sudah ada di Library (mis. setelah edit nama) tetap lewat `BaxdevRoblox.publishTrackById`
di `library.html`, orkestrator terpisah untuk track yang memang sudah tersimpan.

## Fitur kecepatan audio

Preset 0.25×–2× di halaman Upload memproses audio **sungguhan** lewat Web Audio
API (`OfflineAudioContext` + `playbackRate`) sebelum disimpan — bukan cuma label
UI. Selain 1×, hasil disimpan sebagai WAV 16-bit PCM karena encoder browser
native tidak bisa menulis balik ke MP3/OGG/dsb. Konsekuensinya file jadi lebih
besar (tidak terkompresi) — untuk klip panjang, kuota IndexedDB perangkat bisa
jadi pertimbangan.

## Owner Panel

Password owner disimpan sebagai hash SHA-256 di `localStorage` — ini proteksi
level perangkat/browser saja (siapa pun yang menghapus localStorage bisa
membuat ulang password), cukup untuk alat internal single-admin, bukan
pengaman multi-user yang sesungguhnya.
