const WebSocket = require("ws");
const { generateQuestion } = require("./quiz");
const { loadBots, saveBots } = require("./storage");

// ================= GLOBAL =================
let GLOBAL_SCORES = {};
let ROOM_SCORES = {};

// ================= PACKET ID =================
function packet() {
    return "BOT-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
}

class ChildBot {
    constructor(config, owner) {
        this.owner = owner;
        this.room = config.room;
        this.username = config.username;
        this.password = config.password;
        this.mainMaster = config.mainMaster;
        this.masters = config.masters || [config.mainMaster];
        this.settings = config.settings || {
            welcome: true,
            quiz: true,
            cricket: false
        };
        this.cricket = config.cricket || {
            runs: 0,
            wickets: 0,
            overs: 0,
            players: []
        };
        if (!this.cricket.players) {
            this.cricket.players = [];
        }
        this.currentAnswer = null;
        this.repeatTimer = null;
        this.repeatCount = 0;
        this.questionStartTime = 0;
        this.userScores = {};
        this.connect();
    }

    saveConfig() {
        try {
            let db = loadBots();
            if (!db.mainbots || !db.mainbots[this.owner]) return;
            let ownerData = db.mainbots[this.owner];
            let index = ownerData.childbots.findIndex(x => x.username === this.username);
            if (index === -1) return;
            ownerData.childbots[index] = {
                room: this.room,
                username: this.username,
                password: this.password,
                mainMaster: this.mainMaster,
                masters: this.masters,
                settings: this.settings,
                cricket: this.cricket
            };
            saveBots(db);
        } catch (err) {
            console.log("saveConfig error:", err.message);
        }
    }

    connect() {
        this.ws = new WebSocket("wss://chatp.net:5333/server");

        this.ws.on("open", () => {
            console.log(`✅ ${this.username} connected to chatp.net`);
            this.ws.send(JSON.stringify({
                handler: "login",
                username: this.username,
                password: this.password,
                id: packet()
            }));
        });

        this.ws.on("message", raw => {
            try {
                let msg = JSON.parse(raw);
                this.handle(msg);
            } catch (err) {
                console.log("Message Error:", err.message);
            }
        });

        this.ws.on("close", () => {
            console.log(`🔄 ${this.username} reconnecting...`);
            clearInterval(this.repeatTimer);
            setTimeout(() => this.connect(), 5000);
        });

        this.ws.on("error", err => {
            console.log("WS Error:", err.message);
        });
    }

    send(text) {
        try {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.send(JSON.stringify({
                handler: "room_message",
                type: "text",
                room: this.room,
                body: text,
                id: packet()
            }));
        } catch (err) {
            console.log("Send Error:", err.message);
        }
    }

    sendPM(to, text) {
        try {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.send(JSON.stringify({
                handler: "chat_message",
                type: "text",
                to: to,
                body: text,
                id: packet()
            }));
        } catch (err) {
            console.log("Send PM Error:", err.message);
        }
    }

    joinRoom() {
        try {
            this.ws.send(JSON.stringify({
                handler: "room_join",
                id: packet(),
                name: this.room
            }));
        } catch {}
    }

    nextQuestion() {
        if (!this.settings.quiz) return;
        clearInterval(this.repeatTimer);
        this.repeatCount = 0;
        let q = generateQuestion();
        this.currentAnswer = q.answer.toString().toLowerCase();
        this.questionStartTime = Date.now();
        this.send(q.question);
        this.repeatTimer = setInterval(() => {
            this.repeatCount++;
            if (this.currentAnswer === null) {
                clearInterval(this.repeatTimer);
                return;
            }
            this.send(`⏳ ${q.question}`);
            if (this.repeatCount >= 5) {
                clearInterval(this.repeatTimer);
                this.send(`❌ Time up!\n\nAnswer:\n${this.currentAnswer}`);
                this.currentAnswer = null;
                setTimeout(() => this.nextQuestion(), 5000);
            }
        }, 15000);
    }

    handle(msg) {
        try {
            // ================= LOGIN =================
            if (msg.handler === "login_event" && msg.type === "success") {
                console.log(`✅ ${this.username} logged in`);
                this.joinRoom();
                setTimeout(() => {
                    if (this.settings.quiz && this.currentAnswer === null) {
                        this.nextQuestion();
                    }
                }, 5000);
                return;
            }

            // ================= WELCOME =================
            if (msg.handler === "room_event") {
                let username = msg.username || msg.from || "";
                if (username && username !== this.username && this.settings.welcome) {
                    this.send(`👋 Welcome ${username}!`);
                }
                return;
            }

            // ================= ROOM MESSAGE =================
            if (msg.handler === "room_message") {
                let text = (msg.body || "").trim();
                let sender = msg.from || msg.username || "";
                let room = msg.room || "";

                if (!sender || sender === this.username || room !== this.room) return;

                let isMaster = this.masters.includes(sender);
                let isMainMaster = sender === this.mainMaster;

                // ================= HELP =================
                if ((text.toLowerCase() === "help" || text.toLowerCase() === "مساعدة") && isMaster) {
                    this.send(`🤖 *FUNBOT COMMANDS / أوامر البوت* 🤖

📖 *English:* 🇬🇧
━━━━━━━━━━━━━━━━━━━━━
👑 *Master Commands:*
addmas username  → Add master
removemas username → Remove master
maslist → List masters

⚙ *Settings:*
+quiz / -quiz  → ON/OFF Quiz
+wc / -wc  → ON/OFF Welcome
+cc / -cc  → ON/OFF Cricket

📊 *Score:*
+myscore → Your score
@top → Room top 10
@gtop → Global top room

🏏 *Cricket:*
+startcricket → Start team
+join → Join team
+bat → Bat
+score → Show score
+ccreset → Reset cricket

━━━━━━━━━━━━━━━━━━━━━
📖 *العربية:* 🇸🇦
━━━━━━━━━━━━━━━━━━━━━
👑 *أوامر الماستر:*
addmas اسم  → إضافة ماستر
removemas اسم → حذف ماستر
maslist → قائمة الماسترز

⚙ *الإعدادات:*
+quiz / -quiz  → تشغيل/إيقاف المسابقات
+wc / -wc  → تشغيل/إيقاف الترحيب
+cc / -cc  → تشغيل/إيقاف الكريكيت

📊 *النتائج:*
+myscore → نتيجتك
@top → أفضل 10 في الغرفة
@gtop → أفضل غرفة عالمياً

🏏 *الكريكيت:*
+startcricket → بدء الفريق
+join → انضمام
+bat → ضرب
+score → عرض النتيجة
+ccreset → إعادة تعيين

━━━━━━━━━━━━━━━━━━━━━
💡 Send \`help\` or \`مساعدة\` for commands`);
                    return;
                }

                // ================= MY SCORE =================
                if (text === "+myscore") {
                    let u = this.userScores[sender];
                    if (!u) {
                        this.send(`❌ ${sender}, no score yet`);
                        return;
                    }
                    this.send(`📊 ${sender}\n\n🏆 Score: ${u.score}\n⚡ Last Speed: ${u.last}s\n🥇 Best Speed: ${u.best}s`);
                    return;
                }

                // ================= TOP =================
                if (text === "@top") {
                    let list = Object.entries(this.userScores)
                        .map(([name, data]) => ({ name, score: data.score }))
                        .sort((a, b) => b.score - a.score)
                        .slice(0, 10);
                    if (list.length === 0) {
                        this.send("❌ No scores yet");
                        return;
                    }
                    let topMsg = "🏆 TOP 10 PLAYERS\n\n";
                    list.forEach((u, i) => {
                        topMsg += `${i + 1}. ${u.name} - ${u.score}\n`;
                    });
                    this.send(topMsg);
                    return;
                }

                // ================= GLOBAL TOP =================
                if (text === "@gtop") {
                    let rooms = Object.entries(ROOM_SCORES);
                    let roomWinners = rooms.map(([room, users]) => {
                        let topUser = Object.entries(users).sort((a, b) => b[1] - a[1])[0];
                        return { room, user: topUser ? topUser[0] : null, score: topUser ? topUser[1] : 0 };
                    });
                    let bestRoom = roomWinners.sort((a, b) => b.score - a.score)[0];
                    if (!bestRoom || !bestRoom.user) {
                        this.send("❌ No global data yet");
                        return;
                    }
                    this.send(`🌍 GLOBAL TOP ROOM\n\n🏆 Room: ${bestRoom.room}\n👑 Player: ${bestRoom.user}\n📊 Score: ${bestRoom.score}`);
                    return;
                }

                // ================= SETTINGS =================
                if (isMaster) {
                    if (text === "+quiz") {
                        this.settings.quiz = true;
                        this.saveConfig();
                        this.send("✅ Quiz ON");
                        if (this.currentAnswer === null) this.nextQuestion();
                        return;
                    }
                    if (text === "-quiz") {
                        this.settings.quiz = false;
                        clearInterval(this.repeatTimer);
                        this.currentAnswer = null;
                        this.saveConfig();
                        this.send("❌ Quiz OFF");
                        return;
                    }
                    if (text === "+wc") {
                        this.settings.welcome = true;
                        this.saveConfig();
                        this.send("✅ Welcome ON");
                        return;
                    }
                    if (text === "-wc") {
                        this.settings.welcome = false;
                        this.saveConfig();
                        this.send("❌ Welcome OFF");
                        return;
                    }
                    if (text === "+cc") {
                        this.settings.cricket = true;
                        this.saveConfig();
                        this.send("🏏 Cricket ON");
                        return;
                    }
                    if (text === "-cc") {
                        this.settings.cricket = false;
                        this.saveConfig();
                        this.send("🏏 Cricket OFF");
                        return;
                    }
                    if (text === "+ccreset") {
                        this.cricket = { runs: 0, wickets: 0, overs: 0, players: [] };
                        this.saveConfig();
                        this.send("🏏 Cricket Reset");
                        return;
                    }
                }

                // ================= ADD MASTER =================
                if (isMainMaster && text.startsWith("addmas ")) {
                    let user = text.replace("addmas ", "").trim();
                    if (!this.masters.includes(user)) {
                        this.masters.push(user);
                        this.saveConfig();
                        this.send(`✅ ${user} added as master`);
                    }
                    return;
                }

                // ================= REMOVE MASTER =================
                if (isMaster && text.startsWith("removemas ")) {
                    let user = text.replace("removemas ", "").trim();
                    if (user === this.mainMaster) {
                        this.send("❌ Cannot remove main master");
                        return;
                    }
                    this.masters = this.masters.filter(x => x !== user);
                    this.saveConfig();
                    this.send(`🗑 ${user} removed`);
                    return;
                }

                // ================= MASTER LIST =================
                if (text === "maslist") {
                    this.send(`👑 Masters\n\n${this.masters.join("\n")}`);
                    return;
                }

                // ================= START CRICKET =================
                if (isMaster && text === "+startcricket") {
                    if (!this.settings.cricket) {
                        this.send("❌ Cricket OFF");
                        return;
                    }
                    this.cricket.players = [];
                    this.send(`🏏 CRICKET TEAM OPEN\n\nNeed 3 players\nUse:\n+join`);
                    return;
                }

                // ================= JOIN TEAM =================
                if (text === "+join") {
                    if (this.cricket.players.includes(sender)) {
                        this.send("Already joined");
                        return;
                    }
                    if (this.cricket.players.length >= 3) {
                        this.send("Team full");
                        return;
                    }
                    this.cricket.players.push(sender);
                    let remain = 3 - this.cricket.players.length;
                    this.send(`🏏 ${sender} joined\n\nPlayers:\n${this.cricket.players.join(", ")}\n\nRemaining:\n${remain}`);
                    if (this.cricket.players.length === 3) {
                        this.send(`✅ TEAM COMPLETE\n\n${this.cricket.players.join(", ")}`);
                    }
                    this.saveConfig();
                    return;
                }

                // ================= BAT =================
                if (this.settings.cricket && text === "+bat") {
                    let results = [0, 1, 2, 3, 4, 6, "W"];
                    let result = results[Math.floor(Math.random() * results.length)];
                    if (result === "W") {
                        this.cricket.wickets++;
                        this.send(`❌ OUT\n\nScore:\n${this.cricket.runs}/${this.cricket.wickets}`);
                    } else {
                        this.cricket.runs += result;
                        this.send(`🏏 ${sender} scored ${result}\n\nScore:\n${this.cricket.runs}/${this.cricket.wickets}`);
                    }
                    this.saveConfig();
                    return;
                }

                // ================= SCORE =================
                if (this.settings.cricket && text === "+score") {
                    this.send(`🏏 SCOREBOARD\n\nRuns:\n${this.cricket.runs}\n\nWickets:\n${this.cricket.wickets}`);
                    return;
                }

                // ================= QUIZ ANSWER =================
                if (this.currentAnswer !== null && text.toLowerCase() === this.currentAnswer) {
                    clearInterval(this.repeatTimer);
                    let correctAnswer = this.currentAnswer;
                    this.currentAnswer = null;
                    let speedSec = Number(((Date.now() - this.questionStartTime) / 1000).toFixed(2));
                    if (!this.userScores[sender]) {
                        this.userScores[sender] = { score: 0, best: null, last: null };
                    }
                    let u = this.userScores[sender];
                    let addScore = 10;
                    if (speedSec >= 2 && speedSec <= 4) addScore = 100;
                    else if (speedSec >= 5 && speedSec <= 7) addScore = 80;
                    else if (speedSec >= 8 && speedSec <= 10) addScore = 50;
                    u.score += addScore;
                    u.last = speedSec;
                    if (!u.best || speedSec < u.best) u.best = speedSec;

                    if (!ROOM_SCORES[this.room]) ROOM_SCORES[this.room] = {};
                    if (!ROOM_SCORES[this.room][sender]) ROOM_SCORES[this.room][sender] = 0;
                    ROOM_SCORES[this.room][sender] += addScore;

                    if (!GLOBAL_SCORES[sender]) GLOBAL_SCORES[sender] = 0;
                    GLOBAL_SCORES[sender] += addScore;

                    this.send(`🏆 ${sender} answered correctly!\n\n✅ Answer: ${correctAnswer}\n\n⚡ Speed: ${speedSec}s\n➕ Score Gained: ${addScore}\n📊 Total Score: ${u.score}\n\n🥇 Best Speed: ${u.best}s`);

                    setTimeout(() => {
                        if (this.settings.quiz) this.nextQuestion();
                    }, 5000);
                    return;
                }
            }
        } catch (err) {
            console.log("HANDLE ERROR:", err.message);
        }
    }
}

module.exports = ChildBot;
