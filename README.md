# status-hananime

Halaman status Hananime di [status.hananime.fun](https://status.hananime.fun).

- **Monitor**: GitHub Actions mengecek Website, API dan katalog, Streaming, Login dan akun, serta Komentar dan notifikasi tiap 5 menit, dari luar server Hananime (`scripts/check.mjs`).
- **Insiden otomatis**: gagal 3 kali berturut-turut membuka issue `incident` + `auto`; sukses 2 kali berturut-turut menutupnya sebagai Resolved.
- **Halaman**: `scripts/build.mjs` menggabungkan hasil cek (branch `data`) dan issue jadi `status.json`, lalu GitHub Pages menyajikan folder `site/`.
- **Email**: `scripts/notify.mjs` mengirim tiap update insiden ke pelanggan (segment di Resend), kalau secret `RESEND_API_KEY` dan `RESEND_SEGMENT_ID` diisi.

## Menulis insiden

Buka issue dengan label `incident` dan label komponen (`komponen:web`, `komponen:api`, `komponen:stream`, `komponen:auth`, `komponen:live`). Tambah `minor` untuk gangguan ringan; tanpa itu dianggap berat.

```
Investigating: Video lambat dimuat di server Berkas. Kami sedang memeriksanya.
```

Update lewat komentar yang diawali status:

```
Identified: Sumber Nimegami lambat merespons.
Monitoring: Sudah normal lagi, kami pantau 30 menit ke depan.
Resolved: Selesai.
```

Komentar tanpa awalan status dianggap catatan internal dan tidak tampil. Tutup issue = insiden selesai.

Insiden yang terjadi sebelum ditulis (tanggal mundur) bisa diberi `Mulai:` dan `Selesai:` di isi issue, format `2026-11-14 21:00` (WIB).

## Maintenance

Issue dengan label `maintenance` dan label komponen:

```
Mulai: 2026-11-22 02:00
Selesai: 2026-11-22 02:30
Upgrade database. Riwayat tonton dan komentar tidak tersimpan selama maintenance.
```

Statusnya berganti sendiri: Scheduled → In progress → Completed.

## Keamanan

Repo ini publik. Hanya issue dan komentar dari pemilik, anggota, kolaborator, atau bot workflow yang tampil di halaman; semua teks ditampilkan sebagai teks biasa.

## Data lama

`scripts/backfill_nginx.py` memperkirakan uptime hari-hari sebelum monitor jalan dari log nginx VPS (hanya angka per hari). Hasilnya ditandai "estimasi dari log server".
