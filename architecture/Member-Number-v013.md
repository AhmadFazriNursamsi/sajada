# Sajada v0.13 — Nomor anggota wilayah + tahun + urut

Format implementasi: PPKKCCYYNNNNNN, 14 digit tanpa separator.
PP = kode lokal provinsi 2 digit; KK = kode lokal kabupaten/kota 2 digit; CC = kode lokal kecamatan 2 digit; YY = tahun penerbitan Asia/Jakarta; NNNNNN = urutan 6 digit. Kelurahan tidak ikut nomor. Kode dimasukkan pengguna sesuai master koperasi, bukan diasumsikan dari nama wilayah. Jangan memasukkan kode lengkap berulang (provinsi+kabupaten di field kabupaten).

Contoh sintetik: 01 + 02 + 04 + 26 + 000001 = 01020426000001. Bukan klaim kode geografis resmi.

Keputusan default yang dinyatakan kepada pengguna: counter per tenant dan tahun, bukan per kecamatan. Mulai 000001 setiap tahun baru. Anggota lama tetap memakai nomor terbit lama ketika pindah wilayah, kode wilayah diubah, atau berganti tahun. Nomor unik di tenant; gabungkan tenant_id dengan member_number untuk identitas lintas tenant. Maksimum 999999 per tahun per tenant, gagal jika habis. Rentang YY didukung 2000–2099 agar tidak ada rollover abad diam-diam.

Langkah: Struktur daerah > edit provinsi/kabupaten/kecamatan untuk mengisi kode lokal 2 digit > tempatkan anggota > Anggota koperasi > Nomor anggota > Terbitkan nomor. Tidak ada nomor fiktif otomatis saat kode belum lengkap. Anggota tersimpan sebelumnya tetap dipertahankan dan belum bernomor sampai diterbitkan.

Penerbitan membaca counter terkini di bawah Web Locks pada browser yang mendukung; reissue idempotent. Nomor dan counter disimpan dalam satu payload tenant. Lock ini hanya antar-tab asal/browser sama, bukan lintas perangkat. Produksi memerlukan transaction + row lock PostgreSQL, unique(tenant_id,member_number), unique(tenant_id,year,sequence), dan UUID internal anggota. Nomor adalah business identifier, belum menggantikan semua relasi demo yang memakai nama.

Backup mencakup namespace nomor dan snapshot kode/tahun. Restore menolak format tidak sesuai, counter mundur, dan perubahan/hilangnya nomor yang masih ada pada browser. Perlindungan ini tidak bisa mendeteksi nomor yang diterbitkan di perangkat lain atau backup eksternal lebih baru. Reset transaksi keuangan tidak menghapus nomor/counter.

20 uji terarah (7 nomor, 5 wilayah, 8 backup), TypeScript/build. Browser dan database integration belum diuji.
