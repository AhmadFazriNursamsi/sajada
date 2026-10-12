# Sajada v0.6 — Produk, stok, dan modal awal anggota

## Produk dan stok
Menu Produk & stok mendukung tambah/edit produk, SKU unik per tenant, status aktif, penyesuaian stok positif/negatif dengan alasan, serta riwayat maksimal 100 baris pada layar. Harga master IDR. Checkout memvalidasi produk aktif dan jumlah seluruh item, mengurangi stok, dan menyimpan pesanan/stok/pergerakan dalam satu payload localStorage tenant. Ini atomik pada satu penulisan browser tetapi bukan concurrency control antar-tab. Tidak ada reservasi, cancellation/return, multigudang, COGS atau update stok dari AP. Pesanan lama tidak mengurangi stok retroaktif. Produk bawaan menjadi baseline v0.6.

## Modal awal Rp12.500.000 per anggota
Halaman Anggota koperasi menampilkan alokasi otomatis sebesar IDR 12.500.000 untuk setiap anggota unik tenant, termasuk anggota baru. Total alokasi = jumlah anggota x 12.500.000. Status awal dialokasikan. Simulasi pencairan membutuhkan referensi/sumber dana dan tanggal; pencairan kedua anggota yang sama ditolak.

Alokasi belum merupakan dana kas masuk, piutang anggota atau transfer nyata. Sifat modal (hibah/pinjaman/penyertaan) serta sumber pendanaan belum ditentukan. Tidak ada jurnal GL, perhitungan cicilan, atau saldo dompet yang dapat dibelanjakan. Jangan menganggap jumlah ini sudah tersedia di bank koperasi. Setoran modal dalam Akuntansi adalah transaksi tersendiri.

Demo mengidentifikasi anggota menggunakan nama unik per tenant; migrasi produksi harus memakai UUID serta unique(tenant_id,member_id,program_id) untuk mencegah alokasi ganda. Identitas lintas tenant dan keanggotaan ganda harus disepakati sebelum produksi. Status pencairan lokal tidak menggantikan approval dan bukti settlement.

## Uji
34 unit tests, TypeScript dan production build. Browser QA, integrasi PostgreSQL/ClickHouse dan perangkat mobile belum diuji. Reset data mengembalikan katalog/stok ke baseline, menghapus transaksi keuangan dan mengembalikan status modal anggota menjadi dialokasikan.
