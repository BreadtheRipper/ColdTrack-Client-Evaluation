# ColdTrack — freezer and chiller locations

ColdTrack is a self-hosted freezer and chiller location and service tracker for an office network. The Python web server, SQLite database, account data, and uploaded/entered records stay on the host machine; the browser app uses no external services.

## Windows setup

Install Python 3.10 or newer, then in PowerShell from this folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

On first startup ColdTrack creates a blank database and seeds only the Area/Province hierarchy from the `Locations` sheet in `Developers.xlsx`. That workbook's sample equipment and freezer lists are not imported or treated as required options. Areas and Provinces can be added, renamed, reassigned, deactivated, or restored in Administration; changes are retained across restarts. Create the first administrator account and start the server:

```powershell
python app.py create-admin
python app.py serve --host 0.0.0.0 --port 8000
```

For a guided Windows setup, double-click `first_time_setup.bat`. It checks for Python 3.10 or newer, offers to install Python 3.12 silently through `winget` when available, creates the virtual environment, installs the requirements, and prompts to create the first administrator if one does not exist. If `winget` is unavailable or automatic installation fails, it opens the official Python downloads page. After setup, double-click `run_app.bat` to start the office server. Leave its console window open while employees use the app; press Ctrl+C there to stop it.

Find the host machine's private IPv4 address with `ipconfig`; employees on the same office network can open `http://HOST-IP:8000` in a browser. Allow inbound TCP port 8000 only on the Windows **Private** network profile, and limit the firewall rule to the office subnet. Do not port-forward the server or expose it to the public internet. The app does not configure Windows Firewall automatically.

The server uses plain HTTP by default. Use only on a trusted office LAN; if credentials must cross an untrusted wireless or network segment, put the app behind an internally trusted HTTPS endpoint before use.

## Using the app

- Open **Import data** in the app to preview a workbook before submission. The review displays every imported item as an editable spreadsheet-style row, so store/contact corrections and dropdown choices are made in context and apply only to that row. Single-sheet customer/freezer workbooks are selected automatically; legacy multi-sheet workbooks still allow sheet selection, with `EXPORT` and `SHIPMENT` optional.
- The current customer/freezer workbook maps Store Name, Store Location (Business Address), the adjacent unheaded region column (Area), AREA (Province), Store Manager, Store Contact, Sales Rep, Description, Model Number, Serial Number, Freezer Brand, and Date of Delivery. Sales Rep is saved with the store; Manufacturer is left blank if that workbook has no separate manufacturer column. Blank Area/Province values stay blank and are explicitly listed for review.
- Import normalization collapses whitespace and uppercases values but does not silently map variants. Area and Province are linked dropdowns, so the Province choices update to match the selected Area. Geography must use approved values; missing Area/Province values remain blank only after acknowledgment. Freezer Brand, equipment description, Manufacturer, and Model can be mapped to an approved value or proposed as a new dropdown value. Proposed values require administrator approval before any batch records become inventory. Unrecognized delivery dates must be normalized to `YYYY-MM-DD` or explicitly left blank.
- For legacy workbooks, a `Store Location` that does not exactly match an approved Province must be explicitly classified as a business address or assigned to an Area/Province. Area and Province are separate fields; administrators can maintain their values and hierarchy in the Controlled lists panel.
- Start from the **Stores & customers** directory. Each branch is a separate store, identified by its business name and address. Open a store to view the freezers currently there, see each unit's latest service, and edit store details, Sales Rep, and store notes. The navigation sidebar can be collapsed to expand the working area.
- Use **Add freezer** in a store to add unassigned stock or register a new unit at that store without creating a service visit. Use **Add service** only when recording an actual service visit.
- Open **Equipment** to see current units and their locations. **Add equipment** registers a unit as unassigned stock; when it is sent to a store, add it from that store's freezer list. Each unit appears once at its current location, while its prior placements and service histories remain preserved.
- Use **Add service** to choose a store and an existing freezer, or create a store/freezer while recording the visit. Repairs, parts, and notes are free text. Administrators manage the controlled Freezer Brand, Manufacturer, equipment type, model, and technician dropdowns.
- Open a freezer to see the service history for that placement. If it moves, use **Record move** to create a new placement at another store; the previous store's record and service history remain, and the new placement starts with no copied services.
- The service report can filter by store as well as technician and freezer details. A store filter includes visits tied to freezer placements at that store, including placements that have since moved away.
- Staff can add services and update store information. Administrators can also create and disable accounts, reset passwords, add or edit dropdown values (including Areas and Provinces), review similar-value suggestions, and inspect the activity log.
- Controlled freezer and technician values use managed dropdowns. In **Administration → Controlled lists**, edit a value and select **Save name** to correct a typo; the rename updates linked records. Administrators can also consolidate duplicates by merging them; deactivation keeps past records intact.
- **Administration → Database backups** creates downloadable SQLite backups and schedules automatic daily backups at a time selected by an administrator. Automatic backups run only while the server is running, are stored in `instance\backups`, and the latest 30 are retained. Download backups to another protected device or storage location for protection against host or disk failure; backup files contain the full database, including password hashes.
- **Administration → Reset for testing** first creates a backup, then deletes all records, logs, and dropdown values while retaining only the administrator who requested the reset. The reset stays in effect after a server restart; required dropdowns, including Areas and Provinces, need to be added again.

## Data and backups

The database and session-signing key are stored under `instance\` and excluded from version control. Back up `instance\sorter.sqlite3` and `instance\.secret_key` regularly, storing copies somewhere access-controlled. Keep a backup before importing a workbook or making bulk list changes. Imported rows retain their source sheet and row so a reviewed repeat import can update the corresponding source records.

The master sheet has no service log. Its current location is imported as a starting location with no historical effective date; service history begins when users record visits in ColdTrack.

## API documentation

See [API.md](./API.md) for the authenticated JSON API reference, route catalog, import workflow, and request examples.

