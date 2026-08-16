const socket = io();

// State
let categories = [];
let products = [];
let printQueue = [];
let activeCategoryId = null;

// DOM Elements
const screens = { login: document.getElementById('loginScreen'), app: document.getElementById('appScreen') };
const tabs = { pdv: document.getElementById('pdvTab'), crud: document.getElementById('crudTab') };
const navButtons = document.querySelectorAll('.nav-tab');
const connStatus = document.getElementById('connectionStatus');

// 1. LOGIN
// Check for saved login
const savedAuth = localStorage.getItem('luflex_auth');
if (savedAuth) {
  try {
    const { storeId, password } = JSON.parse(savedAuth);
    document.getElementById('loginStoreId').value = storeId;
    document.getElementById('loginPassword').value = password;
    doLogin(storeId, password);
  } catch (e) {}
}

document.getElementById('btnLogin').addEventListener('click', () => {
  const storeId = document.getElementById('loginStoreId').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const errorEl = document.getElementById('loginError');
  
  if (!storeId || !password) {
    errorEl.textContent = 'Preencha todos os campos';
    return;
  }
  
  doLogin(storeId, password);
});

function doLogin(storeId, password) {
  const errorEl = document.getElementById('loginError');
  document.getElementById('btnLogin').textContent = 'Conectando...';
  document.getElementById('btnLogin').disabled = true;
  
  socket.emit('mobile-login', { storeId, password }, (res) => {
    document.getElementById('btnLogin').textContent = 'Acessar';
    document.getElementById('btnLogin').disabled = false;
    
    if (res.success) {
      localStorage.setItem('luflex_auth', JSON.stringify({ storeId, password }));
      categories = res.categories;
      products = res.products;
      screens.login.classList.remove('active');
      screens.app.classList.add('active');
      updateUI();
    } else {
      localStorage.removeItem('luflex_auth');
      errorEl.textContent = res.error;
      screens.app.classList.remove('active');
      screens.login.classList.add('active');
    }
  });
}

document.getElementById('btnLogout').addEventListener('click', () => {
  localStorage.removeItem('luflex_auth');
  location.reload();
});

// 2. SOCKET EVENTS
socket.on('sync-data', (data) => {
  categories = data.categories;
  products = data.products;
  updateUI();
  showToast('Dados sincronizados');
});

socket.on('store-offline', () => {
  connStatus.textContent = 'Loja Offline (Computador desconectado)';
  connStatus.classList.add('offline');
});
socket.on('disconnect', () => {
  connStatus.textContent = 'Sem conexão com o servidor';
  connStatus.classList.add('offline');
});
socket.on('connect', () => {
  if (screens.app.classList.contains('active')) {
    connStatus.textContent = 'Conectado';
    connStatus.classList.remove('offline');
    // Try to re-login silently
    const storeId = document.getElementById('loginStoreId').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    socket.emit('mobile-login', { storeId, password }, () => {});
  }
});

// 3. NAVIGATION
navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    navButtons.forEach(b => b.classList.remove('active'));
    Object.values(tabs).forEach(t => t.classList.remove('active'));
    
    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');
  });
});

// 4. UI RENDERING
function updateUI() {
  renderCategories();
  renderProducts();
  renderCrudProducts();
  populateCategorySelect();
  
  const modal = document.getElementById('productModal');
  if (modal && modal.classList.contains('active')) {
    const editId = document.getElementById('editProductId').value;
    if (editId) {
      const p = products.find(prod => prod.id === editId);
      if (p) document.getElementById('prodCategory').value = p.categoryId;
    }
  }
  
  const catModal = document.getElementById('categoryModal');
  if (catModal && catModal.classList.contains('active')) {
    renderCategoryList();
  }
}

function renderCategories() {
  const container = document.getElementById('mobileCategories');
  container.innerHTML = `<button class="cat-pill ${activeCategoryId === null ? 'active' : ''}" data-id="all">Todos</button>`;
  
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `cat-pill ${activeCategoryId === cat.id ? 'active' : ''}`;
    btn.textContent = cat.name;
    btn.dataset.id = cat.id;
    container.appendChild(btn);
  });

  container.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategoryId = btn.dataset.id === 'all' ? null : btn.dataset.id;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  const container = document.getElementById('mobileProducts');
  container.innerHTML = '';
  
  const filtered = activeCategoryId ? products.filter(p => p.categoryId === activeCategoryId) : products;
  
  if(filtered.length === 0) {
    container.innerHTML = '<p class="subtitle" style="text-align:center;margin-top:20px;">Nenhum produto</p>';
    return;
  }

  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'prod-card';
    
    let badgeClass = p.refrigerationType === 'CONGELADO' ? 'badge-frozen' : (p.refrigerationType === 'REFRIGERADO' ? 'badge-refrig' : 'badge-ambient');
    
    card.innerHTML = `
      <div class="prod-info">
        <h4>${p.name}</h4>
        <div class="prod-meta">
          <span class="badge ${badgeClass}">${p.refrigerationType || 'AMBIENTE'}</span>
          <span>Val: ${p.validityDays}d</span>
        </div>
      </div>
      <div class="prod-action"><button class="btn btn-sm btn-secondary">+</button></div>
    `;
    
    card.addEventListener('click', () => addToQueue(p));
    container.appendChild(card);
  });
}

function renderCrudProducts() {
  const container = document.getElementById('mobileCrudProducts');
  container.innerHTML = '';
  
  products.forEach(p => {
    const card = document.createElement('div');
    card.className = 'prod-card';
    card.innerHTML = `
      <div class="prod-info"><h4>${p.name}</h4><div class="prod-meta"><span>${p.code || ''}</span></div></div>
      <div class="prod-action">
        <button class="btn-icon" data-action="edit" style="color:var(--primary); margin-right:8px;">✏️</button>
        <button class="btn-icon" data-action="del" style="color:var(--danger);">🗑️</button>
      </div>
    `;
    
    card.querySelector('[data-action="edit"]').addEventListener('click', (e) => { e.stopPropagation(); openModal(p); });
    card.querySelector('[data-action="del"]').addEventListener('click', (e) => { 
      e.stopPropagation(); 
      if(confirm('Excluir este produto?')) socket.emit('remote-delete-product', p.id);
    });
    
    container.appendChild(card);
  });
}

// 5. QUEUE LOGIC
const queuePanel = document.getElementById('queuePanel');
document.getElementById('queueHeader').addEventListener('click', () => {
  if (printQueue.length > 0) queuePanel.classList.toggle('expanded');
});

function addToQueue(product) {
  const existing = printQueue.find(i => i.product.id === product.id);
  if (existing) existing.quantity++;
  else printQueue.push({ product, quantity: 1 });
  
  updateQueueUI();
  showToast(`${product.name} adicionado`);
}

function updateQueue(productId, delta) {
  const item = printQueue.find(i => i.product.id === productId);
  if (item) {
    item.quantity += delta;
    if (item.quantity <= 0) printQueue = printQueue.filter(i => i.product.id !== productId);
    updateQueueUI();
  }
}

function updateQueueUI() {
  const count = printQueue.reduce((acc, item) => acc + item.quantity, 0);
  document.getElementById('queueCount').textContent = `${count} etiquetas na fila`;
  
  const btnPrint = document.getElementById('btnMobilePrint');
  btnPrint.textContent = `🖨️ IMPRIMIR ${count > 0 ? `(${count})` : ''}`;
  btnPrint.disabled = count === 0;

  const body = document.getElementById('queueBody');
  body.innerHTML = '';
  
  if (count === 0) {
    queuePanel.classList.remove('expanded');
    return;
  }

  printQueue.forEach(item => {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.innerHTML = `
      <div><strong>${item.product.name}</strong></div>
      <div class="qty-controls">
        <button onclick="updateQueue('${item.product.id}', -1)">−</button>
        <span>${item.quantity}</span>
        <button onclick="updateQueue('${item.product.id}', 1)">+</button>
      </div>
    `;
    body.appendChild(div);
  });
}

document.getElementById('btnMobilePrint').addEventListener('click', () => {
  if (printQueue.length === 0) return;
  
  const labels = printQueue.map(item => ({
    name: item.product.name,
    refrigerationType: item.product.refrigerationType,
    validityDays: item.product.validityDays,
    code: item.product.code,
    quantity: item.quantity
  }));
  
  socket.emit('mobile-print', labels);
  printQueue = [];
  updateQueueUI();
  queuePanel.classList.remove('expanded');
  showToast('Impressão enviada para a loja!');
});

// 6. CRUD MODAL
const modal = document.getElementById('productModal');
document.getElementById('btnNewProduct').addEventListener('click', () => openModal());
document.getElementById('btnCloseModal').addEventListener('click', () => modal.classList.remove('active'));

function populateCategorySelect() {
  const select = document.getElementById('prodCategory');
  select.innerHTML = '<option value="">Selecione...</option>';
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

function openModal(product = null) {
  populateCategorySelect();
  if (product) {
    document.getElementById('modalTitle').textContent = 'Editar Produto';
    document.getElementById('editProductId').value = product.id;
    document.getElementById('prodName').value = product.name;
    document.getElementById('prodCode').value = product.code || '';
    document.getElementById('prodCategory').value = product.categoryId;
    document.getElementById('prodRefrigeration').value = product.refrigerationType;
    document.getElementById('prodValidity').value = product.validityDays;
  } else {
    document.getElementById('modalTitle').textContent = 'Novo Produto';
    document.getElementById('editProductId').value = '';
    document.getElementById('prodName').value = '';
    document.getElementById('prodCode').value = '';
    document.getElementById('prodCategory').value = '';
    document.getElementById('prodRefrigeration').value = 'AMBIENTE';
    document.getElementById('prodValidity').value = '';
  }
  modal.classList.add('active');
}

document.getElementById('btnSaveProduct').addEventListener('click', () => {
  const id = document.getElementById('editProductId').value;
  const name = document.getElementById('prodName').value.trim();
  const categoryId = document.getElementById('prodCategory').value;
  const refrigerationType = document.getElementById('prodRefrigeration').value;
  const validityDays = parseInt(document.getElementById('prodValidity').value);
  let code = document.getElementById('prodCode').value.trim().toUpperCase();
  
  if (!name || !categoryId || !validityDays) {
    showToast('Preencha todos os campos!');
    return;
  }

  // Generate generic code on mobile since we don't have the main process logic here
  // The local app can re-generate it if needed, or we just generate a basic one
  if (!code) {
    code = name.split(' ').map(w => w[0]).join('').substring(0,3).toUpperCase();
  }
  
  const productData = { name, categoryId, refrigerationType, validityDays, code };
  
  if (id) {
    socket.emit('remote-update-product', { id, data: productData });
  } else {
    socket.emit('remote-create-product', productData);
  }
  
  modal.classList.remove('active');
  showToast('Enviado para sincronização...');
});

// 7. CATEGORY MODAL
const catModal = document.getElementById('categoryModal');
document.getElementById('btnManageCategories').addEventListener('click', (e) => {
  e.preventDefault();
  renderCategoryList();
  catModal.classList.add('active');
});
document.getElementById('btnCloseCatModal').addEventListener('click', () => catModal.classList.remove('active'));

document.getElementById('btnAddCategory').addEventListener('click', () => {
  const name = document.getElementById('newCatName').value.trim();
  if (name) {
    socket.emit('remote-create-category', name);
    document.getElementById('newCatName').value = '';
    showToast('Adicionando...');
  }
});

function renderCategoryList() {
  const container = document.getElementById('catList');
  container.innerHTML = '';
  categories.forEach(c => {
    const card = document.createElement('div');
    card.className = 'queue-item';
    card.innerHTML = `
      <div><strong>${c.name}</strong></div>
      <div>
        <button class="btn-icon" data-action="edit" style="color:var(--primary); margin-right:8px;">✏️</button>
        <button class="btn-icon" data-action="del" style="color:var(--danger);">🗑️</button>
      </div>
    `;
    card.querySelector('[data-action="edit"]').addEventListener('click', () => {
      const newName = prompt('Editar categoria:', c.name);
      if (newName && newName.trim()) {
        socket.emit('remote-update-category', { id: c.id, name: newName.trim() });
        showToast('Atualizando...');
      }
    });
    card.querySelector('[data-action="del"]').addEventListener('click', () => {
      if (confirm(`Excluir a categoria "${c.name}"?`)) {
        socket.emit('remote-delete-category', c.id);
        showToast('Excluindo...');
      }
    });
    container.appendChild(card);
  });
}

// TOAST
function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  container.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
