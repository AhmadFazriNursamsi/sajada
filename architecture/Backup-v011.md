# v0.11 — Backup, restore, consistency and principal reconciliation

Pengaturan menyediakan export backup JSON per tenant, pemeriksaan konsistensi dan restore. Backup berisi delapan namespace data aplikasi. Parser menolak schema/tenant asing, bentuk data salah, pesanan dengan total item tidak cocok, pembayaran tanpa sumber, jaringan siklik, saldo AP negatif, kurs buku tidak cocok, laporan bertingkat tidak sesuai replay, dan status komisi tanpa transaksi sumber.

Restore memerlukan pratinjau dan checkbox di UI. Data tenant lain tidak disentuh. Aplikasi mengunduh backup sebelum perubahan dan menyimpan nilai storage lama di memori untuk rollback jika penulisan gagal. Ini bukan transaksi database; gunakan satu tab. Backup 5 MB maksimum; nama dan transaksi dalam JSON tidak terenkripsi. Export mentah tetap dapat dilakukan walaupun checker menemukan masalah sehingga data asli dapat diselamatkan untuk investigasi.

Rekap investor sekarang replay settled reports kronologis. Pengembalian pokok di tiap laporan dibatasi oleh sisa kontribusi investor; surplus rounding dialihkan hanya kepada investor dengan pokok tersisa. Total laporan tetap konservatif, pokok tiap investor tidak bisa melebihi kontribusinya. Perubahan snapshot funding selama riwayat ditolak. Ini memperbaiki keterbatasan rekonsiliasi pembulatan v0.10. CSV menggunakan hasil replay yang sama.

Checker bukan audit eksternal atau autentikasi data. Nilai transaksi dapat tetap fiktif walaupun internal konsisten. Tidak menggantikan PostgreSQL backups, server audit trails, bank reconciliation atau approval. Pemulihan bukan reversal produksi.

13 uji terarah backup/funding lulus; TypeScript/build. Browser UI dan database integration belum diuji.
