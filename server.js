const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// In-memory state for stores
// Structure: { [storeId]: { password: "...", localAppSocketId: "...", categories: [], products: [] } }
const stores = {};

io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id}`);

  // ==========================================
  // APP LOCAL (ELECTRON) EVENTS
  // ==========================================

  // App local connects and registers the store as online
  socket.on('local-app-connect', (data, callback) => {
    const { storeId, password, categories, products, printerOnline } = data;
    
    if (!storeId || !password) {
      return callback({ success: false, error: 'Credenciais inválidas' });
    }

    // Register or update store
    stores[storeId] = {
      password: password,
      localAppSocketId: socket.id,
      categories: categories || [],
      products: products || [],
      printerOnline: !!printerOnline
    };

    // Join a room specifically for this store's mobile clients
    socket.join(`store_${storeId}`);
    
    console.log(`[Local App] Loja '${storeId}' registrada/atualizada (Socket: ${socket.id})`);
    
    // Notify any already connected mobile clients that the store is online and sync data
    socket.to(`store_${storeId}`).emit('sync-data', {
      categories: stores[storeId].categories,
      products: stores[storeId].products,
      printerOnline: stores[storeId].printerOnline
    });

    callback({ success: true });
  });

  // App local sends a sync update (e.g. after a local CRUD operation or receiving a remote CRUD operation)
  socket.on('local-app-sync', (data) => {
    const { storeId, categories, products, printerOnline } = data;
    if (stores[storeId] && stores[storeId].localAppSocketId === socket.id) {
      stores[storeId].categories = categories;
      stores[storeId].products = products;
      if (printerOnline !== undefined) stores[storeId].printerOnline = !!printerOnline;
      
      // Broadcast to mobile clients
      socket.to(`store_${storeId}`).emit('sync-data', { categories, products, printerOnline: stores[storeId].printerOnline });
    }
  });


  // ==========================================
  // MOBILE APP (WEB) EVENTS
  // ==========================================

  // Mobile app tries to login
  socket.on('mobile-login', (data, callback) => {
    const { storeId, password } = data;

    if (!stores[storeId]) {
      return callback({ success: false, error: 'Loja não encontrada ou offline. Abra o aplicativo no PC primeiro.' });
    }

    if (stores[storeId].password !== password) {
      return callback({ success: false, error: 'Senha incorreta.' });
    }

    // Join the store room to receive broadcast events
    socket.join(`store_${storeId}`);
    socket.storeId = storeId; // Save storeId in socket for later use

    console.log(`[Mobile App] Login com sucesso na loja '${storeId}' (Socket: ${socket.id})`);

    // Return the current state
    callback({
      success: true,
      categories: stores[storeId].categories,
      products: stores[storeId].products,
      printerOnline: stores[storeId].printerOnline
    });
  });

  // Mobile app requests a print job
  socket.on('mobile-print', (labels) => {
    const storeId = socket.storeId;
    if (storeId && stores[storeId]) {
      const localAppSocketId = stores[storeId].localAppSocketId;
      if (localAppSocketId) {
        io.to(localAppSocketId).emit('remote-print', labels);
        console.log(`[Print] Ordem enviada para a loja '${storeId}'`);
      }
    }
  });

  // Mobile app CRUD operations (forwarded to local app to process)
  const forwardToLocalApp = (eventName) => {
    socket.on(eventName, (data) => {
      const storeId = socket.storeId;
      if (storeId && stores[storeId]) {
        const localAppSocketId = stores[storeId].localAppSocketId;
        if (localAppSocketId) {
          io.to(localAppSocketId).emit(eventName, data);
        }
      }
    });
  };

  forwardToLocalApp('remote-create-product');
  forwardToLocalApp('remote-update-product');
  forwardToLocalApp('remote-delete-product');
  forwardToLocalApp('remote-create-category');
  forwardToLocalApp('remote-update-category');
  forwardToLocalApp('remote-delete-category');


  // ==========================================
  // DISCONNECT
  // ==========================================
  socket.on('disconnect', () => {
    // Check if the disconnected socket was a local app
    for (const [storeId, store] of Object.entries(stores)) {
      if (store.localAppSocketId === socket.id) {
        console.log(`[Local App] Loja '${storeId}' ficou offline.`);
        store.localAppSocketId = null;
        // Notify mobile clients that the store is offline
        io.to(`store_${storeId}`).emit('store-offline');
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
