# Sajada v0.4 — AP, AR, GL dan neraca saldo demo

## Cara mencoba
1. Akuntansi > Modal masuk: catat Rp1.000.000. Jurnal debit kas / kredit modal.
2. Utang (AP) > Tagihan pemasok: buat invoice USD 10, kurs 15.500, akun persediaan. Nilai buku Rp155.000, jurnal debit persediaan / kredit utang.
3. Bayar demo Rp50.000. Sisa utang Rp105.000 dan kas Rp950.000. Pembayaran di atas sisa utang atau saldo kas ditolak.
4. Periksa Buku besar, filter akun, dan ekspor GL ke CSV.
5. Periksa Neraca saldo: saldo debit harus sama dengan saldo kredit.
6. Marketplace -> checkout -> AR -> catat pembayaran penuh untuk melihat jurnal penjualan dan penerimaan.

## Lingkup
Data per tenant tersimpan di browser. AP mendukung pembayaran sebagian; AR masih pembayaran penuh. Kurs tagihan dikunci ke IDR saat pencatatan; pembayaran AP hanya dalam IDR sebesar nilai buku. Ini bukan revaluasi FX atau realisasi selisih kurs. Neraca saldo tidak menggunakan saldo awal fiktif. Modal masuk menghasilkan pasangan jurnal kas/modal.

Jurnal demo dihitung ulang secara deterministik dari transaksi, bukan tabel ledger server yang immutable. Akun persediaan pada AP hanya pencatatan nilai; tidak menambah stok katalog. Pembelian beban dapat menggunakan 5100. Belum ada pajak, COGS, period closing, SHU, komisi GL atau sinkronisasi backend. Reset transaksi menghapus seluruh data keuangan demo tenant (termasuk AP, modal dan komisi) agar tidak menyisakan jurnal pembayaran tanpa sumber.

Pengakuan penjualan pada checkout dipertahankan sebagai ilustrasi lama pada frontend; fondasi API menggunakan penerimaan uang muka. Penyatuan kebijakan pengakuan, fulfillment, retur dan migrasi menjadi pekerjaan integrasi berikutnya.

## Verifikasi
20 unit tests (7 accounting, 9 MLM, 4 domain API), TypeScript, production build. Tidak ada pengujian browser atau integrasi database pada lingkungan ini.
