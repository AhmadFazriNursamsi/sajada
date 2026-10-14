# Database Sajada v0.42

## PostgreSQL

- `database/postgresql-full-schema.sql`: skema dan seluruh migrasi 001–023 untuk database baru/kosong.
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

## Penyimpanan web (migrasi 021–023)

Aplikasi web menyimpan seluruh data koperasi di PostgreSQL melalui `lib/server/workspace/`:

| Bagian web | Tabel |
|---|---|
| Anggota, katalog | `member`, `product` (kolom tampilan web ditambah migrasi 021) |
| Pesanan, lunas | `sales_order` (+`reference` nomor SJ-…), `order_item`, `web_order_payment` |
| Gudang & kartu stok | `inventory_location` (+`region_label` teks bebas), `inventory_balance`, `inventory_document`, `inventory_movement`, `product_stock_move` |
| Safety stock & PO | `reorder_policy`, `purchase_order`, `purchase_receipt`, `purchase_supplier`, `purchase_confirmation`, `purchase_inspection`, `purchase_replacement`, `purchase_replacement_reversal` |
| Nomor anggota | `member_number`, `member_number_counter` |
| Jaringan MLM | `member.sponsor_id` (+`network_seq`) |
| Investor | `investor` (+`code`) |
| Modal & biaya, alokasi dana, bagi hasil bertingkat, laporan lama, komisi, wilayah, buku besar | tabel `web_*` (migrasi 022) |

Kolom `seq` menjaga urutan daftar seperti di aplikasi. Bagian yang aturannya berbeda dari modul akuntansi API (aktivasi saldo tanpa jurnal, bagi hasil tanpa persetujuan terpisah, tagihan manual multi-mata uang) memakai tabel `web_*` sehingga tidak tercampur dengan catatan resmi API. `web_workspace_revision` mencegah tab/perangkat lain menimpa perubahan.

Grant role aplikasi lokal ada di `services/local-dev-role.sql` (dipakai `pnpm db:setup`): SELECT/INSERT/UPDATE pada tabel schema, DELETE hanya pada tabel `web_*`, dan EXECUTE `sajada.web_clear_workspace` untuk reset/pemulihan demo. Fungsi tersebut melewati penjaga append-only; jangan diberikan pada database produksi.

Login web memakai `services/transaction/web-auth.sql` (idempoten; dipasang `db-setup` dan `pnpm db:setup` setiap kali, juga pada database lama): `app_user` (username, nama, peran, hash scrypt, status, akun anggota/investor terhubung ke `member`/`investor`), `app_user_tenant` (koperasi yang boleh dibuka akun staf), `app_session` (hanya SHA-256 token sesi), dan `app_user_audit` (login, gagal login, perubahan akun; append-only untuk role aplikasi). Role aplikasi boleh DELETE pada `app_session` dan `app_user_tenant`.

## ClickHouse

`database/clickhouse-active-schema.sql` berasal dari services/analytics/schema.sql, dipakai consumer domain_event yang tersedia. `architecture/clickhouse.sql` adalah blueprint sales_event lain; jangan menyamakannya dengan tabel consumer yang aktif. Tenant filter wajib di query analytics. RLS PostgreSQL tidak otomatis berlaku di ClickHouse.

## Verifikasi paket

Seluruh 20 tahap SQL gabungan berhasil dijalankan pada PostgreSQL embedded (PGlite + pgcrypto) sebelum dictionary dihasilkan. Verifikasi ini tidak menggantikan test pada PostgreSQL native/deployment Anda.
