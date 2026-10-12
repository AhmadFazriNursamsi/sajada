# Menjalankan Sajada di server

Setiap push ke `main` membuat dua image di GitHub Container Registry (workflow `.github/workflows/docker.yml`):

- `ghcr.io/ahmadfazrinursamsi/sajada`: aplikasi web + API `/v1`
- `ghcr.io/ahmadfazrinursamsi/sajada-db`: PostgreSQL 16 berisi skema dan semua migrasi

Tag `latest` mengikuti `main`; setiap commit juga punya tag `sha-<7 karakter>` untuk mengunci versi. Image dibuat untuk `linux/amd64`.

## Pertama kali

Server hanya butuh Docker (dengan plugin `docker compose`), nginx, certbot, serta tiga file dari folder ini: `compose.yaml`, `.env.example` dan `nginx-sajada.conf`. Domain `sajada.devoutsys.com` sudah mengarah ke server (202.59.166.142).

```bash
mkdir ~/sajada && cd ~/sajada
# salin compose.yaml, .env.example dan nginx-sajada.conf ke folder ini, lalu:
cp .env.example .env
for k in POSTGRES_PASSWORD SAJADA_API_PASSWORD SAJADA_WEB_PASSWORD; do
  sed -i "s/^$k=.*/$k=$(openssl rand -hex 16)/" .env
done
chmod 600 .env
grep SAJADA_WEB_PASSWORD .env   # password untuk login di browser (user: admin)

# Repo privat, jadi image juga privat: login sekali dengan Personal Access Token
# (classic) yang punya scope read:packages.
echo <TOKEN> | docker login ghcr.io -u AhmadFazriNursamsi --password-stdin

docker compose pull
docker compose up -d
```

Saat pertama jalan, database dibuat dari migrasi dan tiga koperasi demo diisi otomatis. Bila port 3000 di server sudah dipakai, ubah `APP_PORT` di `.env` dan port di `nginx-sajada.conf`.

## Domain dan HTTPS (nginx)

```bash
sudo cp nginx-sajada.conf /etc/nginx/sites-available/sajada
sudo ln -s /etc/nginx/sites-available/sajada /etc/nginx/sites-enabled/sajada
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d sajada.devoutsys.com   # sertifikat Let's Encrypt + redirect ke https
```

Buka https://sajada.devoutsys.com, lalu login dengan user `admin` dan `SAJADA_WEB_PASSWORD` dari `.env`.

Belum ada akun per pengguna: satu password itu melindungi semua halaman (HTTP Basic, dicek oleh aplikasi sendiri di `proxy.ts`), jadi bagikan hanya ke pengurus yang berwenang dan ganti bila bocor (ubah `.env`, lalu `docker compose up -d`). Bila `SAJADA_WEB_PASSWORD` kosong, aplikasi menolak domain dan hanya melayani `127.0.0.1` (SSH tunnel: `ssh -N -L 3000:127.0.0.1:3000 user@server`). API `/v1` tidak memakai password ini; ia memakai token OIDC.

## Memperbarui

```bash
docker compose pull && docker compose up -d
```

Data PostgreSQL ada di volume `sajada_pgdata` dan tidak hilang saat update. Migrasi di image database hanya dijalankan untuk volume baru; migrasi baru untuk database yang sudah ada harus dijalankan manual.

## Perintah lain

```bash
docker compose logs -f app                                        # log aplikasi
docker compose exec postgres pg_dump -U sajada_owner sajada > backup.sql   # backup
docker compose down                                               # hentikan (data tetap ada)
```
