# Build queue (example)

A synthetic, adopt-me example. Each row is a lane-sized unit of work: one
artifact a stranger can install, shipping in two sessions or fewer. Row numbers
are stable identifiers, not positions — rows leave gaps rather than renumbering
when they ship, and their file order is the ranking.

Each row carries a `**Lane:**` bullet with three fields the engine reads:
`repo=` (the target repo), `unit=` (estimated sessions, 1 or 2), and
`eligible=` (yes or no). A row with no Lane bullet is never launchable.

**2. ESP provider-detection resurrection**
- **Lane:** repo=`esp` unit=1 eligible=yes
- MX lookup, then tag, then route.

**5. Widget-lib pagination helper**
- **Lane:** repo=`widget-lib` unit=1 eligible=yes

**9. Investor-portfolio overlap mapper**
- **Lane:** repo=`overlap-mapper` unit=2 eligible=yes

**11. Command-center map render**
- **Lane:** repo=`command-center` unit=1 eligible=yes

**12. Full billing migration**
- **Lane:** repo=`billing-service` unit=2 eligible=no
- Parked: `billing-service` is a protected repo, so any lane against it stays
  human-merge. Left ineligible until a human is ready to drive it.
