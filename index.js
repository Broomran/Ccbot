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

app.get("/debug", (req, res) => {
    res.json({ logs: debugLogs });
});

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

    mainWS.on("message", raw => {
        let msg;
        try { 
            msg = JSON.parse(raw); 
        } catch { 
            return; 
        }

        if (msg.handler === "login_event") {
            if (msg.type === "success") {
                loggedIn = true;
                clearTimeout(timeout);
                debug(`✅ Mainbot "${currentMainBot.username}" logged in successfully`);

                if (!db.mainbots[currentMainBot.username]) {
                    db.mainbots[currentMainBot.username] = {
                        password: currentMainBot.password,
                        childbots: []
                    };
                    saveBots(db);
                    debug(`📁 Created new account: ${currentMainBot.username}`);
                }

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

        if (!loggedIn) return;

        if (msg.handler === "chat_message") {
            let sender = msg.from || "";
            let body = (msg.body || "").trim();
            
            if (!sender || !body) return;
            
            debug(`💬 PM from ${sender}: ${body.substring(0, 50)}${body.length > 50 ? '...' : ''}`);

            // ================= HELP =================
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

            // ================= CREATE BOT =================
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

                // ================= CREATE BOT WITH VERIFICATION =================
                debug(`🔨 Creating bot: ${username} → ${room}`);
                debug(`🔑 Checking credentials for ${username}...`);

                // إنشاء البوت مع متابعة حالة تسجيل الدخول
                let loginSuccess = false;
                let loginError = null;
                let loginChecked = false;

                const config = {
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
                    // إنشاء البوت مع تمرير callback للتحقق من تسجيل الدخول
                    let child = new ChildBot(config, currentMainBot.username, function(success, error) {
                        loginSuccess = success;
                        loginError = error;
                        loginChecked = true;
                    });
                    
                    child.config = config;
                    
                    // 🔥 انتظر حتى يتم التحقق من تسجيل الدخول (مهلة 10 ثوان)
                    let waitTime = 0;
                    const maxWait = 10000; // 10 ثوان
                    const interval = 500; // نصف ثانية
                    
                    while (!loginChecked && waitTime < maxWait) {
                        await sleep(interval);
                        waitTime += interval;
                    }
                    
                    if (!loginChecked) {
                        // لم يتم التحقق من الدخول خلال المهلة
                        sendPM(sender, `❌ *BOT CREATION TIMEOUT!* ❌

━━━━━━━━━━━━━━━━━━━━━
📖 *English:* 🇬🇧
⏰ Server did not respond within 10 seconds.

🔍 *Please check:*
• Username: \`${username}\`
• Room: \`${room}\`

💡 Make sure the bot account exists and try again.

━━━━━━━━━━━━━━━━━━━━━
📖 *العربية:* 🇸🇦
⏰ لم يستجب الخادم خلال 10 ثوان.

🔍 *يرجى التحقق من:*
• اسم المستخدم: \`${username}\`
• الغرفة: \`${room}\`

💡 تأكد من أن حساب البوت موجود وحاول مرة أخرى.`);
                        debug(`⏰ Login timeout for ${username}`);
                        return;
                    }

                    // ========== التحقق من نتيجة تسجيل الدخول ==========
                    if (loginSuccess) {
                        // ✅ نجح تسجيل الدخول
                        activeBots.push(child);

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
                    } else {
                        // ❌ فشل تسجيل الدخول
                        sendPM(sender, `❌ *BOT CREATION FAILED!* ❌

━━━━━━━━━━━━━━━━━━━━━
📖 *English:* 🇬🇧
⚠️ Could not login with provided credentials.

🔍 *Please check:*
• Username: \`${username}\`
• Password: \`******\`
• Room: \`${room}\`

💡 Make sure the bot account exists and the credentials are correct.

━━━━━━━━━━━━━━━━━━━━━
📖 *العربية:* 🇸🇦
⚠️ لا يمكن تسجيل الدخول بالبيانات المدخلة.

🔍 *يرجى التحقق من:*
• اسم المستخدم: \`${username}\`
• كلمة السر: \`******\`
• الغرفة: \`${room}\`

💡 تأكد من أن حساب البوت موجود والبيانات صحيحة.

━━━━━━━━━━━━━━━━━━━━━
❌ Error: ${loginError || "Invalid username or password"}`);

                        debug(`❌ Failed: ${username} → ${room} (Login failed)`);
                    }

                } catch (err) {
                    debug(`❌ Failed creating bot: ${err.message}`);
                    sendPM(sender, `❌ Failed creating bot: ${err.message}`);
                }
            }
        }
    });

    mainWS.on("error", err => {
        debug(`❌ WebSocket error: ${err.message}`);
    });

    mainWS.on("close", () => {
        if (loggedIn) {
            debug("🔌 Main WebSocket disconnected");
        }
        loggedIn = false;
    });
}

// ================= SLEEP FUNCTION =================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
