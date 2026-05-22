import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} from 'discord.js';
import { db } from './db.js';

export const FFXI_JOBS = [
  'WAR','MNK','WHM','BLM','RDM','THF','PLD','DRK','BST','BRD','RNG','SAM','NIN','DRG','SMN','BLU','COR','PUP','DNC','SCH','GEO','RUN'
];

export const JOB_GROUPS = {
  DD: ['WAR','MNK','THF','DRK','BST','RNG','SAM','NIN','DRG','BLU','PUP','DNC'],
  TANK: ['PLD','RUN','NIN'],
  HEALER: ['WHM','SCH','RDM'],
  SUPPORT: ['BRD','COR','GEO','RDM','SCH'],
  MAGE: ['BLM','SCH','GEO','RDM','SMN','BLU'],
  NUKE: ['BLM','SCH','GEO'],
  PET: ['BST','PUP','SMN','DRG']
};

export function normalizeJob(job) {
  return String(job || '').trim().toUpperCase();
}

export function getUserJobs(userId) {
  return db.prepare('SELECT job FROM user_jobs WHERE user_id = ? ORDER BY job').all(userId).map(r => r.job);
}

export function slotMatchesUserJobs(slotJob, userJobs) {
  return getMatchingJobsForSlot(slotJob, userJobs).length > 0;
}

export function getMatchingJobsForSlot(slotJob, userJobs) {
  const job = normalizeJob(slotJob);
  const savedJobs = (userJobs || []).map(normalizeJob).filter(Boolean);
  if (!savedJobs.length) return [];

  if (FFXI_JOBS.includes(job)) {
    return savedJobs.includes(job) ? [job] : [];
  }

  const group = JOB_GROUPS[job];
  if (!group) return [];
  return group.filter(j => savedJobs.includes(j));
}

export function isFlexibleRole(job) {
  return Boolean(JOB_GROUPS[normalizeJob(job)]);
}

export function formatSlotRequirement(job) {
  const normalized = normalizeJob(job);
  return normalized;
}

export function formatChosenJobForSlot(slotOrJob, selectedJobRaw = null) {
  const baseJob = normalizeJob(typeof slotOrJob === 'object' ? slotOrJob.job : slotOrJob);
  const selectedJob = normalizeJob(selectedJobRaw ?? (typeof slotOrJob === 'object' ? slotOrJob.selected_job : null));

  // For flexible role slots like DD, Tank, Healer, Support, Mage, Nuke, or Pet,
  // show the actual job the player selected while still preserving the role label.
  // Example: MNK (DD), WHM (HEALER), RUN (TANK).
  if (selectedJob && selectedJob !== baseJob) return `${selectedJob} (${baseJob})`;
  if (selectedJob) return selectedJob;
  return baseJob;
}

export function getDisplayJob(slot) {
  return formatChosenJobForSlot(slot);
}

export function formatJobList(jobs) {
  return jobs?.length ? jobs.join(', ') : 'No jobs saved yet';
}

export function getEventWithSlots(eventId) {
  const event = db.prepare(`
    SELECT events.*, templates.name AS template_name
    FROM events JOIN templates ON templates.id = events.template_id
    WHERE events.id = ?
  `).get(eventId);
  if (!event) return null;
  const slots = db.prepare('SELECT * FROM event_slots WHERE event_id = ? ORDER BY alliance_number, party_number, slot_number').all(eventId);
  return { event, slots };
}

export function getPartyLeader(partySlots) {
  // FFXI party leader defaults to Slot 1 if that slot is filled.
  // If Slot 1 is open, fall back to the first filled slot in that party.
  const slotOne = partySlots.find(s => s.slot_number === 1 && s.user_id);
  if (slotOne) return slotOne;
  return partySlots.find(s => s.user_id) || null;
}

export function buildEventEmbed(eventId) {
  const data = getEventWithSlots(eventId);
  if (!data) return null;
  const { event, slots } = data;
  const total = slots.length;
  const filled = slots.filter(s => s.user_id).length;

  const embed = new EmbedBuilder()
    .setTitle(event.name)
    .setDescription(`Event: **#${event.id}**\nTemplate: **${event.template_name}**${event.event_time ? `\nTime: **${event.event_time}**` : ''}\nStatus: **${event.locked ? 'Locked' : 'Open'}**\nFilled: **${filled}/${total}**`)
    .setFooter({ text: `Event ID: ${event.id}` })
    .setColor(event.locked ? 0x777777 : 0x2f80ed);

  const alliances = [...new Set(slots.map(s => s.alliance_number))];
  for (const a of alliances) {
    let value = '';
    for (let p = 1; p <= 3; p++) {
      const partySlots = slots.filter(s => s.alliance_number === a && s.party_number === p);
      if (!partySlots.length) continue;
      const leader = getPartyLeader(partySlots);
      value += `**Party ${p}** — Leader: ${leader ? `<@${leader.user_id}>` : 'Open'}\n`;
      value += partySlots.map(s => {
        const who = s.user_id ? `<@${s.user_id}>` : 'Open';
        const leaderMark = leader?.id === s.id ? ' 👑' : '';
        const displayJob = getDisplayJob(s);
        return `\`${s.slot_number}. ${displayJob.padEnd(12, ' ')}\` — ${who}${leaderMark}`;
      }).join('\n') + '\n\n';
    }
    embed.addFields({ name: `Alliance ${a}`, value: value.slice(0, 1024) || 'No slots' });
  }
  return embed;
}

export function buildEventComponents(eventId, disabled = false) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup:${eventId}`).setLabel('Sign Up').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`leave:${eventId}`).setLabel('Remove Me').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`refresh:${eventId}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`addalliance:${eventId}`).setLabel('Add Alliance').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`removealliance:${eventId}`).setLabel('Remove Alliance').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`lock:${eventId}`).setLabel('Lock / Unlock').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

export function buildAlliancePicker(eventId, userId) {
  const userJobs = getUserJobs(userId);
  const slots = db.prepare(`
    SELECT * FROM event_slots
    WHERE event_id = ? AND (user_id IS NULL OR user_id = ?)
    ORDER BY alliance_number, party_number, slot_number
  `).all(eventId, userId);

  const byAlliance = new Map();
  for (const s of slots) {
    if (!byAlliance.has(s.alliance_number)) byAlliance.set(s.alliance_number, { total: 0, available: 0 });
    const item = byAlliance.get(s.alliance_number);
    item.total++;
    if (slotMatchesUserJobs(s.job, userJobs)) item.available++;
  }

  const options = [...byAlliance.entries()].slice(0, 25).map(([allianceNumber, r]) => ({
    label: `Alliance ${allianceNumber}`,
    description: `${r.available || 0} matching slots / ${r.total} selectable slots`,
    value: String(allianceNumber)
  })).filter(o => !o.description.startsWith('0 matching'));

  if (!options.length) options.push({ label: 'No matching slots found', value: 'none', description: 'Use /profile jobs to add your jobs, or ask an admin.' });

  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`allianceselect:${eventId}`)
      .setPlaceholder('Step 1: choose an alliance')
      .addOptions(options)
      .setDisabled(options[0].value === 'none')
  )];
}

export function buildPartyPicker(eventId, allianceNumber, userId) {
  const userJobs = getUserJobs(userId);
  const slots = db.prepare(`
    SELECT * FROM event_slots
    WHERE event_id = ? AND alliance_number = ? AND (user_id IS NULL OR user_id = ?)
    ORDER BY party_number, slot_number
  `).all(eventId, allianceNumber, userId);

  const byParty = new Map();
  for (const s of slots) {
    if (!byParty.has(s.party_number)) byParty.set(s.party_number, { total: 0, available: 0 });
    const item = byParty.get(s.party_number);
    item.total++;
    if (slotMatchesUserJobs(s.job, userJobs)) item.available++;
  }

  const options = [...byParty.entries()].map(([partyNumber, r]) => ({
    label: `Party ${partyNumber}`,
    description: `${r.available || 0} matching slots / ${r.total} selectable slots`,
    value: String(partyNumber)
  })).filter(o => !o.description.startsWith('0 matching'));

  if (!options.length) options.push({ label: 'No matching parties', value: 'none', description: 'Pick another alliance or update /profile jobs.' });

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`partyselect:${eventId}:${allianceNumber}`)
        .setPlaceholder(`Step 2: choose a party in Alliance ${allianceNumber}`)
        .addOptions(options)
        .setDisabled(options[0].value === 'none')
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`signup:${eventId}`).setLabel('Back to alliances').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function buildSlotPicker(eventId, allianceNumber, partyNumber, userId) {
  const userJobs = getUserJobs(userId);
  const slots = db.prepare(`
    SELECT * FROM event_slots
    WHERE event_id = ? AND alliance_number = ? AND party_number = ? AND (user_id IS NULL OR user_id = ?)
    ORDER BY slot_number
  `).all(eventId, allianceNumber, partyNumber, userId)
    .filter(s => slotMatchesUserJobs(s.job, userJobs));

  const options = slots.flatMap(s => {
    const matchingJobs = getMatchingJobsForSlot(s.job, userJobs);
    return matchingJobs.map(chosenJob => ({
      label: `Slot ${s.slot_number} - ${formatChosenJobForSlot(s.job, chosenJob)}`.slice(0, 100),
      description: s.user_id
        ? 'Your current slot'
        : `Sign up as ${formatChosenJobForSlot(s.job, chosenJob)}`,
      value: `${s.id}:${chosenJob}`
    }));
  }).slice(0, 25);

  if (!options.length) options.push({ label: 'No matching slots in this party', value: 'none', description: 'Pick another party or update /profile jobs.' });

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`slotselect:${eventId}:${allianceNumber}:${partyNumber}`)
        .setPlaceholder(`Step 3: choose a slot in A${allianceNumber} P${partyNumber}`)
        .addOptions(options)
        .setDisabled(options[0].value === 'none')
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`backtoparties:${eventId}:${allianceNumber}`).setLabel('Back to parties').setStyle(ButtonStyle.Secondary)
    )
  ];
}
