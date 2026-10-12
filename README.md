# Sajada — Koperasi Usaha Janda dan Duda

Paket source v0.42. Satu aplikasi Next.js (web React + API transaksi `/v1/*` pada port yang sama), PostgreSQL, consumer outbox ClickHouse, dan starter Expo React Native.

## Status implementasi

Seluruh data web (anggota, katalog, pesanan, stok, PO, modal, investor, bagi hasil, komisi, wilayah, buku besar) disimpan di PostgreSQL per koperasi; localStorage tidak dipakai lagi. Web belum mempunyai login: fungsi server web hanya melayani komputer lokal (`SAJADA_LOCAL_MODE=1`, host 127.0.0.1). Aturan bisnis web tetap seperti demo; aktivasi saldo, bagi hasil, dan tagihan pemasok dari web belum membuat jurnal/persetujuan seperti modul akuntansi API `/v1`. Portal toko anggota mandiri, pencairan hasil penjualan nyata, self-service JWT anggota, backend FX/MLM lengkap, dan refund setelah pengiriman belum aktif. Komponen Redis/Kafka/Keycloak yang dibahas pada blueprint belum seluruhnya diimplementasikan. Mobile berupa starter, belum APK/IPA.

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
pnpm db:setup    # sekali: PostgreSQL (Docker), role aplikasi, .env.local, data demo
pnpm dev:all     # PostgreSQL + Next.js di http://127.0.0.1:5173
pnpm dev         # hanya Next.js, jika PostgreSQL sudah berjalan
pnpm build && pnpm start   # mode production di port 5173
```

Atau jalankan semuanya di Docker (setelah `pnpm db:setup` sekali, yang membuat `services/.env`):

```bash
pnpm docker:up     # PostgreSQL + role aplikasi + app (build production) → http://127.0.0.1:3000
pnpm docker:logs   # log aplikasi
pnpm docker:down   # hentikan container (data PostgreSQL tetap di volume)
```

Container `app` dibangun dari `Dockerfile` (Node 24), mengisi koperasi demo yang belum ada saat start, dan hanya dipublikasikan di 127.0.0.1 karena belum ada login. Service `db-setup` menjalankan `services/local-dev-role.sql` setiap kali naik. ClickHouse ada di profil `analytics` (`docker compose --project-directory services --profile analytics up -d`). Bila port 5432 sudah dipakai, salin `services/compose.override.example.yaml` menjadi `services/compose.override.yaml`. `pnpm dev`/`dev:all` (port 5173) dan container (port 3000) memakai database yang sama. Image aplikasi sekitar 300 MB (output `standalone` Next.js); build membutuhkan beberapa GB ruang disk sementara, bersihkan dengan `docker builder prune` bila disk menipis.

`pnpm db:setup` aman dijalankan ulang: password di `services/.env`, isi `.env.local`, dan data yang sudah ada dipertahankan. `pnpm db:seed` hanya mengisi koperasi demo yang belum ada.

Web dan API berjalan dalam satu proses Next.js:

| Path | Isi |
|---|---|
| `/` | Web; data dimuat/disimpan lewat server function `app/actions/workspace.ts` |
| `/v1/*` | API transaksi (`app/v1/[...path]/route.ts` → `lib/transaction-api.ts` → handler `services/transaction/server.mjs`) |
| `/healthz` | Status API |

Penyimpanan web (`lib/workspace-store.ts` → `lib/server/workspace/`): setiap simpan memvalidasi seluruh data koperasi dengan aturan backup (`shared/backup.ts`) lalu menulis perubahan ke tabel relasional dalam satu transaksi dengan RLS per koperasi. Riwayat (pesanan, kartu stok, PO, nomor anggota) tidak dapat dihapus atau diubah lewat simpan biasa. Bila koperasi sudah diubah di tab/perangkat lain, simpan ditolak dan data terbaru dimuat ulang. Reset demo dan pemulihan backup memakai fungsi `sajada.web_clear_workspace`, yang hanya diberikan ke role lokal dan ditolak bila API sudah mencatat jurnal/modal untuk koperasi tersebut.

Konfigurasi dibaca dari `.env.local` (tidak di-commit): `DATABASE_URL` untuk role aplikasi non-owner, `SAJADA_LOCAL_MODE=1`, serta `OIDC_JWKS_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE` untuk `/v1/*`. Tanpa `DATABASE_URL`/OIDC, `/v1/*` dan `/healthz` menjawab 503.

## PostgreSQL dan ClickHouse

Lihat [panduan database](docs/DATABASE.md). `services/compose.yaml` menyediakan database lokal dan 23 tahap initialization PostgreSQL, hanya saat volume masih kosong. Password harus diberikan melalui environment Anda. Jangan menghapus volume data yang masih diperlukan.

API berjalan di dalam Next.js (lihat di atas). `services/transaction/server.mjs` masih dapat dijalankan mandiri (`npm start` di folder itu) dan dipakai oleh pengujian HTTP. Contoh variabel tanpa rahasia tersedia di `.env.example`.

Panduan terbaru: [inventory/AP/PO](services/transaction/INVENTORY.md), [e-wallet/refund](services/transaction/CAPITAL-WALLET.md), [bagi hasil](services/transaction/PROFIT-SHARING.md), [penomoran anggota](services/transaction/NUMBERING.md). Dokumen v0.2/v0.21 di source adalah riwayat pengembangan dan tidak menggantikan panduan terbaru.

## Pengujian

```bash
node --test shared/*.test.mjs
cd services/transaction && npm ci && npm test
cd ../db-tests && npm ci && npm test
```

HTTP test membutuhkan dependency jose dari services/transaction. Node 24 mendukung pembacaan file TypeScript pada test domain. `services/db-tests/web-workspace.test.mjs` menguji penyimpanan web (semua bagian data, RLS antar-koperasi, perlindungan riwayat, reset dan pemulihan backup) pada PGlite. Hasil terakhir: 233 test shared, 4 test transaction, 231 test db-tests. Database memakai PGlite embedded, bukan pembuktian konkurensi native PostgreSQL. ClickHouse live, OIDC produksi dan perangkat mobile belum diverifikasi.

`node database-docs.mjs` (di `services/db-tests`) membangun ulang `database/postgresql-full-schema.sql`, `schema-dictionary.json` dan `erd.mmd` dari `database/migrations.json`; `--check` memeriksa apakah file tersebut masih sesuai.

## GitHub

Lihat [GITHUB.md](docs/GITHUB.md). Paket ini tidak memuat node_modules, hasil build, .git, token atau .env berisi kredensial. Lockfiles, generated runtime, template environment kosong dan lisensi vendor dipertahankan. Tidak ada lisensi proyek baru yang ditetapkan; pemilik perlu menentukan lisensi distribusi.

Source provenance dan SHA-256 per file terdapat pada SOURCE-MANIFEST.json.
