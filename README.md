# Domino Gaple 2v2 Online

Implementasi game Domino Gaple 2 vs 2 dengan server authoritative, dua seat manusia, dua bot AI, UI web mobile-style, dan scoring sesuai spesifikasi lomba Gaple Indonesia.

## Jalankan

```powershell
npm run dev
```

Buka:

```text
http://localhost:3000
```

## Test Engine

```powershell
npm test
```

## Persiapan Deploy

Kamu tidak wajib membuat dua repo terpisah. Satu repo ini bisa dipakai untuk dua service:

- Railway menjalankan backend dari root repo dengan `npm start`.
- Vercel membangun frontend statis dari `public/` ke `dist/` dengan `npm run build:frontend`.

### Railway Backend

1. Push repo ini ke GitHub.
2. Di Railway, buat project dari repo tersebut.
3. Pastikan service memakai root directory `/`.
4. Tambahkan domain publik Railway.
5. Set variable berikut:

```text
ALLOWED_ORIGINS=https://your-frontend.vercel.app
GAPLE_MC=120
BOT_DELAY_MS=1500
NEXT_ROUND_DELAY_MS=5600
```

Railway akan memberi `PORT` otomatis. Backend punya healthcheck di `/healthz`.

### Vercel Frontend

1. Import repo yang sama ke Vercel.
2. Framework Preset: `Other`.
3. Build Command: `npm run build:frontend`.
4. Output Directory: `dist`.
5. Set environment variable:

```text
GAPLE_API_BASE_URL=https://your-backend.up.railway.app
```

Setelah Railway dan Vercel punya domain final, update:

- Di Railway: `ALLOWED_ORIGINS` isi domain Vercel.
- Di Vercel: `GAPLE_API_BASE_URL` isi domain Railway.

Kalau ingin dua repo, backend cukup membawa `server/`, `package.json`, `railway.json`, dan file test. Frontend cukup membawa isi `public/`, `scripts/build-frontend.js`, `vercel.json`, dan `package.json`. Untuk proyek ini, satu repo lebih praktis.

Catatan: room/game state masih disimpan di memory backend. Pakai satu instance backend saja; kalau Railway restart/redeploy, room aktif akan hilang. Kalau nanti ingin room tahan restart atau multi-instance, perlu tambah Redis atau database.

## Struktur

- `server/engine.js` - aturan inti, validasi move, pass, gaple, scoring kecil/besar, tutup balak, balak mati, mutih.
- `server/bot.js` - bot probabilistik dengan memory pass, kontrol endpoint, dan Monte Carlo playout.
- `server/index.js` - HTTP server native Node.js, API room, action validation, SSE real-time updates.
- `public/` - lobby, meja, kartu domino visual, tracker angka, log, dan kontrol player.
- `test/engine.test.js` - regresi aturan kritis.

## Room dan Seat

- Seat 0: pemain utama, Team A, posisi bawah.
- Seat 1: Bot Kanan, Team B.
- Seat 2: partner, Team A, posisi atas.
- Seat 3: Bot Kiri, Team B.

Untuk main cepat, buat room lalu klik `Solo + AI Partner`. Untuk 2 manusia, player pertama buat room dan partner join memakai link invite.

## Konfigurasi AI

Default bot menjalankan 300 playout Monte Carlo per kandidat move.

```powershell
$env:GAPLE_MC=120
node server/index.js
```

Nilai lebih kecil membuat bot lebih cepat, nilai lebih besar membuat bot lebih teliti.
