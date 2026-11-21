const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// 配置
const PORT = 3000;
const STATIC_DIR = '.'; // 静态文件目录（当前目录）

// 存储所有房间和玩家
const rooms = new Map();

var maxScore = 0
const recorder = {
    score: 0,
    playerName: 'bot1',
}

// 创建HTTP服务器
const server = http.createServer((req, res) => {
    // 设置CORS头，允许跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理静态文件请求
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(STATIC_DIR, filePath);

    // 如果是HTML文件，替换WebSocket地址
    if (filePath.endsWith('.html')) {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
                return;
            }

            // 替换WebSocket连接地址
            const hostname = req.headers.host.split(':')[0];
            const wsUrl = `ws://${hostname}:${PORT}`;
            const modifiedData = data.replace(
                'YOUR_WEBSOCKET_URL',
                wsUrl
            );

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(modifiedData);
        });
    } else {
        // 其他静态文件
        const extname = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        };

        const contentType = mimeTypes[extname] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });
    }
});

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// WebSocket连接处理
wss.on('connection', (ws, req) => {
    console.log('新连接:', req.socket.remoteAddress);

    // 消息处理
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('消息解析错误:', e);
        }
    });

    // 连接关闭
    ws.on('close', () => {
        console.log('连接断开');
        handleDisconnect(ws);
    });

    // 错误处理
    ws.on('error', (error) => {
        console.error('WebSocket 错误:', error);
    });
});

// 消息处理函数
function handleMessage(ws, data) {
    switch (data.type) {
        case 'PLAYER_JOIN':
            handlePlayerJoin(ws, data);
            break;
        case 'PLAYER_LEAVE':
            handlePlayerLeave(data);
            break;
        case 'PLAYER_UPDATE':
            handlePlayerUpdate(ws, data);
            break;
        case 'PING':
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            break;
    }
}

// 处理玩家加入
function handlePlayerJoin(ws, data) {
    const { roomId, playerId, playerName } = data;

    // 创建房间（如果不存在）
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            players: new Map(),
            createdAt: Date.now()
        });
        console.log(`🚩 创建房间: ${roomId}`);
    }

    const room = rooms.get(roomId);

    // 检查房间是否已满
    if (room.players.size >= 8) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            message: '房间已满'
        }));
        return;
    }

    // 添加玩家
    room.players.set(playerId, {
        ws: ws,
        playerName: playerName,
        joinedAt: Date.now()
    });

    console.log(`📝 ${playerName} 加入房间 ${roomId} (${room.players.size}/8)`);

    // 广播给房间内其他玩家
    broadcastToRoom(roomId, {
        type: 'PLAYER_JOIN',
        roomId: roomId,
        playerId: playerId,
        playerName: playerName,
        timestamp: Date.now()
    }, playerId);

    broadcastToRoom(roomId, {
        type: 'MAX_SCORE_UPDATE',
        roomId: roomId,
        playerId: playerId,
        recorder
        // score: maxScore,
    }, playerId);

    // 发送房间内所有玩家列表给新玩家
    const playersList = Array.from(room.players.entries()).map(([pid, p]) => ({
        playerId: pid,
        playerName: p.playerName
    }));

    ws.send(JSON.stringify({
        type: 'ROOM_PLAYERS',
        roomId: roomId,
        players: playersList
    }));
}

// 处理玩家离开
function handlePlayerLeave(data) {
    const { roomId, playerId } = data;
    const room = rooms.get(roomId);

    if (room && room.players.has(playerId)) {
        room.players.delete(playerId);
        console.log(`🚪玩家离开房间 ${roomId}`);

        broadcastToRoom(roomId, {
            type: 'PLAYER_LEAVE',
            roomId: roomId,
            playerId: playerId
        });

        // 清空空房间
        if (room.players.size === 0) {
            setTimeout(() => {
                if (rooms.has(roomId) && rooms.get(roomId).players.size === 0) {
                    rooms.delete(roomId);
                    console.log(`删除空房间: ${roomId}`);
                }
            }, 60000); // 1 分钟后删除
        }
    }
}

// 处理玩家更新
function handlePlayerUpdate(ws, data) {
    const { roomId, playerId, playerData } = data;
    console.log(`🔄 玩家更新: ${playerId} 在房间 ${roomId}`, playerData);
    broadcastToRoom(roomId, {
        type: 'PLAYER_UPDATE',
        roomId: roomId,
        playerId: playerId,
        playerData: playerData
    }, playerId);
    // 更新最大金币数
    // maxScore = Math.max(maxScore, playerData.totalGold);
    if (playerData.totalGold > recorder.score) {
        recorder.score = Math.max(recorder.score, playerData.totalGold);
        recorder.playerName = playerData.playerName;
    }
    broadcastToRoom(roomId, {
        type: 'MAX_SCORE_UPDATE',
        roomId: roomId,
        playerId: playerId,
        recorder
        // score: maxScore,
    }, playerId);
}

// 断开处理
function handleDisconnect(ws) {
    // 查找玩家所属房间
    for (const [roomId, room] of rooms) {
        for (const [playerId, player] of room.players) {
            if (player.ws === ws) {
                room.players.delete(playerId);
                console.log(`🚪玩家断开连接，房间 ${roomId}`);

                broadcastToRoom(roomId, {
                    type: 'PLAYER_LEAVE',
                    roomId: roomId,
                    playerId: playerId
                });

                if (room.players.size === 0) {
                    setTimeout(() => {
                        if (rooms.has(roomId) && rooms.get(roomId).players.size === 0) {
                            rooms.delete(roomId);
                        }
                    }, 60000);
                }
                return;
            }
        }
    }


}
// 广播消息到房间
function broadcastToRoom(roomId, message, excludePlayerId = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    const msg = JSON.stringify(message);

    for (const [playerId, player] of room.players) {
        if (playerId !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(msg);
        } else if (message.type === 'MAX_SCORE_UPDATE' && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(msg);
        }
    }
}

// 启动服务器
server.listen(PORT, () => {
    console.log('====================================');
    console.log('🐳 海盗骰子 - 多人游戏服务器');
    console.log('====================================');
    console.log('🌐 HTTP 服务器： http://localhost:${PORT}');
    console.log('🌐 WebSocket 服务器： ws://localhost:${PORT}');
    console.log('====================================');
    console.log('🌐 局域网访问： ');
    console.log('查看本机 IP 后，其他设备访问 http://你的IP:' + PORT);
    console.log('====================================');
});

// 获取本机 IP 地址
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

console.log(`本机 IP: ${getLocalIP()}:${PORT}`);