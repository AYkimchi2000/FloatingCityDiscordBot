// 不夜之城，查看包廂排行

const {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags,
    ChannelType,
    EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// Must match the file used by voice-record
const RECORDS_FILE = path.join(process.cwd(), '不夜之城排行榜.json');
const topN = 2

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

function loadRecords() {
    if (!fs.existsSync(RECORDS_FILE)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
        return {
            channels: data.channels || {},
            firstPlaceHolders: data.firstPlaceHolders || [],
            secondPlaceHolders: data.secondPlaceHolders || [],
            history: data.history || []
        };
    } catch (err) {
        console.error('Failed to read records file:', err);
        return null;
    }
}

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('check-records')
        .setDescription('查看已記錄的包廂存活排行榜（不會更新排行榜/身分組）')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild])
        .addStringOption(option =>
            option
                .setName('活動')
                .setDescription('選擇要查看哪個活動的排行榜')
                .setRequired(true)
                .addChoices(
                    { name: '不夜之城包廂活動', value: '1537048664353153054' },
                )
        )
        .addBooleanOption(option =>
            option
                .setName('私人回覆')
                .setDescription('是 = 只有你看得到回覆；否 = 公開（預設）')
                .setRequired(false)
        ),
        // .addIntegerOption(option =>
        //     option
        //         .setName('數量')
        //         .setDescription('顯示前幾名（預設 10）')
        //         .setMinValue(1)
        //         .setMaxValue(20)
        //         .setRequired(false)
        // ),

    async execute(interaction) {
        const ephemeral = interaction.options.getBoolean('私人回覆') ?? false;
        await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
        try {
            const categoryId = interaction.options.getString('活動');
            

            const data = loadRecords();
            if (!data || Object.keys(data.channels).length === 0) {
                return interaction.editReply('❌ 目前沒有任何排行榜紀錄，請先"/update-records"更新排行榜。');
            }

            const now = Date.now();
            const guild = interaction.guild;

            // Rebuild the ranking using the same rules as voice-record
            const ranking = Object.values(data.channels)
                .filter(rec => rec.categoryId === categoryId)
                .map(rec => {
                    const liveChannel = guild.channels.cache.get(rec.id);
                    const isLive = !!liveChannel && liveChannel.type === ChannelType.GuildVoice;

                    let eligible;
                    let endTime;
                    if (isLive) {
                        const size = liveChannel.members.size;
                        eligible = size > 0 && size <= 5;
                        endTime = now;
                    } else {
                        eligible = rec.members && rec.members.length > 0;
                        endTime = rec.endedAt ?? rec.lastSeenAt;
                    }

                    return {
                        rec,
                        isLive,
                        eligible,
                        aliveTimeMs: endTime - rec.createdAt,
                        name: isLive ? liveChannel.name : rec.name
                    };
                })
                .filter(r => r.eligible)
                .sort((a, b) => b.aliveTimeMs - a.aliveTimeMs);

            if (ranking.length === 0) {
                return interaction.editReply('❌ 此活動目前沒有符合資格的紀錄。');
            }

            const lines = ranking.slice(0, topN).map((r, i) => {
                const medal = MEDALS[i] ?? `**${i + 1}.**`;
                const status = r.isLive ? '⏳進行中' : '⌛過往';
                const members = r.rec.members.map(m => `<@${m.id}>`).join(' ');
                return `${medal} **${r.name}** — ${formatDuration(r.aliveTimeMs)}\n` +
                       `　${status} ・ ${members}`;
            });

            const toMentions = ids => ids.length ? ids.map(id => `<@${id}>`).join(' ') : '無';
            const lastUpdate = data.history.length
                ? data.history[data.history.length - 1].timestamp
                : null;

            const embed = new EmbedBuilder()
                .setTitle('🏆 不夜之城包廂排行榜')
                .setDescription(lines.join('\n\n').slice(0, 4000))
                .setFooter({
                    text: `共 ${ranking.length} 筆紀錄` +
                          (lastUpdate ? ` ・ 上次更新：${new Date(lastUpdate).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}` : '')
                });

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('check-records failed:', err);
            return interaction.editReply(`❌ 發生錯誤：${err.message}`);
        }
    },
};