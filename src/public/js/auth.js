/* ── auth.js — Lógica de login para login.html ──────────────────────────── */
(function () {
  'use strict';

  const form      = document.getElementById('login-form');
  const emailEl   = document.getElementById('email');
  const passwordEl= document.getElementById('password');
  const btnSubmit = document.getElementById('btn-submit');
  const btnLabel  = document.getElementById('btn-label');
  const errorMsg  = document.getElementById('error-msg');

  if (!form) return; // segurança caso o script seja carregado em outra página

  // ── Helpers ──────────────────────────────────────────────────────────────
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
    errorMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    errorMsg.hidden = true;
    errorMsg.textContent = '';
  }

  function setLoading(on) {
    btnSubmit.disabled = on;
    btnSubmit.classList.toggle('loading', on);
    btnLabel.textContent = on ? 'Entrando...' : 'Entrar';
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideError();

    const email    = emailEl.value.trim();
    const password = passwordEl.value;

    // Validação client-side rápida
    if (!email || !password) {
      showError('Preencha e-mail e senha.');
      return;
    }
    if (password.length < 6) {
      showError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        // Persiste credenciais para uso nas páginas autenticadas
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify({
          userId: data.userId,
          email:  data.email,
          role:   data.role,
        }));
        window.location.href = '/dashboard';
      } else {
        showError(data.error || 'Credenciais inválidas. Tente novamente.');
      }
    } catch {
      showError('Erro de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  });
})();
