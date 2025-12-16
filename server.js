const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Serve static files from current directory
app.use(express.static(__dirname));

// Serve the game
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== MULTIPLAYER INFRASTRUCTURE (Ready for v2) =====

// Store active games and players
const games = new Map();
const players = new Map();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  // Player joins matchmaking
  socket.on('find-match', (playerData) => {
    players.set(socket.id, {
      id: socket.id,
      name: playerData.name || 'Commander',
      status: 'searching'
    });
    
    // Find another player searching
    const waitingPlayer = [...players.values()].find(
      p => p.status === 'searching' && p.id !== socket.id
    );
    
    if (waitingPlayer) {
      // Create a game
      const gameId = `game_${Date.now()}`;
      const game = {
        id: gameId,
        players: [waitingPlayer.id, socket.id],
        state: 'starting',
        scores: { [waitingPlayer.id]: 0, [socket.id]: 0 }
      };
      
      games.set(gameId, game);
      players.get(waitingPlayer.id).status = 'playing';
      players.get(socket.id).status = 'playing';
      
      // Notify both players
      io.to(waitingPlayer.id).emit('match-found', { gameId, opponent: players.get(socket.id).name, side: 'left' });
      io.to(socket.id).emit('match-found', { gameId, opponent: players.get(waitingPlayer.id).name, side: 'right' });
      
      console.log(`Game ${gameId} started: ${waitingPlayer.id} vs ${socket.id}`);
    } else {
      socket.emit('waiting-for-opponent');
    }
  });
  
  // Player sends their game state update
  socket.on('game-update', (data) => {
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      // Broadcast to opponent
      const opponentId = game.players.find(p => p !== socket.id);
      if (opponentId) {
        io.to(opponentId).emit('opponent-update', data);
      }
    }
  });
  
  // Player deploys a unit (sends pressure to opponent)
  socket.on('deploy-unit', (data) => {
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      const opponentId = game.players.find(p => p !== socket.id);
      if (opponentId) {
        // Send enemy to opponent's side
        io.to(opponentId).emit('incoming-enemy', data);
      }
    }
  });
  
  // Player answers correctly - can trigger effects
  socket.on('correct-answer', (data) => {
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      game.scores[socket.id] = (game.scores[socket.id] || 0) + data.points;
      
      // Broadcast updated scores
      game.players.forEach(playerId => {
        io.to(playerId).emit('score-update', game.scores);
      });
    }
  });
  
  // Game over
  socket.on('game-over', (data) => {
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      const opponentId = game.players.find(p => p !== socket.id);
      if (opponentId) {
        io.to(opponentId).emit('opponent-defeated', { winner: socket.id });
      }
      
      // Cleanup
      game.players.forEach(playerId => {
        if (players.has(playerId)) {
          players.get(playerId).status = 'idle';
        }
      });
      games.delete(game.id);
    }
  });
  
  // Cancel matchmaking
  socket.on('cancel-search', () => {
    if (players.has(socket.id)) {
      players.get(socket.id).status = 'idle';
    }
  });
  
  // Disconnect handling
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Notify opponent if in a game
    const game = [...games.values()].find(g => g.players.includes(socket.id));
    if (game) {
      const opponentId = game.players.find(p => p !== socket.id);
      if (opponentId) {
        io.to(opponentId).emit('opponent-disconnected');
      }
      games.delete(game.id);
    }
    
    players.delete(socket.id);
  });
});

// ===== START SERVER =====

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║           CALCULATED RISK - SERVER ONLINE             ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Local:    http://localhost:${PORT}                      ║`);
  
  // Get local network IP
  const interfaces = os.networkInterfaces();
  let localIP = null;
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
    if (localIP) break;
  }
  
  if (localIP) {
    const paddedIP = `http://${localIP}:${PORT}`.padEnd(27);
    console.log(`║  Network:  ${paddedIP}║`);
    console.log('╠═══════════════════════════════════════════════════════╣');
    console.log('║  Share the Network URL with your son\'s phone!         ║');
  }
  
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
});
