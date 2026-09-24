# People from the Facebook + Instagram exports — plan

**Goal (user, 2026-09-24):** *"i give you my facebook and instagram back ups of user profiles and you add
them as people to poms-grid and then remove all the test ones we have (the current ones)."*

No personal data lives in this file or in git — see §4.

---

## 1. What the exports actually contain (measured)

| source | file | rows | what each row has |
|---|---|---|---|
| Facebook | `connections/friends/your_friends.json` | **714** | display **name** + friends-since timestamp |
| Instagram | `followers_1.json` | 53 | **username** + profile URL + follow timestamp |
| Instagram | `following.json` | 1,158 | username + URL + timestamp (mostly accounts you follow: pages, brands, public figures) |
| Instagram | `close_friends.json` | 8 | **name + username** + URL |
| | followers ∩ following (mutual) | **50** | |

**Not in either export:** profile photos, emails, phone numbers, birthdays, locations. Facebook gives a
name and nothing else. Instagram gives a handle and no display name, except for close friends.
Profile pictures cannot be pulled from Instagram/Facebook without logging in as you, and that is against
their terms. They stay empty; the existing "Set image…" picker fills one in a click.

## 2. Fields each person gets (all already on the People board)

| field | from |
|---|---|
| Name | FB name · IG close-friend name · else the IG username |
| Instagram | `@username` (IG rows) |
| Website | IG profile URL (there is no Facebook field; a profile URL is not in the FB export anyway) |
| Relationship | `close friend` for IG close friends, else `friend` |
| How We Met | `Facebook friend since <Mon YYYY>` / `Instagram, following since <Mon YYYY>` |
| Tags | `facebook` / `instagram` |
| Board Category / Library | `person` (what makes it a People-board row and a picker option) |

Nothing is invented — every value above is in the export (the 0052 rule).

## 3. Removing the test people

The People board holds the 10 seeded people (pravatar photos, made-up emails/phones) plus **Keith and
Angela (0052, real, added at your ask)**. The 10 seeded ones are identified by exact name + a seeded
email/photo, never by "not in the export". Keith and Angela are kept.

Before deleting, every reference to a test person is cleared: `People Assigned` values on tasks (e.g.
Call a Friend), Phone Calls tracker rows, feed copies, the People table's cells. The delete goes through
the same cascade as the app's (occurrence + its placements + a module left with no placement), after
the runner's automatic backup.

## 4. Where the data goes (privacy)

The names are other people's personal data, so **they never enter the git repo** (it is on GitHub).
- I parse both zips here into one `people-import.json` (name/handle/url/since/source/closeFriend).
- You copy it to the droplet **outside the repo**: `/var/www/moduli-private/people-import.json`.
- Migration `0352` reads it from `PEOPLE_IMPORT_PATH` and refuses to run without it.

## 5. Tasks

| # | task |
|---|---|
| 1 | Parse both exports → `people-import.json`, with the FB↔IG merge rule (§6) applied and a report of counts. |
| 2 | Migration `0352-people-from-social-exports`: dry run lists how many rows are added per source, how many merged, and which test people are removed with how many references each. |
| 3 | Idempotent: each row carries `meta.source` (`facebook`/`instagram`) + `meta.externalId` (FB name / IG username), so a re-run (or a newer export later) adds only who is new and never duplicates. |
| 4 | Remove the 10 seeded people + their references (§3). Keith and Angela untouched. |
| 5 | Verify on the grid: People board count, a person picker still resolves, Call a Friend has no dangling ids, integrity clean. |

## 6. Decisions (answered 2026-09-24)

1. **Who counts as a person** — *"fb friends and instagram. use your best disgression to filter out
   brands and celebrities. there should be more than just 50 accounts for instagram that are friends"*.
   All 714 FB friends. Instagram accounts are kept on signals (follows you, close friend, hidden from
   story, a follow request, a recent unfollow, a FB friend's name in the handle) or by judgment of the
   handle. Judgment-only accounts carry `Found Via: unconfirmed` so they can be reviewed and deleted.
   Your own accounts are excluded. **1,106 people in total** (259 of them `unconfirmed`).
2. **Merging** — exact name matches only. A handle that merely *contains* a FB friend's name is NOT
   merged; its Person Notes say "Possibly the same person as Facebook friend X".
3. **Keith and Angela** — kept. They also get the three new fields bound.
4. **Fields** — *"include fields on each person"* / *"create some fields if you need"*. Three new fields,
   found-or-created by name: `Facebook Friends Since` (date), `Instagram Following Since` (date),
   `Found Via` (multi-select: facebook · instagram · close friend · mutual · follows you · you follow ·
   unconfirmed). Every person gets the People board's existing bindings plus these.
