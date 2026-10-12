# v0.7 — Penyertaan dengan bagi hasil
User menetapkan Rp12.500.000 sebagai penyertaan dengan bagi hasil. Ini menggantikan status sifat modal belum ditentukan pada v0.6. Sumber dana dan pihak pemberi modal belum ditetapkan, demikian pula rasio, periode perjanjian, penarikan pokok, pajak, dan pembagian kerugian.

UI Anggota koperasi menampilkan penyertaan otomatis dan simulasi pencairan, diikuti laporan usaha bulanan. Rasio tidak memiliki nilai default; operator mengisi rasio anggota dan referensi kesepakatan. Porsi pemberi modal adalah komplemennya. Dasar hitung demo adalah pendapatan dikurangi total biaya yang diinput secara manual. Tidak ada janji hasil tetap atau hasil berbasis pokok. Kerugian menghasilkan pembagian nol; alokasi kerugian/pengurangan modal tidak dimodelkan.

Satu laporan per anggota/per bulan. Laporan menyimpan nilai, rasio dan referensi sebagai snapshot. Tidak ada jurnal otomatis, pengurangan kas, transfer, dompet, atau settlement. Komisi MLM dan SHU tetap terpisah. Penggunaan produksi memerlukan identitas anggota UUID, verifikasi laporan, persetujuan, klasifikasi akuntansi sesuai perjanjian dan kontrol server.

Validasi: empat unit test profit sharing, pemeriksaan TypeScript dan production build. Integrasi browser/database belum diuji.
