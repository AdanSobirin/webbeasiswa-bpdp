/**
 * SCRIPT UNTUK TEST PASSWORD HASHING
 * Gunakan ini untuk:
 * 1. Generate password yang sudah di-hash untuk input ke database
 * 2. Verify apakah password cocok dengan hash di database
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME     || 'beasiswa_sawit_schema',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'admin',
});

// ════════════════════════════════════════════════════════════════════════════
// FUNGSI 1: Generate hash untuk password baru
// ════════════════════════════════════════════════════════════════════════════
async function generateHash(plainPassword) {
  console.log('\n🔐 GENERATE PASSWORD HASH');
  console.log('═'.repeat(50));
  console.log('Plain Password:', plainPassword);
  
  const hash = await bcrypt.hash(plainPassword, 10);
  console.log('Hashed Password:', hash);
  console.log('\n📋 Gunakan hash di atas untuk UPDATE ke database:');
  console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'your_email@example.com';`);
}

// ════════════════════════════════════════════════════════════════════════════
// FUNGSI 2: Verify password dengan hash dari database
// ════════════════════════════════════════════════════════════════════════════
async function verifyPassword(plainPassword, hashFromDB) {
  console.log('\n🔍 VERIFY PASSWORD');
  console.log('═'.repeat(50));
  console.log('Plain Password:', plainPassword);
  console.log('Hash from DB:  ', hashFromDB);
  
  const isMatch = await bcrypt.compare(plainPassword, hashFromDB);
  console.log('✓ Match Result:', isMatch ? '✅ COCOK' : '❌ TIDAK COCOK');
}

// ════════════════════════════════════════════════════════════════════════════
// FUNGSI 3: Cek data user di database
// ════════════════════════════════════════════════════════════════════════════
async function checkUserInDB(email) {
  console.log('\n👤 CEK USER DI DATABASE');
  console.log('═'.repeat(50));
  console.log('Mencari email:', email);
  
  try {
    const result = await pool.query(
      'SELECT id, email, nama_lengkap, password_hash FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    
    if (result.rowCount === 0) {
      console.log('❌ User tidak ditemukan di database!');
      return;
    }
    
    const user = result.rows[0];
    console.log('✅ User ditemukan:');
    console.log('   - ID:', user.id);
    console.log('   - Email:', user.email);
    console.log('   - Nama:', user.nama_lengkap);
    console.log('   - Password Hash ada:', !!user.password_hash);
    if (user.password_hash) {
      console.log('   - Hash:', user.password_hash);
    }
  } catch (err) {
    console.error('❌ Error query:', err.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n\n╔════════════════════════════════════════════════════════╗');
  console.log('║     PASSWORD HASHING TEST TOOL                        ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('\n📝 CARA PENGGUNAAN:');
    console.log('  1. Generate hash: node test-password.js gen "password_anda"');
    console.log('  2. Verify password: node test-password.js verify "password_plain" "hash_dari_db"');
    console.log('  3. Cek user di DB: node test-password.js check "email@example.com"');
    console.log('\n📌 CONTOH:');
    console.log('  node test-password.js gen "123456"');
    console.log('  node test-password.js check "user@example.com"');
  } else {
    const command = args[0];
    
    try {
      if (command === 'gen' && args[1]) {
        await generateHash(args[1]);
      } else if (command === 'verify' && args[1] && args[2]) {
        await verifyPassword(args[1], args[2]);
      } else if (command === 'check' && args[1]) {
        await checkUserInDB(args[1]);
      } else {
        console.log('❌ Perintah tidak valid!');
        console.log('Gunakan: gen, verify, atau check');
      }
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
  }
  
  await pool.end();
}

main();
