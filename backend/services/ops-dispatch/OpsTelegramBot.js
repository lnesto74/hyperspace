/**
 * OpsTelegramBot
 *
 * One long-poll listener per bot token (works without a public HTTPS webhook —
 * same approach as PDUMind, ideal for the droplet). Handles the onboarding flow
 * (invite link → role → display name → subscribed) and inline action buttons
 * (On it / Done / Open map). Delegates persistence + routing to OpsDispatchService.
 */

import { ROLE_LABELS } from './OpsDispatchConfig.js';

const TG_API = 'https://api.telegram.org';

export class OpsTelegramBot {
  constructor(botToken, service) {
    this.botToken = botToken;
    this.service = service;
    this.offset = 0;
    this.running = false;
    this.onboarding = new Map(); // chatId -> { step, venueId, role }
    this.username = null;
  }

  async api(method, payload) {
    try {
      const res = await fetch(`${TG_API}/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message };
    }
  }

  async getMe() {
    const r = await this.api('getMe', {});
    if (r.ok && r.result?.username) {
      this.username = r.result.username;
    }
    return r;
  }

  sendMessage(chatId, text, replyMarkup) {
    const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false };
    if (replyMarkup) body.reply_markup = replyMarkup;
    return this.api('sendMessage', body);
  }

  sendPhoto(chatId, photoUrl, caption, replyMarkup) {
    const body = { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    return this.api('sendPhoto', body);
  }

  kb(rows) {
    return { inline_keyboard: rows };
  }

  btn(text, data) {
    return { text, callback_data: String(data).slice(0, 64) };
  }

  urlBtn(text, url) {
    return { text, url };
  }

  // ─── Update handling ───

  async handleUpdate(update) {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    const msg = update.message || {};
    const chat = msg.chat || {};
    const chatId = String(chat.id || '');
    const text = (msg.text || '').trim();
    const user = msg.from || {};
    if (!chatId) return;

    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const payload = parts.length > 1 ? parts[1] : '';
      await this.startOnboarding(chatId, user, payload);
    } else if (text === '/status') {
      await this.cmdStatus(chatId);
    } else if (text === '/help') {
      await this.sendMessage(chatId, '<b>Hyperspace Ops Bot</b>\nOpen the invite link from your store manager to subscribe.\n/status — your subscription');
    } else {
      const st = this.onboarding.get(chatId);
      if (st && st.step === 'custom_name') {
        await this.finishSubscribe(chatId, user, text);
      }
    }
  }

  async startOnboarding(chatId, user, payload) {
    const token = (payload || '').replace(/^sub_/, '');
    const venue = token ? this.service.resolveVenueByInvite(token) : null;
    if (!venue) {
      await this.sendMessage(chatId, 'Welcome to <b>Hyperspace Ops</b>.\n\nPlease open the invite link your store manager shared to subscribe to a venue.');
      return;
    }
    this.onboarding.set(chatId, { step: 'role', venueId: venue.id, venueName: venue.name, user });
    await this.sendMessage(
      chatId,
      `<b>Welcome to ${escapeHtml(venue.name)}</b>\n\nYou'll receive store action tasks for your role.\nChoose your role:`,
      this.kb([
        [this.btn('🛒 Visual Merchandiser', 'ob:role:merchandiser')],
        [this.btn('🧾 Cashier / Checkout', 'ob:role:cashier')],
        [this.btn('🧭 Store Lead', 'ob:role:store_lead')],
      ]),
    );
  }

  async handleCallback(cq) {
    const data = cq.data || '';
    const chatId = String(cq.message?.chat?.id || '');
    const user = cq.from || {};
    if (cq.id) await this.api('answerCallbackQuery', { callback_query_id: cq.id });

    if (data.startsWith('ob:role:')) {
      const role = data.split(':')[2];
      const st = this.onboarding.get(chatId) || {};
      st.role = role;
      st.step = 'name';
      this.onboarding.set(chatId, st);
      const uname = user.first_name || 'me';
      await this.sendMessage(chatId, 'Display name on task reports?', this.kb([
        [this.btn(`Use ${escapeHtml(uname)}`, 'ob:name:tg')],
        [this.btn('Type a custom name', 'ob:name:custom')],
      ]));
    } else if (data === 'ob:name:tg') {
      await this.finishSubscribe(chatId, user, null);
    } else if (data === 'ob:name:custom') {
      const st = this.onboarding.get(chatId) || {};
      st.step = 'custom_name';
      this.onboarding.set(chatId, st);
      await this.sendMessage(chatId, 'Reply with your display name (e.g. Marco R.)');
    } else if (data.startsWith('ack:')) {
      await this.service.handleAck(data.slice(4), chatId, user);
    } else if (data.startsWith('done:')) {
      await this.service.handleResolve(data.slice(5), chatId, user);
    }
  }

  async finishSubscribe(chatId, user, customName) {
    const st = this.onboarding.get(chatId);
    if (!st || !st.venueId) {
      await this.sendMessage(chatId, 'Please open your venue invite link to subscribe.');
      return;
    }
    const displayName = customName || user.first_name || 'Team member';
    const sub = this.service.store.upsertSubscriberFromTelegram({
      venueId: st.venueId,
      chatId,
      userId: user.id,
      displayName,
      role: st.role || 'merchandiser',
    });
    this.onboarding.delete(chatId);
    await this.sendMessage(
      chatId,
      `✅ <b>Subscribed</b>\n\n${ROLE_LABELS[sub.role]} · ${escapeHtml(st.venueName || '')}\n\nYou'll receive store action tasks via round-robin.\n/status · /help`,
    );
  }

  async cmdStatus(chatId) {
    const sub = this.service.store.findByChat(chatId);
    if (!sub) {
      await this.sendMessage(chatId, 'Not subscribed yet. Open your venue invite link to join.');
      return;
    }
    await this.sendMessage(chatId, `<b>Status</b>\n${escapeHtml(sub.displayName)} · ${sub.roleLabel}\nStatus: ${sub.status}`);
  }

  // ─── Long poll ───

  start() {
    if (this.running) return;
    this.running = true;
    this.getMe();
    this.api('deleteWebhook', { drop_pending_updates: false });
    console.log('[OpsTelegramBot] long-poll listener started');
    this.loop();
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      try {
        const result = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        if (result.ok && Array.isArray(result.result)) {
          for (const upd of result.result) {
            if (upd.update_id != null) this.offset = Math.max(this.offset, upd.update_id + 1);
            try { await this.handleUpdate(upd); } catch (e) { console.warn('[OpsTelegramBot] handler error:', e.message); }
          }
        } else if (!result.ok) {
          await sleep(3000);
        }
      } catch (err) {
        console.warn('[OpsTelegramBot] poll error:', err.message);
        await sleep(3000);
      }
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default OpsTelegramBot;
