const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const rest = new REST().setToken(process.env.BOT_TOKEN);

// Helper function to recursively find all .js files in subfolders or directly in the folder
function getFilesRecursively(directory) {
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

// Check if the --clear flag was passed in the terminal command
const isClearMode = process.argv.includes('--clear');

(async () => {
	try {
		// unRegister the commands
		if (isClearMode) {
			console.log('Clearing ALL application commands globally...');

			// Overwrite global commands with an empty array
			await rest.put(
				Routes.applicationCommands(process.env.APP_ID),
				{ body: [] }
			);

			// Optional: Clear guild commands if a SERVER_ID is provided
			if (process.env.SERVER_ID) {
				await rest.put(
					Routes.applicationGuildCommands(process.env.APP_ID, process.env.SERVER_ID),
					{ body: [] }
				);
			}

			console.log('Successfully cleared all application (/) commands.');
			return; // Exit early
		}

		// Register the commands
		const commands = [];
		const foldersPath = path.join(__dirname, 'commands');
		const commandFiles = getFilesRecursively(foldersPath);

		for (const filePath of commandFiles) {
			const command = require(filePath);
			if ('data' in command && 'execute' in command) {
				commands.push(command.data.toJSON());
			} else {
				console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
			}
		}

		console.log(`Started refreshing ${commands.length} application (/) commands globally.`);

		const data = await rest.put(
			Routes.applicationCommands(process.env.APP_ID),
			{ body: commands }
		);

		console.log(`Successfully reloaded ${data.length} application (/) commands globally.`);
	} catch (error) {
		console.error(error);
	}
})();