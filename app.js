// === MisFinanzas App Controller ===
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const Utils = {
  fmt(n) { return '$' + Math.abs(n).toLocaleString('es', {minimumFractionDigits: 0, maximumFractionDigits: 2}); },
  fmtSign(n) { return (n < 0 ? '-' : (n > 0 ? '+' : '')) + this.fmt(n); },
  fmtDate(d) { const dt = new Date(d + 'T12:00:00'); return dt.toLocaleDateString('es', {day:'numeric',month:'short',year:'numeric'}); },
  monthLabel(y, m) { return MONTHS_ES[m] + ' ' + y; },
  catInfo(type, catId) {
    if (!catId || catId === 'sin_categoria') return {icon:'📋', name:'Sin categoría'};
    return CATEGORIES[type].find(c => c.id === catId) || {icon:'❓', name: catId};
  },
  today() { return new Date().toISOString().split('T')[0]; },
  timeAgo(isoDate) {
    const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
    if (diff === 0) return 'hoy';
    if (diff === 1) return 'ayer';
    return 'hace ' + diff + ' días';
  }
};

const app = {
  currentView: 'dashboard',
  viewStack: [],
  stmtYear: new Date().getFullYear(),
  stmtMonth: new Date().getMonth(),
  stmtFilter: 'all',
  txType: 'income',
  txCategory: '',
  editingId: null,
  detailId: null,
  confirmCb: null,
  undoStack: [],
  _deleteStep: 0,
  _trashDeleteId: null,

  // ============================================================
  // INIT
  // ============================================================
  init() {
    TRASH.cleanup();
    if (!UserIdentity.getName()) {
      this._showIdentitySetup(false);
      return; // Wait for identity before finishing init
    }
    this._finishInit();
  },

  _finishInit() {
    this._updateHeaderIdentity();
    this.navigate('dashboard');
    document.getElementById('tx-date').value = Utils.today();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    this._checkEndOfMonthBackup();
  },

  // ============================================================
  // IDENTITY
  // ============================================================
  _showIdentitySetup(isEdit) {
    const modal = document.getElementById('identity-modal');
    const title = document.getElementById('identity-modal-title');
    const subtitle = document.getElementById('identity-modal-subtitle');
    const cancelBtn = document.getElementById('identity-modal-cancel');
    const input = document.getElementById('identity-name-input');

    if (isEdit) {
      title.textContent = 'Cambiar nombre';
      subtitle.textContent = 'Actualiza cómo te identificas. Esto no cambia la autoría de movimientos ya registrados.';
      cancelBtn.classList.remove('hidden');
      input.value = UserIdentity.getName() || '';
    } else {
      title.textContent = '¡Bienvenido a MisFinanzas!';
      subtitle.textContent = '¿Cómo te llamas? Cada movimiento que registres quedará marcado con tu nombre.';
      cancelBtn.classList.add('hidden');
      input.value = '';
    }
    document.querySelectorAll('.identity-quick-btn').forEach(b => b.classList.remove('selected'));
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
  },

  _setIdentityInput(name) {
    document.getElementById('identity-name-input').value = name;
    document.querySelectorAll('.identity-quick-btn').forEach(b =>
      b.classList.toggle('selected', b.dataset.name === name)
    );
  },

  saveIdentity() {
    const name = document.getElementById('identity-name-input').value.trim();
    if (!name) { this.toast('Ingresa tu nombre para continuar'); return; }
    const isNew = !UserIdentity.getName();
    UserIdentity.set(name);
    document.getElementById('identity-modal').classList.add('hidden');
    this._updateHeaderIdentity();
    if (isNew) {
      this._finishInit();
      this.toast('Bienvenido, ' + name + ' 👋');
    } else {
      this.toast('Nombre actualizado ✓');
      if (this.currentView === 'settings') this.renderSettings();
    }
  },

  cancelIdentitySetup() {
    document.getElementById('identity-modal').classList.add('hidden');
  },

  _updateHeaderIdentity() {
    const name = UserIdentity.getName();
    const initial = name ? name.charAt(0).toUpperCase() : '?';
    const el = document.getElementById('header-profile-initial');
    if (el) el.textContent = initial;
  },

  // ============================================================
  // NAVIGATION
  // ============================================================
  navigate(view, opts) {
    if (view !== this.currentView) this.viewStack.push(this.currentView);
    this.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) el.classList.add('active');

    const back = document.getElementById('header-back');
    const title = document.getElementById('header-title');
    const isMain = ['dashboard','statements','reports','forecast'].includes(view);
    if (view !== 'sync' && typeof SyncManager !== 'undefined') SyncManager.reset();
    back.classList.toggle('hidden', isMain);

    const fab = document.getElementById('fab');
    fab.classList.toggle('hidden', ['add','detail','sync','trash','settings'].includes(view));

    const titles = {
      dashboard:'MisFinanzas', add:'Nuevo Movimiento', statements:'Estados de Cuenta',
      detail:'Detalle', reports:'Reportes', forecast:'Pronóstico', sync:'Sincronizar',
      trash:'Papelera', settings:'Mi Perfil'
    };
    title.textContent = titles[view] || 'MisFinanzas';

    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));

    if (view === 'dashboard') this.renderDashboard();
    else if (view === 'add') this.renderAddForm(opts);
    else if (view === 'statements') { if(opts?.filter) this.stmtFilter = opts.filter; this.renderStatements(); }
    else if (view === 'detail') this.renderDetail(opts?.id);
    else if (view === 'reports') this.updateReports();
    else if (view === 'forecast') this.renderForecast();
    else if (view === 'trash') this.renderTrash();
    else if (view === 'settings') this.renderSettings();
  },

  goBack() {
    const prev = this.viewStack.pop() || 'dashboard';
    this.currentView = prev;
    this.viewStack.pop();
    this.navigate(prev);
  },

  // ============================================================
  // DASHBOARD
  // ============================================================
  renderDashboard() {
    const now = new Date();
    const txs = DB.getByMonth(now.getFullYear(), now.getMonth());
    let inc = 0, exp = 0, totalBal = 0;
    DB.getAll().forEach(t => { totalBal += t.type === 'income' ? t.amount : -t.amount; });
    txs.forEach(t => { if (t.type === 'income') inc += t.amount; else exp += t.amount; });

    document.getElementById('balance-amount').textContent = Utils.fmt(totalBal);
    document.getElementById('balance-amount').style.color = totalBal >= 0 ? 'var(--income)' : 'var(--expense)';
    document.getElementById('balance-month-label').textContent = Utils.monthLabel(now.getFullYear(), now.getMonth());
    document.getElementById('income-total').textContent = Utils.fmt(inc);
    document.getElementById('expense-total').textContent = Utils.fmt(exp);

    const recent = DB.getAll().slice(0, 8);
    const list = document.getElementById('recent-list');
    const empty = document.getElementById('empty-recent');
    if (recent.length === 0) { list.innerHTML = ''; list.appendChild(empty); empty.style.display = ''; return; }
    empty.style.display = 'none';
    list.innerHTML = recent.map(t => this._txItemHTML(t)).join('');

    const totals = DB.getMonthlyTotals(6);
    Charts.miniBar('dashboard-chart', totals);
  },

  _txItemHTML(t) {
    const c = Utils.catInfo(t.type, t.category);
    const sign = t.type === 'income' ? '+' : '-';
    const cls = t.type === 'income' ? 'income-amount' : 'expense-amount';
    const isMe = UserIdentity.isOwner(t);
    const authorTag = t.author
      ? `<span class="${isMe ? 'author-me' : 'author-other'}">${t.author}</span>`
      : '';
    return `<div class="tx-item" onclick="app.navigate('detail',{id:'${t.id}'})">
      <div class="tx-icon ${t.type}">${c.icon}</div>
      <div class="tx-info">
        <div class="tx-desc">${t.description}</div>
        <div class="tx-cat">${c.name}${t.author ? ' · ' : ''}${authorTag}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amount ${cls}">${sign}${Utils.fmt(t.amount)}</div>
        <div class="tx-date">${Utils.fmtDate(t.date)}</div>
      </div>
    </div>`;
  },

  // ============================================================
  // ADD / EDIT TRANSACTION
  // ============================================================
  renderAddForm(opts) {
    this.editingId = opts?.editId || null;
    this.txType = 'income';
    this.txCategory = '';
    document.getElementById('transaction-form').reset();
    document.getElementById('tx-date').value = Utils.today();

    // Author is always the device's identity — make field read-only
    const authorField = document.getElementById('tx-author');
    authorField.value = UserIdentity.getName() || '';
    authorField.readOnly = true;
    authorField.classList.add('author-readonly');

    const saveBtn = document.getElementById('btn-save');
    saveBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg> Guardar Movimiento';
    document.getElementById('header-title').textContent = 'Nuevo Movimiento';

    if (this.editingId) {
      const tx = DB.getById(this.editingId);
      if (tx) {
        this.txType = tx.type;
        this.txCategory = tx.category;
        document.getElementById('tx-amount').value = tx.amount;
        document.getElementById('tx-description').value = tx.description;
        document.getElementById('tx-date').value = tx.date;
        authorField.value = tx.author || UserIdentity.getName() || '';
        document.getElementById('header-title').textContent = 'Editar Movimiento';
        saveBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg> Actualizar';
      }
    }
    this.setTransactionType(this.txType);
  },

  setTransactionType(type) {
    this.txType = type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    this._renderCategories();
  },

  _renderCategories() {
    const grid = document.getElementById('category-grid');
    const cats = CATEGORIES[this.txType];
    grid.innerHTML = cats.map(c =>
      `<button type="button" class="cat-btn ${this.txCategory === c.id ? 'active' : ''}" onclick="app.selectCategory('${c.id}')">
        <span class="cat-emoji">${c.icon}</span>${c.name}
      </button>`
    ).join('') + `<button type="button" class="cat-btn cat-btn-add" onclick="app.openCatModal()">
        <span class="cat-emoji">➕</span>Nueva
      </button>`;
  },

  selectCategory(id) {
    this.txCategory = id;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
  },

  saveTransaction(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('tx-amount').value);
    const description = document.getElementById('tx-description').value.trim();
    const date = document.getElementById('tx-date').value;

    if (!amount || !description || !date) {
      this.toast('Completa todos los campos obligatorios');
      return false;
    }

    // For NEW transactions: author = current device identity
    // For EDITS: preserve the original author (ownership doesn't change on edit)
    const author = this.editingId
      ? (DB.getById(this.editingId)?.author || UserIdentity.getName() || 'Principal')
      : (UserIdentity.getName() || 'Principal');

    const data = {
      type: this.txType, amount, description, date,
      category: this.txCategory || 'sin_categoria',
      author
    };

    if (this.editingId) {
      const prev = DB.getById(this.editingId);
      this._pushUndo({action:'edit', id: this.editingId, prev: {...prev}});
      DB.update(this.editingId, data);
      this.toast('Movimiento actualizado ✓ <a onclick="app.undo()">Deshacer</a>');
    } else {
      const tx = DB.add(data);
      this._pushUndo({action:'add', id: tx.id});
      this.toast('Movimiento registrado ✓ <a onclick="app.undo()">Deshacer</a>');
    }

    this.editingId = null;
    this.goBack();
    return false;
  },

  // ============================================================
  // STATEMENTS
  // ============================================================
  renderStatements() {
    document.getElementById('statements-month').textContent = Utils.monthLabel(this.stmtYear, this.stmtMonth);
    const txs = DB.getByMonth(this.stmtYear, this.stmtMonth);
    let inc = 0, exp = 0;
    txs.forEach(t => { if (t.type === 'income') inc += t.amount; else exp += t.amount; });
    const net = inc - exp;

    document.getElementById('stmt-income').textContent = Utils.fmt(inc);
    document.getElementById('stmt-expense').textContent = Utils.fmt(exp);
    const netEl = document.getElementById('stmt-net');
    netEl.textContent = Utils.fmtSign(net);
    netEl.className = 'ssv ' + (net >= 0 ? 'income-amount' : 'expense-amount');

    document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === this.stmtFilter));

    const filtered = this.stmtFilter === 'all' ? txs : txs.filter(t => t.type === this.stmtFilter);
    const list = document.getElementById('statements-list');
    const empty = document.getElementById('empty-statements');

    if (filtered.length === 0) { list.innerHTML = ''; list.appendChild(empty); empty.style.display = ''; }
    else { empty.style.display = 'none'; list.innerHTML = filtered.map(t => this._txItemHTML(t)).join(''); }
  },

  changeMonth(delta) {
    this.stmtMonth += delta;
    if (this.stmtMonth > 11) { this.stmtMonth = 0; this.stmtYear++; }
    if (this.stmtMonth < 0) { this.stmtMonth = 11; this.stmtYear--; }
    this.renderStatements();
  },

  filterStatements(f) { this.stmtFilter = f; this.renderStatements(); },

  // ============================================================
  // DETAIL
  // ============================================================
  renderDetail(id) {
    this.detailId = id;
    const tx = DB.getById(id);
    if (!tx) { this.goBack(); return; }
    const c = Utils.catInfo(tx.type, tx.category);

    const badge = document.getElementById('detail-type-badge');
    badge.textContent = tx.type === 'income' ? 'Ingreso' : 'Egreso';
    badge.className = 'detail-badge ' + (tx.type === 'income' ? 'income-badge' : 'expense-badge');

    const amtEl = document.getElementById('detail-amount');
    amtEl.textContent = (tx.type === 'income' ? '+' : '-') + Utils.fmt(tx.amount);
    amtEl.style.color = tx.type === 'income' ? 'var(--income)' : 'var(--expense)';

    document.getElementById('detail-description').textContent = tx.description;
    document.getElementById('detail-category').textContent = c.icon + ' ' + c.name;
    document.getElementById('detail-date').textContent = Utils.fmtDate(tx.date);
    document.getElementById('detail-author').textContent = tx.author || 'Principal';
    document.getElementById('detail-created').textContent = new Date(tx.createdAt).toLocaleString('es');
    document.getElementById('detail-id').textContent = tx.id;

    // Ownership-based action visibility
    const isOwner = UserIdentity.isOwner(tx);
    const actionsEl = document.getElementById('detail-actions');
    const noticeEl = document.getElementById('detail-owner-notice');
    const noticeTextEl = document.getElementById('detail-owner-notice-text');

    if (isOwner) {
      actionsEl.classList.remove('hidden');
      noticeEl.classList.add('hidden');
    } else {
      actionsEl.classList.add('hidden');
      noticeEl.classList.remove('hidden');
      if (noticeTextEl) {
        noticeTextEl.textContent = `Registrado por ${tx.author || 'otro usuario'}. Solo esa persona puede modificarlo.`;
      }
    }
  },

  editTransaction() { this.navigate('add', { editId: this.detailId }); },

  deleteTransaction() {
    const tx = DB.getById(this.detailId);
    if (!tx) return;
    if (!UserIdentity.isOwner(tx)) { this.toast('No puedes eliminar movimientos de otra persona'); return; }

    this._deleteStep = 1;
    document.getElementById('confirm-msg').innerHTML = '¿Eliminar este movimiento?';
    document.getElementById('confirm-ok').textContent = 'Eliminar';
    document.getElementById('confirm-ok').className = 'btn-danger';
    document.getElementById('confirm-modal').classList.remove('hidden');
  },

  confirmOk() {
    // Trash permanent delete (step 3)
    if (this._deleteStep === 3) {
      document.getElementById('confirm-modal').classList.add('hidden');
      document.getElementById('confirm-ok').style.background = '';
      this._deleteStep = 0;
      if (this._trashDeleteId) {
        TRASH.permanentDelete(this._trashDeleteId);
        this._trashDeleteId = null;
        this.toast('Eliminado permanentemente');
        this.renderTrash();
      }
      return;
    }

    // Standard soft-delete step 1 → step 2 confirmation
    if (this._deleteStep === 1) {
      this._deleteStep = 2;
      document.getElementById('confirm-msg').innerHTML = '⚠️ <strong>¿Estás SEGURO?</strong><br><small style="color:#94a3b8">Irá a la papelera. Puedes restaurarlo en los próximos 60 días.</small>';
      document.getElementById('confirm-ok').textContent = 'Sí, eliminar';
      document.getElementById('confirm-ok').style.background = '#7f1d1d';
      return;
    }

    // Execute soft delete
    document.getElementById('confirm-modal').classList.add('hidden');
    document.getElementById('confirm-ok').style.background = '';
    this._deleteStep = 0;
    const tx = DB.getById(this.detailId);
    if (tx) {
      TRASH.add({...tx});
      DB.remove(this.detailId);
      this._pushUndo({action:'delete', id: tx.id});
      this.toast('Movimiento eliminado <a onclick="app.undo()">Deshacer</a>');
      this.goBack();
    }
  },

  confirmCancel() {
    document.getElementById('confirm-modal').classList.add('hidden');
    document.getElementById('confirm-ok').style.background = '';
    this._deleteStep = 0;
    this._trashDeleteId = null;
  },

  // ============================================================
  // TRASH VIEW
  // ============================================================
  renderTrash() {
    TRASH.cleanup();
    const items = TRASH.getAll();
    const container = document.getElementById('trash-list');
    const empty = document.getElementById('empty-trash');
    const countEl = document.getElementById('trash-count');
    const myCount = items.filter(t => UserIdentity.isOwner(t)).length;

    countEl.textContent = items.length === 0
      ? ''
      : `${items.length} elemento${items.length !== 1 ? 's' : ''} — ${myCount} tuyo${myCount !== 1 ? 's' : ''}`;

    if (items.length === 0) {
      container.innerHTML = '';
      container.appendChild(empty);
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    container.innerHTML = items.map(t => this._trashItemHTML(t)).join('');
  },

  _trashItemHTML(t) {
    const c = Utils.catInfo(t.type, t.category);
    const sign = t.type === 'income' ? '+' : '-';
    const cls = t.type === 'income' ? 'income-amount' : 'expense-amount';
    const isOwner = UserIdentity.isOwner(t);
    const daysLeft = TRASH.daysLeft(t);
    const deletedWhen = Utils.timeAgo(t.deletedAt);
    const daysLabel = daysLeft > 0
      ? `Se borra en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`
      : 'Se borrará muy pronto';

    return `<div class="trash-item${isOwner ? '' : ' trash-item-locked'}">
      <div class="tx-icon ${t.type}">${c.icon}</div>
      <div class="tx-info">
        <div class="tx-desc">${t.description}</div>
        <div class="tx-cat">${c.name} · <span class="${isOwner ? 'author-me' : 'author-other'}">${t.author || 'Principal'}</span></div>
        <div class="trash-meta">${deletedWhen} · ${daysLabel}</div>
      </div>
      <div class="trash-actions">
        <span class="tx-amount ${cls}">${sign}${Utils.fmt(t.amount)}</span>
        ${isOwner ? `
          <button class="btn-restore" onclick="app.restoreTransaction('${t.id}')">Restaurar</button>
          <button class="btn-trash-delete" title="Eliminar permanentemente" onclick="app.permanentDeleteConfirm('${t.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        ` : '<span class="lock-notice" title="No puedes modificar esto">🔒</span>'}
      </div>
    </div>`;
  },

  restoreTransaction(id) {
    const item = TRASH.getById(id);
    if (!item) return;
    if (!UserIdentity.isOwner(item)) {
      this.toast('Solo ' + (item.author || 'su dueño') + ' puede restaurar este movimiento');
      return;
    }
    const tx = TRASH.restore(id);
    if (tx) {
      const d = DB._get();
      d.push(tx);
      DB._save(d);
      this.toast('Movimiento restaurado ✓');
      this.renderTrash();
    }
  },

  permanentDeleteConfirm(id) {
    const item = TRASH.getById(id);
    if (!item) return;
    if (!UserIdentity.isOwner(item)) {
      this.toast('No puedes eliminar definitivamente movimientos de otra persona');
      return;
    }
    this._deleteStep = 3;
    this._trashDeleteId = id;
    document.getElementById('confirm-msg').innerHTML =
      '⚠️ <strong>¿Eliminar permanentemente?</strong><br><small style="color:#94a3b8">Esta acción no se puede deshacer en absoluto.</small>';
    document.getElementById('confirm-ok').textContent = 'Eliminar definitivamente';
    document.getElementById('confirm-ok').className = 'btn-danger';
    document.getElementById('confirm-modal').classList.remove('hidden');
  },

  // ============================================================
  // SETTINGS VIEW
  // ============================================================
  renderSettings() {
    const me = UserIdentity.getName() || '—';
    const initial = me !== '—' ? me.charAt(0).toUpperCase() : '?';
    const trashItems = TRASH.getAll();
    const myTrashCount = trashItems.filter(t => UserIdentity.isOwner(t)).length;

    document.getElementById('settings-avatar-initial').textContent = initial;
    document.getElementById('settings-name').textContent = me;

    const trashLabel = trashItems.length === 0
      ? 'Papelera vacía'
      : `${trashItems.length} elemento${trashItems.length !== 1 ? 's' : ''} (${myTrashCount} tuyos)`;
    document.getElementById('settings-trash-count').textContent = trashLabel;
  },

  // ============================================================
  // REPORTS
  // ============================================================
  updateReports() {
    const months = parseInt(document.getElementById('report-months').value);
    const totals = DB.getMonthlyTotals(months);
    let inc = 0, exp = 0;
    totals.forEach(m => { inc += m.income; exp += m.expense; });
    const net = inc - exp;
    const avg = totals.length ? net / totals.length : 0;

    document.getElementById('rpt-income').textContent = Utils.fmt(inc);
    document.getElementById('rpt-expense').textContent = Utils.fmt(exp);
    const netEl = document.getElementById('rpt-net');
    netEl.textContent = Utils.fmtSign(net);
    netEl.className = 'rsc-value ' + (net >= 0 ? 'income-amount' : 'expense-amount');
    const avgEl = document.getElementById('rpt-avg');
    avgEl.textContent = Utils.fmtSign(avg);
    avgEl.className = 'rsc-value ' + (avg >= 0 ? 'income-amount' : 'expense-amount');

    Charts.barChart('report-bar-chart', totals);

    const now = new Date();
    const catData = DB.getCategoryTotals(now.getFullYear(), now.getMonth(), 'expense');
    Charts.donut('report-donut-chart', 'donut-legend', catData);
  },

  // ============================================================
  // PRINT
  // ============================================================
  printReport() {
    const months = parseInt(document.getElementById('report-months').value);
    const totals = DB.getMonthlyTotals(months);
    let inc = 0, exp = 0;
    totals.forEach(m => { inc += m.income; exp += m.expense; });

    const from = totals[0]?.label || '—', to = totals[totals.length-1]?.label || '—';
    let rows = '';
    totals.forEach(m => {
      rows += `<tr><td>${m.label}</td><td class="print-income">$${m.income.toLocaleString('es')}</td>
        <td class="print-expense">$${m.expense.toLocaleString('es')}</td>
        <td style="font-weight:600;color:${m.net>=0?'#059669':'#dc2626'}">$${m.net.toLocaleString('es')}</td></tr>`;
    });

    const authorTotals = {};
    const now = new Date();
    for(let i=months-1; i>=0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const txs = DB.getByMonth(d.getFullYear(), d.getMonth());
      txs.forEach(t => {
        const aut = t.author || 'Principal';
        if (!authorTotals[aut]) authorTotals[aut] = { income: 0, expense: 0 };
        if (t.type === 'income') authorTotals[aut].income += t.amount;
        else authorTotals[aut].expense += t.amount;
      });
    }

    let authorHtml = '<h2 style="margin-top:30px;border-bottom:1px solid #ccc;padding-bottom:5px">Desglose por Persona</h2><table><thead><tr><th>Persona</th><th>Ingresos</th><th>Egresos</th><th>Balance Neto</th></tr></thead><tbody>';
    for (const [aut, vals] of Object.entries(authorTotals)) {
      const net = vals.income - vals.expense;
      authorHtml += `<tr><td>${aut}</td><td class="print-income">$${vals.income.toLocaleString('es')}</td><td class="print-expense">$${vals.expense.toLocaleString('es')}</td><td style="font-weight:600;color:${net>=0?'#059669':'#dc2626'}">$${net.toLocaleString('es')}</td></tr>`;
    }
    authorHtml += '</tbody></table>';

    document.getElementById('print-content').innerHTML = `
      <h1>MisFinanzas — Resumen</h1>
      <p class="print-period">Periodo: ${from} — ${to}</p>
      <h2 style="border-bottom:1px solid #ccc;padding-bottom:5px">Resumen Unificado</h2>
      <table><thead><tr><th>Mes</th><th>Ingresos</th><th>Egresos</th><th>Neto</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="print-summary">
        <p><strong>Total Ingresos:</strong> $${inc.toLocaleString('es')} | <strong>Total Egresos:</strong> $${exp.toLocaleString('es')} | <strong>Balance:</strong> $${(inc-exp).toLocaleString('es')}</p>
      </div>
      ${authorHtml}
    `;
    setTimeout(() => window.print(), 200);
  },

  // ============================================================
  // FORECAST
  // ============================================================
  renderForecast() {
    const dateInput = document.getElementById('forecast-date');
    const now = new Date();
    dateInput.min = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0];
    if (!dateInput.value) {
      const def = new Date(now.getFullYear(), now.getMonth() + 3, 1);
      dateInput.value = def.toISOString().split('T')[0];
    }
    this.calculateForecast();
  },

  setForecastMonths(m) {
    const d = new Date();
    d.setMonth(d.getMonth() + m);
    document.getElementById('forecast-date').value = d.toISOString().split('T')[0];
    this.calculateForecast();
  },

  calculateForecast() {
    const dateVal = document.getElementById('forecast-date').value;
    if (!dateVal) return;
    const result = Forecast.calculate(dateVal);
    const container = document.getElementById('forecast-results');

    if (!result) {
      container.classList.add('hidden');
      this.toast('Necesitas al menos 1 mes de datos para proyectar');
      return;
    }
    container.classList.remove('hidden');

    document.getElementById('fc-current').textContent = Utils.fmt(result.currentBalance);
    document.getElementById('fc-current').style.color = result.currentBalance >= 0 ? 'var(--income)' : 'var(--expense)';
    document.getElementById('fc-optimistic').textContent = Utils.fmt(result.optimistic);
    document.getElementById('fc-optimistic').style.color = result.optimistic >= 0 ? 'var(--income)' : 'var(--expense)';
    document.getElementById('fc-realistic').textContent = Utils.fmt(result.realistic);
    document.getElementById('fc-realistic').style.color = result.realistic >= 0 ? 'var(--income)' : 'var(--expense)';
    document.getElementById('fc-pessimistic').textContent = Utils.fmt(result.pessimistic);
    document.getElementById('fc-pessimistic').style.color = result.pessimistic >= 0 ? 'var(--income)' : 'var(--expense)';
    document.getElementById('fc-avg-income').textContent = Utils.fmt(result.avgIncome);
    document.getElementById('fc-avg-expense').textContent = Utils.fmt(result.avgExpense);
    const netFlow = document.getElementById('fc-net-flow');
    netFlow.textContent = Utils.fmtSign(result.avgNet);
    netFlow.className = 'trend-value ' + (result.avgNet >= 0 ? 'income-amount' : 'expense-amount');
    document.getElementById('fc-months-analyzed').textContent = result.monthsAnalyzed;

    Charts.lineChart('forecast-chart', result.projection);
  },

  // ============================================================
  // CUSTOM CATEGORY MODAL
  // ============================================================
  _selectedCatIcon: '',

  openCatModal() {
    this._selectedCatIcon = '';
    document.getElementById('cat-modal-name').value = '';
    const iconGrid = document.getElementById('cat-icon-grid');
    iconGrid.innerHTML = ICON_OPTIONS.map(ic =>
      `<button type="button" class="icon-pick-btn" onclick="app.selectCatIcon(this, '${ic}')">${ic}</button>`
    ).join('');
    document.getElementById('cat-modal').classList.remove('hidden');
  },

  closeCatModal() { document.getElementById('cat-modal').classList.add('hidden'); },

  selectCatIcon(btn, icon) {
    this._selectedCatIcon = icon;
    document.querySelectorAll('.icon-pick-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  },

  saveCatModal() {
    const name = document.getElementById('cat-modal-name').value.trim();
    if (!name) { this.toast('Ingresa un nombre para la categoría'); return; }
    if (!this._selectedCatIcon) { this.toast('Selecciona un icono'); return; }
    const newId = CATEGORIES.addCustom(this.txType, name, this._selectedCatIcon);
    this.txCategory = newId;
    this.closeCatModal();
    this._renderCategories();
    this.toast('Categoría "' + name + '" creada ✓');
  },

  // ============================================================
  // UNDO (max 2 steps)
  // ============================================================
  _pushUndo(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > 2) this.undoStack.shift();
  },

  undo() {
    if (this.undoStack.length === 0) { this.toast('No hay acciones para deshacer'); return; }
    const entry = this.undoStack.pop();
    if (entry.action === 'add') {
      DB.remove(entry.id);
      this.toast('Registro deshecho ✓');
    } else if (entry.action === 'edit') {
      DB.update(entry.id, entry.prev);
      this.toast('Edición deshecha ✓');
    } else if (entry.action === 'delete') {
      // Restore from trash back to active
      const tx = TRASH.restore(entry.id);
      if (tx) {
        const d = DB._get();
        d.push(tx);
        DB._save(d);
        this.toast('Eliminación deshecha ✓');
      }
    }
    if (this.currentView === 'dashboard') this.renderDashboard();
    else if (this.currentView === 'statements') this.renderStatements();
    else if (this.currentView === 'detail') this.navigate('dashboard');
  },

  // ============================================================
  // BACKUP / RESTORE
  // ============================================================
  exportBackup() {
    const data = {
      transactions: DB.getAll(),
      trash: TRASH.getAll(),
      categories: CATEGORIES._getCustom(),
      identity: UserIdentity.get()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MisFinanzas_Respaldo_${Utils.today()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.toast('Respaldo descargado ✓');
  },

  importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.transactions) DB._save(data.transactions);
        if (data.trash) TRASH._save(data.trash);
        if (data.categories) CATEGORIES._saveCustom(data.categories);
        if (data.identity) localStorage.setItem(UserIdentity.KEY, JSON.stringify(data.identity));
        this.toast('Respaldo restaurado ✓');
        setTimeout(() => window.location.reload(), 1000); // Reload to apply memory properly
      } catch (err) {
        this.toast('Error: Archivo inválido');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  },

  // ============================================================
  // RECORDATORIO FIN DE MES
  // ============================================================
  _checkEndOfMonthBackup() {
    const today = new Date();
    // Revisa si mañana es el día 1 del mes (lo que significa que hoy es el último día)
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (tomorrow.getDate() === 1) {
      const todayStr = Utils.today();
      const lastPrompt = localStorage.getItem('mf_last_backup_prompt');
      
      if (lastPrompt !== todayStr) {
        localStorage.setItem('mf_last_backup_prompt', todayStr);
        const modal = document.getElementById('backup-prompt-modal');
        if (modal) modal.classList.remove('hidden');
      }
    }
  },

  closeBackupPrompt() {
    const modal = document.getElementById('backup-prompt-modal');
    if (modal) modal.classList.add('hidden');
  },

  doEndOfMonthBackup() {
    this.closeBackupPrompt();
    this.exportBackup();
  },

  // ============================================================
  // TOAST
  // ============================================================
  toast(msg) {
    const t = document.getElementById('toast');
    t.innerHTML = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
  }
};

// ============================================================
// SYNC MANAGER — P2P via PeerJS
// ============================================================
const SyncManager = {
  peer: null,
  conn: null,

  async initPeer() {
    if (!window.Peer) {
      app.toast('Cargando sistema de red...');
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }
  },

  generateShortId() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  },

  async startHosting() {
    try {
      await this.initPeer();
      const code = this.generateShortId();
      const fullId = 'misfinanzas-pwa-' + code;
      this.peer = new Peer(fullId);

      document.getElementById('sync-setup').classList.add('hidden');
      document.getElementById('sync-active').classList.remove('hidden');
      document.getElementById('sync-my-code').textContent = code;
      document.getElementById('sync-status').textContent = 'Esperando a que tu pareja ingrese el código...';

      this.peer.on('connection', (connection) => {
        this.conn = connection;
        this.setupConnection();
      });

      this.peer.on('error', (err) => {
        app.toast('Error de red: ' + err.type);
        this.reset();
      });
    } catch (e) {
      app.toast('Error al iniciar red. Revisa tu Internet.');
    }
  },

  async connectToPeer() {
    const code = document.getElementById('sync-code-input').value.trim().toUpperCase();
    if (!code) return app.toast('Ingresa un código válido');

    try {
      await this.initPeer();
      const fullId = 'misfinanzas-pwa-' + code;
      this.peer = new Peer();

      document.getElementById('sync-setup').classList.add('hidden');
      document.getElementById('sync-active').classList.remove('hidden');
      document.getElementById('sync-my-code').textContent = '—';
      document.getElementById('sync-status').textContent = 'Conectando con ' + code + '...';

      this.peer.on('open', () => {
        this.conn = this.peer.connect(fullId);
        this.setupConnection();
      });

      this.peer.on('error', () => {
        app.toast('Error: No se encontró el código');
        this.reset();
      });
    } catch (e) {
      app.toast('Error al conectar. Revisa tu Internet.');
    }
  },

  setupConnection() {
    this.conn.on('open', () => {
      document.getElementById('sync-status').innerHTML = '¡Conectado! <br><br>Sincronizando datos...';
      // Send both active transactions AND trash
      this.conn.send({
        type: 'sync',
        data: { active: DB.getAll(), trash: TRASH.getAll() }
      });
    });

    this.conn.on('data', (payload) => {
      if (payload.type === 'sync') {
        const added = this.mergeData(payload.data);
        document.getElementById('sync-status').innerHTML =
          `¡Sincronización Exitosa!<br>Se añadieron ${added} movimientos nuevos.`;
        app.toast('¡Sincronización completada!');

        // Guest sends its (now merged) data back to host
        if (document.getElementById('sync-my-code').textContent === '—') {
          this.conn.send({
            type: 'sync_ack',
            data: { active: DB.getAll(), trash: TRASH.getAll() }
          });
        }

        setTimeout(() => app.navigate('dashboard'), 3500);
      } else if (payload.type === 'sync_ack') {
        const added = this.mergeData(payload.data);
        document.getElementById('sync-status').innerHTML =
          `¡Sincronización Exitosa!<br>Se añadieron ${added} movimientos nuevos.`;
        app.toast('¡Sincronización completada!');
        setTimeout(() => app.navigate('dashboard'), 3500);
      }
    });

    this.conn.on('close', () => {
      app.toast('Desconectado');
      this.reset();
    });
  },

  // Merges incoming active + trash data.
  // Strategy: "delete wins" — if an item is in trash on either device, it goes to trash on both.
  mergeData(payload) {
    // Backward compatibility: old sync format sent an array directly
    const incomingActive = Array.isArray(payload) ? payload : (payload.active || []);
    const incomingTrash  = Array.isArray(payload) ? []    : (payload.trash  || []);

    // 1. Merge incoming trash into local trash
    TRASH.merge(incomingTrash);

    // 2. Build the full set of trashed IDs (local + just-merged incoming)
    const allTrashIds = new Set(TRASH.getAll().map(t => t.id));

    // 3. Apply "delete wins": remove from local active any item now in trash
    let currentActive = DB._get();
    const toEvict = currentActive.filter(tx => allTrashIds.has(tx.id));
    if (toEvict.length > 0) {
      currentActive = currentActive.filter(tx => !allTrashIds.has(tx.id));
      DB._save(currentActive);
    }

    // 4. Add or update incoming active items
    const existingMap = new Map(currentActive.map(t => [t.id, t]));
    let added = 0;
    let updated = 0;

    incomingActive.forEach(tx => {
      if (allTrashIds.has(tx.id)) return; // Skip if in trash
      
      if (!existingMap.has(tx.id)) {
        currentActive.push(tx);
        existingMap.set(tx.id, tx);
        added++;
      } else {
        // Edit logic (overwrite if incoming is newer by revision number)
        const local = existingMap.get(tx.id);
        const incomingRev = tx.rev || 1;
        const localRev = local.rev || 1;
        if (incomingRev > localRev) {
          Object.assign(local, tx);
          updated++;
        }
      }
    });
    if (added > 0 || updated > 0) DB._save(currentActive);

    return added;
  },

  reset() {
    if (this.peer) { this.peer.destroy(); this.peer = null; }
    this.conn = null;
    const setupEl = document.getElementById('sync-setup');
    const activeEl = document.getElementById('sync-active');
    if (setupEl) setupEl.classList.remove('hidden');
    if (activeEl) activeEl.classList.add('hidden');
    const inputEl = document.getElementById('sync-code-input');
    if (inputEl) inputEl.value = '';
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
