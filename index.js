import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  InteractionType,
} from 'discord.js';

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OPEN_CLOUD_KEY = process.env.OPEN_CLOUD_KEY;
const GROUP_ID = process.env.GROUP_ID;
const ALLOWED_RANKER_ROLE_ID = process.env.ALLOWED_RANKER_ROLE_ID;
const RANK_LOG_CHANNEL_ID = process.env.RANK_LOG_CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const commands = [
  new SlashCommandBuilder()
    .setName('viewrank')
    .setDescription('View a Roblox user’s rank in the group.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('changerank')
    .setDescription('Change a Roblox user’s rank in the group.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a Roblox user one rank up.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demote a Roblox user one rank down.')
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands },
  );
}

function hasRankPermission(member) {
  if (!ALLOWED_RANKER_ROLE_ID) return false;
  return member.roles.cache.has(ALLOWED_RANKER_ROLE_ID);
}

async function getUserIdFromUsername(username) {
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: true,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.data || !data.data[0] || !data.data[0].id) return null;
  return data.data[0].id.toString();
}

async function getRobloxUserName(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) return `User ${userId}`;
  const data = await res.json();
  return data.name || `User ${userId}`;
}

async function getGroupMember(userId) {
  const res = await fetch(
    `https://apis.roblox.com/cloud/v2/groups/${GROUP_ID}/members/${userId}`,
    {
      method: 'GET',
      headers: {
        'x-api-key': OPEN_CLOUD_KEY,
        'Content-Type': 'application/json',
      },
    },
  );
  if (!res.ok) return null;
  return res.json();
}

async function getGroupRoles() {
  const res = await fetch(
    `https://apis.roblox.com/cloud/v2/groups/${GROUP_ID}/roles`,
    {
      method: 'GET',
      headers: {
        'x-api-key': OPEN_CLOUD_KEY,
        'Content-Type': 'application/json',
      },
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.roles || [];
}

async function updateGroupMemberRole(userId, roleId) {
  const res = await fetch(
    `https://apis.roblox.com/cloud/v2/groups/${GROUP_ID}/members/${userId}`,
    {
      method: 'PATCH',
      headers: {
        'x-api-key': OPEN_CLOUD_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: { id: roleId },
      }),
    },
  );
  if (!res.ok) return null;
  return res.json();
}

function buildAvatarUrl(userId) {
  return `https://www.roblox.com/bust-thumbnail/image?userId=${userId}&width=420&height=420&format=png`;
}

function buildRankEmbed({ title, username, userId, oldRole, newRole, reason, staff }) {
  const fields = [];

  if (username) {
    fields.push({
      name: 'Username',
      value: username,
      inline: true,
    });
  }

  if (userId) {
    fields.push({
      name: 'Roblox ID',
      value: String(userId),
      inline: true,
    });
  }

  if (oldRole) {
    fields.push({
      name: 'Old Role',
      value: `${oldRole.name} (${oldRole.id})`,
      inline: true,
    });
  }

  if (newRole) {
    fields.push({
      name: 'New Role',
      value: `${newRole.name} (${newRole.id})`,
      inline: true,
    });
  }

  if (reason) {
    fields.push({
      name: 'Reason',
      value: reason,
      inline: true,
    });
  }

  if (staff) {
    fields.push({
      name: 'Staff',
      value: staff,
      inline: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x2E6F40)
    .setTimestamp();

  if (userId) {
    embed.setThumbnail(buildAvatarUrl(userId));
  }

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  return embed;
}

async function sendLog(interaction, embed) {
  if (!RANK_LOG_CHANNEL_ID) return;
  const channel = await interaction.guild.channels.fetch(RANK_LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch(() => null);
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.type === InteractionType.ApplicationCommand) {
      if (interaction.commandName === 'viewrank') {
        const modal = new ModalBuilder()
          .setCustomId('viewrankModal')
          .setTitle('View Rank');

        const usernameInput = new TextInputBuilder()
          .setCustomId('username')
          .setLabel('Roblox Username')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(usernameInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
      }

      if (interaction.commandName === 'changerank') {
        if (!hasRankPermission(interaction.member)) {
          const embed = buildRankEmbed({
            title: 'Permission Denied',
            reason: 'You do not have permission to use this command.',
            staff: interaction.user.tag,
          });
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId('changerankModal')
          .setTitle('Change Rank');

        const usernameInput = new TextInputBuilder()
          .setCustomId('username')
          .setLabel('Roblox Username')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const roleNameInput = new TextInputBuilder()
          .setCustomId('rolename')
          .setLabel('Target Role Name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(usernameInput);
        const row2 = new ActionRowBuilder().addComponents(roleNameInput);
        const row3 = new ActionRowBuilder().addComponents(reasonInput);

        modal.addComponents(row1, row2, row3);

        await interaction.showModal(modal);
      }

      if (interaction.commandName === 'promote') {
        if (!hasRankPermission(interaction.member)) {
          const embed = buildRankEmbed({
            title: 'Permission Denied',
            reason: 'You do not have permission to use this command.',
            staff: interaction.user.tag,
          });
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId('promoteModal')
          .setTitle('Promote User');

        const usernameInput = new TextInputBuilder()
          .setCustomId('username')
          .setLabel('Roblox Username')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(usernameInput);
        const row2 = new ActionRowBuilder().addComponents(reasonInput);

        modal.addComponents(row1, row2);

        await interaction.showModal(modal);
      }

      if (interaction.commandName === 'demote') {
        if (!hasRankPermission(interaction.member)) {
          const embed = buildRankEmbed({
            title: 'Permission Denied',
            reason: 'You do not have permission to use this command.',
            staff: interaction.user.tag,
          });
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId('demoteModal')
          .setTitle('Demote User');

        const usernameInput = new TextInputBuilder()
          .setCustomId('username')
          .setLabel('Roblox Username')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(usernameInput);
        const row2 = new ActionRowBuilder().addComponents(reasonInput);

        modal.addComponents(row1, row2);

        await interaction.showModal(modal);
      }
    }

    if (interaction.type === InteractionType.ModalSubmit) {
      if (interaction.customId === 'viewrankModal') {
        await interaction.deferReply({ ephemeral: true });

        const username = interaction.fields.getTextInputValue('username').trim();
        const userId = await getUserIdFromUsername(username);
        if (!userId) {
          return interaction.editReply('I could not find that Roblox username.');
        }

        const memberData = await getGroupMember(userId);
        if (!memberData) {
          return interaction.editReply('That user is not in the group or Open Cloud returned an error.');
        }

        const robloxName = await getRobloxUserName(userId);

        const role = memberData.role || { name: 'Unknown', id: 'Unknown' };

        const embed = buildRankEmbed({
          title: 'Rank Information',
          username: robloxName,
          userId,
          oldRole: role,
        });

        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.customId === 'changerankModal') {
        await interaction.deferReply({ ephemeral: true });

        const username = interaction.fields.getTextInputValue('username').trim();
        const roleName = interaction.fields.getTextInputValue('rolename').trim();
        const reason = interaction.fields.getTextInputValue('reason').trim();

        const userId = await getUserIdFromUsername(username);
        if (!userId) {
          return interaction.editReply('I could not find that Roblox username.');
        }

        const memberData = await getGroupMember(userId);
        if (!memberData) {
          return interaction.editReply('That user is not in the group or Open Cloud returned an error.');
        }

        const roles = await getGroupRoles();
        if (!roles || roles.length === 0) {
          return interaction.editReply('I could not fetch the group roles from Open Cloud.');
        }

        const targetRole = roles.find(
          (r) => r.name.toLowerCase() === roleName.toLowerCase(),
        );

        if (!targetRole) {
          return interaction.editReply('I could not find a role with that name in the group.');
        }

        const oldRole = memberData.role || { name: 'Unknown', id: 'Unknown' };

        const updated = await updateGroupMemberRole(userId, targetRole.id);
        if (!updated) {
          return interaction.editReply('Failed to update the user’s role via Open Cloud.');
        }

        const robloxName = await getRobloxUserName(userId);

        const resultEmbed = buildRankEmbed({
          title: 'Rank Updated',
          username: robloxName,
          userId,
          oldRole,
          newRole: targetRole,
          reason,
          staff: interaction.user.tag,
        });

        const logEmbed = buildRankEmbed({
          title: 'Rank Change Logged',
          username: robloxName,
          userId,
          oldRole,
          newRole: targetRole,
          reason,
          staff: interaction.user.tag,
        });

        await sendLog(interaction, logEmbed);

        return interaction.editReply({ embeds: [resultEmbed] });
      }

      if (interaction.customId === 'promoteModal') {
        await interaction.deferReply({ ephemeral: true });

        const username = interaction.fields.getTextInputValue('username').trim();
        const reason = interaction.fields.getTextInputValue('reason').trim();

        const userId = await getUserIdFromUsername(username);
        if (!userId) {
          return interaction.editReply('I could not find that Roblox username.');
        }

        const memberData = await getGroupMember(userId);
        if (!memberData) {
          return interaction.editReply('That user is not in the group or Open Cloud returned an error.');
        }

        const roles = await getGroupRoles();
        if (!roles || roles.length === 0) {
          return interaction.editReply('I could not fetch the group roles from Open Cloud.');
        }

        const currentRole = memberData.role;
        if (!currentRole) {
          return interaction.editReply('Could not determine the user’s current role.');
        }

        const sortedRoles = roles.slice().sort((a, b) => a.rank - b.rank);
        const currentIndex = sortedRoles.findIndex((r) => r.id === currentRole.id);
        if (currentIndex === -1) {
          return interaction.editReply('User’s current role is not in the role list.');
        }

        const nextRole = sortedRoles[currentIndex + 1];
        if (!nextRole) {
          return interaction.editReply('This user is already at the highest rank.');
        }

        const updated = await updateGroupMemberRole(userId, nextRole.id);
        if (!updated) {
          return interaction.editReply('Failed to promote the user via Open Cloud.');
        }

        const robloxName = await getRobloxUserName(userId);

        const resultEmbed = buildRankEmbed({
          title: 'User Promoted',
          username: robloxName,
          userId,
          oldRole: currentRole,
          newRole: nextRole,
          reason,
          staff: interaction.user.tag,
        });

        const logEmbed = buildRankEmbed({
          title: 'Promotion Logged',
          username: robloxName,
          userId,
          oldRole: currentRole,
          newRole: nextRole,
          reason,
          staff: interaction.user.tag,
        });

        await sendLog(interaction, logEmbed);

        return interaction.editReply({ embeds: [resultEmbed] });
      }

      if (interaction.customId === 'demoteModal') {
        await interaction.deferReply({ ephemeral: true });

        const username = interaction.fields.getTextInputValue('username').trim();
        const reason = interaction.fields.getTextInputValue('reason').trim();

        const userId = await getUserIdFromUsername(username);
        if (!userId) {
          return interaction.editReply('I could not find that Roblox username.');
        }

        const memberData = await getGroupMember(userId);
        if (!memberData) {
          return interaction.editReply('That user is not in the group or Open Cloud returned an error.');
        }

        const roles = await getGroupRoles();
        if (!roles || roles.length === 0) {
          return interaction.editReply('I could not fetch the group roles from Open Cloud.');
        }

        const currentRole = memberData.role;
        if (!currentRole) {
          return interaction.editReply('Could not determine the user’s current role.');
        }

        const sortedRoles = roles.slice().sort((a, b) => a.rank - b.rank);
        const currentIndex = sortedRoles.findIndex((r) => r.id === currentRole.id);
        if (currentIndex === -1) {
          return interaction.editReply('User’s current role is not in the role list.');
        }

        const nextRole = sortedRoles[currentIndex - 1];
        if (!nextRole) {
          return interaction.editReply('This user is already at the lowest rank.');
        }

        const updated = await updateGroupMemberRole(userId, nextRole.id);
        if (!updated) {
          return interaction.editReply('Failed to demote the user via Open Cloud.');
        }

        const robloxName = await getRobloxUserName(userId);

        const resultEmbed = buildRankEmbed({
          title: 'User Demoted',
          username: robloxName,
          userId,
          oldRole: currentRole,
          newRole: nextRole,
          reason,
          staff: interaction.user.tag,
        });

        const logEmbed = buildRankEmbed({
          title: 'Demotion Logged',
          username: robloxName,
          userId,
          oldRole: currentRole,
          newRole: nextRole,
          reason,
          staff: interaction.user.tag,
        });

        await sendLog(interaction, logEmbed);

        return interaction.editReply({ embeds: [resultEmbed] });
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const embed = buildRankEmbed({
        title: 'Error',
        reason: 'An unexpected error occurred while processing this interaction.',
      });
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] }).catch(() => null);
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => null);
      }
    }
  }
});

registerCommands()
  .then(() => {
    console.log('Commands registered.');
    return client.login(TOKEN);
  })
  .catch((err) => {
    console.error('Failed to register commands or login:', err);
  });
