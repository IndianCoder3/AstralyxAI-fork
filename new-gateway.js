/**
 * AstralyxPvP Discord AI Gateway Bridge - Render Optimized Edition
 * Optimized for Render.com platform deployment.
 */

import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WORKER_URL = process.env.WORKER_URL; 
const GATEWAY_SECRET = process.env.GATEWAY_SECRET; 

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const ROLE_MAP = [
  { id: '1477025238784151554', tag: 'Owner' },
  { id: '1477291491003994214', tag: 'Co-Owner' },
  { id: '1502815102716608552', tag: 'Chief Manager' },
  { id: '1497335106074050620', tag: 'Sr. Manager' },
  { id: '1483209618485284964', tag: 'Manager' },
  { id: '1498734182615089314', tag: 'Head of General Affairs' },
  { id: '1498734243352678630', tag: 'Head of Internal Affairs' },
  { id: '1497316294632931358', tag: 'Developer' },
  { id: '1497316250945323070', tag: 'Admin' },
  { id: '1497316120452136960', tag: 'Sr. Mod' },
  { id: '1477025502119334109', tag: 'Mod' },
  { id: '1497316057214484735', tag: 'Jr. Mod' },
  { id: '1477025528174219476', tag: 'Helper' },
  { id: '1501217374102229185', tag: 'Trial Staff' },
  { id: '1511596382706991144', tag: 'Veteran (Ex-Staff)' },
  { id: '1477025683061604432', tag: 'YouTube' },
  { id: '1497315976017084457', tag: 'Astralyx+' },
  { id: '1477031144426836183', tag: 'AstralyxBot' },
  { id: '1484285067218911493', tag: 'Chat Assistant' },
  { id: '1484284923794685992', tag: 'Meme Lord' }
];

const DEVELOPER_USER_ID = "1513925512118931551";

function resolveUserBadges(message) {
  const userId = message.author.id;
  const badges = [];
  if (userId === DEVELOPER_USER_ID) badges.push("Developer & AI Creator");
  if (message.member) {
    const roleIds = message.member.roles.cache.map(role => role.id);
    for (const item of ROLE_MAP) {
      if (roleIds.includes(item.id)) {
        if (item.tag === 'Developer' && userId === DEVELOPER_USER_ID) continue;
        badges.push(item.tag);
      }
    }
  }
  return badges;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const botMention = `<@${client.user.id}>`;
  const nicknameMention = `<@!${client.user.id}>`;
  const isMentioned = message.content.includes(botMention) || message.content.includes(nicknameMention);
  const isReplyToBot = message.reference && message.mentions.repliedUser?.id === client.user.id;

  if (isMentioned || isReplyToBot) {
    const userDisplayName = message.member?.displayName || message.author.displayName || message.author.username;
    const badges = resolveUserBadges(message);
    const badgeSuffix = badges.length > 0 ? ` [${badges.join('/')}]` : "";
    const finalFormattedName = `${userDisplayName}${badgeSuffix}`;
    const rawRoleIds = message.member?.roles.cache.map(r => r.id) || [];

    await message.channel.sendTyping();

    try {
      let cleanPrompt = message.content.replace(botMention, "").replace(nicknameMention, "").trim();
      
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_SECRET}` },
        body: JSON.stringify({ prompt: cleanPrompt, channelId: message.channel.id, userId: message.author.id, username: finalFormattedName, roleIds: rawRoleIds })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.response) await message.reply(data.response);
        else await message.reply("⚠️ Received an empty response.");
      } else {
        await message.reply("❌ Worker error occurred.");
      }
    } catch (error) {
      await message.reply("❌ Failed to reach the Cloudflare brain.");
    }
  }
});

// Render-optimized startup logic
async function startBot() {
  try {
    console.log("🚀 Logging into Discord on Render...");
    await client.login(DISCORD_TOKEN);
    console.log("✅ Bot is live and connected!");
  } catch (e) {
    console.error("❌ Critical Startup Error:", e);
    // Render will automatically restart the process if we exit with code 1
    process.exit(1); 
  }
}

startBot();