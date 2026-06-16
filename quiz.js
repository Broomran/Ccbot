function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateMath() {
    let ops = ["+", "-", "*"];
    let op = ops[random(0, ops.length - 1)];
    let a = random(1, 20);
    let b = random(1, 20);
    let answer = 0;

    if (op === "+") {
        answer = a + b;
    }
    if (op === "-") {
        if (b > a) {
            [a, b] = [b, a];
        }
        answer = a - b;
    }
    if (op === "*") {
        a = random(1, 10);
        b = random(1, 10);
        answer = a * b;
    }

    return {
        question: `🧮 ${a} ${op} ${b} = ?`,
        answer: answer.toString()
    };
}

function generateWord() {
    let words = ["apple", "banana", "robot", "dragon", "music", "tiger", "school", "python", "coding", "server"];
    let word = words[random(0, words.length - 1)];
    let scramble = word.split("").sort(() => Math.random() - 0.5).join("");
    return {
        question: `🧠 Unscramble: ${scramble}`,
        answer: word
    };
}

function generateGuess() {
    let number = random(1, 50);
    return {
        question: "🎯 Guess number (1-50)",
        answer: number.toString()
    };
}

function generateQuestion() {
    let modes = [generateMath, generateWord, generateGuess];
    let mode = modes[random(0, modes.length - 1)];
    return mode();
}

module.exports = { generateQuestion };
