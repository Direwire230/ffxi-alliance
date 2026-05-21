# FFXI Alliance Signup Discord Bot

A Discord.js bot for FFXI linkshell/event signups.

## Features

- `/event create` creates a live alliance signup board from a saved template.
- Each alliance has 3 parties and each party has 6 slots.
- Slots can be assigned specific FFXI jobs or flexible labels like DD, Tank, Support, Healer.
- Users sign up using buttons and dropdowns.
- The public signup message updates live so everyone can see filled/open jobs.
- Admins can add or remove additional alliances as needed.
- Admins can lock/unlock an event.
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
/attendance fromsignups event_id:1
```

This copies all currently signed-up Discord users from the event board into attendance as **present**.

### Manually mark one person

```text
/attendance mark event_id:1 user:@Player status:Present
/attendance mark event_id:1 name:"CharacterName" status:Late note:"arrived after first wave"
```

You can mark people as:

- Present
- Late
- Absent
- Excused

### Generate the name list

```text
/attendance list event_id:1
```

This posts a public list grouped by status. You can also filter:

```text
/attendance list event_id:1 status:Present
```

### Clear attendance for an event

```text
/attendance clear event_id:1
```

## Typical Event Flow

1. Create the signup with `/event create`.
2. Players sign up for their alliance / party / slot.
3. At event time, use `/attendance fromsignups event_id:1`.
4. Use `/attendance mark` to add late/manual players or mark absences.
5. Use `/attendance list event_id:1` to generate the public attendance list.
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
