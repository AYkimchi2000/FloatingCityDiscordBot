// 不夜之城，重置排行榜（移除身分組並清除所有紀錄）

const {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const RECORDS_FILE = path.join(process.cwd(), '不夜之城排行榜.json');
const 不夜之城第一名身分組id = "1564668880864026784";
const 不夜之城第二名身分組id = "1564669525730005164";

module.exports = {
    cooldown: 10,
    data: new SlashCommandBuilder()
        .setName('reset-records')
        .setDescription('移除第一、二名身分組並清除所有排行榜紀錄（無法復原）')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption(option =>
            option
                .setName('確認')
                .setDescription('選擇「是」以確認重置')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName('私人回覆')
                .setDescription('是 = 只有你看得到回覆；否 = 公開（預設）')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.options.getBoolean('確認')) {
            return interaction.reply({ content: '已取消重置。', flags: MessageFlags.Ephemeral });
        }

        const ephemeral = interaction.options.getBoolean('私人回覆') ?? false;
        await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
        try {
            const guild = interaction.guild;
            const botMember = guild.members.me;

            const roles = [不夜之城第一名身分組id, 不夜之城第二名身分組id]
                .map(id => guild.roles.cache.get(id));

            // Validation
            if (roles.some(r => !r)) {
                return interaction.editReply('❌ 找不到第一名或第二名的身分組，請確認身分組 ID 是否正確。');
            }
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return interaction.editReply('❌ 我缺少 **管理身分組 (Manage Roles)** 權限。');
            }
            if (roles.some(r => r.position >= botMember.roles.highest.position)) {
                return interaction.editReply('❌ 身分組順位高於或等於機器人的最高身分組，無法移除。');
            }

            // Make sure role.members is fully populated
            await guild.members.fetch();

            // Remove roles and track exactly who lost them
            const removedNames = [];
            for (const role of roles) {
                const names = [];
                for (const member of role.members.values()) {
                    try {
                        await member.roles.remove(role);
                        names.push(`<@${member.id}>`);
                    } catch (err) {
                        console.error(`Failed to remove ${role.name} from ${member.id}:`, err);
                    }
                }
                removedNames.push(names);
            }

            // Wipe all records
            fs.writeFileSync(
                RECORDS_FILE,
                JSON.stringify({ channels: {}, firstPlaceHolders: [], secondPlaceHolders: [], history: [] }, null, 2),
                'utf8'
            );

            const list = names => (names.length ? names.join(' ') : '無').slice(0, 900);
            const embed = new EmbedBuilder()
                .setTitle('🧹 不夜之城包廂排行榜已重置')
                .setDescription('*相關身分組稱號已全部移除')
                .addFields(
                    {
                        name: `${roles[0].name}:`,
                        value: (
                            `>>> 從以下用戶移除:${list(removedNames[0])}\n` 
                        ).slice(0, 1024)
                    },
                    {
                        name: `${roles[1].name}:`,
                        value: (
                            `>>> 從以下用戶移除:${list(removedNames[1])}\n` 
                        ).slice(0, 1024)
                    }
                )
                .setFooter({ text: `執行者：${interaction.user.tag}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('reset-records failed:', err);
            return interaction.editReply(`❌ 發生錯誤：${err.message}`);
        }
    },
};