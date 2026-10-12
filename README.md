# Sajada — Koperasi Usaha Janda dan Duda

Paket source v0.42. Web React dengan struktur Next.js-compatible melalui Vinext, backend Node.js/PostgreSQL, consumer outbox ClickHouse, dan starter Expo React Native.

## Status implementasi

Web yang tersedia adalah demo tenant-local dalam localStorage. API PostgreSQL tersedia terpisah dan belum terhubung web. Portal toko anggota mandiri, pencairan hasil penjualan nyata, self-service JWT anggota, backend FX/MLM lengkap, dan refund setelah pengiriman belum aktif. Komponen Redis/Kafka/Keycloak yang dibahas pada blueprint belum seluruhnya diimplementasikan. Mobile berupa starter, belum APK/IPA.

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

## Menjalankan web

Gunakan Node.js 24 (minimal versi pada package.json), Corepack/pnpm sesuai packageManager dan pnpm-lock.yaml:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Profil clone bersih otomatis portable. Dev menggunakan Vinext; URL/port ditampilkan di terminal (default 5173). `pnpm build` membuat build dan `pnpm start` menjalankannya dengan Wrangler lokal. File konfigurasi host privat tidak disertakan identitas Site asal. Untuk hosting baru, gunakan identitas/config milik deployment Anda sendiri.

## PostgreSQL dan ClickHouse

Lihat [panduan database](docs/DATABASE.md). `services/compose.yaml` menyediakan database lokal dan 20 tahap initialization PostgreSQL, hanya saat volume masih kosong. Password harus diberikan melalui environment Anda. Jangan menghapus volume data yang masih diperlukan.

API: `cd services/transaction && npm ci`, set DATABASE_URL untuk role aplikasi non-owner, OIDC_JWKS_URL, OIDC_ISSUER, OIDC_AUDIENCE, lalu `npm start`. Contoh variabel tanpa rahasia tersedia di `.env.example`. Backend tidak otomatis membaca file .env; export variabel atau gunakan mekanisme environment deployment.

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
