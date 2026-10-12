# Sajada v0.14 — Kartu anggota dan pencarian nomor
Halaman Anggota koperasi / Nomor anggota memiliki pencarian nama atau nomor 14 digit, ekspor CSV nomor yang sudah terbit, dan pratinjau kartu per anggota. Kartu memakai snapshot nomor dan kode saat penerbitan, sehingga alamat terkini tidak mengubah identitas terbit.

Kartu menampilkan nama, tenant, nomor, tanggal penerbitan dan kode wilayah. Label prototipe/bukan kartu resmi tampil karena belum ada verifikasi identitas server. Tombol cetak membuka dialog print browser; user dapat memilih Simpan PDF. CSS cetak ditargetkan 85,6 x 54 mm. Tampilan cetak belum diverifikasi browser atau printer, sehingga skala dan hasil perlu dicek sebelum cetak fisik.

Ekspor CSV mengutip sel, netralisasi awalan formula, dan UTF-8 BOM. Nomor tetap string dalam data; saat impor ke Excel set tipe kolom Teks agar leading zero tidak dihapus oleh Excel. Tidak ada QR publik atau data anggota yang diunggah ke pihak lain.

Pemeriksaan TypeScript dan production build. Tidak menambahkan unit test yang hanya mencerminkan perubahan UI sederhana. Browser/print QA belum dilakukan.
