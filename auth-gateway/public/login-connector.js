/**
 * Ce fichier est injecté dans login.html via une balise <script src="/login-connector.js">
 * Il remplace le submit fictif (setTimeout) par le vrai appel API.
 * Ajouter dans login.html avant </body> :
 *   <script src="/login-connector.js"></script>
 */

(function () {
  'use strict';

  const form     = document.getElementById('loginForm');
  const emailIn  = document.getElementById('emailInput');
  const passIn   = document.getElementById('passwordInput');
  const emailErr = document.getElementById('emailError');
  const passErr  = document.getElementById('passwordError');
  const btnLogin = document.getElementById('btnLogin');

  if (!form) return; // page non concernée

  // Remplace le listener existant (clonage pour retirer les anciens)
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  // Relier les refs aux nouveaux éléments
  const f    = newForm;
  const eIn  = f.querySelector('#emailInput');
  const pIn  = f.querySelector('#passwordInput');
  const eErr = f.querySelector('#emailError');
  const pErr = f.querySelector('#passwordError');
  const btn  = f.querySelector('#btnLogin');
  const tog  = f.querySelector('#togglePwd');
  const eye  = f.querySelector('#eyeIcon');

  // Toggle password visibility
  let pwdVisible = false;
  if (tog) {
    tog.addEventListener('click', () => {
      pwdVisible = !pwdVisible;
      pIn.type = pwdVisible ? 'text' : 'password';
      eye.innerHTML = pwdVisible
        ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
        : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    });
  }

  // Clear errors on input
  eIn.addEventListener('input', () => { eIn.classList.remove('error'); eErr.classList.remove('show'); });
  pIn.addEventListener('input', () => { pIn.classList.remove('error'); pErr.classList.remove('show'); });

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  // Submit
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    let valid = true;

    if (!isValidEmail(eIn.value.trim())) {
      eIn.classList.add('error'); eErr.classList.add('show'); valid = false;
    }
    if (pIn.value.length < 6) {
      pIn.classList.add('error');
      pErr.textContent = 'Mot de passe trop court.';
      pErr.classList.add('show'); valid = false;
    }
    if (!valid) return;

    btn.classList.add('loading');

    try {
      const res = await fetch('/api/auth/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email:    eIn.value.trim().toLowerCase(),
          password: pIn.value,
          remember: f.querySelector('#rememberMe')?.checked || false,
        })
      });

      const data = await res.json();
      btn.classList.remove('loading');

      if (res.ok && data.redirect) {
        // Affiche l'overlay de succès puis redirige
        const overlay = document.getElementById('successOverlay');
        if (overlay) {
          overlay.classList.add('show');
          setTimeout(() => {
            const fill = document.getElementById('progressFill');
            if (fill) fill.style.width = '100%';
          }, 100);
        }
        setTimeout(() => { window.location.href = data.redirect; }, 1600);
      } else {
        pIn.classList.add('error');
        pErr.textContent = data.error || 'Identifiants invalides.';
        pErr.classList.add('show');
      }
    } catch (err) {
      btn.classList.remove('loading');
      pErr.textContent = 'Erreur réseau, réessayez.';
      pErr.classList.add('show');
    }
  });

  // Forgot password
  window.showForgot = function (e) {
    e.preventDefault();
    const email = eIn.value.trim();
    if (!email) { eIn.focus(); return; }
    fetch('/api/auth/forgot-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email })
    }).then(() => {
      alert('Si ce compte existe, un email de réinitialisation a été envoyé.');
    });
  };

  // SSO
  window.handleSSO = function () {
    window.location.href = '/api/auth/sso';
  };

})();
