const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    DisconnectReason,
    delay 
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const axios = require("axios");
const { DateTime } = require("luxon");
const fs = require("fs");
const express = require("express");

// ==========================================
// MONITOR E DASHBOARD PARA O RENDER
// ==========================================
const app = express();
const port = process.env.PORT || 3000;
let statusBot = "Iniciando...";
let pairingCode = "Já conectado ou gerando...";

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>SevenTV Dashboard</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { background: #0f0f0f; color: white; font-family: sans-serif; text-align: center; padding-top: 50px; }
                    .card { background: #1a1a1a; border: 2px solid #ff00ff; border-radius: 15px; padding: 20px; display: inline-block; box-shadow: 0 0 20px #ff00ff55; }
                    .status { font-size: 20px; color: #00ff00; margin-bottom: 15px; }
                    .code { font-size: 24px; background: #333; padding: 10px; border-radius: 8px; color: #ff00ff; border: 1px dashed white; }
                    .footer { margin-top: 20px; font-size: 12px; color: #666; }
                    .neon { text-shadow: 0 0 10px #ff00ff; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1 class="neon">🚀 SEVENTV OMNI-STREAM</h1>
                    <div class="status">Status: <b>${statusBot}</b></div>
                    <p>Código de Pareamento:</p>
                    <div class="code">${pairingCode}</div>
                    <div class="footer">Monitor Ativo - Anti-Sleep Ligado</div>
                </div>
                <script>setTimeout(() => { location.reload(); }, 30000);</script>
            </body>
        </html>
    `);
});

app.listen(port, () => console.log(`Dashboard ativo na porta ${port}`));

// AUTO-PING PARA NÃO DORMIR
setInterval(() => {
    const renderUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
    axios.get(renderUrl).catch(() => {});
}, 300000); // 5 minutos

// ==========================================
// CONFIGURAÇÕES DO THAYSON (SINCRONIZADAS COM PYTHON)
// ==========================================
const CREDENCIAIS_PAINEL = {
    username: "thaysonsilvacavalcante@gmail.com", // E-mail corrigido conforme Python
    password: "Thayson13.@",
    baseUrl: "https://seventvpainel.top/api",
    dnsPrincipal: "http://cdnflash.top"
};

const MEU_NUMERO = "14389423427"; 

const PIX_PLANS = {
    MENSAL_25: "00020126330014br.gov.bcb.pix011106355535209520400005303986540525.005802BR5925Osmarina Silva Cavalcante6009Sao Paulo62290525REC69C13FF082F0A49507775863043224",
    TRIMESTRAL_70: "00020126330014br.gov.bcb.pix011106355535209520400005303986540570.005802BR5925Osmarina Silva Cavalcante6009Sao Paulo62290525REC69C14027452B252054519963043A4B",
    ANUAL_250: "00020126330014br.gov.bcb.pix0111063555352095204000053039865406250.005802BR5925Osmarina Silva Cavalcante6009Sao Paulo62290525REC69C140496D0F547715109163046DB6"
};

const DB_PATH = './database.json';
const estadoUsuario = {}; 

function loadDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            const initialDB = { testes_ativos: {}, usuarios: {} };
            fs.writeFileSync(DB_PATH, JSON.stringify(initialDB, null, 2));
            return initialDB;
        }
        const data = JSON.parse(fs.readFileSync(DB_PATH));
        if (!data.testes_ativos) data.testes_ativos = {};
        if (!data.usuarios) data.usuarios = {};
        return data;
    } catch (e) { return { testes_ativos: {}, usuarios: {} }; }
}

function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }

let PANEL_TOKEN = "";

// HEADERS IGUAIS AO PYTHON PARA EVITAR CLOUDFLARE
const HEADERS_API = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10)",
    "Locale": "pt"
};

async function realizarLogin() {
    try {
        console.log("🔐 Capturando novo Token de acesso...");
        const res = await axios.post(`${CREDENCIAIS_PAINEL.baseUrl}/auth/login`, {
            username: CREDENCIAIS_PAINEL.username,
            password: CREDENCIAIS_PAINEL.password
        }, { headers: HEADERS_API });
        
        if (res.data.token) {
            PANEL_TOKEN = res.data.token;
            console.log("✅ Token capturado com sucesso!");
            return true;
        }
        return false;
    } catch (e) { 
        console.log("Erro no login do painel:", e.response?.data || e.message);
        return false; 
    }
}

async function getRealExpiration(user, pass) {
    try {
        const url = `${CREDENCIAIS_PAINEL.dnsPrincipal}/player_api.php?username=${user}&password=${pass}`;
        const res = await axios.get(url);
        if (res.data?.user_info?.exp_date) {
            return parseInt(res.data.user_info.exp_date);
        }
        return null;
    } catch (e) { return null; }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["SevenTV", "Chrome", "20.0.04"]
    });

    const editMsg = async (jid, msgOriginal, novoTexto) => {
        await sock.sendMessage(jid, { text: novoTexto, edit: msgOriginal.key });
    };

    if (!sock.authState.creds.registered) {
        statusBot = "Aguardando Pareamento 🔗";
        setTimeout(async () => {
            try {
                const numeroLimpo = MEU_NUMERO.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(numeroLimpo);
                pairingCode = code;
                console.log(`\nCÓDIGO DE PAREAMENTO: ${code}\n`);
            } catch (err) { console.log("Erro ao gerar Pairing Code."); }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => { 
        if (u.connection === 'close') {
            statusBot = "Offline ❌";
            const erro = u.lastDisconnect?.error?.output?.statusCode;
            if (erro !== DisconnectReason.loggedOut) startBot();
        } else if (u.connection === 'open') {
            statusBot = "Online ✅";
            pairingCode = "Conectado!";
            console.log('✅ BOT IPTV ONLINE!');
        }
    });

    // MONITOR DE EXPIRAÇÃO
    setInterval(async () => {
        const agoraUnix = Math.floor(Date.now() / 1000);
        let db = loadDB();
        let mudou = false;

        for (const [key, data] of Object.entries(db.testes_ativos)) {
            if (!data.expUnix) continue;
            const diff = data.expUnix - agoraUnix;
            if (diff <= 300 && diff > 0 && !data.avisoEnviado) {
                const linkC = data.linkCheckout ? `🔗 ${data.linkCheckout}` : "_Link indisponível_";
                const msgUrgente = `🚨 *O TEMPO ESTÁ ACABANDO!* 🚨\n\n` +
                    `Seu teste vence em *5 MINUTOS*.\n\n` +
                    `💎 *RENOVE AGORA:* \n${linkC}\n\n` +
                    `📍 *PARA PAGAR VIA PIX:* \nDigite: */renovar ${key}*\n\n` +
                    `✅ Sem anúncios | ✅ Canais 4K`;
                await sock.sendMessage(data.whatsapp, { text: msgUrgente });
                db.testes_ativos[key].avisoEnviado = true;
                mudou = true;
            }
        }
        if (mudou) saveDB(db);
    }, 60000);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        if (estadoUsuario[from] === 'ESCOLHENDO_APP') {
            let appNome = ""; let foto = "";
            if (texto === "1") { appNome = "Brasil IPTV"; foto = "./brasil.jpg"; }
            else if (texto === "2") { appNome = "FlexPlay"; foto = "./flex.jpg"; }
            else if (texto === "3") { appNome = "Assist+"; foto = "./assist.jpg"; }
            else { return await sock.sendMessage(from, { text: "❌ Opção inválida!" }); }

            delete estadoUsuario[from];
            if (fs.existsSync(foto)) {
                await sock.sendMessage(from, { image: { url: foto }, caption: `📸 App *${appNome}*!` });
            }

            const msgAnim = await sock.sendMessage(from, { text: "⏳ *ɪɴɪᴄɪᴀɴᴅᴏ ɢᴇʀᴀᴄᴀᴏ...*" });
            
            if (!PANEL_TOKEN) await realizarLogin();

            try {
                // PAYLOAD SINCRONIZADO COM O SUCESSO DO PYTHON
                const res = await axios.post(`${CREDENCIAIS_PAINEL.baseUrl}/customers`, {
                    server_id: "BV4D3rLaqZ",
                    package_id: "z2BDvoWrkj",
                    connection_type: "IPTV",
                    is_trial: "NO", 
                    connections: 1
                }, { 
                    headers: { 
                        ...HEADERS_API,
                        "Authorization": `Bearer ${PANEL_TOKEN}`
                    } 
                });

                const c = res.data.data;
                const user = c.username;
                const password = c.password;
                const expira = c.expires_at_tz;

                const resPlaylist = await axios.get(`${CREDENCIAIS_PAINEL.baseUrl}/customers/${c.id}/playlist`, {
                    headers: { ...HEADERS_API, "Authorization": `Bearer ${PANEL_TOKEN}` }
                });

                const templatePt = resPlaylist.data.find(t => t.key === 'pt')?.template || 
                                  `👤 Usuário: ${user}\n🔑 Senha: ${password}\n⏰ Expira em: ${expira}`;
                
                const expUnix = await getRealExpiration(user, password);
                let db = loadDB();
                db.testes_ativos[user] = { 
                    whatsapp: from, 
                    expUnix: expUnix || (Math.floor(Date.now() / 1000) + 21600), 
                    linkCheckout: c.checkout_url || null, 
                    avisoEnviado: false 
                };
                db.usuarios[from.replace(/[^0-9]/g, "")] = true;
                saveDB(db);

                const final3D = `╔════════════════════╗\n    ✨ *𝗦𝗘𝗩𝗘𝗡𝗧𝗩 𝗨𝗟𝗧𝗥𝗔* ✨\n╚════════════════════╝\n\n✅ *TESTE GERADO!*\n\n${templatePt}`;
                await editMsg(from, msgAnim, final3D);
            } catch (e) { 
                console.log("Erro ao gerar teste, renovando token...");
                await realizarLogin();
                await editMsg(from, msgAnim, "❌ Painel ocupado. Tente novamente agora."); 
            }
            return;
        }

        if (estadoUsuario[from] === 'ESCOLHENDO_PLANO_PIX') {
            let pixCode = ""; 
            if (texto === "1") pixCode = PIX_PLANS.MENSAL_25;
            else if (texto === "2") pixCode = PIX_PLANS.TRIMESTRAL_70;
            else if (texto === "3") pixCode = PIX_PLANS.ANUAL_250;
            else return;
            delete estadoUsuario[from];
            return await sock.sendMessage(from, { text: `📍 *PIX COPIA E COLA:* \n\`${pixCode}\`` });
        }

        if (texto.toLowerCase().startsWith('/renovar')) {
            return await sock.sendMessage(from, { text: `📍 *PIX RENOVAÇÃO:* \n\`${PIX_PLANS.MENSAL_25}\`` });
        }

        switch (texto) {
            case "1":
                await sock.sendMessage(from, { text: `🥉 MENSAL: R$ 25,00\n🥈 TRIMESTRAL: R$ 70,00\n🥇 ANUAL: R$ 250,00` });
                break;
            case "2":
                const userNum = from.replace(/[^0-9]/g, "");
                let db = loadDB();
                if (db.usuarios[userNum]) return await sock.sendMessage(from, { text: "❌ Você já usou seu teste hoje!" });
                estadoUsuario[from] = 'ESCOLHENDO_APP';
                await sock.sendMessage(from, { text: `1️⃣ ʙʀᴀsɪʟ ɪᴘᴛᴠ\n2️⃣ ғʟᴇxᴘʟᴀʏ\n3️⃣ ᴀssɪsᴛ+` });
                break;
            case "3":
                estadoUsuario[from] = 'ESCOLHENDO_PLANO_PIX';
                await sock.sendMessage(from, { text: `1️⃣ MENSAL\n2️⃣ TRIMESTRAL\n3️⃣ ANUAL` });
                break;
            default:
                if (!texto.includes('/')) {
                    await sock.sendMessage(from, { text: `🚀 *𝗦𝗘𝗩𝗘𝗡𝗧𝗩 𝗢ＭＮＩ-𝗦𝗧Ｒ𝗘𝗔Ｍ*\n\n1️⃣ 📋 ᴘʟᴀɴᴏs\n2️⃣ 🎁 ᴛᴇsᴛᴇ ɢʀᴀᴛɪs\n3️⃣ 💳 ᴘᴀɢᴀᴍᴇɴᴛᴏ` });
                }
                break;
        }
    });
}

realizarLogin().then(() => startBot());

