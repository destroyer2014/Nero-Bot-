import { jidNormalizedUser } from '@itsliaaa/baileys'
import { getWarns, resetWarns, setNsfw } from '../lib/nsfwGuard.js'

function targetFromMsg(ctx){const c=ctx.msg.message?.extendedTextMessage?.contextInfo;return jidNormalizedUser(c?.mentionedJid?.[0]||c?.participant||'')}
async function requireAdmin(ctx){if(!ctx.chat.endsWith('@g.us'))throw new Error('Este comando solo funciona en grupos.');const m=await ctx.sock.groupMetadata(ctx.chat);const p=m.participants.find(x=>jidNormalizedUser(x.id)===ctx.sender);if(!p?.admin&&!ctx.isOwner&&!ctx.isSubOwner)throw new Error('Solo administradores pueden usar este comando.')}
const wrap=(name,aliases,fn)=>({name,aliases,async execute(ctx){try{await fn(ctx)}catch(e){await ctx.sock.sendMessage(ctx.chat,{text:`❌ ${e.message}`},{quoted:ctx.msg})}}})
export const antinsfw=wrap('antinsfw',['nsfw'],async ctx=>{await requireAdmin(ctx);const on=(ctx.args[0]||'').toLowerCase()==='on';if(!['on','off'].includes((ctx.args[0]||'').toLowerCase()))throw new Error('Uso: .antinsfw on/off');setNsfw(ctx.chat,on);await ctx.sock.sendMessage(ctx.chat,{text:`🛡️ Anti-NSFW ${on?'activado':'desactivado'}.\nUmbral: 70%\n3 advertencias: expulsión.`},{quoted:ctx.msg})})
export const warns=wrap('warns',[],async ctx=>{await requireAdmin(ctx);const t=targetFromMsg(ctx);if(!t)throw new Error('Menciona o responde al usuario.');await ctx.sock.sendMessage(ctx.chat,{text:`⚠️ @${t.split('@')[0]} tiene ${getWarns(ctx.chat,t)}/3 advertencias.`,mentions:[t]},{quoted:ctx.msg})})
export const resetwarn=wrap('resetwarn',[],async ctx=>{await requireAdmin(ctx);const t=targetFromMsg(ctx);if(!t)throw new Error('Menciona o responde al usuario.');resetWarns(ctx.chat,t);await ctx.sock.sendMessage(ctx.chat,{text:`✅ Advertencias reiniciadas para @${t.split('@')[0]}.`,mentions:[t]},{quoted:ctx.msg})})
export const moderationCommands=[antinsfw,warns,resetwarn]
