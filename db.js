// === MisFinanzas Database Module ===
const ICON_OPTIONS = [
  '💰','💼','📈','🛒','🎁','💵','🍔','🚗','🏠','⚡','🏥','🎭','📚','👕','📱','💳',
  '🎯','🏋️','✈️','🎵','🐾','👶','💊','🔧','📦','🎮','☕','🍕','🚌','⛽','📝','🛍️',
  '💡','🔑','🏦','📊','🎓','🌐','🛠️','🎪','💎','🏖️','🍷','🚀','📌','🧾','💸','🏢'
];

// ============================================================
// USER IDENTITY — Who is this device's owner?
// ============================================================
const UserIdentity = {
  KEY: 'mf_identity',

  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); }
    catch { return null; }
  },

  set(name) {
    localStorage.setItem(this.KEY, JSON.stringify({
      name: name.trim(),
      createdAt: new Date().toISOString()
    }));
  },

  getName() {
    const id = this.get();
    return id ? id.name : null;
  },

  // Returns true if this device's user is the author of the given transaction
  isOwner(tx) {
    const me = this.getName();
    return !!me && !!tx && tx.author === me;
  }
};

// ============================================================
// TRASH — Soft-delete recycle bin (auto-cleans after 60 days)
// ============================================================
const TRASH = {
  KEY: 'mf_trash',
  CLEANUP_DAYS: 60,

  _get() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; } },
  _save(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); },

  // Move a transaction to the bin
  add(tx) {
    const d = this._get();
    if (d.find(t => t.id === tx.id)) return; // already in trash
    d.unshift({ ...tx, deletedAt: new Date().toISOString() });
    this._save(d);
  },

  // All trash items, newest first
  getAll() {
    return this._get().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  },

  getById(id) { return this._get().find(t => t.id === id); },

  // Remove from trash and return the clean transaction object
  restore(id) {
    const d = this._get();
    const item = d.find(t => t.id === id);
    if (!item) return null;
    this._save(d.filter(t => t.id !== id));
    const { deletedAt, ...tx } = item;
    return tx;
  },

  permanentDelete(id) {
    this._save(this._get().filter(t => t.id !== id));
  },

  // Remove all items older than CLEANUP_DAYS. Returns count removed.
  cleanup() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.CLEANUP_DAYS);
    const before = this._get();
    const after = before.filter(t => new Date(t.deletedAt) > cutoff);
    const removed = before.length - after.length;
    if (removed > 0) this._save(after);
    return removed;
  },

  // Days remaining before an item is auto-deleted
  daysLeft(item) {
    const expiry = new Date(item.deletedAt);
    expiry.setDate(expiry.getDate() + this.CLEANUP_DAYS);
    const diff = Math.ceil((expiry - Date.now()) / 86400000);
    return Math.max(0, diff);
  },

  // Merge incoming trash items from sync (skips duplicates by id)
  merge(incoming) {
    if (!Array.isArray(incoming) || incoming.length === 0) return 0;
    const current = this._get();
    const existingIds = new Set(current.map(t => t.id));
    let added = 0;
    incoming.forEach(tx => {
      if (!existingIds.has(tx.id)) { current.push(tx); added++; }
    });
    if (added > 0) this._save(current);
    return added;
  }
};

// ============================================================
// CATEGORIES
// ============================================================
const DEFAULT_CATEGORIES = {
  income: [
    {id:'salario',icon:'💰',name:'Salario'},{id:'freelance',icon:'💼',name:'Freelance'},
    {id:'inversiones',icon:'📈',name:'Inversiones'},{id:'ventas',icon:'🛒',name:'Ventas'},
    {id:'regalo',icon:'🎁',name:'Regalo'},{id:'otros_ing',icon:'💵',name:'Otros'}
  ],
  expense: [
    {id:'comida',icon:'🍔',name:'Comida'},{id:'transporte',icon:'🚗',name:'Transporte'},
    {id:'vivienda',icon:'🏠',name:'Vivienda'},{id:'servicios',icon:'⚡',name:'Servicios'},
    {id:'salud',icon:'🏥',name:'Salud'},{id:'entretenimiento',icon:'🎭',name:'Ocio'},
    {id:'educacion',icon:'📚',name:'Educación'},{id:'ropa',icon:'👕',name:'Ropa'},
    {id:'tecnologia',icon:'📱',name:'Tecnología'},{id:'otros_gas',icon:'💳',name:'Otros'}
  ]
};

const CATEGORIES = {
  _customKey: 'mf_custom_categories',
  _getCustom() { try { return JSON.parse(localStorage.getItem(this._customKey)) || {income:[],expense:[]}; } catch { return {income:[],expense:[]}; } },
  _saveCustom(d) { localStorage.setItem(this._customKey, JSON.stringify(d)); },
  get income() { return [...DEFAULT_CATEGORIES.income, ...this._getCustom().income]; },
  get expense() { return [...DEFAULT_CATEGORIES.expense, ...this._getCustom().expense]; },
  addCustom(type, name, icon) {
    const d = this._getCustom();
    const id = 'custom_' + Date.now().toString(36);
    d[type].push({id, icon, name, custom: true});
    this._saveCustom(d);
    return id;
  },
  removeCustom(type, id) {
    const d = this._getCustom();
    d[type] = d[type].filter(c => c.id !== id);
    this._saveCustom(d);
  }
};

// ============================================================
// DB — Active transactions
// ============================================================
const DB = {
  KEY: 'mf_transactions',
  _get() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; } },
  _save(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); },
  getAll() { return this._get().sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)); },
  add(tx) { const d = this._get(); tx.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6); tx.createdAt = new Date().toISOString(); tx.rev = 1; d.push(tx); this._save(d); return tx; },
  update(id, data) { const d = this._get(); const i = d.findIndex(t=>t.id===id); if(i>=0){Object.assign(d[i],data); d[i].rev = (d[i].rev || 1) + 1; this._save(d);} },
  remove(id) { this._save(this._get().filter(t=>t.id!==id)); },
  getById(id) { return this._get().find(t=>t.id===id); },
  getByMonth(y,m) { const prefix=`${y}-${String(m+1).padStart(2,'0')}`; return this.getAll().filter(t=>t.date.startsWith(prefix)); },
  getByRange(from,to) { return this.getAll().filter(t=>t.date>=from && t.date<=to); },
  getMonthlyTotals(months) {
    const result = [];
    const now = new Date();
    for(let i=months-1; i>=0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const txs = this.getByMonth(d.getFullYear(), d.getMonth());
      let inc=0, exp=0;
      txs.forEach(t => { if(t.type==='income') inc+=t.amount; else exp+=t.amount; });
      result.push({ year:d.getFullYear(), month:d.getMonth(), income:inc, expense:exp, net:inc-exp,
        label: d.toLocaleDateString('es',{month:'short',year:'2-digit'}) });
    }
    return result;
  },
  getCategoryTotals(y,m,type) {
    const txs = this.getByMonth(y,m).filter(t=>t.type===type);
    const map = {};
    txs.forEach(t => { map[t.category] = (map[t.category]||0) + t.amount; });
    return Object.entries(map).map(([cat,amount]) => {
      const c = CATEGORIES[type].find(x=>x.id===cat) || {icon:'❓',name:cat};
      return { id:cat, name:c.name, icon:c.icon, amount };
    }).sort((a,b) => b.amount - a.amount);
  }
};

// ============================================================
// FORECAST
// ============================================================
const Forecast = {
  calculate(targetDate) {
    const totals = DB.getMonthlyTotals(12).filter(m => m.income>0 || m.expense>0);
    if(totals.length === 0) return null;
    const now = new Date();
    const target = new Date(targetDate);
    const monthsDiff = (target.getFullYear()-now.getFullYear())*12 + (target.getMonth()-now.getMonth());
    if(monthsDiff <= 0) return null;

    let wInc=0, wExp=0, wSum=0;
    let bestNet = -Infinity, worstNet = Infinity;
    totals.forEach((m,i) => {
      const w = i+1;
      wInc += m.income*w; wExp += m.expense*w; wSum += w;
      const net = m.income - m.expense;
      if(net > bestNet) bestNet = net;
      if(net < worstNet) worstNet = net;
    });
    const avgInc = wInc/wSum, avgExp = wExp/wSum, avgNet = avgInc - avgExp;

    const allTx = DB.getAll();
    let balance = 0;
    allTx.forEach(t => { balance += t.type==='income' ? t.amount : -t.amount; });

    return {
      currentBalance: balance,
      monthsAhead: monthsDiff,
      monthsAnalyzed: totals.length,
      avgIncome: avgInc, avgExpense: avgExp, avgNet,
      optimistic: balance + bestNet * monthsDiff,
      realistic: balance + avgNet * monthsDiff,
      pessimistic: balance + worstNet * monthsDiff,
      projection: Array.from({length: monthsDiff+1}, (_,i) => ({
        month: i, realistic: balance + avgNet*i, optimistic: balance + bestNet*i, pessimistic: balance + worstNet*i
      }))
    };
  }
};
