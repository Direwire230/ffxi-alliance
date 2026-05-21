import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const commands = [

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Manage your FFXI character job profile')
    .addSubcommandGroup(group => group
      .setName('jobs')
      .setDescription('Manage the FFXI jobs you can play')
      .addSubcommand(sub => sub
        .setName('set')
        .setDescription('Replace your saved job list, comma-separated like PLD, WHM, COR')
        .addStringOption(o => o.setName('jobs').setDescription('Your jobs/classes, comma-separated').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add one job to your saved job list')
        .addStringOption(o => o.setName('job').setDescription('Job/class to add, like PLD').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Remove one job from your saved job list')
        .addStringOption(o => o.setName('job').setDescription('Job/class to remove, like PLD').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('Show your saved FFXI jobs'))),
  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create and manage FFXI alliance events')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create an alliance signup from a saved template')
      .addStringOption(o => o.setName('template').setDescription('Template name, like Dynamis-D').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('name').setDescription('Event name').setRequired(true))
      .addStringOption(o => o.setName('time').setDescription('Event time, like Friday 8 PM EST').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List recent events')),

  new SlashCommandBuilder()
    .setName('attendance')
    .setDescription('Track and list event attendance')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub
      .setName('fromsignups')
      .setDescription('Mark everyone currently signed up for an event as present')
      .addIntegerOption(o => o.setName('event_id').setDescription('Event ID from /event list').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('mark')
      .setDescription('Manually mark one person for attendance')
      .addIntegerOption(o => o.setName('event_id').setDescription('Event ID from /event list').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Discord user to mark').setRequired(false))
      .addStringOption(o => o.setName('name').setDescription('Character/name to mark if not using a Discord user').setRequired(false))
      .addStringOption(o => o.setName('status').setDescription('Attendance status').setRequired(false)
        .addChoices(
          { name: 'Present', value: 'present' },
          { name: 'Late', value: 'late' },
          { name: 'Absent', value: 'absent' },
          { name: 'Excused', value: 'excused' }
        ))
      .addStringOption(o => o.setName('note').setDescription('Optional note').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Generate a list of names for an event')
      .addIntegerOption(o => o.setName('event_id').setDescription('Event ID from /event list').setRequired(true))
      .addStringOption(o => o.setName('status').setDescription('Filter by status').setRequired(false)
        .addChoices(
          { name: 'All', value: 'all' },
          { name: 'Present', value: 'present' },
          { name: 'Late', value: 'late' },
          { name: 'Absent', value: 'absent' },
          { name: 'Excused', value: 'excused' }
        )))
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear attendance records for an event')
      .addIntegerOption(o => o.setName('event_id').setDescription('Event ID from /event list').setRequired(true))),

  new SlashCommandBuilder()
    .setName('template')
    .setDescription('Manage FFXI event templates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('list').setDescription('List templates'))
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a blank template')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Short description').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('setslot')
      .setDescription('Set a specific job for a template slot')
      .addStringOption(o => o.setName('template').setDescription('Template name').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('alliance').setDescription('Alliance number').setRequired(true).setMinValue(1).setMaxValue(6))
      .addIntegerOption(o => o.setName('party').setDescription('Party number 1-3').setRequired(true).setMinValue(1).setMaxValue(3))
      .addIntegerOption(o => o.setName('slot').setDescription('Slot number 1-6').setRequired(true).setMinValue(1).setMaxValue(6))
      .addStringOption(o => o.setName('job').setDescription('FFXI job or role label').setRequired(true))
      .addStringOption(o => o.setName('note').setDescription('Optional note').setRequired(false)))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

if (!process.env.CLIENT_ID || !process.env.GUILD_ID || !process.env.DISCORD_TOKEN) {
  throw new Error('Missing CLIENT_ID, GUILD_ID, or DISCORD_TOKEN in .env');
}

await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
console.log('Slash commands deployed.');
