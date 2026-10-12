# Sajada — Koperasi Usaha Janda dan Duda

Paket source v0.42. Satu aplikasi Next.js (web React + API transaksi `/v1/*` pada port yang sama), PostgreSQL, consumer outbox ClickHouse, dan starter Expo React Native.

## Status implementasi

Web yang tersedia adalah demo tenant-local dalam localStorage. API PostgreSQL berjalan dalam aplikasi Next.js yang sama, tetapi halaman web belum memanggilnya. Portal toko anggota mandiri, pencairan hasil penjualan nyata, self-service JWT anggota, backend FX/MLM lengkap, dan refund setelah pengiriman belum aktif. Komponen Redis/Kafka/Keycloak yang dibahas pada blueprint belum seluruhnya diimplementasikan. Mobile berupa starter, belum APK/IPA.

Penyertaan anggota Rp12,5 juta terdiri dari Rp10 juta saldo belanja koperasi + Rp2,5 juta iuran/admin/lainnya yang rinciannya dapat dikonfigurasi. Dasar recovery investor tetap Rp12,5 juta; bagi hasil bertingkat mengikuti keputusan sebelumnya. Saldo hanya untuk pesanan koperasi dan refund penuh sebelum pengiriman; tidak ada tarik tunai/transfer eksternal.

## Struktur

| Folder | Isi |
|---|---|
| app/, components/, shared/ | Web, domain, inventory, MLM, akuntansi, e-wallet, test |
| services/transaction/ | API, generated runtime domain, 19 migrasi lanjutan, panduan API |
| services/db-tests/ | Pengujian PostgreSQL embedded, JWT/HTTP, RLS dan rollback |
| services/analytics/ | Consumer outbox dan skema ClickHouse aktif |
| database/ | SQL PostgreSQL lengkap, urutan migrasi, dictionary dan relasi |
| architecture/ | Blueprint dan SQL awal; sebagian modul masih rancangan |
| mobile/ | Starter React Native/Expo |
| docs/ | Panduan GitHub dan database |

## Menjalankan aplikasi

Gunakan Node.js 22.13+ dan pnpm sesuai `packageManager`, serta Docker untuk PostgreSQL.

```bash
pnpm install --frozen-lockfile
pnpm dev:all     # PostgreSQL (Docker) + Next.js di http://127.0.0.1:5173
pnpm dev         # hanya Next.js (web + API), jika PostgreSQL sudah berjalan
pnpm build && pnpm start   # mode production di port 5173
```

Web dan API berjalan dalam satu proses Next.js:

| Path | Isi |
|---|---|
| `/` | Web (demo, data di localStorage browser) |
| `/v1/*` | API transaksi (`app/v1/[...path]/route.ts` → `lib/transaction-api.ts` → handler `services/transaction/server.mjs`) |
| `/healthz` | Status API |

Konfigurasi API dibaca dari `.env.local` (tidak di-commit): `DATABASE_URL` untuk role aplikasi non-owner, `OIDC_JWKS_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE`. Tanpa konfigurasi tersebut `/v1/*` dan `/healthz` menjawab 503; web tetap berjalan.

## PostgreSQL dan ClickHouse

Lihat [panduan database](docs/DATABASE.md). `services/compose.yaml` menyediakan database lokal dan 20 tahap initialization PostgreSQL, hanya saat volume masih kosong. Password harus diberikan melalui environment Anda. Jangan menghapus volume data yang masih diperlukan.

API berjalan di dalam Next.js (lihat di atas). `services/transaction/server.mjs` masih dapat dijalankan mandiri (`npm start` di folder itu) dan dipakai oleh pengujian HTTP. Contoh variabel tanpa rahasia tersedia di `.env.example`.

Panduan terbaru: [inventory/AP/PO](services/transaction/INVENTORY.md), [e-wallet/refund](services/transaction/CAPITAL-WALLET.md), [bagi hasil](services/transaction/PROFIT-SHARING.md), [penomoran anggota](services/transaction/NUMBERING.md). Dokumen v0.2/v0.21 di source adalah riwayat pengembangan dan tidak menggantikan panduan terbaru.

## Pengujian

```bash
node --test shared/*.test.mjs
cd services/transaction && npm ci && npm test
cd ../db-tests && npm ci && npm test
```

HTTP test membutuhkan dependency jose dari services/transaction. Node 24 mendukung pembacaan file TypeScript pada test domain. Pengujian terakhir mencakup 441 test dari shared + HTTP orders + inventory + profit; suite lain juga disertakan. Database memakai PGlite embedded, bukan pembuktian konkurensi native PostgreSQL. Browser, Docker runtime, ClickHouse live, OIDC produksi dan perangkat mobile belum diverifikasi.

## GitHub

Lihat [GITHUB.md](docs/GITHUB.md). Paket ini tidak memuat node_modules, hasil build, .git, token atau .env berisi kredensial. Lockfiles, generated runtime, template environment kosong dan lisensi vendor dipertahankan. Tidak ada lisensi proyek baru yang ditetapkan; pemilik perlu menentukan lisensi distribusi.

Source provenance dan SHA-256 per file terdapat pada SOURCE-MANIFEST.json.
