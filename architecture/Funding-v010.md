# v0.10 — Investor individual dan alokasi pendanaan
Menu Investor & pendanaan menyediakan daftar investor ber-ID tetap, kode unik tenant dan alokasi per anggota. Total alokasi wajib IDR 12.500.000; investor tak dikenal, duplikasi investor dalam alokasi dan nominal tidak valid ditolak.

Aturan demo: bagian investor dibagi proporsional kontribusi. Contoh kontribusi Rp7,5 juta dan Rp5 juta menghasilkan porsi 60%/40% atas bagian investor, terpisah dari porsi anggota. Ini konfigurasi implementasi demo, bukan kontrak investasi yang telah disetujui.

Laporan bertingkat baru wajib memiliki alokasi lengkap dan menyimpan snapshot nama/ID/nominal. Alokasi terkunci setelah digunakan laporan (termasuk draf). Menghapus semua draf pemakai dapat membuka alokasi kembali; laporan settled tidak dapat diubah lewat UI. Riwayat lama tidak dipetakan retroaktif: total tanpa snapshot ditampilkan sebagai belum terpetakan.

Rekap dan CSV menyajikan principal returned dan post-recovery profit per investor. Largest remainder dengan arithmetic BigInt menjaga total rupiah tiap pembagian. Investor receipts adalah turunan settled demo, bukan settlement bank. Pembulatan per laporan dapat membutuhkan rekonsiliasi akumulasi pokok individual saat produksi; belum ada subledger investor, penarikan, reassignment, alokasi kerugian atau approval.

Reset transaksi menghapus laporan sehingga alokasi dapat diubah kembali; direktori investor dan rencana pendanaan tetap disimpan. Investor masih berlingkup tenant browser; belum ada autentikasi investor individual atau database backend.

Empat tes baru dan TypeScript/build. Browser dan integration database belum diuji.
