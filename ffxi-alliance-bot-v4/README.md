# FFXI Alliance Signup Discord Bot

A Discord.js bot for FFXI linkshell/event signups.

## Features

- `/event create` creates a live alliance signup board from a saved template.
- Each alliance has 3 parties and each party has 6 slots.
- Slots can be assigned specific FFXI jobs or flexible labels like DD, Tank, Support, Healer.
- Users sign up using buttons and dropdowns.
- The public signup message updates live so everyone can see filled/open jobs.
- Event managers can add or remove additional alliances as needed.
- Event managers can lock/unlock an event.
- Event manager access can be limited to server admins, the event creator, a configured Discord role, or specific user IDs.
- SQLite database included.
- Default templates included: Dynamis-D, Sortie, Omen.
- Attendance tracking with `/attendance` commands.
- Generate a public attendance name list from the event signups or manual attendance marks.

## Setup

1. Install Node.js 20+.
2. Create a Discord application and bot at the Discord Developer Portal.
3. Enable the bot and copy the bot token.
4. Invite the bot to your Discord server with these permissions:
   - Send Messages
   - Embed Links
   - Use Slash Commands
   - Read Message History
5. Copy `.env.example` to `.env` and fill in:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_client_id
GUILD_ID=your_discord_server_id

# Optional organizer controls
EVENT_MANAGER_ROLE_ID=
EVENT_MANAGER_ROLE_NAME=
EVENT_MANAGER_USER_IDS=
```

6. Install dependencies:

```bash
npm install
```

7. Deploy slash commands:

```bash
npm run deploy
```

8. Start the bot:

```bash
npm start
```

## Commands

### Create an event

```text
/event create template:Dynamis-D name:"Friday Dynamis" time:"Friday 8 PM EST"
```

The bot posts a public signup board.

### List events

```text
/event list
```

### List templates

```text
/template list
```

### Create a blank template

```text
/template create name:"Aeonic" description:"Aeonic clear layout"
```

### Set a template slot

```text
/template setslot template:"Aeonic" alliance:1 party:1 slot:1 job:RUN
/template setslot template:"Aeonic" alliance:1 party:1 slot:2 job:WHM
/template setslot template:"Aeonic" alliance:1 party:1 slot:3 job:BRD
```

## Notes

- Discord dropdown menus can show up to 25 choices at once. This starter bot shows the first 25 available slots. For very large multi-alliance events, the next upgrade would be a two-step selector: choose alliance/party first, then choose slot.
- Add Alliance copies the previous alliance layout into a new alliance.
- Remove Alliance removes the highest-numbered alliance.
- Users can only hold one slot per event. Signing up for a new slot automatically removes their previous slot.

## Attendance Event Picker

Attendance commands now use an event picker instead of requiring you to manually type an event ID. Start typing the event name in the `event` option and choose from the open/recent events list.

Examples:

```text
/attendance fromsignups event:Friday Dynamis
/attendance list event:Friday Dynamis
/attendance mark event:Friday Dynamis user:@Player status:Present
/attendance clear event:Friday Dynamis
```

The public signup board also displays the event number as `Event: #ID` for reference.

## Event Manager Permissions

The public signup buttons for **Add Alliance**, **Remove Alliance**, and **Lock / Unlock** should not be available to regular players. The bot now checks management permissions before allowing those buttons to work.

A user can manage event controls if they are one of the following:

- A server admin or someone with **Manage Server**
- The Discord user who created that event
- A member of the configured event manager role
- A Discord user ID listed in `EVENT_MANAGER_USER_IDS`

Recommended setup:

1. Create a Discord role named `Event Organizer`.
2. Give that role only to trusted event leaders.
3. Copy the role ID and add it in Railway as:

```env
EVENT_MANAGER_ROLE_ID=your_role_id_here
```

You can also use a role name instead:

```env
EVENT_MANAGER_ROLE_NAME=Event Organizer
```

Or allow specific user IDs:

```env
EVENT_MANAGER_USER_IDS=111111111111111111,222222222222222222
```

After changing Railway variables, redeploy/restart the service. No slash-command redeploy is required for this permissions update.

## Files

- `src/index.js` main bot logic
- `src/deploy-commands.js` slash command deployment
- `src/lib/db.js` database schema and default templates
- `src/lib/render.js` embed and component rendering

## Signup Picker Update

The signup flow now uses a three-step picker so large events are not limited by Discord's 25-option select menu limit:

1. User clicks **Sign Up**
2. User chooses an **Alliance**
3. User chooses a **Party**
4. User chooses a specific **Slot / Job**

## Party Leaders

Each party now displays a leader automatically on the public signup board.

Leader logic:

1. If Party Slot 1 is filled, that user is the party leader.
2. If Slot 1 is open, the first filled slot in that party becomes the temporary leader.
3. If no one is signed up in that party, the leader shows as **Open**.

The selected leader is marked with a crown icon on the signup board.


## Attendance Tracking

Attendance is tracked separately from the live signup board, so you can lock in attendance after the event starts or ends.

### Mark everyone signed up as present

```text
/attendance fromsignups event:Friday Dynamis
```

This copies all currently signed-up Discord users from the event board into attendance as **present**.

### Manually mark one person

```text
/attendance mark event:Friday Dynamis user:@Player status:Present
/attendance mark event:Friday Dynamis name:"CharacterName" status:Late note:"arrived after first wave"
```

You can mark people as:

- Present
- Late
- Absent
- Excused

### Generate the name list

```text
/attendance list event:Friday Dynamis
```

This posts a public list grouped by status. You can also filter:

```text
/attendance list event:Friday Dynamis status:Present
```

### Clear attendance for an event

```text
/attendance clear event:Friday Dynamis
```

## Typical Event Flow

1. Create the signup with `/event create`.
2. Players sign up for their alliance / party / slot.
3. At event time, use `/attendance fromsignups event:Friday Dynamis`.
4. Use `/attendance mark` to add late/manual players or mark absences.
5. Use `/attendance list event:Friday Dynamis` to generate the public attendance list.
2. If Slot 1 is open, the first filled slot in that party is shown as temporary leader.

## User Job Profiles

Users can save the FFXI jobs/classes they are willing or able to play. When they click **Sign Up**, the bot filters the Alliance → Party → Slot picker so they only see slots that match their saved jobs.

Examples:

```text
/profile jobs set jobs:PLD, WHM, COR
/profile jobs add job:GEO
/profile jobs remove job:PLD
/profile jobs list
```

If Nick saves `PLD, WHM, COR`, then Nick will only see open slots for PLD, WHM, COR, or matching flexible groups such as Support if one of his saved jobs fits that group.

Flexible group matching included:

- `DD`
- `Tank`
- `Healer`
- `Support`
- `Mage`
- `Nuke`
- `Pet`

The public event board still shows the user's Discord mention/display name in the slot after signup.

### Chosen Job Display for Flexible Slots

For flexible role slots such as `DD`, `Tank`, `Support`, `Mage`, `Nuke`, or `Pet`, the signup picker now asks the player which matching saved job they are bringing. The public event board displays the chosen job.

Example: if a template slot is `DD` and Nick has `MNK, SAM`, the signup menu can show `Slot 6 - MNK (DD)` and `Slot 6 - SAM (DD)`. If Nick chooses MNK, the public signup board shows `MNK (DD)` next to Nick instead of only showing `DD`.


## Delete a Template

Use this when you no longer want a saved event template to appear in `/template list` or `/event create` autocomplete.

```text
/template delete template:Aeonic confirm:DELETE
```

This deletes the saved template and its template slots. Existing event signup boards already created from that template are not changed.

## Chosen Job Display for Flexible Roles

Flexible role slots now save and show the exact job the player chose for every supported role group:

- DD
- TANK
- HEALER
- SUPPORT
- MAGE
- NUKE
- PET

Example: if a slot is `DD` and a player has `MNK, SAM, WAR` saved in their profile, the signup picker will show those matching options. If they choose `MNK`, the public board displays:

```text
MNK (DD) — @Player
```

The same behavior applies to all role groups, such as:

```text
RUN (TANK) — @Player
WHM (HEALER) — @Player
BRD (SUPPORT) — @Player
BLM (NUKE) — @Player
BST (PET) — @Player
```
