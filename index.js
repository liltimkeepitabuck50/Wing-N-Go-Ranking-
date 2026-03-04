// index.js
require("dotenv").config();
const express = require("express");
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");
const noblox = require("noblox.js");

// --- CONFIG ---
const ALLOWED_ROLE_ID = process.env.ALLOWED_ROLE_ID;
const RANK_LOG_CHANNEL_ID = process.env.RANK_LOG_CHANNEL_ID;
const EMBED_COLOR = "#2E6F40";

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// In‑memory store for pending rank actions (staffId_userId -> { reason, username })
const pendingRank = new Map();

// --- EXPRESS SERVER FOR RENDER + UPTIMEROBOT ---
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(process.env.PORT || 3000, () =>
    console.log("Webserver running for Render/UptimeRobot.")
);

// --- SLASH COMMANDS ---
const commands = [
    new SlashCommandBuilder()
        .setName("changerank")
        .setDescription("Change a user's rank in the Roblox group")
        .addStringOption(option =>
            option.setName("robloxuser")
                .setDescription("The Roblox username")
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("viewrank")
        .setDescription("View a user's rank in the Roblox group")
        .addStringOption(option =>
            option.setName("robloxuser")
                .setDescription("The Roblox username")
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// --- ROBLOX LOGIN ---
async function startRoblox() {
    try {
        await noblox.setCookie(process.env.ROBLOX_COOKIE);
        console.log("Logged into Roblox.");
    } catch (err) {
        console.error("Roblox login failed:", err);
    }
}

client.on("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log("Slash commands registered.");
    } catch (err) {
        console.error("Failed to register commands:", err);
    }

    await startRoblox();
});

// --- MAIN INTERACTION HANDLER ---
client.on("interactionCreate", async interaction => {
    // --- /changerank (open modal) ---
    if (interaction.isChatInputCommand() && interaction.commandName === "changerank") {
        // Role restriction
        if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
            const embed = new EmbedBuilder()
                .setTitle("Permission Denied")
                .setDescription("You do not have permission to use this command.")
                .setColor(EMBED_COLOR);
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const username = interaction.options.getString("robloxuser");

        const modal = new ModalBuilder()
            .setCustomId(`rankreason_${interaction.user.id}_${username}`)
            .setTitle("Reason");

        const reasonInput = new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Reason")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const row = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(row);

        return interaction.showModal(modal);
    }

    // --- /viewrank ---
    if (interaction.isChatInputCommand() && interaction.commandName === "viewrank") {
        const username = interaction.options.getString("robloxuser");

        const loadingEmbed = new EmbedBuilder()
            .setTitle("Fetching Rank")
            .setDescription(`Getting rank information for **${username}**...`)
            .setColor(EMBED_COLOR);

        await interaction.reply({ embeds: [loadingEmbed], ephemeral: true });

        try {
            const userId = await noblox.getIdFromUsername(username);
            const rankNumber = await noblox.getRankInGroup(process.env.GROUP_ID, userId);
            const roles = await noblox.getRoles(process.env.GROUP_ID);
            const rankInfo = roles.find(r => r.rank === rankNumber);
            const rankName = rankInfo ? rankInfo.name : "Unknown Rank";

            const avatarUrl =
                `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`;

            const embed = new EmbedBuilder()
                .setTitle("Rank Information")
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: "Username", value: username, inline: true },
                    { name: "User ID", value: String(userId), inline: true },
                    { name: "Rank Number", value: String(rankNumber), inline: true },
                    { name: "Rank Name", value: rankName, inline: true }
                )
                .setColor(EMBED_COLOR);

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error(err);
            const errorEmbed = new EmbedBuilder()
                .setTitle("Error")
                .setDescription("Could not fetch rank info. Check the username or group ID.")
                .setColor(EMBED_COLOR);
            await interaction.editReply({ embeds: [errorEmbed] });
        }

        return;
    }

    // --- MODAL SUBMIT (Reason for ranking) ---
    if (interaction.isModalSubmit() && interaction.customId.startsWith("rankreason_")) {
        const parts = interaction.customId.split("_");
        const staffId = parts[1];
        const username = parts.slice(2).join("_");

        if (interaction.user.id !== staffId) {
            const embed = new EmbedBuilder()
                .setTitle("Invalid Interaction")
                .setDescription("This modal is not for you.")
                .setColor(EMBED_COLOR);
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const reason = interaction.fields.getTextInputValue("reason");

        const loadingEmbed = new EmbedBuilder()
            .setTitle("Fetching Ranks")
            .setDescription(`Getting group ranks for **${username}**...`)
            .setColor(EMBED_COLOR);

        await interaction.reply({ embeds: [loadingEmbed], ephemeral: true });

        try {
            const userId = await noblox.getIdFromUsername(username);
            const roles = await noblox.getRoles(process.env.GROUP_ID);

            const options = roles.map(role => ({
                label: role.name,
                value: String(role.rank)
            }));

            const menu = new StringSelectMenuBuilder()
                .setCustomId(`rankselect_${staffId}_${userId}`)
                .setPlaceholder("Select a new rank")
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(menu);

            const embed = new EmbedBuilder()
                .setTitle("Select New Rank")
                .setDescription(`Choose a new rank for **${username}**`)
                .setColor(EMBED_COLOR);

            // store pending data
            pendingRank.set(`${staffId}_${userId}`, { reason, username });

            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });
        } catch (err) {
            console.error(err);
            const errorEmbed = new EmbedBuilder()
                .setTitle("Error")
                .setDescription("Could not fetch user or ranks. Check the username or group ID.")
                .setColor(EMBED_COLOR);
            await interaction.editReply({ embeds: [errorEmbed], components: [] });
        }

        return;
    }

    // --- DROPDOWN SELECTION (rankselect) ---
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rankselect_")) {
        const parts = interaction.customId.split("_");
        const staffId = parts[1];
        const userId = parts[2];

        if (interaction.user.id !== staffId) {
            const embed = new EmbedBuilder()
                .setTitle("Invalid Interaction")
                .setDescription("This selection is not for you.")
                .setColor(EMBED_COLOR);
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const key = `${staffId}_${userId}`;
        const data = pendingRank.get(key);
        if (!data) {
            const embed = new EmbedBuilder()
                .setTitle("Session Expired")
                .setDescription("No pending rank action found. Please run the command again.")
                .setColor(EMBED_COLOR);
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const { reason, username } = data;
        const newRank = Number(interaction.values[0]);

        const processingEmbed = new EmbedBuilder()
            .setTitle("Processing Rank Change")
            .setDescription("Updating rank, please wait...")
            .setColor(EMBED_COLOR);

        await interaction.update({
            embeds: [processingEmbed],
            components: []
        });

        try {
            const oldRank = await noblox.getRankInGroup(process.env.GROUP_ID, userId);
            await noblox.setRank(process.env.GROUP_ID, userId, newRank);

            const avatarUrl =
                `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`;

            // Confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setTitle("Rank Updated")
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: "Username", value: username, inline: true },
                    { name: "User ID", value: String(userId), inline: true },
                    { name: "Old Rank", value: String(oldRank), inline: true },
                    { name: "New Rank", value: String(newRank), inline: true },
                    { name: "Reason", value: reason, inline: false }
                )
                .setColor(EMBED_COLOR);

            await interaction.editReply({ embeds: [confirmEmbed] });

            // Log embed
            if (RANK_LOG_CHANNEL_ID) {
                try {
                    const logChannel =
                        client.channels.cache.get(RANK_LOG_CHANNEL_ID) ||
                        await client.channels.fetch(RANK_LOG_CHANNEL_ID);

                    if (logChannel && logChannel.isTextBased()) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle("Rank Change Logged")
                            .setThumbnail(avatarUrl)
                            .addFields(
                                { name: "Staff Member", value: `<@${staffId}>`, inline: true },
                                { name: "Username", value: username, inline: true },
                                { name: "User ID", value: String(userId), inline: true },
                                { name: "Old Rank", value: String(oldRank), inline: true },
                                { name: "New Rank", value: String(newRank), inline: true },
                                { name: "Reason", value: reason, inline: false }
                            )
                            .setTimestamp(new Date())
                            .setColor(EMBED_COLOR);

                        await logChannel.send({ embeds: [logEmbed] });
                    }
                } catch (logErr) {
                    console.error("Failed to send rank log:", logErr);
                }
            }

            pendingRank.delete(key);
        } catch (err) {
            console.error(err);
            const errorEmbed = new EmbedBuilder()
                .setTitle("Error")
                .setDescription("Failed to change rank. Check permissions or rank hierarchy.")
                .setColor(EMBED_COLOR);
            await interaction.editReply({ embeds: [errorEmbed] });
        }

        return;
    }
});

client.login(process.env.TOKEN);
