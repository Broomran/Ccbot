const fs = require("fs");
const path = require("path");

const STORAGE_DIR = path.join(__dirname, "storage");
const DB_FILE = path.join(STORAGE_DIR, "bots.json");

// تأكد من وجود مجلد storage
if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function loadBots() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            return { mainbots: {} };
        }
        let data = fs.readFileSync(DB_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        console.log("LOAD DB ERROR:", err.message);
        return { mainbots: {} };
    }
}

function saveBots(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.log("SAVE DB ERROR:", err.message);
    }
}

module.exports = { loadBots, saveBots };
