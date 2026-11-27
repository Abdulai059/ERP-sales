# Kernel ERP Documentation 
 
*Working name: "Kernel". Replace it with your real project name everywhere. Status: early preview, not for production. Version 0.1 (draft).*

This documentation covers an open source, modular business system for hotels, restaurants, and shops. Each business runs in its own private database and turns on only the apps it needs.

**Where to start**

| You are... | Go to |
| --- | --- |
| New and curious | Part 1 |
| Installing and running it | Part 3 (Operators) |
| Building a module | Part 4 (Developers) |
| Looking up one app | Part 5 (Modules) |
| Staff using the screens | Part 6 (Staff guides) |
| Wanting to contribute | Part 7 |

## Part 1. Overview

### 1.1 What is this?

Many hotels, restaurants, and shops run on paper, spreadsheets, and phone calls. Requests are lost, cash is hard to control, stock is guessed, and managers cannot see the whole picture.

This project is one connected system with shared users, products, and records. It has three goals:

1. **Solve real problems** for one hotel with a restaurant and shops (the first customer).
2. **Stay modular.** Every app (POS, kitchen, front desk, housekeeping) is a separate module that can be switched on per business.
3. **Be open.** Other developers can build modules, and partners can later set it up for their own customers.

### 1.2 What it is not

- Not a full accounting or payroll system (not in version 1).
- Not a payment processor. Card payments go through a certified terminal or provider. The system never stores card numbers.
- Not production-ready yet. Use it for pilots with a backup plan.

### 1.3 How it fits together (in one picture)

```
 One server, one codebase, all apps available
   |            |             |
 Shop A      Cafe B        Hotel D
 own DB      own DB        own DB
 own users   own users     own users
 POS+Stock   POS+Kitchen   Front desk, Housekeeping,
                           Folio, POS, Kitchen, Stock,
                           Charge-to-room
```

Think of an apartment building. The building is the system. Each apartment is one business with its own locked door, its own users, and its own furniture (installed apps).

### 1.4 Roadmap

| Stage | Goal | Done when |
| --- | --- | --- |
| 1 | Kernel basics: tenants, users, roles, audit, sequences, migrations | Login works and roles restrict actions |
| 2 | Contacts and product catalog | One shared catalog exists |
| 3 | Restaurant POS, then retail POS | One outlet runs a full week |
| 4 | Hotel: rooms, reservations, folio, housekeeping | Front desk runs a month in parallel with the old method |
| 5 | Charge-to-room bridge | A real checkout includes restaurant charges |
| 6 | Provisioning, backups, monitoring | A new business can be created without manual work |
| 7 | Billing, partner portal, marketplace | Driven by demand, not before |

**Out of scope for now:** accounting, payroll, manufacturing, mobile app, online booking channels, public module marketplace.

### 1.5 Glossary

Use these words consistently everywhere.

| Term | Meaning |
| --- | --- |
| **Business** | One customer (a hotel, cafe, or shop) with its own database and users. Never say "tenant" or "company" in user-facing text. |
| **Platform** | The whole system you run: server, kernel, and all available modules. |
| **Kernel** | The core code every module depends on: module loader, users, permissions, events, audit, sequences. |
| **Module** | A folder of code that adds one app or feature. |
| **Manifest** | The small file in a module that states its name, version, and dependencies. |
| **Available** | A module whose code exists on the server. |
| **Installed** | A module switched on for one specific business. |
| **Dependency** | A module that another module needs in order to work. |
| **Migration** | A numbered, one-time database change belonging to a module. |
| **Event** | An announcement such as "order paid" that other modules can react to. |
| **Outbox** | A list of events saved in the same database transaction as the change that caused them, so none are lost. |
| **Role** | A named bundle of permissions (for example Cashier). |
| **Permission** | One allowed action (for example "void order"). |
| **Outlet** | A place that sells: a restaurant, bar, or shop. |
| **Register** | One till or POS device in an outlet. |
| **Session** | A cashier's working period on a register, opened and closed with a cash count. |
| **Order** | A sale made at the POS, made of order lines. |
| **Folio** | A hotel guest's running bill: room charges, extras, restaurant charges, and payments. |
| **Charge to room** | Putting a restaurant or shop bill onto a guest's folio instead of paying immediately. |
| **Business date** | The hotel's accounting day, closed by night audit. It can differ from the calendar date. |
| **Night audit** | The end-of-day process that posts room charges, checks problems, and closes the business date. |
| **Append-only** | Records are never edited or deleted. Mistakes are fixed with a new, linked correcting entry. |
| **Idempotent** | Safe to repeat. Receiving the same order or event twice has the effect of receiving it once. |
| **Operator** | The person who installs, deploys, and maintains the system. |
| **Template** | A preset (taxes, roles, receipt layout) for a type of business. |

## Part 2. Architecture

### 2.1 Layers

| Layer | What it is | Choice |
| --- | --- | --- |
| Infrastructure | Servers, network, backups | Docker on one server |
| Data | One control database plus one PostgreSQL database per business | PostgreSQL |
| Kernel | Module loader, users, permissions, events, audit, sequences | Node.js, Express, pg, TypeScript |
| Modules | Contacts, products, POS, hotel, bridges | One folder each, with a manifest |
| Clients | Back-office web app, POS app, front-desk screens | Web, with an offline-capable POS |

### 2.2 Two planes

- **Control plane:** the master list of businesses, their web addresses, which apps each may install, and subscription status. For about 10 businesses this is a small table plus scripts.
- **Business plane:** each business's own database, users, installed modules, and data.

Billing, partner portal, and admin console belong to the control plane and are kept separate from the kernel that outside developers extend.

### 2.3 How a request is handled

1. A user opens `hotel-d.example.com`.
2. The system finds the business from the address.
3. It connects to that business's database only.
4. The user logs in with that business's account.
5. The system checks which modules are installed and which permissions the role has.
6. The module logic runs, an audit entry is written, and events are saved.

No code path may assume a single database. All data access goes through one layer that resolves "which business, which connection." This keeps future tenancy changes possible.

### 2.4 Module rules

1. A module may depend only on modules below it: kernel, then core modules, then apps, then bridges.
2. Modules talk through **events** or a small **public interface**, never by reading each other's tables.
3. POS and hotel never depend on each other. Only the bridge module `pos_hotel` knows both.
4. A module that extends another module's data adds **its own table** linked to the original, never new columns on the owner's table.
5. Every database change is a numbered migration.
6. Every module declares which kernel versions it works with.

### 2.5 Safety rules for money and records

- Amounts are stored as whole numbers in the smallest currency unit, with a currency on every amount.
- Sales, folio charges, payments, and stock movements are **append-only**.
- An event is saved in the **same transaction** as the change that caused it, then delivered by a worker with retries. Handlers must be idempotent. Failed events appear on a visible exception list.
- IDs are UUIDs. Times are stored in UTC. Hotels also store the business date.
- Country-specific tax and fiscal rules live in separate localization modules, not in the core.
- Generated create/read/update/delete screens are allowed only for setup data (categories, room types). Orders, payments, folios, and stock use hand-written, tested operations.

### 2.6 Offline behavior

| Feature | Offline behavior |
| --- | --- |
| POS sales | Work offline. Orders get a unique ID on the device and sync later. The server accepts each order once and re-checks prices and tax. |
| Receipt numbers | Each register has its own number range, so there are no gaps or clashes. |
| Charge to room | Cannot be verified offline. The charge goes to an exception list for staff to check. |
| Hotel reservations | Require a connection. Use the printed downtime procedure if the internet fails. |

### 2.7 Security baseline

- Passwords hashed with argon2 or bcrypt. Login tokens expire.
- Role-based permissions checked on every operation.
- All database queries use parameters. Names built from metadata are checked against a strict pattern.
- Secrets live in environment settings, never in code or in the repository.
- Rate limiting on login.
- Guest ID details are access-restricted and encrypted.
- Support access by operators or partners is time-limited, logged, and visible to the business.
- Hosted deployments run only reviewed modules. Self-hosters may install anything at their own risk.

### 2.8 Decision records

Each decision is also kept as its own short file in `docs/architecture/decisions/`. They are never rewritten. If a decision changes, a new record replaces the old one.

**0001. Use Node.js, Express, and pg.** Problem: choose a stack the maintainer can learn and others can contribute to. Options: Python with Django, Node.js. Choice: Node.js with Express and the pg driver. Reason: the maintainer works in JavaScript, and model definitions as plain data suit a metadata-driven platform. Consequence: auth, migrations, and validation must be built or added as libraries.

**0002. Use TypeScript.** Problem: a platform that others extend needs clear contracts. Choice: TypeScript from the first file. Reason: types act as documentation for module developers, and adding them later is painful.

**0003. One database per business.** Problem: how to isolate customers. Options: database per business, schema per business, shared tables with a business ID. Choice: database per business for the first \~10 to 50 businesses. Reason: strong isolation, simple per-business backup and restore, easy to explain to hotels. Consequence: upgrades run per database. All data access must go through one tenant-aware layer so a hybrid model remains possible.

**0004. Events are saved with the change (outbox).** Problem: a charge to room must never be lost or doubled. Choice: save events in the same transaction as the change, deliver with retries, require idempotent handlers. Consequence: slightly more code per module, much safer money flows.

**0005. Money as whole numbers with a currency.** Choice: integers in the smallest unit, currency on every amount, tax rules in localization modules. Reason: avoids rounding errors and supports currencies with different decimals.

**0006. Append-only financial records.** Choice: sales, folio entries, payments, and stock movements are never edited or deleted. Corrections are new linked entries with a reason. Reason: audit trail, trust, and future accounting.

**0007. Reviewed modules only on hosted service.** Problem: modules run inside the server and can reach data. Choice: the hosted service runs only reviewed, signed modules. Self-hosting is unrestricted. Consequence: a public marketplace needs a review process before it exists.

**0008. Apache 2.0 license for the kernel.** Choice: Apache 2.0 (confirm with a lawyer before the first public release). Reason: permissive, so developers can build and sell their own modules. Consequence: others may host the software commercially. Contributors keep their copyright and license contributions under the same terms.

**0009. Modular monolith first.** Choice: one Node.js application with modules inside it, not microservices. Reason: one maintainer can run it. Split only if a measured need appears.

**0010. Database change by numbered migrations.** Choice: versioned migration files per module, tracked per business, with the rule "add first, remove later." Reason: safe upgrades with different businesses on different versions.

## Part 3. Operator guide

For the person who installs, deploys, and maintains the system. You do not need to read or edit code. You use terminal commands, a settings file, and an admin web page.

*Note: the `kernel` commands below are the planned command line tool. They exist only once the CLI is built. Until then, treat this as the specification of what the CLI must do.*

### 3.1 Requirements

| Item | Minimum for about 10 businesses |
| --- | --- |
| Server | 4 CPU cores, 8 GB memory, 100 GB SSD, Linux (Ubuntu LTS) |
| Software | Docker and Docker Compose, Git |
| Network | Fixed IP or domain name, HTTPS certificate, reliable internet |
| Domain | A main domain and wildcard subdomains (for example `*.example.com`) |
| Backup target | A second location (another server or cloud storage) |
| Power | A UPS for the server if the site has unstable electricity |

Hardware for outlets: receipt printer (ESC/POS compatible), cash drawer, barcode scanner, and a certified card terminal. Test your exact models before buying in bulk.

### 3.2 First-time install

1. **Prepare the server.** Update the system, install Docker, create a non-root user for the project.
2. **Get the software.** Clone the repository and move into the project folder.
3. **Create the settings file.** Copy `.env.example` to `.env` and fill in every value (see 3.3).
4. **Start the services.** Run `docker compose up -d`. This starts the app, the control database, and the background worker.
5. **Check it is running.** Open the health address in a browser, or run `docker compose ps`. All services should show as running.
6. **Set up HTTPS.** Point your domain and wildcard subdomain to the server and enable the certificate.
7. **Create the platform admin.** Run the create-admin command and choose a strong password.
8. **Check the backup job.** Confirm the first backup file appears in the backup location (see 3.7).

**How to check it worked:** the admin page loads over HTTPS, you can log in, and the health check says OK.

**If it fails:** read the logs with `docker compose logs app` and see section 3.10.

### 3.3 Settings

All settings live in the `.env` file. Never commit this file to Git.

| Setting | Meaning | Example |
| --- | --- | --- |
| `DATABASE_URL` | Address of the control database | `postgres://user:pass@db:5432/control` |
| `BUSINESS_DB_HOST` | Server that holds business databases | `db` |
| `BASE_DOMAIN` | Main domain; businesses become subdomains | `example.com` |
| `JWT_SECRET` | Secret used to sign login tokens. Long and random | (generated) |
| `SESSION_TTL_MINUTES` | How long a login lasts | `480` |
| `ALLOWED_MODULES` | Modules that may be installed on this server | `pos_core,pos_restaurant,...` |
| `BACKUP_PATH` | Where backups are written | `/backups` |
| `BACKUP_RETENTION_DAYS` | How long to keep backups | `30` |
| `LOG_LEVEL` | Amount of detail in logs | `info` |
| `SMTP_*` | Email sending details (for receipts and alerts) | provider values |

Keep `.env.example` in the repository with placeholder values only, and keep the real `.env` in a safe password manager as well.

### 3.4 Create a business

**Goal:** add a new customer with its own database and users.

**Before you start:** you have the business name, its type (hotel, restaurant, shop), its subdomain, and the owner's name and email.

1. Run `kernel create-business hotel-d --type hotel`.
2. The system creates the database, runs the core migrations, and registers the subdomain.
3. Load the template for the type: `kernel apply-template hotel-d hotel` (sets roles, default tax settings, receipt layout).
4. Create the owner account: `kernel create-user hotel-d --role owner --email owner@example.com`.
5. Send the owner the address and a temporary password.

**Check:** open `hotel-d.example.com` and log in as the owner.

### 3.5 Install and remove apps

**Install:** `kernel install pos_restaurant --business hotel-d`.

The system checks compatibility, installs missing dependencies first, runs the module's migrations inside a transaction (all or nothing), loads default data, and records the installed version. Installing `pos_kitchen` also installs `pos_restaurant` and `pos_core` if missing.

**List:** `kernel modules --business hotel-d` shows installed modules and versions.

**Uninstall:** `kernel uninstall pos_kitchen --business hotel-d`. By default this only hides menus and permissions and keeps the data. It is blocked if another installed module depends on it. Financial records (sales, folio, payments) are never deleted by uninstalling.

After installing, the business owner assigns the new permissions to roles.

### 3.6 Recommended apps by business type

| Business | Apps |
| --- | --- |
| Shop | `pos_core`, `pos_catalog`, `pos_retail`, `inventory` |
| Restaurant or cafe | `pos_core`, `pos_catalog`, `pos_restaurant`, `pos_kitchen` |
| Small hotel | `hotel_rooms`, `hotel_reservations`, `hotel_folio`, `hotel_housekeeping`, `hotel_frontdesk` |
| Hotel with restaurant | All hotel modules, all restaurant modules, `inventory`, and `pos_hotel` (charge to room) |

### 3.7 Backup and restore

**Rules**

- Every business database is backed up every night, and the control database too.
- Backups are copied to a second location, not left on the same server.
- A backup is only real if you have tested a restore. Test one restore per month.
- Take an extra backup immediately before every upgrade.
- Plan to move to continuous archiving (point-in-time recovery) as soon as a business cannot accept losing a day of data. Hotels and busy shops usually cannot.

**Take a backup now:** `kernel backup --business hotel-d`.

**Restore one business:**

1. Tell the business to stop using the system.
2. Run `kernel restore --business hotel-d --from <backup file>`. The command restores into a fresh database and only switches over when the restore succeeds.
3. Check the latest sales and reservations look right.
4. Tell the business to resume, and note what time range of data was lost.

**Monthly restore test:** restore a backup into a temporary test business and open it.

### 3.8 Upgrade

1. Read the changelog for the new version and note any steps marked "manual."
2. Back up all businesses.
3. Pull the new version and rebuild: `git pull`, then `docker compose up -d --build`.
4. Upgrade your **test business** first: `kernel upgrade --business test`.
5. Open it and run a sample sale or reservation.
6. Upgrade one friendly business, then the rest, one at a time.
7. The start-up check refuses to run a business whose database is behind its code. If you see that message, run the upgrade for that business.

**If an upgrade fails:** the migration is rolled back automatically. Restore from the backup taken in step 2 only if data was damaged.

### 3.9 Monitoring and logs

- **Uptime check:** an outside service pings the health address every minute and alerts your phone.
- **Daily check (5 minutes):** backups succeeded, disk space under 80 percent, no failed events in the exception list, no error spikes.
- **Logs:** `docker compose logs app --tail 200`. Every log line carries the business name so you can answer "what happened to this customer at 2pm."
- **Disk space:** the most common cause of sudden failure. Alert at 80 percent.

### 3.10 Troubleshooting

| What you see | Likely cause | How to confirm | Fix |
| --- | --- | --- | --- |
| Site does not load | App container stopped | `docker compose ps` | `docker compose up -d`, then read logs |
| "Database behind code" message for one business | Upgrade not run | `kernel modules --business X` shows older versions | Run `kernel upgrade --business X` |
| One business cannot log in, others can | Wrong subdomain or inactive business | Check business status in the admin | Fix the subdomain or reactivate |
| Charge to room is missing on the folio | Event failed or is waiting | Exception list in the admin | Retry the event; if it fails again, post the charge manually with a reason |
| Receipts not printing | Printer or print agent offline | Test print from the printer's own tool | Check cable, power, and the print agent; use manual receipt book meanwhile |
| Slowness at lunch | Heavy report running on the live database | Logs show long queries | Run reports off-peak; consider a reporting copy |
| Install fails with dependency error | Missing or circular dependency | Error message names the modules | Install the missing module or fix the manifest |
| Disk full | Logs or backups growing | `df -h` | Delete old backups per retention, rotate logs, add disk |

### 3.11 Downtime procedures (paper fallback)

Print these and keep them at each desk. Every business must practice them once.

**Restaurant or shop, internet down**

1. The POS keeps selling locally. Cash and card terminal payments continue normally.
2. Charge to room is not available. The cashier writes the room number, guest name, and amount on a slip, and the guest signs it.
3. When the internet returns, the POS syncs. A manager checks the exception list and posts the slips.

**Hotel front desk, internet down**

1. Use the printed arrivals and in-house lists printed each morning.
2. Record check-ins and check-outs on paper with time.
3. Do not sell rooms for dates you cannot verify. Check the printed availability sheet.
4. When the system returns, enter everything in time order and compare with the paper.

**Power or printer failure:** use the manual receipt book with numbered pages, and enter the receipts afterwards.

### 3.12 Support access

Operators and partners can access a business only with a time-limited grant. Every access is logged and visible to the business owner. Never share a business owner's password. Never copy a business's data to a personal computer.

### 3.13 Data export and deletion

Each business can request a full export of its data. When a business leaves, export their data, keep it for the period required by local law, then delete the database and backups and record the date.

## Part 4. Developer guide

For people who build modules. You need basic TypeScript, SQL, and Git. Some details below describe the intended design and will be confirmed as the kernel is built; each reference page is marked with the version it applies to.

### 4.1 Getting started

1. Install Node.js (the version in `.nvmrc`), Docker, Git, and an editor such as VS Code.
2. Clone the repository and run `npm install`.
3. Copy `.env.example` to `.env`.
4. Start the database with `docker compose up -d db`.
5. Run `npm test` to confirm everything passes.
6. Run `npm start`, then create a development business with `kernel create-business dev --type blank`.

### 4.2 Build your first module (tutorial)

Goal: a module called `shop_notes` that lets a shop attach a short note to a product. About 30 minutes.

1. **Scaffold.** Run `kernel scaffold module shop_notes`. This creates the folder, a manifest, a first migration, and a test file.
2. **Open the manifest** and set the name, version `0.1.0`, the compatible kernel range, and `depends: ["pos_catalog"]`.
3. **Define your data.** Add a model `shop_notes.note` with fields `product` (link to a product), `text`, and `created_by`. Because you are adding data about a product you do not own, your module stores it in its **own table** linked to the product.
4. **Write the migration.** Create `migrations/001_create_notes.sql` with the table and an index on the product link. Never edit this file after release.
5. **Declare a permission.** Add `shop_notes.edit` in the permissions file with a one-line description.
6. **Add a menu entry and a form** in the interface definition.
7. **React to an event (optional).** Listen to `pos.order.paid` and, for example, count how many notes were shown at sale time.
8. **Write a test** that creates a note and checks it is saved and linked.
9. **Install it** on the development business: `kernel install shop_notes --business dev`.
10. **Check it worked:** log in to the dev business, open the product screen, and add a note. Check the audit log shows the action.

If something fails, read the migration error first. Most beginner problems are a wrong dependency name or a migration typo.

### 4.3 Module structure

```
my_module/
  manifest        name, version, kernel range, dependencies
  models/         data definitions
  migrations/     numbered database changes (001_, 002_, ...)
  operations/     hand-written business logic (for money and stock)
  permissions     permissions this module creates
  events          events it announces and handles
  ui/             menus, screens, form and list definitions
  data/           default records (roles, sequences, settings)
  tests/
  README          what it does, rules, known limits
```

### 4.4 Reference: manifest

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Lowercase letters, digits, underscore. Unique. Example `pos_restaurant`. |
| `version` | yes | Semantic version, such as `1.2.0`. |
| `kernel` | yes | Compatible kernel range, such as `>=1.0 <2.0`. |
| `depends` | yes | List of module names. May be empty. No cycles. |
| `description` | yes | One sentence. |
| `permissions` | no | Permissions this module adds. |
| `models` | no | Data definitions. |
| `events` | no | Events announced and events handled. |
| `settings` | no | Configurable options with defaults. |
| `license` | yes | License identifier for this module. |
| `author` | yes | Name and contact. |

### 4.5 Reference: models and fields

Field types: `string`, `text`, `integer`, `money` (whole number in smallest unit plus currency), `boolean`, `date`, `datetime` (stored UTC), `select` (fixed list), `link` (points to a record in another model), `decimal-quantity` (for weights and measures).

Every model automatically gets: a UUID `id`, a created time, a created-by user, an updated time, and an active flag. Financial models also get a business date.

Names of models and fields must match `[a-z][a-z0-9_]*`. The kernel rejects anything else.

**Setup data vs transactional data**

| Kind | Examples | How to build |
| --- | --- | --- |
| Setup data | Categories, departments, room types | Generated create/read/update screens are allowed |
| Transactional data | Orders, payments, folio entries, stock moves | Hand-written operations in a single transaction, append-only |

### 4.6 Extending another module

You must not edit another module's tables or code. To add data to someone else's record:

1. Declare a model in your module with a link to their model.
2. Your table holds the extra fields.
3. The kernel can merge your fields into screens and the API for that record.
4. Uninstalling your module hides your fields and leaves the original data untouched.

To change behavior, use **events** (see 4.7) or the other module's documented **extension points** (for example, adding a payment method to POS).

### 4.7 Reference: events

Event names are public API. They follow `area.object.action` in the past tense, for example `pos.order.paid`. Renaming or removing an event is a breaking change.

**Rules**

- An event is saved in the same database transaction as the change that causes it (the outbox).
- A worker delivers events with retries.
- **Handlers must be idempotent.** Use the event's unique ID to ignore repeats.
- A handler that keeps failing moves the event to the exception list.
- Handlers should be fast. Slow work is queued separately.

**Core events (initial list, each versioned)**

| Event | Announced when | Main contents |
| --- | --- | --- |
| `pos.session.opened` / `closed` | A cashier session starts or ends | session, register, cash counts |
| `pos.order.paid` | An order is fully paid | order, lines, payments, outlet |
| `pos.order.voided` | A paid or open order is voided | order, reason, approver |
| `pos.order.refunded` | A refund is made | order, lines, reason, approver |
| `pos.order.charged_to_room` | Charge to room chosen | order, room, guest, amount |
| `kitchen.ticket.ready` | Kitchen marks a ticket ready | ticket, table |
| `hotel.reservation.created` / `cancelled` | Reservation changes | reservation, dates, room type |
| `hotel.guest.checked_in` / `checked_out` | Guest arrives or leaves | reservation, room, folio |
| `hotel.folio.charge_posted` | A charge lands on a folio | folio, amount, source |
| `hotel.room.status_changed` | Room status changes | room, old, new |
| `hotel.night_audit.closed` | Business date closed | business date, totals |
| `inventory.stock.low` | Stock falls under reorder level | product, location |
| `kernel.module.installed` | A module is installed for a business | module, version |

This table will be replaced by a list generated from the code.

### 4.8 Reference: permissions

A permission is `module.action`, for example `pos.void_order`. Modules declare their permissions in the manifest. Businesses combine them into roles. The kernel checks permissions on every operation. Sensitive actions (void, refund, discount, price change, folio correction) must also be written to the audit log with a reason.

### 4.9 Reference: migrations

1. Files are numbered `001_`, `002_`, and run in order, once per business.
2. Never edit a released migration. Add a new one.
3. Each migration runs in a transaction.
4. Follow **add first, remove later**: add the new column and keep both for a release before dropping the old one.
5. Test every migration on a copy of realistic data.
6. Do not delete financial data in a migration.

### 4.10 Reference: API

- REST, versioned under `/api/v1/`.
- Every request is scoped to the business from the web address.
- Every request is authenticated and permission-checked.
- Lists support filtering and a limit (maximum 200).
- Errors return a standard shape: an error code and a human-readable message.
- Setup data models get automatic endpoints. Transactional data uses explicit operations such as `POST /api/v1/pos/orders/{id}/pay`.
- POS sync endpoint: accepts a batch of orders keyed by unique ID and returns which were accepted. Repeating a batch must not create duplicates.

### 4.11 Reference: command line

| Command | Purpose |
| --- | --- |
| `kernel scaffold module <name>` | Create a new module skeleton |
| `kernel create-business <name> --type <type>` | Create a business |
| `kernel apply-template <business> <template>` | Load a business-type template |
| `kernel create-user <business> --role <role> --email <email>` | Create a user |
| `kernel install <module> --business <name>` | Install a module |
| `kernel uninstall <module> --business <name>` | Hide a module (data kept) |
| `kernel modules --business <name>` | List installed modules and versions |
| `kernel upgrade --business <name>` | Run pending migrations |
| `kernel backup --business <name>` | Take a backup |
| `kernel restore --business <name> --from <file>` | Restore a backup |
| `kernel test <module>` | Run a module's tests |
| `kernel shell --business <name>` | Open a development console |

### 4.12 Guide: money and tax

- Store amounts as whole numbers in the smallest unit (for example cents) with a currency code.
- Never use floating-point numbers for money.
- Decide per country: are prices tax-inclusive or tax-exclusive, is rounding done per line or per receipt, and can one item have several taxes.
- Put country-specific rules in a **localization module** (for example `l10n_<country>`), not in the core.
- Check early whether your country requires a fiscal device or electronic invoicing. It can change the receipt design.
- Test with real sample receipts and compare totals with a manual calculation.

### 4.13 Guide: offline sync

1. The POS loads a local copy of the catalog, prices, taxes, and users' permissions at session start.
2. Each order gets a unique ID on the device. A sale never waits for the server.
3. Completed orders go into a local queue and are sent when the connection returns.
4. The server accepts each order ID once and re-checks prices and tax.
5. Each register has its own receipt number range.
6. Features that cannot be verified offline (charge to room, gift cards, stock limits) follow the exception-list policy rather than blocking the sale.

### 4.14 Guide: testing

- Every module ships with automated tests that run with `kernel test`.
- Test migrations on an empty and on a populated database.
- Test event handlers by delivering the same event twice.
- For money flows, test failure in the middle: stop the process between the sale and the event delivery, then check the books are consistent.
- Continuous integration runs lint and tests on every pull request.

### 4.15 Module policy

**A module may**

- Declare its own models, permissions, screens, and events.
- Depend on modules below it in the dependency order.
- Listen to documented events and use documented extension points.
- Add its own tables linked to other modules' records.

**A module must not**

- Read or write another module's tables directly.
- Edit or delete financial records.
- Store card numbers or other payment secrets.
- Make network calls to unknown services without declaring them in the manifest.
- Contain secrets, keys, or real customer data.
- Break a documented event or interface within the same major version.

**On the hosted service** only reviewed and signed modules may run. Review checks the manifest, migrations, permissions, network calls, and tests. Self-hosters may install any module at their own risk.

### 4.16 Versioning and compatibility

- Kernel and modules use semantic versions: major (breaking), minor (new features), patch (fixes).
- Before 1.0, minor versions may break things. This is stated in the README.
- After 1.0, breaking a public event, interface, or manifest field requires a new major version and at least 12 months of notice and deprecation warnings.
- Each module declares the kernel range it supports, and the installer refuses incompatible combinations.

## Part 5. Module reference

One entry per module. Each page uses the same layout: purpose, depends on, roles, rules, events, known limits.

### 5.1 Core modules

**`core_base`**

- **Purpose:** users, roles, permissions, audit log, number sequences, settings, attachments, notifications.
- **Depends on:** nothing.
- **Rules:** every sensitive action is written to the audit log with who, when, and why. Sequences never skip numbers and are separate per register where offline use is possible.
- **Events:** `kernel.module.installed`, `kernel.user.created`, `kernel.login.failed`.

**`core_contacts`**

- **Purpose:** one record for every person or company: guests, customers, suppliers, staff contacts.
- **Depends on:** `core_base`.
- **Rules:** one owner per record. Other modules link to a contact and never copy it. ID document details are stored encrypted and visible only to roles with `contacts.view_id`.

**`product`**

- **Purpose:** one shared catalog of sellable things: menu items, retail goods, room types, services.
- **Depends on:** `core_base`.
- **Rules:** stock tracking is optional per product. Quantities allow decimals for weighed goods. A menu item is a product with extra restaurant fields added by `pos_restaurant`, not a separate catalog.

### 5.2 POS modules

**`pos_core`**

- **Purpose:** outlets, registers, cashier sessions, orders, order lines, payments, receipts.
- **Depends on:** `core_base`, `product`.
- **Roles:** cashier (open session, sell, take payment), manager (void, refund, discount approval, close sessions).
- **Rules:** a paid order is never deleted. Voids and refunds create linked entries with a reason and manager approval. Each session is opened and closed with a counted cash amount, and the difference is recorded. Receipt numbers are sequential per register with no gaps.
- **Events:** `pos.session.opened`, `pos.session.closed`, `pos.order.paid`, `pos.order.voided`, `pos.order.refunded`.
- **Known limits:** no card processing inside the system; use a certified terminal and store only a reference.

**`pos_catalog`**

- **Purpose:** POS categories, prices, price lists, taxes, discounts.
- **Depends on:** `pos_core`.
- **Rules:** the server re-checks prices and tax when orders sync. Discounts above a set limit need manager approval.

**`pos_restaurant`**

- **Purpose:** floor plan and tables, modifiers (no onions, extra cheese), seats and courses, split bills, tips.
- **Depends on:** `pos_catalog`.
- **Roles:** waiter (open tables, take orders), cashier, manager.
- **Rules:** a table may have only one open order at a time. Splitting a bill never changes the total. Tips are recorded separately from sales.

**`pos_kitchen`**

- **Purpose:** kitchen and bar screens or printed tickets, routing by station, preparation status.
- **Depends on:** `pos_restaurant`.
- **Events:** `kitchen.ticket.ready`.
- **Rules:** items are routed to stations by category. Kitchen staff cannot see prices or payments.
- **Known limits:** with more than one app server, live updates need a shared message channel.

**`pos_retail`**

- **Purpose:** barcode scanning, fast search, variants (size, colour), returns and exchanges, weighed items, loyalty.
- **Depends on:** `pos_catalog`.
- **Rules:** a return links to the original order line. Returned stock goes back to the shelf only if the cashier confirms the item is resellable.

**`pos_reports`**

- **Purpose:** end-of-day report, sales by item, hour, cashier, outlet, and payment method.
- **Rules:** reports should run off-peak or on a reporting copy, not slow the POS at lunch.

### 5.3 Hotel modules

**`hotel_rooms`**

- **Purpose:** room types, rooms, rate plans, seasons.
- **Depends on:** `core_base`, `product`.
- **Rules:** a room has exactly one status at a time: vacant clean, vacant dirty, inspected, occupied, out of order.

**`hotel_reservations`**

- **Purpose:** availability, reservations, check-in, check-out, room moves, cancellations.
- **Depends on:** `hotel_rooms`, `core_contacts`.
- **Roles:** receptionist, manager.
- **Rules:** the same room can never be sold twice for the same night. Availability is checked for every night of the stay inside a transaction with locking. Only clean or inspected rooms can be assigned at check-in.
- **Events:** `hotel.reservation.created`, `hotel.reservation.cancelled`, `hotel.guest.checked_in`, `hotel.guest.checked_out`.

**`hotel_folio`**

- **Purpose:** the guest's running bill: room charges, extras, posted restaurant charges, deposits, payments.
- **Depends on:** `hotel_reservations`.
- **Rules:** folio entries are never edited or deleted. A correction is a negative entry with a reason, approved by a manager. A folio with a balance cannot be closed without manager approval and a reason. A folio can be split between a guest and a company account.
- **Events:** `hotel.folio.charge_posted`.

**`hotel_housekeeping`**

- **Purpose:** room status board, task lists, inspection, lost property, maintenance reports.
- **Depends on:** `hotel_rooms`.
- **Roles:** supervisor (assign, inspect), housekeeper (own rooms only, mark clean, report problems).
- **Rules:** a checkout automatically creates a cleaning task. Housekeepers see room numbers and tasks, not guest details or money.

**`hotel_frontdesk`**

- **Purpose:** arrivals and departures lists, in-house list, night audit.
- **Depends on:** `hotel_reservations`, `hotel_folio`.
- **Roles:** receptionist, night auditor, manager.
- **Rules:** night audit posts room charges for the night, checks for problems, and closes the business date. After closing, nothing in that date can be changed. Corrections go on the new date.
- **Events:** `hotel.night_audit.closed`.

### 5.4 Bridge and back-office modules

**`pos_hotel` (charge to room)**

- **Purpose:** the only module that knows both POS and hotel. Adds the payment method "Charge to room" and posts the amount on the guest's folio.
- **Depends on:** `pos_core`, `hotel_folio`.
- **How it works:** the cashier picks a room, and the system shows the guest's name for confirmation. The sale is saved and `pos.order.charged_to_room` is recorded in the outbox. The bridge handles the event, posts to the folio linked to the receipt number, and ignores repeats. If posting fails, the event is retried and shown on the exception list for the night auditor.
- **Rules:** a charge is allowed only for a checked-in guest with an open folio. Some hotels may also require a signature or PIN.

**`inventory`**

- **Purpose:** stock items, stock locations, receiving, counts, reorder levels, deduction on sale, and recipes for restaurants (ingredients per dish).
- **Depends on:** `product`.
- **Rules:** stock changes are append-only movements. Counts create correcting movements.
- **Events:** `inventory.stock.low`.

**`accounting_lite` (later)**

- **Purpose:** daily sales journal and tax report from sales, payments, and folios.
- **Rules:** only reads posted, append-only records.

### 5.5 Business templates

| Template | Sets up |
| --- | --- |
| `shop` | Cashier, manager, stock keeper roles; tax defaults; barcode receipt layout |
| `restaurant` | Waiter, cashier, kitchen, manager roles; table layout starter; kitchen stations |
| `hotel` | All hotel roles; room type starters; night audit checklist |
| `hotel_with_restaurant` | Hotel and restaurant roles combined, plus the charge-to-room bridge settings |

## Part 6. Staff guides

Short task guides for people who use the screens. Screenshots are added after each pilot. Keep each guide to one page.

### 6.1 Cashier

**Open your session**

1. Log in and choose your register.
2. Count the cash in the drawer and enter the amount.
3. Press Open session.

**Make a sale (shop)**

1. Scan each item, or type its name or code in the search box.
2. Change the quantity if needed.
3. Press Pay, choose the payment method, and enter the amount.
4. The receipt prints. Give it to the customer.

**Take payment (restaurant)**

1. Open the table and check the order with the guest.
2. Press Pay. To split the bill, press Split and choose items or amounts.
3. Choose cash, card, mobile money, or Charge to room.
4. For Charge to room, enter the room number, confirm the guest's name with the guest, and finish.

**Void or refund:** you cannot do this alone. Press Request approval, give the reason, and ask the manager to approve.

**Close your session**

1. Press Close session.
2. Count the cash and enter the amount.
3. The screen shows the difference. Do not change anything to hide a difference. Tell your manager.
4. Print the end-of-day report.

**If the internet stops:** keep selling. Cash and card still work. For Charge to room, write the room number, guest name, amount, and get the guest's signature on a slip. Give slips to the manager.

### 6.2 Waiter

1. Log in and open the floor plan.
2. Tap a table, add items, and tap modifiers for special requests (for example no onions).
3. Press Send. The kitchen sees the order at once.
4. When the kitchen marks an item ready, you get a notification.
5. Tell the cashier when the table is ready to pay. You cannot give discounts or void paid items.

### 6.3 Kitchen staff

1. The screen shows new tickets in order, with table and notes.
2. Tap a ticket to mark it Preparing, then Ready.
3. If an item is out of stock, tell the manager so the menu can be updated.

### 6.4 Receptionist

**Make a reservation**

1. Open Reservations, choose dates and room type, and check availability.
2. Enter the guest's name, phone, and ID details.
3. Confirm the price and save.

**Check in a guest**

1. Open today's arrivals and choose the reservation.
2. Assign a room from the list (only clean rooms appear).
3. Check the ID and take a deposit if required.
4. Press Check in and give the key.

**Add an extra charge:** open the folio, press Add charge, choose the item, and give a reason.

**Fix a wrong charge:** you cannot delete it. Press Request correction. A manager approves, and the system adds a reversing entry.

**Check out a guest**

1. Open the folio and read each charge with the guest, including restaurant charges.
2. Take payment and record it on the folio.
3. Press Check out. The invoice prints, and housekeeping is told.

### 6.5 Night auditor

1. Open Night audit and work down the checklist.
2. Resolve each item: unclosed restaurant sessions, charges that failed to post, no-shows, folios with balances.
3. Run the audit. It posts tonight's room charges and shows the daily summary.
4. Close the business date. After this, the day cannot be changed.

### 6.6 Housekeeping

**Supervisor:** each morning open the status board, assign rooms to housekeepers, and inspect cleaned rooms. A room becomes ready to sell only after inspection.

**Housekeeper:** open My rooms, clean in the order shown, tap Clean when finished, and report broken items or lost property with a photo if possible.

### 6.7 Manager

- **Approve** voids, refunds, discounts, and folio corrections from the approvals list. Always read the reason.
- **Review daily:** sales summary, differences in cash counts, voids and refunds, the exception list.
- **Manage users:** create users, assign roles, and deactivate people who leave the same day.
- **Stock:** record deliveries and run counts. Differences create correction entries, never overwrites.

## Part 7. Contributing

### 7.1 Ways to help

Report bugs, improve documentation, write tests, build modules, translate screens, or test the system in a real hotel, restaurant, or shop. Start with issues labeled `good first issue`.

### 7.2 How to contribute code

1. Open an issue first for anything larger than a small fix, so we agree before you spend time.
2. Fork the repository and create a branch such as `feature/ticket-export` or `fix/login-error`.
3. Make your change. Add or update tests and documentation.
4. Run `npm run lint` and `npm test`. Both must pass.
5. Open a pull request using the template. Describe what changed and why.
6. A maintainer reviews. Please reply to review comments within a week.
7. Pull requests are squash-merged into `main`.

**Commit messages** start with a type: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.

### 7.3 Pull request checklist

- [ ] Tests added or updated and passing
- [ ] Documentation page added or updated
- [ ] No secrets or real customer data
- [ ] Migrations are new files, not edits to old ones
- [ ] Public events, permissions, or API changes are listed and versioned
- [ ] Financial records remain append-only

### 7.4 Code style

- TypeScript everywhere in the kernel and first-party modules.
- Prettier formats code automatically. ESLint catches mistakes.
- Parameterized SQL only. Never build queries from user input.
- Money is whole numbers with a currency, never floating point.
- Prefer clear names over comments, and comment the reasons, not the steps.

### 7.5 Reporting security problems

Do not open a public issue. Use the private vulnerability reporting feature or the contact in `SECURITY.md`. Please give details so we can reproduce the problem. We aim to acknowledge reports within a few days and will credit you if you wish.

### 7.6 Governance

The project is led by its maintainer, who decides what is merged and what is on the roadmap, with discussion in public issues. More maintainers are added from regular contributors. Decisions of lasting effect are written as records in `docs/architecture/decisions/`.

### 7.7 Code of conduct

We follow the Contributor Covenant. Be respectful, assume good intent, and give clear, kind feedback. Harassment is not tolerated. Report problems to the maintainer privately.

### 7.8 Release process

1. Update the changelog with every user-visible change.
2. Choose the version number by the rules in 4.16.
3. Run all tests, and upgrade a test business from the previous version.
4. Tag the release in Git and publish release notes, naming contributors.
5. Note any manual upgrade steps clearly at the top.

### 7.9 License and ownership

The kernel is released under Apache 2.0 (confirm before the first public release). Contributors keep their copyright and agree that their contribution is licensed under the same terms. Modules written by others may use their own license, stated in the manifest.

## Part 8. Repository files and templates

### 8.1 Files at the repository root

| File | Content |
| --- | --- |
| `README.md` | What it is, status warning, five-minute quick start, link to these docs |
| `LICENSE` | Apache 2.0 text |
| `CONTRIBUTING.md` | Part 7 in short form |
| `CODE_OF_CONDUCT.md` | Contributor Covenant |
| `SECURITY.md` | Private reporting contact and response times |
| `ROADMAP.md` | Part 1.4, kept current |
| `CHANGELOG.md` | Every release, newest first |
| `.env.example` | Setting names with placeholder values only |

### 8.2 README starter text

> **Kernel ERP** is an open source, modular business system for hotels, restaurants, and shops. Each business has its own private database and installs only the apps it needs: POS, kitchen display, front desk, housekeeping, folio, inventory.
>
> **Status: early preview. Not for production use.**
>
> **Quick start:** install Node.js and Docker, clone the repository, copy `.env.example` to `.env`, run `docker compose up -d`, then `npm install` and `npm start`. Full instructions are in the documentation.
>
> Contributions are welcome. See CONTRIBUTING.md.

### 8.3 Page templates

**Module page:** purpose, who uses it, depends on, screens, roles and permissions, events announced, events listened to, rules, known limits.

**How-to page:** goal, before you start, numbered steps, how to check it worked, if it fails.

**Decision record:** problem, options considered, choice, reasons, consequences.

**Troubleshooting entry:** what you see, likely cause, how to confirm, how to fix.

### 8.4 Documentation rules

1. A feature is not done until its page exists.
2. Reference pages (events, permissions, manifest) are generated from code once the kernel exists.
3. Every how-to is tested by someone who did not write it.
4. Use one word for one idea, following the glossary.
5. Date and version each page.
6. Write short sentences in plain language, because many readers use English as a second language.
7. Decision records are never rewritten, only replaced by a newer one.

### 8.5 Open questions to settle before first release

- Project name, and checking it is free on GitHub, npm, and as a domain.
- Written approval from the employer about open sourcing and code ownership.
- Final license choice after legal advice.
- Local tax and receipt rules, and any fiscal device requirement.
- Which payment methods and providers (cards, mobile money) are used locally.
- Whether restaurants and shops are run by the hotel or by separate tenants.
- Hardware models for printers, drawers, scanners, and card terminals.




# Kernel ERP (working name) — early preview, not for production

Modular business system for hotels, restaurants and shops. One database per business; apps are modules.

## Quick start
```bash
docker compose up -d                 # PostgreSQL
cp .env.example .env                 # set JWT_SECRET
npm install
npm test
npm run kernel -- create-business hotel-d --name "Hotel D" --type hotel
npm run kernel -- create-user --business hotel-d --email owner@example.com --name Owner --password 'a-long-password' --role owner
npm start
```
Try it (dev mode uses the `x-business` header; production uses `<slug>.BASE_DOMAIN`):
```bash
curl -s localhost:3000/api/v1/core_base/auth/login -H 'x-business: hotel-d' -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"a-long-password"}'
curl -s localhost:3000/api/v1/core_base/me -H 'x-business: hotel-d' -H "authorization: Bearer <token>"
```

## What exists
- Control database + one database per business, resolved per request (`src/tenancy.ts`, `src/db.ts`)
- Module loader: manifests, dependency order, cycle/missing detection, per-business install, numbered SQL migrations (`src/loader.ts`, `src/migrations.ts`)
- `core_base` module: users, roles, permissions, append-only audit log, outbox, sequences, login (argon2 + JWT)
- Outbox events with retries and a failed-event list (`src/events.ts`, `src/worker.ts`)
- CLI: create-business, install, modules, upgrade, create-user

## Next
`product`, `core_contacts`, then `pos_core`. See docs.



docker compose up -d                 
cp .env.example .env                 
npm install