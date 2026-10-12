# Sajada v0.9 — Dashboard investor
Rekap tenant untuk alokasi, pencairan demo, modal kembali dan sisa modal aktif. Alokasi belum dicairkan bukan modal aktif. Hanya laporan settled dihitung sebagai pembagian; draf tidak masuk arus pengembalian atau bagi hasil. Filter periode berlaku untuk pengembalian modal dan pembagian; saldo modal tetap seluruh periode dan ditandai demikian.

Kalkulator read-only menggunakan modal awal Rp12,5 juta atau state settled anggota terpilih. Menampilkan breakdown marginal dan saldo setelah skenario tanpa menyimpan. Ekspor CSV memakai IDR dasar dan mencakup filter, saldo serta pemisahan pokok/hasil. CSV melakukan escaping dan netralisasi awalan formula pada sel.

Belum memetakan pendanaan kepada investor individual; ini tampilan agregat tenant. Transfer, GL penyertaan, rugi, bukti bank dan server database tetap belum diimplementasikan.

Empat tes agregasi baru memeriksa alokasi belum dicairkan, draf, filter flow vs saldo, dan pemisahan principal/profit. TypeScript dan production build. Browser QA belum dilakukan.
