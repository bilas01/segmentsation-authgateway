/**
 * Injecter dans admin.html avant </body> :
 *   <script src="/admin-connector.js"></script>
 *
 * Ce fichier remplace les données statiques du dashboard
 * par des appels réels vers /api/admin/*
 */

(function () {
  'use strict';

  const API = '/api/admin';

  // ── Helpers ──────────────────────────────────────────────────────
  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { window.location.href = '/login'; return null; }
    return res.json();
  }

  const get    = (path)        => api('GET',    path);
  const post   = (path, body)  => api('POST',   path, body);
  const patch  = (path, body)  => api('PATCH',  path, body);
  const del    = (path)        => api('DELETE',  path);

  // ── Chargement initial ───────────────────────────────────────────
  async function loadAll() {
    const [stats, orgs, users, logs] = await Promise.all([
      get('/stats'),
      get('/orgs'),
      get('/users'),
      get('/logs'),
    ]);

    if (stats) updateStats(stats);
    if (orgs)  updateClientsTable(orgs);
    if (users) updateUsersTable(users);
    if (logs)  updateLogs(logs);
    if (orgs)  updateOrgSelect(orgs);
  }

  // ── Stats ────────────────────────────────────────────────────────
  function updateStats(stats) {
    const map = {
      '.stat-value.orange': stats.orgs?.active ?? '—',
      '.stat-value.red':    stats.orgs?.suspended ?? '—',
    };
    // Les stat-cards sont positionnelles — on les met à jour par index
    const cards = document.querySelectorAll('.stat-card .stat-value');
    if (cards[0]) cards[0].textContent = stats.orgs?.active    ?? '—';
    if (cards[1]) cards[1].textContent = stats.orgs?.suspended ?? '—';
    if (cards[2]) cards[2].textContent = stats.users?.total    ?? '—';
    if (cards[3]) cards[3].textContent = stats.loginsToday     ?? '—';
    // Patch label du dernier stat
    const labels = document.querySelectorAll('.stat-card .stat-label');
    if (labels[3]) labels[3].textContent = 'Connexions aujourd\'hui';
  }

  // ── Table clients ────────────────────────────────────────────────
  function updateClientsTable(orgs) {
    // On réécrit CLIENTS global utilisé par renderClients() existant
    if (typeof CLIENTS !== 'undefined') {
      CLIENTS.length = 0;
      orgs.forEach(o => CLIENTS.push({
        id:         o.id,
        org:        o.name,
        email:      o.instance_url, // affiché comme référence instance
        plan:       o.plan,
        members:    o.member_count ?? 0,
        maxMembers: o.max_members,
        status:     o.status,
        created:    o.created_at?.split('T')[0] ?? '',
        users:      [],
      }));
      if (typeof renderClients === 'function') renderClients(CLIENTS);
    }
    // Badges sidebar
    const badge = document.getElementById('badge-clients');
    if (badge) badge.textContent = orgs.length;
  }

  // ── Table users ──────────────────────────────────────────────────
  function updateUsersTable(users) {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    users.forEach(u => {
      const statusBadge = u.active
        ? `<span class="badge badge-active"><span class="badge-dot"></span>Actif</span>`
        : `<span class="badge badge-suspended"><span class="badge-dot"></span>Révoqué</span>`;
      const roleBadge = {
        owner:      '<span class="plan-badge plan-pro">Owner</span>',
        admin:      '<span class="plan-badge plan-starter">Admin</span>',
        superadmin: '<span class="plan-badge plan-enterprise">Super</span>',
      }[u.role] || `<span style="color:var(--gray1);font-size:.75rem">Member</span>`;

      tbody.innerHTML += `
        <tr>
          <td><span class="cell-primary">${u.email}</span></td>
          <td><span class="cell-mono">${u.org_name}</span></td>
          <td>${roleBadge}</td>
          <td>${statusBadge}</td>
          <td><span class="cell-mono">${u.last_login ? u.last_login.replace('T',' ').slice(0,16) : '—'}</span></td>
          <td>
            <div class="actions">
              <button class="btn btn-sm btn-ghost"
                onclick="adminResetPwd('${u.id}','${u.email}')">Reset mdp</button>
              <button class="btn btn-sm btn-danger"
                onclick="adminRevokeUser('${u.id}','${u.email}',this)">Révoquer</button>
            </div>
          </td>
        </tr>`;
    });
  }

  // ── Logs ─────────────────────────────────────────────────────────
  function updateLogs(logs) {
    const container = document.getElementById('logs-list');
    if (!container) return;
    const colorMap = {
      login_success:   'var(--green)',
      login_fail:      'var(--red)',
      logout:          'var(--gray1)',
      reset_password:  'var(--yellow)',
    };
    container.innerHTML = '';
    logs.forEach(l => {
      const color = colorMap[l.event] || 'var(--gray1)';
      const time  = l.created_at?.replace('T',' ').slice(0,16) ?? '';
      container.innerHTML += `
        <div class="log-entry">
          <span class="log-time">${time}</span>
          <span class="log-dot" style="background:${color}"></span>
          <span class="log-msg">
            <strong>${l.event.replace(/_/g,' ')}</strong>
            ${l.email ? '— ' + l.email : ''}
            ${l.org_name ? '(' + l.org_name + ')' : ''}
          </span>
        </div>`;
    });
  }

  // ── Select org dans modal ─────────────────────────────────────────
  function updateOrgSelect(orgs) {
    const sel = document.getElementById('user-org-select');
    if (!sel) return;
    sel.innerHTML = orgs
      .filter(o => o.status === 'active')
      .map(o => `<option value="${o.id}">${o.name}</option>`)
      .join('');
  }

  // ── Actions globales (appelées depuis le HTML) ───────────────────

  window.adminRevokeUser = async function (id, email, btn) {
    if (!confirm(`Révoquer l'accès de ${email} ?`)) return;
    const data = await patch(`/users/${id}/revoke`);
    if (data?.success) {
      btn.closest('tr').style.opacity = '0.4';
      btn.closest('tr').style.transition = 'opacity .4s';
      setTimeout(() => btn.closest('tr').remove(), 400);
      if (typeof toast === 'function') toast(`Accès révoqué : ${email}`);
    }
  };

  window.adminResetPwd = async function (id, email) {
    const data = await patch(`/users/${id}/reset-password`);
    if (data?.success) {
      if (typeof toast === 'function') {
        toast(`Nouveau mdp temporaire pour ${email} : ${data.tempPassword}`);
      }
    }
  };

  // Surcharge createClient() pour appeler l'API réelle
  window.createClient = async function () {
    const org      = document.getElementById('new-org')?.value.trim();
    const email    = document.getElementById('new-email')?.value.trim();
    const plan     = document.getElementById('new-plan')?.value;
    const max      = parseInt(document.getElementById('new-maxmembers')?.value) || 5;
    const password = document.getElementById('new-password')?.value.trim() || undefined;

    if (!org || !email) {
      if (typeof toast === 'function') toast('Remplis les champs obligatoires.');
      return;
    }

    // L'instance_url est dérivée du nom : client-slug.segstation.org
    const slug        = org.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const instanceUrl = `https://${slug}.${location.hostname.replace('admin.', '')}`;

    const data = await post('/orgs', {
      name:             org,
      contactEmail:     email,
      plan,
      maxMembers:       max,
      instanceUrl,
      tempPassword:     password,
    });

    if (data?.success) {
      if (typeof closeModal === 'function') closeModal('modal-create-client');
      if (typeof toast === 'function') toast(`"${org}" créé. Accès envoyé à ${email}`);
      // Rafraîchit la table
      const orgs = await get('/orgs');
      if (orgs) { updateClientsTable(orgs); updateOrgSelect(orgs); }
      // Affiche la instance_key dans la console pour provisionning manuel
      console.info(`[segstation] Instance key pour ${org} :`, data.instanceKey);
      console.info(`[segstation] Instance URL :`, instanceUrl);
    } else {
      if (typeof toast === 'function') toast(data?.error || 'Erreur lors de la création.');
    }
  };

  // ── Init ─────────────────────────────────────────────────────────
  // try/catch : si l'API est inaccessible, le dashboard statique reste fonctionnel
  loadAll().catch(function(err) {
    console.warn('[admin-connector] API inaccessible, mode statique actif:', err.message);
  });

  // Rafraîchissement automatique toutes les 60s
  setInterval(function() {
    loadAll().catch(function() {});
  }, 60_000);

})();
