const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const WebSocket = require("ws");
const ChildBot = require("./childbot");
const { loadBots, saveBots } = require("./storage");

const app = express();
const PORT = process.env.PORT || 8080;

// ================= MIDDLEWARE =================
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ================= GLOBAL VARIABLES =================
let mainWS = null;
let loggedIn = false;
let loginResponse = null;
let currentMainBot = null;
let debugLogs = [];
const activeBots = [];

// ================= DATABASE =================
const db = loadBots();
if (!db.mainbots) {
    db.mainbots = {};
    saveBots(db);
}

// ================= PACKET ID =================
function packet() {
    return "MAIN-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
}

// ================= DEBUG =================
function debug(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[${timestamp}] ${msg}`;
    console.log(logMsg);
    debugLogs.push(logMsg);
    if (debugLogs.length > 100) debugLogs.shift();
}

// ================= LOAD SAVED CHILDBOTS =================
function loadSavedBots(owner) {
    let account = db.mainbots[owner];
    if (!account || !account.childbots) return;
    
    debug(`📂 Loading ${account.childbots.length} saved bots...`);
    
    for (let bot of account.childbots) {
        let alreadyOnline = activeBots.find(x => x.username === bot.username);
        if (alreadyOnline) continue;
        try {
            let child = new ChildBot(bot, owner);
            child.config = bot;
            activeBots.push(child);
            debug(`♻ Restored childbot: ${bot.username} → ${bot.room}`);
        } catch (err) {
            debug(`❌ Failed restoring bot ${bot.username}: ${err.message}`);
        }
    }
}

// ================= SEND PM =================
function sendPM(user, text) {
    if (!mainWS || !loggedIn) {
        debug("⚠️ Cannot send PM: Not connected");
        return;
    }
    try {
        mainWS.send(JSON.stringify({
            handler: "chat_message",
            type: "text",
            to: user,
            body: text,
            id: packet()
        }));
        debug(`📤 PM to ${user}: ${text.substring(0, 50)}...`);
    } catch (err) {
        debug(`❌ Send PM error: ${err.message}`);
    }
}

// ================= API ROUTES =================

// ================= STATUS API =================
app.get("/status", (req, res) => {
    res.json({
        loggedIn: loggedIn,
        activeBots: activeBots.length,
        bots: activeBots.map(b => ({
            username: b.username,
            room: b.room,
            masters: b.masters
        }))
    });
});

// ================= DEBUG API =================
app.get("/debug", (req, res) => {
    res.json({ logs: debugLogs });
});

// ================= LOGIN API =================
app.post("/login", (req, res) => {
    let username = req.body.username;
    let password = req.body.password;
    
    if (!username || !password) {
        return res.json({ 
            success: false, 
            message: "⚠️ Missing username or password", 
            debug: debugLogs 
        });
    }
    
    currentMainBot = { username, password };
    connectMainBot(res);
});

// ================= CONNECT MAINBOT =================
function connectMainBot(res) {
    loginResponse = res;
    loggedIn = false;
    
    if (mainWS) {
        try { mainWS.close(); } catch {}
    }

    debug("🔌 Connecting mainbot to chatp.net...");

    mainWS = new WebSocket("wss://chatp.net:5333/server");

    let timeout = setTimeout(() => {
        if (!loggedIn && loginResponse) {
            loginResponse.json({ 
                success: false, 
                message: "⏰ Login timeout - Server not responding", 
                debug: debugLogs 
            });
            loginResponse = null;
        }
    }, 15000);

    // ================= WS OPEN =================
    mainWS.on("open", () => {
        debug("✅ Main WebSocket connected");
        mainWS.send(JSON.stringify({
            handler: "login",
            username: currentMainBot.username,
            password: currentMainBot.password,
            id: packet()
        }));
        debug(`🔑 Sending login for: ${currentMainBot.username}`);
    });

    // ================= WS MESSAGE =================
    mainWS.on("message", raw => {
        let msg;
        try { 
            msg = JSON.parse(raw); 
        } catch { 
            return; 
        }

        // ================= LOGIN EVENT =================
        if (msg.handler === "login_event") {
            if (msg.type === "success") {
                loggedIn = true;
                clearTimeout(timeout);
                debug(`✅ Mainbot "${currentMainBot.username}" logged in successfully`);

                // Create account if not exists
                if (!db.mainbots[currentMainBot.username]) {
                    db.mainbots[currentMainBot.username] = {
                        password: currentMainBot.password,
                        childbots: []
                    };
                    saveBots(db);
                    debug(`📁 Created new account: ${currentMainBot.username}`);
                }

                // Load saved bots
                loadSavedBots(currentMainBot.username);

                if (loginResponse) {
                    loginResponse.json({ 
                        success: true, 
                        message: `✅ Logged in as ${currentMainBot.username}`, 
                        debug: debugLogs 
                    });
                    loginResponse = null;
                }
            } else {
                debug(`❌ Login failed for "${currentMainBot.username}"`);
                if (loginResponse) {
                    loginResponse.json({ 
                        success: false, 
                        message: "❌ Login failed - Check username and password", 
                        debug: debugLogs 
                    });
                    loginResponse = null;
                }
            }
            return;
        }

        // ================= IGNORE MESSAGES IF NOT LOGGED IN =================
        if (!loggedIn) return;

        // ================= PRIVATE CHAT MESSAGE =================
        if (msg.handler === "chat_message") {
            let sender = msg.from || "";
            let body = (msg.body || "").trim();
            
            if (!sender || !body) return;
            
            debug(`💬 PM from ${sender}: ${body.substring(0, 50)}${body.length > 50 ? '...' : ''}`);

            // ================= HELP COMMAND =================
            if (body.toLowerCase() === "help" || body.toLowerCase() === "مساعدة") {
                sendPM(sender, `🤖 *FUNBOT SERVER / سيرفر البوت* 🤖

📖 *English Instructions:* 🇬🇧
━━━━━━━━━━━━━━━━━━━━━
To create a new bot, send:
\`Dd room username password\`

📝 *Example:* ✨
\`Dd myroom bot1 123456\`

🔍 *Parameters:* 📋
• \`room\` → Chat room name 🏠
• \`username\` → Bot username 👤
• \`password\` → Bot password 🔐

━━━━━━━━━━━━━━━━━━━━━

📖 *التعليمات العربية:* 🇸🇦
━━━━━━━━━━━━━━━━━━━━━
لإنشاء بوت جديد، أرسل:
\`Dd اسم_الغرفة اسم_المستخدم كلمة_السر\`

📝 *مثال:* ✨
\`Dd غرفتي بوتي 123456\`

🔍 *المعاملات:* 📋
• \`اسم_الغرفة\` → اسم غرفة المحادثة 🏠
• \`اسم_المستخدم\` → اسم البوت 👤
• \`كلمة_السر\` → كلمة سر البوت 🔐

━━━━━━━━━━━━━━━━━━━━━
✅ *No symbols or hashtags needed!*
🚫 *لا تحتاج رموز أو علامات #*

💡 Inside room, send \`help\` or \`مساعدة\` for bot commands`);
                return;
            }

            // ================= CREATE BOT COMMAND =================
            if (body.toLowerCase().startsWith("dd ")) {
                let parts = body.substring(3).trim().split(/\s+/);
                
                if (parts.length < 3) {
                    sendPM(sender, `❌ *Invalid Command / أمر غير صحيح* ❌

📖 *English:* 🇬🇧
Please use:
\`Dd room username password\`

📝 *Example:* ✨
\`Dd myroom bot1 123456\`

━━━━━━━━━━━━━━━━━━━━━

📖 *العربية:* 🇸🇦
الرجاء استخدام:
\`Dd اسم_الغرفة اسم_المستخدم كلمة_السر\`

📝 *مثال:* ✨
\`Dd غرفتي بوتي 123456\``);
                    return;
                }

                let room = parts[0];
                let username = parts[1];
                let password = parts[2];

                // ================= CHECK DUPLICATES =================
                let roomExist = activeBots.find(x => x.room === room);
                if (roomExist) {
                    sendPM(sender, `⚠️ *Bot already exists in this room!* ⚠️

━━━━━━━━━━━━━━━━━━━━━
📖 A bot is already active in \`${room}\`
🗑️ Please stop it first or use another room.

━━━━━━━━━━━━━━━━━━━━━
⚠️ *يوجد بوت نشط في هذه الغرفة!* ⚠️

📖 بوت يعمل بالفعل في \`${room}\`
🗑️ الرجاء إيقافه أولاً أو استخدام غرفة أخرى`);
                    return;
                }

                let userExist = activeBots.find(x => x.username === username);
                if (userExist) {
                    sendPM(sender, `❌ Bot "${username}" already online`);
                    return;
                }

                // ================= CREATE BOT =================
                let config = {
                    owner: currentMainBot.username,
                    room: room,
                    username: username,
                    password: password,
                    mainMaster: sender,
                    masters: [sender],
                    settings: { 
                        welcome: true, 
                        quiz: true, 
                        cricket: false 
                    },
                    cricket: { 
                        runs: 0, 
                        wickets: 0, 
                        overs: 0, 
                        players: [] 
                    }
                };

                try {
                    debug(`🔨 Creating bot: ${username} → ${room}`);
                    
                    let child = new ChildBot(config, currentMainBot.username);
                    child.config = config;
                    activeBots.push(child);

                    // Save to database
                    if (!db.mainbots[currentMainBot.username].childbots) {
                        db.mainbots[currentMainBot.username].childbots = [];
                    }
                    db.mainbots[currentMainBot.username].childbots.push(config);
                    saveBots(db);

                    sendPM(sender, `✅ *BOT CREATED SUCCESSFULLY!* ✅

━━━━━━━━━━━━━━━━━━━━━
📖 *English:* 🇬🇧
🏠 Room: \`${room}\`
👤 Bot: \`${username}\`
🔐 Status: Connected & Active ✨

━━━━━━━━━━━━━━━━━━━━━
📖 *العربية:* 🇸🇦
🏠 الغرفة: \`${room}\`
👤 البوت: \`${username}\`
🔐 الحالة: متصل ونشط ✨

━━━━━━━━━━━━━━━━━━━━━
💡 Send \`help\` or \`مساعدة\` for more commands`);

                    debug(`✅ Created childbot: ${username} → ${room}`);

                } catch (err) {
                    debug(`❌ Failed creating bot: ${err.message}`);
                    sendPM(sender, `❌ Failed creating bot: ${err.message}`);
                }
            }
        }
    });

    // ================= WS ERROR =================
    mainWS.on("error", err => {
        debug(`❌ WebSocket error: ${err.message}`);
    });

    // ================= WS CLOSE =================
    mainWS.on("close", () => {
        if (loggedIn) {
            debug("🔌 Main WebSocket disconnected");
        }
        loggedIn = false;
    });
}

// ================= HEALTH CHECK =================
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        bots: activeBots.length
    });
});

// ================= START SERVER =================
app.listen(PORT, () => {
    console.log("========================================");
    console.log("🚀 FUNBOT RUNNING ON PORT", PORT);
    console.log("🌐 Open http://localhost:" + PORT);
    console.log("========================================");
    console.log("📖 Commands:");
    console.log("   Dd room username password → Create bot");
    console.log("   help / مساعدة → Show help");
    console.log("========================================");
});

// ================= GRACEFUL SHUTDOWN =================
process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down...");
    if (mainWS) mainWS.close();
    process.exit(0);
});
