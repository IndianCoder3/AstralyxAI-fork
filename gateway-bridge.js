/**
 * AstralyxPvP Discord AI Gateway Bridge
 * Run this on any 24/7 machine (your PC, home server, or VPS).
 * Uses exact Discord snowflake role IDs to resolve user metadata before sending to Cloudflare.
 */

import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch'; // If node-fetch isn't installed, run: npm install node-fetch
import 'dotenv/config';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WORKER_URL = process.env.WORKER_URL; 
const GATEWAY_SECRET = process.env.GATEWAY_SECRET; 

if (!DISCORD_TOKEN || !WORKER_URL || !GATEWAY_SECRET) {
  console.error("❌ ERROR: Missing DISCORD_TOKEN, WORKER_URL, or GATEWAY_SECRET in your .env file!");
  process.exit(1);
}

// Complete matching map of snowflake IDs to clean role tags
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`🤖 SUCCESS: Gateway Bridge is online! Logged in as: ${client.user.tag}`);
});

/**
 * Resolves precise rank tags matching the explicit server snowflake IDs
 */
function resolveUserBadges(message) {
  const userId = message.author.id;
  const badges = [];

  // Always force-assign Developer & AI Creator to the designer's ID
  if (userId === DEVELOPER_USER_ID) {
    badges.push("Developer & AI Creator");
  }

  if (message.member) {
    const roleIds = message.member.roles.cache.map(role => role.id);

    // Scan hierarchy ordered list to push corresponding tags
    for (const item of ROLE_MAP) {
      if (roleIds.includes(item.id)) {
        // Prevent duplicate creator/developer badges on yourself
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
    
    // Resolve clean metadata badges
    const badges = resolveUserBadges(message);
    const badgeSuffix = badges.length > 0 ? ` [${badges.join('/')}]` : "";
    const finalFormattedName = `${userDisplayName}${badgeSuffix}`;

    const rawRoleIds = message.member?.roles.cache.map(r => r.id) || [];

    console.log(`💬 AI Triggered by ${finalFormattedName} (User ID: ${message.author.id})`);

    try {
      let cleanPrompt = message.content
        .replace(botMention, "")
        .replace(nicknameMention, "")
        .trim();

      if (!cleanPrompt) {
        message.reply(`Hey ${userDisplayName}! What can I help you with today? (Usage: Reply to me, or type \`@AstralyxAI <your prompt>\`)`);
        return;
      }

      await message.channel.sendTyping();

      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GATEWAY_SECRET}`
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          channelId: message.channel.id,
          userId: message.author.id,
          username: finalFormattedName, 
          roleIds: rawRoleIds 
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.response) {
          await message.reply(data.response);
        } else {
          await message.reply("⚠️ Received an empty response from the Cloudflare brain.");
        }
      } else {
        console.error(`❌ Worker request failed with status: ${response.status}`);
        await message.reply("❌ The Cloudflare AI Worker returned an error while processing.");
      }

    } catch (error) {
      console.error("❌ Error during gateway handling:", error);
      await message.reply("❌ Failed to reach the Cloudflare AI brain right now.");
    }
  }
});

client.login(DISCORD_TOKEN);