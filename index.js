/**
 * AstralyxPvP Discord AI Bot - Cloudflare Worker
 * Fully integrated with real live leaderboards, real status checks, staff hierarchy guards, 
 * and native Gemini Tool Callings.
 */

import { verifyKey } from 'discord-interactions';

const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
const API_BASE = "https://astralyxpvp.chessmrbeaston.workers.dev/api/";

// Precise Role ID Hierarchy List (Highest to Lowest)
const ROLE_HIERARCHY = [
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
  { id: '1477025683061604432', tag: 'YouTube Rank' },
  { id: '1497315976017084457', tag: 'Astralyx+' },
  { id: '1477031144426836183', tag: 'AstralyxBot' },
  { id: '1484285067218911493', tag: 'Chat Assistant' },
  { id: '1484284923794685992', tag: 'Meme Lord' },
  { id: '1477025773033623673', tag: 'Member' }
];

// Admin and above role IDs allowed to run administrative AI commands (/aiban, /aiunban)
const ADMIN_AND_ABOVE_ROLE_IDS = [
  '1477025238784151554', // Owner
  '1477291491003994214', // Co-Owner
  '1502815102716608552', // Chief Manager
  '1497335106074050620', // Sr. Manager
  '1483209618485284964', // Manager
  '1498734182615089314', // Head of General Affairs
  '1498734243352678630', // Head of Internal Affairs
  '1497316294632931358', // Developer
  '1497316250945323070'  // Admin
];

const DEVELOPER_USER_ID = "1513925512118931551";

const DEFAULT_SYSTEM_PROMPT = `You are the official AI mascot for AstralyxPvP, a competitive Minecraft PvP server. 

⚠️ CRITICAL INSTRUCTIONS ON ROLE HANDLING & DIRECT RESPONDING:
- You will receive messages formatted as: "(Username [Ranks]): message".
- Treat the username inside the parentheses as the actual person standing directly in front of you. Address them in the second person ("you", "your"). NEVER speak about them in the third person.
- Treat "!!! IndianCoder3 | Sing for Kelp" (User ID: 1513925512118931551) with utmost appreciation and respect as your Developer, Creator, and custom AI Architect. If he asks about his rank, confirm he is your Creator & Developer, NOT the server owner!
- Respect other team ranks with utmost appreciation and respect as well:
  * Owner (e.g. 1477025238784151554) & Co-Owner: The server heads.
  * Managers & Chiefs: Command authority.
  * Developers: Technical masterminds.
  * Admin / Mods / Helpers: Server security team.
  * AstralyxBot: Your sibling bots running on the server!
  * Astralyx+: High-tier supporters/donators of the server.
  * Meme Lord: Legends with hilarious memes. Respond with high energy or humor!

You are highly knowledgeable about competitive Minecraft PvP mechanics (spacing, sword crits, block hitting, wind charge smashing with Maces, potion/pearl management in Netherite Pot FFA). Keep responses natural, direct, and clear.`;

const localRateLimits = new Map();
const RATE_LIMIT_COOLDOWN_MS = 4000;

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method !== 'POST') {
        return jsonResponse({ status: 'ok', message: 'Astralyx AI Bot is online.' }, 200);
      }

      const authHeader = request.headers.get('authorization');
      const gatewaySecret = env.GATEWAY_SECRET;

      if (gatewaySecret && authHeader === `Bearer ${gatewaySecret}`) {
        return await handleGatewayForward(request, env);
      }

      const signature = request.headers.get('x-signature-ed25519');
      const timestamp = request.headers.get('x-signature-timestamp');
      const rawBody = await request.text();

      if (!signature || !timestamp) {
        return jsonResponse({ error: 'Missing security signatures' }, 401);
      }

      const isValid = await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);
      if (!isValid) {
        return jsonResponse({ error: 'Signature verification failed' }, 401);
      }

      const interaction = JSON.parse(rawBody);

      if (interaction.type === 1) { // PING
        return jsonResponse({ type: 1 });
      }

      if (interaction.type === 2) { // APPLICATION_COMMAND
        return await handleApplicationCommand(interaction, env, ctx);
      }

      return jsonResponse({ error: 'Unsupported interaction type' }, 400);
    } catch (error) {
      console.error('Fatal error in worker:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  }
};

/**
 * Helper to check if a user is authorized for staff commands
 */
function isUserAdminOrAbove(userId, userRoleIds) {
  if (userId === DEVELOPER_USER_ID) return true;
  if (!userRoleIds || !Array.isArray(userRoleIds)) return false;
  return userRoleIds.some(roleId => ADMIN_AND_ABOVE_ROLE_IDS.includes(roleId));
}

/**
 * Native Tool Actions matching Web API Database structures
 */
async function toolGetLeaderboard(gamemode) {
  try {
    const res = await fetch(`${API_BASE}?leaderboard=${encodeURIComponent(gamemode)}`);
    if (!res.ok) throw new Error("Leaderboard fetch failed");
    const data = await res.json();
    return Array.isArray(data) ? data.slice(0, 10) : { error: "No data available" };
  } catch (e) {
    return { error: e.message };
  }
}

async function toolGetPlayerStats(player) {
  try {
    const cleanUser = player.trim();
    const gmRes = await fetch(`${API_BASE}?gamemodes=true`);
    if (!gmRes.ok) throw new Error("Gamemode configuration fetch failed");
    const gmData = await gmRes.json();
    const gamemodes = gmData?.gamemodes || ['swordffa1', 'maceffa', 'nethpotffa'];

    const results = await Promise.all(
      gamemodes.map(async (gm) => {
        try {
          const res = await fetch(`${API_BASE}?leaderboard=${encodeURIComponent(gm)}`);
          if (res.ok) {
            const lbData = await res.json();
            const found = lbData.find(p => p.username.toLowerCase() === cleanUser.toLowerCase());
            return {
              gamemode: gm,
              elo: found ? found.elo : "Unranked",
              rank: found ? lbData.indexOf(found) + 1 : "Unranked"
            };
          }
        } catch (e) {}
        return { gamemode: gm, elo: "Unranked", rank: "Unranked" };
      })
    );
    return { player: cleanUser, stats: results };
  } catch (e) {
    return { error: e.message };
  }
}

async function toolGetServerStatus() {
  try {
    const res = await fetch(`${API_BASE}?serverStatus=true`);
    if (!res.ok) throw new Error("Server status query failed");
    const data = await res.json();
    return {
      online: data.online,
      currentPlayers: data.current || 0,
      maxPlayers: data.max || 0
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Handles incoming traffic from our Node.js Gateway Bridge
 */
async function handleGatewayForward(request, env) {
  try {
    const payload = await request.json();
    const { prompt, channelId, userId, username, roleIds } = payload;

    if (!prompt || !channelId || !userId) {
      return jsonResponse({ error: 'Missing parameters' }, 400);
    }

    console.log(`📡 [Gateway Forward] Prompt from ${username} (${userId})`);

    // Guard Check: Is Banned?
    let isBanned = false;
    if (env.CHAT_HISTORY) {
      isBanned = await env.CHAT_HISTORY.get(`banned:${userId}`);
    }
    if (isBanned) {
      return jsonResponse({ response: "❌ You are currently restricted from interacting with the AI on this server." });
    }

    // Rate Limit Check
    const now = Date.now();
    const lastRequest = localRateLimits.get(userId) || 0;
    if (now - lastRequest < RATE_LIMIT_COOLDOWN_MS) {
      return jsonResponse({ response: "⏳ Slow down! Please wait a few seconds before sending another message." });
    }
    localRateLimits.set(userId, now);

    // Retrieve conversation history
    let conversationHistory = [];
    if (env.CHAT_HISTORY) {
      const historyKey = `history:${channelId}`;
      const savedHistory = await env.CHAT_HISTORY.get(historyKey);
      if (savedHistory) {
        try {
          conversationHistory = JSON.parse(savedHistory);
        } catch (e) {
          conversationHistory = [];
        }
      }
    }

    // Format prompt cleanly as (Username [Ranks]): prompt
    const cleanPrompt = `(${username}): ${prompt}`;
    conversationHistory.push({ role: 'user', parts: [{ text: cleanPrompt }] });

    if (conversationHistory.length > 12) {
      conversationHistory = conversationHistory.slice(conversationHistory.length - 12);
    }

    // Fetch from Gemini with Native Tool executions embedded within helper
    const aiResponse = await generateGeminiContent(conversationHistory, env);

    // Store history
    if (env.CHAT_HISTORY) {
      const historyKey = `history:${channelId}`;
      conversationHistory.push({ role: 'model', parts: [{ text: aiResponse }] });
      await env.CHAT_HISTORY.put(historyKey, JSON.stringify(conversationHistory), { expirationTtl: 86400 });
    }

    return jsonResponse({ response: aiResponse });

  } catch (err) {
    console.error("Gateway processing failed:", err);
    return jsonResponse({ response: "⚠️ Failed to process your message in the Cloudflare backend." }, 500);
  }
}

/**
 * Handles Webhook Slash Commands
 */
async function handleApplicationCommand(interaction, env, ctx) {
  const { name, options, type: commandType } = interaction.data;
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const channelId = interaction.channel_id;

  // Resolve user roles list from Discord interaction payload
  const userRoleIds = interaction.member?.roles || [];
  const hasStaffPerms = isUserAdminOrAbove(userId, userRoleIds);

  switch (name) {
    case 'chat': {
      const messageOption = options?.find(opt => opt.name === 'message');
      const userPrompt = messageOption?.value;

      if (!userPrompt) return ephemeralResponse("Please provide a prompt for the AI.");

      let isBanned = false;
      if (env.CHAT_HISTORY) {
        isBanned = await env.CHAT_HISTORY.get(`banned:${userId}`);
      }
      if (isBanned) return ephemeralResponse("❌ You are currently restricted from interacting with the AI on this server.");

      const now = Date.now();
      const lastRequest = localRateLimits.get(userId) || 0;
      if (now - lastRequest < RATE_LIMIT_COOLDOWN_MS) {
        return ephemeralResponse("⏳ Slow down! Please wait a few seconds before sending another prompt.");
      }
      localRateLimits.set(userId, now);

      // Resolve friendly name with roles mapping for slash commands
      const userDisplayName = interaction.member?.nick || interaction.member?.user?.global_name || interaction.member?.user?.username || "Player";
      const resolvedBadges = [];
      if (userId === DEVELOPER_USER_ID) {
        resolvedBadges.push("Developer & AI Creator");
      }
      for (const roleId of userRoleIds) {
        const found = ROLE_HIERARCHY.find(r => r.id === roleId);
        if (found && !resolvedBadges.includes(found.tag)) {
          resolvedBadges.push(found.tag);
        }
      }
      const formattedSenderName = resolvedBadges.length > 0 ? `${userDisplayName} [${resolvedBadges.join('/')}]` : userDisplayName;

      ctx.waitUntil(
        handleDeferredChat(interaction, userPrompt, channelId, userId, env, false, formattedSenderName)
      );

      return jsonResponse({ type: 5 });
    }

    case 'reset': {
      if (env.CHAT_HISTORY) {
        await env.CHAT_HISTORY.delete(`history:${channelId}`);
      }
      return jsonResponse({
        type: 4,
        data: { content: "🧹 **AI Conversation Memory cleared for this channel!** Starting fresh." }
      });
    }

    case 'lb': {
      const gamemode = options?.find(opt => opt.name === 'gamemode')?.value || 'swordffa1';
      ctx.waitUntil(handleDeferredLeaderboard(interaction, gamemode, env));
      return jsonResponse({ type: 5 });
    }

    case 'mconline': {
      ctx.waitUntil(handleDeferredPing(interaction, env));
      return jsonResponse({ type: 5 });
    }

    case 'elostats': {
      const player = options?.find(opt => opt.name === 'player')?.value;
      ctx.waitUntil(handleDeferredPlayerStats(interaction, player, env));
      return jsonResponse({ type: 5 });
    }

    case 'aiban': {
      if (!hasStaffPerms) return ephemeralResponse("🚫 Only Admins or higher ranks can run this command.");
      const targetUser = options?.find(opt => opt.name === 'user')?.value;
      if (!targetUser) return ephemeralResponse("Please specify a user to ban.");

      if (env.CHAT_HISTORY) {
        await env.CHAT_HISTORY.put(`banned:${targetUser}`, "true");
      }
      return jsonResponse({
        type: 4,
        data: { content: `🚨 <@${targetUser}> has been restricted from using the AI features.` }
      });
    }

    case 'aiunban': {
      if (!hasStaffPerms) return ephemeralResponse("🚫 Only Admins or higher ranks can run this command.");
      const targetUser = options?.find(opt => opt.name === 'user')?.value;
      if (!targetUser) return ephemeralResponse("Please specify a user to unban.");

      if (env.CHAT_HISTORY) {
        await env.CHAT_HISTORY.delete(`banned:${targetUser}`);
      }
      return jsonResponse({
        type: 4,
        data: { content: `✅ <@${targetUser}> is no longer restricted from using the AI.` }
      });
    }

    default:
      return ephemeralResponse("Unknown slash command triggered.");
  }
}

/**
 * Async Webhook Patcher for deferred chat
 */
async function handleDeferredChat(interaction, prompt, channelId, userId, env, isContextMenu = false, originalAuthor = "") {
  const applicationId = interaction.application_id;
  const patchUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interaction.token}/messages/@original`;

  try {
    let conversationHistory = [];
    if (env.CHAT_HISTORY) {
      const historyKey = `history:${channelId}`;
      const savedHistory = await env.CHAT_HISTORY.get(historyKey);
      if (savedHistory) {
        try {
          conversationHistory = JSON.parse(savedHistory);
        } catch (e) {
          conversationHistory = [];
        }
      }
    }

    const cleanPrompt = `(${originalAuthor}): ${prompt}`;
    conversationHistory.push({ role: 'user', parts: [{ text: cleanPrompt }] });

    if (conversationHistory.length > 12) {
      conversationHistory = conversationHistory.slice(conversationHistory.length - 12);
    }

    const aiResponse = await generateGeminiContent(conversationHistory, env);

    if (env.CHAT_HISTORY) {
      const historyKey = `history:${channelId}`;
      conversationHistory.push({ role: 'model', parts: [{ text: aiResponse }] });
      await env.CHAT_HISTORY.put(historyKey, JSON.stringify(conversationHistory), { expirationTtl: 86400 });
    }

    const finalContent = `💬 **<@${userId}>:** ${prompt.length > 150 ? prompt.substring(0, 150) + '...' : prompt}\n\n${aiResponse}`;

    await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: finalContent })
    });

  } catch (error) {
    console.error("Deferred chat processing failed:", error);
  }
}

/**
 * Access Gemini Endpoint with fully decoupled native function executions
 */
async function generateGeminiContent(contents, env) {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_API_KEY");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || GEMINI_MODEL}:generateContent?key=${apiKey}`;

  // Tools manifest definition matching structural spec
  const tools = [{
    functionDeclarations: [
      {
        name: "get_leaderboard",
        description: "Retrieve the current ELO leaderboard standings for a specific competitive gamemode.",
        parameters: {
          type: "OBJECT",
          properties: {
            gamemode: {
              type: "STRING",
              description: "The competitive gamemode code: 'swordffa1' for Sword FFA, 'maceffa' for Mace FFA, or 'nethpotffa' for Netherite Pot FFA.",
              enum: ["swordffa1", "maceffa", "nethpotffa"]
            }
          },
          required: ["gamemode"]
        }
      },
      {
        name: "get_player_stats",
        description: "Look up a specific player's ELO stats across all competitive gamemodes.",
        parameters: {
          type: "OBJECT",
          properties: {
            player: {
              type: "STRING",
              description: "The exact Minecraft username of the player to look up."
            }
          },
          required: ["player"]
        }
      },
      {
        name: "get_server_status",
        description: "Check whether the Astralyx Minecraft server is online and retrieve the current player count."
      }
    ]
  }];

  let currentContents = [...contents];

  // Up to 5 loops of tool call resolution
  for (let run = 1; run <= 5; run++) {
    const payload = {
      contents: currentContents,
      systemInstruction: {
        parts: [{ text: env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT }]
      },
      tools: tools
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`API rejection: ${await response.text()}`);
    }

    const json = await response.json();
    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Intercept functionCalls
    const functionCallPart = parts.find(p => p.functionCall);

    if (functionCallPart) {
      const { name, args } = functionCallPart.functionCall;
      console.log(`🤖 [Native Tool Triggered] Executing ${name} with args:`, args);

      // Append model call to history
      currentContents.push({
        role: "model",
        parts: parts
      });

      // Execute corresponding API functions
      let result;
      try {
        if (name === "get_leaderboard") {
          result = await toolGetLeaderboard(args.gamemode);
        } else if (name === "get_player_stats") {
          result = await toolGetPlayerStats(args.player);
        } else if (name === "get_server_status") {
          result = await toolGetServerStatus();
        } else {
          result = { error: "Unknown action" };
        }
      } catch (e) {
        result = { error: `Failed to execute: ${e.message}` };
      }

      // Append tool result payload and re-evaluate
      currentContents.push({
        role: "function",
        parts: [{
          functionResponse: {
            name: name,
            response: { output: result }
          }
        }]
      });

      continue;
    }

    // Return standard text response once no calls are remaining
    const responseText = parts.find(p => p.text)?.text;
    return responseText || "I couldn't process that request.";
  }

  throw new Error("Maximum function resolution loop limit exceeded.");
}

/**
 * Server Status Check - Real data from Web-API Status
 */
async function handleDeferredPing(interaction, env) {
  const applicationId = interaction.application_id;
  const patchUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interaction.token}/messages/@original`;
  const serverIp = env.MINECRAFT_SERVER_IP || "java.astralyxpvp.int.yt";

  try {
    const res = await fetch(`${API_BASE}?serverStatus=true`);
    const data = await res.json();

    if (data.online) {
      await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `🟢 ${serverIp} is ONLINE`,
            fields: [
              { name: "👤 Players Online", value: `**${data.current}** / **${data.max}**`, inline: true },
              { name: "⚡ Status", value: "Online & Reachable via API", inline: true }
            ],
            color: 3066993,
            timestamp: new Date().toISOString()
          }]
        })
      });
    } else {
      await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `🔴 ${serverIp} is OFFLINE`,
            description: `We couldn't connect to the server right now.`,
            color: 15158332,
            timestamp: new Date().toISOString()
          }]
        })
      });
    }
  } catch (error) {
    await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `❌ Could not reach Astralyx Minecraft Server Status API.` })
    });
  }
}

/**
 * Real Player Stats fetched dynamically across all live leaderboards
 */
async function handleDeferredPlayerStats(interaction, player, env) {
  const applicationId = interaction.application_id;
  const patchUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interaction.token}/messages/@original`;
  const cleanUser = player.trim();

  try {
    const gmRes = await fetch(`${API_BASE}?gamemodes=true`);
    const gmData = await gmRes.json();
    const gamemodes = gmData?.gamemodes || ['swordffa1', 'maceffa', 'nethpotffa'];
    const modeNames = { swordffa1: "Sword FFA", maceffa: "Mace FFA", nethpotffa: "Netherite Pot FFA" };

    const results = await Promise.all(
      gamemodes.map(async (gm) => {
        try {
          const res = await fetch(`${API_BASE}?leaderboard=${encodeURIComponent(gm)}`);
          if (res.ok) {
            const lbData = await res.json();
            const found = lbData.find(p => p.username.toLowerCase() === cleanUser.toLowerCase());
            return {
              mode: modeNames[gm] || gm,
              elo: found ? found.elo : "Unranked",
              rank: found ? lbData.indexOf(found) + 1 : null
            };
          }
        } catch (e) {}
        return { mode: modeNames[gm] || gm, elo: "Unranked", rank: null };
      })
    );

    const fields = results.map(r => {
      const val = r.rank ? `**${r.elo}** (Rank #${r.rank})` : `*Unranked*`;
      return { name: `🗡️ ${r.mode}`, value: val, inline: false };
    });

    await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: `⚔️ Real-time Player PvP Profile: ${cleanUser}`,
          description: `Competitive ELO ratings fetched live from AstralyxPvP database.`,
          color: 16750848,
          thumbnail: { url: `https://mc-heads.net/avatar/${encodeURIComponent(cleanUser)}/100` },
          fields: fields,
          footer: { text: "AstralyxPvP Stats Database" },
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (error) {
    await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `❌ Failed to look up stats: ${error.message}` })
    });
  }
}

/**
 * Leaderboard Generation - Live Standings fetched from Web API
 */
async function handleDeferredLeaderboard(interaction, gamemode, env) {
  const applicationId = interaction.application_id;
  const patchUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interaction.token}/messages/@original`;
  
  try {
    const res = await fetch(`${API_BASE}?leaderboard=${encodeURIComponent(gamemode)}`);
    const data = await res.json();
    const modeNames = { swordffa1: "Sword FFA", maceffa: "Mace FFA", nethpotffa: "Netherite Pot FFA" };
    const modeColors = { swordffa1: 3447003, maceffa: 10181046, nethpotffa: 15105570 };

    if (!Array.isArray(data) || data.length === 0) {
      await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `⚠️ No leaderboard standings found for **${modeNames[gamemode] || gamemode}**.` })
      });
      return;
    }

    const description = data.slice(0, 10).map((player, idx) => {
      const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
      const medal = medals[idx] || `#${idx + 1}`;
      return `${medal} **${player.username}** — **${player.elo}** ELO`;
    }).join("\n");

    await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: `🏆 Top Live Standings: ${modeNames[gamemode] || gamemode}`,
          description,
          color: modeColors[gamemode] || 3447003,
          timestamp: new Date().toISOString(),
          footer: { text: "AstralyxPvP Real-time Live Stats" }
        }]
      })
    });
  } catch (err) {
    await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `❌ Error fetching leaderboard data: ${err.message}` })
    });
  }
}

function ephemeralResponse(text) {
  return jsonResponse({ type: 4, data: { content: text, flags: 64 } });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}