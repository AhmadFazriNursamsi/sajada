# Sajada v0.26 — Persediaan tempat anggota dan depot wilayah

## Cakupan
Lokasi berjenjang: depot provinsi → depot kabupaten → depot kecamatan → tempat anggota. Satu tempat persediaan per anggota pada versi ini. Setiap saldo mempunyai kombinasi tenant + lokasi + produk. Stok memakai unit barang bulat, maksimal satu miliar per saldo; satuan berat pecahan, batch, serial number, tanggal kedaluwarsa, kepemilikan konsinyasi dan penilaian HPP belum tersedia.

Web menyediakan simulasi browser yang terpisah per tenant. Backend Node.js dan PostgreSQL tersedia dalam source serta diuji dengan PGlite; belum terhubung ke web atau dipasang pada PostgreSQL produksi. Kode consumer analytics tersedia, tetapi ClickHouse hidup belum diverifikasi.

## Saldo dan dokumen
- Fisik: barang yang sudah diterima dan masih berada di lokasi.
- Reservasi: bagian stok fisik yang ditahan untuk pesanan.
- Tersedia: fisik dikurangi reservasi.
- Dalam perjalanan: transfer telah keluar dari asal tetapi belum diterima tujuan; bukan stok fisik tujuan.
- Minimum: batas per produk dan lokasi untuk penanda restok ketika tersedia <= minimum.

Semua aksi memakai UUID `id` sebagai kunci idempotensi serta referensi/alasan. Retry dengan ID dan payload sama mengembalikan dokumen lama tanpa mutasi/event kedua. ID sama dengan payload berbeda ditolak. Audit menyimpan aktor dari JWT, waktu, saldo fisik/reservasi sesudah aksi dan dokumen asal. Kartu stok append only. Perubahan nama/induk lokasi belum tersedia; hindari membuat data master keliru.

| Operasi | Saldo fisik | Saldo reservasi | Syarat |
|---|---:|---:|---|
| receive | + jumlah | 0 | Penerimaan dari luar jaringan, bukan transfer internal |
| transfer | − jumlah di asal | 0 | Jumlah <= tersedia; tujuan berbeda |
| accept | + seluruh jumlah di tujuan | 0 | Transfer berstatus transit |
| reserve | 0 | + jumlah | Jumlah <= tersedia |
| ship | − seluruh jumlah | − seluruh jumlah | Reservasi masih aktif |
| release | 0 | − seluruh jumlah | Reservasi masih aktif |
| return | + jumlah di lokasi pengiriman | 0 | Jumlah kumulatif <= pengiriman asal |
| count | hasil hitung dikurangi fisik lama | 0 | Hasil >= reservasi, alasan wajib |
| minimum | 0 | 0 | Nilai non-negatif |

Transfer pada versi ini diterima penuh sekali. Pengiriman dan pembatalan diproses penuh per dokumen reservasi produk. Retur dapat sebagian dan dibatasi pengiriman asal; hanya barang yang sudah diperiksa dan layak jual boleh dimasukkan kembali melalui aksi return. Barang rusak, selisih transfer, pengiriman sebagian dan karantina perlu alur tambahan. Transfer diperbolehkan antar lokasi tenant yang sama, termasuk lintas tingkat; struktur induk berfungsi sebagai penempatan wilayah, bukan larangan rute distribusi.

## Pemasangan PostgreSQL
Jalankan `inventory.sql` sebagai migrasi 007 sekali setelah migrasi 001–006. Backup dan uji pada staging untuk database yang sudah berisi data. Compose memasang migrasi otomatis hanya pada volume baru. Jangan menghapus volume lama untuk upgrade.

```sql
GRANT SELECT, INSERT ON sajada.inventory_location, sajada.inventory_config TO sajada_api;
GRANT SELECT, INSERT, UPDATE ON sajada.inventory_balance, sajada.inventory_document TO sajada_api;
GRANT SELECT, INSERT ON sajada.inventory_movement TO sajada_api;
GRANT SELECT ON sajada.region, sajada.member TO sajada_api;
```

Hak sebelumnya untuk produk, pesanan dan outbox tetap dibutuhkan. Role API harus non-owner NOSUPERUSER NOBYPASSRLS. Kredensial database hanya untuk layanan tepercaya; jangan berikan ke browser. RLS mengandalkan tenant yang diverifikasi API. Beberapa validasi bisnis dijalankan layanan, bukan keseluruhan constraint SQL.

Regenerasi domain setelah mengubah `shared/warehouses.ts`:

```sh
node services/transaction/build-inventory-domain.mjs
node --test shared/warehouses.test.mjs shared/backup.test.mjs
node --test services/db-tests/inventory.test.mjs services/db-tests/http-orders.test.mjs
```

## Endpoint
Semua endpoint memerlukan JWT RS256 yang sah, header X-Tenant-Id yang diizinkan dan role tenant_admin/accountant. Penambahan lokasi, aktivasi, opname dan perubahan minimum hanya tenant_admin. Izin gudang per petugas/lokasi belum diimplementasikan; seluruh staf tenant dapat mengakses persediaan tenant tersebut.

| Metode dan path | Fungsi |
|---|---|
| GET /v1/inventory | Saldo, lokasi, dokumen, kartu stok dan penanda aktivasi |
| POST /v1/inventory/locations | Daftar lokasi menggunakan UUID stabil |
| POST /v1/inventory/activate | Migrasi saldo produk lama ke satu depot provinsi |
| POST /v1/inventory/actions | Catat aksi stok menggunakan UUID stabil |
| POST /v1/orders | Setelah aktivasi, location_id wajib dan stok direservasi |
| GET /v1/products | Setelah aktivasi, stock menjadi agregat tersedia seluruh lokasi |

Contoh lokasi provinsi:

```json
{"id":"UUID_LOKASI","name":"Depot Jawa Barat","kind":"province","parentId":null,"regionId":"ID_PROVINSI","memberId":null}
```

Kabupaten memakai kind regency, kecamatan district, tempat anggota member. Wilayah harus sesuai jenis lokasi dan berada langsung di bawah wilayah depot induk. Tempat anggota memakai wilayah village, memberId anggota aktif pada tenant dan kelurahan yang sama. Backend memakai ID wilayah yang sudah ada; dataset wilayah resmi belum dimuat.

Aktivasi:

```json
{"locationId":"UUID_DEPOT_PROVINSI"}
```

Aktivasi mengunci tenant dan produk, mengimpor sisa product.stock sebagai penerimaan awal, lalu menandai aktif dalam satu transaksi. Saldo yang sudah dikurangi oleh pesanan lama tidak dikurangi lagi. Ulang aktivasi dengan lokasi sama aman; lokasi berbeda ditolak. Sesudah aktif, kolom product.stock lama tidak menjadi sumber saldo operasional. Produk baru menerima stok lewat inventory/actions. Tidak tersedia deaktivasi atau pemindahan ulang saldo awal.

Penerimaan atau transfer:

```json
{"id":"UUID_OPERASI","kind":"receive","locationId":"UUID_LOKASI","productId":"UUID_PRODUK","quantity":100,"reference":"PO-001"}
```

```json
{"id":"UUID_OPERASI","kind":"transfer","locationId":"UUID_ASAL","toId":"UUID_TUJUAN","productId":"UUID_PRODUK","quantity":20,"reference":"SJ-TRANSFER-001"}
```

Penerimaan transfer, pengiriman dan pembatalan reservasi memakai sourceId dokumen asal:

```json
{"id":"UUID_OPERASI_BARU","kind":"accept","sourceId":"UUID_DOKUMEN_TRANSFER","reference":"TERIMA-001"}
```

Ganti kind menjadi ship atau release dan sourceId menjadi dokumen reserve. Untuk return tambahkan quantity; untuk count isi locationId, productId, quantity berupa hasil hitung fisik, dan alasan pada reference.

Checkout setelah aktivasi:

```json
{"member_id":"UUID_ANGGOTA","location_id":"UUID_LOKASI","items":[{"product_id":"UUID_PRODUK","quantity":2}]}
```

Header Idempotency-Key pesanan tetap wajib. Semua item pada pesanan mereservasi satu lokasi; seluruh transaksi rollback jika salah satu produk tidak cukup. Dokumen reserve memiliki reference berupa ID pesanan. Pengiriman dicatat melalui ship terhadap dokumen reserve; pembayaran tetap proses terpisah. Retry pesanan lama yang telah dibuat sebelum aktivasi mengembalikan hasil lama.

## Batas integrasi dan kapasitas
Payout, pembayaran order, refund dan pembalikan komisi tidak otomatis dilakukan oleh aksi stok. Cancel reservasi hanya melepaskan barang; belum membatalkan dokumen keuangan pesanan. Return hanya memulihkan barang; belum membuat credit note atau refund. Jurnal persediaan/HPP belum diposting. Konfirmasi pengiriman tidak otomatis mengubah status pembayaran pesanan.

Versi awal mengunci seluruh mutasi inventori per tenant dengan advisory transaction lock, kemudian menggunakan transaksi atomik dan RLS. Pembacaan dan domain memuat riwayat tenant penuh; belum pagination atau optimasi untuk jutaan mutasi. Ini sengaja merupakan fondasi pengembangan, bukan klaim kapasitas produksi. Pengujian PGlite memakai koneksi terserialisasi; paralelisme PostgreSQL native belum diuji.

Backup demo sekarang mencakup lokasi, saldo, dokumen, mutasi dan kunci retry. Validasi memutar ulang riwayat untuk mencocokkan saldo; backup lama tanpa lokasi dimigrasikan dari saldo produk. Gunakan satu tab demo per tenant. Reset transaksi demo juga menghapus lokasi dan kartu stok, lalu mengembalikan depot serta saldo awal.

## Pembatalan pesanan v0.22
Jalankan migrasi 008 `order-cancel.sql` setelah 007, menggunakan role migrasi. Hak tabel sales_order yang sudah ada tetap berlaku. Web demo menyediakan tombol Batalkan pesanan dengan alasan pada Marketplace. Pembatalan menyimpan audit dan melepas semua reservasi aktif dalam penyimpanan utama yang sama; AR ilustratif dibalik melalui jurnal demo, dan pesanan batal tidak dihitung dalam dashboard.

`POST /v1/orders/{id}/cancel` hanya tenant_admin, body `{"reason":"Pelanggan membatalkan"}`. Identitas pesanan menjadi kunci retry: alasan sama mengembalikan hasil sebelumnya, alasan berbeda 409. Aktor berasal dari JWT. Pesanan harus pending/belum dibayar dan seluruh reservasi harus belum dikirim. Reservasi yang telah dilepas manual diterima selama riwayat item/lokasi cocok. Semua pelepasan stok, audit order dan outbox `order.cancelled` berada dalam satu transaksi. Reservasi tidak lengkap atau satu item sudah dikirim menolak seluruh pembatalan.

Pesanan lama sebelum aktivasi depot: selama belum aktivasi, pembatalan mengembalikan product.stock sekali. Sesudah aktivasi, pesanan lama ditolak dan memerlukan rekonsiliasi manual; sistem tidak menebak apakah barang sudah dikirim. Order batal tidak dapat dibayar. SQL melindungi order batal dari perubahan/penghapusan. Pembatalan ini tidak mencakup refund order lunas atau retur barang terkirim; tidak ada jurnal backend pembatalan karena pending belum diakui sebagai penjualan. Web masih localStorage demo satu tab per tenant dan belum terhubung ke API. Pengujian HTTP memakai PGlite yang diserialisasi; balapan koneksi PostgreSQL native belum diuji.

## Pengiriman seluruh pesanan v0.23
Jalankan `order-dispatch.sql` sebagai migrasi 009 setelah 008. Hak sales_order dan inventory sebelumnya sudah cukup. Endpoint `POST /v1/orders/{id}/dispatch` tersedia untuk tenant_admin/accountant dengan body `{"reference":"SJ-2026-001"}`. Referensi surat jalan wajib, maksimal 100 karakter dan unik persis per tenant (case-sensitive). Aktor berasal dari JWT. Tidak ada unggahan dokumen atau PDF surat jalan pada versi ini.

Syarat: order paid, inventory_location_id tersedia, jumlah dan produk reservasi tepat sesuai item order dan seluruh dokumen reserve masih aktif. Dalam satu transaksi, server mengunci tenant persediaan lalu baris order, memproses ship untuk semua reserve, menyimpan dispatched_at/by/reference, serta menerbitkan outbox order.dispatched. Retry order dengan referensi sama mengembalikan audit lama; referensi lain 409. Uniqueness surat jalan diperiksa database: jika bertabrakan, seluruh mutasi stok, dokumen dan event rollback. API order listing menampilkan audit pengiriman. SQL melindungi audit dan nilai order yang telah dikirim; status pembayaran tetap paid.

Web Marketplace: catat pembayaran penuh di Akuntansi → pilih Kirim seluruh item → isi referensi surat jalan. Audit pengiriman dan stok disimpan bersama dalam data utama tenant. Backup memeriksa paid, saldo, riwayat kartu stok, jumlah item, aktor dan referensi surat jalan; referensi duplikat ditolak. Katalog tersedia tidak berubah pada pengiriman karena stok telah ditahan saat checkout, tetapi stok fisik dan reservasi berkurang.

Pengiriman adalah barang keluar dari depot, belum konfirmasi penerimaan pelanggan. Penyelesaian/komisi MLM tetap proses demo terpisah; tidak otomatis disetujui atau dibayar. Belum ada pengiriman sebagian, ekspedisi, pelacakan, jurnal HPP/pengakuan pendapatan backend atau refund. Pesanan tanpa lokasi serta reservasi yang sudah diproses manual ditolak; perlu rekonsiliasi agar tidak mengurangi stok dua kali. Retur stok tidak menghapus bukti pengiriman lama. Aksi ship tingkat dokumen di Depot & persediaan tetap tersedia untuk operasi mandiri dan tidak mengubah audit order; gunakan alur Marketplace untuk pesanan yang ingin memiliki audit pengiriman.

Pengujian menggunakan PGlite dengan koneksi diserialisasi, termasuk dua item, retry, referensi duplikat dan rollback penuh, belum balapan koneksi PostgreSQL native. Web tetap localStorage satu tab per tenant, belum terkoneksi API produksi.

## Penerimaan pelanggan dan kelayakan komisi v0.24
Jalankan migrasi 010 `order-receipt.sql` setelah 009, memakai role migrasi. Hak tabel sales_order sebelumnya cukup. Endpoint `POST /v1/orders/{id}/receive` untuk tenant_admin/accountant, body `{"reference":"POD-001","receiver":"Nama penerima"}`. Ini pencatatan staf atas bukti penerimaan pelanggan, bukan login/otorisasi oleh pelanggan. Nama dan referensi wajib maksimal 100 karakter; aktor maksimal 200 berasal dari JWT. Referensi unik persis per tenant. Belum ada unggahan foto, tanda tangan digital atau integrasi kurir.

Order harus paid dengan audit pengiriman lengkap. Seluruh dokumen reservasi harus shipped pada lokasi order, jumlah/produk cocok, dan belum mempunyai retur. Bila ada retur sebelum bukti penerimaan, pencatatan penerimaan penuh ditolak dan memerlukan rekonsiliasi manual. Server mengunci tenant inventory lalu order; menyimpan received_at/by, receipt_reference, receiver_name dan outbox order.received dalam satu transaksi. Stok tidak berubah lagi. Retry dengan referensi serta nama penerima sama aman; perbedaan ditolak 409. SQL melindungi bukti penerimaan dari perubahan, dan memeriksa waktu tidak lebih awal daripada pengiriman.

Web: bayar → kirim → Konfirmasi penerimaan → masukkan nama penerima dan referensi → periksa bukti seluruh barang. Pesanan baru menyimpan receiptPolicy full-receipt-v1, sehingga flag selesai lama tidak dapat menggantikan bukti penerimaan. Komisi ilustratif muncul dari pesanan lunas dan diterima berdasarkan snapshot sponsor, tetap pending sampai disetujui; pembayaran hanya simulasi. Ringkasan dashboard memakai dasar kelayakan sama. Semua evidence penerimaan berada di penyimpanan utama order, tidak menambah flag delivered pada penyimpanan lain. Penyelesaian lama yang sudah tersimpan tanpa policy baru tetap diakui agar riwayat komisi lama tidak hilang; penyelesaian manual hanya tersedia untuk pesanan lama tanpa lokasi.

Backup menguji audit, urutan waktu, dispatch dan kartu stok, keunikan referensi, kelayakan status komisi dan larangan bypass policy baru. Retur yang dicatat sesudah penerimaan tidak menghapus audit historis penerimaan. Penyesuaian komisi/refund/HPP akibat retur masih belum otomatis; jangan memakai angka komisi demo sebagai instruksi pembayaran nyata. API backend mencatat receipt event saja, belum menghitung atau membayar komisi MLM dan belum memposting pengakuan pendapatan. Kebijakan SHU/bagi hasil penyertaan tetap terpisah.

Pengujian HTTP memakai PGlite dengan koneksi diserialisasi; PostgreSQL native concurrent belum diuji. Web masih penyimpanan lokal satu tab per tenant dan belum terhubung ke API produksi.

## Koreksi komisi retur pada web demo v0.25
Versi ini tidak menambah migrasi PostgreSQL atau endpoint transaksi. Backend tetap menyediakan aksi inventory return dengan idempotensi UUID, sumber dokumen reserve yang shipped dan batas kuantitas. Perhitungan koreksi komisi berikut adalah domain TypeScript dan UI demo browser; penyimpanan persetujuan belum mempunyai kontrol/audit server.

Alur: pesanan lunas dan selesai/diterima → catat Retur di Depot & persediaan menggunakan reservasi pengiriman asal → buka Pendapatan → tinjau baris Koreksi komisi akibat retur → Setujui koreksi demo. Hanya barang retur layak jual yang boleh masuk kembali melalui retur stok. Kerusakan/karantina belum tercakup.

Komisi awal dan status persetujuan/pembayaran lama dipertahankan. Setiap dokumen retur menghasilkan baris koreksi per penerima komisi dengan ID stabil return:{document_id}:{original_commission_id}. Nilai retur memakai jumlah unit dikali harga produk saat checkout; penerima/rate memakai snapshot sponsor order. Urutan append kartu stok menentukan pembulatan kumulatif: koreksi = round(sisa nilai setelah retur × rate/100) − round(sisa sebelum retur × rate/100). Retur berikutnya tidak mengubah baris koreksi sebelumnya. Retur seluruh barang membalik persis jumlah komisi awal, termasuk kasus rupiah kecil dan koreksi bernilai nol.

Persetujuan koreksi hanya pending → approved (peta correctionApprovals), retry tidak menggandakan audit. Hak net teoritis memperhitungkan seluruh koreksi; saldo setelah koreksi disetujui memperhitungkan hanya koreksi approved. Jika komisi bruto sudah disimulasikan dibayar dan saldo sesudah koreksi menjadi negatif, ditampilkan nilai penagihan kembali indikatif per penerima. Angka penerima berbeda tidak saling menutup. Belum ada piutang penagihan nyata, pemotongan, refund pelanggan, credit note, jurnal GL atau transfer dana.

Simulasi pembayaran komisi awal yang berkaitan dengan retur diblokir, baik sebelum maupun sesudah koreksi approved, sampai alur rekonsiliasi pembayaran net tersedia. Penjualan pribadi/grup tetap berlabel bruto; panel koreksi dan dashboard menampilkan indikator net terpisah. CSV menyertakan komisi awal dan koreksi beserta ID dokumen retur/ref/status. Backup menerima correctionApprovals opsional untuk kompatibilitas; menolak persetujuan tanpa dasar dokumen retur atau status paid pada koreksi.

Perhitungan sumber: shared/commission-return.ts. Uji: node --test shared/commission-return.test.mjs shared/mlm.test.mjs shared/backup.test.mjs shared/order-receipt.test.mjs. Pengujian UI visual browser belum tersedia; TypeScript dan build dilakukan. Web tetap penyimpanan lokal satu tab per tenant, belum terhubung API produksi.

## Perencanaan restok dan mutasi periode v0.26
Menu web baru Restok & laporan menyediakan filter lokasi, seluruh turunan wilayah, produk, buffer restok, tanggal dan CSV sesuai filter. Perencanaan restok hanya produk aktif; laporan mutasi juga mencakup produk yang kini nonaktif agar sejarah tetap lengkap. Kedua fitur read-only, tidak memindahkan stok atau membuat PO. Tidak ada migrasi database baru; backend memakai inventory yang sudah aktif.

Restok dipicu ketika tersedia <= minimum. Target = minimum + buffer, dibatasi maksimum fisik satu miliar unit dikurangi reservasi. Kebutuhan tambahan = maksimum(0, target − tersedia − transfer masuk yang masih transit). Donor hanya surplus di atas minimum + buffer; depot induk diprioritaskan lalu surplus terbesar. Kapasitas donor berkurang setiap dialokasikan dalam satu perhitungan, sehingga donor tidak dijanjikan ke dua penerima melebihi surplus. Lokasi penerima diprioritaskan tersedia terendah lalu ID; sisa kebutuhan menjadi usulan pembelian. Barang dalam perjalanan tidak dianggap sudah fisik di tujuan. Transfer tetap perlu diperiksa dan dicatat melalui Depot & persediaan, dan tidak ada pesanan pembelian otomatis. Rencana terpisah/dua tab perlu diselaraskan ulang.

Laporan periode dihitung dari kartu stok dengan tanggal Asia/Jakarta (+07:00). Saldo awal berasal dari mutasi sebelum tanggal awal. Masuk/keluar fisik dalam periode berasal dari delta, termasuk retur, transfer, pengiriman dan selisih opname; reservasi dilaporkan terpisah. Saldo akhir = awal + masuk − keluar, tersedia akhir = akhir fisik − reservasi akhir. Transit pada tanggal akhir ditentukan dari transfer yang sudah dikirim dan belum mempunyai dokumen accept pada/before tanggal tersebut, bukan memakai status transfer terkini. Karena itu penerimaan setelah periode tidak menghapus transit historis. Transfer internal tetap muncul di kedua lokasi; kolom masuk bukan pembelian/penjualan. Transit masuk dan keluar tidak boleh dijumlahkan sebagai dua stok milik tenant. Data mengikuti waktu pencatatan, belum tanggal efektif bisnis atau tutup periode.

API staff tenant_admin/accountant:
- GET /v1/inventory/restock?buffer=5&location_id=UUID&include_children=true&product_id=UUID
- GET /v1/inventory/report?start=2026-10-01&end=2026-10-08&location_id=UUID&include_children=true&product_id=UUID

location_id dan product_id opsional. include_children opsional default false pada API; saat lokasi kosong seluruh lokasi tenant dipakai. buffer default 5, unit bulat 0..1 miliar. Tanggal wajib untuk report, inklusif, valid kalender, rentang maksimum 366 hari. Inventory belum aktif menghasilkan 409. Tenant diverifikasi JWT dan X-Tenant-Id; data dibaca melalui RLS, dalam satu transaksi dengan inventory tenant lock agar konsisten. Backend catalog belum mempunyai active flag, sehingga API memasukkan seluruh produk backend saat restok. Respons JSON berisi rows; CSV dibuat web dari filter sama.

Sumber domain shared/inventory-reports.ts, generated inventory-reports-domain.mjs untuk API. Jalankan node services/transaction/build-inventory-domain.mjs sesudah perubahan domain. Uji node --test shared/inventory-reports.test.mjs shared/warehouses.test.mjs services/db-tests/http-orders.test.mjs. Data masih dibaca seluruh tenant dan kalkulasi dalam memori; agregasi SQL, pagination dan optimasi untuk skala besar belum diterapkan. Pengujian API memakai PGlite terserialisasi; koneksi paralel PostgreSQL native belum diuji. Pengujian visual browser belum tersedia. Web tetap demo localStorage terpisah per tenant dan belum terhubung ke API produksi.


## v0.27 Safety stock dan PO otomatis

Web demo: menu **Safety stock & PO**. Atur setiap pasangan produk/lokasi (anggota, kecamatan, kabupaten, provinsi): safety, target, pemasok, harga beli rupiah, MOQ, kelipatan kemasan, lead time catatan, dan status otomatis. Aturan tidak otomatis menebak kebutuhan tiap barang; operator menetapkan level sesuai permintaan dan lead time pemasok. Minimum pada menu persediaan/laporan lama terpisah dari safety stock pengadaan ini.

Pemicu: `tersedia = fisik - reservasi <= safety`. Coverage = tersedia + transfer masuk transit + sisa seluruh PO draft/approved. Jika target lebih besar dari coverage, buat draf sebanyak `ceil(max(target - coverage, MOQ) / kelipatan) * kelipatan`. Draf dihitung sebagai coverage supaya retry tidak menggandakan PO. Tidak ada PO saat coverage sudah mencukupi. Safety dan target dalam unit barang bulat, target harus di atas safety. Batas 1 miliar unit fisik per lokasi-produk dan Rp1 triliun nilai per PO.

Contoh: tersedia 5, safety 5, target 30, transfer masuk 4, sisa PO 6, MOQ 1, kelipatan 6 → gap 15 → draf PO 18 unit. Supplier/harga diambil sebagai snapshot; perubahan aturan tidak mengubah PO lama.

Migrasi `replenishment.sql` (011) sesudah 010; compose memasangnya untuk database baru. Database lama harus menerapkan migrasi 011 sebelum menjalankan API baru. Grant role API SELECT/INSERT/UPDATE pada reorder_policy, purchase_order, purchase_receipt, selain privilege inventory sebelumnya. Semua tabel memakai RLS tenant dan FK composite tenant.

| API | Role | Perilaku |
| --- | --- | --- |
| GET /v1/purchasing | tenant_admin/accountant | Aturan, PO, penerimaan tenant |
| POST /v1/purchasing/policies | tenant_admin | Simpan aturan dan evaluasi segera |
| POST /v1/purchasing/evaluate | tenant_admin | Evaluasi ulang idempoten |
| POST /v1/purchasing/:id/approve | tenant_admin | Setujui draf |
| POST /v1/purchasing/:id/cancel | tenant_admin | Body reason; batalkan draf dan jedakan aturan |
| POST /v1/purchasing/:id/receive | tenant_admin/accountant | Body id UUID dokumen, quantity; penerimaan sebagian/penuh |

Hook setiap aksi stok setelah aktivasi menjalankan evaluasi PO dalam transaksi yang sama, termasuk reserve checkout, ship, transfer, accept, return dan opname. Penguncian inventory tenant menserialkan evaluasi. Penerimaan PO mengubah stok dan remaining PO dalam satu transaksi lalu mengevaluasi setelah keduanya tersimpan. Retry penerimaan UUID yang sama tidak menambah stok lagi; payload berbeda ditolak. Draf perlu persetujuan; PO approved tidak dapat dibatalkan melalui fitur ini. Penerimaan penuh menutup PO. Pembatalan draf menjeda aturan agar tidak segera dibuat ulang; operator dapat mengaktifkan lagi.

Outbox: purchase.order.created, purchase.order.approve, purchase.order.cancel, purchase.order.receive. Riwayat penerimaan append-only; snapshot PO immutable. Rencana restok lama memperhitungkan sisa PO aktif. Backup/restore demo memvalidasi saldo penerimaan terhadap kartu stok.

Web masih demo localStorage per tenant/browser, satu tab. Backend PostgreSQL disediakan dalam source dan diuji menggunakan PGlite; belum terhubung ke situs atau dideploy. Belum diuji pada PostgreSQL native dengan koneksi paralel. Tidak ada pemesanan/email nyata ke supplier, penjadwalan batch, due date berbasis lead time, konsolidasi multi barang, landed cost/HPP, AP/GL atau pembayaran otomatis. PO IDR saja; mata uang tampilan web dapat dikonversi dengan kurs demo.


## v0.28 Demo: penerimaan PO → invoice AP → pembayaran

Di Akuntansi / Utang (AP), daftar penerimaan PO yang belum ditagihkan memuat PO, pemasok, jumlah diterima dan nilai = jumlah × harga snapshot PO. Operator memilih Catat invoice PO, mengisi nomor invoice, tanggal pencatatan dan jatuh tempo, lalu mengonfirmasi kecocokan bukti invoice. Nilai/supplier/akun persediaan ditetapkan dari PO. Invoice dicatat untuk seluruh satu dokumen penerimaan; penerimaan sebagian lain dapat ditagihkan pada invoice berbeda. Nomor invoice unik per pemasok dan satu penerimaan hanya dapat ditagihkan sekali. Invoice tidak mengubah kartu stok.

Jurnal demo invoice Dr1300/Cr2100; pembayaran Dr2100/Cr1100. Nilai invoice diterapkan setelah barang diterima; tidak ada jurnal GRNI saat penerimaan. Ini fondasi pencatatan sederhana, belum metode valuasi stok atau HPP. Invoice PO IDR, tanpa pajak/ongkos/selisih harga, tanpa gabungan banyak penerimaan atau invoice sebagian atas satu dokumen. Invoice manual tetap untuk transaksi di luar PO.

Pembayaran sebagian/penuh mensyaratkan nominal tidak melebihi utang atau saldo kas demo. Referensi pembayaran wajib unik per tenant; actor dan waktu tersimpan dan ditampilkan dalam riwayat. Pembayaran hanya pencatatan demo, tidak menghubungi bank. Pencatatan localStorage dilakukan sebelum memperbarui state tampilan. Data invoice menyimpan receiptId, poId, quantity, unitCost dan audit; backup/restore memvalidasi kecocokan terhadap PO/penerimaan dan menolak penagihan ganda/manipulasi.

Tambahan v0.28 ini khusus demo web localStorage dan domain TypeScript. Belum ada API AP atau migrasi PostgreSQL baru; backend PO v0.27 tetap tersedia terpisah dan belum dihubungkan ke situs. Pengujian domain, journal dan backup dilakukan; QA browser tidak tersedia di lingkungan ini.


## v0.29 Backend PostgreSQL AP

Migrasi `payables.sql` (012) setelah 011. Tabel purchase_invoice dan purchase_payment memakai RLS tenant, FK tenant composite, invoice unik per penerimaan serta nomor pemasok, referensi pembayaran unik per tenant, dan riwayat append-only. Trigger database memeriksa invoice terhadap PO/penerimaan dan jurnal yang telah posted dengan tanggal, akun dan jumlah tepat. ID UUID dari client adalah kunci retry; payload berbeda untuk UUID sama ditolak. Caller tx membungkus record + jurnal + outbox; error setelah posting journal tetap rollback semuanya.

API membutuhkan JWT RS256 / JWKS seperti route lain serta X-Tenant-ID yang terdaftar pada token. Aktor berasal dari sub JWT, bukan body.

| Endpoint | Role | Hasil |
| --- | --- | --- |
| GET /v1/payables | tenant_admin/accountant | Invoice + outstanding, pembayaran, penerimaan belum ditagihkan, saldo kas backend |
| POST /v1/payables | tenant_admin/accountant | Invoice sesuai penerimaan + jurnal Dr1300 / Cr2100 |
| POST /v1/payables/:invoiceId/payments | tenant_admin | Pembayaran + jurnal Dr2100 / Cr1100 |
| GET /v1/accounting/trial-balance | tenant_admin/accountant | Debit/kredit/saldo per akun dari seluruh jurnal posted tenant |

Invoice body (nilai/supplier tidak diterima dari client):

```json
{"id":"<UUID stabil invoice>","receiptId":"<UUID penerimaan PO>","reference":"INV-001","date":"2026-10-08","due":"2026-11-08"}
```

Payment body (tanggal dan actor dari server):

```json
{"id":"<UUID stabil pembayaran>","amount":100000,"reference":"BANK-001"}
```

Retry memakai UUID dan payload sama. Invoice satu penerimaan utuh, IDR, tanpa pajak, potongan, selisih harga, gabungan invoice atau void/reversal. Jatuh tempo minimal tanggal invoice; tanggal pencatatan minimal tanggal barang diterima dan tidak di masa depan. Pembayaran dapat sebagian/penuh, tidak melebihi outstanding atau saldo 1100 dari jurnal posted. Angka rupiah bulat, maksimal Rp1 triliun per transaksi. Trial balance mengembalikan numeric sebagai string PostgreSQL agar presisi data tidak hilang.

Invoice memakai inventory tenant lock supaya konsisten dengan penerimaan. Semua pembayaran AP memakai finance tenant advisory lock dan row lock invoice; writer pengeluaran kas lain di masa depan harus memakai lock finance yang sama. Inflow sales-order saat ini hanya menambah kas. Pembayaran tidak membuat transfer bank. Saldo kas backend berbeda dari kas localStorage demo; funding/modal demo tidak otomatis menambah jurnal kas backend. Penerimaan belum membentuk jurnal GRNI; invoice mendebit persediaan pada harga PO, belum valuasi/HPP penuh, pajak, tutup periode atau rekonsiliasi bank.

Grant minimal untuk role API: SELECT, INSERT pada purchase_invoice dan purchase_payment; SELECT pada purchase_receipt/purchase_order dan journal/journal_line; INSERT/UPDATE pada journal, INSERT journal_line dan outbox, selain grants inventory/order sebelumnya. Jangan menjalankan API sebagai superuser atau BYPASSRLS.

Outbox events purchase.invoice.posted dan purchase.payment.posted memuat invoice/payment + journalId. GET tidak membuat mutasi data. Pengujian mencakup autentikasi/role, tenant/RLS, matcher SQL, receipt yang belum ditagihkan, konflik retry, pembayaran sebagian/penuh, kekurangan kas, immutability, journal balance, dan kegagalan outbox yang membatalkan transaksi penuh. Pengujian PGlite terserialisasi, belum menguji koneksi paralel PostgreSQL native atau deploy database. Web v0.29 masih demo localStorage; endpoint backend belum dihubungkan ke UI dan belum berjalan di situs hosted.


## v0.30 Umur utang AP

Web demo: Akuntansi → Umur utang. Pilih tanggal posisi, pemasok, bucket; ringkasan, prioritas invoice dan CSV mengikuti filter yang sama. Sisa = base invoice − pembayaran dengan tanggal efektif <= tanggal laporan; invoice bertanggal lebih baru tidak masuk. Invoice lunas tidak tampil. Pembagian hari lewat jatuh tempo: 0 (termasuk hari jatuh tempo) current; 1–30 d1_30; 31–60 d31_60; 61–90 d61_90; >90 over90. Semua nilai buku IDR, tanpa revaluasi FX. Grup berdasarkan nama pemasok trim/lowercase, belum supplier master ID. Urutan invoice: terlambat paling lama lalu outstanding terbesar; ringkasan pemasok: outstanding overdue terbesar. Ini informasi prioritas, bukan pembayaran otomatis.

Backend GET /v1/payables/aging?as_of=2026-10-08&supplier=Test%20supplier&bucket=d1_30 menggunakan JWT/RLS yang sama; staff tenant_admin/accountant. as_of wajib valid dan maksimal hari ini Jakarta; supplier opsional exact case-insensitive; bucket opsional current/d1_30/d31_60/d61_90/over90. Respons: asOf,currency,total,overdue,totals,rows,suppliers. Data bersumber invoice/payment PostgreSQL, berbeda dengan data browser demo. GET hanya membaca, tidak mem-posting jurnal. Domain TypeScript yang sama ditranspilasi untuk Node; tidak perlu migrasi SQL baru.

Histori memakai tanggal efektif, bukan snapshot data saat itu. Pencatatan belakangan dengan tanggal efektif lebih awal dapat mengubah laporan historis. Belum ada credit note/retur pembelian, tutup buku, atau notifikasi pengingat supplier. Web belum terhubung ke backend; browser QA tidak tersedia. Pengujian mencakup batas 0/1/30/31/60/61/90/91 hari, pembayaran sebagian/penuh, tanggal historis, supplier/filter, purity, kesetaraan domain backend, auth/RLS endpoint dan validasi input.


## v0.31 Mutasi utang per periode

Web Akuntansi → Mutasi utang: pilih start/end inklusif dan pemasok (opsional semua). Saldo awal = invoice sebelum start − pembayaran sebelum start; saldo akhir = awal + invoice periode − pembayaran periode. Transaksi lunas tetap tampil di periode relevan. Urutan tanggal, invoice sebelum pembayaran pada hari sama, kemudian ID stabil; saldo berjalan mencerminkan urutan laporan, bukan waktu intrahari. CSV memuat saldo awal/akhir, invoice terkait, aktor, PO dan penerimaan. Invoice/pembayaran setelah end tidak masuk laporan. Filter nama supplier exact trim/case-insensitive berlaku untuk opening dan seluruh mutasi. Angka nilai buku IDR, tidak revaluasi FX.

Backend GET /v1/payables/statement?start=2026-10-01&end=2026-10-08&supplier=Test%20supplier: staff tenant_admin/accountant dan RLS, finance lock untuk membaca posisi konsisten. Tanggal awal/akhir wajib valid, start<=end, end maksimal hari ini Jakarta. Respons start,end,supplier,currency,opening,invoiced,paid,closing,rows. Tidak membutuhkan migrasi baru dan tidak mem-posting jurnal. Domain yang sama di browser/Node.

Catatan histori menggunakan tanggal efektif dan dapat berubah oleh pencatatan tanggal lampau; belum snapshot tutup buku, credit note, retur supplier atau notifikasi eksternal. Backend belum terhubung ke web; UI masih localStorage demo. Pengujian mencakup saldo awal, batas periode, invoice lunas, filter pemasok, stable ordering, rekonsiliasi aging, CSV, auth/RLS dan kesetaraan backend. Browser QA tidak tersedia.


## v0.32 Dokumen PO / cetak PDF

Safety stock & PO → Dokumen / PDF membuka pratinjau HTML mandiri. Tombol Cetak / simpan sebagai PDF memakai dialog browser (pilih A4). Alternatif Unduh dokumen HTML, buka file di browser, lalu cetak. Dokumen memakai IDR tetap, snapshot nama barang/pemasok/jumlah/harga PO, status draft/approved/closed/cancelled, lokasi saat ekspor, audit pembuat/persetujuan/pembatalan, dasar pemicu dan semua penerimaan PO. Draf dan pembatalan berpenanda jelas. Belum ada alamat/kontak supplier atau alamat pos pengiriman pada model ini; dokumen menyebut kebutuhan konfirmasi terpisah. Audit persetujuan bukan e-sign tersertifikasi. Pajak, ongkos dan diskon tidak masuk nilai barang.

Backend GET /v1/purchasing/:poUUID/document untuk tenant_admin/accountant mengembalikan attachment text/html; JWT/tenant/RLS seperti endpoint PO. Nama tenant backend dicetak sebagai UUID tenant; web memakai label tenant demo. Header cache-control no-store dan nosniff. Tidak ada migrasi SQL baru. Renderer sama di web/Node dan menolak saldo penerimaan yang tidak cocok atau audit wajib yang hilang. Teks di-escape dan HTML membatasi sumber eksternal dengan CSP; preview iframe sandbox hanya mengizinkan skrip tombol cetak dan modal.

Ekspor/cetak tidak menulis event, mengubah PO, mengirim email, menambah stok, invoice atau pembayaran. Tidak ada PDF server-generated: pengguna memilih Save as PDF pada dialog browser. Browser/print QA belum tersedia di lingkungan pengembangan; pengujian renderer dan API mencakup escaping, status, audit, receipt matching, kesetaraan domain, role/tenant dan tidak ada mutasi. Backend masih source terpisah, belum dideploy/terhubung ke situs demo.

## v0.33 — master pemasok dan snapshot PO

Pada menu Safety stock & PO, tambahkan pemasok (nama unik per tenant, alamat wajib, nama kontak opsional, telepon atau email wajib). Pilih pemasok terdaftar pada aturan safety stock. PO baru menyalin seluruh record pemasok saat dibuat; dokumen HTML/cetak memakai salinan tersebut, sehingga perubahan nama/alamat atau penonaktifan master tidak mengubah PO lama. Aturan lama dengan nama bebas tetap didukung dan dokumennya menunjukkan kontak belum dicatat. Status aturan menunjukkan pemasok nonaktif. Penonaktifan menghentikan PO baru dari aturan tertaut, tetapi PO yang sudah dibuat tetap bisa disetujui/diterima. Aktivasi kembali tidak membatalkan PO yang ada; evaluasi menghitung sisa PO seperti sebelumnya.

Migrasi `suppliers.sql` (013) setelah 012: tabel `purchase_supplier`, RLS tenant, nama unik tanpa membedakan kapital/spasi tepi, FK composite dari aturan dan PO, larangan menghapus master, serta pemeriksaan snapshot pada INSERT PO terhadap pemasok aktif tenant. Guard PO 011 tetap melarang perubahan snapshot setelah dibuat. Docker Compose memakai migrasi baru untuk database kosong; database yang sudah ada harus menjalankannya sekali sebelum API baru diaktifkan.

API:
- GET `/v1/purchasing`: kini juga mengembalikan `suppliers`, untuk admin/accountant.
- POST `/v1/purchasing/suppliers`: admin saja; body `{id, name, address, contact, phone, email, active}`. UUID tetap memperbarui master, UUID baru membuat pemasok; waktu/aktor diambil server. Operasi master + outbox `purchase.supplier.saved` berada dalam transaksi yang sama dan menggunakan lock inventory tenant. Ini operasi upsert, bukan endpoint retry dengan jurnal keuangan.
- POST `/v1/purchasing/policies`: tambahkan `supplierId` opsional. Nama diambil dari master tenant; ID tidak ditemukan/nonaktif ditolak. Tanpa ID tetap memakai field `supplier` lama.

Tambahkan grant API: `GRANT SELECT, INSERT, UPDATE ON sajada.purchase_supplier TO sajada_api;` selain hak tabel pengadaan/outbox sebelumnya. Jangan grant DELETE, superuser atau BYPASSRLS.

Backup browser mencakup master dan snapshot serta memvalidasi nama duplikat, kontak, dan referensi aturan. AP/aging masih mengelompokkan berdasarkan nama pemasok pada invoice; penggabungan histori invoice karena perubahan nama belum tersedia. Rekening bank, portal pemasok, email otomatis dan alamat pengiriman depot belum ditambahkan. Web masih demo localStorage, API Node/PostgreSQL belum terhubung atau dideploy. Verifikasi menggunakan TypeScript, domain/backup/HTML dan HTTP JWT + PGlite; belum browser QA atau uji koneksi PostgreSQL native paralel.

## v0.34 — jadwal kedatangan dan keterlambatan PO

PO baru menyalin `leadDays` dari aturan safety stock (0–365 hari kalender). Saat disetujui, domain menghitung dan menyimpan `expectedOn` = tanggal persetujuan dalam WIB + leadDays. Perubahan aturan, pemasok, atau retry persetujuan tidak mengubah ETA. Draf dan PO batal belum memiliki ETA. PO lama tanpa snapshot leadDays tetap valid, tetapi tidak diberi jadwal tebakan dari aturan terkini; PO approved tersebut muncul sebagai belum terjadwal. Estimasi bukan janji atau bukti pengiriman pemasok; konfirmasi tetap dilakukan terpisah.

Migrasi `po-delivery.sql` (014) setelah 013 menambahkan constraint jadwal dan memperbarui guard PO: snapshot leadDays tetap immutable, expectedOn hanya dapat ditambahkan saat persetujuan dan tidak dapat diubah kemudian. Constraint memeriksa ETA berdasarkan timezone Asia/Jakarta. Docker Compose memuat migrasi untuk database kosong; database existing harus menjalankan 014 sekali sebelum kode API baru dipakai. Tidak ada tabel atau grant baru.

Web: Safety stock & PO → Jadwal kedatangan & keterlambatan PO. Filter tanggal penilaian, lokasi, pemasok dan kelompok; tampilkan hari terlambat, jumlah diterima/sisa, nilai sisa barang IDR, serta tautan dokumen. Hari ETA termasuk “Tiba hari ini”; terlambat dimulai besok. PO closed/cancelled tidak tampil, draf tetap terpisah dan tidak menambah nilai komitmen PO approved. Penerimaan sebagian mengurangi unit/nilai yang terlambat tanpa menggeser ETA. Ekspor CSV mengikuti filter, memakai saldo penerimaan terkini dan menetralkan formula pada teks.

GET `/v1/purchasing/delivery-monitor?reference_date=YYYY-MM-DD&location_id=UUID&supplier=nama&bucket=overdue|today|upcoming|unscheduled|draft`
- Admin/accountant, JWT dan tenant dari header seperti endpoint purchasing lainnya.
- reference_date opsional, default tanggal WIB saat request; tanggal kalender tidak valid atau bucket tidak dikenal → 400.
- lokasi wajib milik tenant; lokasi tidak ditemukan/tenant lain → 404.
- saldo berasal dari current state PO, bukan riwayat “as of”. Tanggal penilaian lampau/masa depan hanya mengevaluasi jadwal terhadap saldo terkini. Response `balanceBasis: current` menyatakan batas ini.
- total counts, remaining, approvedValue, overdueRemaining, overdueValue mengikuti filter yang sama. Nilai sisa PO adalah nilai pengadaan, bukan saldo utang AP.
- request memakai lock inventory tenant agar pembacaan konsisten dan tidak menulis stok, PO, jurnal atau outbox.

Dokumen HTML/cetak PO menampilkan lead time snapshot dan ETA. Dashboard tidak mengirim notifikasi, email atau pesanan kepada pemasok. Web masih demo localStorage; API PostgreSQL belum terhubung/dideploy. Uji mencakup pergantian tanggal WIB, akhir bulan/tahun, leap day, lead 0, persetujuan/retry, legacy PO, penerimaan sebagian, jadwal/CSV/filter dan SQL/JWT/RLS; belum browser QA atau concurrency PostgreSQL native.

## v0.35 — konfirmasi jadwal pemasok dengan riwayat revisi

Safety stock & PO → PO approved → Konfirmasi jadwal. Petugas mencatat tanggal tiba yang dijanjikan, referensi komunikasi, nama kontak pemasok, dan alasan/catatan. Semua wajib. Pencatatan tidak menghubungi pemasok, mengirim PO, atau mengautentikasi identitas pemasok secara otomatis. Riwayat tampil di modal dan dokumen HTML/cetak. Estimasi awal expectedOn dan leadDays PO tetap immutable.

Setiap konfirmasi memiliki ID UUID, orderId, revision berurutan mulai 1, confirmedOn, reference, contact, note, actor, dan at. Referensi komunikasi unik per PO tanpa membedakan kapital/spasi tepi; revisi memerlukan referensi komunikasi baru. Tanggal dijanjikan minimal tanggal persetujuan WIB; tanggal/waktu pencatatan tidak boleh sebelum persetujuan atau revisi sebelumnya. Konfirmasi baru hanya untuk PO approved dengan sisa penerimaan. Riwayat tetap dipertahankan setelah PO closed. UUID dengan payload bisnis sama mengembalikan record lama tanpa insert/event tambahan, termasuk jika PO kemudian selesai; UUID dengan data berbeda ditolak.

Migrasi `po-confirmation.sql` (015) setelah 014: tabel purchase_confirmation, RLS, FK tenant+PO, revision unik per PO, referensi unik, guard INSERT untuk PO terbuka/urutan/waktu, dan guard append-only untuk UPDATE/DELETE. Guard mengambil row lock PO; API juga memakai inventory lock tenant seperti proses penerimaan dan persetujuan. Deployment PostgreSQL existing harus menjalankan 015 sekali sebelum API baru. Compose memakai 015 saat inisialisasi database kosong. Grant API: `GRANT SELECT, INSERT ON sajada.purchase_confirmation TO sajada_api;` selain grants yang sudah ada.

POST `/v1/purchasing/:poUUID/confirmations`, admin saja. Body `{id, confirmedOn, reference, contact, note}`. Server menetapkan revision/actor/at; field tambahan ditolak 400. Referensi maksimal 100, kontak 200, catatan 1000 karakter. PO tenant lain/tidak ditemukan → 404; payload konfirmasi tidak valid, referensi berulang, UUID konflik atau PO tidak terbuka → 409. Record dan outbox `purchase.schedule.confirmed` dicatat atomik. Kegagalan event mengembalikan seluruh insert konfirmasi.

GET `/v1/purchasing` menyertakan `confirmations`. Delivery monitor kini memilih tanggal dari revisi konfirmasi terakhir, lalu estimasi awal bila tanpa konfirmasi. Response row `expectedOn` adalah jadwal yang dipakai; `originalExpectedOn` mempertahankan estimasi awal; `scheduleBasis` = supplier/estimate/none; `confirmationReference` menunjukkan bukti rujukan. CSV mencakup kedua tanggal, basis, dan referensi. PO legacy tanpa estimasi bisa dijadwalkan melalui konfirmasi. Filter dan perhitungan tetap memakai saldo penerimaan terkini, bukan snapshot historis. Jadwal baru dapat mengubah klasifikasi keterlambatan; estimasi awal dan seluruh revisi tetap tersedia untuk audit, belum ada KPI ketepatan pemasok terhadap jadwal pertama.

Backup memuat dan memvalidasi daftar konfirmasi, referensi PO, ID/referensi unik, revisi berurutan, tanggal dan audit. Pencatatan tidak menambah/mengurangi stok, mengubah nilai PO, atau membuat invoice/pembayaran/jurnal. Web masih demo localStorage; backend Node/PostgreSQL belum dihubungkan/dideploy. Verifikasi domain/backup/HTML/CSV dan HTTP JWT/PGlite lulus; browser QA, pemasok eksternal, dan koneksi paralel PostgreSQL native belum diuji.

## v0.36 — kinerja pengiriman pemasok

Safety stock & PO → Kinerja pengiriman pemasok. Periode inklusif berdasarkan tanggal WIB penerimaan terakhir PO closed, bukan tanggal PO dibuat atau nilai penerimaan selama periode. Penerimaan parsial/open, draf dan batal tidak dihitung sebagai PO selesai. Nilai laporan adalah nilai barang seluruh PO yang selesai dalam cohort tersebut, belum termasuk pajak/ongkir/diskon dan bukan saldo utang AP.

Indikator:
- Tepat waktu estimasi awal = jumlah PO selesai pada/sebelum expectedOn ÷ jumlah PO selesai yang memiliki estimasi awal. PO legacy tanpa estimasi tidak masuk denominator dan ditampilkan jumlahnya. Pembanding awal tetap immutable.
- Tepat waktu konfirmasi = jumlah PO selesai pada/sebelum tanggal konfirmasi terakhir yang dicatat sebelum/bersamaan penerimaan terakhir ÷ jumlah PO yang mempunyai konfirmasi demikian. Catatan konfirmasi setelah selesai tidak dipakai. Persentase konfirmasi tidak menggantikan persentase estimasi awal.
- Hari penyelesaian = tanggal penerimaan terakhir WIB − tanggal persetujuan WIB, dalam hari kalender; bisa 0. Rata-rata aritmetika per PO, bukan rata-rata rasio antar pemasok dan bukan waktu transit.
- Persentase/rata-rata dibulatkan satu desimal; denominator 0 menghasilkan null, UI menampilkan “—”.

Kelompok pemasok menggunakan `id:<supplierSnapshot.id>` untuk master agar perubahan nama tidak memecah identitas. Nama label kelompok berasal dari snapshot PO terbaru dalam cohort terfilter; setiap rincian tetap menampilkan nama snapshot masing-masing PO. Nama bebas legacy memakai `name:<nama trim/lowercase>` dan tidak otomatis digabung dengan master walaupun namanya sama. Filter lokasi dan kunci pemasok memengaruhi ringkasan, denominator, rincian dan CSV secara konsisten. CSV menyertakan tanggal awal/akhir, kedua tanggal pembanding, hari terlambat, ID lokasi, nilai PO dan referensi konfirmasi; teks berpotensi formula dinetralkan.

GET `/v1/purchasing/supplier-performance?start=YYYY-MM-DD&end=YYYY-MM-DD&location_id=UUID&supplier_key=id:UUID|name:nama`
- Admin/accountant; memakai JWT/tenant dan lock inventory agar read konsisten. Tidak menulis PO, inventory, outbox, invoice, pembayaran atau jurnal.
- start/end wajib, kalender valid, start ≤ end, end maksimal tanggal WIB saat request. Kesalahan tanggal → 400.
- location_id opsional harus ada pada tenant, jika tidak → 404; kunci pemasok yang tidak cocok menghasilkan cohort kosong.
- Response `basis: completed_receipts`, summary, suppliers dan rows; currency IDR. Domain memeriksa ID penerimaan unik, referensi PO, audit waktu setelah persetujuan dan rekonsiliasi total penerimaan terhadap received.

Tidak memerlukan migrasi database atau grant baru, karena memakai tabel PO/penerimaan/konfirmasi yang sudah ada. Data transaksi saat pembacaan dipakai untuk cohort penyelesaian; ini bukan snapshot laporan yang dibekukan. Mutu barang, retur pemasok, ketepatan terhadap konfirmasi pertama, kontrak/SLA, dan penilaian harga belum termasuk. Analytics ClickHouse belum menjadi sumber laporan ini; API Node/PostgreSQL belum terhubung/dideploy, web masih localStorage demo. Pengujian domain, CSV, generated Node parity, HTTP JWT/PGlite, role, tenant, tanggal dan read tanpa mutasi lulus. Browser QA dan concurrency PostgreSQL native belum diuji.

## v0.37 — pemeriksaan barang datang dan penolakan kualitas

Safety stock & PO → PO approved → Periksa & terima barang. Isi jumlah layak masuk stok, jumlah ditolak, dan alasan penolakan (wajib jika rejected > 0). Jumlah bulat non-negatif, total minimal 1 dan maksimal sisa PO saat pemeriksaan. Sisa PO adalah jumlah yang belum diterima sebagai barang layak, bukan seluruh jumlah fisik yang pernah dicoba dikirim pemasok.

Contoh PO 10 unit: accepted 7, rejected 3 → stok +7, received PO 7, sisa PO 3, dasar invoice AP hanya penerimaan 7 unit. Pengiriman pengganti accepted 3 akan menutup PO yang sama; riwayat penolakan awal tetap ada. Jika seluruh 10 ditolak, tidak ada stock document/purchase_receipt/AP source, PO tetap approved dan sisa 10. Rejected tidak mengurangi coverage PO aktif pada safety stock, sehingga tidak otomatis membuat PO pengganti ganda. Barang ditolak belum masuk gudang karantina dan belum menjadi retur barang yang pernah diterima. Pengembalian fisik barang, klaim pemasok, credit note, lot/expiry dan lampiran bukti belum diimplementasikan.

Record inspeksi: id, orderId, accepted, rejected, remainingBefore, reason, receiptId opsional, actor, at. UUID sama dengan data bisnis sama mengembalikan record terdahulu tanpa stock/event tambahan; payload berbeda ditolak, termasuk retry setelah PO selesai. Jika accepted > 0, purchase_receipt dan stock document memakai UUID inspeksi, jumlah accepted dan audit waktu/petugas sama. UUID penerimaan/dokumen lain tidak dapat dipakai ulang sebagai inspeksi baru. Hanya accepted masuk stok dan available invoice AP. Tampilan modal serta dokumen HTML/cetak menyertakan riwayat pemeriksaan; backup memvalidasi unit, snapshot sisa, referensi PO, linkage receipt, actor dan waktu. Penerimaan lama tanpa record pemeriksaan tetap valid; tidak dianggap memiliki bukti inspeksi baru.

Migrasi `po-inspection.sql` (016) setelah 015: purchase_inspection, RLS, FK composite tenant+PO/receipt, receipt unik, unit/batas/alasan checks, guard snapshot terhadap received PO setelah accepted, pencocokan receipt/audit, dan append-only. Database existing harus menjalankan migrasi sekali sebelum API baru diaktifkan; Compose menggunakan 016 untuk database kosong. Tambahkan `GRANT SELECT, INSERT ON sajada.purchase_inspection TO sajada_api;` selain grants sebelumnya.

POST `/v1/purchasing/:poUUID/inspections`, admin/accountant saja; body `{id, accepted, rejected, reason}`. reason boleh kosong jika rejected=0. Server mengambil actor dari JWT dan timestamp, serta menghitung remainingBefore. Field tambahan/envelope tidak valid → 400; PO tidak ditemukan pada tenant → 404; unit/alasan/status/retry konflik → 409. Lock inventory tenant dan transaksi caller mencakup stok, receipt, PO, inspeksi, replenishment dan outbox `purchase.goods.inspected`. Gagal menulis outbox menggagalkan seluruh transaksi. GET `/v1/purchasing` menyertakan inspections. Endpoint receive lama tetap kompatibel, tanpa record inspeksi; untuk bukti QC gunakan endpoint baru.

Pemeriksaan tidak otomatis membuat invoice, membayar pemasok atau menulis jurnal GL. AP membaca sumber purchase_receipt accepted seperti sebelumnya. KPI kinerja pengiriman tetap memakai tanggal penerimaan layak terakhir untuk PO closed; belum menambahkan skor mutu atau rejection rate. Web masih localStorage demo, API PostgreSQL belum terhubung/dideploy. Uji domain, backup, HTML, Node parity, JWT/PGlite dan RLS mencakup penerimaan campuran, semua ditolak, penggantian, retry, alasan/batas, immutable history, accepted-only AP, serta rollback; browser QA dan concurrency PostgreSQL native belum diuji.

## v0.38 — penyelesaian penolakan melalui alokasi penerimaan pengganti

Safety stock & PO → Tindak lanjut barang ditolak. Setiap inspeksi dengan rejected > 0 menjadi kasus; filter belum selesai, selesai diganti atau semua. Catat penerimaan barang pengganti terlebih dahulu di PO (pemeriksaan/penerimaan layak), lalu pilih kasus dan hubungkan penerimaan tersebut. Bisa dialokasikan sebagian. Daftar menampilkan rejected, replaced dan remaining; riwayat mencakup UUID kasus/penerimaan, jumlah, referensi, catatan, petugas dan waktu. Dokumen PO menampilkan sisa belum diganti serta seluruh alokasi.

Penggantian hanya memakai purchase_receipt dari PO yang sama, timestamp penerimaan **lebih baru** daripada inspeksi penolakan, dan bukan penerimaan layak pada inspeksi itu sendiri. Jika timestamp persis sama, belum dianggap penerimaan setelah penolakan. Jumlah positif bulat maksimal 1 miliar; total per kasus ≤ rejected dan total penggunaan satu receipt pada semua kasus ≤ receipt.quantity. Referensi unik per kasus tanpa membedakan kapital/spasi tepi; catatan wajib. UUID sama dan payload bisnis sama mengembalikan record lama; UUID berbeda dengan referensi berulang atau jumlah berlebih ditolak. Status penyelesaian dihitung dari alokasi append-only, tidak menimpa inspeksi. PO closed tetap bisa ditindaklanjuti.

Ini alokasi dari stok yang **sudah diterima**: tidak mengubah stock document, received PO, purchase_receipt, invoice/AP, pembayaran atau GL, serta tidak menambah stok lagi. Terima pengganti melalui proses penerimaan biasa hanya sekali; invoice dibuat dari receipt tersebut sesuai alur AP. Penerimaan legacy tanpa inspeksi juga dapat dipakai jika memenuhi tanggal, PO, dan kapasitas. Setiap inspeksi penolakan adalah kasus terpisah; sistem belum mengenali otomatis apakah penolakan berulang berasal dari unit fisik yang sama. Pencatatan reinspection/retur fisik, penggabungan kasus, refund, credit note, pembatalan alokasi atau koreksi histori belum tersedia.

Migrasi `po-replacement.sql` (017) setelah 016: purchase_replacement dengan RLS, FK tenant+inspection/receipt, unit checks, referensi unik, guard urutan waktu/PO/kapasitas, dan append-only. Guard menggunakan advisory transaction lock tenant dengan key yang sama seperti inventoryLock (`tenantUUID:inventory`), sehingga tidak meminta hak UPDATE pada tabel histori. API juga mengambil lock sebelum membaca/validasi; gunakan default READ COMMITTED seperti API. Belum ada pembuktian concurrency pada PostgreSQL native. Database existing harus menjalankan 017 sekali sebelum kode API baru; Compose memuat migrasi untuk database kosong. Grant: `GRANT SELECT, INSERT ON sajada.purchase_replacement TO sajada_api;` selain grants sebelumnya.

POST `/v1/purchasing/inspections/:inspectionUUID/replacements`, admin/accountant; body `{id, receiptId, quantity, reference, note}`. Waktu/aktor dari server JWT. Reference maksimal 100, note 1000 karakter. Field tambahan/envelope/UUID salah → 400; inspection tidak ditemukan pada tenant → 404; referensi/alokasi/status/urutan waktu/retry konflik → 409. Record dan outbox `purchase.rejection.replaced` dicatat atomik; kegagalan event rollback record. GET purchasing menyertakan replacements. Backup memeriksa kapasitas agregat, referensi, audit dan tanggal. Tidak ada pengiriman pesan otomatis kepada pemasok.

Web tetap localStorage demo, backend PostgreSQL belum dihubungkan/dideploy. Domain/backup/HTML/Node parity dan HTTP JWT/PGlite memverifikasi alokasi sebagian/penuh, retry, batas kasus dan shared receipt, bukti/urutan waktu, akses admin/accountant, RLS, history immutable, tidak mengubah stok/AP, serta rollback event. Browser QA belum tersedia.


## v0.39 — Koreksi alokasi penggantian

Pembatalan penuh ditambahkan sebagai ledger `replacementReversals` berisi id, replacementId, reason, actor, at. Alokasi awal tidak diedit/dihapus; referensi awal tetap terpakai. Kapasitas kasus dan penerimaan dihitung dari alokasi aktif. Koreksi hanya membatalkan tautan penyelesaian, bukan penerimaan fisik, PO, stok, invoice, pembayaran atau jurnal. Tidak ada pembatalan sebagian; buat alokasi baru dengan referensi baru setelah pembatalan.

POST `/v1/purchasing/replacements/:allocationUUID/reversals`, admin tenant saja; body `{id, reason}`. Alasan wajib maksimal 1000 karakter. UUID retry payload sama tidak membuat record/event baru; konflik UUID, target sudah dibatalkan, atau alasan kosong -> 409; target di luar tenant -> 404; role accountant/member -> 403. Waktu dan aktor dari server JWT. Record dan event `purchase.replacement.reversed` atomik. GET purchasing dan backup membawa replacementReversals; dokumen PO menunjukkan alasan, waktu, petugas dan status dibatalkan. Validasi backup merekonstruksi kapasitas menurut waktu audit; jika waktu sama, urutan alokasi dan koreksi target dipakai sebagai pemecah seri, bukan bukti urutan fisik.

Migrasi `po-replacement-reversal.sql` (018) sesudah 017, sekali pada database existing. RLS, composite FK, satu pembatalan per alokasi, guard waktu dan histori append-only. Guard alokasi menghitung kapasitas dengan mengecualikan pembatalan; alokasi baru tidak boleh mendahului koreksi terbaru tenant. Kedua INSERT menggunakan advisory transaction lock tenant inventory. Tambahkan `GRANT SELECT, INSERT ON sajada.purchase_replacement_reversal TO sajada_api;` selain grants sebelumnya. API menggunakan READ COMMITTED; pengujian PGlite terurut belum membuktikan konkurensi PostgreSQL native. Role database merupakan role layanan bersama; otorisasi admin diterapkan API, bukan klaim per pengguna dalam SQL.

UI masih demo localStorage sebagai Admin demo; belum terhubung API. Panel tindak lanjut menyimpan alasan pembatalan dan membuka kembali sisa kasus. Riwayat pengiriman balik fisik dan hubungan penolakan ulang pada barang yang sama masih belum tersedia.
