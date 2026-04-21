const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Garante que nenhum teste toque em banco real
delete process.env.DATABASE_URL;

const {
  getUserByEmail,
  getUserById,
  createUser,
  updateLastLogin,
  listUsers,
  deleteUser,
} = require('../src/database/userRepository');

// ─── Helper: mock de pool ─────────────────────────────────────────────────────
function mockPool(rowsMap = {}) {
  const database = require('../src/services/database');
  const original = database.getPool;
  const log = [];

  database.getPool = () => ({
    query: async (sql, params) => {
      log.push({ sql: sql.trim(), params });
      const key = Object.keys(rowsMap).find(k => sql.includes(k));
      return { rows: key ? rowsMap[key] : [] };
    },
  });

  return { log, restore: () => { database.getPool = original; } };
}

// ─── Dados de referência ──────────────────────────────────────────────────────
const fakeUser = {
  id: 1,
  email: 'julio@essencial.com',
  password_hash: '$2b$10$hashhashhashhashhashhash',
  role: 'admin',
  created_at: new Date(),
  updated_at: new Date(),
  last_login: null,
};

// =============================================================================
// Suite 1 — Degradação graciosa: sem banco disponível
// =============================================================================
describe('userRepository — sem banco disponível', () => {

  it('getUserByEmail retorna null', async () => {
    const result = await getUserByEmail('julio@essencial.com');
    assert.equal(result, null);
  });

  it('getUserById retorna null', async () => {
    const result = await getUserById(1);
    assert.equal(result, null);
  });

  it('createUser retorna null', async () => {
    const result = await createUser('julio@essencial.com', 'hash', 'admin');
    assert.equal(result, null);
  });

  it('updateLastLogin retorna null', async () => {
    const result = await updateLastLogin(1);
    assert.equal(result, null);
  });

  it('listUsers retorna array vazio', async () => {
    const result = await listUsers();
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('deleteUser retorna null', async () => {
    const result = await deleteUser(1);
    assert.equal(result, null);
  });

  it('nenhuma função lança exceção', async () => {
    await assert.doesNotReject(() => getUserByEmail('x@x.com'));
    await assert.doesNotReject(() => getUserById(999));
    await assert.doesNotReject(() => createUser('x@x.com', 'hash'));
    await assert.doesNotReject(() => updateLastLogin(999));
    await assert.doesNotReject(() => listUsers());
    await assert.doesNotReject(() => deleteUser(999));
  });

});

// =============================================================================
// Suite 2 — Com pool mockado: retornos corretos
// =============================================================================
describe('userRepository — com pool mockado', () => {

  it('getUserByEmail retorna o usuário encontrado', async () => {
    const { restore } = mockPool({ 'WHERE email': [fakeUser] });
    try {
      const result = await getUserByEmail('julio@essencial.com');
      assert.deepEqual(result, fakeUser);
    } finally { restore(); }
  });

  it('getUserByEmail retorna null quando não encontrado', async () => {
    const { restore } = mockPool({ 'WHERE email': [] });
    try {
      const result = await getUserByEmail('nao@existe.com');
      assert.equal(result, null);
    } finally { restore(); }
  });

  it('getUserById retorna o usuário encontrado', async () => {
    const { restore } = mockPool({ 'WHERE id': [fakeUser] });
    try {
      const result = await getUserById(1);
      assert.deepEqual(result, fakeUser);
    } finally { restore(); }
  });

  it('getUserById retorna null quando não encontrado', async () => {
    const { restore } = mockPool({ 'WHERE id': [] });
    try {
      const result = await getUserById(999);
      assert.equal(result, null);
    } finally { restore(); }
  });

  it('createUser retorna o usuário inserido com todos os campos', async () => {
    const { restore } = mockPool({ 'INSERT INTO users': [fakeUser] });
    try {
      const result = await createUser('julio@essencial.com', 'hash', 'admin');
      assert.equal(result.id,    fakeUser.id);
      assert.equal(result.email, fakeUser.email);
      assert.equal(result.role,  fakeUser.role);
      assert.ok('password_hash' in result, 'RETURNING * deve incluir password_hash');
    } finally { restore(); }
  });

  it('createUser usa role "viewer" como default', async () => {
    const viewerUser = { ...fakeUser, role: 'viewer' };
    const { log, restore } = mockPool({ 'INSERT INTO users': [viewerUser] });
    try {
      await createUser('novo@essencial.com', 'hash');
      const insert = log.find(q => q.sql.includes('INSERT INTO users'));
      assert.ok(insert, 'deve executar INSERT');
      assert.equal(insert.params[2], 'viewer', 'role default deve ser viewer');
    } finally { restore(); }
  });

  it('updateLastLogin retorna id, email e last_login atualizados', async () => {
    const updated = { id: 1, email: 'julio@essencial.com', last_login: new Date() };
    const { restore } = mockPool({ 'UPDATE users': [updated] });
    try {
      const result = await updateLastLogin(1);
      assert.equal(result.id,    updated.id);
      assert.equal(result.email, updated.email);
      assert.ok(result.last_login, 'last_login deve estar preenchido');
    } finally { restore(); }
  });

  it('updateLastLogin retorna null quando usuário não existe', async () => {
    const { restore } = mockPool({ 'UPDATE users': [] });
    try {
      const result = await updateLastLogin(999);
      assert.equal(result, null);
    } finally { restore(); }
  });

  it('listUsers retorna array de usuários sem password_hash no SELECT', async () => {
    const safeUser = { id: 1, email: 'julio@essencial.com', role: 'admin',
                       created_at: new Date(), updated_at: new Date(), last_login: null };
    const { log, restore } = mockPool({ 'SELECT id': [safeUser] });
    try {
      const result = await listUsers();
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 1);

      // Garante que password_hash não está na query SQL
      const query = log.find(q => q.sql.includes('SELECT'));
      assert.ok(query, 'deve executar SELECT');
      assert.ok(
        !query.sql.includes('password_hash'),
        'listUsers não deve selecionar password_hash'
      );
    } finally { restore(); }
  });

  it('deleteUser retorna id e email do usuário removido', async () => {
    const deleted = { id: 1, email: 'julio@essencial.com' };
    const { restore } = mockPool({ 'DELETE FROM users': [deleted] });
    try {
      const result = await deleteUser(1);
      assert.equal(result.id,    deleted.id);
      assert.equal(result.email, deleted.email);
    } finally { restore(); }
  });

  it('deleteUser retorna null quando usuário não existe', async () => {
    const { restore } = mockPool({ 'DELETE FROM users': [] });
    try {
      const result = await deleteUser(999);
      assert.equal(result, null);
    } finally { restore(); }
  });

});
