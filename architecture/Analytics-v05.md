# Sajada v0.5 — Dashboard berbasis transaksi demo

## Implementasi
Dashboard menggantikan KPI/kurva/ranking statis dengan agregasi pesanan tenant aktif. Filter bulan berlaku untuk nilai pesanan, jumlah pesanan, nilai rata-rata, grafik harian, peringkat produk, peringkat anggota, dan pesanan terbaru. Jumlah anggota serta posisi kas, AR, AP dan komisi belum dibayar menggunakan seluruh data tenant; cakupannya ditulis di layar.

Tanggal lama d/m/yyyy dinormalisasi; pesanan baru menyimpan yyyy-mm-dd zona Asia/Jakarta. Data pesanan digabung per order_id agar tidak dihitung dua kali. Perbandingan bulan sebelumnya tidak ditampilkan sebagai persentase jika nilai pembanding nol. Nilai pesanan meliputi lunas dan belum lunas, bukan revenue yang telah memenuhi kebijakan pengakuan atau laba. Tidak ada HPP/pajak.

Kas/AP berasal dari transaksi dan jurnal demo v0.4. Komisi hanya berasal dari pesanan lunas dan selesai sesuai v0.3; komisi belum disinkronkan ke GL. Angka dashboard menggunakan snapshot data lokal saat membuka modul dan berubah ketika tenant diganti.

## Cara uji
Pilih tenant, buat pesanan di Marketplace, kembali ke Ringkasan dengan bulan transaksi. Grafik, ranking anggota/produk dan piutang berubah. Catat pembayaran AR dan kembali ke Ringkasan; kas bertambah, piutang berkurang. Catat tagihan/pembayaran AP; posisi utang/kas ikut berubah. Pilih bulan kosong atau tenant lain untuk memeriksa batas agregasi.

## ClickHouse
Hosted dashboard belum memanggil ClickHouse. Consumer fondasi v0.2 hanya menyimpan raw domain events. Untuk analytics produksi yang setara, event order perlu membawa item lines, seller/member ID, transaction time, currency/base amount, frozen FX and region snapshot. Bangun read model tervalidasi, deduplication, late-arrival handling dan rekonsiliasi terhadap PostgreSQL. Hindari memanggil amount received sebagai revenue. Jangan membocorkan query atau kredensial ClickHouse ke browser.

## Verifikasi
25 unit tests (5 analytics, 7 accounting, 9 MLM, 4 API domain), TypeScript, production build. Browser automation dan database integration belum dilakukan.
