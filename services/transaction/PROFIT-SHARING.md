# Sajada v0.20 — Penyertaan dan hak bagi hasil

## Status
Kode backend dan migrasi siap untuk lingkungan pengembangan; belum dihubungkan ke frontend atau dipasang pada PostgreSQL produksi. Web tetap simulasi browser. Status `settled` menyatakan hak pembagian sudah dibukukan pada subledger penyertaan, **bukan bukti transfer bank atau payout**. Modul ini belum membuat jurnal GL penyertaan/bagi hasil. Chart of accounts serta kebijakan pencatatan harus ditetapkan sebelum posting GL diaktifkan.

## Pemasangan
Jalankan `profit-sharing.sql` sekali sesudah postgresql.sql, hardening.sql dan member-number.sql, kemudian jalankan `profit-corrections.sql` sebagai migrasi 005 dan `profit-approval.sql` sebagai migrasi 006. Untuk database v0.18 yang sudah mempunyai migrasi 004, jalankan migrasi 005 kemudian 006 setelah backup dan pengujian staging. Database v0.19 cukup menjalankan migrasi 006. Jangan menjalankan ulang migrasi sebelumnya. Docker Compose hanya menjalankan migrasi 004 sampai 006 otomatis pada volume database baru; jangan menghapus volume lama untuk upgrade.

Tambahan hak role API (ganti `sajada_api` sesuai nama role aplikasi non-owner):

```sql
GRANT SELECT, INSERT ON sajada.investor TO sajada_api;
GRANT SELECT, INSERT, UPDATE ON sajada.capital_account, sajada.profit_report TO sajada_api;
```

Hak sebelumnya tetap diperlukan: USAGE schema, SELECT/UPDATE member untuk row lock, dan INSERT outbox. Role harus NOSUPERUSER NOBYPASSRLS. Jangan memberikan kredensial ini ke pengguna/browser: RLS mengandalkan konteks tenant yang diverifikasi API, dan validasi bisnis dilaksanakan layanan tepercaya.

Server memakai `profit-domain.mjs` yang dibangkitkan dari `shared/tiered-sharing.ts` dan `shared/funding.ts`. Apabila algoritma sumber diubah, jalankan `node services/transaction/build-profit-domain.mjs` dari checkout yang mempunyai dependensi root, lalu ulangi pengujian. File hasil sudah disertakan, sehingga container transaksi tidak membutuhkan TypeScript.

## API
Semua rute memerlukan Authorization Bearer JWT RS256 dan X-Tenant-Id yang termasuk `tenant_ids`. Actor diambil dari token `sub`. Peran staf: tenant_admin atau accountant; role berlaku sebagaimana klaim token saat ini, belum matriks role per tenant.

| Metode | Path | Hak |
|---|---|---|
| GET | /v1/investors | Staf |
| POST | /v1/investors | Tenant admin |
| GET | /v1/members/{uuid}/capital | Staf |
| POST | /v1/members/{uuid}/capital | Tenant admin |
| POST | /v1/profit-reports | Staf |
| GET | /v1/profit-reports | Staf; 100 terbaru |
| POST | /v1/profit-reports/{uuid}/approve | Tenant admin selain pembuat laporan |
| POST | /v1/profit-reports/{uuid}/settle | Staf, setelah persetujuan independen |
| POST | /v1/profit-reports/{uuid}/cancel | Tenant admin |

### 1 Registrasi investor
Klien membuat UUID satu kali dan mempertahankannya untuk retry. Nama harus 1–200 karakter.

```json
{"id":"UUID_INVESTOR","name":"Investor Sajada"}
```

POST `/v1/investors` mengembalikan 200. UUID yang sama dan nama berbeda ditolak 409. UUID/nama yang sama mengembalikan investor sebelumnya.

### 2 Catat penyertaan anggota
POST `/v1/members/{uuid}/capital`:

```json
{
  "reference":"BUKTI-PENYERTAAN-001",
  "funding":[
    {"investorId":"UUID_INVESTOR_A","amount":7500000},
    {"investorId":"UUID_INVESTOR_B","amount":5000000}
  ]
}
```

Total tepat Rp12.500.000. Satu sampai 100 investor unik yang terdaftar pada tenant; anggota harus aktif. Nama investor diambil dari database, tidak dipercaya dari input. Referensi mencatat bukti yang sudah diperiksa operator, bukan verifikasi bank otomatis. Saldo awal IDR12.500.000. Snapshot investor/kontribusi tidak boleh diubah. Retry identik mengembalikan akun lama; referensi/alokasi berbeda ditolak. Event `capital.recorded` ditulis satu kali. Satu akun penyertaan per anggota pada versi ini; putaran penyertaan ulang belum tersedia.

### 3 Buat laporan laba draft
POST `/v1/profit-reports` dengan `Idempotency-Key` unik dan stabil:

```json
{"member_id":"UUID_ANGGOTA","period":"2026-01","revenue":30000000,"cost":0}
```

Nominal rupiah bulat, maksimum satu triliun. Biaya tidak melebihi pendapatan: penanganan kerugian belum ditetapkan. Laba berasal dari input laporan staf, belum direkonsiliasi otomatis ke buku besar. Periode YYYY-MM harus lebih baru dari periode terakhir diselesaikan. Satu draft terbuka per anggota. Kunci yang sama dengan payload berbeda ditolak 409. Retry identik mengembalikan laporan yang sama (201), termasuk jika sudah settled.

Respons memuat `result.before`, `result.after`, `segments`, `memberShare`, `investorShare`, `capitalReturned`, `investorProfitShare`, `funding` dan `receipts` per investor. Draft belum mengubah saldo.

Contoh laba Rp30 juta pertama: anggota Rp6.937.500; investor menerima Rp23.062.500 termasuk modal Rp12.500.000. Setelah settlement, sisa modal nol dan akumulasi laba setelah balik modal Rp14.375.000. Ambang memakai rentang marginal 25/75 sampai 10 juta, 30/70 sampai 50 juta, 50/50 sampai 100 juta, lalu 60/40. Sebelum modal kembali: 20/80.

### 4 Persetujuan independen
POST `/v1/profit-reports/{uuid}/approve` oleh tenant_admin dengan token sub berbeda dari created_by:

```json
{"reference":"PERSETUJUAN-BAGI-HASIL-001"}
```

Pembuat laporan tidak boleh menyetujui sendiri, walaupun mempunyai role tenant_admin. Accountant tidak dapat menyetujui. Identitas kedua pihak berasal dari token terverifikasi; pengelolaan akun pada identity provider harus memastikan identitas tersebut benar-benar mewakili orang berbeda. Backend membandingkan sub, bukan identitas fisik di luar sistem.

Persetujuan mencatat approved_by, approved_at, approval_reference dan event `profit.report.approved`, tanpa mengubah saldo. Untuk kompatibilitas, status laporan masih `draft`; tampilkan sebagai “disetujui” bila approved_by terisi dan status masih draft. Jangan menyimpulkan kesiapan settlement hanya dari status draft. Retry oleh pemberi persetujuan yang sama dengan referensi sama mengembalikan laporan lama (200), termasuk setelah settlement; pergantian referensi/pemberi persetujuan ditolak 409. Self approval ditolak 403. Laporan cancelled tidak dapat disetujui.

Persetujuan tidak dapat dihapus atau diganti. Draf yang sudah disetujui tetap dapat dibatalkan oleh admin melalui endpoint cancel; audit persetujuannya tetap tersimpan. Laporan pengganti wajib memperoleh persetujuan baru dan tidak mewarisi persetujuan lama. Akun dan laporan dikunci dengan urutan yang sama pada approve, cancel dan settle.

### 5 Selesaikan hak pembagian
POST `/v1/profit-reports/{uuid}/settle`:

```json
{"reference":"PENETAPAN-BAGI-HASIL-001"}
```

Wajib memiliki approved_by dari pihak selain pembuat laporan; tanpa persetujuan respons 409. Pelaksana settlement boleh pembuat atau pemberi persetujuan yang memiliki hak staf; tidak diwajibkan pihak ketiga. Mengunci akun anggota kemudian laporan, memastikan snapshot awal masih berlaku, memutakhirkan saldo, menandai settled beserta actor/waktu/referensi, dan menulis `profit.entitlement.settled` secara atomik. Kegagalan rollback seluruh perubahan. Retry dengan report ID dan referensi yang sama aman; referensi berbeda ditolak 409. Idempotensi settlement berdasarkan report ID dan referensi, bukan header baru. Laporan settled tidak dapat diubah atau dihapus. Alokasi modal investor dibatasi maksimum kontribusi; pembulatan rupiah mempertahankan total.

### 6 Batalkan draf yang keliru
POST `/v1/profit-reports/{uuid}/cancel`, hanya tenant_admin:

```json
{"reference":"KOREKSI-001","reason":"Biaya pengiriman belum dimasukkan"}
```

Alasan wajib 1–1000 karakter setelah trim; referensi 1–128 karakter. Actor berasal dari token sub. API mengunci akun kemudian laporan, mengubah hanya status/audit pembatalan, dan menulis `profit.draft.cancelled` dalam transaksi yang sama. Saldo modal dan akumulasi laba tidak berubah. Respons 200 memuat status cancelled, cancelled_by, cancelled_at, cancellation_reference, cancellation_reason. Retry dengan report ID, referensi dan alasan yang sama mengembalikan baris lama. Payload berbeda menghasilkan 409. Laporan settled tidak dapat dibatalkan; laporan cancelled tidak dapat diselesaikan, diubah atau dihapus. Actor pertama tetap tersimpan pada retry.

### 7 Buat laporan pengganti
POST `/v1/profit-reports` dengan **Idempotency-Key baru**:

```json
{
  "member_id":"UUID_ANGGOTA",
  "period":"2026-02",
  "revenue":10000000,
  "cost":2000000,
  "replaces_report_id":"UUID_DRAF_YANG_DIBATALKAN"
}
```

Tenant, anggota dan periode harus sama dengan laporan cancelled yang dirujuk. Riwayat lama tidak ditimpa. Satu laporan hanya boleh memiliki satu pengganti. Bila pengganti juga salah, batalkan pengganti itu kemudian arahkan replaces_report_id ke ID pengganti terakhir; rantai koreksi tidak boleh bercabang. Saldo awal perhitungan diambil dari laporan settled, sehingga laba draf batal tidak ikut terakumulasi. Periode yang sudah settled atau lebih lama dari settlement terakhir tetap ditolak.

Retry kunci draf lama mengembalikan laporan lama dengan status cancelled; tidak menghidupkannya kembali. Fingerprint permintaan biasa tanpa replaces_report_id tetap kompatibel dengan v0.18. API daftar laporan menyertakan status cancelled dan tautan replaces_report_id; klien harus memfilter status sesuai tujuan tampilan, bukan menganggap seluruh laporan sebagai laba yang sudah diselesaikan.

Migrasi 005 menambahkan kolom audit dan tautan pengganti, mengganti batas unik periode dengan indeks unik laporan aktif, serta mengunci baris cancelled/settled melalui trigger. Tidak ada hak database baru yang diperlukan di luar role layanan v0.18. Otorisasi admin berlaku pada API; role SQL tetap hanya untuk layanan backend tepercaya.

### Migrasi persetujuan dan riwayat lama
Migrasi 006 tidak membuat persetujuan fiktif untuk laporan settled lama. Kolom approved_by/approved_at/approval_reference pada baris historis tetap NULL dan status lama tetap settled. Klien harus menandainya sebagai riwayat sebelum kebijakan persetujuan. Retry settlement historis tetap mengembalikan hasil lama tanpa mutasi. Draf yang masih terbuka sesudah upgrade wajib melewati persetujuan baru sebelum settlement.

Trigger mencegah insert laporan yang langsung approved/settled, perubahan approval yang sudah ada, serta transisi draft ke settled tanpa approval sebelumnya. CHECK menolak approval oleh created_by dan metadata parsial. Role database layanan tetap tepercaya dan tidak boleh diberikan ke pengguna; peran tenant_admin diperiksa API, bukan diturunkan dari teks actor yang dikirim ke SQL secara langsung.

## Pengujian
- `node --test services/db-tests/profit.test.mjs`: 32 subtes database lulus, termasuk pengamanan persetujuan, pembatalan dan koreksi.
- `node --test services/db-tests/http-orders.test.mjs`: 38 subtes HTTP lulus; mencakup JWT, tenant, nomor, order/payment, penyertaan/bagi hasil, koreksi dan persetujuan independen.
- Migrasi 001 sampai 006 dieksekusi pada PGlite 0.5.8. Role uji non-owner NOSUPERUSER NOBYPASSRLS.
- `node --test services/db-tests/approval-upgrade.test.mjs`: 2 skenario migrasi lulus dengan fixture settled dan draft v0.19; saldo/riwayat lama tetap utuh dan draf terbuka memerlukan persetujuan.
- HTTP menggunakan server JWKS lokal dan JWT bertanda tangan. Adapter mengubah hasil SELECT PGlite ke rowCount seperti pg; numeric uang tetap string dari SQL, dikonversi secara eksplisit pada validasi domain/test.

Bukan pengujian PostgreSQL native paralel atau identity provider produksi. Pengujian konkurensi, pemulihan backup, bank/payout, ClickHouse hidup dan integrasi antarmuka belum dilakukan.

## Batas berikutnya
Draf dapat dibatalkan dengan audit dan dibuat penggantinya. Persetujuan dua identitas sudah diterapkan. Reversal laporan settled, periode akuntansi dan audit operasional lengkap masih perlu diterapkan sebelum penggunaan produksi. Tidak ada endpoint untuk menaikkan saldo atau mengganti snapshot investor. Perlu paginasi untuk daftar, indeks/retensi event, pengendalian akses lebih rinci serta rekonsiliasi GL. Analytics consumer sudah dapat membawa event baru secara generik, tetapi agregasi laporan penyertaan dan view analytics khusus belum dibuat.
