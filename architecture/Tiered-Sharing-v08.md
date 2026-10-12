# Sajada v0.8 — Bagi hasil bertingkat setelah balik modal

## Kebijakan pengguna
Modal awal IDR 12.500.000. Sebelum modal kembali, anggota menerima 20% laba dan investor 80%; seluruh bagian investor ini mengurangi sisa modal. Setelah lunas, keuntungan untuk ambang mulai dari nol, bukan sejak awal usaha dan bukan hanya bagian anggota.

Bagian laba pasca-balik modal:
- Rp0 sampai Rp10.000.000: anggota 25%, investor 75%.
- Bagian di atas Rp10.000.000 sampai Rp50.000.000: 30% / 70%.
- Bagian di atas Rp50.000.000 sampai Rp100.000.000: 50% / 50%.
- Bagian di atas Rp100.000.000: 60% / 40%.

Marginal: setiap bagian melampaui ambang memakai rasio baru, bagian sebelumnya tidak dihitung ulang. Dengan rasio 80%, laba Rp15.625.000 mengembalikan tepat Rp12.500.000 modal; anggota memperoleh Rp3.125.000. Contoh laba pertama Rp30 juta: pemulihan modal Rp15.625.000 x 20/80; tahap berikutnya Rp10 juta x 25/75; sisa Rp4.375.000 x 30/70. Total anggota Rp6.937.500, investor Rp23.062.500 (termasuk modal Rp12,5 juta). Akumulasi pasca-balik modal Rp14.375.000.

## Implementasi
Engine shared/tiered-sharing.ts menyimpan saldo sebelum/sesudah serta breakdown tiap bagian. Draf tidak mengurangi modal. Tombol pencatatan pembagian demo dengan referensi mengubah status settled dan saldo simulasi. Bukan bukti bank. Bagian investor dibedakan menjadi pengembalian modal dan hasil setelah modal lunas, agar modal tidak dibayar dua kali.

Laporan bulanan per anggota wajib berurutan; periode duplikat, backdate relatif terhadap laporan lain, dan draf belum selesai memblokir laporan berikutnya. Satu draf boleh dihapus sebelum settled. Tidak tersedia perubahan settled; koreksi produksi memerlukan reversal terkontrol. Arsip persentase manual v0.7 tetap ditampilkan dan tidak dimigrasikan ke saldo pengembalian modal karena tidak mempunyai bukti settlement.

Pembulatan ke rupiah per segmen; investor tidak boleh menerima pengembalian melebihi sisa modal. Segmen pelunasan menggunakan pembulatan ke atas untuk dasar laba terakhir, sisa pembagian ke anggota; perbedaan sub-rupiah dijelaskan oleh kebijakan pembulatan ini. Batas input engine Rp1 triliun. Sistem menggunakan angka rupiah integer untuk demo.

## Belum ditetapkan / diimplementasikan
Kerugian/kompensasi kerugian, pajak, sumber dana, tenor dan pengembalian di luar bagi hasil. Laporan rugi ditolak, tidak dianggap nol; jangan melanjutkan periode berikutnya tanpa penetapan kebijakan rugi. Belum ada integrasi bank, jurnal GL, verifikasi laba, approval dua pihak, UUID anggota, atau koneksi database. Data lokal per tenant dan nama unik anggota. Komisi MLM dan SHU terpisah.

## Uji
Sembilan unit test baru: recovery tepat, crossing modal + tahap, semua ambang marginal, konservasi pembulatan, validasi state, status draf vs settled, duplicate settlement dan kronologi. TypeScript dan production build. Browser dan database integration belum diuji.
