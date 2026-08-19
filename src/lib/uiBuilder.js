// ═══════════════════════════════════════════
//   YUTA BOT — src/lib/uiBuilder.js
//   Carrusel interactivo (portado del Pragmata Bot)
// ═══════════════════════════════════════════

import {
  WAProto as proto,
  prepareWAMessageMedia,
  generateWAMessageFromContent,
} from "@itsliaaa/baileys";

// ── Mapea el formato corto { tipo, texto, payload } al botón nativo real ──
function mapearBotones(botones) {
  const buttons = [];
  for (const btn of (botones || [])) {
    if (btn.tipo === "reply") {
      buttons.push({ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: btn.texto, id: btn.payload }) });
    } else if (btn.tipo === "url") {
      buttons.push({ name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: btn.texto, url: btn.payload, merchant_url: btn.payload }) });
    } else if (btn.tipo === "copy") {
      buttons.push({ name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: btn.texto, copy_code: btn.payload }) });
    }
  }
  return buttons;
}

// ── Enviar mensaje con imagen + botones ───────
// Si no hay imagen, delega en enviarInteractivo: un carrusel de 1 tarjeta
// SIN imagen genera un header vacío que WhatsApp no siempre renderiza bien
// (aparece como "mensaje no compatible"), así que ese caso usa el formato
// plano (sin carouselMessage), igual al que ya usa el menú principal.
export async function enviarBotones(sock, jid, imgUrl, bodyText, footerText, botones, quoted = null, mentions = []) {
  let img = imgUrl;
  if (imgUrl) {
    try {
      const res = await fetch(imgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      img = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.error("[BOTONES] Error descargando imagen:", e.message);
      img = null;
    }
  }

  if (!img) {
    return enviarInteractivo(sock, jid, bodyText, footerText, botones, { quoted, mentions });
  }

  return enviarCarrusel(sock, jid, "", footerText, [{
    img,
    titulo : "",
    body   : bodyText,
    footer : footerText,
    botones: botones,
  }], { quoted, mentions });
}

// ── Mensaje interactivo plano (sin carrusel), con o sin imagen ──
// Formato recomendado cuando solo se necesitan botones simples (copy/url/reply)
// sin la estructura de tarjetas del carrusel.
export async function enviarInteractivo(sock, jid, bodyText, footerText, botones, opts = {}) {
  const { quoted = null, mentions = [], imgUrl = null } = opts;

  let imageMessage = null;
  if (imgUrl) {
    try {
      const media = await prepareWAMessageMedia(
        { image: Buffer.isBuffer(imgUrl) ? imgUrl : { url: imgUrl } },
        { upload: sock.waUploadToServer }
      );
      imageMessage = media.imageMessage;
    } catch (e) {
      console.error("[INTERACTIVO] Error imagen:", e.message);
    }
  }

  const messageContent = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({ text: bodyText || "" }),
          footer: proto.Message.InteractiveMessage.Footer.create({ text: footerText || "" }),
          header: proto.Message.InteractiveMessage.Header.create({
            hasMediaAttachment: !!imageMessage,
            imageMessage: imageMessage || null,
          }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: mapearBotones(botones),
            messageParamsJson: "",
          }),
          contextInfo: mentions?.length ? { mentionedJid: mentions } : undefined,
        }),
      },
    },
  });

  const msg = generateWAMessageFromContent(jid, messageContent, { userJid: sock.user?.jid, quoted });
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  return msg;
}

export async function enviarCarrusel(sock, jid, headerGral, footerGral, tarjetas, opts = {}) {
  const { quoted = null, mentions = [] } = opts;
  const cards = [];

  for (const data of tarjetas) {
    let imageMessage = null;
    if (data.img) {
      try {
        const media = await prepareWAMessageMedia(
          { image: Buffer.isBuffer(data.img) ? data.img : { url: data.img } },
          { upload: sock.waUploadToServer }
        );
        imageMessage = media.imageMessage;
      } catch (e) {
        console.error("[CARRUSEL] Error imagen:", e.message);
      }
    }

    cards.push(proto.Message.InteractiveMessage.create({
      header: proto.Message.InteractiveMessage.Header.create({
        title: data.titulo || "", hasMediaAttachment: !!imageMessage, imageMessage: imageMessage || null,
      }),
      body  : proto.Message.InteractiveMessage.Body.create({ text: data.body || "" }),
      footer: proto.Message.InteractiveMessage.Footer.create({ text: data.footer || "" }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons: mapearBotones(data.botones), messageParamsJson: "" }),
    }));
  }

  const messageContent = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body           : proto.Message.InteractiveMessage.Body.create({ text: headerGral || "" }),
          footer         : proto.Message.InteractiveMessage.Footer.create({ text: footerGral || "" }),
          header         : proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false }),
          carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({ cards, messageVersion: 1 }),
          contextInfo    : mentions?.length ? { mentionedJid: mentions } : undefined,
        }),
      },
    },
  });

  const msg = generateWAMessageFromContent(jid, messageContent, { userJid: sock.user?.jid, quoted });
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  return msg;
}

// ── Enviar menú tipo lista (single_select) + botón principal opcional ──
// sections: [{ title: "SELECCIONE AQUI", rows: [{ title, description, id }] }]
// primaryButton: { type: "quick_reply"|"cta_url", text, value } (value = id o url)
// ── Enviar menú tipo lista (single_select) + botones extra opcionales ──
// sections: [{ title: "SELECCIONE AQUI", rows: [{ title, description, id }] }]
// extraButtons: [{ type: "quick_reply"|"cta_url", text, value }, ...]
// (se mantiene compatibilidad con el uso anterior de un solo primaryButton)
export async function enviarListaMenu(sock, jid, opts, quoted = null) {
  const {
    bodyText,
    footerText = "",
    headerImage = null,
    headerVideo = null,
    primaryButton = null,
    extraButtons = [],
    quickReplyText = null,
    quickReplyId = null,
    listButtonTitle = "Ver menú",
    sections = [],
  } = opts;

  const buttons = [];

  // Compatibilidad con el uso anterior (quickReplyText/quickReplyId/primaryButton)
  const primary = primaryButton || (quickReplyText && quickReplyId
    ? { type: "quick_reply", text: quickReplyText, value: quickReplyId }
    : null);

  const todosLosBotones = [...(primary ? [primary] : []), ...extraButtons];

  for (const btn of todosLosBotones) {
    if (btn.type === "cta_url") {
      buttons.push({
        name: "cta_url",
        buttonParamsJson: JSON.stringify({ display_text: btn.text, url: btn.value, merchant_url: btn.value }),
      });
    } else {
      buttons.push({
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({ display_text: btn.text, id: btn.value }),
      });
    }
  }

  buttons.push({
    name: "single_select",
    buttonParamsJson: JSON.stringify({
      title: listButtonTitle,
      sections,
    }),
  });

  let imageMessage = null;
  if (headerImage) {
    try {
      const media = await prepareWAMessageMedia(
        { image: Buffer.isBuffer(headerImage) ? headerImage : { url: headerImage } },
        { upload: sock.waUploadToServer }
      );
      imageMessage = media.imageMessage;
    } catch (e) {
      console.error("[LISTA MENU] Error imagen:", e.message);
    }
  }

  let videoMessage = null;
  if (headerVideo && !imageMessage) {
    try {
      const media = await prepareWAMessageMedia(
        {
          video: Buffer.isBuffer(headerVideo) ? headerVideo : { url: headerVideo },
          gifPlayback: true,
        },
        { upload: sock.waUploadToServer }
      );
      videoMessage = media.videoMessage;
    } catch (e) {
      console.error("[LISTA MENU] Error video/gif:", e.message);
    }
  }

  const headerFields = imageMessage
    ? { hasMediaAttachment: true, imageMessage }
    : videoMessage
    ? { hasMediaAttachment: true, videoMessage }
    : { hasMediaAttachment: false };

  const messageContent = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({ text: bodyText || "" }),
          footer: proto.Message.InteractiveMessage.Footer.create({ text: footerText || "" }),
          header: proto.Message.InteractiveMessage.Header.create(headerFields),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons,
            messageParamsJson: "",
          }),
        }),
      },
    },
  });

  const generated = generateWAMessageFromContent(jid, messageContent, { userJid: sock.user?.jid, quoted });
  await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
  return generated;
}
