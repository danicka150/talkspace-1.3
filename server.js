const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройка Socket.IO для Render
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Serve index.html for all routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// База данных в памяти
const users = new Map();
const friendRequests = new Map();
const friendships = new Map();
const privateMessages = new Map();

// Генератор аватаров
const avatars = ['😀', '😎', '🤠', '😍', '🥳', '🤩', '😊', '🐱', '🐶', '🦊'];
function getRandomAvatar() {
  return avatars[Math.floor(Math.random() * avatars.length)];
}

// Вспомогательные функции
function getFriends(username) {
  const userFriends = friendships.get(username) || new Set();
  return Array.from(userFriends).map(friendUsername => {
    const user = users.get(friendUsername);
    return user ? {
      username: user.username,
      avatar: user.avatar,
      online: user.online || false
    } : null;
  }).filter(friend => friend !== null);
}

function getFriendRequests(username) {
  return friendRequests.get(username) || [];
}

function savePrivateMessage(from, to, text) {
  const chatKey = [from, to].sort().join('_');
  if (!privateMessages.has(chatKey)) {
    privateMessages.set(chatKey, []);
  }
  
  const message = {
    from,
    fromAvatar: users.get(from)?.avatar || '😎',
    to,
    text,
    time: new Date().toLocaleTimeString(),
    timestamp: Date.now()
  };
  
  privateMessages.get(chatKey).push(message);
  return message;
}

function getChatHistory(user1, user2) {
  const chatKey = [user1, user2].sort().join('_');
  return privateMessages.get(chatKey) || [];
}

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log('✅ Новый пользователь подключен:', socket.id);

  // Регистрация
  socket.on('register', (data) => {
    const { username, password } = data;
    
    if (users.has(username)) {
      socket.emit('register_error', 'Пользователь уже существует');
      return;
    }

    if (username.length < 3) {
      socket.emit('register_error', 'Имя пользователя должно быть не менее 3 символов');
      return;
    }

    const user = {
      id: socket.id,
      username: username,
      avatar: getRandomAvatar(),
      online: true,
      friends: new Set()
    };

    users.set(username, user);
    friendships.set(username, new Set());
    friendRequests.set(username, []);
    socket.user = user;

    socket.emit('register_success', { 
      user: {
        username: user.username,
        avatar: user.avatar
      } 
    });
    
    console.log('📝 Новый пользователь:', username);
  });

  // Логин
  socket.on('login', (data) => {
    const { username, password } = data;
    let user = users.get(username);

    if (!user) {
      // Авто-регистрация если пользователь не существует
      user = {
        id: socket.id,
        username: username,
        avatar: getRandomAvatar(),
        online: true
      };
      users.set(username, user);
      friendships.set(username, new Set());
      friendRequests.set(username, []);
    }

    user.id = socket.id;
    user.online = true;
    socket.user = user;

    socket.emit('login_success', { 
      user: {
        username: user.username,
        avatar: user.avatar
      },
      friends: getFriends(username),
      friendRequests: getFriendRequests(username)
    });
    
    console.log('🔐 Пользователь вошел:', username);
  });

  // Поиск пользователей
  socket.on('search_users', (query) => {
    if (!socket.user) return;
const results = Array.from(users.values())
      .filter(user => 
        user.username.toLowerCase().includes(query.toLowerCase()) &&
        user.username !== socket.user.username &&
        !friendships.get(socket.user.username)?.has(user.username)
      )
      .slice(0, 10)
      .map(user => ({
        username: user.username,
        avatar: user.avatar,
        online: user.online
      }));

    socket.emit('search_results', results);
  });

  // Отправка запроса в друзья
  socket.on('send_friend_request', (targetUsername) => {
    if (!socket.user) return;
    
    const targetUser = users.get(targetUsername);
    if (!targetUser) {
      socket.emit('error', 'Пользователь не найден');
      return;
    }

    if (friendships.get(socket.user.username)?.has(targetUsername)) {
      socket.emit('error', 'Этот пользователь уже у вас в друзьях');
      return;
    }

    // Добавляем запрос в друзья
    if (!friendRequests.has(targetUsername)) {
      friendRequests.set(targetUsername, []);
    }
    
    const requests = friendRequests.get(targetUsername);
    if (!requests.find(req => req.from === socket.user.username)) {
      requests.push({
        from: socket.user.username,
        fromAvatar: socket.user.avatar,
        timestamp: Date.now()
      });
    }

    // Уведомляем получателя
    const targetSocket = io.sockets.sockets.get(targetUser.id);
    if (targetSocket) {
      targetSocket.emit('new_friend_request', {
        from: socket.user.username,
        fromAvatar: socket.user.avatar
      });
    }

    socket.emit('friend_request_sent', targetUsername);
    console.log('👥 Запрос в друзья:', socket.user.username, '->', targetUsername);
  });

  // Принятие запроса в друзья
  socket.on('accept_friend_request', (fromUsername) => {
    if (!socket.user) return;

    // Добавляем в друзья
    if (!friendships.has(socket.user.username)) {
      friendships.set(socket.user.username, new Set());
    }
    if (!friendships.has(fromUsername)) {
      friendships.set(fromUsername, new Set());
    }

    friendships.get(socket.user.username).add(fromUsername);
    friendships.get(fromUsername).add(socket.user.username);

    // Удаляем запрос
    const requests = friendRequests.get(socket.user.username) || [];
    const updatedRequests = requests.filter(req => req.from !== fromUsername);
    friendRequests.set(socket.user.username, updatedRequests);

    // Уведомляем обоих пользователей
    socket.emit('friend_added', {
      username: fromUsername,
      avatar: users.get(fromUsername)?.avatar || '😎',
      online: users.get(fromUsername)?.online || false
    });

    const fromUser = users.get(fromUsername);
    if (fromUser && fromUser.id) {
      const fromSocket = io.sockets.sockets.get(fromUser.id);
      if (fromSocket) {
        fromSocket.emit('friend_added', {
          username: socket.user.username,
          avatar: socket.user.avatar,
          online: true
        });
      }
    }

    // Обновляем списки друзей
    socket.emit('update_friends', getFriends(socket.user.username));
    console.log('✅ Друзья добавлены:', socket.user.username, 'и', fromUsername);
  });

  // Загрузка истории чата
  socket.on('load_chat_history', (friendUsername) => {
    if (!socket.user) return;
    
    const history = getChatHistory(socket.user.username, friendUsername);
    socket.emit('chat_history', {
      friend: friendUsername,
      messages: history
    });
  });

  // Приватное сообщение
  socket.on('private_message', (data) => {
    if (!socket.user) return;
    
    const { to, text } = data;
    const targetUser = users.get(to);
    
    if (!targetUser) {
      socket.emit('error', 'Пользователь не найден');
      return;
    }

    const message = savePrivateMessage(socket.user.username, to, text);

    // Отправляем получателю
    if (targetUser.online && targetUser.id) {
      const targetSocket = io.sockets.sockets.get(targetUser.id);
      if (targetSocket) {
        targetSocket.emit('new_private_message', message);
      }
    }
// Отправляем обратно отправителю
    socket.emit('new_private_message', message);
    console.log('💬 Приватное сообщение:', socket.user.username, '->', to, text);
  });

  // Глобальное сообщение
  socket.on('global_message', (text) => {
    if (!socket.user) return;

    const message = {
      from: socket.user.username,
      fromAvatar: socket.user.avatar,
      text: text,
      time: new Date().toLocaleTimeString(),
      timestamp: Date.now()
    };

    io.emit('new_global_message', message);
    console.log('🌍 Глобальное сообщение:', socket.user.username, text);
  });

  // Отключение
  socket.on('disconnect', () => {
    if (socket.user) {
      const user = users.get(socket.user.username);
      if (user) {
        user.online = false;
        user.id = null;
      }
      console.log('❌ Пользователь отключился:', socket.user.username);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(🚀 Сервер запущен на порту ${PORT});
  console.log(📱 Откройте http://localhost:${PORT} в браузере);
});
