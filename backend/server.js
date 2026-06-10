require('dotenv').config();
const path    = require('path');
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const { Pool } = require('pg');

// ─── App & DB Setup ───────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend files from the sibling frontend folder
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'beasiswa_sawit_schema',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'admin',
  // Pool sizing untuk concurrent users
  max:             20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sendError = (res, status, message, detail = null) => {
  const body = { success: false, message };
  if (detail) body.detail = detail;
  return res.status(status).json(body);
};

const isBcryptHash = (value) => {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
};

const requireAdmin = (req, res, next) => {
  if (String(req.headers['x-user-role'] || '').toLowerCase() !== 'admin') {
    return sendError(res, 403, 'Akses admin diperlukan.');
  }
  next();
};

const captchaQuestions = [
  { id: '4+3', question: 'Berapakah 4 + 3?', answer: '7' },
  { id: '5+2', question: 'Berapakah 5 + 2?', answer: '7' },
  { id: '3+6', question: 'Berapakah 3 + 6?', answer: '9' },
  { id: '2+8', question: 'Berapakah 2 + 8?', answer: '10' },
  { id: '1+9', question: 'Berapakah 1 + 9?', answer: '10' },
];

// ─── A. POST /api/auth/login ──────────────────────────────────────────────────
/**
 * Body: { email, password }
 * Response: { success, user: { id, nama_lengkap, email, role } }
 */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return sendError(res, 400, 'Email dan password wajib diisi.');

  try {
    console.log('[login] Email yang dicari:', email.trim().toLowerCase());

    const result = await pool.query(
      'SELECT id, nama_lengkap, email, password_hash, role FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (result.rowCount === 0) {
      console.log('[login] Email tidak ditemukan di database');
      return sendError(res, 401, 'Email atau password salah.');
    }

    const user = result.rows[0];
    const role = String(user.role || '').toLowerCase();
    console.log('[login] User ditemukan:', user.email, '| Password hash ada:', !!user.password_hash, '| Role:', role);

    if (!isBcryptHash(user.password_hash)) {
      console.error('[login] Invalid password_hash format for user:', user.email);
      return sendError(res, 500, 'Password hash tidak valid. Pastikan password disimpan sebagai hash bcrypt.');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    console.log('[login] Password match:', passwordMatch);

    if (!passwordMatch)
      return sendError(res, 401, 'Email atau password salah.');

    // Jangan kembalikan password_hash ke client
    const userPayload = {
      id:           user.id,
      nama_lengkap: user.nama_lengkap,
      email:        user.email,
      role:         role,
    };

    return res.json({
      success: true,
      user: userPayload,
      dashboardUrl: role === 'admin' ? '/admin.html' : '/index.html',
      dashboardType: role === 'admin' ? 'admin' : 'peserta',
    });
  } catch (err) {
    console.error('[login]', err);
    return sendError(res, 500, 'Terjadi kesalahan server.', err.message);
  }
});

app.get('/api/auth/captcha', async (_req, res) => {
  try {
    const choice = captchaQuestions[Math.floor(Math.random() * captchaQuestions.length)];
    return res.json({ success: true, captcha: { id: choice.id, question: choice.question } });
  } catch (err) {
    console.error('[auth/captcha]', err);
    return sendError(res, 500, 'Gagal mengambil captcha.', err.message);
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { nama_lengkap, email, password, password_confirm, captcha_id, captcha_answer, website } = req.body;

  if (website) {
    return sendError(res, 400, 'Pendaftaran gagal.');
  }

  if (!nama_lengkap || !email || !password || !password_confirm || !captcha_id || !captcha_answer) {
    return sendError(res, 400, 'Semua field wajib diisi.');
  }

  if (password !== password_confirm) {
    return sendError(res, 400, 'Password dan konfirmasi password tidak cocok.');
  }

  const captcha = captchaQuestions.find((item) => item.id === captcha_id);
  if (!captcha || String(captcha.answer) !== String(captcha_answer).trim()) {
    return sendError(res, 400, 'Jawaban captcha salah.');
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rowCount > 0) {
      return sendError(res, 409, 'Email sudah terdaftar.');
    }

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (nama_lengkap, email, password_hash, role, created_at)
       VALUES ($1, $2, $3, 'peserta', NOW())
       RETURNING id, nama_lengkap, email, role, created_at`,
      [nama_lengkap, email.trim().toLowerCase(), password_hash]
    );

    return res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('[auth/register]', err);
    return sendError(res, 500, 'Gagal mendaftar peserta.', err.message);
  }
});

app.all('/api/auth/*', (req, res) => {
  return sendError(res, 404, `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan. Pastikan menggunakan method dan path yang benar.`);
});

// ─── B. GET /api/dashboard/:user_id ──────────────────────────────────────────
/**
 * Response: {
 *   success,
 *   kategori: [
 *     { id, nama_kategori, durasi_menit, status_sesi, sesi_id, skor_akhir }
 *   ]
 * }
 */
app.get('/api/dashboard/:user_id', async (req, res) => {
  const { user_id } = req.params;

  if (!user_id) return sendError(res, 400, 'user_id diperlukan.');

  try {
    // LEFT JOIN: ambil sesi TERAKHIR per kategori untuk user ini
    const result = await pool.query(
      `SELECT
         k.id,
         k.nama_kategori,
         k.durasi_menit,
         s.id          AS sesi_id,
         s.status       AS status_sesi,
         s.skor_akhir,
         s.waktu_mulai,
         s.waktu_habis
       FROM kategori_psikotes k
       LEFT JOIN LATERAL (
         SELECT id, status, skor_akhir, waktu_mulai, waktu_habis
         FROM sesi_ujian
         WHERE user_id = $1 AND kategori_id = k.id
         ORDER BY waktu_mulai DESC
         LIMIT 1
       ) s ON TRUE
       ORDER BY k.id`,
      [user_id]
    );

    return res.json({ success: true, kategori: result.rows });
  } catch (err) {
    console.error('[dashboard]', err);
    return sendError(res, 500, 'Terjadi kesalahan server.', err.message);
  }
});

// ─── C. POST /api/ujian/mulai ─────────────────────────────────────────────────
/**
 * Body: { user_id, kategori_id }
 * Response: {
 *   success,
 *   sesi: { id, waktu_mulai, waktu_habis, status },
 *   soal: [ { id, teks_soal, url_gambar, pilihan: [ { id, teks_pilihan, poin } ] } ]
 * }
 * PENTING: is_benar TIDAK dikirim ke frontend.
 */
app.post('/api/ujian/mulai', async (req, res) => {
  const { user_id, kategori_id } = req.body;

  if (!user_id || !kategori_id)
    return sendError(res, 400, 'user_id dan kategori_id wajib diisi.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ambil durasi kategori
    const katResult = await client.query(
      'SELECT id, nama_kategori, durasi_menit FROM kategori_psikotes WHERE id = $1',
      [kategori_id]
    );
    if (katResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Kategori tidak ditemukan.');
    }
    const kategori = katResult.rows[0];

    // Cek sesi aktif yang masih berjalan DAN belum timeout
    const sesiAktif = await client.query(
      `SELECT id, waktu_mulai, waktu_habis, status
       FROM sesi_ujian
       WHERE user_id = $1 AND kategori_id = $2 AND status = 'berjalan' AND waktu_habis > NOW()
       ORDER BY waktu_mulai DESC
       LIMIT 1`,
      [user_id, kategori_id]
    );

    let sesi;
    if (sesiAktif.rowCount > 0) {
      // Lanjutkan sesi yang masih berjalan
      sesi = sesiAktif.rows[0];
    } else {
      // Buat sesi baru — hitung waktu_habis di backend
      const newSesi = await client.query(
        `INSERT INTO sesi_ujian (user_id, kategori_id, waktu_mulai, waktu_habis, status)
         VALUES ($1, $2, NOW(), NOW() + ($3 || ' minutes')::INTERVAL, 'berjalan')
         RETURNING id, waktu_mulai, waktu_habis, status`,
        [user_id, kategori_id, kategori.durasi_menit]
      );
      sesi = newSesi.rows[0];
    }

    // Ambil soal beserta pilihan jawaban (TANPA is_benar)
    const soalResult = await client.query(
      `SELECT
         s.id        AS soal_id,
         s.teks_soal,
         s.url_gambar,
         COALESCE(st.id IS NOT NULL, FALSE) AS is_locked,
         json_agg(
           json_build_object(
             'id',           pj.id,
             'teks_pilihan', pj.teks_pilihan
           ) ORDER BY pj.id
         ) AS pilihan
       FROM soal s
       JOIN pilihan_jawaban pj ON pj.soal_id = s.id
       LEFT JOIN soal_terkunci st ON st.soal_id = s.id AND st.sesi_id = $2
       WHERE s.kategori_id = $1
       GROUP BY s.id, st.id
       ORDER BY s.id`,
      [kategori_id, sesi.id]
    );

    // Ambil jawaban yang sudah tersimpan untuk sesi ini (resume support)
    const jawabanResult = await client.query(
      `SELECT soal_id, pilihan_id FROM jawaban_peserta WHERE sesi_id = $1`,
      [sesi.id]
    );
    const jawabanMap = {};
    jawabanResult.rows.forEach(r => { jawabanMap[r.soal_id] = r.pilihan_id; });

    // Gabungkan jawaban tersimpan ke dalam data soal
    const soalWithJawaban = soalResult.rows.map(s => ({
      ...s,
      jawaban_tersimpan: jawabanMap[s.soal_id] || null,
    }));

    await client.query('COMMIT');

    return res.json({
      success: true,
      sesi: {
        id:          sesi.id,
        waktu_mulai: sesi.waktu_mulai,
        waktu_habis: sesi.waktu_habis,
        status:      sesi.status,
      },
      soal: soalWithJawaban,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[mulai-ujian]', err);
    return sendError(res, 500, 'Terjadi kesalahan server.', err.message);
  } finally {
    client.release();
  }
});

// ─── D. POST /api/ujian/save ──────────────────────────────────────────────────
/**
 * Body: { sesi_id, soal_id, pilihan_id }
 * Response: { success, saved_at }
 * Menggunakan UPSERT sesuai skema database.
 */
app.post('/api/ujian/save', async (req, res) => {
  const { sesi_id, soal_id, pilihan_id } = req.body;

  if (!sesi_id || !soal_id || !pilihan_id)
    return sendError(res, 400, 'sesi_id, soal_id, dan pilihan_id wajib diisi.');

  try {
    // Verifikasi sesi masih aktif
    const sesiCheck = await pool.query(
      `SELECT id FROM sesi_ujian
       WHERE id = $1 AND status = 'berjalan' AND waktu_habis > NOW()`,
      [sesi_id]
    );
    if (sesiCheck.rowCount === 0)
      return sendError(res, 403, 'Sesi tidak aktif atau waktu sudah habis.');

    // Cek apakah soal terkunci
    try {
      const lockedCheck = await pool.query(
        'SELECT id FROM soal_terkunci WHERE sesi_id = $1 AND soal_id = $2',
        [sesi_id, soal_id]
      );
      if (lockedCheck.rowCount > 0)
        return sendError(res, 403, 'Soal ini telah dikunci oleh admin. Anda tidak bisa menjawabnya.');
    } catch (lockErr) {
      // Tabel belum ada, abaikan
    }

    // UPSERT jawaban
    const result = await pool.query(
      `INSERT INTO jawaban_peserta (sesi_id, soal_id, pilihan_id, disimpan_pada)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (sesi_id, soal_id) DO UPDATE
         SET pilihan_id    = EXCLUDED.pilihan_id,
             disimpan_pada = EXCLUDED.disimpan_pada
       RETURNING disimpan_pada`,
      [sesi_id, soal_id, pilihan_id]
    );

    return res.json({ success: true, saved_at: result.rows[0].disimpan_pada });
  } catch (err) {
    console.error('[save-jawaban]', err);
    return sendError(res, 500, 'Gagal menyimpan jawaban.', err.message);
  }
});

// ─── E. POST /api/ujian/selesai ───────────────────────────────────────────────
/**
 * Body: { sesi_id }
 * Response: { success, skor_akhir, total_soal, total_dijawab }
 */
app.post('/api/ujian/selesai', async (req, res) => {
  const { sesi_id } = req.body;

  if (!sesi_id) return sendError(res, 400, 'sesi_id wajib diisi.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verifikasi sesi ada
    const sesiCheck = await client.query(
      `SELECT id, status FROM sesi_ujian WHERE id = $1`,
      [sesi_id]
    );
    if (sesiCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Sesi tidak ditemukan.');
    }

    const currentStatus = sesiCheck.rows[0].status;
    if (currentStatus === 'selesai') {
      await client.query('ROLLBACK');
      return sendError(res, 409, 'Sesi sudah diselesaikan sebelumnya.');
    }

    // Hitung skor total dari jawaban yang dipilih
    const skorResult = await client.query(
      `SELECT COALESCE(SUM(pj.poin), 0) AS total_skor,
              COUNT(jp.id)              AS total_dijawab
       FROM jawaban_peserta jp
       JOIN pilihan_jawaban pj ON pj.id = jp.pilihan_id
       WHERE jp.sesi_id = $1`,
      [sesi_id]
    );
    const skor = Number(skorResult.rows[0].total_skor);
    const totalDijawab = Number(skorResult.rows[0].total_dijawab);

    // Hitung total soal untuk sesi ini
    const totalSoalResult = await client.query(
      `SELECT COUNT(s.id) AS total_soal
       FROM sesi_ujian se
       JOIN soal s ON s.kategori_id = se.kategori_id
       WHERE se.id = $1`,
      [sesi_id]
    );
    const totalSoal = Number(totalSoalResult.rows[0].total_soal);

    // Update status dan skor_akhir
    const statusBaru = currentStatus === 'berjalan' ? 'selesai' : currentStatus;
    await client.query(
      `UPDATE sesi_ujian
       SET status = $1, skor_akhir = $2
       WHERE id = $3`,
      [statusBaru, skor, sesi_id]
    );

    await client.query('COMMIT');

    return res.json({
      success:       true,
      skor_akhir:    skor,
      total_soal:    totalSoal,
      total_dijawab: totalDijawab,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[selesai-ujian]', err);
    return sendError(res, 500, 'Terjadi kesalahan server.', err.message);
  } finally {
    client.release();
  }
});

// ─── Admin routes ─────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nama_lengkap, email, role, created_at
       FROM users
       ORDER BY id`
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    console.error('[admin/users]', err);
    return sendError(res, 500, 'Gagal mengambil user.', err.message);
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { nama_lengkap, email, password, role } = req.body;
  if (!nama_lengkap || !email || !password || !role)
    return sendError(res, 400, 'Nama, email, password, dan role wajib diisi.');

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rowCount > 0)
      return sendError(res, 409, 'Email sudah terdaftar.');

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (nama_lengkap, email, password_hash, role, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, nama_lengkap, email, role, created_at`,
      [nama_lengkap, email.trim().toLowerCase(), password_hash, role]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('[admin/users:create]', err);
    return sendError(res, 500, 'Gagal membuat user.', err.message);
  }
});

app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama_lengkap, email, password, role } = req.body;
  if (!nama_lengkap || !email || !role)
    return sendError(res, 400, 'Nama, email, dan role wajib diisi.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingUser = await client.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existingUser.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'User tidak ditemukan.');
    }

    if (password) {
      const password_hash = await bcrypt.hash(password, 10);
      await client.query(
        `UPDATE users SET nama_lengkap = $1, email = $2, password_hash = $3, role = $4 WHERE id = $5`,
        [nama_lengkap, email.trim().toLowerCase(), password_hash, role, id]
      );
    } else {
      await client.query(
        `UPDATE users SET nama_lengkap = $1, email = $2, role = $3 WHERE id = $4`,
        [nama_lengkap, email.trim().toLowerCase(), role, id]
      );
    }

    const result = await client.query(
      `SELECT id, nama_lengkap, email, role, created_at FROM users WHERE id = $1`,
      [id]
    );
    await client.query('COMMIT');
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/users:update]', err);
    return sendError(res, 500, 'Gagal memperbarui user.', err.message);
  } finally {
    client.release();
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0)
      return sendError(res, 404, 'User tidak ditemukan.');
    res.json({ success: true });
  } catch (err) {
    console.error('[admin/users:delete]', err);
    return sendError(res, 500, 'Gagal menghapus user.', err.message);
  }
});

app.get('/api/admin/kategori', requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nama_kategori, durasi_menit FROM kategori_psikotes ORDER BY id`
    );
    res.json({ success: true, kategori: result.rows });
  } catch (err) {
    console.error('[admin/kategori]', err);
    return sendError(res, 500, 'Gagal mengambil kategori.', err.message);
  }
});

app.post('/api/admin/kategori', requireAdmin, async (req, res) => {
  const { nama_kategori, durasi_menit } = req.body;
  if (!nama_kategori || !durasi_menit || Number(durasi_menit) <= 0)
    return sendError(res, 400, 'Nama kategori dan durasi valid wajib diisi.');

  try {
    const result = await pool.query(
      `INSERT INTO kategori_psikotes (nama_kategori, durasi_menit) VALUES ($1, $2) RETURNING id, nama_kategori, durasi_menit`,
      [nama_kategori.trim(), Number(durasi_menit)]
    );
    res.json({ success: true, kategori: result.rows[0] });
  } catch (err) {
    console.error('[admin/kategori:post]', err);
    return sendError(res, 500, 'Gagal menambahkan kategori.', err.message);
  }
});

app.put('/api/admin/kategori/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama_kategori, durasi_menit } = req.body;
  if (!nama_kategori || !durasi_menit || Number(durasi_menit) <= 0)
    return sendError(res, 400, 'Nama kategori dan durasi valid wajib diisi.');

  try {
    const result = await pool.query(
      `UPDATE kategori_psikotes SET nama_kategori = $1, durasi_menit = $2 WHERE id = $3 RETURNING id, nama_kategori, durasi_menit`,
      [nama_kategori.trim(), Number(durasi_menit), id]
    );
    if (result.rowCount === 0) return sendError(res, 404, 'Kategori tidak ditemukan.');
    res.json({ success: true, kategori: result.rows[0] });
  } catch (err) {
    console.error('[admin/kategori:put]', err);
    return sendError(res, 500, 'Gagal memperbarui kategori.', err.message);
  }
});

app.delete('/api/admin/kategori/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM kategori_psikotes WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return sendError(res, 404, 'Kategori tidak ditemukan.');
    res.json({ success: true });
  } catch (err) {
    console.error('[admin/kategori:delete]', err);
    return sendError(res, 500, 'Gagal menghapus kategori.', err.message);
  }
});

app.get('/api/admin/soal', requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.kategori_id, k.nama_kategori, s.teks_soal, s.url_gambar,
              COALESCE(json_agg(json_build_object(
                'id', pj.id,
                'teks_pilihan', pj.teks_pilihan,
                'poin', pj.poin,
                'is_benar', pj.is_benar
              ) ORDER BY pj.id) FILTER (WHERE pj.id IS NOT NULL), '[]') AS pilihan
       FROM soal s
       JOIN kategori_psikotes k ON k.id = s.kategori_id
       LEFT JOIN pilihan_jawaban pj ON pj.soal_id = s.id
       GROUP BY s.id, k.nama_kategori
       ORDER BY s.id`
    );
    res.json({ success: true, soal: result.rows });
  } catch (err) {
    console.error('[admin/soal]', err);
    return sendError(res, 500, 'Gagal mengambil soal.', err.message);
  }
});

app.post('/api/admin/soal', requireAdmin, async (req, res) => {
  const { kategori_id, teks_soal, url_gambar, pilihan_jawaban } = req.body;
  if (!kategori_id || !teks_soal || !Array.isArray(pilihan_jawaban) || pilihan_jawaban.length < 2)
    return sendError(res, 400, 'Kategori, teks soal, dan minimal 2 pilihan wajib diisi.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const soalResult = await client.query(
      `INSERT INTO soal (kategori_id, teks_soal, url_gambar)
       VALUES ($1, $2, $3)
       RETURNING id, kategori_id, teks_soal, url_gambar`,
      [kategori_id, teks_soal, url_gambar]
    );
    const soalId = soalResult.rows[0].id;

    const insertPromises = pilihan_jawaban.map((p) => {
      return client.query(
        `INSERT INTO pilihan_jawaban (soal_id, teks_pilihan, poin, is_benar)
         VALUES ($1, $2, $3, $4)`,
        [soalId, p.teks_pilihan, Number(p.poin) || 0, !!p.is_benar]
      );
    });
    await Promise.all(insertPromises);
    await client.query('COMMIT');

    res.json({ success: true, soal: soalResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/soal:create]', err);
    return sendError(res, 500, 'Gagal membuat soal.', err.message);
  } finally {
    client.release();
  }
});

app.put('/api/admin/soal/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { kategori_id, teks_soal, url_gambar, pilihan_jawaban } = req.body;
  if (!kategori_id || !teks_soal || !Array.isArray(pilihan_jawaban) || pilihan_jawaban.length < 2)
    return sendError(res, 400, 'Kategori, teks soal, dan minimal 2 pilihan wajib diisi.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const soalResult = await client.query('SELECT id FROM soal WHERE id = $1', [id]);
    if (soalResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Soal tidak ditemukan.');
    }

    await client.query(
      `UPDATE soal SET kategori_id = $1, teks_soal = $2, url_gambar = $3 WHERE id = $4`,
      [kategori_id, teks_soal, url_gambar, id]
    );

    await client.query(
      `DELETE FROM jawaban_peserta
       WHERE pilihan_id IN (SELECT id FROM pilihan_jawaban WHERE soal_id = $1)`,
      [id]
    );
    await client.query('DELETE FROM pilihan_jawaban WHERE soal_id = $1', [id]);
    const insertPromises = pilihan_jawaban.map((p) => {
      return client.query(
        `INSERT INTO pilihan_jawaban (soal_id, teks_pilihan, poin, is_benar)
         VALUES ($1, $2, $3, $4)`,
        [id, p.teks_pilihan, Number(p.poin) || 0, !!p.is_benar]
      );
    });
    await Promise.all(insertPromises);
    await client.query('COMMIT');

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/soal:update]', err);
    return sendError(res, 500, 'Gagal memperbarui soal.', err.message);
  } finally {
    client.release();
  }
});

app.delete('/api/admin/soal/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM jawaban_peserta
       WHERE pilihan_id IN (SELECT id FROM pilihan_jawaban WHERE soal_id = $1)`,
      [id]
    );
    await client.query('DELETE FROM pilihan_jawaban WHERE soal_id = $1', [id]);
    const result = await client.query('DELETE FROM soal WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Soal tidak ditemukan.');
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/soal:delete]', err);
    return sendError(res, 500, 'Gagal menghapus soal.', err.message);
  } finally {
    client.release();
  }
});

app.get('/api/admin/aktivitas', requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         se.id AS sesi_id,
         se.user_id,
         u.nama_lengkap,
         u.email,
         k.nama_kategori,
         se.status,
         se.waktu_mulai,
         se.waktu_habis,
         se.skor_akhir,
         COALESCE(jp.total_dijawab, 0) AS total_dijawab,
         COALESCE(s.total_soal, 0) AS total_soal
       FROM sesi_ujian se
       JOIN users u ON u.id = se.user_id
       JOIN kategori_psikotes k ON k.id = se.kategori_id
       LEFT JOIN (
         SELECT sesi_id, COUNT(*) AS total_dijawab
         FROM jawaban_peserta
         GROUP BY sesi_id
       ) jp ON jp.sesi_id = se.id
       LEFT JOIN (
         SELECT kategori_id, COUNT(*) AS total_soal
         FROM soal
         GROUP BY kategori_id
       ) s ON s.kategori_id = se.kategori_id
       ORDER BY se.waktu_mulai DESC`
    );
    res.json({ success: true, aktivitas: result.rows });
  } catch (err) {
    console.error('[admin/aktivitas]', err);
    return sendError(res, 500, 'Gagal mengambil aktivitas peserta.', err.message);
  }
});

app.post('/api/admin/sesi/:id/reopen', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sesiResult = await client.query(
      `SELECT id, status, kategori_id FROM sesi_ujian WHERE id = $1`,
      [id]
    );
    if (sesiResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Sesi tidak ditemukan.');
    }

    const sesi = sesiResult.rows[0];
    if (sesi.status !== 'selesai') {
      await client.query('ROLLBACK');
      return sendError(res, 409, 'Hanya sesi dengan status selesai yang bisa dibuka ulang.');
    }

    const kategoriResult = await client.query(
      `SELECT durasi_menit FROM kategori_psikotes WHERE id = $1`,
      [sesi.kategori_id]
    );
    if (kategoriResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Kategori sesi tidak ditemukan.');
    }

    const durasi = kategoriResult.rows[0].durasi_menit;
    await client.query(
      `UPDATE sesi_ujian
       SET status = 'berjalan', skor_akhir = NULL, waktu_mulai = NOW(), waktu_habis = NOW() + ($1 || ' minutes')::INTERVAL
       WHERE id = $2`,
      [durasi, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Sesi berhasil dibuka ulang.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/sesi:reopen]', err);
    return sendError(res, 500, 'Gagal membuka ulang sesi.', err.message);
  } finally {
    client.release();
  }
});

app.post('/api/admin/sesi/:sesi_id/soal/:soal_id/lock', requireAdmin, async (req, res) => {
  const { sesi_id, soal_id } = req.params;
  try {
    // Cek apakah soal sudah terkunci
    const exists = await pool.query(
      'SELECT id FROM soal_terkunci WHERE sesi_id = $1 AND soal_id = $2',
      [sesi_id, soal_id]
    );
    if (exists.rowCount > 0) {
      return res.json({ success: true, message: 'Soal sudah terkunci.' });
    }
    // Tambah ke tabel soal_terkunci
    await pool.query(
      'INSERT INTO soal_terkunci (sesi_id, soal_id) VALUES ($1, $2)',
      [sesi_id, soal_id]
    );
    res.json({ success: true, message: 'Soal berhasil dikunci.' });
  } catch (err) {
    if (err.code === '42P1') {
      // Tabel belum ada, buat otomatis
      try {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS soal_terkunci (
            id SERIAL PRIMARY KEY,
            sesi_id INTEGER NOT NULL,
            soal_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(sesi_id, soal_id)
          )`
        );
        await pool.query(
          'INSERT INTO soal_terkunci (sesi_id, soal_id) VALUES ($1, $2)',
          [sesi_id, soal_id]
        );
        res.json({ success: true, message: 'Soal berhasil dikunci.' });
      } catch (createErr) {
        console.error('[admin/lock:create]', createErr);
        return sendError(res, 500, 'Gagal membuat tabel soal terkunci.', createErr.message);
      }
    } else {
      console.error('[admin/sesi:lock]', err);
      return sendError(res, 500, 'Gagal mengunci soal.', err.message);
    }
  }
});

app.delete('/api/admin/sesi/:sesi_id/soal/:soal_id/lock', requireAdmin, async (req, res) => {
  const { sesi_id, soal_id } = req.params;
  try {
    await pool.query(
      'DELETE FROM soal_terkunci WHERE sesi_id = $1 AND soal_id = $2',
      [sesi_id, soal_id]
    );
    res.json({ success: true, message: 'Soal berhasil dibuka.' });
  } catch (err) {
    console.error('[admin/sesi:unlock]', err);
    return sendError(res, 500, 'Gagal membuka soal.', err.message);
  }
});

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', detail: err.message });
  }
});

// ─── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const ensureDefaultKategori = async () => {
  try {
    const defaultCategories = [
      { nama_kategori: 'Tes Koran', durasi_menit: 30 },
    ];
    for (const kategori of defaultCategories) {
      const exists = await pool.query(
        'SELECT id FROM kategori_psikotes WHERE nama_kategori = $1',
        [kategori.nama_kategori]
      );
      if (exists.rowCount === 0) {
        await pool.query(
          'INSERT INTO kategori_psikotes (nama_kategori, durasi_menit) VALUES ($1, $2)',
          [kategori.nama_kategori, kategori.durasi_menit]
        );
        console.log(`[DB] Default kategori '${kategori.nama_kategori}' telah dibuat.`);
      }
    }
  } catch (err) {
    console.warn('[DB] Gagal memastikan kategori default:', err.message);
  }
};

const startServer = async () => {
  await ensureDefaultKategori();
  const server = app.listen(PORT, () => {
    console.log(`✅ Server berjalan di http://localhost:${PORT}`);
    console.log(`📊 Database: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'beasiswa_sawit'}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`⚠️ Port ${PORT} sudah dipakai. Hentikan proses lain yang menggunakan port ini atau jalankan dengan PORT yang berbeda.`);
      process.exit(1);
    }
    throw err;
  });
};

startServer();

module.exports = app;
