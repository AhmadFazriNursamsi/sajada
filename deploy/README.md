# Menjalankan Sajada di server

Setiap push ke `main` membuat dua image di GitHub Container Registry (workflow `.github/workflows/docker.yml`):

- `ghcr.io/ahmadfazrinursamsi/sajada`: aplikasi web + API `/v1`
- `ghcr.io/ahmadfazrinursamsi/sajada-db`: PostgreSQL 16 berisi skema dan semua migrasi

Tag `latest` mengikuti `main`; setiap commit juga punya tag `sha-<7 karakter>` untuk mengunci versi. Image dibuat untuk `linux/amd64`.

## Pertama kali

Server hanya butuh Docker (dengan plugin `docker compose`) serta dua file dari folder ini: `compose.yaml` dan `.env.example`.

```bash
mkdir ~/sajada && cd ~/sajada
# salin compose.yaml dan .env.example ke folder ini, lalu:
cp .env.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/; s/^SAJADA_API_PASSWORD=.*/SAJADA_API_PASSWORD=$(openssl rand -hex 16)/" .env
chmod 600 .env

# Repo privat, jadi image juga privat: login sekali dengan Personal Access Token
# (classic) yang punya scope read:packages.
echo <TOKEN> | docker login ghcr.io -u AhmadFazriNursamsi --password-stdin

docker compose pull
docker compose up -d
```

Saat pertama jalan, database dibuat dari migrasi dan tiga koperasi demo diisi otomatis.

## Membuka aplikasi

Belum ada login, jadi aplikasi hanya melayani permintaan ke `127.0.0.1` (`lib/server/local.ts`) dan hanya dipublikasikan di loopback server. Buka lewat SSH tunnel dari komputer Anda:

```bash
ssh -N -L 3000:127.0.0.1:3000 user@server
```

lalu buka http://127.0.0.1:3000. Jangan memasang reverse proxy publik atau mengubah port menjadi `0.0.0.0` sebelum ada fitur login: siapa pun yang bisa membuka aplikasi bisa mengubah dan mereset data.

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
