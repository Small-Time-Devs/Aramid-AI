import { botClient } from '../utils/discord.mjs';
import { Events } from 'discord.js';

export function setupCommands() {
  botClient.on(Events.MessageCreate, async message => {
    // Ignore messages from bots to prevent loops
    if (message.author.bot) return;

    // Direct mention response
    if (message.mentions.has(botClient.user)) {
      await message.reply("Hello! I'm the Aramid AI-X Trading Bot. Use !help to see what I can do!");
      return;
    }

    // Command prefix check
    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
      case 'status':
        await message.reply('🤖 Bot is running and operational!');
        break;
      
      case 'help':
        await message.reply(`Available commands:
- !status: Check if I'm working properly
- !help: Show this help message
- !ping: Check response time
- !info: Get information about me`);
        break;
      
      case 'ping':
        const reply = await message.reply('Pinging...');
        await reply.edit(`Pong! Latency is ${reply.createdTimestamp - message.createdTimestamp}ms`);
        break;
      
      case 'info':
        await message.reply('I am the Aramid AI-X Trading Bot, designed to help with trading operations and notifications!');
        break;
    }
  });
}
