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

// ==========================================
// CONFIGURAÇÕES DO THAYSON
// ==========================================
const CREDENCIAIS_PAINEL = {
    username: "thaysonsilvacavalcante@gmail.com",
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

// ==========================================
// BANCO DE DADOS LOCAL (CORRIGIDO)
// ==========================================
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
        // Garante que as chaves existam mesmo se o arquivo JSON estiver incompleto
        if (!data.testes_ativos) data.testes_ativos = {};
        if (!data.usuarios) data.usuarios = {};
        return data;
    } catch (e) {
        return { testes_ativos: {}, usuarios: {} };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

let PANEL_TOKEN = "";

async function realizarLogin() {
    try {
        const res = await axios.post(`${CREDENCIAIS_PAINEL.baseUrl}/auth/login`, {
            username: CREDENCIAIS_PAINEL.username,
            password: CREDENCIAIS_PAINEL.password
        }, {
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
        PANEL_TOKEN = res.data.token;
        return true;
    } catch (e) { return false; }
}

async function getRealExpiration(user, pass) {
    try {
        const url = `${CREDENCIAIS_PAINEL.dnsPrincipal}/player_api.php?username=${user}&password=${pass}`;
        const res = await axios.get(url);
        return res.data?.user_info?.exp_date || null;
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
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    const editMsg = async (jid, msgOriginal, novoTexto) => {
        await sock.sendMessage(jid, { text: novoTexto, edit: msgOriginal.key });
    };

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const numeroLimpo = MEU_NUMERO.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(numeroLimpo);
                console.log(`\n====================================`);
                console.log(`🔗 SEU CÓDIGO DE PAREAMENTO: ${code}`);
                console.log(`====================================\n`);
            } catch (err) { console.log("Erro ao gerar Pairing Code."); }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => { 
        if (u.connection === 'close') {
            const erro = u.lastDisconnect?.error?.output?.statusCode;
            if (erro !== DisconnectReason.loggedOut) startBot();
        } else if (u.connection === 'open') {
            console.log('✅ BOT IPTV ONLINE!');
        }
    });

    // --- MONITOR DE EXPIRAÇÃO ---
    setInterval(async () => {
        const agoraUnix = Math.floor(Date.now() / 1000);
        let db = loadDB();
        let mudou = false;

        // O erro ocorria aqui porque db.testes_ativos vinha como undefined
        for (const [key, data] of Object.entries(db.testes_ativos)) {
            if (!data.expUnix) continue;
            const diff = data.expUnix - agoraUnix;

            if (diff <= 300 && diff > 0 && !data.avisoEnviado) {
                const linkC = data.linkCheckout ? `🔗 ${data.linkCheckout}` : "_Link indisponível_";
                
                const msgUrgente = `🚨 *O TEMPO ESTÁ ACABANDO!* 🚨\n\n` +
                    `Notamos que sua diversão está prestes a ser interrompida! Seu teste vence em *5 MINUTOS*.\n\n` +
                    `💎 *RENOVE AGORA:* \n` +
                    `${linkC}\n\n` +
                    `⚠️ *ATENÇÃO:* Caso você entre no link de checkout para renovar e apareça uma mensagem dizendo que o *revendedor está sem créditos suficientes*, não se preocupe! \n\n` +
                    `Nesse caso, você deve fazer o pagamento via *PIX COPIA E COLA* para que o administrador realize sua renovação manualmente e de forma imediata.\n\n` +
                    `📍 *PARA PAGAR VIA PIX:* \n` +
                    `Digite: */renovar ${key}*\n\n` +
                    `⚡ *VANTAGENS DO VIP:* \n` +
                    `✅ Sem anúncios | ✅ Canais 4K | ✅ Suporte 24h`;

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
        const nome = msg.pushName || "Cliente";

        if (estadoUsuario[from] === 'ESCOLHENDO_APP') {
            let appNome = ""; let appCod = ""; let foto = "";
            if (texto === "1") { appNome = "Brasil IPTV"; appCod = "3234"; foto = "./brasil.jpg"; }
            else if (texto === "2") { appNome = "FlexPlay"; appCod = "3234"; foto = "./flex.jpg"; }
            else if (texto === "3") { appNome = "Assist+"; appCod = "00732"; foto = "./assist.jpg"; }
            else { return await sock.sendMessage(from, { text: "❌ Opção inválida! Escolha 1, 2 ou 3." }); }

            delete estadoUsuario[from];

            if (fs.existsSync(foto)) {
                await sock.sendMessage(from, { image: { url: foto }, caption: `📸 App *${appNome}* selecionado!` });
            }

            const msgAnim = await sock.sendMessage(from, { text: "⏳ *ɪɴɪᴄɪᴀɴᴅᴏ ɢᴇʀᴀᴄᴀᴏ...*\n[▒▒▒▒▒▒▒▒▒▒] 0%" });
            await delay(2000);
            await editMsg(from, msgAnim, "⚙️ *ᴄᴏɴᴇᴄᴛᴀɴᴅᴏ ᴀᴏ ᴘᴀɪɴᴇʟ...*\n[████▒▒▒▒▒▒] 40%");

            if (!PANEL_TOKEN) await realizarLogin();

            try {
                const res = await axios.post(`${CREDENCIAIS_PAINEL.baseUrl}/customers`, {
                    server_id: "BV4D3rLaqZ",
                    package_id: "z2BDvoWrkj",
                    connection_type: "IPTV",
                    is_trial: "YES",
                    connections: 1
                }, { 
                    headers: { 
                        "Authorization": `Bearer ${PANEL_TOKEN}`,
                        "Accept": "application/json" 
                    } 
                });

                const c = res.data.data;
                const expUnix = await getRealExpiration(c.username, c.password);
                
                let db = loadDB();
                db.testes_ativos[c.username] = {
                    whatsapp: from,
                    expUnix: expUnix || (Math.floor(Date.now() / 1000) + 21600),
                    linkCheckout: c.checkout_url || null,
                    avisoEnviado: false
                };
                db.usuarios[from.replace(/[^0-9]/g, "")] = true;
                saveDB(db);

                const final3D = `╔════════════════════╗\n` +
                                `    ✨ *𝗦𝗘𝗩𝗘𝗡𝗧𝗩 𝗨𝗟𝗧𝗥𝗔* ✨\n` +
                                `╚════════════════════╝\n\n` +
                                `✅ *ᴛᴇsᴛᴇ ʟɪʙᴇʀᴀᴅᴏ ᴄᴏᴍ sᴜᴄᴇssᴏ!*\n\n` +
                                `📱 *ᴀᴘᴘ:* ${appNome}\n` +
                                `🔢 *ᴄᴏᴅɪɢᴏ:* \`${appCod}\`\n\n` +
                                `👤 *ᴜsᴜᴀʀɪᴏ:* \`${c.username}\`\n` +
                                `🔑 *sᴇɴʜᴀ:* \`${c.password}\`\n\n` +
                                `🗓️ *ᴠᴇɴᴄɪᴍᴇɴᴛᴏ:* 6 Horas\n\n` +
                                `🌐 *ᴅɴs:* ${CREDENCIAIS_PAINEL.dnsPrincipal}\n\n` +
                                `🚀 *ᴀᴘʀᴏᴠᴇɪᴛᴇ ᴏ ᴍᴇʟʜᴏʀ ᴅᴏ sᴛʀᴇᴀᴍɪɴɢ!*`;

                await delay(1500);
                await editMsg(from, msgAnim, final3D);

            } catch (e) {
                await editMsg(from, msgAnim, "❌ *ᴇʀʀᴏ:* O painel está em manutenção. Tente novamente em 2 minutos.");
            }
            return;
        }

        if (estadoUsuario[from] === 'ESCOLHENDO_PLANO_PIX') {
            let pixCode = ""; let valorPlano = "";
            if (texto === "1") { pixCode = PIX_PLANS.MENSAL_25; valorPlano = "MENSAL (25,00)"; }
            else if (texto === "2") { pixCode = PIX_PLANS.TRIMESTRAL_70; valorPlano = "TRIMESTRAL (70,00)"; }
            else if (texto === "3") { pixCode = PIX_PLANS.ANUAL_250; valorPlano = "ANUAL (250,00)"; }
            else { return await sock.sendMessage(from, { text: "❌ Opção inválida! Escolha 1, 2 ou 3." }); }
            delete estadoUsuario[from];
            return await sock.sendMessage(from, { text: `💳 *PAGAMENTO ${valorPlano}*\n\n📍 *PIX COPIA E COLA:* \n\`${pixCode}\`\n\n🚀 *Após pagar, mande o comprovante aqui para liberação instantânea!*` });
        }

        if (texto.toLowerCase().startsWith('/renovar')) {
            const userRef = texto.split(' ')[1] || "usuário";
            return await sock.sendMessage(from, { text: `💎 *PLANO VIP SEVENTV*\n\nEstamos prontos para renovar seu sinal!\n\n👤 *Usuário:* ${userRef}\n💰 *Valor:* R$ 25,00\n\n📍 *PIX COPIA E COLA:* \n\`${PIX_PLANS.MENSAL_25}\`\n\n⚠️ *AVISO:* Envie o comprovante aqui para liberação instantânea!` });
        }

        switch (texto) {
            case "1":
                const msgPlanos = `✨ *NOSSAS OFERTAS EXCLUSIVAS* ✨\n\n` +
                    `🚀 *VENHA PARA A MELHOR EXPERIÊNCIA DIGITAL!*\n\n` +
                    `🥉 *PLANO BRONZE (Mensal)*\n` +
                    `➔ R$ 25,00 por mês\n` +
                    `➔ 1 Tela | Todos os Canais + Filmes\n\n` +
                    `🥈 *PLANO PRATA (Trimestral)*\n` +
                    `➔ R$ 70,00\n` +
                    `🥈 *PLANO OURO (Anual)*\n` +
                    `➔ R$ 250,00\n\n` +
                    `*Digite 3 para gerar o código PIX!*`;
                await sock.sendMessage(from, { text: msgPlanos });
                break;

            case "2":
                const userNum = from.replace(/[^0-9]/g, "");
                let db = loadDB();
                if (db.usuarios[userNum]) return await sock.sendMessage(from, { text: "❌ *OPERAÇÃO NEGADA!*\n\nVocê já utilizou sua cota de teste gratuito hoje. Deseja assinar um plano? Digite *1*." });

                estadoUsuario[from] = 'ESCOLHENDO_APP';
                const menuApps = `╔════════════════════╗\n` +
                                 `    ⭐ *𝗘𝗦𝗖𝗢𝗟𝗛𝗔 𝗦𝗘𝗨 𝗔𝗣𝗣* ⭐\n` +
                                 `╚════════════════════╝\n\n` +
                                 `1️⃣ ʙʀᴀsɪʟ ɪᴘᴛᴠ\n` +
                                 `2️⃣ ғʟᴇxᴘʟᴀʏ\n` +
                                 `3️⃣ ᴀssɪsᴛ+\n\n` +
                                 `_Responda apenas o número da opção!_`;
                await sock.sendMessage(from, { text: menuApps });
                break;

            case "3":
                estadoUsuario[from] = 'ESCOLHENDO_PLANO_PIX';
                await sock.sendMessage(from, { text: `💳 *PAGAMENTO INSTANTÂNEO PIX*\n\nSelecione o plano desejado:\n\n1️⃣ *MENSAL (25,00)*\n2️⃣ *TRIMESTRAL (70,00)*\n3️⃣ *ANUAL (250,00)*\n\n_Digite apenas o número da opção._` });
                break;

            default:
                if (!texto.includes('/')) {
                    const menu3D = `╔════════════════════╗\n` +
                                   `   🚀 *𝗦𝗘𝗩𝗘𝗡𝗧𝗩 𝗢𝗠𝗡𝗜-𝗦𝗧𝗥𝗘𝗔𝗠* \n` +
                                   `╚════════════════════╝\n\n` +
                                   `👋 ᴏʟᴀ, *${nome.toUpperCase()}*!\n\n` +
                                   `1️⃣ 📋 *ᴘʟᴀɴᴏs ᴇ ᴠᴀʟᴏʀᴇs*\n` +
                                   `2️⃣ 🎁 *ɢᴇʀᴀʀ ᴛᴇsᴛᴇ ɢʀᴀᴛɪs*\n` +
                                   `3️⃣ 💳 *ᴘᴀɢᴀᴍᴇɴᴛᴏ ᴘɪｘ*\n\n` +
                                   `_ᴅɪɢɪᴛᴇ ᴏ ɴᴜᴍᴇʀᴏ ᴅᴀ ᴏᴘᴄᴀᴏ ᴅᴇsᴇᴊᴀᴅᴀ_`;
                    await sock.sendMessage(from, { text: menu3D });
                }
                break;
        }
    });
}

realizarLogin().then(() => startBot());
