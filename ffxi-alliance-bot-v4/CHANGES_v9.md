# v9 Changes

## Event Manager Controls

Management buttons are now protected by an event-manager permission check.

The following controls are restricted:

- Add Alliance
- Remove Alliance
- Lock / Unlock

Allowed users:

1. Server admins / users with Manage Server
2. The user who created that event
3. Any user with the configured event manager role
4. Any user ID listed in EVENT_MANAGER_USER_IDS

## Optional Railway Variables

Add one of these in Railway if you want non-admin organizers to manage events:

```env
EVENT_MANAGER_ROLE_ID=123456789012345678
```

or:

```env
EVENT_MANAGER_ROLE_NAME=Event Organizer
```

You can also allow individual users:

```env
EVENT_MANAGER_USER_IDS=111111111111111111,222222222222222222
```

No new slash commands were added, so you do not need to run `npm run deploy` for this version. Redeploy the bot normally with `npm start`.
