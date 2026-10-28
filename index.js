
require('dotenv').config();
// Require the necessary discord.js classes
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags } = require('discord.js');


// Create a new client instance
const client = new Client({ 
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMembers,  
	]
});
client.cooldowns = new Collection();
client.commands = new Collection(); 
// attahes commands to client instance so it is as accessible everywhere as the client instance is 

function getFilesRecursively(directory) { // Function to recursively find all .js files in a folder and its subfolders
	let results = [];
	if (!fs.existsSync(directory)) return results;

	const entries = fs.readdirSync(directory, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			results = results.concat(getFilesRecursively(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.js')) {
			results.push(fullPath);
		}
	}
	return results;
}

// ---------------- COMMANDS HANDLER ----------------
const foldersPath = path.join(__dirname, 'commands');
const commandFiles = getFilesRecursively(foldersPath);

for (const filePath of commandFiles) {
	const command = require(filePath);
	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// ---------------- EVENTS HANDLER ----------------
const eventsPath = path.join(__dirname, 'events');
const eventFiles = getFilesRecursively(eventsPath);

for (const filePath of eventFiles) {
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
	} else {
		client.on(event.name, (...args) => event.execute(...args));
	}
}

// Log in to Discord with your client's token
client.login(process.env.BOT_TOKEN);
console.log("Server is up and running")

