let TOKEN = ''; // 从 URL 参数获取 Bot 令牌

let ADMIN_UID = ''; // 从 URL 参数获取 Telegram 用户 ID
let SECRET = ENV_BOT_SECRET // 预设的 Webhook 密钥，仅允许符合的请求
const WEBHOOK = '/endpoint'; // Webhook 路径
const NOTIFY_INTERVAL = 3600 * 1000; // 通知间隔时间（1小时）
const fraudDb = 'https://raw.githubusercontent.com/6662024/tgsxbot/main/data/fraud.db'; // 诈骗数据库地址
const notificationUrl = 'https://raw.githubusercontent.com/6662024/tgsxbot/main/data/notification.txt'; // 通知内容文件地址
const startMsgUrl = 'https://raw.githubusercontent.com/6662024/tgsxbot/main/data/startMessage.md'; // 机器人启动消息
const enable_notification = false; // 是否启用通知

/**
 * 生成 Telegram API 请求的 URL，带可选参数
 */
function apiUrl(methodName, params = null) {
    let query = '';
    if (params) {
        query = '?' + new URLSearchParams(params).toString();
    }
    return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

/**
 * 发送请求到 Telegram 服务器
 */
function requestTelegram(methodName, body, params = null) {
    return fetch(apiUrl(methodName, params), body)
        .then(r => r.json());
}

/**
 * 生成 JSON 格式的请求体
 */
function makeReqBody(body) {
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

/**
 * 发送普通文本消息
 */
function sendMessage(msg = {}) {
    return requestTelegram('sendMessage', makeReqBody(msg));
}

/**
 * 复制消息
 */
function copyMessage(msg = {}) {
    return requestTelegram('copyMessage', makeReqBody(msg));
}

/**
 * 转发消息
 */
function forwardMessage(msg) {
    return requestTelegram('forwardMessage', makeReqBody(msg));
}

/**
 * 监听 Webhook 请求
 */
addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    TOKEN = url.searchParams.get('token');
    ADMIN_UID = url.searchParams.get('admin_uid');
    SECRET = ENV_BOT_SECRET // 预设的 Webhook 密钥，仅允许符合的请求
    // 从 URL 参数获取 TOKEN、SECRET 和 ADMIN_UID
    if (url.pathname === '/registerWebhook') {
        
       
        // 确保参数不为空
        if (!TOKEN || !SECRET || !ADMIN_UID) {
            event.respondWith(new Response('缺少必要的参数', { status: 400 }));
            return;
        }

        event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
    } else if (url.pathname === WEBHOOK) {
        // 确保在处理 Webhook 之前 TOKEN 和 SECRET 已经设置
        if (!TOKEN || !SECRET || !ADMIN_UID) {
            event.respondWith(new Response('未注册的 Webhook', { status: 400 }));
            return;
        }
        event.respondWith(handleWebhook(event));
    } else {
        event.respondWith(new Response('无效请求', { status: 404 }));
    }
});

/**
 * 处理 Webhook 请求
 */
async function handleWebhook(event) {
    // 验证请求密钥
    if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
      return new Response('未授权', { status: 403 });
    }

    // 读取请求数据
    const update = await event.request.json();
    // 异步处理更新
    event.waitUntil(onUpdate(update));

    return new Response('Ok');
}

/**
 * 处理收到的 Telegram 更新
 */
async function onUpdate(update) {
    if ('message' in update) {
        await onMessage(update.message);
    }
}

/**
 * 处理消息
 */
async function onMessage(message) {
    if (message.text === '/start') {
        let startMsg = await fetch(startMsgUrl).then(r => r.text());
        return sendMessage({
            chat_id: message.chat.id,
            text: startMsg,
        });
    }
    
    if (message.chat.id.toString() === ADMIN_UID) {
        if (!message?.reply_to_message?.chat) {
            return sendMessage({
                chat_id: ADMIN_UID,
                text: '使用方法：回复要转发的消息，并发送指令，如`/ban`、`/qban`、`/cxban`'
            });
        }
        if (/^\/ban$/.exec(message.text)) {
            return handleBlock(message);
        }
        if (/^\/qban$/.exec(message.text)) {
            return handleUnBlock(message);
        }
        if (/^\/cxban$/.exec(message.text)) {
            return checkBlock(message);
        }
        let guestChantId = await nfd.get('msg-map-' + message?.reply_to_message.message_id, { type: "json" });
        return copyMessage({
            chat_id: guestChantId,
            from_chat_id: message.chat.id,
            message_id: message.message_id,
        });
    }
    
    return handleGuestMessage(message);
}

/**
 * 处理访客消息
 */
async function handleGuestMessage(message) {
    let chatId = message.chat.id;
    let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" });

    if (isblocked) {
        return sendMessage({
            chat_id: chatId,
            text: '你已被屏蔽'
        });
    }

    let forwardReq = await forwardMessage({
        chat_id: ADMIN_UID,
        from_chat_id: message.chat.id,
        message_id: message.message_id
    });
    console.log(JSON.stringify(forwardReq));
    if (forwardReq.ok) {
        await nfd.put('msg-map-' + forwardReq.result.message_id, chatId);
    }
    return handleNotify(message);
}

/**
 * 处理通知
 */
async function handleNotify(message) {
    let chatId = message.chat.id;
    if (await isFraud(chatId)) {
        return sendMessage({
            chat_id: ADMIN_UID,
            text: `检测到骗子，UID ${chatId}`
        });
    }
    if (enable_notification) {
        let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" });
        if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
            await nfd.put('lastmsg-' + chatId, Date.now());
            return sendMessage({
                chat_id: ADMIN_UID,
                text: await fetch(notificationUrl).then(r => r.text())
            });
        }
    }
}

/**
 * 处理屏蔽用户
 */
async function handleBlock(message) {
    let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
    if (guestChantId === ADMIN_UID) {
        return sendMessage({
            chat_id: ADMIN_UID,
            text: '不能屏蔽自己'
        });
    }
    await nfd.put('isblocked-' + guestChantId, true);

    return sendMessage({
        chat_id: ADMIN_UID,
        text: `UID: ${guestChantId} 已被屏蔽`,
    });
}

/**
 * 解除屏蔽用户
 */
async function handleUnBlock(message) {
    let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });

    await nfd.put('isblocked-' + guestChantId, false);

    return sendMessage({
        chat_id: ADMIN_UID,
        text: `UID: ${guestChantId} 解除屏蔽成功`,
    });
}

/**
 * 检查用户是否被屏蔽
 */
async function checkBlock(message) {
    let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
    let blocked = await nfd.get('isblocked-' + guestChantId, { type: "json" });

    return sendMessage({
        chat_id: ADMIN_UID,
        text: `UID: ${guestChantId}` + (blocked ? ' 被屏蔽' : ' 没有被屏蔽')
    });
}

/**
 * 设置 Webhook
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
    const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}?token=${TOKEN}&admin_uid=${ADMIN_UID}`;
    const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json();
    return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

/**
 * 移除 Webhook
 */
async function unRegisterWebhook(event) {
    const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json();
    return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

/**
 * 判断是否为诈骗用户
 */
async function isFraud(id) {
    id = id.toString();
    let db = await fetch(fraudDb).then(r => r.text());
    let arr = db.split('\n').filter(v => v);
    return arr.includes(id);
}
