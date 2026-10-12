# Sajada v0.42 — Komposisi penyertaan dan saldo belanja

## Aturan pengguna

Total penyertaan per anggota Rp12.500.000, terdiri dari Rp10.000.000 modal usaha dalam saldo belanja koperasi dan Rp2.500.000 iuran anggota, admin fee, dan komponen lain. Saldo IDR hanya membayar pesanan koperasi tenant yang sama. Tidak tersedia transfer, tarik tunai, merchant eksternal atau penggunaan saldo untuk membayar iuran/biaya. Nilai tiap komponen Rp2.500.000 belum ditentukan; default seluruhnya kategori belum dirinci, bukan tarif resmi atau pembebasan iuran.

Dasar recovery tetap Rp12.500.000 mengikuti keputusan sebelumnya. Komposisi ini tidak mengubah rasio marginal bagi hasil: 20/80 sampai recovery lunas, lalu 25/75 sebelum Rp10 juta laba pasca-recovery; 30/70 Rp10–50 juta, 50/50 Rp50–100 juta, 60/40 di atas Rp100 juta. Ini asumsi penerusan aturan sebelumnya, bukan keputusan baru mengubah modal yang wajib dikembalikan menjadi Rp10 juta.

## Implementasi demo web

- `shared/member-capital.ts` memvalidasi fee plan, snapshot aktivasi, saldo dan pembayaran pesanan. Aktivasi Rp10 juta sekali per anggota. Fee plan tenant tersimpan pada `sajada-capital-fees`, snapshot anggota pada `sajada-member-capital`.
- Rp2,5 juta harus selalu tepat; setiap komponen rupiah bulat nonnegatif. Konfigurasi berubah hanya untuk aktivasi berikutnya.
- Pencairan lama tanpa breakdown tidak menghasilkan saldo otomatis. Admin mengonfirmasi perubahan komposisi; referensi/tanggal pencairan lama dipertahankan, waktu/aktor aktivasi baru dicatat.
- Marketplace menggunakan anggota pembeli yang dipilih terpisah dari anggota penjual MLM. Pembayaran penuh IDR, pesanan tenant aktif, belum dibayar/dibatalkan/dikirim, dan saldo cukup. Retry untuk pesanan dengan pembeli sama inert; pembeli berbeda ditolak.
- Mutasi debit tersimpan di pesanan (`walletPayment`) dan status lunas ditulis bersama dalam satu snapshot localStorage `sajada-v2`. Saldo = kredit aktivasi − pembayaran + refund; debit asli tetap tersimpan. Ini tidak menjamin konkurensi multi-tab atau keamanan server; data demo dapat diubah pengguna browser.
- Refund penuh pembatalan sebelum pengiriman tersedia; transfer atau tarik tunai tidak tersedia. Retur fisik belum terhubung dengan refund dompet. Debit saldo tidak mengubah stok; pembayaran memungkinkan pengiriman memakai reservasi yang ada.
- Backup menolak biaya tidak seimbang, debit tanpa aktivasi/anggota, status belum lunas, mata uang/tenant berbeda, saldo negatif dan snapshot sumber aktivasi berbeda. Reset demo menghapus saldo dan mutasi sesuai transaksi tenant.

## Akuntansi demo

Aktivasi: Dr 1190 Pendanaan program belum direkonsiliasi Rp12,5 juta; Cr 2210 Saldo belanja anggota Rp10 juta; Cr 2310 Iuran/biaya menunggu klasifikasi Rp2,5 juta. Pengakuan dana kas aktual memerlukan proses rekonsiliasi, belum otomatis. Komponen iuran belum dianggap seluruhnya pendapatan atau beban; jenis simpanan/iuran dan klasifikasi admin fee belum ditentukan.

Pembayaran pesanan: Dr 2210 / Cr 1200 Piutang sebesar total pesanan. Kas/bank tidak bertambah. Penjualan memakai jurnal AR yang sudah ada. Penjualan dan biaya yang dipakai untuk laporan bagi hasil masih diinput sesuai modul sebelumnya; Rp2,5 juta tidak otomatis dimasukkan ke biaya laporan laba.

## Backend PostgreSQL v0.42

Migrasi `capital-wallet.sql` (019) sekali sesudah 018. Compose menginisialisasi database kosong; database existing perlu migrasi manual sebelum kode API baru. Tambahkan `GRANT SELECT, INSERT ON sajada.capital_wallet_activation, sajada.capital_wallet_payment TO sajada_api;` selain grants sebelumnya (termasuk SELECT pada member, capital_account, sales_order, order_item, journal/lines dan UPDATE pada sales_order/journal).

Endpoint staff:
- GET `/v1/members/:memberUUID/capital-wallet`: saldo, snapshot aktivasi, riwayat pembayaran; admin/accountant.
- POST `/v1/members/:memberUUID/capital-wallet/activate`: `{id, reference, fees:{memberDues, adminFee, other, note}}`; admin tenant saja. Pendanaan Rp12,5 juta harus sudah dicatat melalui API capital. Aktivasi terpisah dan eksplisit untuk pendanaan baru/lama, sekali per anggota. Nilai komponen belum ditentukan tetap dikirim sebagai kategori belum dirinci seperti demo.
- POST `/v1/orders/:orderUUID/capital-wallet-payments`: `{id, memberId, reference}`; admin tenant saja. memberId adalah pembeli/pemilik saldo, berbeda dari member_id penjual pesanan. Debit penuh, IDR, saldo cukup, order pending, harga/jumlah cocok rincian order.

Aktor/waktu berasal dari server/JWT; id UUID wajib, referensi maksimal 100, fee plan tepat Rp2,5 juta. Retry UUID + target + payload bisnis sama mengembalikan record awal tanpa jurnal/event baru. Target/request/reference bentrok -> 409; field tidak dikenal atau tidak valid -> 400; target di luar tenant -> 404; peran tidak diizinkan -> 403. Tidak ada endpoint tarik tunai, transfer, pembayaran eksternal atau topup bebas; refund terbatas pada pembatalan penuh sebelum pengiriman. Member self-service belum tersedia; tidak ada pemetaan sub JWT ke member yang dapat membuktikan kepemilikan saldo, sehingga role member belum boleh mendebit dompet.

Ledger `capital_wallet_activation` dan `capital_wallet_payment` append-only, composite tenant FK, referensi unik, satu aktivasi/member, satu wallet payment/order. Saldo dihitung, bukan kolom mutable. SQL guards memeriksa active member, pendanaan, sum biaya, order/rincian, capacity, tanggal/komposisi/reference jurnal posted. Constraint trigger deferred memastikan order berakhir paid dalam transaksi yang sama. Order/payment facts dan item dibekukan setelah pembayaran saldo.

Aktivasi: Dr 1190 Rp12,5 juta; Cr 2210 Rp10 juta; Cr 2310 Rp2,5 juta. Akun 1190 penampung pendanaan belum direkonsiliasi, bukan otomatis kas. Pembayaran backend: Dr 2210 / Cr 2200 Uang muka pelanggan, karena backend sebelumnya belum mengakui penjualan/AR pada order dibuat. Demo browser memakai Dr 2210 / Cr 1200 sesuai model penjualan AR yang sudah tersedia. Pengakuan revenue backend dan rekonsiliasi dana aktual belum ditambahkan; jangan menyatukan dua model jurnal tanpa rekonsiliasi.

Payment + posted journal + order paid + outbox `capital.wallet.order.paid` atomik; activation + posted journal + outbox `capital.wallet.activated` atomik. Kegagalan jurnal/event membatalkan seluruh transaksi. Pembayaran kas pada order yang telah dibayar saldo ditolak, sehingga metode tidak berubah lewat retry kas. Debit tidak mengubah stok/MLM; kirim/terima tetap memakai alur stok dan receipt sebelumnya.

Urutan lock pembayaran: inventory tenant -> finance tenant -> wallet member -> order row. Aktivasi/read saldo memakai wallet member; aktivasi juga finance tenant. SQL guards memakai key advisory wallet yang sama, default READ COMMITTED seperti API. Tes PGlite terurut bukan bukti konkurensi native PostgreSQL. RLS melindungi tenant; RBAC admin diterapkan API, bukan klaim end-user dalam role database bersama.

Source backend telah diuji tetapi belum dideploy/dihubungkan ke web demo. OIDC produksi, konkurensi PostgreSQL native, browser/perangkat belum diuji. Saldo browser tetap localStorage dan dapat dimodifikasi pengguna; jangan menganggapnya dana nyata. Retur fisik belum menghasilkan refund saldo. Fee classification dan sumber dana aktual masih memerlukan keputusan bisnis/rekonsiliasi.


## v0.42 — Refund pembatalan sebelum pengiriman

Migration `capital-wallet-refund.sql` (020), sesudah 019, wajib sekali pada database existing sebelum API baru. Grant SELECT,INSERT pada `sajada.capital_wallet_refund` untuk role API selain grants sebelumnya. Compose memuat migrasi untuk database kosong. Ledger refund append-only dengan composite FK ke pembayaran, pesanan, anggota dan jurnal; satu refund per pembayaran/pesanan; referensi tenant unik.

POST `/v1/orders/:orderUUID/capital-wallet-refunds`, admin tenant saja, body `{id,reference,reason}`. Nominal dan penerima tidak diterima dari klien: selalu jumlah penuh pembayaran asli, ke member_id pembeli asal. Waktu dan aktor dari JWT/server. Referensi maksimal 100, alasan 200 karakter. Admin memberi persetujuan melalui tindakan ini; belum ada workflow maker-checker terpisah. Request UUID sama dan payload bisnis sama inert; UUID/referensi/alasan berbeda pada refund yang sudah tercatat -> 409. Field/UUID/alasan tidak valid -> 400; pembayaran tidak ditemukan pada tenant -> 404; role accountant/member -> 403.

Hanya order paid dengan pembayaran wallet asli, belum dispatched/received, inventory_location_id ada, seluruh reservasi aktif dan jumlah/produk/lokasi cocok order. Mode inventory lama tanpa lokasi, pembayaran kas, barang sudah dikirim, refund parsial, refund iuran/admin dan pencairan tunai tidak tersedia. Refund boleh mengembalikan saldo ke akun anggota yang sudah tidak aktif; debit baru tetap memerlukan active member.

Dalam satu transaksi: inventory tenant lock -> finance tenant lock -> wallet anggota asli lock -> order row lock; periksa bukti reservasi, posted reversal journal, insert refund, release seluruh reservasi, status order cancelled + audit, outbox `capital.wallet.order.refunded`. Inventory release juga menjalankan evaluasi safety PO dalam transaksi. SQL memverifikasi pembayaran/nominal/anggota/waktu/jurnal; deferred constraint memastikan cancellation audit dan reservasi cancelled serta total item/lokasi cocok. Kegagalan event/constraint membatalkan credit, release, journal, cancellation dan audit. Gunakan default READ COMMITTED; tes embedded bukan pembuktian konkurensi native PostgreSQL.

Jurnal backend Dr 2200 Uang muka pelanggan / Cr 2210 Saldo anggota. Demo browser mempertahankan penjualan dan pembayaran asli, membalik penjualan Dr 4100 / Cr 1200, serta refund Dr 1200 / Cr 2210; kas tidak bertambah. Fee snapshot Rp2,5 juta, funding dan recovery investor tidak berubah. Backend saldo tersedia sebagai opening, grossSpent, refunded, spent neto, available dan seluruh riwayat. Saldo dapat dipakai lagi untuk pesanan baru; order lama tetap cancelled dan tidak dapat dibuka kembali. Retry payment lama tetap mengembalikan record historis, bukan pembayaran baru; periksa status order dan ledger refund saat integrasi.

Demo menyimpan walletRefund beserta alasan/referensi/aktor/waktu dalam snapshot order yang sama dengan pembatalan/reservasi, menjaga paid sebagai bukti pembayaran historis. Backup memvalidasi saldo dan refund, audit cancel, serta release stock; pembatalan tanpa refund pada order wallet tetap ditolak. Riwayat saldo divalidasi sesuai timestamp; seri timestamp memakai urutan order tertua dan koreksi target, bukan bukti urutan fisik antar tab. LocalStorage tetap bukan penyimpanan uang nyata atau kontrol konkurensi server. Order cancelled tidak memenuhi syarat komisi MLM.

Refund retur setelah shipment/receipt dan pengembalian sebagian akan memerlukan alur terpisah dengan rekonsiliasi barang, kredit penjualan dan koreksi komisi. Fitur tersebut belum tersedia. Source backend belum dideploy/terhubung demo; pengujian browser dan native PostgreSQL concurrency belum dilakukan.

Refund demo otomatis hanya untuk order dengan receiptPolicy `full-receipt-v1`. Order browser lama dapat memiliki komisi dari penanda selesai manual; order tersebut memerlukan rekonsiliasi komisi/penerimaan sebelum refund dan tidak ditangani alur ini. Backend memeriksa status paid, dispatched/received dan bukti reservasi native.
