# 🔧 PANDUAN DEBUG: Masalah Login Email/Password

## 📋 Checklist Debugging

### 1️⃣ **Pastikan Tabel Users Ada & Password Di-Hash Dengan Bcrypt**

Jalankan script SQL berikut di PostgreSQL:

```sql
-- Cek apakah tabel users sudah ada
\dt users

-- Jika belum ada, buat tabel:
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  nama_lengkap VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'peserta',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cek data yang ada di database
SELECT id, email, nama_lengkap, password_hash FROM users;
```

### 2️⃣ **Generate Password Hash Yang Benar**

Jalankan script untuk generate hash:

```bash
cd backend
node test-password.js gen "password_anda"
```

**Contoh output:**
```
Plain Password: password_anda
Hashed Password: $2a$10$lsdfhk2jlnSDKFJnlSDK...
```

Gunakan hash di atas untuk input ke database:

```sql
UPDATE users 
SET password_hash = '$2a$10$lsdfhk2jlnSDKFJnlSDK...' 
WHERE email = 'user@example.com';
```

### 3️⃣ **Verify Password Sebelum Input ke Database**

```bash
node test-password.js verify "password_plain" "$2a$10$hash_dari_output_gen"
```

Jika hasilnya **✅ COCOK**, maka password sudah benar!

### 4️⃣ **Cek User di Database**

```bash
node test-password.js check "user@example.com"
```

Output akan menunjukkan:
- ✅ User ditemukan atau ❌ User tidak ditemukan
- Email, nama, dan apakah password_hash ada

### 5️⃣ **Jalankan Server & Lihat Console Log**

```bash
node server.js
```

Coba login, lihat output di console:

```
[LOGIN] Email yang dicari: user@example.com
[LOGIN] Hasil query: 1 user ditemukan
[LOGIN] User ditemukan: user@example.com | Password hash ada: true
[LOGIN] Password match: true
[LOGIN] ✅ Login berhasil untuk user: user@example.com
```

Atau jika error:
```
[LOGIN] Email yang dicari: user@example.com
[LOGIN] Hasil query: 0 user ditemukan
[LOGIN] Email tidak ditemukan di database
```

---

## 🎯 Penyebab Umum & Solusi

| Masalah | Penyebab | Solusi |
|---------|----------|--------|
| Email tidak ditemukan | User belum ada di DB | Buat user baru dengan password yang di-hash |
| Password salah | Password di DB plain text, bukan hash | Generate hash dengan `node test-password.js gen` & update DB |
| Password salah | Password sudah di-hash tapi dengan algoritma berbeda | Pastikan di-hash dengan bcrypt (tidak md5, sha1, dll) |
| Email/password benar tapi masih error | Ada spasi/karakter khusus di email | Gunakan `trim()` & pastikan format email benar |

---

## 📝 Contoh SQL Untuk Input User Baru

```sql
-- 1. Generate hash terlebih dahulu dengan:
-- node test-password.js gen "password123"
-- Hasilnya: $2a$10$...

-- 2. Masukkan user ke database:
INSERT INTO users (email, nama_lengkap, password_hash, role) 
VALUES ('user@example.com', 'Nama Lengkap', '$2a$10$...', 'peserta');

-- 3. Verifikasi berhasil:
SELECT * FROM users WHERE email = 'user@example.com';
```

---

## 🚀 Quick Start

```bash
# 1. Generate hash untuk password
node test-password.js gen "MyPassword123"

# 2. Copy hash yang dihasilkan
# 3. Update database dengan hash tersebut
# 4. Cek user di database
node test-password.js check "user@example.com"

# 5. Jalankan server
node server.js

# 6. Coba login di frontend
```

---

Jika masih ada masalah, **share output dari console dan screenshot error**!
