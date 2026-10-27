# ColdTrack API

This document describes the JSON API implemented by the Flask application. The API is intended for trusted clients on the same protected office network as ColdTrack. It is not a public internet API.

## Base URL and conventions

Use the same origin as the web app, for example `http://HOST-IP:8000`.

- JSON requests and responses use UTF-8.
- Dates use `YYYY-MM-DD`.
- Successful list responses generally use `{"items": [...]}`; a failed request returns `{"error": "..."}`.
- Record IDs are integers. Store and freezer refer to different records: an asset ID identifies one freezer placement.
- Authenticated requests use the session cookie created by `/api/login`. The API does not issue bearer tokens.
- All `POST`, `PATCH`, and `DELETE` requests other than `/api/login` must include the current `X-CSRF-Token` header. Obtain it from `/api/me` or the login response. Keep and send the session cookie with the token.
- Staff can use ordinary data and import routes. Routes under `/api/admin/` require an active administrator account.

### Example: login and make an authenticated request

The example uses `curl.exe` from PowerShell. Replace the host, username, and password. Protect the cookie file because it grants access to the signed-in session.

```powershell
$base = "http://127.0.0.1:8000"
curl.exe -c cookies.txt -b cookies.txt -H "Content-Type: application/json" `
  -d '{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}' "$base/api/login"
```

The login response contains `csrf_token`. Copy it for later mutations:

```powershell
$csrf = "TOKEN_FROM_LOGIN_RESPONSE"
curl.exe -b cookies.txt -H "X-CSRF-Token: $csrf" "$base/api/stores"
```

JSON mutation example:

```powershell
curl.exe -b cookies.txt -X PATCH -H "Content-Type: application/json" `
  -H "X-CSRF-Token: $csrf" `
  -d '{"sales_rep":"JANE SMITH","notes":"Call before delivery."}' `
  "$base/api/stores/1"
```

## Session and reference data

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/me` | Public | Returns the current active user or `null`, and ensures a CSRF token exists. |
| `POST /api/login` | Public | Signs in with `{"username":"…","password":"…"}`; returns `user` and `csrf_token`. |
| `POST /api/logout` | Signed in | Clears the session. |
| `GET /api/lookups` | Signed in | Returns active controlled values keyed by field. Province objects include `parent_value` (Area). |

Lookup field names used by the app include `product_line` (Freezer Brand), `equipment_type`, `equipment_brand` (Manufacturer), `model`, `area`, `province`, and `technician`.

## Stores

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/stores?search=...` | Signed in | Lists stores. Search covers name, address, geography, manager, contact, Sales Rep, and notes. Each item includes freezer/service counts and latest service. |
| `GET /api/stores/{store_id}` | Signed in | Returns `store` and its current `freezers`. |
| `PATCH /api/stores/{store_id}` | Signed in | Updates store/customer information. |

Store fields include `store_name`, `business_address`, `area`, `province`, `manager`, `contact`, `sales_rep`, and `notes`. `notes` is the store-notes text. Area and Province must be an approved matching pair. Partial updates are accepted; omitted fields retain their values.

Example:

```json
{
  "sales_rep": "JANE SMITH",
  "notes": "Use the side entrance; manager is available after 10 AM."
}
```

## Freezers and services

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/assets` | Signed in | Lists freezer placements. Supports `search`, `page`, `per_page`, `sort`, `direction`, and field filters such as `serial_number`, `store_name`, `product_line`, `equipment_type`, `equipment_brand`, `model`, `area`, `province`, and `technician`. `grouped=1` returns grouped inventory. |
| `GET /api/assets?current_only=1` | Signed in | Lists only active/current placements, avoiding duplicates from earlier locations. |
| `GET /api/assets?available=1` | Signed in | Lists active unassigned stock (no store and status `unassigned`); up to 500 records can be returned with `per_page=500`. |
| `GET /api/assets/{asset_id}` | Signed in | Returns the placement (`asset`), its `services`, and its `locations`. |
| `POST /api/assets` | Signed in | Creates equipment. Set `status` to `unassigned` and leave store fields blank to register stock without a location or service visit. |
| `PATCH /api/assets/{asset_id}` | Signed in | Updates a freezer placement. |
| `POST /api/stores/{store_id}/freezers` | Signed in | Adds equipment to a store without a service visit. Use `{"asset_id":12}` for unassigned stock, or `{"new_freezer":{...}}` to register a new unit directly at the store. |
| `POST /api/assets/{asset_id}/move` | Signed in | Ends the current placement and creates a new one at a destination store. Body: `{"store_id":2,"effective_date":"2026-10-25"}`; a `new_store` object may be supplied instead. |
| `POST /api/services` | Signed in | Records a service visit on a current freezer, or can create a store/freezer with the visit. |
| `POST /api/assets/{asset_id}/services` | Signed in | Records a service visit on a specified asset (legacy endpoint). |
| `PATCH /api/services/{service_id}` | Signed in | Edits a service visit. |

`POST /api/services` requires `service_date` and a managed `technician`, plus either `store_id` and a current `asset_id`, or a `new_freezer` object. It may also accept `new_store`. Service details use `repairs`, `parts`, and `notes`. Store creation accepts the store fields listed above.

`POST /api/assets` accepts these asset fields. `status` must be `deployed`, `in_transit`, or `unassigned`; store fields may be blank when the freezer has no assigned store. `sales_rep` is plain text, not a controlled dropdown.

Equipment registered with `status: "unassigned"` and blank store fields is available as stock. Adding that stock to a store creates a new active placement linked to the stock record; the old record is retained as inactive so earlier service/location history is not reassigned. Alternatively, `POST /api/stores/{store_id}/freezers` accepts a `new_freezer` object with `product_line`, `equipment_type`, `equipment_brand`, `model`, `serial_number`, `delivery_date`, and `notes`. Equipment type is required; controlled equipment values must use active approved lookup values. Neither operation creates a service event.

```json
{
  "product_line": "ELCOLD",
  "equipment_type": "STANDING FREEZER",
  "equipment_brand": "MANUFACTURER",
  "model": "VISION 390",
  "serial_number": "0163E24",
  "store_name": "3X PETROL",
  "business_address": "DIEGO MARTIN",
  "area": "NORTH WEST",
  "province": "DIEGO MARTIN",
  "manager": "",
  "contact": "",
  "sales_rep": "JANE SMITH",
  "delivery_date": "2024-09-17",
  "status": "deployed",
  "notes": ""
}
```

Example:

```json
{
  "store_id": 1,
  "asset_id": 12,
  "service_date": "2026-10-25",
  "technician": "MAYA",
  "repairs": "Replaced thermostat",
  "parts": "Thermostat",
  "notes": "Unit tested at operating temperature."
}
```

## Service reports

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/reports/services` | Signed in | Returns grouped service counts and `total_services`. |
| `GET /api/reports/services/{asset_id}` | Signed in | Returns the freezer asset and service history across all placements with the same serial number. If no serial is recorded, returns history for that placement only. |

Report query parameters can be combined:

- `store_id`: restrict to visits at placements associated with this store.
- `technician`, `product_line`, `equipment_brand`, `model`: exact filters.
- `serial_number`: case-insensitive partial match.

## Workbook imports

| Method and path | Access | Purpose |
|---|---|---|
| `POST /api/imports/preview` | Signed in | Uploads an `.xlsx` workbook as multipart form data. Include `workbook`; optionally repeat the `sheets` form field to select sheets. Without selected sheets, returns the discovered sheet names. With sheets, returns a review batch ID, rows, and summary. |
| `GET /api/imports/{batch_id}` | Owner or admin | Retrieves a pending review batch. |
| `POST /api/imports/{batch_id}/commit-rows` | Owner or admin | Preferred row-oriented import submission. |
| `POST /api/imports/{batch_id}/commit` | Owner or admin | Legacy value-mapping commit format, retained for existing clients. |

The preview response includes `batch_id`, `file_name`, `sheets`, `record_count`, `review`, and `rows`. Each row includes `source_sheet`, `source_row`, and a `values` object with store, geography, contact, freezer, serial, and delivery-date fields.

`commit-rows` body:

```json
{
  "acknowledge_location_warnings": true,
  "rows": [
    {
      "source_sheet": "KLTEST1",
      "source_row": 5,
      "values": {
        "store_name": "3X PETROL",
        "business_address": "DIEGO MARTIN",
        "area": "NORTH WEST",
        "province": "DIEGO MARTIN",
        "manager": "",
        "contact": "",
        "sales_rep": "JANE SMITH",
        "equipment_type": "STANDING FREEZER",
        "product_line": "ELCOLD",
        "equipment_brand": "",
        "model": "VISION 390 VENT",
        "serial_number": "0163E24",
        "delivery_date": "2024-09-17"
      },
      "new_values": {},
      "leave_delivery_date_blank": false
    }
  ]
}
```

For each freezer dropdown field (`equipment_type`, `product_line`, `equipment_brand`, `model`), `values[field]` must be an approved lookup value or `"__new__"`. For `"__new__"`, provide the requested text in `new_values[field]`; those requests wait for administrator approval before the batch is applied. Area and Province must be approved and match. Blank geography requires `acknowledge_location_warnings: true`. If a date failed parsing, provide a valid date or set `leave_delivery_date_blank: true`.

A successful commit returns either `{"status":"complete","imported":N}` or `{"status":"awaiting_approval","pending_values":N,"records":N}`.

## Administration

All routes in this section require an administrator.

| Method and path | Purpose |
|---|---|
| `GET /api/admin/lookups` | Lists controlled values, including inactive values and provenance. |
| `POST /api/admin/lookups` | Adds a lookup: `{"field":"model","value":"MODEL X"}`. Province creation also requires `parent_value` (Area). |
| `PATCH /api/admin/lookups/{lookup_id}` | Renames/reactivates/deactivates a value; may include `value`, `active`, and (for a Province) `parent_value`. |
| `DELETE /api/admin/lookups/{lookup_id}` | Deactivates a lookup value. |
| `GET /api/admin/variants` | Suggests similar active controlled values. |
| `POST /api/admin/variants/merge` | Merges lookup IDs: `{"source_id":1,"target_id":2}`. Geographic lists cannot be merged. |
| `GET /api/admin/users` | Lists accounts. |
| `POST /api/admin/users` | Creates a user with `username`, `display_name`, `password` (minimum 12 characters), and `role` (`staff` or `admin`). |
| `PATCH /api/admin/users/{user_id}` | Changes `role`, `active`, and/or `password`. |
| `GET /api/admin/audit?limit=200` | Returns recent activity entries (maximum limit 500). |
| `GET /api/admin/import-requests` | Lists pending dropdown requests from imports. |
| `POST /api/admin/import-requests/{request_id}/approve` | Approves a proposed dropdown value; may apply its batch when all requests are resolved. |
| `POST /api/admin/import-requests/{request_id}/reject` | Rejects a proposed value. |
| `GET /api/admin/backups` | Lists backup metadata and scheduled backup state. |
| `PATCH /api/admin/backups/schedule` | Sets daily server-local time: `{"time":"02:00"}`. |
| `POST /api/admin/backups` | Creates a database backup; returns its filename. |
| `GET /api/admin/backups/{filename}` | Downloads a backup file. |
| `POST /api/admin/reset` | Resets application data after receiving `{"confirmation":"RESET"}`; creates a backup first. |

## Errors and status codes

Common responses:

- `400 Bad Request`: invalid fields, lookup choices, import rows, or dates.
- `401 Unauthorized`: sign-in required or credentials invalid.
- `403 Forbidden`: insufficient role, invalid CSRF token, or access to another user's import batch.
- `404 Not Found`: record or batch does not exist.
- `409 Conflict`: duplicate store/list value or an import batch is no longer in review.
- `413 Request Entity Too Large`: upload exceeds the configured request limit.

Read the response's `error` property for the validation reason. Do not retry a mutation blindly after a network timeout; first check whether the record or batch change was applied.
