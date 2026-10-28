const { 
    SlashCommandBuilder, 
    ApplicationIntegrationType, 
    InteractionContextType, 
    PermissionFlagsBits, 
    ChannelType 
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// Path to store the tracking record file
const RECORDS_FILE = path.join(process.cwd(), '不夜之城排行榜.json');
const 不夜之城第一名身分組id = "1564668880864026784";
const 不夜之城第二名身分組id = "1564669525730005164";
const 忽略語音包廂id = ['1537061084567969812'];

// Helper to format milliseconds into human-readable time (e.g., 2d 4h 15m 30s)
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

// Helpers to read/write records
function loadRecords() {
    if (!fs.existsSync(RECORDS_FILE)) {
        return { firstPlaceHolders: [], secondPlaceHolders: [], history: [] };
    }
    try {
        const data = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
        return {
            firstPlaceHolders: data.firstPlaceHolders || data.recordHolders || [],
            secondPlaceHolders: data.secondPlaceHolders || [],
            history: data.history || []
        };
    } catch {
        return { firstPlaceHolders: [], secondPlaceHolders: [], history: [] };
    }
}

function saveRecords(data) {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Helper to update rank roles (remove from previous holders, assign to current members)
async function updateRankRole(guild, role, currentMembersCollection, previousHolderIds = []) {
    const removedFrom = [];
    const assignedTo = [];
    const newHolderIds = [];

    const targetMemberIds = new Set(
        currentMembersCollection ? currentMembersCollection.keys() : []
    );

    // 1. Remove role from previous recorded holders no longer eligible
    for (const prevUserId of previousHolderIds) {
        if (!targetMemberIds.has(prevUserId)) {
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
    }

    // Also remove from any currently cached role members who shouldn't have it
    for (const [id, member] of role.members) {
        if (!targetMemberIds.has(id) && !previousHolderIds.includes(id)) {
            try {
                await member.roles.remove(role);
                removedFrom.push(member.displayName);
            } catch (err) {
                console.error(`Failed to remove role from ${id}:`, err);
            }
        }
    }

    // 2. Assign role to new members
    if (currentMembersCollection) {
        for (const [memberId, member] of currentMembersCollection) {
            try {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                }
                assignedTo.push(member.displayName);
                newHolderIds.push(memberId);
            } catch (err) {
                console.error(`Failed to assign role to ${member.displayName}:`, err);
            }
        }
    }

    return { removedFrom, assignedTo, newHolderIds };
}

module.exports = {
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('voice-record')
        .setDescription('Checks voice channel alive times, tracks records, and assigns 1st and 2nd rank roles')
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
        ])
        .setContexts([
            InteractionContextType.Guild,
        ])
        .addStringOption(option =>
            option
                .setName('活動')
                .setDescription('選擇更新哪個活動的排行榜')
                .setRequired(true)
                .addChoices(
                    { name: '不夜之城包廂活動', value: '1537048664353153054' },
                )
        ),

    async execute(interaction) {
        
        await interaction.deferReply();
        try {
            const categoryId = interaction.options.getString('活動');
            const category = interaction.guild.channels.cache.get(categoryId);
            const 第一名身分組 = interaction.guild.roles.cache.get(不夜之城第一名身分組id);
            const 第二名身分組 = interaction.guild.roles.cache.get(不夜之城第二名身分組id);
            const botMember = interaction.guild.members.me;

            // 1. Validation checks
            if (!category) {
                return interaction.editReply('❌ 找不到選定的活動分類頻道。');
            }
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

            // 2. Find eligible voice channels under the category
            // Condition: Voice channel, not ignored, and members present is <= 5 (and > 0)
            const now = Date.now();
            const voiceChannels = interaction.guild.channels.cache.filter(
                ch => ch.parentId === category.id && 
                    ch.type === ChannelType.GuildVoice &&
                    !忽略語音包廂id.includes(ch.id)
            );

            if (voiceChannels.size === 0) {
                return interaction.editReply(`❌ 在 **${category.name}** 分類下未找到任何語音包廂。`);
            }

            // Filter: only channels with 1 to 5 members
            const eligibleChannels = voiceChannels
                .filter(ch => ch.members.size > 0 && ch.members.size <= 5)
                .map(ch => ({
                    channel: ch,
                    aliveTimeMs: now - ch.createdTimestamp,
                    members: ch.members
                }))
                .sort((a, b) => b.aliveTimeMs - a.aliveTimeMs);

            if (eligibleChannels.length === 0) {
                return interaction.editReply(
                    `❌ 目前在 **${category.name}** 中沒有符合資格的包廂（包廂人數必須在 1 至 5 人之內）。`
                );
            }

            // Load existing record data
            const recordData = loadRecords();

            // 3. Assign 1st Place (Top 1 longest alive)
            const firstRank = eligibleChannels[0];
            const firstResult = await updateRankRole(
                interaction.guild,
                第一名身分組,
                firstRank.members,
                recordData.firstPlaceHolders
            );

            // 4. Assign 2nd Place (Top 2 longest alive, if present)
            const secondRank = eligibleChannels.length > 1 ? eligibleChannels[1] : null;
            const secondResult = await updateRankRole(
                interaction.guild,
                第二名身分組,
                secondRank ? secondRank.members : null,
                recordData.secondPlaceHolders
            );

            // 5. Save updated records
            recordData.firstPlaceHolders = firstResult.newHolderIds;
            recordData.secondPlaceHolders = secondResult.newHolderIds;
            recordData.history.push({
                timestamp: new Date().toISOString(),
                executor: interaction.user.tag,
                firstPlace: {
                    channelName: firstRank.channel.name,
                    aliveTime: formatDuration(firstRank.aliveTimeMs),
                    assignedUsers: firstResult.assignedTo
                },
                secondPlace: secondRank ? {
                    channelName: secondRank.channel.name,
                    aliveTime: formatDuration(secondRank.aliveTimeMs),
                    assignedUsers: secondResult.assignedTo
                } : null
            });
            saveRecords(recordData);

            // 6. Build response
            let reply = `🏆 **【不夜之城包廂活動】排行榜已更新！** (僅限人數 ≤ 5 人之包廂)\n\n`;

            // 1st Place Details
            reply += `🥇 **第一名：${firstRank.channel.name}**\n`;
            reply += `• 存活時間: **${formatDuration(firstRank.aliveTimeMs)}** (${firstRank.members.size} 人)\n`;
            reply += `• 身分組分配 (${第一名身分組.name}): ${firstResult.assignedTo.join(', ') || '無'}\n`;
            if (firstResult.removedFrom.length > 0) {
                reply += `• 已移除前第一名身分組: ${firstResult.removedFrom.join(', ')}\n`;
            }

            reply += `\n`;

            // 2nd Place Details
            if (secondRank) {
                reply += `🥈 **第二名：${secondRank.channel.name}**\n`;
                reply += `• 存活時間: **${formatDuration(secondRank.aliveTimeMs)}** (${secondRank.members.size} 人)\n`;
                reply += `• 身分組分配 (${第二名身分組.name}): ${secondResult.assignedTo.join(', ') || '無'}\n`;
                if (secondResult.removedFrom.length > 0) {
                    reply += `• 已移除前第二名身分組: ${secondResult.removedFrom.join(', ')}\n`;
                }
            } else {
                reply += `🥈 **第二名：** 無其他符合資格的包廂（需要人數 ≤ 5 人的其他包廂）。\n`;
            }

            return interaction.editReply(reply);

        } catch (err) {
            console.error('voice-record failed:', err);
            return interaction.editReply(`❌ 發生錯誤：${err.message}`);
        }
    },
};