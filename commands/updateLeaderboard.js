// 不夜之城，更新包廂記錄

const { 
    SlashCommandBuilder, 
    ApplicationIntegrationType, 
    InteractionContextType, 
    PermissionFlagsBits, 
    MessageFlags,
    EmbedBuilder,
    ChannelType 
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const RECORDS_FILE = path.join(process.cwd(), '不夜之城排行榜.json');
// const config = path.join(process.cwd(), 'config.json');
const 不夜之城第一名身分組id = "1564668880864026784";
const 不夜之城第二名身分組id = "1564669525730005164";
const 忽略語音包廂id = ['1537061084567969812'];

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
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

function emptyRecords() {
    return { channels: {}, firstPlaceHolders: [], secondPlaceHolders: [], history: [] };
}

function loadRecords() {
    if (!fs.existsSync(RECORDS_FILE)) return emptyRecords();
    try {
        const data = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
        return {
            channels: data.channels || {},
            firstPlaceHolders: data.firstPlaceHolders || data.recordHolders || [],
            secondPlaceHolders: data.secondPlaceHolders || [],
            history: data.history || []
        };
    } catch {
        return emptyRecords();
    }
}

function saveRecords(data) {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Optional but recommended: call this from a channelDelete event so the exact
 * deletion time is stored. Without it, the end time falls back to the last time
 * the command saw the channel alive (lastSeenAt).
 */
function recordChannelDeletion(channel) {
    const data = loadRecords();
    const rec = data.channels[channel.id];
    if (rec && rec.endedAt == null) {
        rec.endedAt = Date.now();
        saveRecords(data);
    }
}

// Assign `role` to the given user IDs, remove it from previous holders who are no longer eligible
async function updateRankRole(guild, role, targetUserIds = [], previousHolderIds = []) {
    const removedFrom = [];
    const assignedTo = [];
    const newHolderIds = [];
    const targetSet = new Set(targetUserIds);

    // 1. Remove from previous recorded holders who no longer qualify
    for (const prevUserId of previousHolderIds) {
        if (targetSet.has(prevUserId)) continue;
        try {
            const prevMember = await guild.members.fetch(prevUserId).catch(() => null);
            if (prevMember && prevMember.roles.cache.has(role.id)) {
                await prevMember.roles.remove(role);
                removedFrom.push(prevMember.displayName);
            }
        } catch (err) {
            console.error(`Failed to remove role from ${prevUserId}:`, err);
        }
    }

    // Also remove from cached role members who shouldn't have it
    for (const [id, member] of role.members) {
        if (!targetSet.has(id) && !previousHolderIds.includes(id)) {
            try {
                await member.roles.remove(role);
                removedFrom.push(member.displayName);
            } catch (err) {
                console.error(`Failed to remove role from ${id}:`, err);
            }
        }
    }

    // 2. Assign to target users (fetched by ID, so members of deleted channels work too)
    for (const userId of targetSet) {
        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) continue; // left the server
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
            }
            assignedTo.push(member.displayName);
            newHolderIds.push(userId);
        } catch (err) {
            console.error(`Failed to assign role to ${userId}:`, err);
        }
    }

    return { removedFrom, assignedTo, newHolderIds };
}

module.exports = {
    cooldown: 5,
    recordChannelDeletion,
    data: new SlashCommandBuilder()
        .setName('update-records')
        .setDescription('以現在的包廂狀態更新排行榜')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild])
        .addStringOption(option =>
            option
                .setName('活動')
                .setDescription('選擇更新哪個活動的排行榜')
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
    

    async execute(interaction) {
        const ephemeral = interaction.options.getBoolean('私人回覆') ?? false;
        await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
        try {
            const categoryId = interaction.options.getString('活動');
            const category = interaction.guild.channels.cache.get(categoryId);
            const 第一名身分組 = interaction.guild.roles.cache.get(不夜之城第一名身分組id);
            const 第二名身分組 = interaction.guild.roles.cache.get(不夜之城第二名身分組id);
            const botMember = interaction.guild.members.me;

            // 1. Validation
            if (!category) return interaction.editReply('❌ 找不到選定的活動分類頻道。');
            if (!第一名身分組 || !第二名身分組) {
                return interaction.editReply('❌ 找不到第一名或第二名的身分組，請確認身分組 ID 是否正確。');
            }
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return interaction.editReply('❌ 我缺少 **管理身分組 (Manage Roles)** 權限。');
            }
            if (第一名身分組.position >= botMember.roles.highest.position ||
                第二名身分組.position >= botMember.roles.highest.position) {
                return interaction.editReply('❌ 第一名或第二名身分組順位高於或等於機器人的最高身分組，無法進行分配。');
            }

            const now = Date.now();
            const recordData = loadRecords();

            // 2. Live voice channels in the category
            const voiceChannels = interaction.guild.channels.cache.filter(
                ch => ch.parentId === category.id &&
                    ch.type === ChannelType.GuildVoice &&
                    !忽略語音包廂id.includes(ch.id)
            );

            // 3. Sync live channels into persistent records
            const liveEligibleIds = new Set();
            for (const ch of voiceChannels.values()) {
                const eligible = ch.members.size > 0 && ch.members.size <= 5;
                const existing = recordData.channels[ch.id];

                if (eligible) {
                    liveEligibleIds.add(ch.id);
                    recordData.channels[ch.id] = {
                        id: ch.id,
                        categoryId: category.id,
                        name: ch.name,
                        createdAt: ch.createdTimestamp,
                        // Snapshot of members while the channel was eligible
                        members: ch.members.map(m => ({ id: m.id, name: m.displayName })),
                        lastSeenAt: now,
                        endedAt: null
                    };
                } else if (existing) {
                    existing.name = ch.name;
                    existing.lastSeenAt = now;
                    existing.endedAt = null;
                }
            }

            // 4. Mark tracked channels that no longer exist as ended
            for (const rec of Object.values(recordData.channels)) {
                if (rec.categoryId !== category.id) continue;
                if (rec.endedAt != null) continue;
                if (!voiceChannels.has(rec.id)) {
                    // Exact if the channelDelete hook ran; otherwise the last time we saw it alive
                    rec.endedAt = rec.lastSeenAt;
                }
            }
            // 4b. Prune old ended channels (keep the 5 longest-lived per category)
            const KEEP_TOP = 5;
            const endedRecs = Object.values(recordData.channels)
                .filter(r => r.categoryId === category.id && r.endedAt != null)
                .sort((a, b) => (b.endedAt - b.createdAt) - (a.endedAt - a.createdAt));
            for (const r of endedRecs.slice(KEEP_TOP)) delete recordData.channels[r.id];

            // 5. Build candidate list: eligible live channels + all ended channels
            const candidates = Object.values(recordData.channels)
                .filter(rec => rec.categoryId === category.id)
                .filter(rec => {
                    if (rec.endedAt != null) return rec.members && rec.members.length > 0;
                    return liveEligibleIds.has(rec.id);
                })
                .map(rec => ({
                    rec,
                    ended: rec.endedAt != null,
                    aliveTimeMs: (rec.endedAt ?? now) - rec.createdAt
                }))
                .sort((a, b) => b.aliveTimeMs - a.aliveTimeMs);

            if (candidates.length === 0) {
                saveRecords(recordData);
                return interaction.editReply(
                    `❌ 目前在 **${category.name}** 中沒有符合資格的包廂（包廂人數必須在 1 至 5 人之內）。`
                );
            }

            // 6. Assign roles
            const firstRank = candidates[0];
            const secondRank = candidates.length > 1 ? candidates[1] : null;

            const firstResult = await updateRankRole(
                interaction.guild,
                第一名身分組,
                firstRank.rec.members.map(m => m.id),
                recordData.firstPlaceHolders
            );
            const secondResult = await updateRankRole(
                interaction.guild,
                第二名身分組,
                secondRank ? secondRank.rec.members.map(m => m.id) : [],
                recordData.secondPlaceHolders
            );

            // 7. Save
            recordData.firstPlaceHolders = firstResult.newHolderIds;
            recordData.secondPlaceHolders = secondResult.newHolderIds;
            recordData.history.push({
                timestamp: new Date().toISOString(),
                executor: interaction.user.tag,
                firstPlace: {
                    channelId: firstRank.rec.id,
                    channelName: firstRank.rec.name,
                    ended: firstRank.ended,
                    aliveTime: formatDuration(firstRank.aliveTimeMs),
                    assignedUsers: firstResult.assignedTo
                },
                secondPlace: secondRank ? {
                    channelId: secondRank.rec.id,
                    channelName: secondRank.rec.name,
                    ended: secondRank.ended,
                    aliveTime: formatDuration(secondRank.aliveTimeMs),
                    assignedUsers: secondResult.assignedTo
                } : null
            });
            const MAX_HISTORY = 50;
            if (recordData.history.length > MAX_HISTORY) {
                recordData.history = recordData.history.slice(-MAX_HISTORY);
            }
            saveRecords(recordData);

            // 8. Reply
            const status = r => (r.ended ? '⌛過往' : '⏳活動中');
            const mentions = ids => ids.length ? ids.map(id => `<@${id}>`).join(' ') : '無';
            const removed = arr => arr.length ? `\n已移除前任：${arr.join(', ')}` : '';

            const embed = new EmbedBuilder()
                .setTitle('🏆 不夜之城包廂排行榜已更新')
                .setDescription('*僅限人數 ≤ 5 人之包廂，含已刪除的包廂記錄*')
                .addFields(
                    {
                        name: `🥇 第一名：${firstRank.rec.name}`,
                        value: (
                            `> ${status(firstRank)} ・ **${formatDuration(firstRank.aliveTimeMs)}** ・ ${firstRank.rec.members.length} 人\n` +
                            `> "${第一名身分組.name}"稱號：${mentions(firstResult.newHolderIds)}` +
                            removed(firstResult.removedFrom)
                        ).slice(0, 1024)
                    },
                    {
                        name: secondRank ? `🥈 第二名：${secondRank.rec.name}` : '🥈 第二名',
                        value: (secondRank
                            ? `> ${status(secondRank)} ・ **${formatDuration(secondRank.aliveTimeMs)}** ・ ${secondRank.rec.members.length} 人\n` +
                              `> "${第二名身分組.name}"稱號：${mentions(secondResult.newHolderIds)}` +
                              removed(secondResult.removedFrom)
                            : '> 無其他符合資格的包廂'
                        ).slice(0, 1024)
                    }
                )
                .setFooter({ text: `執行者：${interaction.user.tag}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('update-records failed:', err);
            return interaction.editReply(`❌ 發生錯誤：${err.message}`);
        }
    },
};