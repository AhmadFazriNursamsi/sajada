# Unggah source Sajada ke GitHub

Ekstrak ZIP; folder sajada-v0.42 menjadi root repository (package.json berada di root). Buat repository private di akun/organisasi tujuan. Untuk repository baru, pilih tanpa initial README agar tidak ada riwayat awal yang berbenturan.

```bash
cd sajada-v0.42
git init
git add .
git commit -m "Import Sajada v0.42 source and database"
git branch -M main
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

Ganti OWNER/REPOSITORY dengan tujuan nyata. Gunakan GitHub CLI, credential manager atau SSH untuk autentikasi; jangan menulis token pada URL remote atau source. Untuk repository yang sudah berisi code, gunakan branch terpisah dan review diff sebelum merge; jangan force-push.

ZIP ini telah dibuat sebagai deliverable. Tidak ada repository GitHub baru atau push GitHub yang dilakukan karena akun/repository tujuan belum ditentukan.
