# Sajada v0.3 — Jaringan dan komisi demo

## Alur uji di situs
1. Pilih tenant. Buka Jaringan MLM; atur sponsor anggota. Perubahan yang membentuk siklus atau memilih sponsor di luar graph ditolak.
2. Buka Marketplace, tambahkan produk, buka keranjang, pilih anggota penjual, buat pesanan.
3. Buka Akuntansi > Piutang (AR), catat pembayaran demo.
4. Buka Pendapatan, tandai pesanan selesai pada Kelayakan transaksi.
5. Pilih penjual atau sponsor penerima. Lihat rincian komisi per pesanan.
6. Setujui demo, lalu simulasikan pembayaran. Tidak ada transfer dana atau jurnal pembayaran komisi.
7. Ekspor CSV. Ubah sponsor lalu buat pesanan baru untuk membandingkan snapshot.

## Aturan yang diimplementasikan
- Setiap anggota memiliki nol atau satu sponsor dalam tenant aktif; siklus ditolak.
- Demo menggunakan nama unik per tenant sebagai identitas. Produksi wajib UUID tetap.
- Snapshot seluruh upline serta versi kebijakan melekat pada pesanan baru.
- Komisi hanya dihitung setelah pembayaran dan penyelesaian; pesanan sebelum v0.3 tidak memiliki snapshot sehingga dikecualikan secara eksplisit.
- Personal 5%; upline level 1/2/3 sebesar 3%/2%/1%. Pembulatan per baris ke rupiah terdekat.
- Penjualan grup = penjualan sendiri + transaksi semua keturunan berdasarkan snapshot. Satu order_id dihitung sekali. Level keempat dan berikutnya masuk volume grup tetapi tidak mendapat komisi pada kebijakan demo ini.
- Status pending -> approved -> paid. Paid hanya simulasi; tidak memanggil payment gateway.
- Semua data lokal dipisahkan per tenant. Riwayat lokal tidak setara audit log server yang tahan modifikasi.
- Pendapatan menunjukkan seluruh transaksi demo, tidak mengikuti pemilih bulan dashboard. Teks lingkup ditampilkan di modul.

## Verifikasi
13 unit tests total: 9 MLM + 4 domain API, serta TypeScript dan production build. Tidak ada browser automation, database integration, atau device test.

## Batas produksi
Engine komisi murni ada di shared/mlm.ts dan dapat digunakan server setelah otorisasi serta validasi snapshot. Belum ada layanan komisi PostgreSQL yang aktif. Persetujuan ganda/checker, payout gateway, kewajiban komisi GL, retur/clawback, pajak, batas komisi dan eligibility, kebijakan efektif per tenant, rekonsiliasi, dan SHU belum diimplementasikan.

Skema produksi yang disarankan: commission_policy (version/effective dates/rates), sponsor_history, order_network_snapshot, commission_accrual (unique tenant/order/beneficiary/level/policy), commission_approval, payout_batch, payout_item dan audit_event. Hitung dalam transaksi idempotent, gunakan signed integer minor units atau numeric, dan catat reversal alih-alih mengubah accrual yang telah dibayar.
