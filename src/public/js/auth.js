/* ── auth.js ─────────────────────────────────────────────────────────────────
 * Módulo de autenticação reutilizável.
 *
 * Browser  → window.Auth = Auth (instância padrão com localStorage real)
 * Node.js  → const { createAuth } = require('./auth')
 *            const auth = createAuth({ storage, fetchFn, redirect })
 * ──────────────────────────────────────────────────────────────────────────── */

const TOKEN_KEY = 'auth_token';
const USER_KEY  = 'auth_user';

/**
 * Cria uma instância do módulo de autenticação com injeção de dependências.
 *
 * @param {object} [deps]
 * @param {object}   [deps.storage]  - Objeto compatível com localStorage (getItem/setItem/removeItem)
 * @param {Function} [deps.fetchFn]  - Substituto para window.fetch (útil em testes)
 * @param {Function} [deps.redirect] - Substituto para window.location.href (útil em testes)
 */
function createAuth(deps) {
  deps = deps || {};

  var storage  = deps.storage  || (typeof localStorage  !== 'undefined' ? localStorage  : null);
  var fetchFn  = deps.fetchFn  || (typeof fetch         !== 'undefined' ? fetch         : null);
  var redirect = deps.redirect || function (url) {
    if (typeof window !== 'undefined') window.location.href = url;
  };

  // ── getAuthToken ────────────────────────────────────────────────────────────
  function getAuthToken() {
    return storage ? storage.getItem(TOKEN_KEY) : null;
  }

  // ── setAuthToken ────────────────────────────────────────────────────────────
  function setAuthToken(token) {
    if (storage) storage.setItem(TOKEN_KEY, token);
  }

  // ── clearAuthToken ──────────────────────────────────────────────────────────
  // Remove token e dados do usuário do storage.
  function clearAuthToken() {
    if (!storage) return;
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(USER_KEY);
  }

  // ── isAuthenticated ─────────────────────────────────────────────────────────
  function isAuthenticated() {
    var t = getAuthToken();
    return !!t && t.length > 0;
  }

  // ── getAuthHeader ───────────────────────────────────────────────────────────
  // Retorna objeto de cabeçalhos pronto para spread em chamadas fetch.
  function getAuthHeader() {
    var token = getAuthToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  // ── logout ──────────────────────────────────────────────────────────────────
  // Revoga o token no servidor, limpa o storage e redireciona para /login.
  async function logout() {
    var token = getAuthToken();
    if (token && fetchFn) {
      try {
        await fetchFn('/auth/logout', {
          method:  'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeader()),
        });
      } catch (_) {
        // Ignora erros de rede — o token local é removido de qualquer forma
      }
    }
    clearAuthToken();
    redirect('/login');
  }

  return { getAuthToken, setAuthToken, clearAuthToken, isAuthenticated, getAuthHeader, logout };
}

/* ── Inicialização por ambiente ────────────────────────────────────────────── */
if (typeof module !== 'undefined' && module.exports) {
  // Node.js / testes
  module.exports = { createAuth };
} else {
  // Browser: instância padrão disponível globalmente
  window.Auth = createAuth();
}
