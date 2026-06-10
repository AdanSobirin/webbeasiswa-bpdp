# Simulasi Psikotes Beasiswa Sawit 🌴

Aplikasi web simulasi ujian psikotes dengan fitur auto-save real-time.

## Struktur Proyek

```
beasiswa-sawit/
├── backend/
│   ├── server.js          # Express.js API server (semua endpoint)
│   ├── package.json
│   └── .env.example       # Salin ke .env dan isi kredensial
└── frontend/
    └── index.html         # Single-file Vue 3 + Tailwind (buka langsung di browser)
```

---

## Cara Menjalankan

### 1. Siapkan Database PostgreSQL

Pastikan PostgreSQL berjalan dan jalankan file skema:
```sql
-- Di psql atau pgAdmin, jalankan:
\i beasiswa_sawit_schema.sql
```

Buat user peserta dummy untuk pengujian:
```sql
-- Password: "test123"
INSERT INTO users (nama_lengkap, email, password_hash, role)
VALUES (
  'Ahmad Fauzi',
  'ahmad@test.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LkaSsXLmh/W',
  'peserta'
);

-- Tambah kategori psikotes
INSERT INTO kategori_psikotes (nama_kategori, durasi_menit) VALUES
  ('Tes Logika Umum', 30),
  ('Tes Numerik', 25),
  ('Tes Verbal', 20),
  ('Tes Spasial', 25),
  ('Tes Kepribadian', 15);

-- Contoh soal untuk kategori 1
INSERT INTO soal (kategori_id, teks_soal) VALUES
  (1, 'Jika semua burung bisa terbang, dan pinguins adalah burung, maka apakah pinguins bisa terbang?'),
  (1, 'Angka berikutnya dalam deret 2, 4, 8, 16, ... adalah?');

INSERT INTO pilihan_jawaban (soal_id, teks_pilihan, is_benar, poin) VALUES
  (1, 'Ya, pinguins pasti bisa terbang', true, 10),
  (1, 'Tidak, premis pertama salah', false, 0),
  (1, 'Tidak dapat disimpulkan', false, 0),
  (2, '24', false, 0),
  (2, '32', true, 10),
  (2, '30', false, 0),
  (2, '28', false, 0);
```

### 2. Setup Backend

```bash
cd backend

# Salin env dan isi konfigurasi database
cp .env.example .env
# Edit .env sesuai konfigurasi PostgreSQL Anda

# Install dependencies
npm install

# Jalankan server
npm run dev        # Development (dengan nodemon)
# atau
npm start          # Production
```

Server berjalan di: **http://localhost:3000**

Cek koneksi: `curl http://localhost:3000/api/health`

### 3. Jalankan Frontend

Frontend adalah single HTML file, tidak perlu build tool.

**Cara paling mudah:**
```bash
# Buka langsung di browser
open frontend/index.html
# atau double-click file index.html
```

**Atau pakai server lokal (opsional):**
```bash
# Jika ada Python
python3 -m http.server 8080 --directory frontend
# Buka http://localhost:8080
```

> **Penting:** Pastikan `API_BASE` di dalam `index.html` (baris `const API_BASE = ...`)
> sudah sesuai dengan URL backend Anda. Default: `http://localhost:3000/api`

---

## Endpoint API

| Method | Path | Fungsi |
|--------|------|--------|
| POST | `/api/auth/login` | Login peserta/admin |
| GET  | `/api/dashboard/:user_id` | Ambil kategori + status sesi |
| POST | `/api/ujian/mulai` | Mulai/lanjutkan sesi ujian |
| POST | `/api/ujian/save` | Auto-save jawaban (UPSERT) |
| POST | `/api/ujian/selesai` | Selesaikan & hitung skor |
| GET  | `/api/health` | Health check koneksi DB |

---

## Fitur Unggulan

- **Auto-save real-time** — setiap klik jawaban langsung dikirim ke server via UPSERT tanpa reload
- **Resume sesi** — jika browser ditutup, jawaban dan timer dilanjutkan dari server
- **Responsif penuh** — layout 2-kolom di desktop, drawer navigasi soal di mobile
- **Keamanan** — `is_benar` tidak pernah dikirim ke frontend
- **Timer server-side** — `waktu_habis` dihitung di backend, tidak bisa dimanipulasi client
- **Session restore** — data login tersimpan di sessionStorage, refresh tidak perlu login ulang
