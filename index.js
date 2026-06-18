/**
 * AstralyxPvP Discord AI Bot - Main Entry Point
 * Complete rewrite with proper architecture and security
 */

import { verifyKey, InteractionType, InteractionResponseType, InteractionResponseFlags } from 'discord-interactions';
import { validateEnvironment, logger } from './src/utils/index.js';
import { InteractionRouter } from './src/router.js';
import { RateLimiter } from './src/middleware/rateLimiter.js';
import { SecurityValidator } from './src/middleware/security.js';

// Initialize and validate environment
validateEnvironment();

const rateLimiter = new RateLimiter();
const securityValidator = new SecurityValidator();

export default {
  async fetch(request, env, ctx) {
    try {
      // Only accept POST requests
      if (request.method !== 'POST') {
        return json({ status: 'ok', message: 'Discord bot is running' }, 200);
      }

      // Extract and validate Discord signature
      const signature = request.headers.get('x-signature-ed25519');
      const timestamp = request.headers.get('x-signature-timestamp');
      const rawBody = await request.text();

      if (!signature || !timestamp) {
        logger.warn('Missing Discord signature headers');
        return json({ error: 'Invalid request' }, 401);
      }

      // Verify Discord request authenticity
      const isValid = await verifyKey(
        rawBody,
        signature,
        timestamp,
        env.DISCORD_PUBLIC_KEY
      );

      if (!isValid) {
        logger.warn('Invalid Discord signature');
        return json({ error: 'Invalid signature' }, 401);
      }

      let interaction;
      try {
        interaction = JSON.parse(rawBody);
      } catch (err) {
        logger.error('Failed to parse interaction JSON', err);
        return json({ error: 'Invalid JSON' }, 400);
      }

      // Rate limiting per user
      const userId = interaction.member?.user?.id || interaction.user?.id;
      if (userId && !rateLimiter.isAllowed(userId)) {
        logger.warn(`Rate limit exceeded for user ${userId}`);
        return json({ error: 'Rate limited' }, 429);
      }

      // Security validation
      const securityCheck = securityValidator.validate(interaction);
      if (!securityCheck.valid) {
        logger.warn(`Security check failed: ${securityCheck.reason}`);
        return json({ error: securityCheck.reason }, 403);
      }

      // Handle Discord ping verification
      if (interaction.type === InteractionType.PING) {
        return json({ type: InteractionResponseType.PONG });
      }

      // Route the interaction
      if (interaction.type === InteractionType.APPLICATION_COMMAND) {
        return await InteractionRouter.handle(interaction, env, ctx);
      }

      return json({ error: 'Unknown interaction type' }, 400);
    } catch (error) {
      logger.error('Fatal error in fetch handler', error);
      return json({ error: 'Internal server error' }, 500);
    }
  }
};

/**
 * Utility function to return JSON responses
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}