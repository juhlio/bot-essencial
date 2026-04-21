require('dotenv').config();

const { getUserByEmail, createUser } = require('./userRepository');
const { hashPassword } = require('../services/authService');

const ADMIN_EMAIL    = 'admin@essencial.com.br';
const ADMIN_PASSWORD = 'Senha@123';
const ADMIN_ROLE     = 'admin';

async function seedUsers() {
  const existing = await getUserByEmail(ADMIN_EMAIL);

  if (existing) {
    console.log('Admin user already exists');
    return;
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  await createUser(ADMIN_EMAIL, passwordHash, ADMIN_ROLE);
  console.log('Admin user created');
}

module.exports = seedUsers;

// Execução direta: node src/database/seedUsers.js
if (require.main === module) {
  seedUsers()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Seed error:', err.message);
      process.exit(1);
    });
}
