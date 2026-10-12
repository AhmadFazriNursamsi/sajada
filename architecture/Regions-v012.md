# Sajada v0.12 — Hierarki wilayah anggota
Menu Struktur daerah menggantikan angka statis dengan master wilayah tenant dan penempatan anggota. Empat tingkat: provinsi, kabupaten/kota, kecamatan, kelurahan/desa. ID internal UUID untuk data baru, bukan kode resmi pemerintah.

Sample awal terbatas pada beberapa wilayah Jawa Barat; bukan master nasional terverifikasi. Anggota lama tidak otomatis dipetakan dari nama kota, untuk menghindari tebakan kelurahan. Semua penempatan awal kosong dan perlu dipilih pengguna. Anggota baru dapat ditempatkan setelah registrasi.

Tambah wilayah memerlukan induk tepat satu tingkat di atas. Nama duplikat dalam induk yang sama dan ID ganda ditolak. Edit mempertahankan tingkat/induk, hanya mengubah nama. Penghapusan ditolak jika node punya anak atau digunakan anggota. Perhitungan anggota unik mencakup seluruh turunan.

Penempatan hanya pada desa/kelurahan. Kota yang tampil di daftar anggota diperbarui dari path wilayah. Update massal setelah rename dilakukan sekali untuk menghindari stale state. Nama anggota masih identitas demo; UUID anggota diperlukan untuk produksi.

Backup schema menerima namespace sajada-regions opsional agar backup sebelumnya tetap kompatibel. Penempatan yang merujuk node non-leaf atau anggota asing ditolak pada restore. Restore backup lama tanpa namespace ini kembali ke master contoh dan penempatan kosong.

13 uji terarah (5 wilayah, 8 backup) lulus, TypeScript/build. Browser dan database integration belum diuji.
