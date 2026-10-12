# Validasi paket export

- Source dari commit 9a298598a3b98a3600d7320abb84b0f02b2eaacb, Sajada v0.42.
- Seluruh 20 tahap migrasi pada SQL gabungan berhasil dieksekusi dalam database PGlite baru.
- 32 tabel, 236 kolom, 61 foreign key, 30 policy RLS, 43 trigger aplikasi ditemukan pada catalog.
- Tidak ada seed transaksi/anggota operasional.
- Sebelum export, versi source lulus 441 pengujian dan build; setelah perubahan pembatasan receipt policy, 38 pengujian domain terkait dan build ulang juga lulus. Export tidak mengklaim pengujian instalasi dependency dari internet atau native PostgreSQL, concurrency, browser, ClickHouse runtime dan perangkat mobile.
- ZIP diuji integrity/CRC dan daftar isinya dibandingkan dengan manifest SHA-256 per file.

Lockfiles asli web/API/test dipertahankan. Starter mobile dan consumer analytics belum mempunyai lockfile terpisah pada source asal; package.json keduanya disertakan. Instalasi/validasi runtime masing-masing tetap perlu dilakukan.
