# Database Sajada v0.42

## PostgreSQL

- `database/postgresql-full-schema.sql`: skema dan seluruh migrasi 001–020 untuk database baru/kosong.
- `database/migrations.json`: urutan file sumber asli, sama dengan nomor initialization pada Compose.
- `database/schema-dictionary.json`: tabel, kolom, constraint, indeks, policy RLS dari engine yang menjalankan SQL gabungan.
- `database/erd.mmd`: relasi FK dalam format Mermaid.

Buat database target kosong dan jalankan sebagai schema owner:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/postgresql-full-schema.sql
```

DATABASE_URL di langkah ini adalah koneksi migrasi owner; API memakai koneksi role non-owner yang berbeda. SQL gabungan bukan migrator incremental dan tidak aman dijalankan ulang pada database berisi schema/data existing. Pada database existing jalankan hanya migrasi yang belum diterapkan, dalam urutan migrations.json, dengan backup dan review schema Anda. Migrasi tidak otomatis mencatat versi dalam migration table.

Isolasi memakai tenant_id, FK komposit, RLS dan claim JWT terverifikasi. Role API harus NOSUPERUSER NOBYPASSRLS; grant minimum per modul dijelaskan pada file NUMBERING.md, PROFIT-SHARING.md, INVENTORY.md dan CAPITAL-WALLET.md. Password/role deployment tidak di-hardcode pada paket.

Data anggota/pembelian/saldo operasional tidak disertakan. Unit tests mempunyai fixture contoh dan membuat database in-memory sendiri; fixture bukan seed produksi.

## ClickHouse

`database/clickhouse-active-schema.sql` berasal dari services/analytics/schema.sql, dipakai consumer domain_event yang tersedia. `architecture/clickhouse.sql` adalah blueprint sales_event lain; jangan menyamakannya dengan tabel consumer yang aktif. Tenant filter wajib di query analytics. RLS PostgreSQL tidak otomatis berlaku di ClickHouse.

## Verifikasi paket

Seluruh 20 tahap SQL gabungan berhasil dijalankan pada PostgreSQL embedded (PGlite + pgcrypto) sebelum dictionary dihasilkan. Verifikasi ini tidak menggantikan test pada PostgreSQL native/deployment Anda.
