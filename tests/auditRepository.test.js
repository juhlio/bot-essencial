const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.DATABASE_URL;

const { logAccess, getAccessLogs, getAllAccessLogs } = require('../src/database/auditRepository');

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

const fakeLog = {
  id: 1,
  user_id: 42,
  action: 'login',
  ip_address: '192.168.1.1',
  timestamp: new Date(),
};

// =============================================================================
// Suite 1 — Degradação graciosa: sem banco disponível
// =============================================================================
describe('auditRepository — sem banco disponível', () => {

  it('logAccess retorna null', async () => {
    assert.equal(await logAccess(1, 'login', '127.0.0.1'), null);
  });

  it('getAccessLogs retorna array vazio', async () => {
    const result = await getAccessLogs(1);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('getAllAccessLogs retorna array vazio', async () => {
    const result = await getAllAccessLogs();
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('nenhuma função lança exceção', async () => {
    await assert.doesNotReject(() => logAccess(1, 'login', '127.0.0.1'));
    await assert.doesNotReject(() => getAccessLogs(1));
    await assert.doesNotReject(() => getAllAccessLogs());
  });

});

// =============================================================================
// Suite 2 — Com pool mockado: retornos corretos
// =============================================================================
describe('auditRepository — com pool mockado', () => {

  it('logAccess insere e retorna o registro criado', async () => {
    const { restore } = mockPool({ 'INSERT INTO audit_logs': [fakeLog] });
    try {
      const result = await logAccess(42, 'login', '192.168.1.1');
      assert.equal(result.id,         fakeLog.id);
      assert.equal(result.user_id,    fakeLog.user_id);
      assert.equal(result.action,     fakeLog.action);
      assert.equal(result.ip_address, fakeLog.ip_address);
    } finally { restore(); }
  });

  it('logAccess passa user_id, action e ip_address como parâmetros', async () => {
    const { log, restore } = mockPool({ 'INSERT INTO audit_logs': [fakeLog] });
    try {
      await logAccess(42, 'logout', '10.0.0.1');
      const q = log.find(q => q.sql.includes('INSERT INTO audit_logs'));
      assert.ok(q, 'deve executar INSERT');
      assert.equal(q.params[0], 42,         'user_id correto');
      assert.equal(q.params[1], 'logout',   'action correto');
      assert.equal(q.params[2], '10.0.0.1', 'ip_address correto');
    } finally { restore(); }
  });

  it('getAccessLogs retorna logs do usuário ordenados', async () => {
    const logs = [fakeLog, { ...fakeLog, id: 2, action: 'logout' }];
    const { log, restore } = mockPool({ 'WHERE user_id': logs });
    try {
      const result = await getAccessLogs(42);
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 2);
      assert.equal(result[0].action, 'login');

      const q = log.find(q => q.sql.includes('WHERE user_id'));
      assert.ok(q.sql.includes('ORDER BY timestamp DESC'), 'deve ordenar por timestamp DESC');
      assert.equal(q.params[0], 42,  'filtra pelo user_id correto');
      assert.equal(q.params[1], 100, 'usa limit default 100');
    } finally { restore(); }
  });

  it('getAccessLogs respeita o limit informado', async () => {
    const { log, restore } = mockPool({ 'WHERE user_id': [fakeLog] });
    try {
      await getAccessLogs(42, 10);
      const q = log.find(q => q.sql.includes('WHERE user_id'));
      assert.equal(q.params[1], 10, 'deve usar limit=10');
    } finally { restore(); }
  });

  it('getAllAccessLogs retorna todos os logs paginados', async () => {
    const logs = [fakeLog, { ...fakeLog, id: 2, user_id: 7, action: 'update' }];
    const { log, restore } = mockPool({ 'ORDER BY timestamp': logs });
    try {
      const result = await getAllAccessLogs();
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 2);

      const q = log.find(q => q.sql.includes('ORDER BY timestamp'));
      assert.equal(q.params[0], 500, 'usa limit default 500');
      assert.equal(q.params[1], 0,   'usa offset default 0');
    } finally { restore(); }
  });

  it('getAllAccessLogs respeita limit e offset informados', async () => {
    const { log, restore } = mockPool({ 'ORDER BY timestamp': [] });
    try {
      await getAllAccessLogs(50, 100);
      const q = log.find(q => q.sql.includes('ORDER BY timestamp'));
      assert.equal(q.params[0], 50,  'limit correto');
      assert.equal(q.params[1], 100, 'offset correto');
    } finally { restore(); }
  });

});
