import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits
} from 'discord.js';
import { db, initDb, seedDefaultTemplates } from './lib/db.js';
import { buildAlliancePicker, buildEventComponents, buildEventEmbed, buildPartyPicker, buildSlotPicker, formatChosenJobForSlot, formatJobList, getMatchingJobsForSlot, getUserJobs, normalizeJob, slotMatchesUserJobs } from './lib/render.js';

initDb();
seedDefaultTemplates();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

function splitEnvList(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function memberHasRole(member, roleIdOrName) {
  if (!member || !roleIdOrName) return false;
  const wanted = String(roleIdOrName).trim();
  const wantedLower = wanted.toLowerCase();
  return member.roles?.cache?.some(role => role.id === wanted || role.name.toLowerCase() === wantedLower);
}

function isAdmin(member) {
  return member?.permissions?.has(PermissionFlagsBits.ManageGuild) || member?.permissions?.has(PermissionFlagsBits.Administrator);
}

function isConfiguredEventManager(member, user) {
  const allowedUserIds = splitEnvList(process.env.EVENT_MANAGER_USER_IDS);
  if (allowedUserIds.includes(user?.id)) return true;

  const allowedRoleIds = splitEnvList(process.env.EVENT_MANAGER_ROLE_IDS || process.env.EVENT_MANAGER_ROLE_ID);
  if (allowedRoleIds.some(roleId => memberHasRole(member, roleId))) return true;

  const allowedRoleNames = splitEnvList(process.env.EVENT_MANAGER_ROLE_NAMES || process.env.EVENT_MANAGER_ROLE_NAME);
  if (allowedRoleNames.some(roleName => memberHasRole(member, roleName))) return true;

  return false;
}

function canManageEvent(member, user, event) {
  return isAdmin(member)
    || isConfiguredEventManager(member, user)
    || (event?.created_by && event.created_by === user?.id);
}

function canManageBot(member, user) {
  return isAdmin(member) || isConfiguredEventManager(member, user);
}

function managerDenyMessage() {
  return 'Only event managers can use that control. Ask a server admin to give you the configured event manager role.';
}

function upsertUserProfile(userId, displayName) {
  db.prepare(`
    INSERT INTO user_profiles (user_id, display_name)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, displayName || '');
}

function parseJobs(input) {
  return String(input || '')
    .split(/[ ,/]+/)
    .map(normalizeJob)
    .filter(Boolean)
    .filter((job, index, arr) => arr.indexOf(job) === index);
}

function setUserJobs(userId, displayName, jobs) {
  upsertUserProfile(userId, displayName);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_jobs WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT OR IGNORE INTO user_jobs (user_id, job) VALUES (?, ?)');
    for (const job of jobs) insert.run(userId, job);
  });
  tx();
}

function addUserJob(userId, displayName, job) {
  upsertUserProfile(userId, displayName);
  db.prepare('INSERT OR IGNORE INTO user_jobs (user_id, job) VALUES (?, ?)').run(userId, normalizeJob(job));
}

function removeUserJob(userId, job) {
  db.prepare('DELETE FROM user_jobs WHERE user_id = ? AND job = ?').run(userId, normalizeJob(job));
}

async function updateEventMessage(eventId, interaction = null) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event?.message_id) return;
  const channel = await client.channels.fetch(event.channel_id);
  const msg = await channel.messages.fetch(event.message_id);
  const embed = buildEventEmbed(eventId);
  await msg.edit({ embeds: [embed], components: buildEventComponents(eventId, !!event.locked) });
  if (interaction && !interaction.replied && !interaction.deferred) await interaction.deferUpdate();
}

function createEventFromTemplate(templateName, eventName, eventTime, channelId, userId) {
  const template = db.prepare('SELECT * FROM templates WHERE lower(name) = lower(?)').get(templateName);
  if (!template) throw new Error(`Template not found: ${templateName}`);

  const templateSlots = db.prepare('SELECT * FROM template_slots WHERE template_id = ? ORDER BY alliance_number, party_number, slot_number').all(template.id);
  if (!templateSlots.length) throw new Error(`Template has no slots: ${templateName}`);

  const tx = db.transaction(() => {
    const eventId = db.prepare(`
      INSERT INTO events (template_id, name, event_time, channel_id, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(template.id, eventName, eventTime || '', channelId, userId).lastInsertRowid;

    const insertSlot = db.prepare(`
      INSERT INTO event_slots (event_id, alliance_number, party_number, slot_number, job, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const s of templateSlots) {
      insertSlot.run(eventId, s.alliance_number, s.party_number, s.slot_number, s.job, s.note || '');
    }
    return eventId;
  });
  return tx();
}

function copyLastAlliance(eventId) {
  const maxAlliance = db.prepare('SELECT MAX(alliance_number) AS n FROM event_slots WHERE event_id = ?').get(eventId).n || 0;
  const source = db.prepare('SELECT * FROM event_slots WHERE event_id = ? AND alliance_number = ? ORDER BY party_number, slot_number').all(eventId, maxAlliance);
  if (!source.length) return;
  const insert = db.prepare(`
    INSERT INTO event_slots (event_id, alliance_number, party_number, slot_number, job, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const s of source) insert.run(eventId, maxAlliance + 1, s.party_number, s.slot_number, s.job, s.note || '');
  });
  tx();
}


function getEventName(eventId) {
  const event = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
  return event?.name || `Event #${eventId}`;
}

function getSelectedEventId(interaction) {
  const selected = interaction.options.getString('event') || String(interaction.options.getInteger('event_id') || '');
  const eventId = Number.parseInt(selected, 10);
  return Number.isFinite(eventId) ? eventId : null;
}

function upsertAttendance(eventId, userId, displayName, status, note, markedBy) {
  db.prepare(`
    INSERT INTO attendance (event_id, user_id, display_name, status, note, marked_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, display_name) DO UPDATE SET
      user_id = excluded.user_id,
      status = excluded.status,
      note = excluded.note,
      marked_by = excluded.marked_by,
      marked_at = CURRENT_TIMESTAMP
  `).run(eventId, userId || null, displayName, status || 'present', note || '', markedBy);
}

function formatAttendanceList(eventId, status = 'all') {
  const eventName = getEventName(eventId);
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM attendance WHERE event_id = ? ORDER BY status, display_name').all(eventId)
    : db.prepare('SELECT * FROM attendance WHERE event_id = ? AND status = ? ORDER BY display_name').all(eventId, status);

  if (!rows.length) return `No attendance records found for **${eventName}**.`;

  const groups = {};
  for (const row of rows) {
    if (!groups[row.status]) groups[row.status] = [];
    groups[row.status].push(row);
  }

  const lines = [`**Attendance for ${eventName}**`, `Total: **${rows.length}**`];
  for (const [groupStatus, groupRows] of Object.entries(groups)) {
    lines.push('', `**${groupStatus.toUpperCase()} (${groupRows.length})**`);
    lines.push(groupRows.map((r, i) => `${i + 1}. ${r.user_id ? `<@${r.user_id}>` : r.display_name}${r.note ? ` — ${r.note}` : ''}`).join('\n'));
  }
  return lines.join('\n').slice(0, 1900);
}

function removeLastAlliance(eventId) {
  const maxAlliance = db.prepare('SELECT MAX(alliance_number) AS n FROM event_slots WHERE event_id = ?').get(eventId).n || 1;
  if (maxAlliance <= 1) return false;
  db.prepare('DELETE FROM event_slots WHERE event_id = ? AND alliance_number = ?').run(eventId, maxAlliance);
  return true;
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const focusedOption = interaction.options.getFocused(true);
      const focused = String(focusedOption.value || '').toLowerCase();

      if (focusedOption.name === 'template') {
        const rows = db.prepare('SELECT name FROM templates WHERE lower(name) LIKE ? ORDER BY name LIMIT 25').all(`%${focused}%`);
        await interaction.respond(rows.map(r => ({ name: r.name, value: r.name })));
        return;
      }

      if (focusedOption.name === 'event') {
        const like = `%${focused}%`;
        const rows = db.prepare(`
          SELECT id, name, event_time, locked
          FROM events
          WHERE lower(name) LIKE ? OR CAST(id AS TEXT) LIKE ?
          ORDER BY locked ASC, id DESC
          LIMIT 25
        `).all(like, like);

        await interaction.respond(rows.map(e => {
          const status = e.locked ? 'Locked' : 'Open';
          const time = e.event_time ? ` • ${e.event_time}` : '';
          return {
            name: `#${e.id} • ${e.name} • ${status}${time}`.slice(0, 100),
            value: String(e.id)
          };
        }));
        return;
      }
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'profile') {
        const group = interaction.options.getSubcommandGroup();
        const sub = interaction.options.getSubcommand();
        if (group === 'jobs') {
          const displayName = interaction.member?.displayName || interaction.user.username;
          if (sub === 'set') {
            const jobs = parseJobs(interaction.options.getString('jobs', true));
            if (!jobs.length) return interaction.reply({ content: 'Please enter at least one job, like `PLD, WHM, COR`.', ephemeral: true });
            setUserJobs(interaction.user.id, displayName, jobs);
            return interaction.reply({ content: `Saved your jobs: **${formatJobList(jobs)}**. Signup menus will now only show matching slots.`, ephemeral: true });
          }
          if (sub === 'add') {
            const job = normalizeJob(interaction.options.getString('job', true));
            addUserJob(interaction.user.id, displayName, job);
            return interaction.reply({ content: `Added **${job}**. Your jobs: **${formatJobList(getUserJobs(interaction.user.id))}**`, ephemeral: true });
          }
          if (sub === 'remove') {
            const job = normalizeJob(interaction.options.getString('job', true));
            removeUserJob(interaction.user.id, job);
            return interaction.reply({ content: `Removed **${job}**. Your jobs: **${formatJobList(getUserJobs(interaction.user.id))}**`, ephemeral: true });
          }
          if (sub === 'list') {
            return interaction.reply({ content: `Your saved jobs: **${formatJobList(getUserJobs(interaction.user.id))}**`, ephemeral: true });
          }
        }
      }

      if (interaction.commandName === 'event') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'create') {
          if (!canManageBot(interaction.member, interaction.user)) {
            return interaction.reply({ content: managerDenyMessage(), ephemeral: true });
          }
          const template = interaction.options.getString('template', true);
          const name = interaction.options.getString('name', true);
          const time = interaction.options.getString('time') || '';
          const eventId = createEventFromTemplate(template, name, time, interaction.channelId, interaction.user.id);
          const msg = await interaction.channel.send({
            embeds: [buildEventEmbed(eventId)],
            components: buildEventComponents(eventId)
          });
          db.prepare('UPDATE events SET message_id = ? WHERE id = ?').run(msg.id, eventId);
          await interaction.reply({ content: `Created signup event: **${name}**`, ephemeral: true });
          return;
        }
        if (sub === 'list') {
          const rows = db.prepare('SELECT id, name, event_time, locked FROM events ORDER BY id DESC LIMIT 10').all();
          const content = rows.length ? rows.map(e => `#${e.id} — **${e.name}** ${e.event_time || ''} ${e.locked ? '(locked)' : '(open)'}`).join('\n') : 'No events found.';
          await interaction.reply({ content, ephemeral: true });
          return;
        }
      }

      if (interaction.commandName === 'template') {
        if (!canManageBot(interaction.member, interaction.user)) {
          return interaction.reply({ content: managerDenyMessage(), ephemeral: true });
        }
        const sub = interaction.options.getSubcommand();
        if (sub === 'list') {
          const rows = db.prepare('SELECT t.name, t.description, COUNT(s.id) AS slots FROM templates t LEFT JOIN template_slots s ON s.template_id = t.id GROUP BY t.id ORDER BY t.name').all();
          await interaction.reply({ content: rows.map(t => `**${t.name}** — ${t.slots} slots — ${t.description || 'No description'}`).join('\n') || 'No templates found.', ephemeral: true });
          return;
        }
        if (sub === 'create') {
          const name = interaction.options.getString('name', true);
          const desc = interaction.options.getString('description') || '';
          db.prepare('INSERT INTO templates (name, description) VALUES (?, ?)').run(name, desc);
          await interaction.reply({ content: `Created blank template **${name}**. Add slots with /template setslot.`, ephemeral: true });
          return;
        }
        if (sub === 'delete') {
          const templateName = interaction.options.getString('template', true);
          const confirm = interaction.options.getString('confirm', true);
          if (confirm !== 'DELETE') {
            return interaction.reply({ content: 'Template was not deleted. To confirm, type `DELETE` in the confirm field.', ephemeral: true });
          }

          const template = db.prepare('SELECT * FROM templates WHERE lower(name) = lower(?)').get(templateName);
          if (!template) return interaction.reply({ content: 'Template not found.', ephemeral: true });

          const eventCount = db.prepare('SELECT COUNT(*) AS c FROM events WHERE template_id = ?').get(template.id).c;
          const tx = db.transaction(() => {
            const slotResult = db.prepare('DELETE FROM template_slots WHERE template_id = ?').run(template.id);
            db.prepare('DELETE FROM templates WHERE id = ?').run(template.id);
            return slotResult.changes;
          });

          try {
            const deletedSlots = tx();
            const existingEventNote = eventCount > 0
              ? ` Existing events already created from this template were not changed.`
              : '';
            await interaction.reply({ content: `Deleted template **${template.name}** and **${deletedSlots}** saved slot(s).${existingEventNote}`, ephemeral: true });
          } catch (err) {
            console.error(err);
            await interaction.reply({ content: 'I could not delete that template because it is still referenced by saved event data.', ephemeral: true });
          }
          return;
        }
        if (sub === 'setslot') {
          const templateName = interaction.options.getString('template', true);
          const alliance = interaction.options.getInteger('alliance', true);
          const party = interaction.options.getInteger('party', true);
          const slot = interaction.options.getInteger('slot', true);
          const job = interaction.options.getString('job', true).toUpperCase();
          const note = interaction.options.getString('note') || '';
          const template = db.prepare('SELECT * FROM templates WHERE lower(name) = lower(?)').get(templateName);
          if (!template) return interaction.reply({ content: 'Template not found.', ephemeral: true });
          const existing = db.prepare('SELECT id FROM template_slots WHERE template_id = ? AND alliance_number = ? AND party_number = ? AND slot_number = ?').get(template.id, alliance, party, slot);
          if (existing) {
            db.prepare('UPDATE template_slots SET job = ?, note = ? WHERE id = ?').run(job, note, existing.id);
          } else {
            db.prepare('INSERT INTO template_slots (template_id, alliance_number, party_number, slot_number, job, note) VALUES (?, ?, ?, ?, ?, ?)').run(template.id, alliance, party, slot, job, note);
          }
          await interaction.reply({ content: `Set **${template.name}** A${alliance} P${party} S${slot} to **${job}**.`, ephemeral: true });
          return;
        }
      }
    }


      if (interaction.commandName === 'attendance') {
        if (!canManageBot(interaction.member, interaction.user)) {
          return interaction.reply({ content: managerDenyMessage(), ephemeral: true });
        }
        const sub = interaction.options.getSubcommand();
        const eventId = getSelectedEventId(interaction);
        if (!eventId) return interaction.reply({ content: 'Please choose an event from the event picker.', ephemeral: true });
        const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
        if (!event) return interaction.reply({ content: 'Event not found. Start typing the event name and choose one from the picker.', ephemeral: true });

        if (sub === 'fromsignups') {
          const signedSlots = db.prepare(`
            SELECT user_id, display_name
            FROM event_slots
            WHERE event_id = ? AND user_id IS NOT NULL
            GROUP BY user_id, display_name
            ORDER BY display_name
          `).all(eventId);

          const tx = db.transaction(() => {
            for (const s of signedSlots) upsertAttendance(eventId, s.user_id, s.display_name, 'present', '', interaction.user.id);
          });
          tx();
          return interaction.reply({ content: `Marked **${signedSlots.length}** signed-up players as present for **${event.name}**.`, ephemeral: true });
        }

        if (sub === 'mark') {
          const user = interaction.options.getUser('user');
          const manualName = interaction.options.getString('name');
          const status = interaction.options.getString('status') || 'present';
          const note = interaction.options.getString('note') || '';
          if (!user && !manualName) return interaction.reply({ content: 'Please provide either a Discord user or a manual name.', ephemeral: true });

          const member = user ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;
          const displayName = user ? (member?.displayName || user.username) : manualName;
          upsertAttendance(eventId, user?.id || null, displayName, status, note, interaction.user.id);
          return interaction.reply({ content: `Marked **${displayName}** as **${status}** for **${event.name}**.`, ephemeral: true });
        }

        if (sub === 'list') {
          const status = interaction.options.getString('status') || 'all';
          return interaction.reply({ content: formatAttendanceList(eventId, status), ephemeral: false });
        }

        if (sub === 'clear') {
          const result = db.prepare('DELETE FROM attendance WHERE event_id = ?').run(eventId);
          return interaction.reply({ content: `Cleared **${result.changes}** attendance records for **${event.name}**.`, ephemeral: true });
        }
      }

    if (interaction.isButton()) {
      const [action, eventIdRaw] = interaction.customId.split(':');
      const eventId = Number(eventIdRaw);
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
      if (!event) return interaction.reply({ content: 'Event not found.', ephemeral: true });

      if (action === 'signup') {
        if (event.locked) return interaction.reply({ content: 'This event is locked.', ephemeral: true });
        const jobs = getUserJobs(interaction.user.id);
        if (!jobs.length) {
          return interaction.reply({ content: 'You need to save your FFXI jobs first. Use `/profile jobs set jobs:PLD, WHM, COR` and then sign up again.', ephemeral: true });
        }
        return interaction.reply({ content: `Pick your signup location. Your saved jobs: **${formatJobList(jobs)}**`, components: buildAlliancePicker(eventId, interaction.user.id), ephemeral: true });
      }
      if (action === 'leave') {
        db.prepare('UPDATE event_slots SET user_id = NULL, display_name = NULL, selected_job = NULL, signed_at = NULL WHERE event_id = ? AND user_id = ?').run(eventId, interaction.user.id);
        await updateEventMessage(eventId);
        return interaction.reply({ content: 'Removed your signup.', ephemeral: true });
      }
      if (action === 'refresh') {
        await updateEventMessage(eventId, interaction);
        return;
      }
      if (action === 'backtoparties') {
        const allianceNumber = Number(interaction.customId.split(':')[2]);
        return interaction.update({ content: `Pick a party in Alliance ${allianceNumber}:`, components: buildPartyPicker(eventId, allianceNumber, interaction.user.id) });
      }
      if (!canManageEvent(interaction.member, interaction.user, event)) {
        return interaction.reply({ content: managerDenyMessage(), ephemeral: true });
      }
      if (action === 'addalliance') {
        copyLastAlliance(eventId);
        await updateEventMessage(eventId);
        return interaction.reply({ content: 'Added another alliance using the previous alliance layout.', ephemeral: true });
      }
      if (action === 'removealliance') {
        const ok = removeLastAlliance(eventId);
        await updateEventMessage(eventId);
        return interaction.reply({ content: ok ? 'Removed the last alliance.' : 'At least one alliance is required.', ephemeral: true });
      }
      if (action === 'lock') {
        db.prepare('UPDATE events SET locked = CASE locked WHEN 1 THEN 0 ELSE 1 END WHERE id = ?').run(eventId);
        await updateEventMessage(eventId);
        return interaction.reply({ content: 'Toggled event lock.', ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu()) {
      const parts = interaction.customId.split(':');
      const action = parts[0];
      const eventId = Number(parts[1]);
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
      if (!event || event.locked) return interaction.update({ content: 'This event is locked or missing.', components: [] });

      if (action === 'allianceselect') {
        if (interaction.values[0] === 'none') return interaction.update({ content: 'No matching slots are available for your saved jobs.', components: [] });
        const allianceNumber = Number(interaction.values[0]);
        return interaction.update({ content: `Pick a party in Alliance ${allianceNumber}:`, components: buildPartyPicker(eventId, allianceNumber, interaction.user.id) });
      }

      if (action === 'partyselect') {
        if (interaction.values[0] === 'none') return interaction.update({ content: 'No matching parties available for your saved jobs.', components: [] });
        const allianceNumber = Number(parts[2]);
        const partyNumber = Number(interaction.values[0]);
        return interaction.update({ content: `Pick a slot in Alliance ${allianceNumber}, Party ${partyNumber}:`, components: buildSlotPicker(eventId, allianceNumber, partyNumber, interaction.user.id) });
      }

      if (action !== 'slotselect') return;
      if (interaction.values[0] === 'none') return interaction.update({ content: 'No matching slots are available in that party for your saved jobs.', components: [] });
      const allianceNumber = Number(parts[2]);
      const partyNumber = Number(parts[3]);
      const [slotIdRaw, chosenJobRaw] = interaction.values[0].split(':');
      const slotId = Number(slotIdRaw);
      const chosenJob = normalizeJob(chosenJobRaw);
      const slot = db.prepare('SELECT * FROM event_slots WHERE id = ? AND event_id = ?').get(slotId, eventId);
      if (!slot) return interaction.update({ content: 'Slot not found.', components: [] });
      if (slot.user_id && slot.user_id !== interaction.user.id) {
        return interaction.update({ content: 'That slot was just taken. Try another.', components: buildSlotPicker(eventId, allianceNumber, partyNumber, interaction.user.id) });
      }
      const userJobs = getUserJobs(interaction.user.id);
      const matchingJobs = getMatchingJobsForSlot(slot.job, userJobs);
      if (!matchingJobs.includes(chosenJob)) {
        return interaction.update({ content: `That slot requires **${slot.job}**, and **${chosenJob || 'that job'}** does not match your saved jobs: **${formatJobList(userJobs)}**.`, components: buildSlotPicker(eventId, allianceNumber, partyNumber, interaction.user.id) });
      }

      const memberName = interaction.member?.displayName || interaction.user.username;
      const tx = db.transaction(() => {
        db.prepare('UPDATE event_slots SET user_id = NULL, display_name = NULL, selected_job = NULL, signed_at = NULL WHERE event_id = ? AND user_id = ?').run(eventId, interaction.user.id);
        db.prepare('UPDATE event_slots SET user_id = ?, display_name = ?, selected_job = ?, signed_at = CURRENT_TIMESTAMP WHERE id = ?').run(interaction.user.id, memberName, chosenJob, slotId);
      });
      tx();
      await updateEventMessage(eventId);
      return interaction.update({ content: `Signed up for **A${slot.alliance_number} P${slot.party_number} S${slot.slot_number} - ${formatChosenJobForSlot(slot.job, chosenJob)}**.`, components: [] });
    }
  } catch (err) {
    console.error(err);
    const message = `Error: ${err.message}`;
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, ephemeral: true });
    else await interaction.reply({ content: message, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
