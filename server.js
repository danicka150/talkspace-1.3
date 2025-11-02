import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('.'));

let users = [];
let messages = [];
let friendRequests = [];

const avatars = ["😁", "🐈", "🥰", "😎", "😈", "😥", "😧", "🤴"];

app.get('/', (req, res) => {
    res.sendFile('index.html', { root: '.' });
});

io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    socket.on('register', (data) => {
        if (users.find(u => u.username === data.username)) {
            socket.emit('register_error', 'Имя занято');
            return;
        }

        const user = {
            id: socket.id,
            username: data.username,
            password: data.password,
            avatar: avatars[Math.floor(Math.random() * avatars.length)],
            friends: [],
            online: true
        };

        users.push(user);
        socket.emit('register_success', { user });
    });

    socket.on('login', (data) => {
        const user = users.find(u => u.username === data.username && u.password === data.password);
        if (!user) {
            socket.emit('login_error', 'Неверные данные');
            return;
        }

        user.online = true;
        user.id = socket.id;

        const friends = users.filter(u => user.friends.includes(u.username));
        const requests = friendRequests.filter(req => req.to === user.username);

        socket.emit('login_success', { 
            user: {
                id: user.id,
                username: user.username,
                avatar: user.avatar,
                friends: user.friends
            }, 
            friends: friends,
            requests: requests 
        });
    });

    socket.on('search_users', (query) => {
        const currentUser = users.find(u => u.id === socket.id);
        const results = users.filter(u => 
            u.username !== currentUser?.username &&
            !currentUser?.friends.includes(u.username) &&
            u.username.toLowerCase().includes(query.toLowerCase())
        );
        socket.emit('search_results', results);
    });

    socket.on('send_friend_request', (targetUsername) => {
        const currentUser = users.find(u => u.id === socket.id);
        
        friendRequests.push({
            from: currentUser.username,
            to: targetUsername,
            fromAvatar: currentUser.avatar
        });

        socket.emit('friend_request_sent');
    });

    socket.on('accept_friend_request', (fromUsername) => {
        const currentUser = users.find(u => u.id === socket.id);
        const fromUser = users.find(u => u.username === fromUsername);

        if (currentUser && fromUser) {
            currentUser.friends.push(fromUsername);
            fromUser.friends.push(currentUser.username);
            
            friendRequests = friendRequests.filter(req => 
                !(req.from === fromUsername && req.to === currentUser.username)
            );

            socket.emit('friend_added', fromUser);
        }
    });

    socket.on('private_message', (data) => {
        const currentUser = users.find(u => u.id === socket.id);
        const targetUser = users.find(u => u.username === data.to);

        const message = {
            from: currentUser.username,
            fromAvatar: currentUser.avatar,
            to: data.to,
            text: data.text,
            time: new Date().toLocaleTimeString()
        };

        messages.push(message);
        
        // Отправляем сообщение обоим пользователям
        socket.emit('new_private_message', message);
        
        // Ищем сокет получателя
        const targetSocket = Object.values(io.sockets.sockets).find(s => {
const targetUser = users.find(u => u.username === data.to);
            return targetUser && targetUser.id === s.id;
        });
        
        if (targetSocket) {
            targetSocket.emit('new_private_message', message);
        }
    });

    socket.on('global_message', (text) => {
        const currentUser = users.find(u => u.id === socket.id);
        const message = {
            from: currentUser.username,
            fromAvatar: currentUser.avatar,
            text: text,
            time: new Date().toLocaleTimeString()
        };

        io.emit('new_global_message', message);
    });

    socket.on('load_chat_history', (friendUsername) => {
        const currentUser = users.find(u => u.id === socket.id);
        const chatMessages = messages.filter(m => 
            (m.from === currentUser.username && m.to === friendUsername) ||
            (m.from === friendUsername && m.to === currentUser.username)
        );
        socket.emit('chat_history', { friendId: friendUsername, messages: chatMessages });
    });

    socket.on('disconnect', () => {
        const user = users.find(u => u.id === socket.id);
        if (user) user.online = false;
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Server running on port ' + PORT);
});
