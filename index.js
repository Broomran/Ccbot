const express = require("express");
const bodyParser = require("body-parser");
const WebSocket = require("ws");
const ChildBot = require("./childbot");
const { loadBots, saveBots } = require("./storage");

const app = express();
app.use(bodyParser.json());

let mainWS = null;
let loggedIn = false;
let loginResponse = null;
let currentMainBot = null;
let debugLogs = [];
const activeBots = [];

const db = loadBots();
if (!db.mainbots) {
    db.mainbots = {};
    saveBots(db);
}

function packet() {
    return "MAIN-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
}

function debug(msg) {
    console.log(msg);
    debugLogs.push(msg);
    if (debugLogs.length > 100) debugLogs.shift();
}

function loadSavedBots(owner) {
    let account = db.mainbots[owner];
    if (!account || !account.childbots) return;
    for (let bot of account.childbots) {
        let alreadyOnline = activeBots.find(x => x.username === bot.username);
        if (alreadyOnline) continue;
        try {
            let child = new ChildBot(bot, owner);
            child.config = bot;
            activeBots.push(child);
            debug("♻ Restored childbot: " + bot.username);
        } catch (err) {
            debug("❌ Failed restoring bot: " + err.message);
        }
    }
}

function sendPM(user, text) {
    if (!mainWS || !loggedIn) return;
    mainWS.send(JSON.stringify({
        handler: "chat_message",
        type: "text",
        to: user,
        body: text,
        id: packet()
    }));
}

app.get("/", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
<title>FUNBOT LOGIN</title>
<style>
body{font-family:Arial;background:#f5f5f5;padding:30px;}
.box{background:white;padding:20px;border-radius:10px;max-width:500px;margin:auto;}
input{width:100%;padding:10px;margin-top:10px;}
button{width:100%;padding:10px;margin-top:10px;border:none;background:#2196f3;color:white;cursor:pointer;}
#status{margin-top:10px;font-weight:bold;}
#debug{margin-top:15px;background:black;color:#00ff00;height:300px;overflow:auto;padding:10px;font-size:12px;}
</style>
</head>
<body>
<div class="box">
<h2>🤖 FUNBOT LOGIN</h2>
<input id="user" placeholder="Main Bot Username">
<input id="pass" type="password" placeholder="Main Bot Password">
<button onclick="login()">LOGIN</button>
<div id="status"></div>
<pre id="debug"></pre>
</div>
<script>
async function login(){
    let user = document.getElementById("user").value;
    let pass = document.getElementById("pass").value;
    document.getElementById("status").innerText = "Connecting...";
    let res = await fetch("/login",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({username:user,password:pass})
    });
    let data = await res.json();
    document.getElementById("status").innerText = data.message;
    document.getElementById("debug").innerText = data.debug.join("\\n");
}
setInterval(async()=>{
    let res = await fetch("/debug");
    let data = await res.json();
    document.getElementById("debug").innerText = data.logs.join("\\n");
},2000);
</script>
</body>
</html>
`);
});

app.get("/debug", (req, res) => {
    res.json({ logs: debugLogs });
});

app.post("/login", (req, res) => {
    let username = req.body.username;
    let password = req.body.password;
    if (!username || !password) {
        return res.json({ success: false, message: "Missing username/password", debug: debugLogs });
    }
    currentMainBot = { username, password };
    connectMainBot(res);
});

function connectMainBot(res) {
    loginResponse = res;
    loggedIn = false;
    if (mainWS) {
        try { mainWS.close(); } catch {}
    }

    debug("🔌 Connecting mainbot WS to chatp.net...");

    mainWS = new WebSocket("wss://chatp.net:5333/server");

    let timeout = setTimeout(() => {
        if (!loggedIn && loginResponse) {
            loginResponse.json({ success: false, message: "Login timeout", debug: debugLogs });
            loginResponse = null;
        }
    }, 10000);

    mainWS.on("open", () => {
        debug("✅ MAIN WS CONNECTED");
        mainWS.send(JSON.stringify({
            handler: "login",
            username: currentMainBot.username,
            password: currentMainBot.password,
            id: packet()
        }));
    });

    mainWS.on("message", raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.handler === "login_event") {
            if (msg.type === "success") {
                loggedIn = true;
                clearTimeout(timeout);
                debug("✅ MAINBOT LOGIN SUCCESS");

                if (!db.mainbots[currentMainBot.username]) {
                    db.mainbots[currentMainBot.username] = {
                        password: currentMainBot.password,
                        childbots: []
                    };
                    saveBots(db);
                }

                loadSavedBots(currentMainBot.username);

                if (loginResponse) {
                    loginResponse.json({ success: true, message: "Login successful", debug: debugLogs });
                    loginResponse = null;
                }
            } else {
                if (loginResponse) {
                    loginResponse.json({ success: false, message: "Login failed", debug: debugLogs });
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
            debug("💬 PM: " + sender + " => " + body);

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
🚫 *لا تحتاج رموز أو علامات #\n\n💡 Inside room, send \`help\` or \`مساعدة\` for bot commands`);
                return;
            }

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

                let roomExist = activeBots.find(x => x.room === room);
                if (roomExist) {
                    sendPM(sender, `⚠️ *Bot already exists in this room!* ⚠️\n\nA bot is already active in \`${room}\`\nPlease stop it first or use another room.\n\n━━━━━━━━━━━━━━━━━━━━━\n⚠️ *يوجد بوت نشط في هذه الغرفة!* ⚠️\n\nبوت يعمل بالفعل في \`${room}\`\nالرجاء إيقافه أولاً أو استخدام غرفة أخرى`);
                    return;
                }

                let userExist = activeBots.find(x => x.username === username);
                if (userExist) {
                    sendPM(sender, `❌ Bot already online`);
                    return;
                }

                let config = {
                    owner: currentMainBot.username,
                    room: room,
                    username: username,
                    password: password,
                    mainMaster: sender,
                    masters: [sender],
                    settings: { welcome: true, quiz: true, cricket: false },
                    cricket: { runs: 0, wickets: 0, overs: 0, players: [] }
                };

                try {
                    let child = new ChildBot(config, currentMainBot.username);
                    child.config = config;
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

                    debug("✅ Created childbot: " + username);
                } catch (err) {
                    debug(err.message);
                    sendPM(sender, "❌ Failed creating bot");
                }
            }
        }
    });

    mainWS.on("error", err => {
        debug("❌ MAIN WS ERROR: " + err.message);
    });

    mainWS.on("close", () => {
        loggedIn = false;
        debug("🔌 MAIN WS CLOSED");
    });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log("🚀 FUNBOT RUNNING ON PORT", PORT);
    console.log("🌐 Open http://localhost:" + PORT);
});
